// @ts-check
// API JSON del Worker (spec §11). Contrato exacto de cada respuesta: sección «Contrato de la API» del plan 2,
// con los cambios del plan 5 (varias estrategias en vivo y GET /api/bot/comparativa).
// Precios e importes en €, porcentajes como fracción (0,05 = 5 %), instantes en ms desde epoch (UTC).
// No existe ninguna ruta que envíe órdenes a un exchange.
import { FACTOR_SIN_STOP, FACTOR_SIN_TP } from '../../core/bot.js'
import { calcularMetricas, metricasPorMoneda } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import { cabecerasCors, leerOrigenes, verificarPin } from './auth.js'
import { leerMonedas } from './config.js'
import { ejecutarMercado } from './ejecuciones/mercado.js'
import * as repo from './repositorio.js'
import { VIVO, etiquetaDe } from './vivo.js'

export const TAMANO_PAGINA = 50
export const DECISIONES_MONEDA = 48
export const TITULARES_MONEDA = 50
export const ESPERA_ANALIZAR_MS = 5 * 60_000
export const MARGEN_SALUD_MS = 2 * HORA
export const DATOS_VIEJOS_MS = 2 * HORA
export const CURVA_HORARIA_MS = 30 * 24 * HORA
/** Más puntos que esto (tras submuestrear) se reducen a CURVA_MAXIMA. */
export const CURVA_UMBRAL = 2000
export const CURVA_MAXIMA = 1000
export const CAPITAL_MINIMO = 100
export const CAPITAL_MAXIMO = 1_000_000

/** Error con código HTTP y cuerpo `{ error, detalle, ...extra }`. */
export class ErrorApi extends Error {
  /** @param {number} estado @param {string} codigo @param {string} detalle @param {Record<string, unknown>} [extra] */
  constructor(estado, codigo, detalle, extra = {}) {
    super(detalle)
    this.estado = estado
    this.codigo = codigo
    this.extra = extra
  }
}

/**
 * @typedef {{ env: { DB: repo.D1, ORACLE_PIN?: string, MONEDAS?: string, ORIGENES?: string } & import('./fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number, esperar?: (ms: number) => Promise<void>, vivo?: import('./vivo.js').Vivo }} Deps
 *   vivo: estrategias en vivo (por defecto, las de core/estrategias.js; los tests inyectan otras).
 * @typedef {Deps & { url: URL, peticion: Request, params: string[], vivo: import('./vivo.js').Vivo }} Contexto
 * @typedef {{ estado?: number, cuerpo: unknown }} Respuesta
 */

// ── Conversión de filas a JSON de la API ────────────────────────────────────

/**
 * principal: activa y de la estrategia principal (la del consejo del Panel); etiqueta: nombre de la estrategia.
 * @param {repo.FilaSimulacion} s @param {import('./vivo.js').Vivo} vivo
 */
export const aSimulacion = (s, vivo) => ({
  id: s.id, creadaEn: s.creada_en, cerradaEn: s.cerrada_en, activa: s.activa === 1,
  estrategiaVersion: s.estrategia_version, etiqueta: etiquetaDe(vivo, s.estrategia_version),
  principal: s.activa === 1 && s.estrategia_version === vivo.principal, capitalInicial: s.capital_inicial, saldo: s.saldo,
})

/** Primera frase de un texto (hasta . ! o ? seguido de espacio o fin). @param {string} texto */
export function primeraFrase(texto) {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(texto.trim())
  return m ? m[0] : texto.trim()
}

/** @param {any} s señal guardada en senales_actuales */
export const aSenalResumen = (s) => ({
  simbolo: s.simbolo, veredicto: s.veredicto, indiceConfianza: s.indiceConfianza, puntuacion: s.puntuacion,
  precioEur: s.precioEur, cambio24h: s.cambio24h, fresca: s.fresca, calculadaEn: s.calculadaEn, vela1h: s.vela1h,
  frase: primeraFrase(s.explicacion ?? ''), motorExplicacion: s.motorExplicacion, estrategiaVersion: s.version,
})

/** @param {any} d */
export const aDecision = (d) => ({
  id: d.id, simbolo: d.simbolo, vela1h: d.vela_1h, veredicto: d.veredicto, indiceConfianza: d.indice_confianza,
  puntuacion: d.puntuacion, accion: d.accion, motivo: d.motivo, precio: d.precio,
  estrategiaVersion: d.estrategia_version, creadaEn: d.creada_en,
})

/** @param {any} o */
export const aOperacion = (o) => ({
  id: o.id, posicionId: o.posicion_id, simbolo: o.simbolo, lado: o.lado, vela1h: o.vela_1h, precio: o.precio,
  unidades: o.unidades, importe: o.importe, comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo,
  saldoTras: o.saldo_tras, pnlNeto: o.pnl_neto, estrategiaVersion: o.estrategia_version, creadaEn: o.creada_en,
})

/**
 * Margen para reconocer los marcadores inalcanzables de core/bot.js (entrada × FACTOR_SIN_STOP / × FACTOR_SIN_TP)
 * aunque la estrategia de la simulación ya no exista: ningún nivel real queda a 1000 veces de la entrada.
 */
const MARGEN_MARCADOR = 1000

/**
 * stopLoss/takeProfit son null si el nivel está desactivado (D1 guarda un marcador inalcanzable porque las
 * columnas son NOT NULL): por los PARAMETROS_BOT de la estrategia de la simulación o, si no se conocen, por magnitud.
 * @param {any} p @param {number} precioActual
 * @param {{ sinStopLoss?: boolean, sinTakeProfit?: boolean }} [niveles] PARAMETROS_BOT de la estrategia
 */
export function aPosicion(p, precioActual, niveles = {}) {
  const valorActual = p.unidades * precioActual
  const sinStop = niveles.sinStopLoss === true || p.stop_loss <= p.precio_entrada * FACTOR_SIN_STOP * MARGEN_MARCADOR
  const sinTp = niveles.sinTakeProfit === true || p.take_profit >= p.precio_entrada * FACTOR_SIN_TP / MARGEN_MARCADOR
  return {
    id: p.id, simbolo: p.simbolo, velaEntrada: p.vela_entrada, precioEntrada: p.precio_entrada, unidades: p.unidades,
    coste: p.coste, stopLoss: sinStop ? null : p.stop_loss, takeProfit: sinTp ? null : p.take_profit, precioActual, valorActual,
    pnlNoRealizado: valorActual - p.coste, pnlNoRealizadoPct: valorActual / p.coste - 1,
  }
}

/** @param {any} t @param {Set<string>} usados */
export const aTitular = (t, usados) => ({
  id: t.id, fuente: t.fuente, origen: t.origen, titulo: t.titulo, url: t.url, publicadoEn: t.publicado_en,
  monedas: t.monedas_json ? JSON.parse(t.monedas_json) : [], puntuacion: t.puntuacion, motor: t.motor, usado: usados.has(t.id),
})

/**
 * Curva para la interfaz: horaria los últimos 30 días y, antes, el último punto de cada día UTC.
 * GET /api/bot la obtiene ya así de D1 (repo.datosBot); esta es la definición de referencia.
 * @param {{ t: number, valor: number, saldo: number, hodl: number|null }[]} puntos ordenados por t
 */
export function submuestrearCurva(puntos) {
  if (puntos.length === 0) return []
  const corte = puntos[puntos.length - 1].t - CURVA_HORARIA_MS
  const dia = 24 * HORA
  return puntos.filter((p, i) => p.t >= corte || Math.floor(p.t / dia) !== Math.floor(puntos[i + 1].t / dia))
}

/**
 * Con más de CURVA_UMBRAL puntos (años de historia), se queda con CURVA_MAXIMA repartidos por igual,
 * siempre con el primero y el último. Con menos, devuelve la misma lista.
 * @template T
 * @param {T[]} puntos
 * @returns {T[]}
 */
export function limitarCurva(puntos) {
  if (puntos.length <= CURVA_UMBRAL) return puntos
  const paso = (puntos.length - 1) / (CURVA_MAXIMA - 1)
  return Array.from({ length: CURVA_MAXIMA }, (_, i) => puntos[Math.round(i * paso)])
}

// ── Parámetros ──────────────────────────────────────────────────────────────

/** @param {URL} url @param {string} nombre @returns {number|null} */
function entero(url, nombre) {
  const valor = url.searchParams.get(nombre)
  if (valor === null || valor === '') return null
  if (!/^\d+$/.test(valor) || Number(valor) < 1 || !Number.isSafeInteger(Number(valor))) {
    throw new ErrorApi(400, 'peticion_invalida', `${nombre} debe ser un entero positivo`)
  }
  return Number(valor)
}

/** @param {URL} url */
function simboloOpcional(url) {
  const s = url.searchParams.get('simbolo')
  if (s === null || s === '') return null
  if (!/^[A-Z0-9]{2,10}$/.test(s)) throw new ErrorApi(400, 'peticion_invalida', 'simbolo no válido')
  return s
}

/**
 * Simulación de ?simulacion= o, si no viene, la activa de la estrategia principal.
 * @param {repo.D1} db @param {URL} url @param {import('./vivo.js').Vivo} vivo
 */
async function simulacionPedida(db, url, vivo) {
  const id = entero(url, 'simulacion')
  const sim = id === null ? await repo.simulacionActiva(db, vivo.principal) : await repo.obtenerSimulacion(db, id)
  if (!sim) throw new ErrorApi(404, 'no_encontrado', id === null ? 'No hay simulación activa' : `No existe la simulación ${id}`)
  return sim
}

/** @param {Request} peticion */
async function cuerpoJson(peticion) {
  try {
    return await peticion.json()
  } catch {
    throw new ErrorApi(400, 'peticion_invalida', 'El cuerpo debe ser JSON')
  }
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function salud({ env, ahora }) {
  const ultima = await repo.ultimaEjecucion(env.DB, ['mercado'])
  const ok = ultima !== null && ultima.ok === true && ahora - ultima.inicio <= MARGEN_SALUD_MS
  return { estado: ok ? 200 : 503, cuerpo: { ok, ultimaEjecucion: ultima } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function resumen({ env, ahora, vivo }) {
  const db = env.DB
  const [guardadas, fng, sim, ultimaEjecucion, ultimaNoticias] = await Promise.all([
    repo.senalesActuales(db), repo.ultimoFng(db), repo.simulacionActiva(db, vivo.principal),
    repo.ultimaEjecucion(db, ['mercado', 'manual']), repo.ultimaEjecucion(db, ['noticias']),
  ])
  const senales = leerMonedas(env.MONEDAS).filter((m) => guardadas[m]).map((m) => aSenalResumen(guardadas[m]))
  let bot = null
  if (sim) {
    const { capital, abiertas } = await repo.resumenBot(db, sim.id)
    const valorCartera = capital ? capital.valor_cartera : sim.saldo
    const valorHodl = capital ? capital.valor_hodl : null
    bot = {
      simulacionId: sim.id, estrategiaVersion: sim.estrategia_version, capitalInicial: sim.capital_inicial,
      saldo: sim.saldo, valorCartera, valorHodl,
      rentabilidad: valorCartera / sim.capital_inicial - 1,
      rentabilidadHodl: valorHodl === null ? null : valorHodl / sim.capital_inicial - 1,
      posicionesAbiertas: abiertas, actualizadoEn: capital ? capital.vela_1h : null,
    }
  }
  const datosDesactualizados = senales.length === 0
    || senales.some((s) => !s.fresca || ahora - s.calculadaEn > DATOS_VIEJOS_MS)
  const estrategiaPrincipal = {
    version: vivo.principal, etiqueta: etiquetaDe(vivo, vivo.principal), enVivo: vivo.versiones.length,
  }
  return { cuerpo: { ahora, estrategiaPrincipal, senales, fng, bot, ultimaEjecucion, ultimaNoticias, datosDesactualizados } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function moneda({ env, ahora, params, vivo }) {
  const db = env.DB
  const simbolo = params[0].toUpperCase()
  if (!leerMonedas(env.MONEDAS).includes(simbolo)) throw new ErrorApi(404, 'no_encontrado', `Moneda no seguida: ${simbolo}`)
  const [guardadas, sim] = await Promise.all([repo.senalesActuales(db), repo.simulacionActiva(db, vivo.principal)])
  const senal = guardadas[simbolo] ?? null
  const hasta = senal?.calculadaEn ?? ahora
  const usados = new Set(Array.isArray(senal?.detalle?.noticias) ? senal.detalle.noticias : [])
  const [titulares, decisiones] = await Promise.all([
    repo.titularesDeMoneda(db, simbolo, hasta - 24 * HORA, hasta, TITULARES_MONEDA),
    sim ? repo.pagina(db, 'decisiones', { simulacionId: sim.id, simbolo, cursor: null, limite: DECISIONES_MONEDA }) : null,
  ])
  return {
    cuerpo: {
      simbolo, senal, titulares: titulares.map((t) => aTitular(t, usados)),
      decisiones: decisiones ? decisiones.filas.map(aDecision) : [],
    },
  }
}

/**
 * PARAMETROS_BOT de la estrategia de una simulación; {} si la versión ya no existe (aPosicion cae a la magnitud).
 * @param {import('./vivo.js').Vivo} vivo @param {string} version
 */
function parametrosBotDe(vivo, version) {
  try {
    return vivo.estrategia(version).PARAMETROS_BOT
  } catch {
    return {}
  }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function bot({ env, url, vivo }) {
  const sim = await simulacionPedida(env.DB, url, vivo)
  const d = await repo.datosBot(env.DB, sim.id, CURVA_HORARIA_MS)
  const niveles = parametrosBotDe(vivo, sim.estrategia_version)
  const abiertas = d.abiertas.map((p) => aPosicion(p, p.precio_actual ?? p.precio_entrada, niveles))
  const operaciones = d.operaciones.map((o) => ({
    tipo: o.lado, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnl_neto ?? undefined,
  }))
  const curva = d.curva.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
  const metricas = calcularMetricas({
    capitalInicial: sim.capital_inicial, saldo: sim.saldo,
    abiertas: abiertas.map((p) => ({ unidades: p.unidades, coste: p.coste, precioActual: p.precioActual })),
    operaciones, resumenCurva: d.resumenCurva,
  })
  return {
    cuerpo: {
      simulacion: aSimulacion(sim, vivo), metricas, porMoneda: metricasPorMoneda(operaciones), abiertas,
      curva: limitarCurva(curva), hodl: sim.hodl_json ? JSON.parse(sim.hodl_json) : null,
    },
  }
}

/** @param {'decisiones'|'operaciones'} tabla */
const paginada = (tabla) => /** @param {Contexto} c @returns {Promise<Respuesta>} */ async ({ env, url, vivo }) => {
  const sim = await simulacionPedida(env.DB, url, vivo)
  const { filas, siguienteCursor } = await repo.pagina(env.DB, tabla, {
    simulacionId: sim.id, simbolo: simboloOpcional(url), cursor: entero(url, 'cursor'), limite: TAMANO_PAGINA,
  })
  return { cuerpo: { items: filas.map(tabla === 'decisiones' ? aDecision : aOperacion), siguienteCursor } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function simulaciones({ env, vivo }) {
  return { cuerpo: { items: (await repo.listarSimulaciones(env.DB)).map((s) => aSimulacion(s, vivo)) } }
}

/**
 * Comparativa de las simulaciones activas, en el orden de las estrategias en vivo: valor, rentabilidad, caída
 * máxima, operaciones y curva (submuestreada como la de GET /api/bot) de cada una, más la curva de comprar y
 * mantener de la principal (todas empiezan con el mismo capital en el mismo instante). Sin simulaciones activas
 * (antes del primer cron), listas vacías.
 * @param {Contexto} c @returns {Promise<Respuesta>}
 */
async function comparativa({ env, ahora, vivo }) {
  const activas = await repo.simulacionesActivas(env.DB)
  const sims = vivo.versiones.flatMap((v) => activas.filter((s) => s.estrategia_version === v))
  const datos = await repo.datosComparativa(env.DB, sims.map((s) => s.id), CURVA_HORARIA_MS)
  const simulaciones = sims.map((sim, i) => {
    const { ultimo, operaciones, curva } = datos[i]
    const valorCartera = ultimo ? ultimo.valor_cartera : sim.saldo
    return {
      id: sim.id, estrategiaVersion: sim.estrategia_version, etiqueta: etiquetaDe(vivo, sim.estrategia_version),
      principal: sim.estrategia_version === vivo.principal, capitalInicial: sim.capital_inicial, valorCartera,
      rentabilidad: valorCartera / sim.capital_inicial - 1, drawdownMaximo: ultimo ? ultimo.drawdown : 0, operaciones,
      curva: limitarCurva(curva.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera }))),
    }
  })
  const i = sims.findIndex((s) => s.estrategia_version === vivo.principal)
  const base = i === -1 ? null : { sim: sims[i], ...datos[i] }
  const ultimoHodl = base?.ultimo?.ultimo_hodl ?? null
  const hodl = base ? limitarCurva(base.curva.filter((c) => c.valor_hodl !== null).map((c) => ({ t: c.vela_1h, valor: c.valor_hodl }))) : []
  const resumenHodl = base && ultimoHodl !== null
    ? { valor: ultimoHodl, rentabilidad: ultimoHodl / base.sim.capital_inicial - 1, drawdownMaximo: base.ultimo.drawdown_hodl }
    : null
  return { cuerpo: { ahora, simulaciones, hodl, resumenHodl } }
}

/**
 * Reinicia el bot: cierra todas las simulaciones activas (se conservan) y abre una por cada estrategia en vivo,
 * todas con el capital pedido. `simulacion` es la nueva de la principal; `simulaciones`, todas las nuevas.
 * @param {Contexto} c @returns {Promise<Respuesta>}
 */
async function reiniciar({ env, ahora, peticion, vivo }) {
  const cuerpo = await cuerpoJson(peticion)
  if (cuerpo?.confirmar !== true) throw new ErrorApi(400, 'peticion_invalida', 'Falta confirmar: true')
  const capital = cuerpo.capital_inicial
  if (typeof capital !== 'number' || !Number.isFinite(capital) || capital < CAPITAL_MINIMO || capital > CAPITAL_MAXIMO) {
    throw new ErrorApi(400, 'peticion_invalida', `capital_inicial debe ser un número entre ${CAPITAL_MINIMO} y ${CAPITAL_MAXIMO}`)
  }
  const nuevas = await repo.reiniciarSimulaciones(env.DB, { capitalInicial: capital, versiones: vivo.versiones, ahora })
  const principal = /** @type {repo.FilaSimulacion} */ (nuevas.find((s) => s.estrategia_version === vivo.principal))
  return { estado: 201, cuerpo: { simulacion: aSimulacion(principal, vivo), simulaciones: nuevas.map((s) => aSimulacion(s, vivo)) } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function analizar({ env, fetch, ahora, esperar, vivo }) {
  const id = await repo.reservarManual(env.DB, ahora, ESPERA_ANALIZAR_MS)
  if (id === null) {
    const previa = await repo.ultimaEjecucion(env.DB, ['manual'])
    throw new ErrorApi(429, 'demasiado_pronto', 'Solo se puede analizar una vez cada 5 minutos.', {
      hasta: (previa?.inicio ?? ahora) + ESPERA_ANALIZAR_MS,
    })
  }
  const r = await ejecutarMercado({ env, fetch, ahora, manual: true, idEjecucion: id, esperar, vivo })
  if (!r.ejecucion.ok) throw new ErrorApi(502, 'analisis_fallido', r.error ?? 'El análisis falló')
  return { cuerpo: { senales: r.senales.map(aSenalResumen), ejecucion: r.ejecucion } }
}

/** @type {{ metodo: string, patron: RegExp, publica?: boolean, manejar: (c: Contexto) => Promise<Respuesta> }[]} */
const RUTAS = [
  { metodo: 'GET', patron: /^\/api\/salud$/, publica: true, manejar: salud },
  { metodo: 'GET', patron: /^\/api\/resumen$/, manejar: resumen },
  { metodo: 'GET', patron: /^\/api\/moneda\/([A-Za-z0-9]{2,10})$/, manejar: moneda },
  { metodo: 'GET', patron: /^\/api\/bot$/, manejar: bot },
  { metodo: 'GET', patron: /^\/api\/bot\/comparativa$/, manejar: comparativa },
  { metodo: 'GET', patron: /^\/api\/bot\/operaciones$/, manejar: paginada('operaciones') },
  { metodo: 'GET', patron: /^\/api\/bot\/decisiones$/, manejar: paginada('decisiones') },
  { metodo: 'GET', patron: /^\/api\/simulaciones$/, manejar: simulaciones },
  { metodo: 'POST', patron: /^\/api\/bot\/reiniciar$/, manejar: reiniciar },
  { metodo: 'POST', patron: /^\/api\/analizar$/, manejar: analizar },
]

/**
 * Atiende una petición HTTP. Nunca lanza: cualquier error se devuelve como JSON `{ error, detalle }`.
 * @param {Request} peticion
 * @param {Deps} deps
 * @returns {Promise<Response>}
 */
export async function atender(peticion, deps) {
  const cors = cabecerasCors(peticion.headers.get('Origin'), leerOrigenes(deps.env.ORIGENES))
  /** @param {unknown} cuerpo @param {number} [estado] */
  const responder = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
  if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(peticion.url)
  const candidatas = RUTAS.filter((r) => r.patron.test(url.pathname))
  if (candidatas.length === 0) return responder({ error: 'no_encontrado', detalle: `No existe ${url.pathname}` }, 404)
  const ruta = candidatas.find((r) => r.metodo === peticion.method)
  if (!ruta) return responder({ error: 'metodo_no_permitido', detalle: `${peticion.method} no se admite en ${url.pathname}` }, 405)
  try {
    if (!ruta.publica) {
      const pin = await verificarPin(deps.env.DB, peticion, deps.env.ORACLE_PIN, deps.ahora)
      if (!pin.ok) return responder(pin.cuerpo, pin.estado)
    }
    const params = /** @type {RegExpExecArray} */ (ruta.patron.exec(url.pathname)).slice(1)
    const r = await ruta.manejar({ ...deps, vivo: deps.vivo ?? VIVO, url, peticion, params })
    return responder(r.cuerpo, r.estado ?? 200)
  } catch (e) {
    if (e instanceof ErrorApi) return responder({ error: e.codigo, detalle: e.message, ...e.extra }, e.estado)
    return responder({ error: 'interno', detalle: e instanceof Error ? e.message : String(e) }, 500)
  }
}

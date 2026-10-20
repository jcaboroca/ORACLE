// @ts-check
// Cron `3 * * * *` (mercado y bot) y POST /api/analizar (solo señales; nunca opera). Spec §5 y §7.
// Datos de mercado de OKX (desde Cloudflare Binance responde 403), con caché en D1 (fuentes/velas.js) y Bybit
// como respaldo de las velas USDT. Subpeticiones externas con 5 monedas (spec §9):
//   velas: 10 por hora (1H USDT y EUR, limit=3), +5 al cerrar cada 4H, +5 al cerrar el día; 20 sin caché;
//   derivados: 10 rubik + los funding que toque refrescar (5 cada 8 h);
//   1 Fear & Greed + hasta 2 LLM (Groq y Gemini, solo con clave; Workers AI va por binding).
// Fijas: 21-38. Lo que sobra hasta 50, con 1 de margen, es el presupuesto de reintentos de OKX, series enteras
// por un hueco de la caché y respaldo de Bybit (este con reserva propia): como mucho 49.
// Llamadas a D1 con n estrategias en vivo y m monedas: 10 + n × m (un lote atómico por moneda y simulación; 2 de
// la caché; 1 que sincroniza las simulaciones; 2 que cargan el estado de todas, antes y después de operar; 1 con
// el capital de todas) + n la primera hora (HODL). Con 5 monedas: 15-16 con 1 estrategia y 25-28 con 3
// (el plan gratuito admite 50 consultas a D1 por invocación).
import { valorCartera, valorHodl, velaDeDecision } from '../../../core/bot.js'
import { ejecutarHora } from '../../../core/hora.js'
import { HORA } from '../../../core/velas.js'
import { CAPITAL_POR_DEFECTO, leerMonedas } from '../config.js'
import { completarDerivados, descargarDerivados, fundingAPedir } from '../fuentes/derivados.js'
import { descargarFng } from '../fuentes/fng.js'
import { explicarSenales, proveedores } from '../fuentes/llm.js'
import { cambio24h, crearCliente, crearPresupuesto, ultimoCierre } from '../fuentes/okx.js'
import { descargarSeries, planificarVelas, serializar } from '../fuentes/velas.js'
import * as repo from '../repositorio.js'
import { VIVO } from '../vivo.js'

/** @typedef {import('../../../core/hora.js').EntradaMoneda} EntradaMoneda */
/** @typedef {import('../../../core/hora.js').Estrategia} Estrategia */
/** @typedef {import('../../../core/hora.js').Senal} Senal */
/** @typedef {import('../fuentes/fng.js').Fng} Fng */

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/** Subpeticiones externas por invocación en el plan gratuito. */
export const SUBPETICIONES = 50

/**
 * Velas (caché + OKX, con Bybit de respaldo), derivados y Fear & Greed. Primero las velas (imprescindibles) y
 * Fear & Greed en paralelo; después, para las USDT que fallen, Bybit; los derivados (opcionales), al final.
 * Nada de esto lanza: lo que falla se anota. Lee la caché al empezar y la reescribe al acabar (2 llamadas a D1).
 * @param {{ db: import('../repositorio.js').D1, fetch: typeof fetch, monedas: string[], ahora: number,
 *   esperar?: (ms: number) => Promise<void>, llmExternos?: number }} entrada
 *   esperar: pausas del límite de ritmo (inyectable en los tests); llmExternos: Groq/Gemini configurados.
 * @returns {Promise<{ entradas: EntradaMoneda[], fng: Fng|null, fallos: string[], reintentosOkx: number,
 *   limitadasOkx: string[], velasBybit: string[] }>}
 */
export async function recogerDatos({ db, fetch, monedas, ahora, esperar, llmExternos = 0 }) {
  /** @type {string[]} */
  const fallos = []
  const cache = await repo.leerCacheMercado(db, monedas).catch((e) => {
    fallos.push(`caché: ${mensaje(e)}`)
    return { velas: {}, funding: {} }
  })
  const pedidos = planificarVelas(monedas, cache.velas, ahora)
  const velasAPedir = pedidos.filter((p) => p.limite > 0)
  const fijas = velasAPedir.length + fundingAPedir(monedas, cache.funding, ahora).length + 2 * monedas.length + 1 + llmExternos
  const presupuesto = crearPresupuesto(SUBPETICIONES - fijas - 1)
  // La mitad del hueco, como mucho, queda para Bybit: si OKX limita, más reintentos a OKX no suelen servir.
  presupuesto.reserva = Math.min(velasAPedir.filter((p) => !p.eur).length, Math.floor(presupuesto.disponibles / 2))
  const okx = crearCliente(fetch, { esperar, presupuesto })
  const fngPromesa = descargarFng(fetch).then((valor) => ({ valor, fallo: null }), (e) => ({ valor: null, fallo: `fng: ${mensaje(e)}` }))
  const velas = await descargarSeries({ okx, fetch, pedidos, ahora, presupuesto })
  presupuesto.reserva = 0
  const derivados = await descargarDerivados(okx, monedas, { funding: cache.funding, ahora })
  const fng = await fngPromesa
  fallos.push(...velas.fallos, ...derivados.fallos, ...(fng.fallo ? [fng.fallo] : []))
  try {
    await repo.guardarCacheMercado(db, {
      velas: velas.guardar.map((g) => ({ instrumento: g.instrumento, intervalo: g.intervalo, json: serializar(g.velas) })),
      funding: derivados.fundingNuevo,
      ahora,
    })
  } catch (e) {
    fallos.push(`caché: ${mensaje(e)}`)
  }
  const entradas = monedas.map((simbolo) => {
    const m = velas.monedas[simbolo]
    return {
      simbolo,
      velas: m.velas,
      velasEur: m.velasEur,
      derivados: completarDerivados(derivados.base[simbolo], cambio24h(m.velas['1h'], ahora)),
    }
  })
  return { entradas, fng: fng.valor, fallos, reintentosOkx: okx.reintentos, limitadasOkx: okx.limitadas, velasBybit: velas.bybit }
}

/**
 * Señal lista para senales_actuales y la API: precio en €, cambio 24 h, explicación y SL/TP orientativos.
 * @param {Senal} senal
 * @param {EntradaMoneda} entrada
 * @param {number} ahora
 * @param {{ texto: string, motor: string }} explicacion
 * @param {import('../../../core/bot.js').ParametrosBot} parametrosBot
 */
export function enriquecerSenal(senal, entrada, ahora, explicacion, parametrosBot) {
  const precioEur = ultimoCierre(entrada.velasEur, ahora)
  const orientativo = precioEur !== null && typeof senal.atrPct === 'number'
    ? {
      stopLoss: precioEur * (1 - parametrosBot.multStopLoss * senal.atrPct),
      takeProfit: precioEur * (1 + parametrosBot.multTakeProfit * senal.atrPct),
    }
    : null
  return {
    ...senal, precioEur, cambio24h: cambio24h(entrada.velasEur, ahora),
    explicacion: explicacion.texto, motorExplicacion: explicacion.motor, orientativo,
  }
}

/**
 * Paso horario del bot de cada simulación activa y persistencia: un lote atómico por moneda y simulación, después
 * un lote con el punto de capital de todas. Cada simulación usa su propia estrategia y su propio estado.
 * Si el lote de una moneda falla, las demás siguen: el saldo se mueve por deltas, así que lo que ya
 * entró es coherente y la moneda fallida se reintenta sola la hora siguiente (su progreso no avanzó).
 * Llamadas a D1: 3 + simulaciones × monedas (+ 1 por simulación la primera hora, al fijar el HODL).
 * @param {import('../repositorio.js').D1} db
 * @param {{ sims: import('../repositorio.js').FilaSimulacion[], estrategiaDe: (version: string) => Estrategia,
 *   entradas: EntradaMoneda[], titulares: import('../../../core/estrategia-v1.js').Titular[], fng: Fng|null, ahora: number }} datos
 * @returns {Promise<{ simulaciones: { id: number, version: string, senales: Senal[], operaciones: number, repetidas: string[] }[],
 *   fallos: string[] }>}
 *   fallos: con más de una simulación, cada uno lleva la versión delante («bot v2 ETH: …»).
 */
export async function operar(db, { sims, estrategiaDe, entradas, titulares, fng, ahora }) {
  /** @type {string[]} */
  const fallos = []
  const ids = sims.map((s) => s.id)
  /** @param {string} version */
  const parametrosDe = (version) => estrategiaDe(version).PARAMETROS_BOT
  /** @param {import('../repositorio.js').FilaSimulacion} sim */
  const prefijo = (sim) => (sims.length > 1 ? `${sim.estrategia_version} ` : '')
  const simulaciones = []
  for (const { sim, estado, hodl } of await repo.cargarEstados(db, ids, parametrosDe)) {
    const est = estrategiaDe(sim.estrategia_version)
    /** @type {string[]} */
    const repetidas = []
    let operaciones = 0
    const hora = ejecutarHora({
      estado, hodl, capitalInicial: sim.capital_inicial, ahora, monedas: entradas, titulares, fng: fng?.valor ?? null, estrategia: est,
    })
    if (hodl === null && hora.hodl !== null) await repo.guardarHodl(db, sim.id, hora.hodl)
    for (const [i, decision] of hora.decisiones.entries()) {
      const eventos = hora.eventos.filter((e) => e.simbolo === decision.simbolo)
      try {
        await repo.guardarPasoMoneda(db, {
          simulacionId: sim.id, version: sim.estrategia_version, decision, senal: hora.senales[i], eventos,
          ultimaRevisada: hora.estado.ultimaRevisada[decision.simbolo], ahora,
        })
        operaciones += eventos.length
      } catch (e) {
        if (/UNIQUE constraint failed: decisiones/.test(mensaje(e))) repetidas.push(decision.simbolo)
        else fallos.push(`bot ${prefijo(sim)}${decision.simbolo}: ${mensaje(e)}`)
      }
    }
    simulaciones.push({ id: sim.id, version: sim.estrategia_version, senales: hora.senales, operaciones, repetidas, hodl: hora.hodl })
  }

  /** @type {Record<string, number>} */
  const precios = {}
  for (const e of entradas) {
    const p = ultimoCierre(e.velasEur, ahora)
    if (p !== null) precios[e.simbolo] = p
  }
  /** @type {import('../repositorio.js').PuntoCapital[]} */
  const puntos = []
  for (const [i, { sim, estado: final }] of (await repo.cargarEstados(db, ids, parametrosDe)).entries()) {
    const sinPrecio = Object.keys(final.posiciones).filter((s) => !(s in precios))
    if (sinPrecio.length > 0) {
      fallos.push(`capital${sims.length > 1 ? ` ${sim.estrategia_version}` : ''}: sin precio EUR de ${sinPrecio.join(', ')}`)
      continue
    }
    const hodlFinal = simulaciones[i].hodl
    puntos.push({
      simulacionId: sim.id,
      vela: velaDeDecision(ahora),
      valorCartera: valorCartera(final, precios),
      saldo: final.saldo,
      valorHodl: hodlFinal && Object.keys(hodlFinal).every((s) => s in precios) ? valorHodl(hodlFinal, precios) : null,
    })
  }
  await repo.guardarCapitales(db, puntos)
  return { simulaciones: simulaciones.map(({ hodl: _, ...s }) => s), fallos }
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof globalThis.fetch, ahora: number, manual?: boolean, idEjecucion?: number, esperar?: (ms: number) => Promise<void>,
 *   vivo?: import('../vivo.js').Vivo }} deps
 *   manual: true para POST /api/analizar (refresca señales con la estrategia principal; nunca crea simulaciones ni opera).
 *   idEjecucion: fila de ejecuciones ya reservada (repo.reservarManual); si no viene, se crea.
 *   esperar: pausas del límite de ritmo de OKX (por defecto, setTimeout).
 *   vivo: estrategias en vivo (por defecto, las de core/estrategias.js).
 */
export async function ejecutarMercado({ env, fetch: fetchExterno, ahora, manual = false, idEjecucion, esperar, vivo = VIVO }) {
  const db = env.DB
  let subpeticiones = 0
  /** @type {typeof globalThis.fetch} */
  const fetch = (entrada, init) => {
    subpeticiones++
    return init === undefined ? fetchExterno(entrada) : fetchExterno(entrada, init)
  }
  const tipo = manual ? 'manual' : 'mercado'
  const id = idEjecucion ?? await repo.iniciarEjecucion(db, tipo, ahora)
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  let repetidas = []
  /** @type {{ id: number, version: string, operaciones: number, repetidas: string[] }[]} */
  let resumenSims = []
  try {
    const monedas = leerMonedas(env.MONEDAS)
    const sims = manual ? [] : await repo.sincronizarSimulaciones(db, { versiones: vivo.versiones, capitalInicial: CAPITAL_POR_DEFECTO, ahora })
    const principal = vivo.estrategia(vivo.principal)
    const llmExternos = proveedores(env, fetch).filter((p) => p.motor !== 'cf').length
    const datos = await recogerDatos({ db, fetch, monedas, ahora, esperar, llmExternos })
    fallos.push(...datos.fallos)
    const titulares = await repo.titularesParaEstrategia(db, ahora - 24 * HORA, ahora)
    /** @type {Senal[]} */
    let senales
    let operaciones = 0
    if (manual) {
      senales = datos.entradas.map((e) => principal.calcularSenal({
        simbolo: e.simbolo, ahora, velas: e.velas, derivados: e.derivados, titulares, fng: datos.fng?.valor ?? null,
      }))
    } else {
      const r = await operar(db, { sims, estrategiaDe: vivo.estrategia, entradas: datos.entradas, titulares, fng: datos.fng, ahora })
      fallos.push(...r.fallos)
      resumenSims = r.simulaciones.map(({ senales: _, ...s }) => s)
      senales = /** @type {NonNullable<typeof r.simulaciones[number]>} */ (r.simulaciones.find((s) => s.version === vivo.principal)).senales
      repetidas = [...new Set(r.simulaciones.flatMap((s) => s.repetidas))]
      operaciones = r.simulaciones.reduce((n, s) => n + s.operaciones, 0)
    }
    // El LLM va después del bot (si tarda o falla, las operaciones ya están guardadas) y solo para la principal.
    const { textos, fallos: fallosLlm } = await explicarSenales({ env, fetch, senales })
    fallos.push(...fallosLlm)
    const enriquecidas = senales.map((s, i) => enriquecerSenal(s, datos.entradas[i], ahora, textos[s.simbolo], principal.PARAMETROS_BOT))
    await repo.guardarSenales(db, enriquecidas.map((s) => ({
      simbolo: s.simbolo, calculadaEn: ahora, vela1h: s.vela1h ?? velaDeDecision(ahora), senal: s,
    })))
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, {
      fin,
      ok: true,
      detalle: {
        fallos, repetidas, operaciones, simulacionId: sims.find((s) => s.estrategia_version === vivo.principal)?.id ?? null,
        simulaciones: resumenSims, estrategiaPrincipal: vivo.principal, fng: datos.fng, reintentosOkx: datos.reintentosOkx,
        limitadasOkx: datos.limitadasOkx, velasBybit: datos.velasBybit, subpeticiones,
      },
    })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: true, fallos }, senales: enriquecidas, repetidas, operaciones, simulaciones: resumenSims }
  } catch (e) {
    const error = mensaje(e)
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, { fin, ok: false, detalle: { fallos, repetidas, error } })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: false, fallos }, senales: [], repetidas, operaciones: 0, simulaciones: resumenSims, error }
  }
}

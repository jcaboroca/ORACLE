// @ts-check
// Cron `3 * * * *` (mercado y bot) y POST /api/analizar (solo señales; nunca opera). Spec §5 y §7.
// Subpeticiones externas con 5 monedas: 20 velas (15 USDT de 501 + 5 EUR de 48) + 15 derivados (3 por moneda)
// + 1 Fear & Greed + hasta 2 LLM (Groq y Gemini; Workers AI va por binding) = 38 de 50.
// Llamadas a D1: como mucho 17 (5 de ellas, un lote atómico por moneda).
import { valorCartera, valorHodl, velaDeDecision } from '../../../core/bot.js'
import { ESTRATEGIA_ACTIVA, estrategia as obtenerEstrategia } from '../../../core/estrategias.js'
import { ejecutarHora } from '../../../core/hora.js'
import { HORA } from '../../../core/velas.js'
import { CAPITAL_POR_DEFECTO, leerMonedas } from '../config.js'
import { cambio24h, descargarMoneda, ultimoCierre } from '../fuentes/binance.js'
import { completarDerivados, descargarDerivados } from '../fuentes/derivados.js'
import { descargarFng } from '../fuentes/fng.js'
import { explicarSenales } from '../fuentes/llm.js'
import * as repo from '../repositorio.js'

/** @typedef {import('../../../core/hora.js').EntradaMoneda} EntradaMoneda */
/** @typedef {import('../../../core/hora.js').Estrategia} Estrategia */
/** @typedef {import('../../../core/hora.js').Senal} Senal */
/** @typedef {import('../fuentes/fng.js').Fng} Fng */

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * Velas, derivados y Fear & Greed en paralelo. Nada de esto lanza: lo que falla se anota.
 * @param {typeof fetch} fetch
 * @param {string[]} monedas
 * @param {number} ahora
 * @returns {Promise<{ entradas: EntradaMoneda[], fng: Fng|null, fallos: string[] }>}
 */
export async function recogerDatos(fetch, monedas, ahora) {
  const [porMoneda, derivados, fng] = await Promise.all([
    Promise.all(monedas.map((m) => descargarMoneda(fetch, m))),
    descargarDerivados(fetch, monedas),
    descargarFng(fetch).then((valor) => ({ valor, fallo: null }), (e) => ({ valor: null, fallo: `fng: ${mensaje(e)}` })),
  ])
  const fallos = [...porMoneda.flatMap((m) => m.fallos), ...derivados.fallos, ...(fng.fallo ? [fng.fallo] : [])]
  const entradas = porMoneda.map((m) => ({
    simbolo: m.simbolo,
    velas: m.velas,
    velasEur: m.velasEur,
    derivados: completarDerivados(derivados.base[m.simbolo], cambio24h(m.velas['1h'], ahora)),
  }))
  return { entradas, fng: fng.valor, fallos }
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
 * Paso horario del bot y persistencia: un lote atómico por moneda, después el punto de capital.
 * Si el lote de una moneda falla, las demás siguen: el saldo se mueve por deltas, así que lo que ya
 * entró es coherente y la moneda fallida se reintenta sola la hora siguiente (su progreso no avanzó).
 * @param {import('../repositorio.js').D1} db
 * @param {{ sim: import('../repositorio.js').FilaSimulacion, est: Estrategia, entradas: EntradaMoneda[],
 *   titulares: import('../../../core/estrategia-v1.js').Titular[], fng: Fng|null, ahora: number }} datos
 */
export async function operar(db, { sim, est, entradas, titulares, fng, ahora }) {
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  const repetidas = []
  let operaciones = 0
  const { estado, hodl } = await repo.cargarEstado(db, sim, est.PARAMETROS_BOT)
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
      else fallos.push(`bot ${decision.simbolo}: ${mensaje(e)}`)
    }
  }

  /** @type {Record<string, number>} */
  const precios = {}
  for (const e of entradas) {
    const p = ultimoCierre(e.velasEur, ahora)
    if (p !== null) precios[e.simbolo] = p
  }
  const simFinal = /** @type {import('../repositorio.js').FilaSimulacion} */ (await repo.obtenerSimulacion(db, sim.id))
  const { estado: final } = await repo.cargarEstado(db, simFinal, est.PARAMETROS_BOT)
  const sinPrecio = Object.keys(final.posiciones).filter((s) => !(s in precios))
  if (sinPrecio.length > 0) {
    fallos.push(`capital: sin precio EUR de ${sinPrecio.join(', ')}`)
  } else {
    const hodlFinal = hora.hodl
    await repo.guardarCapital(db, {
      simulacionId: sim.id,
      vela: velaDeDecision(ahora),
      valorCartera: valorCartera(final, precios),
      saldo: final.saldo,
      valorHodl: hodlFinal && Object.keys(hodlFinal).every((s) => s in precios) ? valorHodl(hodlFinal, precios) : null,
    })
  }
  return { senales: hora.senales, fallos, repetidas, operaciones }
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number, manual?: boolean, idEjecucion?: number }} deps
 *   manual: true para POST /api/analizar (refresca señales; nunca crea simulaciones ni opera).
 *   idEjecucion: fila de ejecuciones ya reservada (repo.reservarManual); si no viene, se crea.
 */
export async function ejecutarMercado({ env, fetch, ahora, manual = false, idEjecucion }) {
  const db = env.DB
  const tipo = manual ? 'manual' : 'mercado'
  const id = idEjecucion ?? await repo.iniciarEjecucion(db, tipo, ahora)
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  let repetidas = []
  try {
    const monedas = leerMonedas(env.MONEDAS)
    let sim = await repo.simulacionActiva(db)
    if (!sim && !manual) sim = await repo.crearSimulacion(db, { capitalInicial: CAPITAL_POR_DEFECTO, version: ESTRATEGIA_ACTIVA, ahora })
    const est = obtenerEstrategia(sim?.estrategia_version ?? ESTRATEGIA_ACTIVA)
    const datos = await recogerDatos(fetch, monedas, ahora)
    fallos.push(...datos.fallos)
    const titulares = await repo.titularesParaEstrategia(db, ahora - 24 * HORA, ahora)
    const fngValor = datos.fng?.valor ?? null
    /** @type {Senal[]} */
    let senales
    let operaciones = 0
    if (manual || !sim) {
      senales = datos.entradas.map((e) => est.calcularSenal({
        simbolo: e.simbolo, ahora, velas: e.velas, derivados: e.derivados, titulares, fng: fngValor,
      }))
    } else {
      const r = await operar(db, { sim, est, entradas: datos.entradas, titulares, fng: datos.fng, ahora })
      senales = r.senales
      fallos.push(...r.fallos)
      repetidas = r.repetidas
      operaciones = r.operaciones
    }
    // El LLM va después del bot: si tarda o falla, las operaciones ya están guardadas.
    const { textos, fallos: fallosLlm } = await explicarSenales({ env, fetch, senales })
    fallos.push(...fallosLlm)
    const enriquecidas = senales.map((s, i) => enriquecerSenal(s, datos.entradas[i], ahora, textos[s.simbolo], est.PARAMETROS_BOT))
    await repo.guardarSenales(db, enriquecidas.map((s) => ({
      simbolo: s.simbolo, calculadaEn: ahora, vela1h: s.vela1h ?? velaDeDecision(ahora), senal: s,
    })))
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, {
      fin, ok: true, detalle: { fallos, repetidas, operaciones, simulacionId: sim?.id ?? null, fng: datos.fng },
    })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: true, fallos }, senales: enriquecidas, repetidas, operaciones }
  } catch (e) {
    const error = mensaje(e)
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, { fin, ok: false, detalle: { fallos, repetidas, error } })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: false, fallos }, senales: [], repetidas, operaciones: 0, error }
  }
}

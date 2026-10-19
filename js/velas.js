// @ts-check
// Velas de los gráficos pedidas por el navegador (spec §9): Binance (data-api.binance.vision) y, si falla, OKX.
// El Worker ya no usa Binance (responde 403 a Cloudflare), pero desde el navegador sí funciona. Cada fila se
// valida al convertirla en una vela de core/velas.js: nunca se pinta un precio mal leído.
import { DURACION } from '../core/velas.js'

/** @typedef {import('../core/velas.js').Vela} Vela */
/** @typedef {'1h'|'4h'|'1d'} Temporalidad */

export const BINANCE = 'https://data-api.binance.vision/api/v3/klines'
export const OKX = 'https://www.okx.com/api/v5/market/candles'
/** Barras de OKX: la diaria en UTC, como las de Binance. */
export const BARRAS_OKX = Object.freeze({ '1h': '1H', '4h': '4H', '1d': '1Dutc' })
/** OKX sirve como mucho 300 velas por petición. */
export const LIMITE_OKX = 300

/**
 * Comprueba una vela recién leída. `origen` encabeza el mensaje de error.
 * @param {string} origen @param {Vela} v
 */
function comprobar(origen, v) {
  // `!(x > 0)` también rechaza NaN; y ±Infinity no es finito.
  if (!(v.apertura > 0 && v.maximo > 0 && v.minimo > 0 && v.cierre > 0)
    || !Number.isFinite(v.apertura + v.maximo + v.minimo + v.cierre)) {
    throw new TypeError(`${origen}: precio no válido`)
  }
  if (!(v.volumen >= 0) || !Number.isFinite(v.volumen)) throw new TypeError(`${origen}: volumen no válido`)
  if (v.maximo < v.apertura || v.maximo < v.cierre || v.maximo < v.minimo || v.minimo > v.apertura || v.minimo > v.cierre) {
    throw new TypeError(`${origen}: OHLC incoherente`)
  }
}

/**
 * Filas de /api/v3/klines de Binance (de la más antigua a la más reciente) → velas validadas.
 * @param {unknown} json
 * @returns {Vela[]}
 */
export function leerKlines(json) {
  if (!Array.isArray(json)) throw new TypeError('klines: la respuesta no es una lista')
  /** @type {Vela[]} */
  const velas = []
  let previa = -Infinity
  for (const fila of json) {
    if (!Array.isArray(fila) || fila.length < 7) throw new TypeError('klines: fila mal formada')
    const inicio = Number(fila[0])
    const cierreMs = Number(fila[6])
    if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(cierreMs) || cierreMs <= inicio) {
      throw new TypeError('klines: tiempos no válidos')
    }
    if (inicio <= previa) throw new TypeError('klines: velas desordenadas o repetidas')
    previa = inicio
    const v = {
      inicio, fin: cierreMs + 1, apertura: Number(fila[1]), maximo: Number(fila[2]), minimo: Number(fila[3]),
      cierre: Number(fila[4]), volumen: Number(fila[5]),
    }
    comprobar('klines', v)
    velas.push(v)
  }
  return velas
}

/**
 * Respuesta de /api/v5/market/candles de OKX (`{ code: '0', data }`, filas de la más reciente a la más antigua,
 * `[ts, o, h, l, c, vol, …, confirm]`) → velas validadas de la más antigua a la más reciente.
 * @param {unknown} json
 * @param {number} duracion ms de la barra
 * @returns {Vela[]}
 */
export function leerVelasOkx(json, duracion) {
  const cuerpo = /** @type {{ code?: unknown, msg?: unknown, data?: unknown }} */ (json ?? {})
  if (cuerpo.code !== '0') throw new Error(`OKX ${String(cuerpo.code)}${cuerpo.msg ? `: ${String(cuerpo.msg)}` : ''}`)
  if (!Array.isArray(cuerpo.data)) throw new TypeError('velas: no es una lista')
  /** @type {Vela[]} */
  const velas = []
  let posterior = Infinity
  for (const fila of cuerpo.data) {
    if (!Array.isArray(fila) || fila.length < 6) throw new TypeError('velas: fila mal formada')
    const inicio = Number(fila[0])
    if (!Number.isSafeInteger(inicio) || inicio <= 0) throw new TypeError('velas: tiempo no válido')
    if (inicio >= posterior) throw new TypeError('velas: velas desordenadas o repetidas')
    posterior = inicio
    const v = {
      inicio, fin: inicio + duracion, apertura: Number(fila[1]), maximo: Number(fila[2]), minimo: Number(fila[3]),
      cierre: Number(fila[4]), volumen: Number(fila[5]),
    }
    comprobar('velas', v)
    velas.push(v)
  }
  return velas.reverse()
}

/**
 * JSON de una URL; un HTTP de error lanza `HTTP nnn` (y el cuerpo se descarta).
 * @param {typeof fetch} fetch @param {string} url
 */
async function pedirJson(fetch, url) {
  const res = await fetch(url)
  if (!res.ok) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`HTTP ${res.status}`)
  }
  return res.json()
}

/**
 * @param {typeof fetch} fetch
 * @param {string} par p. ej. BTCEUR
 * @param {Temporalidad} temporalidad
 * @param {number} limite
 */
export async function velasBinance(fetch, par, temporalidad, limite) {
  return leerKlines(await pedirJson(fetch, `${BINANCE}?symbol=${par}&interval=${temporalidad}&limit=${limite}`))
}

/**
 * @param {typeof fetch} fetch
 * @param {string} instId p. ej. BTC-EUR
 * @param {Temporalidad} temporalidad
 * @param {number} [limite]
 */
export async function velasOkx(fetch, instId, temporalidad, limite = LIMITE_OKX) {
  const url = `${OKX}?instId=${instId}&bar=${BARRAS_OKX[temporalidad]}&limit=${Math.min(limite, LIMITE_OKX)}`
  return leerVelasOkx(await pedirJson(fetch, url), DURACION[temporalidad])
}

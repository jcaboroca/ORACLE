// @ts-check
// Respaldo de las velas USDT cuando OKX sigue limitando tras los reintentos (spec §4): Bybit spot,
// /v5/market/kline (responde desde la red de Cloudflare). Sin respaldo para EUR: Bybit no tiene BNB-EUR.
// Filas [inicio, apertura, máximo, mínimo, cierre, volumen en la moneda base, volumen en USDT], la más
// reciente primero; el día ('D') es el día UTC y las 4 h empiezan en múltiplos de 4 h UTC, como en OKX.
import { DURACION } from '../../../core/velas.js'
import { leerFilasVelas } from './okx.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */
/** @typedef {import('./okx.js').Intervalo} Intervalo */

export const BYBIT_VELAS = 'https://api.bybit.com/v5/market/kline'
export const INTERVALOS_BYBIT = /** @type {const} */ ({ '1h': '60', '4h': '240', '1d': 'D' })

/**
 * Valida la respuesta entera de /v5/market/kline y la convierte en velas de core ascendentes.
 * @param {any} json
 * @param {string} simbolo p. ej. BTCUSDT
 * @param {number} duracion
 * @returns {Vela[]}
 */
export function leerVelasBybit(json, simbolo, duracion) {
  if (!json || typeof json !== 'object') throw new TypeError('Bybit: la respuesta no es JSON')
  if (json.retCode !== 0) throw new TypeError(`Bybit código ${json.retCode ?? '?'}${json.retMsg ? `: ${json.retMsg}` : ''}`)
  if (json.result?.symbol !== simbolo) throw new TypeError('Bybit: respuesta de otro símbolo')
  if (!Array.isArray(json.result.list)) throw new TypeError('Bybit: respuesta sin lista de velas')
  return leerFilasVelas(json.result.list, duracion, 7)
}

/**
 * Una serie de velas spot {base}USDT de Bybit. El cuerpo se lee siempre entero (también en los errores).
 * @param {typeof fetch} fetch
 * @param {string} base p. ej. BTC
 * @param {Intervalo} intervalo
 * @param {number} limite
 */
export async function descargarVelasBybit(fetch, base, intervalo, limite) {
  const simbolo = `${base}USDT`
  const res = await fetch(`${BYBIT_VELAS}?category=spot&symbol=${simbolo}&interval=${INTERVALOS_BYBIT[intervalo]}&limit=${limite}`)
  const texto = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  /** @type {unknown} */
  let json
  try {
    json = JSON.parse(texto)
  } catch {
    throw new Error('Bybit: la respuesta no es JSON')
  }
  return leerVelasBybit(json, simbolo, DURACION[intervalo])
}

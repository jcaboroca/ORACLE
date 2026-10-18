// @ts-check
// Velas de Binance desde el mirror público data-api.binance.vision. Cada fila se valida antes de convertirla.
import { cerradasHasta, desdeBinance } from '../../../core/velas.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */

export const BINANCE = 'https://data-api.binance.vision/api/v3/klines'
export const LIMITE_VELAS = 500

/**
 * Comprueba que la respuesta de /klines es una lista de filas coherentes y ordenadas.
 * @param {unknown} json
 * @returns {unknown[][]}
 */
export function validarKlines(json) {
  if (!Array.isArray(json)) throw new TypeError('klines: la respuesta no es una lista')
  let previa = -Infinity
  for (const fila of json) {
    if (!Array.isArray(fila) || fila.length < 7) throw new TypeError('klines: fila mal formada')
    const [inicio, apertura, maximo, minimo, cierre, volumen, cierreMs] = fila.slice(0, 7).map(Number)
    if (!Number.isInteger(inicio) || !Number.isInteger(cierreMs) || cierreMs <= inicio) {
      throw new TypeError('klines: tiempos no válidos')
    }
    if (![apertura, maximo, minimo, cierre].every((x) => Number.isFinite(x) && x > 0)) {
      throw new TypeError('klines: precio no válido')
    }
    if (!Number.isFinite(volumen) || volumen < 0) throw new TypeError('klines: volumen no válido')
    if (maximo < Math.max(apertura, cierre, minimo) || minimo > Math.min(apertura, cierre)) {
      throw new TypeError('klines: OHLC incoherente')
    }
    if (inicio <= previa) throw new TypeError('klines: velas desordenadas o repetidas')
    previa = inicio
  }
  return /** @type {unknown[][]} */ (json)
}

/**
 * @param {typeof fetch} fetch
 * @param {string} par p. ej. BTCUSDT o BTCEUR
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} [limite]
 * @returns {Promise<Vela[]>}
 */
export async function descargarVelas(fetch, par, intervalo, limite = LIMITE_VELAS) {
  const res = await fetch(`${BINANCE}?symbol=${par}&interval=${intervalo}&limit=${limite}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return desdeBinance(validarKlines(await res.json()))
}

/**
 * Las 4 series de una moneda (4 subpeticiones). Una serie que falla queda vacía y se anota.
 * @param {typeof fetch} fetch
 * @param {string} simbolo
 */
export async function descargarMoneda(fetch, simbolo) {
  /** @type {[string, '1h'|'4h'|'1d'][]} */
  const pedidos = [[`${simbolo}USDT`, '1h'], [`${simbolo}USDT`, '4h'], [`${simbolo}USDT`, '1d'], [`${simbolo}EUR`, '1h']]
  const resultados = await Promise.allSettled(pedidos.map(([par, intervalo]) => descargarVelas(fetch, par, intervalo)))
  /** @type {string[]} */
  const fallos = []
  /** @param {number} i @returns {Vela[]} */
  const serie = (i) => {
    const r = resultados[i]
    if (r.status === 'fulfilled') return r.value
    fallos.push(`velas ${pedidos[i][0]} ${pedidos[i][1]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    return []
  }
  return { simbolo, velas: { '1h': serie(0), '4h': serie(1), '1d': serie(2) }, velasEur: serie(3), fallos }
}

/**
 * Variación del cierre en 24 h con velas 1H ya cerradas en `ahora` (0,02 = +2 %). null si faltan velas.
 * @param {Vela[]} velas1h
 * @param {number} ahora
 */
export function cambio24h(velas1h, ahora) {
  const cerradas = cerradasHasta(velas1h, ahora)
  if (cerradas.length < 25) return null
  const ultima = cerradas[cerradas.length - 1]
  const hace24h = cerradas[cerradas.length - 25]
  if (ultima.inicio - hace24h.inicio !== 24 * 3_600_000) return null
  return ultima.cierre / hace24h.cierre - 1
}

/**
 * Cierre de la última vela cerrada en `ahora`, o null.
 * @param {Vela[]} velas
 * @param {number} ahora
 */
export function ultimoCierre(velas, ahora) {
  const cerradas = cerradasHasta(velas, ahora)
  return cerradas.length > 0 ? cerradas[cerradas.length - 1].cierre : null
}

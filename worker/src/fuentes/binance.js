// @ts-check
// Velas de Binance desde el mirror público data-api.binance.vision. Cada fila se valida mientras se convierte
// (una sola pasada: el parseo es lo que más CPU gasta de la ejecución de mercado, spec §9).
import { VENTANA, cerradasHasta } from '../../../core/velas.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */

export const BINANCE = 'https://data-api.binance.vision/api/v3/klines'
/** Binance incluye la vela en curso: se piden VENTANA + 1 para que queden VENTANA cerradas. */
export const LIMITE_VELAS = VENTANA + 1

/**
 * Velas 1H EUR que se piden (47 cerradas + la vela en curso): bastan para el cambio 24 h (25 cerradas) y para
 * recuperar los stops de ~2 días de ejecuciones perdidas. Con un hueco mayor de 47 h sin ejecuciones, las
 * velas más antiguas del hueco no se revisan (spec §7.4 y §13).
 */
export const LIMITE_EUR = 48

/**
 * Valida la respuesta de /klines (lista de filas coherentes y ordenadas) y la convierte en velas, todo en
 * una pasada: cada campo se convierte a número una sola vez. Mismo resultado que desdeBinance de core/velas.js.
 * @param {unknown} json
 * @returns {Vela[]}
 */
export function leerKlines(json) {
  if (!Array.isArray(json)) throw new TypeError('klines: la respuesta no es una lista')
  /** @type {Vela[]} */
  const velas = new Array(json.length)
  let previa = -Infinity
  for (let i = 0; i < json.length; i++) {
    const fila = json[i]
    if (!Array.isArray(fila) || fila.length < 7) throw new TypeError('klines: fila mal formada')
    const inicio = Number(fila[0])
    const apertura = Number(fila[1])
    const maximo = Number(fila[2])
    const minimo = Number(fila[3])
    const cierre = Number(fila[4])
    const volumen = Number(fila[5])
    const cierreMs = Number(fila[6])
    if (!Number.isInteger(inicio) || !Number.isInteger(cierreMs) || cierreMs <= inicio) {
      throw new TypeError('klines: tiempos no válidos')
    }
    // `!(x > 0)` también rechaza NaN; y ±Infinity no es finito.
    if (!(apertura > 0 && maximo > 0 && minimo > 0 && cierre > 0)
      || !Number.isFinite(apertura + maximo + minimo + cierre)) {
      throw new TypeError('klines: precio no válido')
    }
    if (!(volumen >= 0) || !Number.isFinite(volumen)) throw new TypeError('klines: volumen no válido')
    if (maximo < apertura || maximo < cierre || maximo < minimo || minimo > apertura || minimo > cierre) {
      throw new TypeError('klines: OHLC incoherente')
    }
    if (inicio <= previa) throw new TypeError('klines: velas desordenadas o repetidas')
    previa = inicio
    velas[i] = { inicio, fin: cierreMs + 1, apertura, maximo, minimo, cierre, volumen }
  }
  return velas
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
  return leerKlines(await res.json())
}

/**
 * Las 4 series de una moneda (4 subpeticiones): USDT 1h/4h/1d con LIMITE_VELAS y EUR 1h con LIMITE_EUR.
 * Una serie que falla queda vacía y se anota.
 * @param {typeof fetch} fetch
 * @param {string} simbolo
 */
export async function descargarMoneda(fetch, simbolo) {
  /** @type {[string, '1h'|'4h'|'1d', number][]} */
  const pedidos = [
    [`${simbolo}USDT`, '1h', LIMITE_VELAS], [`${simbolo}USDT`, '4h', LIMITE_VELAS], [`${simbolo}USDT`, '1d', LIMITE_VELAS],
    [`${simbolo}EUR`, '1h', LIMITE_EUR],
  ]
  const resultados = await Promise.allSettled(pedidos.map(([par, intervalo, limite]) => descargarVelas(fetch, par, intervalo, limite)))
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

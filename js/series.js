// @ts-check
// Datos para los gráficos (lightweight-charts): velas de Binance (o de OKX si Binance falla) pedidas por el
// navegador, EMA20/50/200 y RSI14 con los mismos indicadores de core/, y curvas de capital.
// Tiempos en segundos UTC (los de la librería).
import { ema, rsi } from '../core/indicadores.js'
import { ZONA } from './formato.js'
import { velasBinance, velasOkx } from './velas.js'

/** @typedef {import('../core/velas.js').Vela} Vela */
/** @typedef {'1h'|'4h'|'1d'} Temporalidad */
/** @typedef {{ time: number, value: number }} PuntoLinea */

/** @type {readonly Temporalidad[]} */
export const TEMPORALIDADES = Object.freeze(['1h', '4h', '1d'])
export const ETIQUETA_TEMPORALIDAD = Object.freeze({ '1h': '1H', '4h': '4H', '1d': '1D' })
/** Velas por gráfico en Binance (la última puede estar en curso): de sobra para la EMA200 y ~3 semanas en 1H. OKX da 300. */
export const VELAS_GRAFICO = 500

/** @typedef {'Binance'|'OKX'} Fuente */

/**
 * Velas del par en euros de Binance y, si falla o viene vacío, de OKX; sin euros en ninguna, las del par USDT
 * (respaldo, se indica en la interfaz), igual primero Binance y luego OKX. Nunca inventa precios: si fallan
 * todas, lanza.
 * @param {{ simbolo: string, temporalidad: Temporalidad, fetch: typeof fetch }} op
 * @returns {Promise<{ par: string, divisa: 'EUR'|'USDT', respaldo: boolean, fuente: Fuente, velas: Vela[] }>}
 */
export async function velasDeMoneda({ simbolo, temporalidad, fetch }) {
  /** @type {string[]} */
  const errores = []
  for (const divisa of /** @type {const} */ (['EUR', 'USDT'])) {
    /** @type {[Fuente, string, () => Promise<Vela[]>][]} */
    const intentos = [
      ['Binance', `${simbolo}${divisa}`, () => velasBinance(fetch, `${simbolo}${divisa}`, temporalidad, VELAS_GRAFICO)],
      ['OKX', `${simbolo}-${divisa}`, () => velasOkx(fetch, `${simbolo}-${divisa}`, temporalidad)],
    ]
    for (const [fuente, par, pedir] of intentos) {
      try {
        const velas = await pedir()
        if (velas.length > 0) return { par, divisa, respaldo: divisa !== 'EUR', fuente, velas }
        errores.push(`${fuente} ${par}: sin velas`)
      } catch (e) {
        errores.push(`${fuente} ${par}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
  }
  throw new Error(`No se pudieron descargar velas de ${simbolo} (${errores.join('; ')}).`)
}

/** @param {number} ms */
export const aSegundos = (ms) => Math.floor(ms / 1000)

/**
 * Formato de precio de una serie a la española: 2 decimales desde 1, 4 por debajo (como `precio` de formato.js).
 * @param {number} decimales
 */
export function formatoNumero(decimales) {
  const f = new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return { type: /** @type {'custom'} */ ('custom'), minMove: 10 ** -decimales, formatter: (/** @type {number} */ x) => f.format(x) }
}

/** @param {Vela[]} velas */
export const formatoPrecio = (velas) => formatoNumero(Math.abs(velas.length > 0 ? velas[velas.length - 1].cierre : 1) >= 1 ? 2 : 4)

/** @param {Vela[]} velas */
export const datosVelas = (velas) => velas.map((v) => ({
  time: aSegundos(v.inicio), open: v.apertura, high: v.maximo, low: v.minimo, close: v.cierre,
}))

/**
 * Serie de un indicador alineada con las velas, sin los huecos iniciales (null).
 * @param {Vela[]} velas
 * @param {(number|null)[]} serie
 * @returns {PuntoLinea[]}
 */
export function linea(velas, serie) {
  /** @type {PuntoLinea[]} */
  const puntos = []
  serie.forEach((valor, i) => {
    if (valor !== null) puntos.push({ time: aSegundos(velas[i].inicio), value: valor })
  })
  return puntos
}

/**
 * EMA20/50/200 y RSI14 de Wilder sobre los cierres (las de la señal, spec §6.1).
 * @param {Vela[]} velas
 */
export function indicadoresDe(velas) {
  const cierres = velas.map((v) => v.cierre)
  return {
    ema20: linea(velas, ema(cierres, 20)),
    ema50: linea(velas, ema(cierres, 50)),
    ema200: linea(velas, ema(cierres, 200)),
    rsi: linea(velas, rsi(cierres, 14)),
  }
}

/**
 * Curva del bot y de comprar y mantener. Tiempos estrictamente crecientes (si se repite un segundo,
 * gana el último punto) y HODL ausente (null) sin punto.
 * @param {{ t: number, valor: number, hodl: number|null }[]} puntos
 */
export function curvaComparada(puntos) {
  /** @type {Map<number, { valor: number, hodl: number|null }>} */
  const porTiempo = new Map()
  for (const p of puntos) porTiempo.set(aSegundos(p.t), { valor: p.valor, hodl: p.hodl })
  const tiempos = [...porTiempo.keys()].sort((a, b) => a - b)
  /** @type {PuntoLinea[]} */ const bot = []
  /** @type {PuntoLinea[]} */ const hodl = []
  for (const time of tiempos) {
    const p = /** @type {{ valor: number, hodl: number|null }} */ (porTiempo.get(time))
    bot.push({ time, value: p.valor })
    if (p.hodl !== null && Number.isFinite(p.hodl)) hodl.push({ time, value: p.hodl })
  }
  return { bot, hodl }
}

/** @type {Record<number, Intl.DateTimeFormat>} */
const TICKS = {
  0: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, year: 'numeric' }),
  1: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, month: 'short' }),
  2: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, day: 'numeric' }),
  3: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }),
  4: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
}

/**
 * Etiqueta del eje de tiempo en hora de Madrid (la librería pinta UTC por defecto).
 * tipo = TickMarkType de lightweight-charts: 0 año, 1 mes, 2 día, 3 hora, 4 hora con segundos.
 * @param {number} segundos
 * @param {number} tipo
 */
export const etiquetaTick = (segundos, tipo) => (TICKS[tipo] ?? TICKS[3]).format(segundos * 1000)

/**
 * Puntos { t (ms), valor } → línea del gráfico en segundos estrictamente crecientes (si se repite un segundo,
 * gana el último punto). Descarta puntos sin número.
 * @param {{ t: number, valor: number }[]} puntos
 * @returns {PuntoLinea[]}
 */
function lineaDeCurva(puntos) {
  /** @type {Map<number, number>} */
  const porTiempo = new Map()
  for (const p of puntos) if (Number.isFinite(p?.t) && Number.isFinite(p?.valor)) porTiempo.set(aSegundos(p.t), p.valor)
  return [...porTiempo.keys()].sort((a, b) => a - b).map((time) => ({ time, value: /** @type {number} */ (porTiempo.get(time)) }))
}

/**
 * Curvas de GET /api/bot/comparativa para el gráfico: una línea por simulación (en el orden de la API) y la de
 * comprar y mantener.
 * @param {{ simulaciones?: { estrategiaVersion: string, etiqueta?: string, curva?: { t: number, valor: number }[] }[],
 *   hodl?: { t: number, valor: number }[] }} c
 * @returns {{ estrategias: { etiqueta: string, puntos: PuntoLinea[] }[], hodl: PuntoLinea[] }}
 */
export function curvasComparativa(c) {
  return {
    estrategias: (c.simulaciones ?? []).map((s) => ({ etiqueta: s.etiqueta || s.estrategiaVersion, puntos: lineaDeCurva(s.curva ?? []) })),
    hodl: lineaDeCurva(c.hodl ?? []),
  }
}

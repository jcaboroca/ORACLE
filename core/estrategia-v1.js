// @ts-check
// Estrategia v1: puntuación determinista → COMPRAR / MANTENER / VENDER.
// Cualquier cambio de parámetros exige una VERSION nueva.
import { atr, bollinger, ema, macd, rsi, ultimo } from './indicadores.js'
import { HORA, cerradasHasta, esFresca } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {'alcista'|'bajista'|'lateral'} Tendencia */
/** @typedef {'COMPRAR'|'MANTENER'|'VENDER'|'SIN_DATOS'} Veredicto */
/**
 * @typedef {{ funding: number|null, ratioLongShort: number|null,
 *   oiCambio24h: number|null, precioCambio24h: number|null }} Derivados
 * funding en fracción por 8 h (0.0001 = 0,01 %); cambios en fracción (0.03 = 3 %).
 */
/**
 * @typedef {{ id: string, origen: 'rss'|'reddit', publicadoEn: number,
 *   monedas: string[], puntuacion: number|null }} Titular
 * monedas: símbolos afectados o ['MERCADO'].
 */

export const VERSION = 'v1'

/** Parámetros del bot de paper trading con esta estrategia (§7.1). */
export const PARAMETROS_BOT = Object.freeze({
  comision: 0.001,
  deslizamiento: 0.0005,
  confianzaMinima: 0.6,
  fraccionPosicion: 0.2,
  ordenMinima: 10,
  multStopLoss: 1.5,
  multTakeProfit: 2.5,
  enfriamientoHoras: 4,
})

export const PARAMETROS = Object.freeze({
  pesos: Object.freeze({ tecnico: 0.6, derivados: 0.2, noticias: 0.15, fng: 0.05 }),
  pesosTimeframe: Object.freeze({ '1d': 0.5, '4h': 0.3, '1h': 0.2 }),
  pesosSub: Object.freeze({ tendencia: 0.35, ema200: 0.15, rsi: 0.25, macd: 0.15, bollinger: 0.1 }),
  umbralTendencia: 0.02,
  umbralCompra: 0.35,
  umbralVenta: -0.35,
  contradiccion: Object.freeze({ tecnico: 0.3, derivados: 0.5 }),
  velasMinimas: 200,
  noticias: Object.freeze({ ventanaHoras: 24, tauHoras: 12, minimo: 3, factorMercado: 0.5, factorReddit: 0.5 }),
  fng: Object.freeze({ miedo: 20, codicia: 80, valor: 0.5 }),
})

/** @param {number} x @param {number} min @param {number} max */
const clamp = (x, min, max) => Math.min(max, Math.max(min, x))
/** @param {number} x */
const redondear = (x) => Math.round(x * 1e9) / 1e9

/** @param {number} d @returns {Tendencia} */
export function tendenciaDe(d) {
  if (d > PARAMETROS.umbralTendencia) return 'alcista'
  if (d < -PARAMETROS.umbralTendencia) return 'bajista'
  return 'lateral'
}

/** El RSI se lee según la tendencia: nunca suma por sí solo. @param {Tendencia} tendencia @param {number} valor */
export function puntuarRsi(tendencia, valor) {
  if (tendencia === 'alcista') return valor <= 45 ? 1 : valor >= 80 ? -0.3 : 0
  if (tendencia === 'bajista') return valor >= 55 ? -1 : valor <= 20 ? 0.3 : 0
  return valor <= 30 ? 1 : valor >= 70 ? -1 : 0
}

/** @param {number} previo histograma de la vela anterior @param {number} actual */
export function puntuarMacd(previo, actual) {
  if (previo <= 0 && actual > 0) return 1
  if (previo >= 0 && actual < 0) return -1
  return Math.sign(actual) * 0.5
}

/** @param {Tendencia} tendencia @param {number} pctB */
export function puntuarBollinger(tendencia, pctB) {
  if (tendencia !== 'lateral') return 0
  return pctB < 0 ? 1 : pctB > 1 ? -1 : 0
}

/**
 * @param {Vela[]} velas cerradas, de la más antigua a la más reciente
 */
export function analizarTimeframe(velas) {
  if (velas.length < PARAMETROS.velasMinimas) return null
  const cierres = velas.map((v) => v.cierre)
  const precio = ultimo(cierres)
  const ema20 = /** @type {number} */ (ultimo(ema(cierres, 20)))
  const ema50 = /** @type {number} */ (ultimo(ema(cierres, 50)))
  const ema200 = /** @type {number} */ (ultimo(ema(cierres, 200)))
  const valorRsi = /** @type {number} */ (ultimo(rsi(cierres, 14)))
  const { histograma } = macd(cierres)
  const hist = /** @type {number} */ (histograma[histograma.length - 1])
  const histPrevio = /** @type {number} */ (histograma[histograma.length - 2])
  const pctB = /** @type {number} */ (ultimo(bollinger(cierres, 20, 2).pctB))
  const d = (ema20 - ema50) / ema50
  const tendencia = tendenciaDe(d)
  const subs = {
    tendencia: clamp(d / PARAMETROS.umbralTendencia, -1, 1),
    ema200: precio > ema200 ? 1 : precio < ema200 ? -1 : 0,
    rsi: puntuarRsi(tendencia, valorRsi),
    macd: puntuarMacd(histPrevio, hist),
    bollinger: puntuarBollinger(tendencia, pctB),
  }
  const p = PARAMETROS.pesosSub
  const puntuacion = clamp(
    p.tendencia * subs.tendencia + p.ema200 * subs.ema200 + p.rsi * subs.rsi
      + p.macd * subs.macd + p.bollinger * subs.bollinger,
    -1, 1,
  )
  return { tendencia, d, precio, ema20, ema50, ema200, rsi: valorRsi, macdHist: hist, pctB, subs, puntuacion: redondear(puntuacion) }
}

/** @param {Derivados|null} der */
export function puntuarDerivados(der) {
  if (!der) return { puntuacion: null, subs: {} }
  /** @type {Record<string, number>} */
  const subs = {}
  const { funding, ratioLongShort, oiCambio24h, precioCambio24h } = der
  if (funding !== null) {
    subs.funding = funding > 0.0005 ? -1 : funding > 0.0003 ? -0.5 : funding < -0.0005 ? 1 : funding < -0.0003 ? 0.5 : 0
  }
  if (ratioLongShort !== null) {
    subs.longShort = ratioLongShort > 2 ? -0.5 : ratioLongShort < 0.7 ? 0.5 : 0
  }
  if (oiCambio24h !== null && precioCambio24h !== null) {
    subs.openInterest = oiCambio24h >= 0.03 && precioCambio24h >= 0.01 ? 0.5
      : oiCambio24h >= 0.03 && precioCambio24h <= -0.01 ? -0.5 : 0
  }
  /** @type {Record<string, number>} */
  const pesos = { funding: 0.4, longShort: 0.3, openInterest: 0.3 }
  const claves = Object.keys(subs)
  if (claves.length === 0) return { puntuacion: null, subs }
  const sumaPesos = claves.reduce((s, k) => s + pesos[k], 0)
  const puntuacion = claves.reduce((s, k) => s + pesos[k] * subs[k], 0) / sumaPesos
  return { puntuacion: redondear(puntuacion), subs }
}

/**
 * @param {Titular[]} titulares
 * @param {string} simbolo
 * @param {number} ahora
 */
export function puntuarNoticias(titulares, simbolo, ahora) {
  const p = PARAMETROS.noticias
  let suma = 0
  let sumaPesos = 0
  /** @type {string[]} */
  const usados = []
  for (const t of titulares) {
    if (t.puntuacion === null) continue
    const edadHoras = (ahora - t.publicadoEn) / HORA
    if (edadHoras < 0 || edadHoras > p.ventanaHoras) continue
    const propia = t.monedas.includes(simbolo)
    if (!propia && !t.monedas.includes('MERCADO')) continue
    let w = Math.exp(-edadHoras / p.tauHoras)
    if (!propia) w *= p.factorMercado
    if (t.origen === 'reddit') w *= p.factorReddit
    suma += w * t.puntuacion
    sumaPesos += w
    usados.push(t.id)
  }
  if (usados.length < p.minimo) return { puntuacion: null, usados }
  return { puntuacion: redondear(suma / sumaPesos), usados }
}

/** @param {number|null} valor índice Fear & Greed 0-100 */
export function puntuarFng(valor) {
  if (valor === null) return null
  const p = PARAMETROS.fng
  return valor < p.miedo ? p.valor : valor > p.codicia ? -p.valor : 0
}

/**
 * Combina componentes presentes (null = ausente) en un veredicto.
 * @param {{ tecnico: number, derivados: number|null, noticias: number|null,
 *   fng: number|null, alineacion: boolean }} c
 */
export function combinar(c) {
  /** @type {Record<string, number|null>} */
  const valores = { tecnico: c.tecnico, derivados: c.derivados, noticias: c.noticias, fng: c.fng }
  /** @type {Record<string, number>} */
  const pesos = PARAMETROS.pesos
  const presentes = Object.keys(valores).filter((k) => valores[k] !== null)
  const ausentes = Object.keys(valores).filter((k) => valores[k] === null)
  const sumaPesos = presentes.reduce((s, k) => s + pesos[k], 0)
  const puntuacion = redondear(presentes.reduce((s, k) => s + pesos[k] * /** @type {number} */ (valores[k]), 0) / sumaPesos)
  const indiceConfianza = redondear(Math.min(0.95, 0.4 + 0.5 * Math.abs(puntuacion) + (c.alineacion ? 0.1 : 0)))
  const { contradiccion } = PARAMETROS
  /** @type {Veredicto} */
  let veredicto = 'MANTENER'
  /** @type {string|null} */
  let motivo = null
  if (c.derivados !== null && Math.sign(c.tecnico) !== Math.sign(c.derivados)
    && Math.abs(c.tecnico) >= contradiccion.tecnico && Math.abs(c.derivados) >= contradiccion.derivados) {
    motivo = 'contradiccion_tecnico_derivados'
  } else if (puntuacion >= PARAMETROS.umbralCompra) {
    veredicto = 'COMPRAR'
  } else if (puntuacion <= PARAMETROS.umbralVenta) {
    veredicto = 'VENDER'
  }
  return { veredicto, puntuacion, indiceConfianza, motivo, ausentes }
}

/**
 * Señal completa de una moneda en el instante `ahora`. Solo usa velas cerradas.
 * @param {{ simbolo: string, ahora: number,
 *   velas: { '1h': Vela[], '4h': Vela[], '1d': Vela[] },
 *   derivados: Derivados|null, titulares: Titular[], fng: number|null }} entrada
 */
export function calcularSenal({ simbolo, ahora, velas, derivados, titulares, fng }) {
  const cerradas = {
    '1h': cerradasHasta(velas['1h'], ahora),
    '4h': cerradasHasta(velas['4h'], ahora),
    '1d': cerradasHasta(velas['1d'], ahora),
  }
  const timeframes = {
    '1h': analizarTimeframe(cerradas['1h']),
    '4h': analizarTimeframe(cerradas['4h']),
    '1d': analizarTimeframe(cerradas['1d']),
  }
  const ultima1h = cerradas['1h'][cerradas['1h'].length - 1]
  const base = {
    version: VERSION,
    simbolo,
    calculadaEn: ahora,
    vela1h: ultima1h ? ultima1h.inicio : null,
    precio: ultima1h ? ultima1h.cierre : null,
    fresca: esFresca(cerradas['1h'], ahora),
  }
  if (!timeframes['1h'] || !timeframes['4h'] || !timeframes['1d']) {
    return {
      ...base,
      veredicto: /** @type {Veredicto} */ ('SIN_DATOS'),
      puntuacion: null,
      indiceConfianza: null,
      alineacion: false,
      atrPct: null,
      motivo: 'velas_insuficientes',
      componentes: { tecnico: null, derivados: null, noticias: null, fng: null },
      ausentes: ['tecnico'],
      detalle: { timeframes, derivados: {}, noticias: [], fng },
    }
  }
  const tf = /** @type {Record<'1h'|'4h'|'1d', NonNullable<ReturnType<typeof analizarTimeframe>>>} */ (timeframes)
  const pt = PARAMETROS.pesosTimeframe
  const tecnico = redondear(pt['1d'] * tf['1d'].puntuacion + pt['4h'] * tf['4h'].puntuacion + pt['1h'] * tf['1h'].puntuacion)
  const tendencias = [tf['1h'].tendencia, tf['4h'].tendencia, tf['1d'].tendencia]
  const alineacion = tendencias.filter((t) => t === 'alcista').length >= 2
    || tendencias.filter((t) => t === 'bajista').length >= 2
  const atr4h = /** @type {number} */ (ultimo(atr(cerradas['4h'], 14)))
  const atrPct = atr4h / ultimo(cerradas['4h']).cierre
  const der = puntuarDerivados(derivados)
  const not = puntuarNoticias(titulares, simbolo, ahora)
  const valorFng = puntuarFng(fng)
  const resultado = combinar({ tecnico, derivados: der.puntuacion, noticias: not.puntuacion, fng: valorFng, alineacion })
  return {
    ...base,
    ...resultado,
    alineacion,
    atrPct,
    componentes: { tecnico, derivados: der.puntuacion, noticias: not.puntuacion, fng: valorFng },
    detalle: { timeframes, derivados: der.subs, noticias: not.usados, fng },
  }
}

// @ts-check
// Gráficos con TradingView Lightweight Charts v5 (vendor/, global LightweightCharts). Solo dibuja:
// los datos llegan ya preparados por series.js.
import { fechaHora } from './formato.js'
import { datosVelas, etiquetaTick, formatoNumero, formatoPrecio } from './series.js'

/** Aviso de atribución del archivo NOTICE de la librería (Apache-2.0) y enlace exigido por su licencia. */
export const ATRIBUCION = Object.freeze({
  producto: 'TradingView Lightweight Charts™',
  copyright: 'Copyright (с) 2025 TradingView, Inc.',
  url: 'https://www.tradingview.com/',
})

export const COLORES = Object.freeze({
  fondo: '#0b0f17', texto: '#c9d1d9', rejilla: '#1b2433', sube: '#2dd4bf', baja: '#f87171',
  ema20: '#f2c14e', ema50: '#60a5fa', ema200: '#c084fc', rsi: '#e5e7eb', guia: '#6b7280', bot: '#2dd4bf', hodl: '#f2c14e',
})

/** @returns {any} */
function libreria() {
  const L = /** @type {any} */ (globalThis).LightweightCharts
  if (!L) throw new Error('No se pudo cargar la librería de gráficos.')
  return L
}

function opcionesBase() {
  return {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: COLORES.fondo }, textColor: COLORES.texto,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', attributionLogo: true,
    },
    grid: { vertLines: { color: COLORES.rejilla }, horzLines: { color: COLORES.rejilla } },
    localization: { locale: 'es-ES', timeFormatter: (/** @type {number} */ t) => fechaHora(t * 1000) },
    timeScale: { timeVisible: true, secondsVisible: false, borderVisible: false, tickMarkFormatter: etiquetaTick },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 },
  }
}

const LINEA = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }

/**
 * Velas con EMA20/50/200 y, debajo, un panel de RSI14 con guías en 30 y 70.
 * @param {HTMLElement} contenedor
 * @param {{ velas: import('../core/velas.js').Vela[], indicadores: ReturnType<typeof import('./series.js').indicadoresDe> }} datos
 * @returns {() => void} limpieza
 */
export function graficoVelas(contenedor, { velas, indicadores }) {
  const L = libreria()
  const grafico = L.createChart(contenedor, opcionesBase())
  const velasSerie = grafico.addSeries(L.CandlestickSeries, {
    upColor: COLORES.sube, downColor: COLORES.baja, borderVisible: false,
    wickUpColor: COLORES.sube, wickDownColor: COLORES.baja, priceFormat: formatoPrecio(velas),
  })
  velasSerie.setData(datosVelas(velas))
  for (const clave of /** @type {const} */ (['ema20', 'ema50', 'ema200'])) {
    grafico.addSeries(L.LineSeries, { ...LINEA, color: COLORES[clave] }).setData(indicadores[clave])
  }
  const rsi = grafico.addSeries(L.LineSeries, { ...LINEA, color: COLORES.rsi, lastValueVisible: true, priceFormat: formatoNumero(0) }, 1)
  rsi.setData(indicadores.rsi)
  for (const precio of [30, 70]) rsi.createPriceLine({ price: precio, color: COLORES.guia, lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
  grafico.panes()[1]?.setHeight(110)
  const n = velas.length
  grafico.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 2 })
  return () => grafico.remove()
}

/**
 * Curva del bot frente a comprar y mantener.
 * @param {HTMLElement} contenedor
 * @param {ReturnType<typeof import('./series.js').curvaComparada>} curva
 * @returns {() => void} limpieza
 */
export function graficoCurva(contenedor, curva) {
  const L = libreria()
  const grafico = L.createChart(contenedor, opcionesBase())
  const euros = formatoNumero(0)
  grafico.addSeries(L.LineSeries, { lineWidth: 2, color: COLORES.hodl, priceLineVisible: false, priceFormat: euros, title: 'Comprar y mantener' }).setData(curva.hodl)
  grafico.addSeries(L.LineSeries, { lineWidth: 2, color: COLORES.bot, priceLineVisible: false, priceFormat: euros, title: 'Bot' }).setData(curva.bot)
  grafico.timeScale().fitContent()
  return () => grafico.remove()
}

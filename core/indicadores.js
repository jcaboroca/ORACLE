// @ts-check
// Indicadores técnicos puros. Todas las series devuelven un array de la misma
// longitud que la entrada, con null donde aún no hay datos suficientes.

/** @typedef {(number|null)[]} Serie */

/**
 * @param {number[]} valores
 * @param {number} n
 * @returns {Serie}
 */
export function sma(valores, n) {
  /** @type {Serie} */
  const salida = new Array(valores.length).fill(null)
  let suma = 0
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i]
    if (i >= n) suma -= valores[i - n]
    if (i >= n - 1) salida[i] = suma / n
  }
  return salida
}

/**
 * EMA sembrada con la SMA de los primeros n valores.
 * @param {number[]} valores
 * @param {number} n
 * @returns {Serie}
 */
export function ema(valores, n) {
  /** @type {Serie} */
  const salida = new Array(valores.length).fill(null)
  if (valores.length < n) return salida
  const k = 2 / (n + 1)
  let previo = 0
  for (let i = 0; i < n; i++) previo += valores[i]
  previo /= n
  salida[n - 1] = previo
  for (let i = n; i < valores.length; i++) {
    previo = valores[i] * k + previo * (1 - k)
    salida[i] = previo
  }
  return salida
}

/**
 * RSI de Wilder.
 * @param {number[]} cierres
 * @param {number} [n]
 * @returns {Serie}
 */
export function rsi(cierres, n = 14) {
  /** @type {Serie} */
  const salida = new Array(cierres.length).fill(null)
  if (cierres.length <= n) return salida
  let ganancia = 0
  let perdida = 0
  for (let i = 1; i <= n; i++) {
    const cambio = cierres[i] - cierres[i - 1]
    if (cambio > 0) ganancia += cambio
    else perdida -= cambio
  }
  ganancia /= n
  perdida /= n
  salida[n] = valorRsi(ganancia, perdida)
  for (let i = n + 1; i < cierres.length; i++) {
    const cambio = cierres[i] - cierres[i - 1]
    ganancia = (ganancia * (n - 1) + Math.max(cambio, 0)) / n
    perdida = (perdida * (n - 1) + Math.max(-cambio, 0)) / n
    salida[i] = valorRsi(ganancia, perdida)
  }
  return salida
}

/**
 * @param {number} ganancia
 * @param {number} perdida
 */
function valorRsi(ganancia, perdida) {
  if (perdida === 0) return ganancia === 0 ? 50 : 100
  return 100 - 100 / (1 + ganancia / perdida)
}

/**
 * @param {number[]} cierres
 * @param {number} [rapida]
 * @param {number} [lenta]
 * @param {number} [senal]
 * @returns {{ macd: Serie, senal: Serie, histograma: Serie }}
 */
export function macd(cierres, rapida = 12, lenta = 26, senal = 9) {
  const emaRapida = ema(cierres, rapida)
  const emaLenta = ema(cierres, lenta)
  /** @type {Serie} */
  const lineaMacd = cierres.map((_, i) => {
    const r = emaRapida[i]
    const l = emaLenta[i]
    return r === null || l === null ? null : r - l
  })
  const inicio = lineaMacd.findIndex((v) => v !== null)
  /** @type {Serie} */
  const lineaSenal = new Array(cierres.length).fill(null)
  if (inicio >= 0) {
    const tramo = /** @type {number[]} */ (lineaMacd.slice(inicio))
    const emaTramo = ema(tramo, senal)
    emaTramo.forEach((v, j) => { lineaSenal[inicio + j] = v })
  }
  /** @type {Serie} */
  const histograma = lineaMacd.map((m, i) => {
    const s = lineaSenal[i]
    return m === null || s === null ? null : m - s
  })
  return { macd: lineaMacd, senal: lineaSenal, histograma }
}

/**
 * Bandas de Bollinger con desviación típica poblacional.
 * @param {number[]} cierres
 * @param {number} [n]
 * @param {number} [k]
 * @returns {{ media: Serie, superior: Serie, inferior: Serie, pctB: Serie }}
 */
export function bollinger(cierres, n = 20, k = 2) {
  const media = sma(cierres, n)
  /** @type {Serie} */ const superior = new Array(cierres.length).fill(null)
  /** @type {Serie} */ const inferior = new Array(cierres.length).fill(null)
  /** @type {Serie} */ const pctB = new Array(cierres.length).fill(null)
  for (let i = n - 1; i < cierres.length; i++) {
    const m = /** @type {number} */ (media[i])
    let varianza = 0
    for (let j = i - n + 1; j <= i; j++) varianza += (cierres[j] - m) ** 2
    const desviacion = Math.sqrt(varianza / n)
    superior[i] = m + k * desviacion
    inferior[i] = m - k * desviacion
    const ancho = 2 * k * desviacion
    // ventana plana: tolera la deriva de coma flotante de la media con precios decimales
    const plana = desviacion <= 1e-12 * Math.abs(m)
    pctB[i] = plana ? 0.5 : (cierres[i] - (m - k * desviacion)) / ancho
  }
  return { media, superior, inferior, pctB }
}

/**
 * ATR de Wilder.
 * @param {{ maximo: number, minimo: number, cierre: number }[]} velas
 * @param {number} [n]
 * @returns {Serie}
 */
export function atr(velas, n = 14) {
  /** @type {Serie} */
  const salida = new Array(velas.length).fill(null)
  if (velas.length <= n) return salida
  const rangos = velas.map((v, i) => {
    if (i === 0) return v.maximo - v.minimo
    const previo = velas[i - 1].cierre
    return Math.max(v.maximo - v.minimo, Math.abs(v.maximo - previo), Math.abs(v.minimo - previo))
  })
  let actual = 0
  for (let i = 1; i <= n; i++) actual += rangos[i]
  actual /= n
  salida[n] = actual
  for (let i = n + 1; i < velas.length; i++) {
    actual = (actual * (n - 1) + rangos[i]) / n
    salida[i] = actual
  }
  return salida
}

/**
 * @template T
 * @param {T[]} serie
 * @returns {T}
 */
export function ultimo(serie) {
  return serie[serie.length - 1]
}

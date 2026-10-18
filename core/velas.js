// @ts-check

export const HORA = 3_600_000
export const DURACION = /** @type {const} */ ({ '1h': HORA, '4h': 4 * HORA, '1d': 24 * HORA })
/**
 * Velas cerradas por temporalidad (1h/4h/1d USDT) que ve la estrategia, igual en el Worker y en el backtest.
 * OKX sirve como mucho 300 velas por petición, incluida la que sigue abierta: quedan 299 cerradas.
 */
export const VENTANA = 299

/**
 * @typedef {{ inicio: number, fin: number, apertura: number, maximo: number,
 *   minimo: number, cierre: number, volumen: number }} Vela
 * `fin` es el instante exacto de cierre (inicio + duración), no el ms anterior.
 */

/**
 * Convierte filas de /api/v3/klines de Binance en velas.
 * @param {unknown[][]} filas
 * @returns {Vela[]}
 */
export function desdeBinance(filas) {
  return filas.map((f) => ({
    inicio: Number(f[0]),
    fin: Number(f[6]) + 1,
    apertura: Number(f[1]),
    maximo: Number(f[2]),
    minimo: Number(f[3]),
    cierre: Number(f[4]),
    volumen: Number(f[5]),
  }))
}

/**
 * Velas ya cerradas en el instante `t` (nunca información futura).
 * @param {Vela[]} velas
 * @param {number} t
 */
export function cerradasHasta(velas, t) {
  let n = velas.length
  while (n > 0 && velas[n - 1].fin > t) n--
  return n === velas.length ? velas : velas.slice(0, n)
}

/**
 * La última vela 1H cerrada es la de la hora inmediatamente anterior a `ahora`.
 * @param {Vela[]} velas1hCerradas
 * @param {number} ahora
 */
export function esFresca(velas1hCerradas, ahora) {
  const ultima = velas1hCerradas[velas1hCerradas.length - 1]
  return ultima !== undefined && ahora - ultima.fin < HORA
}

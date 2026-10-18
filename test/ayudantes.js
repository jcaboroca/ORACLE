// @ts-check
// Generadores de datos de prueba. Solo para tests: ORACLE nunca inventa precios en producción.
import { HORA } from '../core/velas.js'

/**
 * Serie de velas a partir de una función de cierre.
 * @param {number} n
 * @param {(i: number) => number} cierre
 * @param {{ duracion?: number, inicio?: number, rango?: number }} [op]
 * @returns {import('../core/velas.js').Vela[]}
 */
export function serie(n, cierre, { duracion = HORA, inicio = 0, rango = 0.01 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const c = cierre(i)
    const apertura = i === 0 ? c : cierre(i - 1)
    return {
      inicio: inicio + i * duracion,
      fin: inicio + (i + 1) * duracion,
      apertura,
      maximo: Math.max(apertura, c) * (1 + rango),
      minimo: Math.min(apertura, c) * (1 - rango),
      cierre: c,
      volumen: 1,
    }
  })
}

/**
 * Vela suelta con OHLC explícitos.
 * @param {number} inicio
 * @param {{ o: number, h: number, l: number, c: number }} ohlc
 */
export function vela(inicio, { o, h, l, c }) {
  return { inicio, fin: inicio + HORA, apertura: o, maximo: h, minimo: l, cierre: c, volumen: 1 }
}

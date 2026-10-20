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

/**
 * Entrada de señal para las familias diarias: velas 1D con los cierres dados (la última cierra en `fin`),
 * 24 velas 1H planas con el último cierre y el cron en `fin` + 3 min. Por defecto `fin` es el lunes
 * 2021-01-04 00:00 UTC.
 * @param {number[]} cierres
 * @param {{ fin?: number, rango?: number }} [op]
 */
export function entradaDiaria(cierres, { fin = Date.UTC(2021, 0, 4), rango = 0.01 } = {}) {
  const dia = 24 * HORA
  const diarias = serie(cierres.length, (i) => cierres[i], { duracion: dia, inicio: fin - cierres.length * dia, rango })
  const ultimo = cierres[cierres.length - 1]
  return {
    simbolo: 'BTC',
    ahora: fin + 3 * 60_000,
    velas: { '1h': serie(24, () => ultimo, { inicio: fin - 24 * HORA }), '4h': serie(0, () => 0), '1d': diarias },
    derivados: null,
    titulares: [],
    fng: null,
  }
}

/** Claves de toda señal (las de v1 sin datos): las familias devuelven exactamente las mismas. */
export const CLAVES_SENAL = Object.freeze([
  'alineacion', 'atrPct', 'ausentes', 'calculadaEn', 'componentes', 'detalle', 'fresca', 'indiceConfianza',
  'motivo', 'precio', 'puntuacion', 'simbolo', 'vela1h', 'veredicto', 'version',
])

// @ts-check
// Registro de estrategias. Cada simulación guarda su versión y la recupera con estrategia(version).
import * as v1 from './estrategia-v1.js'

export const ESTRATEGIAS = Object.freeze({ v1 })

/** Estrategia de las simulaciones nuevas y del backtest por defecto. */
export const ESTRATEGIA_ACTIVA = 'v1'

/**
 * @param {string} version p. ej. 'v1'
 * @returns {import('./hora.js').Estrategia}
 */
export function estrategia(version) {
  if (!Object.hasOwn(ESTRATEGIAS, version)) throw new RangeError(`Estrategia desconocida: ${version}`)
  return ESTRATEGIAS[/** @type {keyof typeof ESTRATEGIAS} */ (version)]
}

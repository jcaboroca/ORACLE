// @ts-check
// Registro de estrategias. Cada simulación guarda su versión y la recupera con estrategia(version).
import * as v1 from './estrategia-v1.js'
import * as v2 from './estrategia-v2.js'
import * as v3 from './estrategia-v3.js'
import * as v4 from './estrategia-v4.js'
import * as v5 from './estrategia-v5.js'

export const ESTRATEGIAS = Object.freeze({ v1, v2, v3, v4, v5 })

/**
 * Estrategias que el bot ejecuta en vivo, una simulación por cada una (spec del laboratorio §6): las 3 que
 * eligió el laboratorio (§9). v3 cumple el criterio; v4 y v5 son experimentales (no lo cumplen).
 */
export const ESTRATEGIAS_EN_VIVO = Object.freeze(['v3', 'v4', 'v5'])

/** La nº 1 del ranking del laboratorio: da el consejo del Panel. */
export const ESTRATEGIA_PRINCIPAL = 'v3'

/** Estrategia de las simulaciones nuevas y del backtest por defecto: la principal. */
export const ESTRATEGIA_ACTIVA = ESTRATEGIA_PRINCIPAL

/**
 * @param {string} version p. ej. 'v1'
 * @returns {import('./hora.js').Estrategia}
 */
export function estrategia(version) {
  if (!Object.hasOwn(ESTRATEGIAS, version)) throw new RangeError(`Estrategia desconocida: ${version}`)
  return ESTRATEGIAS[/** @type {keyof typeof ESTRATEGIAS} */ (version)]
}

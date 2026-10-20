// @ts-check
// Estrategias en vivo de prueba (solo tests): v1 y v2 reales más «v1b», la señal de v1 con otra versión, otra
// etiqueta y posiciones del 10 % en lugar del 20 %. Así se prueban 3 simulaciones antes de que existan v3–v5.
import * as v1 from '../../core/estrategia-v1.js'
import { estrategia } from '../../core/estrategias.js'
import { crearVivo } from '../src/vivo.js'

/** @type {import('../../core/hora.js').Estrategia & { ETIQUETA: string }} */
export const v1b = Object.freeze({
  VERSION: 'v1b',
  ETIQUETA: 'v1 al 10 %',
  PARAMETROS: v1.PARAMETROS,
  PARAMETROS_BOT: Object.freeze({ ...v1.PARAMETROS_BOT, fraccionPosicion: 0.1 }),
  calcularSenal: (entrada) => ({ ...v1.calcularSenal(entrada), version: 'v1b' }),
})

/**
 * @param {string[]} versiones p. ej. ['v1', 'v2', 'v1b']
 * @param {string} [principal] por defecto, la primera
 */
export const vivoDePrueba = (versiones, principal = versiones[0]) => crearVivo({
  versiones, principal, estrategia: (v) => (v === 'v1b' ? v1b : estrategia(v)),
})

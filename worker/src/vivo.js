// @ts-check
// Estrategias en vivo del bot (spec del laboratorio §6): una simulación activa por cada una de
// ESTRATEGIAS_EN_VIVO; la principal da el consejo del Panel y es la única con explicaciones del LLM.
// Inyectable en ejecutarMercado y en la API (tests con otras listas).
import { ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL, estrategia } from '../../core/estrategias.js'

/** @typedef {import('../../core/hora.js').Estrategia} Estrategia */
/**
 * @typedef {{ versiones: readonly string[], principal: string, estrategia: (version: string) => Estrategia }} Vivo
 * versiones: en el orden en que se ejecutan y se muestran; estrategia: módulo de cada versión (lanza si no existe).
 */

/**
 * Valida y congela una configuración: al menos una versión, sin repetidas, todas registradas y la principal entre ellas.
 * @param {Vivo} vivo
 * @returns {Vivo}
 */
export function crearVivo({ versiones, principal, estrategia: obtener }) {
  if (versiones.length === 0) throw new RangeError('No hay estrategias en vivo')
  if (new Set(versiones).size !== versiones.length) throw new RangeError(`Estrategias en vivo repetidas: ${versiones.join(', ')}`)
  for (const v of versiones) obtener(v)
  if (!versiones.includes(principal)) throw new RangeError(`La estrategia principal ${principal} no está en vivo`)
  return Object.freeze({ versiones: Object.freeze([...versiones]), principal, estrategia: obtener })
}

/** La configuración de producción: core/estrategias.js. */
export const VIVO = crearVivo({ versiones: ESTRATEGIAS_EN_VIVO, principal: ESTRATEGIA_PRINCIPAL, estrategia })

/**
 * Nombre para la interfaz: `ETIQUETA` del módulo si la exporta; si no (o si la versión ya no existe), la versión.
 * @param {Vivo} vivo @param {string} version
 */
export function etiquetaDe(vivo, version) {
  try {
    const modulo = /** @type {{ ETIQUETA?: unknown }} */ (vivo.estrategia(version))
    return typeof modulo.ETIQUETA === 'string' && modulo.ETIQUETA !== '' ? modulo.ETIQUETA : version
  } catch {
    return version
  }
}

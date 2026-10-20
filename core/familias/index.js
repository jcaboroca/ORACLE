// @ts-check
// Registro de las familias del laboratorio (spec del laboratorio §3): rejillas, vecinos de un paso y
// la clave que agrupa configuraciones con la misma señal.
import * as caidas from './caidas.js'
import * as cruce from './cruce.js'
import * as momentum from './momentum.js'
import * as ruptura from './ruptura.js'
import * as v1stops from './v1stops.js'

/**
 * @typedef {{ FAMILIA: string, EJES: Readonly<Record<string, readonly unknown[]>>, CLAVES_BOT: readonly string[],
 *   REJILLA: readonly Readonly<Record<string, unknown>>[],
 *   crear: (config: any, version: string) => import('../hora.js').Estrategia }} Familia
 */

/** En el orden de la spec: F1 … F5. */
export const FAMILIAS = Object.freeze(/** @type {Readonly<Record<string, Familia>>} */ ({ cruce, ruptura, momentum, caidas, v1stops }))

/** @param {string} nombre @returns {Familia} */
export function familia(nombre) {
  if (!Object.hasOwn(FAMILIAS, nombre)) throw new RangeError(`Familia desconocida: ${nombre}`)
  return FAMILIAS[nombre]
}

/** Todas las configuraciones del laboratorio, familia a familia. */
export function todasLasConfiguraciones() {
  return Object.values(FAMILIAS).flatMap((f) => f.REJILLA.map((config) => ({ familia: f.FAMILIA, config })))
}

/**
 * Configuraciones de la rejilla a un paso de `config`: iguales en todos los ejes salvo uno, y en ese eje
 * contiguas entre los valores que la rejilla tiene con el resto de ejes fijos.
 * @param {string} nombre
 * @param {Readonly<Record<string, unknown>>} config
 */
export function vecinos(nombre, config) {
  const f = familia(nombre)
  const ejes = Object.keys(f.EJES)
  /** @type {Readonly<Record<string, unknown>>[]} */
  const salida = []
  for (const eje of ejes) {
    const orden = f.EJES[eje]
    const mismaFila = f.REJILLA.filter((c) => ejes.every((e) => e === eje || c[e] === config[e]))
    const posiciones = mismaFila.map((c) => orden.indexOf(c[eje])).sort((a, b) => a - b)
    const aqui = posiciones.indexOf(orden.indexOf(config[eje]))
    for (const k of [aqui - 1, aqui + 1]) {
      if (aqui < 0 || k < 0 || k >= posiciones.length) continue
      const valor = orden[posiciones[k]]
      salida.push(/** @type {Readonly<Record<string, unknown>>} */ (mismaFila.find((c) => c[eje] === valor)))
    }
  }
  return salida
}

/**
 * Clave de señal: configuraciones con la misma clave dan exactamente la misma señal (solo cambia el bot).
 * @param {string} nombre
 * @param {Readonly<Record<string, unknown>>} config
 */
export function claveSenal(nombre, config) {
  const f = familia(nombre)
  const propia = Object.fromEntries(Object.entries(config).filter(([k]) => !f.CLAVES_BOT.includes(k)))
  return `${nombre}:${JSON.stringify(propia)}`
}

// @ts-check
// F2 Ruptura de Donchian 1D (spec del laboratorio §3): COMPRAR si el cierre supera el máximo de los N
// días previos, VENDER si cae por debajo del mínimo de los M días previos; MANTENER entre ambos.
import { PERIODO_ATR, enteroPositivo, parametrosBotDiarios, prepararDiario, senalFamilia, stopValido } from './comun.js'

export const FAMILIA = 'ruptura'

/** @typedef {{ entrada: number, salida: number, stop: number|null }} ConfigRuptura */

/** Valores por eje, en orden. La rejilla no es un producto: solo los pares (N, M) de la spec del laboratorio §3. */
export const EJES = Object.freeze({ entrada: [20, 40, 55, 100], salida: [10, 20, 40], stop: [null, 2.5] })
export const PARES = Object.freeze([[20, 10], [40, 20], [55, 20], [100, 40], [20, 20], [55, 40]])
/** Claves de la configuración que solo afectan al bot (no a la señal). */
export const CLAVES_BOT = Object.freeze(['stop'])
/** @type {readonly Readonly<ConfigRuptura>[]} */
export const REJILLA = Object.freeze(EJES.stop.flatMap((stop) => PARES.map(([entrada, salida]) => Object.freeze({ entrada, salida, stop }))))

/**
 * @param {ConfigRuptura} config entrada N y salida M en días previos (sin contar el de hoy); stop: × ATR14 1D o null
 * @param {string} version
 * @returns {import('../hora.js').Estrategia}
 */
export function crear(config, version) {
  const entrada = enteroPositivo(config.entrada, 'entrada')
  const salida = enteroPositivo(config.salida, 'salida')
  const stop = stopValido(config.stop)
  const necesarias = Math.max(entrada + 1, salida + 1, PERIODO_ATR + 1)
  return Object.freeze({
    VERSION: version,
    PARAMETROS: Object.freeze({ familia: FAMILIA, config: Object.freeze({ entrada, salida, stop }) }),
    PARAMETROS_BOT: parametrosBotDiarios(stop),
    /** @param {import('../hora.js').EntradaSenal} e */
    calcularSenal(e) {
      const preparado = prepararDiario(version, e)
      const { diarias } = preparado
      if (diarias.length < necesarias) return senalFamilia(preparado, FAMILIA, null)
      const n = diarias.length
      const cierre = diarias[n - 1].cierre
      let maximoPrevio = -Infinity
      for (let i = n - 1 - entrada; i < n - 1; i++) maximoPrevio = Math.max(maximoPrevio, diarias[i].maximo)
      let minimoPrevio = Infinity
      for (let i = n - 1 - salida; i < n - 1; i++) minimoPrevio = Math.min(minimoPrevio, diarias[i].minimo)
      const veredicto = cierre > maximoPrevio ? 'COMPRAR' : cierre < minimoPrevio ? 'VENDER' : 'MANTENER'
      return senalFamilia(preparado, FAMILIA, { veredicto, indicadores: { cierre, maximoPrevio, minimoPrevio } })
    },
  })
}

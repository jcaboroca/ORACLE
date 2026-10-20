// @ts-check
// F1 Cruce de medias 1D (spec del laboratorio §3): COMPRAR mientras la EMA rápida está por encima
// de la lenta, VENDER mientras está por debajo. Decide al cierre diario con velas 1D cerradas.
import { ema, ultimo } from '../indicadores.js'
import { PERIODO_ATR, enteroPositivo, parametrosBotDiarios, prepararDiario, senalFamilia, stopValido } from './comun.js'

export const FAMILIA = 'cruce'

/** @typedef {{ rapida: number, lenta: number, stop: number|null }} ConfigCruce */

/** Valores de la rejilla por eje, en orden (un paso = valores contiguos). Spec del laboratorio §3. */
export const EJES = Object.freeze({ rapida: [10, 20, 30], lenta: [50, 100, 200], stop: [null, 2.5] })
/** Claves de la configuración que solo afectan al bot (no a la señal). */
export const CLAVES_BOT = Object.freeze(['stop'])
/** @type {readonly Readonly<ConfigCruce>[]} */
export const REJILLA = Object.freeze(EJES.stop.flatMap((stop) => EJES.rapida.flatMap((rapida) =>
  EJES.lenta.map((lenta) => Object.freeze({ rapida, lenta, stop })))))

/**
 * @param {ConfigCruce} config rapida/lenta: periodos de las EMA 1D; stop: × ATR14 1D o null
 * @param {string} version
 * @returns {import('../hora.js').Estrategia}
 */
export function crear(config, version) {
  const rapida = enteroPositivo(config.rapida, 'rapida')
  const lenta = enteroPositivo(config.lenta, 'lenta')
  if (rapida >= lenta) throw new RangeError(`la EMA rápida (${rapida}) debe ser más corta que la lenta (${lenta})`)
  const stop = stopValido(config.stop)
  const necesarias = Math.max(lenta, PERIODO_ATR + 1)
  return Object.freeze({
    VERSION: version,
    PARAMETROS: Object.freeze({ familia: FAMILIA, config: Object.freeze({ rapida, lenta, stop }) }),
    PARAMETROS_BOT: parametrosBotDiarios(stop),
    /** @param {import('../hora.js').EntradaSenal} entrada */
    calcularSenal(entrada) {
      const preparado = prepararDiario(version, entrada)
      if (preparado.diarias.length < necesarias) return senalFamilia(preparado, FAMILIA, null)
      const cierres = preparado.diarias.map((v) => v.cierre)
      const emaRapida = /** @type {number} */ (ultimo(ema(cierres, rapida)))
      const emaLenta = /** @type {number} */ (ultimo(ema(cierres, lenta)))
      const veredicto = emaRapida > emaLenta ? 'COMPRAR' : emaRapida < emaLenta ? 'VENDER' : 'MANTENER'
      return senalFamilia(preparado, FAMILIA, { veredicto, indicadores: { emaRapida, emaLenta } })
    },
  })
}

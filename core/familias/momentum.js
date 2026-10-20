// @ts-check
// F3 Momentum 1D (spec del laboratorio §3): COMPRAR si la rentabilidad de los últimos L días es > 0,
// VENDER si es ≤ 0. Revisión diaria o semanal (solo los lunes a las 00:03 UTC, con el cierre del domingo).
import { PERIODO_ATR, VARIANTE_SOLO_TECNICO, enteroPositivo, parametrosBotDiarios, prepararDiario, senalFamilia, stopValido } from './comun.js'

export const FAMILIA = 'momentum'
export const REVISIONES = Object.freeze(['diaria', 'semanal'])

/** @typedef {{ dias: number, revision: 'diaria'|'semanal', stop: number|null }} ConfigMomentum */

/** Valores de la rejilla por eje, en orden (un paso = valores contiguos). Spec del laboratorio §3. */
export const EJES = Object.freeze({ dias: [30, 60, 90, 120, 180], revision: REVISIONES, stop: [null, 2.5] })
/** Claves de la configuración que solo afectan al bot (no a la señal). */
export const CLAVES_BOT = Object.freeze(['stop'])
/** @type {readonly Readonly<ConfigMomentum>[]} */
export const REJILLA = Object.freeze(EJES.stop.flatMap((stop) => EJES.dias.flatMap((dias) =>
  REVISIONES.map((revision) => Object.freeze({ dias, revision: /** @type {'diaria'|'semanal'} */ (revision), stop })))))

/**
 * @param {ConfigMomentum} config dias: L; revision: 'diaria' | 'semanal'; stop: × ATR14 1D o null
 * @param {string} version
 * @returns {import('../hora.js').Estrategia}
 */
export function crear(config, version) {
  const dias = enteroPositivo(config.dias, 'dias')
  const { revision } = config
  if (!REVISIONES.includes(revision)) throw new RangeError(`revision debe ser diaria o semanal: ${revision}`)
  const stop = stopValido(config.stop)
  const necesarias = Math.max(dias + 1, PERIODO_ATR + 1)
  return Object.freeze({
    VERSION: version,
    VARIANTE_BACKTEST: VARIANTE_SOLO_TECNICO,
    PARAMETROS: Object.freeze({ familia: FAMILIA, config: Object.freeze({ dias, revision, stop }) }),
    PARAMETROS_BOT: parametrosBotDiarios(stop),
    /** @param {import('../hora.js').EntradaSenal} e */
    calcularSenal(e) {
      const preparado = prepararDiario(version, e)
      const { diarias } = preparado
      if (diarias.length < necesarias) return senalFamilia(preparado, FAMILIA, null)
      const n = diarias.length
      const rentabilidad = diarias[n - 1].cierre / diarias[n - 1 - dias].cierre - 1
      const indicadores = { rentabilidad }
      if (revision === 'semanal' && new Date(e.ahora).getUTCDay() !== 1) {
        return senalFamilia(preparado, FAMILIA, { veredicto: 'MANTENER', motivo: 'fuera_de_revision', indicadores })
      }
      return senalFamilia(preparado, FAMILIA, { veredicto: rentabilidad > 0 ? 'COMPRAR' : 'VENDER', indicadores })
    },
  })
}

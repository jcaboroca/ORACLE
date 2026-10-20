// @ts-check
// F5 v1 con stops amplios (spec del laboratorio §3): la señal de v1 decidiendo una vez al día (cierre 1D)
// con stop-loss de multStopLoss × ATR14 4H y take-profit de takeProfit × ATR14 4H (null = sin TP).
import * as v1 from '../estrategia-v1.js'

export const FAMILIA = 'v1stops'

/** @typedef {{ multStopLoss: number, takeProfit: number|null }} ConfigV1Stops */

/** Valores de la rejilla por eje, en orden (un paso = valores contiguos). Spec del laboratorio §3. */
export const EJES = Object.freeze({ multStopLoss: [2.5, 3.5], takeProfit: [4, null] })
/** Claves de la configuración que solo afectan al bot: aquí todas (la señal es la de v1). */
export const CLAVES_BOT = Object.freeze(['multStopLoss', 'takeProfit'])
/** @type {readonly Readonly<ConfigV1Stops>[]} */
export const REJILLA = Object.freeze(EJES.multStopLoss.flatMap((multStopLoss) =>
  EJES.takeProfit.map((takeProfit) => Object.freeze({ multStopLoss, takeProfit }))))

/**
 * @param {ConfigV1Stops} config
 * @param {string} version
 * @returns {import('../hora.js').Estrategia}
 */
export function crear(config, version) {
  const { multStopLoss, takeProfit } = config
  if (typeof multStopLoss !== 'number' || !(multStopLoss > 0)) throw new RangeError(`multStopLoss debe ser positivo: ${multStopLoss}`)
  if (takeProfit !== null && (typeof takeProfit !== 'number' || !(takeProfit > 0))) {
    throw new RangeError(`takeProfit debe ser null o positivo: ${takeProfit}`)
  }
  return Object.freeze({
    VERSION: version,
    PARAMETROS: Object.freeze({ familia: FAMILIA, config: Object.freeze({ multStopLoss, takeProfit }), senal: v1.PARAMETROS }),
    PARAMETROS_BOT: Object.freeze({
      ...v1.PARAMETROS_BOT,
      cadenciaHoras: 24,
      multStopLoss,
      multTakeProfit: takeProfit ?? v1.PARAMETROS_BOT.multTakeProfit,
      sinTakeProfit: takeProfit === null,
    }),
    /** @param {import('../hora.js').EntradaSenal} e */
    calcularSenal(e) {
      const s = v1.calcularSenal(e)
      return { ...s, version, detalle: { ...s.detalle, familia: FAMILIA } }
    },
  })
}

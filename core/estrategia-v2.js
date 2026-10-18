// @ts-check
// Estrategia v2: la puntuación de v1 + filtro de régimen (solo abre con el cierre 1D por encima de
// la EMA200 1D) y decisiones solo al cierre diario. Elegida con el protocolo walk-forward de la
// spec §6.6. Cualquier cambio de parámetros exige una VERSION nueva.
import * as v1 from './estrategia-v1.js'

export const VERSION = 'v2'

/** Parámetros de señal: los de v1 (mismos indicadores, pesos y umbrales) más el régimen. */
export const PARAMETROS = Object.freeze({
  ...v1.PARAMETROS,
  regimen: Object.freeze({ timeframe: '1d', periodoEma: 200 }),
})

/** Bot: los de v1 (SL 1,5×ATR4H y TP 2,5×ATR4H fijados al abrir) decidiendo solo cada 24 h. */
export const PARAMETROS_BOT = Object.freeze({
  ...v1.PARAMETROS_BOT,
  cadenciaHoras: 24,
})

/** @typedef {ReturnType<typeof v1.calcularSenal>} SenalV1 */

/**
 * Filtro de régimen sobre una señal calculada con la lógica de v1: un COMPRAR solo se mantiene si el
 * cierre de la última vela 1D supera su EMA200; si no, pasa a MANTENER con motivo 'filtro_regimen'.
 * VENDER, MANTENER y SIN_DATOS no cambian (salvo la versión). detalle.regimen: { sobreEma200 }, o null sin datos.
 * @param {SenalV1} senal
 */
export function aplicarRegimen(senal) {
  if (senal.veredicto === 'SIN_DATOS') return { ...senal, version: VERSION, detalle: { ...senal.detalle, regimen: null } }
  const diario = /** @type {NonNullable<SenalV1['detalle']['timeframes']['1d']>} */ (senal.detalle.timeframes['1d'])
  const sobreEma200 = diario.precio > diario.ema200
  const filtrada = senal.veredicto === 'COMPRAR' && !sobreEma200
  return {
    ...senal,
    version: VERSION,
    veredicto: filtrada ? /** @type {v1.Veredicto} */ ('MANTENER') : senal.veredicto,
    motivo: filtrada ? 'filtro_regimen' : senal.motivo,
    detalle: { ...senal.detalle, regimen: { sobreEma200 } },
  }
}

/**
 * Señal completa de una moneda en el instante `ahora`. Solo usa velas cerradas.
 * @param {Parameters<typeof v1.calcularSenal>[0]} entrada
 */
export function calcularSenal(entrada) {
  return aplicarRegimen(v1.calcularSenal(entrada))
}

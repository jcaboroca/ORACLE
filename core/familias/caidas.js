// @ts-check
// F4 Caídas en tendencia 1D (spec del laboratorio §3): COMPRAR si el cierre está sobre la SMA200 y el
// RSI(2) < u; VENDER si el cierre supera la SMA5 o si han pasado D días desde la última señal de entrada.
// La señal no conoce la posición del bot: el plazo se cuenta desde la última vela 1D que cumplió la
// entrada (si la entrada se repite con la posición abierta, el plazo se reinicia).
import { rsi, sma } from '../indicadores.js'
import { PERIODO_ATR, enteroPositivo, parametrosBotDiarios, prepararDiario, senalFamilia, stopValido } from './comun.js'

export const FAMILIA = 'caidas'
export const PERIODO_TENDENCIA = 200
export const PERIODO_SALIDA = 5
export const PERIODO_RSI = 2

/** @typedef {{ umbralRsi: number, dias: number, stop: number|null }} ConfigCaidas */

/** Valores de la rejilla por eje, en orden (un paso = valores contiguos). Spec del laboratorio §3. */
export const EJES = Object.freeze({ umbralRsi: [5, 10, 15], dias: [5, 10], stop: [null, 2.5] })
/** Claves de la configuración que solo afectan al bot (no a la señal). */
export const CLAVES_BOT = Object.freeze(['stop'])
/** @type {readonly Readonly<ConfigCaidas>[]} */
export const REJILLA = Object.freeze(EJES.stop.flatMap((stop) => EJES.umbralRsi.flatMap((umbralRsi) =>
  EJES.dias.map((dias) => Object.freeze({ umbralRsi, dias, stop })))))

/**
 * @param {ConfigCaidas} config umbralRsi: u; dias: D; stop: × ATR14 1D o null
 * @param {string} version
 * @returns {import('../hora.js').Estrategia}
 */
export function crear(config, version) {
  const { umbralRsi } = config
  if (typeof umbralRsi !== 'number' || !(umbralRsi > 0 && umbralRsi < 100)) throw new RangeError(`umbralRsi fuera de (0, 100): ${umbralRsi}`)
  const dias = enteroPositivo(config.dias, 'dias')
  const stop = stopValido(config.stop)
  const necesarias = Math.max(PERIODO_TENDENCIA, PERIODO_ATR + 1)
  return Object.freeze({
    VERSION: version,
    PARAMETROS: Object.freeze({ familia: FAMILIA, config: Object.freeze({ umbralRsi, dias, stop }) }),
    PARAMETROS_BOT: parametrosBotDiarios(stop),
    /** @param {import('../hora.js').EntradaSenal} e */
    calcularSenal(e) {
      const preparado = prepararDiario(version, e)
      const { diarias } = preparado
      if (diarias.length < necesarias) return senalFamilia(preparado, FAMILIA, null)
      const cierres = diarias.map((v) => v.cierre)
      const tendencia = sma(cierres, PERIODO_TENDENCIA)
      const salida = sma(cierres, PERIODO_SALIDA)
      const valoresRsi = rsi(cierres, PERIODO_RSI)
      /** @param {number} i */
      const entrada = (i) => {
        const t = tendencia[i]
        const r = valoresRsi[i]
        return t !== null && r !== null && cierres[i] > t && r < umbralRsi
      }
      const n = cierres.length
      let ultimaEntrada = -1
      for (let i = n - 1; i >= 0 && tendencia[i] !== null; i--) {
        if (entrada(i)) { ultimaEntrada = i; break }
      }
      const diasDesdeEntrada = ultimaEntrada < 0 ? null : n - 1 - ultimaEntrada
      const cierre = cierres[n - 1]
      const sma5 = /** @type {number} */ (salida[n - 1])
      const indicadores = {
        cierre, sma200: tendencia[n - 1], sma5, rsi2: valoresRsi[n - 1], diasDesdeEntrada,
      }
      if (cierre > sma5) return senalFamilia(preparado, FAMILIA, { veredicto: 'VENDER', motivo: 'sobre_sma5', indicadores })
      if (diasDesdeEntrada === null || diasDesdeEntrada >= dias) {
        return senalFamilia(preparado, FAMILIA, { veredicto: 'VENDER', motivo: 'plazo', indicadores })
      }
      if (diasDesdeEntrada === 0) return senalFamilia(preparado, FAMILIA, { veredicto: 'COMPRAR', indicadores })
      return senalFamilia(preparado, FAMILIA, { veredicto: 'MANTENER', indicadores })
    },
  })
}

// @ts-check
// Piezas comunes de las familias del laboratorio (spec del laboratorio §3): deciden una vez al día con
// velas 1D cerradas y devuelven una señal con el mismo shape que v1.
import { PARAMETROS_BOT as BOT_V1 } from '../estrategia-v1.js'
import { atr, ultimo } from '../indicadores.js'
import { cerradasHasta, esFresca } from '../velas.js'

/** @typedef {import('../velas.js').Vela} Vela */
/** @typedef {import('../hora.js').EntradaSenal} EntradaSenal */
/** @typedef {import('../hora.js').Senal} Senal */
/** @typedef {'COMPRAR'|'VENDER'|'MANTENER'} Accion */
/**
 * @typedef {{ veredicto: Accion, motivo?: string|null, indicadores: Record<string, number|null> }} DecisionFamilia
 */

/** Periodo del ATR 1D del stop de emergencia (y del atrPct que publica toda familia diaria). */
export const PERIODO_ATR = 14

/**
 * Variante del backtest de las familias diarias: solo velas, sin noticias, derivados ni Fear & Greed
 * (core/backtest.js la publica en data/backtest-vN.json).
 */
export const VARIANTE_SOLO_TECNICO = 'tecnico'

/**
 * Bot de las familias F1–F4: los parámetros de v1 decidiendo una vez al día (cierre 1D, 00:03 UTC),
 * sin take-profit y con un stop de emergencia de `stop` × ATR14 1D fijado al abrir; sin stop si es null.
 * @param {number|null} stop
 */
export function parametrosBotDiarios(stop) {
  return Object.freeze({
    ...BOT_V1,
    cadenciaHoras: 24,
    multStopLoss: stop ?? BOT_V1.multStopLoss,
    sinStopLoss: stop === null,
    sinTakeProfit: true,
  })
}

/**
 * @param {unknown} x
 * @param {string} nombre
 * @returns {number}
 */
export function enteroPositivo(x, nombre) {
  if (typeof x !== 'number' || !Number.isInteger(x) || x <= 0) throw new RangeError(`${nombre} debe ser un entero positivo: ${x}`)
  return x
}

/**
 * Múltiplo del ATR del stop de emergencia, o null (sin stop).
 * @param {unknown} x
 * @returns {number|null}
 */
export function stopValido(x) {
  if (x === null) return null
  if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0) throw new RangeError(`stop debe ser null o un número positivo: ${x}`)
  return x
}

/**
 * Lo que toda familia diaria necesita: velas 1D cerradas, campos base de la señal y ATR14 1D en fracción.
 * @param {string} version
 * @param {EntradaSenal} entrada
 */
export function prepararDiario(version, { simbolo, ahora, velas }) {
  const horarias = cerradasHasta(velas['1h'], ahora)
  const diarias = cerradasHasta(velas['1d'], ahora)
  const ultima1h = horarias[horarias.length - 1]
  const valorAtr = diarias.length > PERIODO_ATR ? ultimo(atr(diarias, PERIODO_ATR)) : null
  return {
    base: {
      version,
      simbolo,
      calculadaEn: ahora,
      vela1h: ultima1h ? ultima1h.inicio : null,
      precio: ultima1h ? ultima1h.cierre : null,
      fresca: esFresca(horarias, ahora),
    },
    diarias,
    atrPct: valorAtr === null ? null : valorAtr / ultimo(diarias).cierre,
  }
}

/**
 * Señal de familia con el shape de v1. decision null → SIN_DATOS (velas insuficientes).
 * puntuacion: 1 COMPRAR, −1 VENDER, 0 MANTENER; indiceConfianza 1 en COMPRAR/VENDER (regla determinista).
 * @param {ReturnType<typeof prepararDiario>} preparado
 * @param {string} familia
 * @param {DecisionFamilia|null} decision
 * @returns {Senal}
 */
export function senalFamilia({ base, atrPct }, familia, decision) {
  if (!decision) {
    return {
      ...base,
      veredicto: 'SIN_DATOS',
      puntuacion: null,
      indiceConfianza: null,
      alineacion: false,
      atrPct: null,
      motivo: 'velas_insuficientes',
      componentes: { tecnico: null, derivados: null, noticias: null, fng: null },
      ausentes: ['tecnico'],
      detalle: { familia, indicadores: {} },
    }
  }
  const puntuacion = decision.veredicto === 'COMPRAR' ? 1 : decision.veredicto === 'VENDER' ? -1 : 0
  return {
    ...base,
    veredicto: decision.veredicto,
    puntuacion,
    indiceConfianza: puntuacion === 0 ? null : 1,
    alineacion: false,
    atrPct,
    motivo: decision.motivo ?? null,
    componentes: { tecnico: puntuacion, derivados: null, noticias: null, fng: null },
    ausentes: ['derivados', 'noticias', 'fng'],
    detalle: { familia, indicadores: decision.indicadores },
  }
}

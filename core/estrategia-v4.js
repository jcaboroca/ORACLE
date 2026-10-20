// @ts-check
// Estrategia v4 (EXPERIMENTAL): F1 Cruce de medias 1D del laboratorio (spec del laboratorio §3, §4 y §9).
// Nº 2 del ranking fuera de muestra 2020–2025; NO cumple el criterio de «estrategia ganadora» (caída y
// monedas), se despliega para completar las 3 en vivo. Configuración elegida por el laboratorio con todo el
// entrenamiento hasta 2025-12-31 (data/laboratorio.json). Cualquier cambio de parámetros exige una VERSION nueva.
import { crear } from './familias/cruce.js'

export const VERSION = 'v4'

const estrategia = crear({ rapida: 10, lenta: 50, stop: null }, VERSION)

/** Señal: { familia: 'cruce', config: { rapida: 10, lenta: 50, stop: null } }. */
export const PARAMETROS = estrategia.PARAMETROS
/** Bot: los de v1 decidiendo al cierre 1D (00:03 UTC), sin take-profit y sin stop de emergencia. */
export const PARAMETROS_BOT = estrategia.PARAMETROS_BOT
/** Señal de una moneda en el instante `ahora`: COMPRAR con EMA10 > EMA50 1D, VENDER con EMA10 < EMA50. */
export const calcularSenal = estrategia.calcularSenal

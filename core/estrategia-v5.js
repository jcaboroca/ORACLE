// @ts-check
// Estrategia v5 (EXPERIMENTAL): F2 Ruptura de Donchian 1D del laboratorio (spec del laboratorio §3, §4 y §9).
// Nº 3 del ranking fuera de muestra 2020–2025; NO cumple el criterio de «estrategia ganadora» (caída y
// monedas), se despliega para completar las 3 en vivo. Configuración elegida por el laboratorio con todo el
// entrenamiento hasta 2025-12-31 (data/laboratorio.json). Cualquier cambio de parámetros exige una VERSION nueva.
import { crear } from './familias/ruptura.js'

export const VERSION = 'v5'

/** Nombre en la interfaz (Bot y Panel): no cumple el criterio del laboratorio. */
export const ETIQUETA = 'Ruptura de Donchian 1D (experimental)'

const estrategia = crear({ entrada: 20, salida: 20, stop: null }, VERSION)

/** Señal: { familia: 'ruptura', config: { entrada: 20, salida: 20, stop: null } }. */
export const PARAMETROS = estrategia.PARAMETROS
/** Bot: los de v1 decidiendo al cierre 1D (00:03 UTC), sin take-profit y sin stop de emergencia. */
export const PARAMETROS_BOT = estrategia.PARAMETROS_BOT
/** Backtest: 'tecnico' (solo velas: ni noticias, ni derivados, ni Fear & Greed). */
export const VARIANTE_BACKTEST = estrategia.VARIANTE_BACKTEST
/** Señal de una moneda en el instante `ahora`: COMPRAR al cerrar sobre el máximo de 20 días, VENDER bajo el mínimo de 20. */
export const calcularSenal = estrategia.calcularSenal

// @ts-check
// Estrategia v3: F3 Momentum 1D del laboratorio (spec del laboratorio §3, §4 y §9). Nº 1 del ranking fuera
// de muestra 2020–2025 y la única familia que cumple el criterio de «estrategia ganadora». Configuración
// elegida por el laboratorio con todo el entrenamiento hasta 2025-12-31 (data/laboratorio.json).
// Cualquier cambio de parámetros exige una VERSION nueva.
import { crear } from './familias/momentum.js'

export const VERSION = 'v3'

/** Nombre en la interfaz (Bot y Panel): la única que cumple el criterio del laboratorio. */
export const ETIQUETA = 'Momentum 1D'

const estrategia = crear({ dias: 30, revision: 'semanal', stop: null }, VERSION)

/** Señal: { familia: 'momentum', config: { dias: 30, revision: 'semanal', stop: null } }. */
export const PARAMETROS = estrategia.PARAMETROS
/** Bot: los de v1 decidiendo al cierre 1D (00:03 UTC), sin take-profit y sin stop de emergencia. */
export const PARAMETROS_BOT = estrategia.PARAMETROS_BOT
/** Backtest: 'tecnico' (solo velas: ni noticias, ni derivados, ni Fear & Greed). */
export const VARIANTE_BACKTEST = estrategia.VARIANTE_BACKTEST
/** Señal de una moneda en el instante `ahora`: COMPRAR si rinde > 0 en 30 días, VENDER si no; solo los lunes. */
export const calcularSenal = estrategia.calcularSenal

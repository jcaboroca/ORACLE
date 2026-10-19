// @ts-check
// Formatos de la interfaz en español de España. null/undefined/NaN → '—' (dato ausente, nunca un 0 fingido).

export const LOCALE = 'es-ES'
export const ZONA = 'Europe/Madrid'
export const VACIO = '—'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/** @param {unknown} n @returns {n is number} */
const esNumero = (n) => typeof n === 'number' && Number.isFinite(n)

/** @type {Map<string, Intl.NumberFormat>} */
const numeros = new Map()
/** @param {Intl.NumberFormatOptions} opciones */
function formateador(opciones) {
  const clave = JSON.stringify(opciones)
  let f = numeros.get(clave)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, opciones)
    numeros.set(clave, f)
  }
  return f
}

/**
 * Importe en euros con 2 decimales: 1234.5 → '1234,50 €', 72461.88 → '72.461,88 €'.
 * @param {number|null|undefined} n
 * @param {{ signo?: boolean }} [op] signo: '+' en positivos (beneficios)
 */
export function euros(n, { signo = false } = {}) {
  if (!esNumero(n)) return VACIO
  return formateador({
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
    signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(n)
}

/**
 * Precio de una moneda en euros: 2 decimales desde 1 €, y 4 por debajo (XRP ≈ 0,5 €).
 * @param {number|null|undefined} n
 */
export function precio(n) {
  if (!esNumero(n)) return VACIO
  const decimales = Math.abs(n) >= 1 ? 2 : 4
  return formateador({
    style: 'currency', currency: 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  }).format(n)
}

/**
 * Fracción como porcentaje: 0.05 → '5,00 %'. Con signo: -0.1851 → '-18,51 %', 0.0043 → '+0,43 %'.
 * @param {number|null|undefined} fraccion
 * @param {{ signo?: boolean, decimales?: number }} [op]
 */
export function porcentaje(fraccion, { signo = false, decimales = 2 } = {}) {
  if (!esNumero(fraccion)) return VACIO
  return formateador({
    style: 'percent', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
    signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(fraccion)
}

/**
 * Número con decimales fijos: (6.885, 1) → '6,9'; con signo: 0.045 → '+0,05'.
 * @param {number|null|undefined} n
 * @param {number} [decimales]
 * @param {{ signo?: boolean }} [op]
 */
export function numero(n, decimales = 2, { signo = false } = {}) {
  if (!esNumero(n)) return VACIO
  return formateador({
    minimumFractionDigits: decimales, maximumFractionDigits: decimales, signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(n)
}

/** Entero con separador de miles: 62621 → '62.621'. @param {number|null|undefined} n */
export const entero = (n) => (esNumero(n) ? formateador({ maximumFractionDigits: 0 }).format(n) : VACIO)

/** @type {Map<string, Intl.DateTimeFormat>} */
const fechas = new Map()
/** @param {Intl.DateTimeFormatOptions} opciones */
function formateadorFecha(opciones) {
  const clave = JSON.stringify(opciones)
  let f = fechas.get(clave)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: ZONA, ...opciones })
    fechas.set(clave, f)
  }
  return f
}

/** '19/10/2026, 00:07' (hora de Madrid). @param {number|null|undefined} ms */
export const fechaHora = (ms) => (esNumero(ms)
  ? formateadorFecha({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms)
  : VACIO)

/** '18/10/2024'. @param {number|null|undefined} ms */
export const fecha = (ms) => (esNumero(ms)
  ? formateadorFecha({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms)
  : VACIO)

/** '00:07'. @param {number|null|undefined} ms */
export const hora = (ms) => (esNumero(ms) ? formateadorFecha({ hour: '2-digit', minute: '2-digit' }).format(ms) : VACIO)

/**
 * Tiempo transcurrido en palabras: 'ahora mismo', 'hace 5 min', 'hace 3 h', 'hace 2 días'.
 * Un instante futuro (relojes desfasados) cuenta como 'ahora mismo'.
 * @param {number|null|undefined} ms
 * @param {number} ahora
 */
export function hace(ms, ahora) {
  if (!esNumero(ms)) return VACIO
  const pasado = ahora - ms
  if (pasado < MINUTO) return 'ahora mismo'
  if (pasado < HORA) return `hace ${Math.floor(pasado / MINUTO)} min`
  if (pasado < DIA) return `hace ${Math.floor(pasado / HORA)} h`
  const dias = Math.floor(pasado / DIA)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * Clase CSS por el signo de un valor: 'sube' | 'baja' | 'neutro'.
 * @param {number|null|undefined} n
 */
export const claseSigno = (n) => (!esNumero(n) || n === 0 ? 'neutro' : n > 0 ? 'sube' : 'baja')

/**
 * Lee un importe escrito a la española: '10.000' → 10000, '2500,5' → 2500.5, '10000 €' → 10000.
 * Devuelve null si no es un número.
 * @param {string} texto
 */
export function leerImporte(texto) {
  const limpio = texto.trim().replace(/[\s\u00a0€]/g, '')
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, '').replace(',', '.'))
}

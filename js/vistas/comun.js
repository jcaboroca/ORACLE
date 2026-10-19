// @ts-check
// Piezas comunes de las vistas.
import { esBloqueo, mensajeError, pideLogin } from '../api.js'
import { aviso, h } from '../dom.js'
import { ATRIBUCION } from '../graficos.js'

/**
 * @typedef {{
 *   api: import('../api.js').Api,
 *   ruta: import('../rutas.js').Ruta,
 *   fetch: typeof fetch,
 *   ahora: () => number,
 *   navegar: (hash: string) => void,
 *   avisar: (texto: string, tipo?: 'info'|'error') => void,
 *   entrar: (pin: string) => Promise<void>,
 *   mensajeLogin: string|null,
 *   refrescar: () => void,
 *   exigirPin: (e: unknown) => boolean,
 * }} Contexto
 * exigirPin: si el error pide PIN (401) vuelve al acceso; si es un bloqueo, avisa con su hora y conserva el PIN.
 * Devuelve true si lo ha tratado. Para errores en eventos.
 * @typedef {{ titulo: string, nodo: HTMLElement, montar?: () => (void | (() => void)) }} Pantalla
 */

let secuencia = 0

/** Cabecera de la vista; el h2 recibe el foco al navegar. @param {string} texto @param {...import('../dom.js').Hijo} extra */
export const cabecera = (texto, ...extra) => h('header', { class: 'vista-cabecera' }, h('h2', { tabindex: -1 }, texto), extra)

/** Sección con título enlazado para lectores de pantalla. @param {string} titulo @param {...import('../dom.js').Hijo} hijos */
export function seccion(titulo, ...hijos) {
  const id = `seccion-${++secuencia}`
  return h('section', { class: 'bloque', 'aria-labelledby': id }, h('h3', { id }, titulo), hijos)
}

/**
 * Error de una parte de la vista: si exige PIN o hay bloqueo se propaga (la app vuelve al acceso o muestra el
 * bloqueo); si no, aviso en su sitio.
 * @param {unknown} e
 */
export function avisoDeError(e) {
  if (pideLogin(e) || esBloqueo(e)) throw e
  return aviso(mensajeError(e), 'error')
}

/**
 * Promesa → { ok, valor } o { ok: false, error } para cargar partes independientes sin que una tumbe a las demás.
 * @template T
 * @param {Promise<T>} promesa
 * @returns {Promise<{ ok: true, valor: T } | { ok: false, error: unknown }>}
 */
export const intentar = (promesa) => promesa.then((valor) => ({ ok: /** @type {const} */ (true), valor }), (error) => ({ ok: /** @type {const} */ (false), error }))

/** Nota de atribución bajo cada gráfico (licencia Apache-2.0 de la librería, archivo NOTICE). */
export const notaAtribucion = () => h('p', { class: 'atribucion' },
  'Gráficos: ', h('a', { href: ATRIBUCION.url, target: '_blank', rel: 'noopener' }, ATRIBUCION.producto), ` ${ATRIBUCION.copyright}`)

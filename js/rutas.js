// @ts-check
// Rutas por hash (#/…), para que GitHub Pages sirva siempre index.html bajo /ORACLE/.
//   #/                      Panel
//   #/moneda/BTC?tf=4h      Detalle de moneda (tf: 1h | 4h | 1d)
//   #/bot?simulacion=2&simbolo=ETH&filtro=hold
//   #/backtest?v=v2
//   #/login

/** @typedef {'panel'|'moneda'|'bot'|'backtest'|'login'} Vista */
/** @typedef {{ vista: Vista, simbolo: string|null, params: Record<string, string> }} Ruta */

const SIMBOLO = /^[A-Za-z0-9]{2,10}$/
/** @type {Vista[]} */
const SIMPLES = ['bot', 'backtest', 'login']

/**
 * '#/moneda/btc?tf=4h' → { vista: 'moneda', simbolo: 'BTC', params: { tf: '4h' } }. Lo desconocido → Panel.
 * @param {string} hash
 * @returns {Ruta}
 */
export function leerRuta(hash) {
  const texto = hash.replace(/^#\/?/, '')
  const corte = texto.indexOf('?')
  const camino = corte === -1 ? texto : texto.slice(0, corte)
  const params = Object.fromEntries(new URLSearchParams(corte === -1 ? '' : texto.slice(corte + 1)))
  const partes = camino.split('/').filter(Boolean)
  if (partes.length === 2 && partes[0] === 'moneda' && SIMBOLO.test(partes[1])) {
    return { vista: 'moneda', simbolo: partes[1].toUpperCase(), params }
  }
  const vista = /** @type {Vista} */ (partes[0])
  if (partes.length === 1 && SIMPLES.includes(vista)) return { vista, simbolo: null, params }
  return { vista: 'panel', simbolo: null, params: {} }
}

/**
 * Hash de una ruta. Los parámetros vacíos o null no se escriben.
 * @param {Vista} vista
 * @param {{ simbolo?: string|null, params?: Record<string, string|number|null|undefined> }} [op]
 */
export function hashDe(vista, { simbolo = null, params = {} } = {}) {
  const camino = vista === 'panel' ? '' : vista === 'moneda' ? `moneda/${simbolo}` : vista
  const consulta = new URLSearchParams()
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== null && valor !== undefined && valor !== '') consulta.set(clave, String(valor))
  }
  const q = consulta.toString()
  return `#/${camino}${q ? `?${q}` : ''}`
}

/**
 * La misma ruta con algunos parámetros cambiados (null los quita).
 * @param {Ruta} ruta
 * @param {Record<string, string|number|null>} cambios
 */
export const conParams = (ruta, cambios) => hashDe(ruta.vista, { simbolo: ruta.simbolo, params: { ...ruta.params, ...cambios } })

/**
 * Entero positivo de un parámetro, o null.
 * @param {Record<string, string>} params @param {string} nombre
 */
export function paramEntero(params, nombre) {
  const v = params[nombre]
  return v !== undefined && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null
}

/**
 * Valor de un parámetro si está entre las opciones; si no, el valor por defecto.
 * @template {string} T
 * @param {Record<string, string>} params @param {string} nombre @param {readonly T[]} opciones @param {T} porDefecto
 * @returns {T}
 */
export function paramOpcion(params, nombre, opciones, porDefecto) {
  const v = /** @type {T} */ (params[nombre])
  return opciones.includes(v) ? v : porDefecto
}

/** Sección de la barra de navegación marcada: el detalle de moneda cuelga del Panel. @param {Ruta} ruta */
export const seccionDe = (ruta) => (ruta.vista === 'moneda' ? 'panel' : ruta.vista)

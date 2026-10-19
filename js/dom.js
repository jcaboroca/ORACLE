// @ts-check
// Construcción de nodos con createElement: el texto siempre entra como texto, nunca como HTML (titulares y
// explicaciones vienen de fuera).

/** @typedef {Node|string|number|null|undefined|false|any[]} Hijo listas anidadas permitidas */
/** @typedef {Record<string, unknown>} Atributos */

/** @param {Element} el @param {Atributos|null|undefined} atributos */
function aplicar(el, atributos) {
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue
    if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), /** @type {EventListener} */ (valor))
    else el.setAttribute(clave, valor === true ? '' : String(valor))
  }
}

/** @param {Element} el @param {Hijo[]} hijos */
function anadir(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue
    el.append(hijo instanceof Node ? hijo : String(hijo))
  }
}

/**
 * h('p', { class: 'nota', onclick: f }, 'texto', otroNodo)
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} etiqueta @param {Atributos|null} [atributos] @param {...Hijo} hijos
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta)
  aplicar(el, atributos)
  anadir(el, hijos)
  return el
}

/**
 * Elemento SVG (medidor de Fear & Greed).
 * @param {string} etiqueta @param {Atributos|null} [atributos] @param {...Hijo} hijos
 */
export function s(etiqueta, atributos, ...hijos) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', etiqueta)
  aplicar(el, atributos)
  anadir(el, hijos)
  return el
}

/**
 * Tabla accesible con título, cabeceras de columna y mensaje si no hay filas.
 * @param {{ titulo: string, columnas: { clave: string, texto: string, numerica?: boolean }[],
 *   filas: Record<string, unknown>[], vacio?: string, claseFila?: (f: any) => string|undefined }} op
 */
export function tabla({ titulo, columnas, filas, vacio = 'Sin datos.', claseFila }) {
  if (filas.length === 0) return h('p', { class: 'vacio' }, vacio)
  const cuerpo = h('tbody', null, filas.map((f) => filaTabla(columnas, f, claseFila)))
  return h('div', { class: 'tabla-desplazable', tabindex: 0, role: 'region', 'aria-label': titulo },
    h('table', null,
      h('caption', { class: 'solo-lectores' }, titulo),
      h('thead', null, h('tr', null, columnas.map((c) => h('th', { scope: 'col', class: c.numerica ? 'num' : null }, c.texto)))),
      cuerpo))
}

/**
 * @param {{ clave: string, numerica?: boolean }[]} columnas @param {Record<string, unknown>} f
 * @param {(f: any) => string|undefined} [claseFila]
 */
export const filaTabla = (columnas, f, claseFila) => h('tr', { class: claseFila?.(f) ?? null },
  columnas.map((c) => h('td', { class: c.numerica ? 'num' : null }, /** @type {Hijo} */ (f[c.clave]))))

/**
 * Lista de pares etiqueta → valor (métricas).
 * @param {{ etiqueta: string, valor: string, clase?: string, ayuda?: string }[]} filas
 */
export const definiciones = (filas) => h('dl', { class: 'metricas' }, filas.map((f) => h('div', { class: 'metrica' },
  h('dt', null, f.etiqueta),
  h('dd', { class: f.clase ?? null }, f.valor),
  f.ayuda ? h('dd', { class: 'ayuda' }, f.ayuda) : null)))

/**
 * Aviso visible (error o información). Nunca se deja la pantalla en blanco.
 * @param {string} texto @param {'error'|'info'|'alerta'} [tipo] @param {...Hijo} extra
 */
export const aviso = (texto, tipo = 'info', ...extra) => h('div', { class: `aviso aviso-${tipo}`, role: tipo === 'error' ? 'alert' : 'status' },
  h('p', null, texto), extra)

/** Insignia del veredicto: texto + color (el color nunca va solo). @param {string} texto @param {string} clase */
export const insignia = (texto, clase) => h('span', { class: `insignia veredicto-${clase}` }, texto)

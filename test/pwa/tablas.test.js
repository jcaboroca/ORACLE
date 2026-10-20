// @ts-check
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { tabla } from '../../js/dom.js'
import { leer } from './modulos.js'

/** DOM mínimo para h(): elementos con atributos e hijos (texto o elementos). Solo para este test. */
class Elemento {
  /** @param {string} etiqueta */
  constructor(etiqueta) {
    this.etiqueta = etiqueta
    /** @type {Record<string, string>} */
    this.atributos = {}
    /** @type {(Elemento|string)[]} */
    this.hijos = []
  }

  /** @param {string} k @param {string} v */
  setAttribute(k, v) { this.atributos[k] = v }

  addEventListener() {}

  /** @param {...(Elemento|string)} hijos */
  append(...hijos) { this.hijos.push(...hijos) }

  /** @param {string} etiqueta @returns {Elemento[]} */
  todos(etiqueta) {
    const propios = this.hijos.filter((x) => x instanceof Elemento)
    return [...propios.filter((x) => x.etiqueta === etiqueta), ...propios.flatMap((x) => x.todos(etiqueta))]
  }

  /** @returns {string} */
  get texto() { return this.hijos.map((x) => (typeof x === 'string' ? x : x.texto)).join('') }
}

const COLUMNAS = [{ clave: 'a', texto: 'Estrategia' }, { clave: 'b', texto: 'Comprar y mantener', numerica: true }, { clave: 'c', texto: 'Criterio' }]
const FILAS = [{ a: 'v3', b: '+1,00 %', c: 'Cumple' }, { a: 'v4', b: '-2,00 %', c: 'No cumple' }]

describe('tablas anchas en el móvil', () => {
  before(() => Object.assign(globalThis, { Node: Elemento, document: { createElement: (/** @type {string} */ e) => new Elemento(e) } }))
  after(() => {
    delete (/** @type {any} */ (globalThis)).Node
    delete (/** @type {any} */ (globalThis)).document
  })

  test('apilable: contenedor desplazable con su clase, roles ARIA explícitos y la cabecera en cada celda', () => {
    const t = /** @type {any} */ (tabla({ titulo: 'Ranking', columnas: COLUMNAS, filas: FILAS, apilable: true }))
    assert.equal(t.atributos.class, 'tabla-desplazable tabla-apilable')
    assert.deepEqual([t.atributos.role, t.atributos['aria-label'], t.atributos.tabindex], ['region', 'Ranking', '0'])
    assert.equal(t.todos('table')[0].atributos.role, 'table')
    assert.deepEqual(t.todos('th').map((/** @type {Elemento} */ th) => [th.texto, th.atributos.role]), COLUMNAS.map((c) => [c.texto, 'columnheader']))
    const celdas = t.todos('td')
    assert.equal(celdas.length, 6)
    assert.deepEqual(celdas.map((/** @type {Elemento} */ td) => td.atributos['data-etiqueta']), [...COLUMNAS, ...COLUMNAS].map((c) => c.texto))
    assert.ok(celdas.every((/** @type {Elemento} */ td) => td.atributos.role === 'cell'))
    assert.ok(t.todos('tr').every((/** @type {Elemento} */ tr) => tr.atributos.role === 'row'))
  })

  test('sin apilable: la tabla de siempre (desplazable, sin roles añadidos) y las celdas también llevan su cabecera', () => {
    const t = /** @type {any} */ (tabla({ titulo: 'Operaciones', columnas: COLUMNAS, filas: FILAS }))
    assert.equal(t.atributos.class, 'tabla-desplazable')
    assert.equal(t.todos('table')[0].atributos.role, undefined)
    assert.deepEqual(t.todos('td').slice(0, 3).map((/** @type {Elemento} */ td) => [td.atributos['data-etiqueta'], td.atributos.role]),
      COLUMNAS.map((c) => [c.texto, undefined]))
  })

  test('CSS: por debajo de 680 px las apilables son tarjetas con la cabecera delante; encima, sombra de desplazamiento', () => {
    const css = leer('styles.css')
    const movil = /@media \(max-width: 680px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    assert.match(movil, /\.tabla-apilable thead \{[^}]*position: absolute;/)
    assert.match(movil, /\.tabla-apilable tr \{[^}]*border-radius/)
    assert.match(movil, /\.tabla-apilable td::before \{ content: attr\(data-etiqueta\);/)
    assert.match(movil, /white-space: normal;/)
    assert.match(css, /\.tabla-desplazable \{\s*background:[\s\S]*?no-repeat local,[\s\S]*?no-repeat scroll;/)
  })

  test('la tabla de la comparativa lado a lado del Bot es apilable', () => {
    const fuente = leer('js/vistas/bot.js')
    const comparativa = fuente.slice(fuente.indexOf('function bloqueComparativa'), fuente.indexOf('export async function vistaBot'))
    assert.equal(comparativa.split('tabla({').length - 1, 1)
    assert.equal(comparativa.split('apilable: true').length - 1, 1)
  })
})

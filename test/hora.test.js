// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { PARAMETROS_BOT, crearHodl, estadoInicial, valorHodl } from '../core/bot.js'
import { ejecutarHora } from '../core/hora.js'
import { HORA } from '../core/velas.js'
import { serie } from './ayudantes.js'

const CIERRE = 600 * HORA // todas las series terminan aquí
const AHORA = CIERRE + 3 * 60_000
/** @param {number} x @param {number} y */
const cerca = (x, y, tol = 1e-6) => assert.ok(Math.abs(x - y) <= tol, `${x} ≉ ${y}`)

/**
 * Moneda en tendencia alcista limpia (la estrategia v1 da COMPRAR con confianza 0,75).
 * @param {string} simbolo
 * @param {number} base
 * @param {{ sinEur?: boolean }} [op]
 */
function moneda(simbolo, base, { sinEur = false } = {}) {
  /** @param {number} dur */
  const subida = (dur) => serie(300, (i) => base * 1.002 ** i, { duracion: dur, inicio: CIERRE - 300 * dur })
  return {
    simbolo,
    velas: { '1h': subida(HORA), '4h': subida(4 * HORA), '1d': subida(24 * HORA) },
    // sinEur: la única vela EUR sigue abierta en AHORA, así que aún no hay precio
    velasEur: sinEur
      ? serie(1, () => base * 0.9, { inicio: CIERRE })
      : serie(24, (i) => base * 0.9 * 1.002 ** i, { inicio: CIERRE - 24 * HORA }),
    derivados: null,
  }
}

/** @param {ReturnType<typeof moneda>} m */
const precioEur = (m) => m.velasEur[m.velasEur.length - 1].cierre

const base = () => ({
  estado: estadoInicial(10_000), hodl: null, capitalInicial: 10_000, ahora: AHORA, titulares: [], fng: null,
})

describe('ejecutarHora', () => {
  test('dimensiona todas las monedas con la misma foto de la cartera tomada antes del bucle', () => {
    const r = ejecutarHora({ ...base(), monedas: [moneda('BTC', 100), moneda('ETH', 10)] })
    const compras = r.eventos.filter((e) => e.tipo === 'compra')
    assert.deepEqual(compras.map((e) => e.simbolo), ['BTC', 'ETH'])
    // tras la primera compra la cartera vale menos (comisión y deslizamiento): si se recalculara, el 2.º importe sería menor
    assert.equal(compras[0].importe, PARAMETROS_BOT.fraccionPosicion * 10_000)
    assert.equal(compras[1].importe, compras[0].importe)
  })

  test('procesa las monedas en el orden dado y devuelve una señal y una decisión por moneda', () => {
    const r = ejecutarHora({ ...base(), monedas: [moneda('ETH', 10), moneda('BTC', 100)] })
    assert.deepEqual(r.senales.map((s) => s.simbolo), ['ETH', 'BTC'])
    assert.deepEqual(r.decisiones.map((d) => d.simbolo), ['ETH', 'BTC'])
    assert.ok(r.senales.every((s) => s.veredicto === 'COMPRAR'))
  })

  test('no crea el HODL mientras falte el precio EUR de alguna moneda; lo crea cuando están todos', () => {
    const r1 = ejecutarHora({ ...base(), monedas: [moneda('BTC', 100), moneda('ETH', 10, { sinEur: true })] })
    assert.equal(r1.hodl, null)
    assert.equal(r1.punto.hodl, null)

    const monedas = [moneda('BTC', 100), moneda('ETH', 10)]
    const r2 = ejecutarHora({ ...base(), monedas })
    const precios = { BTC: precioEur(monedas[0]), ETH: precioEur(monedas[1]) }
    assert.deepEqual(r2.hodl, crearHodl(10_000, precios))
    cerca(/** @type {number} */ (r2.punto.hodl), valorHodl(/** @type {Record<string, number>} */ (r2.hodl), precios))
  })

  test('conserva un HODL ya creado', () => {
    const hodl = { BTC: 1, ETH: 2 }
    const r = ejecutarHora({ ...base(), hodl, monedas: [moneda('BTC', 100), moneda('ETH', 10)] })
    assert.deepEqual(r.hodl, { BTC: 1, ETH: 2 })
  })

  test('punto: valor = saldo + posiciones abiertas a precio actual, en el instante ahora', () => {
    const monedas = [moneda('BTC', 100), moneda('ETH', 10)]
    const r = ejecutarHora({ ...base(), monedas })
    const abiertas = Object.values(r.estado.posiciones)
    assert.equal(abiertas.length, 2)
    const precios = { BTC: precioEur(monedas[0]), ETH: precioEur(monedas[1]) }
    const esperado = r.estado.saldo + abiertas.reduce((s, p) => s + p.unidades * precios[/** @type {'BTC'|'ETH'} */ (p.simbolo)], 0)
    assert.equal(r.punto.t, AHORA)
    cerca(r.punto.valor, esperado)
  })

  test('no muta sus entradas', () => {
    const entrada = { ...base(), hodl: { BTC: 1, ETH: 2 }, monedas: [moneda('BTC', 100), moneda('ETH', 10)] }
    const copia = structuredClone(entrada)
    const r = ejecutarHora(entrada)
    assert.ok(r.eventos.length > 0)
    assert.deepEqual(entrada, copia)
  })
})

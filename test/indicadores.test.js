// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { atr, bollinger, ema, macd, rsi, sma, ultimo } from '../core/indicadores.js'

/** @param {number} a @param {number} b */
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

describe('sma', () => {
  test('media móvil simple con null al principio', () => {
    assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
  })
})

describe('ema', () => {
  test('sembrada con la SMA y luego k = 2/(n+1)', () => {
    const r = ema([1, 2, 3, 4, 5], 3)
    assert.deepEqual(r.slice(0, 2), [null, null])
    cerca(/** @type {number} */ (r[2]), 2)
    cerca(/** @type {number} */ (r[3]), 3)
    cerca(/** @type {number} */ (r[4]), 4)
  })
  test('serie constante da la constante', () => {
    assert.ok(ema(new Array(50).fill(7), 20).slice(19).every((v) => v === 7))
  })
  test('serie más corta que n: todo null', () => {
    assert.deepEqual(ema([1, 2], 3), [null, null])
  })
})

describe('rsi (Wilder)', () => {
  test('solo subidas = 100', () => {
    const r = rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14)
    assert.equal(r[13], null)
    assert.equal(r[14], 100)
    assert.equal(ultimo(r), 100)
  })
  test('solo bajadas = 0', () => {
    assert.equal(ultimo(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14)), 0)
  })
  test('plana = 50', () => {
    assert.equal(ultimo(rsi(new Array(30).fill(10), 14)), 50)
  })
  test('alternancia simétrica calculada a mano (n = 2)', () => {
    // cambios: +1, -1, +1 → semilla g=0.5 p=0.5 → RSI 50; luego g=(0.5+1)/2=0.75, p=0.25 → 75
    const r = rsi([10, 11, 10, 11], 2)
    assert.deepEqual(r.slice(0, 2), [null, null])
    cerca(/** @type {number} */ (r[2]), 50)
    cerca(/** @type {number} */ (r[3]), 75)
  })
})

describe('macd', () => {
  test('serie constante: macd, señal e histograma 0', () => {
    const { macd: m, senal, histograma } = macd(new Array(60).fill(100))
    assert.equal(m[24], null)
    assert.equal(m[25], 0)
    assert.equal(senal[32], null)
    assert.equal(senal[33], 0)
    assert.equal(ultimo(histograma), 0)
  })
  test('tendencia alcista: macd positivo', () => {
    const { macd: m } = macd(Array.from({ length: 60 }, (_, i) => 100 + i))
    assert.ok(/** @type {number} */ (ultimo(m)) > 0)
  })
})

describe('bollinger', () => {
  test('bandas y %B calculados a mano (n = 2, k = 1)', () => {
    // ventana [1,3]: media 2, desviación 1 → superior 3, inferior 1, %B del 3 = 1
    const b = bollinger([1, 3], 2, 1)
    assert.equal(b.media[1], 2)
    assert.equal(b.superior[1], 3)
    assert.equal(b.inferior[1], 1)
    assert.equal(b.pctB[1], 1)
  })
  test('ventana plana: %B = 0.5', () => {
    assert.equal(ultimo(bollinger(new Array(25).fill(5)).pctB), 0.5)
  })
  test('ventana plana con decimales: %B = 0.5', () => {
    for (const x of [0.1, 2.7, 65000.13, 0.0000213]) {
      assert.equal(ultimo(bollinger(new Array(25).fill(x)).pctB), 0.5, `precio ${x}`)
    }
  })
})

describe('atr (Wilder)', () => {
  test('rango verdadero con huecos (n = 2)', () => {
    const velas = [
      { maximo: 10, minimo: 8, cierre: 9 },
      { maximo: 12, minimo: 9, cierre: 11 }, // TR 3
      { maximo: 11, minimo: 10, cierre: 10 }, // TR 1
      { maximo: 15, minimo: 14, cierre: 14 }, // TR max(1, 5, 4) = 5
    ]
    const r = atr(velas, 2)
    assert.deepEqual(r.slice(0, 2), [null, null])
    assert.equal(r[2], 2) // (3 + 1) / 2
    assert.equal(r[3], 3.5) // (2 * 1 + 5) / 2
  })
})

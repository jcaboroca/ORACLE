// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calcularMetricas, drawdownMaximo, metricasPorMoneda } from '../core/metricas.js'

const DIA = 24 * 3_600_000

describe('drawdownMaximo', () => {
  test('mayor caída desde un máximo previo', () => {
    assert.equal(drawdownMaximo([100, 120, 90, 130, 117]), 0.25) // 120 → 90
  })
  test('siempre al alza: 0', () => {
    assert.equal(drawdownMaximo([1, 2, 3]), 0)
  })
  test('vacía: 0', () => {
    assert.equal(drawdownMaximo([]), 0)
  })
})

describe('calcularMetricas', () => {
  const operaciones = /** @type {import('../core/metricas.js').OperacionMetrica[]} */ ([
    { tipo: 'compra', simbolo: 'BTC', comision: 2, deslizamiento: 1 },
    { tipo: 'venta', simbolo: 'BTC', comision: 2, deslizamiento: 1, pnlNeto: 100 },
    { tipo: 'compra', simbolo: 'ETH', comision: 2, deslizamiento: 1 },
    { tipo: 'venta', simbolo: 'ETH', comision: 2, deslizamiento: 1, pnlNeto: -40 },
    { tipo: 'compra', simbolo: 'BTC', comision: 2, deslizamiento: 1 },
  ])
  const m = calcularMetricas({
    capitalInicial: 10_000,
    saldo: 8_060,
    abiertas: [{ unidades: 10, coste: 2_000, precioActual: 210 }],
    operaciones,
    curva: [
      { t: 0, valor: 10_000, hodl: 10_000 },
      { t: 7 * DIA, valor: 9_000, hodl: 11_000 },
      { t: 14 * DIA, valor: 10_160, hodl: 9_900 },
    ],
  })
  test('valor, rentabilidad y no realizado', () => {
    assert.equal(m.valorCartera, 10_160)
    assert.ok(Math.abs(m.rentabilidad - 0.016) < 1e-12)
    assert.equal(m.beneficioNoRealizado, 100)
  })
  test('ganadoras, perdedoras, beneficio medio y costes', () => {
    assert.equal(m.ganadoras, 1)
    assert.equal(m.perdedoras, 1)
    assert.equal(m.beneficioRealizado, 60)
    assert.equal(m.beneficioMedio, 30)
    assert.equal(m.comisiones, 10)
    assert.equal(m.deslizamiento, 5)
  })
  test('comprar y mantener, drawdown y frecuencia', () => {
    assert.ok(Math.abs(/** @type {number} */ (m.rentabilidadHodl) - -0.01) < 1e-12)
    assert.equal(m.drawdownMaximo, 0.1)
    assert.ok(Math.abs(/** @type {number} */ (m.drawdownMaximoHodl) - 0.1) < 1e-12)
    assert.equal(m.operacionesPorSemana, 2.5)
  })
  test('por moneda', () => {
    const p = metricasPorMoneda(operaciones)
    assert.equal(p.BTC.operaciones, 3)
    assert.equal(p.BTC.beneficioRealizado, 100)
    assert.equal(p.ETH.perdedoras, 1)
  })
})

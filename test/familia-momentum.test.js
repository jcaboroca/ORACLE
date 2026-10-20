// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { FAMILIA, REVISIONES, crear } from '../core/familias/momentum.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

const LUNES = Date.UTC(2021, 0, 4)
const DIA = 24 * 3_600_000
const subida = Array.from({ length: 60 }, (_, i) => 100 + i)
const bajada = Array.from({ length: 60 }, (_, i) => 200 - i)

describe('familia F3: momentum 1D', () => {
  const diaria = crear({ dias: 30, revision: 'diaria', stop: null }, 'vx')
  const semanal = crear({ dias: 30, revision: 'semanal', stop: 2.5 }, 'vx')

  test('contrato: PARAMETROS congelados con familia y config; bot diario sin TP', () => {
    assert.equal(FAMILIA, 'momentum')
    assert.deepEqual(REVISIONES, ['diaria', 'semanal'])
    assert.deepEqual(semanal.PARAMETROS, { familia: 'momentum', config: { dias: 30, revision: 'semanal', stop: 2.5 } })
    assert.deepEqual(semanal.PARAMETROS_BOT, {
      ...v1.PARAMETROS_BOT, cadenciaHoras: 24, multStopLoss: 2.5, sinStopLoss: false, sinTakeProfit: true,
    })
    assert.deepEqual(Object.keys(diaria.calcularSenal(entradaDiaria(subida))).sort(), CLAVES_SENAL)
  })
  test('rentabilidad de L días > 0 → COMPRAR; ≤ 0 → VENDER', () => {
    const s = diaria.calcularSenal(entradaDiaria(subida))
    assert.equal(s.veredicto, 'COMPRAR')
    assert.deepEqual(s.detalle, { familia: 'momentum', indicadores: { rentabilidad: 159 / 129 - 1 } })
    assert.equal(diaria.calcularSenal(entradaDiaria(bajada)).veredicto, 'VENDER')
    const igual = [...new Array(30).fill(110), 100, ...new Array(29).fill(120), 100]
    const cero = diaria.calcularSenal(entradaDiaria(igual))
    assert.deepEqual(cero.detalle.indicadores, { rentabilidad: 0 })
    assert.equal(cero.veredicto, 'VENDER')
  })
  test('revisión semanal: decide solo el lunes a las 00:03 UTC (cierre del domingo); el resto de días MANTENER', () => {
    assert.equal(semanal.calcularSenal(entradaDiaria(subida, { fin: LUNES })).veredicto, 'COMPRAR')
    for (let d = 1; d < 7; d++) {
      const s = semanal.calcularSenal(entradaDiaria(subida, { fin: LUNES + d * DIA }))
      assert.equal(s.veredicto, 'MANTENER')
      assert.equal(s.motivo, 'fuera_de_revision')
    }
    assert.equal(diaria.calcularSenal(entradaDiaria(subida, { fin: LUNES + DIA })).veredicto, 'COMPRAR')
  })
  test('menos de L + 1 velas 1D: SIN_DATOS', () => {
    assert.equal(diaria.calcularSenal(entradaDiaria(subida.slice(0, 30))).veredicto, 'SIN_DATOS')
    assert.equal(diaria.calcularSenal(entradaDiaria(subida.slice(0, 31))).veredicto, 'COMPRAR')
  })
  test('config inválida: RangeError', () => {
    assert.throws(() => crear({ dias: 30, revision: /** @type {any} */ ('mensual'), stop: null }, 'vx'), RangeError)
    assert.throws(() => crear({ dias: -1, revision: 'diaria', stop: null }, 'vx'), RangeError)
  })
})

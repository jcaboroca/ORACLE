// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA, cerradasHasta, desdeBinance, esFresca } from '../core/velas.js'

/** @param {number} inicio */
const vela = (inicio) => ({ inicio, fin: inicio + HORA, apertura: 1, maximo: 1, minimo: 1, cierre: 1, volumen: 1 })

describe('desdeBinance', () => {
  test('convierte una fila real de klines', () => {
    const fila = [1792342800000, '72117.21', '72250.35', '72117.21', '72230.53', '0.92403', 1792346399999, '66716.48', 381, '0.37', '27079.19', '0']
    assert.deepEqual(desdeBinance([fila]), [{
      inicio: 1792342800000,
      fin: 1792346400000,
      apertura: 72117.21,
      maximo: 72250.35,
      minimo: 72117.21,
      cierre: 72230.53,
      volumen: 0.92403,
    }])
  })
})

describe('cerradasHasta', () => {
  const velas = [vela(0), vela(HORA), vela(2 * HORA)]
  test('descarta la vela en curso', () => {
    assert.deepEqual(cerradasHasta(velas, 2.5 * HORA).map((v) => v.inicio), [0, HORA])
  })
  test('una vela que cierra justo en t cuenta como cerrada', () => {
    assert.equal(cerradasHasta(velas, 3 * HORA).length, 3)
  })
  test('antes de cerrar la primera: ninguna', () => {
    assert.equal(cerradasHasta(velas, HORA - 1).length, 0)
  })
})

describe('esFresca', () => {
  test('cron al minuto 3: la última cerrada terminó hace 3 min', () => {
    assert.equal(esFresca([vela(0)], HORA + 3 * 60_000), true)
  })
  test('falta la vela de la hora anterior: desactualizada', () => {
    assert.equal(esFresca([vela(0)], 2 * HORA + 3 * 60_000), false)
  })
  test('sin velas: desactualizada', () => {
    assert.equal(esFresca([], HORA), false)
  })
})

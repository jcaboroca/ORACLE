// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { FAMILIA, crear } from '../core/familias/ruptura.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

/** 40 días planos a 100 (máximos 101, mínimos 99) y un último cierre dado. @param {number} ultimo */
const plana = (ultimo) => [...new Array(40).fill(100), ultimo]

describe('familia F2: ruptura de Donchian 1D', () => {
  const f = crear({ entrada: 20, salida: 10, stop: null }, 'vx')

  test('contrato: PARAMETROS congelados con familia y config; bot diario sin TP', () => {
    assert.equal(FAMILIA, 'ruptura')
    assert.deepEqual(f.PARAMETROS, { familia: 'ruptura', config: { entrada: 20, salida: 10, stop: null } })
    assert.ok(Object.isFrozen(f.PARAMETROS.config))
    assert.deepEqual(f.PARAMETROS_BOT, { ...v1.PARAMETROS_BOT, cadenciaHoras: 24, sinStopLoss: true, sinTakeProfit: true })
    assert.deepEqual(Object.keys(f.calcularSenal(entradaDiaria(plana(105)))).sort(), CLAVES_SENAL)
  })
  test('cierre > máximo de los N días previos → COMPRAR; < mínimo de los M previos → VENDER; entre ambos → MANTENER', () => {
    const compra = f.calcularSenal(entradaDiaria(plana(105)))
    assert.equal(compra.veredicto, 'COMPRAR')
    assert.deepEqual(compra.detalle, { familia: 'ruptura', indicadores: { cierre: 105, maximoPrevio: 101, minimoPrevio: 99 } })
    assert.equal(f.calcularSenal(entradaDiaria(plana(95))).veredicto, 'VENDER')
    assert.equal(f.calcularSenal(entradaDiaria(plana(100.5))).veredicto, 'MANTENER')
  })
  test('la ventana son exactamente los N días anteriores al de hoy', () => {
    const base = entradaDiaria(plana(105))
    /** @param {number} atras días antes de la última vela @param {number} maximo */
    const conMaximo = (atras, maximo) => {
      const diarias = base.velas['1d'].map((v) => ({ ...v }))
      diarias[diarias.length - 1 - atras].maximo = maximo
      return { ...base, velas: { ...base.velas, '1d': diarias } }
    }
    assert.equal(f.calcularSenal(conMaximo(20, 200)).veredicto, 'MANTENER')
    assert.equal(f.calcularSenal(conMaximo(21, 200)).veredicto, 'COMPRAR')
  })
  test('menos de max(N, M) + 1 velas 1D: SIN_DATOS', () => {
    assert.equal(f.calcularSenal(entradaDiaria([...new Array(19).fill(100), 105])).veredicto, 'SIN_DATOS')
    assert.equal(f.calcularSenal(entradaDiaria([...new Array(20).fill(100), 105])).veredicto, 'COMPRAR')
    const larga = crear({ entrada: 20, salida: 40, stop: 2.5 }, 'vx')
    assert.equal(larga.calcularSenal(entradaDiaria([...new Array(39).fill(100), 105])).veredicto, 'SIN_DATOS')
    assert.equal(larga.PARAMETROS_BOT.multStopLoss, 2.5)
    assert.equal(larga.PARAMETROS_BOT.sinStopLoss, false)
  })
  test('config inválida: RangeError', () => {
    assert.throws(() => crear({ entrada: 0, salida: 10, stop: null }, 'vx'), RangeError)
    assert.throws(() => crear({ entrada: 20, salida: 1.5, stop: null }, 'vx'), RangeError)
  })
})

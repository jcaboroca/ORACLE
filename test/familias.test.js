// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { FAMILIAS, claveSenal, familia, todasLasConfiguraciones, vecinos } from '../core/familias/index.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

describe('registro de familias del laboratorio', () => {
  test('5 familias en el orden de la spec y 66 configuraciones: 2 × (9 + 6 + 10 + 6) + 4', () => {
    assert.deepEqual(Object.keys(FAMILIAS), ['cruce', 'ruptura', 'momentum', 'caidas', 'v1stops'])
    const tamanos = Object.values(FAMILIAS).map((f) => f.REJILLA.length)
    assert.deepEqual(tamanos, [18, 12, 20, 12, 4])
    assert.equal(todasLasConfiguraciones().length, 66)
  })
  test('rejillas exactas de la spec §3', () => {
    const pares = FAMILIAS.ruptura.REJILLA.filter((c) => c.stop === null).map((c) => [c.entrada, c.salida])
    assert.deepEqual(pares, [[20, 10], [40, 20], [55, 20], [100, 40], [20, 20], [55, 40]])
    for (const nombre of ['cruce', 'ruptura', 'momentum', 'caidas']) {
      assert.deepEqual([...new Set(FAMILIAS[nombre].REJILLA.map((c) => c.stop))], [null, 2.5], nombre)
    }
    assert.deepEqual(FAMILIAS.v1stops.REJILLA, [
      { multStopLoss: 2.5, takeProfit: 4 }, { multStopLoss: 2.5, takeProfit: null },
      { multStopLoss: 3.5, takeProfit: 4 }, { multStopLoss: 3.5, takeProfit: null },
    ])
    assert.deepEqual(new Set(FAMILIAS.momentum.REJILLA.map((c) => c.dias)), new Set([30, 60, 90, 120, 180]))
    assert.deepEqual(new Set(FAMILIAS.caidas.REJILLA.map((c) => `${c.umbralRsi}/${c.dias}`)),
      new Set(['5/5', '5/10', '10/5', '10/10', '15/5', '15/10']))
  })
  test('cada configuración crea una estrategia que cumple el contrato', () => {
    for (const { familia: nombre, config } of todasLasConfiguraciones()) {
      const e = familia(nombre).crear(config, 'vx')
      assert.equal(e.VERSION, 'vx')
      assert.ok(Object.isFrozen(e.PARAMETROS) && Object.isFrozen(e.PARAMETROS_BOT))
      assert.equal(/** @type {any} */ (e.PARAMETROS).familia, nombre)
      assert.deepEqual(/** @type {any} */ (e.PARAMETROS).config, config)
      assert.equal(e.PARAMETROS_BOT.cadenciaHoras, 24)
      assert.deepEqual(Object.keys(e.calcularSenal(entradaDiaria([1, 2, 3]))).sort(), CLAVES_SENAL)
    }
    assert.throws(() => familia('toString'), RangeError)
  })
  test('vecinos a un paso: un solo eje cambia y a un valor contiguo', () => {
    const c = (/** @type {object} */ x) => JSON.stringify(x)
    assert.deepEqual(vecinos('cruce', { rapida: 20, lenta: 100, stop: null }).map(c).sort(), [
      { rapida: 10, lenta: 100, stop: null }, { rapida: 30, lenta: 100, stop: null },
      { rapida: 20, lenta: 50, stop: null }, { rapida: 20, lenta: 200, stop: null },
      { rapida: 20, lenta: 100, stop: 2.5 },
    ].map(c).sort())
    assert.equal(vecinos('cruce', { rapida: 10, lenta: 50, stop: 2.5 }).length, 3)
    assert.deepEqual(vecinos('ruptura', { entrada: 55, salida: 20, stop: null }).map(c).sort(), [
      { entrada: 40, salida: 20, stop: null }, { entrada: 55, salida: 40, stop: null },
      { entrada: 55, salida: 20, stop: 2.5 },
    ].map(c).sort())
    assert.deepEqual(vecinos('ruptura', { entrada: 20, salida: 20, stop: null }).map(c).sort(), [
      { entrada: 40, salida: 20, stop: null }, { entrada: 20, salida: 10, stop: null },
      { entrada: 20, salida: 20, stop: 2.5 },
    ].map(c).sort())
    assert.deepEqual(vecinos('momentum', { dias: 30, revision: 'semanal', stop: 2.5 }).map(c).sort(), [
      { dias: 60, revision: 'semanal', stop: 2.5 }, { dias: 30, revision: 'diaria', stop: 2.5 },
      { dias: 30, revision: 'semanal', stop: null },
    ].map(c).sort())
    assert.equal(vecinos('v1stops', { multStopLoss: 2.5, takeProfit: null }).length, 2)
  })
  test('la clave de señal ignora lo que solo afecta al bot', () => {
    assert.equal(claveSenal('cruce', { rapida: 10, lenta: 50, stop: null }), claveSenal('cruce', { rapida: 10, lenta: 50, stop: 2.5 }))
    assert.notEqual(claveSenal('cruce', { rapida: 10, lenta: 50, stop: null }), claveSenal('cruce', { rapida: 20, lenta: 50, stop: null }))
    assert.equal(claveSenal('v1stops', { multStopLoss: 2.5, takeProfit: 4 }), claveSenal('v1stops', { multStopLoss: 3.5, takeProfit: null }))
  })
})

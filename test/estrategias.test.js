// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { PARAMETROS_BOT } from '../core/bot.js'
import * as v1 from '../core/estrategia-v1.js'
import * as v2 from '../core/estrategia-v2.js'
import { ESTRATEGIAS, ESTRATEGIA_ACTIVA, estrategia } from '../core/estrategias.js'

describe('registro de estrategias', () => {
  test('cada estrategia expone VERSION, PARAMETROS, PARAMETROS_BOT y calcularSenal con su clave', () => {
    for (const [clave, e] of Object.entries(ESTRATEGIAS)) {
      assert.equal(e.VERSION, clave)
      assert.ok(Object.isFrozen(e.PARAMETROS))
      assert.ok(Object.isFrozen(e.PARAMETROS_BOT))
      assert.equal(typeof e.calcularSenal, 'function')
      /** @type {Record<string, unknown>} */
      const bot = e.PARAMETROS_BOT
      for (const k of Object.keys(PARAMETROS_BOT)) assert.equal(typeof bot[k], 'number', `${clave}.${k}`)
    }
  })
  test('v1 usa exactamente los parámetros de bot por defecto', () => {
    assert.equal(ESTRATEGIAS.v1, v1)
    assert.deepEqual(v1.PARAMETROS_BOT, PARAMETROS_BOT)
  })
  test('estrategia(version) devuelve el módulo; una versión desconocida lanza RangeError', () => {
    assert.equal(estrategia('v1'), v1)
    assert.throws(() => estrategia('v99'), RangeError)
    assert.throws(() => estrategia('toString'), RangeError)
  })
  test('la estrategia activa está registrada', () => {
    assert.ok(Object.hasOwn(ESTRATEGIAS, ESTRATEGIA_ACTIVA))
  })
  test('v2 está registrada pero la activa sigue siendo v1: v2 no superó a v1 en TEST (spec §6.6)', () => {
    assert.equal(estrategia('v2'), v2)
    assert.equal(ESTRATEGIA_ACTIVA, 'v1')
  })
})

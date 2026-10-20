// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../core/estrategias.js'

describe('estrategias en vivo', () => {
  test('lista congelada, no vacía, sin repetidas y solo con estrategias registradas', () => {
    assert.ok(Object.isFrozen(ESTRATEGIAS_EN_VIVO))
    assert.ok(ESTRATEGIAS_EN_VIVO.length >= 1)
    assert.equal(new Set(ESTRATEGIAS_EN_VIVO).size, ESTRATEGIAS_EN_VIVO.length)
    for (const v of ESTRATEGIAS_EN_VIVO) assert.ok(Object.hasOwn(ESTRATEGIAS, v), v)
  })

  test('la principal es una de las de en vivo', () => {
    assert.equal(typeof ESTRATEGIA_PRINCIPAL, 'string')
    assert.ok(ESTRATEGIAS_EN_VIVO.includes(ESTRATEGIA_PRINCIPAL))
  })
})

// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { FAMILIA, crear } from '../core/familias/v1stops.js'
import { HORA } from '../core/velas.js'
import { CLAVES_SENAL, serie } from './ayudantes.js'

const FIN = Date.UTC(2021, 0, 4)
/** @param {number} dur */
const velas = (dur) => serie(250, (i) => 100 * (1 + 0.002 * i) * (1 + 0.01 * Math.sin(i / 5)), { duracion: dur, inicio: FIN - 250 * dur })
const entrada = {
  simbolo: 'ETH', ahora: FIN + 3 * 60_000,
  velas: { '1h': velas(HORA), '4h': velas(4 * HORA), '1d': velas(24 * HORA) },
  derivados: null, titulares: [], fng: 50,
}

describe('familia F5: v1 con stops amplios', () => {
  test('la señal es la de v1 con la versión propia y la familia en el detalle', () => {
    const f = crear({ multStopLoss: 2.5, takeProfit: 4 }, 'vx')
    const s = f.calcularSenal(entrada)
    const base = v1.calcularSenal(entrada)
    assert.deepEqual(Object.keys(s).sort(), CLAVES_SENAL)
    assert.equal(s.version, 'vx')
    assert.deepEqual(s.detalle, { ...base.detalle, familia: 'v1stops' })
    assert.deepEqual({ ...s, version: 'v1', detalle: base.detalle }, base)
  })
  test('PARAMETROS: familia, config y los de señal de v1; congelados', () => {
    const f = crear({ multStopLoss: 3.5, takeProfit: null }, 'vx')
    assert.equal(FAMILIA, 'v1stops')
    assert.deepEqual(f.PARAMETROS, { familia: 'v1stops', config: { multStopLoss: 3.5, takeProfit: null }, senal: v1.PARAMETROS })
    assert.ok(Object.isFrozen(f.PARAMETROS) && Object.isFrozen(f.PARAMETROS.config))
  })
  test('bot: decide cada 24 h con SL × ATR14 4H y TP × ATR14 4H o sin TP', () => {
    assert.deepEqual(crear({ multStopLoss: 2.5, takeProfit: 4 }, 'vx').PARAMETROS_BOT, {
      ...v1.PARAMETROS_BOT, cadenciaHoras: 24, multStopLoss: 2.5, multTakeProfit: 4, sinTakeProfit: false,
    })
    const sinTp = crear({ multStopLoss: 3.5, takeProfit: null }, 'vx').PARAMETROS_BOT
    assert.equal(sinTp.sinTakeProfit, true)
    assert.equal(sinTp.multStopLoss, 3.5)
    assert.equal(sinTp.multTakeProfit, v1.PARAMETROS_BOT.multTakeProfit)
    assert.ok(Object.isFrozen(sinTp))
  })
  test('config inválida: RangeError', () => {
    assert.throws(() => crear({ multStopLoss: 0, takeProfit: 4 }, 'vx'), RangeError)
    assert.throws(() => crear({ multStopLoss: 2.5, takeProfit: -1 }, 'vx'), RangeError)
  })
})

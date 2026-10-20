// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { FAMILIA, crear } from '../core/familias/caidas.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

/** 220 días de subida suave (sobre la SMA200), dos caídas de 3 y después +0,2 al día. */
const serie = [...Array.from({ length: 220 }, (_, i) => 100 + 0.5 * i), 206.5, 203.5]
for (let k = 1; k <= 8; k++) serie.push(203.5 + 0.2 * k)
/** Señal con las primeras n velas 1D. @param {ReturnType<typeof crear>} f @param {number} n */
const hasta = (f, n) => f.calcularSenal(entradaDiaria(serie.slice(0, n)))

describe('familia F4: caídas en tendencia 1D', () => {
  const f = crear({ umbralRsi: 10, dias: 5, stop: null }, 'vx')

  test('contrato: PARAMETROS congelados con familia y config; bot diario sin TP', () => {
    assert.equal(FAMILIA, 'caidas')
    assert.deepEqual(f.PARAMETROS, { familia: 'caidas', config: { umbralRsi: 10, dias: 5, stop: null } })
    assert.ok(Object.isFrozen(f.PARAMETROS.config))
    assert.deepEqual(f.PARAMETROS_BOT, { ...v1.PARAMETROS_BOT, cadenciaHoras: 24, sinStopLoss: true, sinTakeProfit: true })
    assert.deepEqual(Object.keys(hasta(f, 222)).sort(), CLAVES_SENAL)
  })
  test('cierre > SMA200 y RSI(2) < u → COMPRAR', () => {
    const s = hasta(f, 222)
    assert.equal(s.veredicto, 'COMPRAR')
    assert.equal(s.detalle.familia, 'caidas')
    assert.equal(s.detalle.indicadores.diasDesdeEntrada, 0)
    assert.ok(s.detalle.indicadores.rsi2 < 10)
    const rsi221 = hasta(f, 221).detalle.indicadores.rsi2
    assert.ok(rsi221 > 10 && rsi221 < 15)
    assert.equal(hasta(f, 221).veredicto, 'VENDER')
    assert.equal(hasta(crear({ umbralRsi: 15, dias: 5, stop: null }, 'vx'), 221).veredicto, 'COMPRAR')
  })
  test('tras la entrada: MANTENER bajo la SMA5; VENDER al cerrar sobre la SMA5', () => {
    assert.equal(hasta(f, 223).veredicto, 'MANTENER')
    assert.equal(hasta(f, 225).veredicto, 'MANTENER')
    const venta = hasta(f, 226)
    assert.equal(venta.veredicto, 'VENDER')
    assert.equal(venta.motivo, 'sobre_sma5')
  })
  test('VENDER por plazo: D días desde la última señal de entrada', () => {
    const corta = crear({ umbralRsi: 10, dias: 2, stop: null }, 'vx')
    assert.equal(hasta(corta, 223).veredicto, 'MANTENER')
    const plazo = hasta(corta, 224)
    assert.equal(plazo.veredicto, 'VENDER')
    assert.equal(plazo.motivo, 'plazo')
  })
  test('bajo la SMA200 no compra aunque el RSI(2) sea bajo', () => {
    const bajista = [...Array.from({ length: 220 }, (_, i) => 300 - 0.5 * i), 187, 184]
    const s = f.calcularSenal(entradaDiaria(bajista))
    assert.ok(s.detalle.indicadores.rsi2 < 10)
    assert.equal(s.veredicto, 'VENDER')
    assert.equal(s.motivo, 'plazo')
  })
  test('menos de 200 velas 1D: SIN_DATOS', () => {
    assert.equal(f.calcularSenal(entradaDiaria(serie.slice(0, 199))).veredicto, 'SIN_DATOS')
  })
  test('config inválida: RangeError', () => {
    assert.throws(() => crear({ umbralRsi: 0, dias: 5, stop: null }, 'vx'), RangeError)
    assert.throws(() => crear({ umbralRsi: 10, dias: 0, stop: null }, 'vx'), RangeError)
  })
})

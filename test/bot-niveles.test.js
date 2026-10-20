// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  FACTOR_SIN_STOP, FACTOR_SIN_TP, PARAMETROS_BOT, estadoInicial, nivelesSalida, pasoMoneda, salidaEnVela,
} from '../core/bot.js'
import { HORA } from '../core/velas.js'
import { vela } from './ayudantes.js'

const T = 1000 * HORA
const AHORA = T + HORA + 3 * 60_000
/** @param {number} c */
const plana = (c) => ({ o: c, h: c, l: c, c })
const senal = { veredicto: 'COMPRAR', puntuacion: 1, indiceConfianza: 1, atrPct: 0.02, fresca: true, motivo: null }

describe('nivelesSalida', () => {
  test('por defecto: múltiplos del ATR, idénticos a la fórmula de v1', () => {
    const n = nivelesSalida(100, 0.02, PARAMETROS_BOT)
    assert.equal(n.stopLoss, 100 * (1 - 1.5 * 0.02))
    assert.equal(n.takeProfit, 100 * (1 + 2.5 * 0.02))
  })
  test('sinStopLoss: stop finito e inalcanzable; sinTakeProfit: objetivo finito e inalcanzable', () => {
    const n = nivelesSalida(100, 0.02, { ...PARAMETROS_BOT, sinStopLoss: true, sinTakeProfit: true })
    assert.equal(n.stopLoss, 100 * FACTOR_SIN_STOP)
    assert.equal(n.takeProfit, 100 * FACTOR_SIN_TP)
    assert.ok(Number.isFinite(n.stopLoss) && n.stopLoss > 0)
    assert.ok(Number.isFinite(n.takeProfit))
  })
  test('cada nivel se desactiva por separado y sin ATR no hace falta', () => {
    const soloSinTp = nivelesSalida(100, 0.02, { ...PARAMETROS_BOT, multStopLoss: 2.5, sinTakeProfit: true })
    assert.equal(soloSinTp.stopLoss, 100 * (1 - 2.5 * 0.02))
    assert.equal(soloSinTp.takeProfit, 100 * FACTOR_SIN_TP)
    const ninguno = nivelesSalida(100, null, { ...PARAMETROS_BOT, sinStopLoss: true, sinTakeProfit: true })
    assert.deepEqual(ninguno, { stopLoss: 100 * FACTOR_SIN_STOP, takeProfit: 100 * FACTOR_SIN_TP })
  })
})

describe('pasoMoneda con niveles desactivados', () => {
  const sinNiveles = Object.freeze({ ...PARAMETROS_BOT, sinStopLoss: true, sinTakeProfit: true })
  test('abre con los niveles inalcanzables y una caída del 90 % o una subida ×100 no la cierran', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal, ahora: AHORA, valorCartera: 10_000,
    }, sinNiveles)
    const pos = r.estado.posiciones.BTC
    assert.equal(pos.stopLoss, pos.precioEntrada * FACTOR_SIN_STOP)
    assert.equal(pos.takeProfit, pos.precioEntrada * FACTOR_SIN_TP)
    assert.equal(salidaEnVela(pos, vela(T + HORA, { o: 100, h: 100, l: 10, c: 10 })), null)
    assert.equal(salidaEnVela(pos, vela(T + HORA, { o: 100, h: 10_000, l: 100, c: 10_000 })), null)
    const despues = pasoMoneda(r.estado, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: 10, c: 10 })],
      senal: { ...senal, veredicto: 'MANTENER' }, ahora: AHORA + HORA, valorCartera: 10_000,
    }, sinNiveles)
    assert.equal(despues.eventos.length, 0)
    assert.ok(despues.estado.posiciones.BTC)
  })
  test('sin las opciones el bot abre exactamente como antes', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal, ahora: AHORA, valorCartera: 10_000,
    })
    const [compra] = r.eventos
    assert.equal(compra.stopLoss, compra.precio * (1 - 1.5 * 0.02))
    assert.equal(compra.takeProfit, compra.precio * (1 + 2.5 * 0.02))
  })
})

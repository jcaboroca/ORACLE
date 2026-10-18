// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  PARAMETROS_BOT, crearHodl, estadoInicial, pasoMoneda, salidaEnVela, valorCartera, valorHodl, velaDeDecision,
} from '../core/bot.js'
import { HORA } from '../core/velas.js'
import { vela } from './ayudantes.js'

const T = 1000 * HORA // inicio de la vela de decisión
const AHORA = T + HORA + 3 * 60_000 // cron al minuto 3 de la hora siguiente
/** @param {number} c */
const plana = (c) => ({ o: c, h: c, l: c, c })
/** @param {Partial<import('../core/bot.js').SenalBot>} s */
const senal = (s = {}) => ({ veredicto: 'COMPRAR', puntuacion: 0.5, indiceConfianza: 0.7, atrPct: 0.02, fresca: true, motivo: null, ...s })
/** @param {number} a @param {number} b */
const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

/** Abre BTC a 100 € con 10.000 € de cartera y devuelve el estado. */
function conPosicion() {
  const r = pasoMoneda(estadoInicial(10_000), {
    simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
  })
  return r.estado
}

describe('velaDeDecision', () => {
  test('al minuto 3 de la hora H es la vela de H−1', () => {
    assert.equal(velaDeDecision(AHORA), T)
  })
})

describe('apertura', () => {
  test('20 % de la cartera, deslizamiento y comisión exactos, SL/TP sobre el precio real', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.accion, 'abrir')
    const [compra] = r.eventos
    assert.equal(compra.importe, 2000)
    cerca(compra.precio, 100.05)
    cerca(compra.comision, 2)
    cerca(compra.unidades, 1998 / 100.05)
    cerca(/** @type {number} */ (compra.stopLoss), 100.05 * (1 - 1.5 * 0.02))
    cerca(/** @type {number} */ (compra.takeProfit), 100.05 * (1 + 2.5 * 0.02))
    assert.equal(r.estado.saldo, 8000)
  })
  test('limitada al saldo y nunca negativo', () => {
    const e = { ...estadoInicial(500), saldo: 500 }
    const r = pasoMoneda(e, { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000 })
    assert.equal(r.eventos[0].importe, 500)
    assert.equal(r.estado.saldo, 0)
  })
  test('por debajo de la orden mínima: saldo_insuficiente', () => {
    const r = pasoMoneda(estadoInicial(9), { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 9 })
    assert.equal(r.decision.motivo, 'saldo_insuficiente')
    assert.equal(r.eventos.length, 0)
  })
  test('índice de confianza bajo: no abre', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ indiceConfianza: 0.59 }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'confianza_baja')
  })
  test('no promedia: COMPRAR con posición abierta no compra más', () => {
    const r = pasoMoneda(conPosicion(), {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal(), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'ya_en_posicion')
    assert.equal(r.eventos.length, 0)
  })
  test('datos desactualizados: no abre', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T - HORA, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'datos_desactualizados')
  })
  test('SIN_DATOS: no hace nada', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ veredicto: 'SIN_DATOS' }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'sin_datos')
  })
  test('no muta el estado de entrada', () => {
    const e = estadoInicial(10_000)
    pasoMoneda(e, { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000 })
    assert.deepEqual(e, estadoInicial(10_000))
  })
})

describe('venta por señal', () => {
  test('VENDER sin posición: registrada como no ejecutada', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ veredicto: 'VENDER' }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.accion, 'ninguna')
    assert.equal(r.decision.motivo, 'sin_posicion')
  })
  test('VENDER con posición: vende todas las unidades con costes', () => {
    const e = conPosicion()
    const unidades = e.posiciones.BTC.unidades
    const r = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(101))], senal: senal({ veredicto: 'VENDER' }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    const [venta] = r.eventos
    assert.equal(venta.motivo, 'senal')
    assert.equal(venta.unidades, unidades)
    cerca(venta.precio, 101 * 0.9995)
    cerca(/** @type {number} */ (venta.pnlNeto), venta.importe - venta.comision - 2000)
    assert.equal(r.estado.posiciones.BTC, undefined)
  })
  test('MANTENER: no opera y conserva el motivo de la señal', () => {
    const r = pasoMoneda(conPosicion(), {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal({ veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados' }),
      ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'contradiccion_tecnico_derivados')
    assert.equal(r.eventos.length, 0)
  })
})

describe('stops', () => {
  const pos = { simbolo: 'BTC', velaEntrada: 0, precioEntrada: 100, unidades: 1, coste: 100, stopLoss: 95, takeProfit: 110 }
  test('toca SL y TP en la misma vela: gana el SL', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 100, h: 111, l: 94, c: 100 })), { base: 95, motivo: 'stop_loss' })
  })
  test('hueco por debajo del SL: sale a la apertura', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 90, h: 91, l: 89, c: 90 })), { base: 90, motivo: 'stop_loss' })
  })
  test('hueco por encima del TP: sale a la apertura', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 112, h: 113, l: 111, c: 112 })), { base: 112, motivo: 'take_profit' })
  })
  test('toca solo el TP', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 100, h: 110, l: 99, c: 105 })), { base: 110, motivo: 'take_profit' })
  })
  test('ni uno ni otro', () => {
    assert.equal(salidaEnVela(pos, vela(HORA, { o: 100, h: 105, l: 96, c: 101 })), null)
  })

  test('recupera velas perdidas: el SL tocado hace 2 h se ejecuta en esa vela', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const velas = [
      vela(T, plana(100)), // vela de entrada: no se revisa
      vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 }),
      vela(T + 2 * HORA, plana(99)),
      vela(T + 3 * HORA, plana(99)),
    ]
    const r = pasoMoneda(e, { simbolo: 'BTC', velasEur: velas, senal: senal({ veredicto: 'MANTENER' }), ahora: AHORA + 3 * HORA, valorCartera: 10_000 })
    assert.equal(r.eventos.length, 1)
    assert.equal(r.eventos[0].motivo, 'stop_loss')
    assert.equal(r.eventos[0].vela, T + HORA)
    cerca(r.eventos[0].precio, sl * 0.9995)
    assert.equal(r.estado.ultimaRevisada.BTC, T + 3 * HORA)
  })
  test('tras un SL no reabre en la misma ejecución ni durante 4 h', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const r1 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })], senal: senal(), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r1.decision.motivo, 'cerrada_por_stop')
    const r2 = pasoMoneda(r1.estado, {
      simbolo: 'BTC', velasEur: [vela(T + 4 * HORA, plana(99))], senal: senal(), ahora: AHORA + 4 * HORA, valorCartera: 10_000,
    })
    assert.equal(r2.decision.motivo, 'enfriamiento')
    const r3 = pasoMoneda(r2.estado, {
      simbolo: 'BTC', velasEur: [vela(T + 5 * HORA, plana(99))], senal: senal(), ahora: AHORA + 5 * HORA, valorCartera: 10_000,
    })
    assert.equal(r3.decision.accion, 'abrir')
  })
  test('SL y TP no cambian tras abrir aunque cambie el ATR', () => {
    const e = conPosicion()
    const { stopLoss, takeProfit } = e.posiciones.BTC
    const r = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal({ atrPct: 0.5 }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.estado.posiciones.BTC.stopLoss, stopLoss)
    assert.equal(r.estado.posiciones.BTC.takeProfit, takeProfit)
  })
  test('repetir la misma ejecución sobre el estado resultante no duplica operaciones', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const entrada = {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })], senal: senal({ veredicto: 'MANTENER' }),
      ahora: AHORA + HORA, valorCartera: 10_000,
    }
    const r1 = pasoMoneda(e, entrada)
    const r2 = pasoMoneda(r1.estado, entrada)
    assert.equal(r1.eventos.length, 1)
    assert.equal(r2.eventos.length, 0)
  })
  test('ignora la vela EUR en curso: no avanza ultimaRevisada y el stop se ejecuta cuando cierra', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const enCurso = vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })
    assert.ok(enCurso.fin > AHORA)
    const r1 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T, plana(100)), enCurso], senal: senal({ veredicto: 'MANTENER' }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r1.eventos.length, 0)
    assert.equal(r1.estado.ultimaRevisada.BTC, T)
    assert.equal(r1.decision.precio, 100)
    const r2 = pasoMoneda(r1.estado, {
      simbolo: 'BTC', velasEur: [vela(T, plana(100)), enCurso], senal: senal({ veredicto: 'MANTENER' }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r2.eventos.length, 1)
    assert.equal(r2.eventos[0].motivo, 'stop_loss')
    assert.equal(r2.eventos[0].vela, T + HORA)
    assert.equal(r2.estado.ultimaRevisada.BTC, T + HORA)
  })
  test('los stops se comprueban aunque la señal sea SIN_DATOS o los datos estén desactualizados', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const velasEur = [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })]
    const r1 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur, senal: senal({ veredicto: 'SIN_DATOS' }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r1.eventos.length, 1)
    assert.equal(r1.eventos[0].motivo, 'stop_loss')
    assert.equal(r1.decision.motivo, 'sin_datos')
    const r2 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur, senal: senal({ veredicto: 'MANTENER', fresca: false }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r2.eventos.length, 1)
    assert.equal(r2.eventos[0].motivo, 'stop_loss')
    assert.equal(r2.decision.motivo, 'datos_desactualizados')
  })
})

describe('parámetros inyectables', () => {
  test('pasoMoneda usa los parámetros recibidos en lugar de los de por defecto', () => {
    const parametros = { ...PARAMETROS_BOT, comision: 0, deslizamiento: 0, fraccionPosicion: 0.5, multStopLoss: 3, multTakeProfit: 4 }
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
    }, parametros)
    const [compra] = r.eventos
    assert.equal(compra.importe, 5000)
    assert.equal(compra.comision, 0)
    assert.equal(compra.precio, 100)
    cerca(/** @type {number} */ (compra.stopLoss), 100 * (1 - 3 * 0.02))
    cerca(/** @type {number} */ (compra.takeProfit), 100 * (1 + 4 * 0.02))
  })
  test('confianza mínima y enfriamiento salen de los parámetros', () => {
    const parametros = { ...PARAMETROS_BOT, confianzaMinima: 0.8, enfriamientoHoras: 1 }
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ indiceConfianza: 0.75 }), ahora: AHORA, valorCartera: 10_000,
    }, parametros)
    assert.equal(r.decision.motivo, 'confianza_baja')
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const r1 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })], senal: senal(), ahora: AHORA + HORA, valorCartera: 10_000,
    }, { ...PARAMETROS_BOT, enfriamientoHoras: 1 })
    assert.equal(r1.estado.enfriamientoHasta.BTC, T + 2 * HORA)
  })
  test('las ventas aplican la comisión y el deslizamiento de los parámetros', () => {
    const e = conPosicion()
    const r = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(101))], senal: senal({ veredicto: 'VENDER' }), ahora: AHORA + HORA, valorCartera: 10_000,
    }, { ...PARAMETROS_BOT, comision: 0.002, deslizamiento: 0 })
    const [venta] = r.eventos
    assert.equal(venta.precio, 101)
    cerca(venta.comision, venta.importe * 0.002)
  })
  test('crearHodl usa los costes recibidos', () => {
    const u = crearHodl(1000, { BTC: 100, ETH: 10 }, { ...PARAMETROS_BOT, comision: 0, deslizamiento: 0 })
    assert.deepEqual(u, { BTC: 5, ETH: 50 })
  })
})

describe('valoración y comprar y mantener', () => {
  test('valorCartera usa precios actuales y, si faltan, el de entrada', () => {
    const e = conPosicion()
    const u = e.posiciones.BTC.unidades
    cerca(valorCartera(e, { BTC: 110 }), 8000 + u * 110)
    cerca(valorCartera(e, {}), 8000 + u * e.posiciones.BTC.precioEntrada)
  })
  test('HODL reparte a partes iguales con costes', () => {
    const u = crearHodl(1000, { BTC: 100, ETH: 10 })
    const { comision, deslizamiento } = PARAMETROS_BOT
    cerca(u.BTC, (500 * (1 - comision)) / (100 * (1 + deslizamiento)))
    cerca(valorHodl(u, { BTC: 100, ETH: 10 }), 1000 * (1 - comision) / (1 + deslizamiento))
  })
})

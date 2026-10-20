// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ESTRATEGIAS } from '../../core/estrategias.js'
import { CAPITAL_MAXIMO as MAX_WORKER, CAPITAL_MINIMO as MIN_WORKER } from '../../worker/src/api.js'
import { crearApi } from '../../js/api.js'
import {
  CAPITAL_MAXIMO, CAPITAL_MINIMO, FILTROS_DECISION, filaOperacion, filaPosicion, filasDecisionesBacktest, filasMetricas,
  filasPorMoneda, filtrarDecisiones, frenteAHodl, lecturaBacktest, notaBacktest, opcionesSimulacion, salidasBacktest, validarCapital,
} from '../../js/cartera.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'

const ESP = '\u00a0'
/** @param {string} v */
const backtest = (v) => JSON.parse(readFileSync(new URL(`../../data/backtest-${v}.json`, import.meta.url), 'utf8'))

async function botReal() {
  const w = await workerSimulado()
  const api = crearApi({ base: BASE, fetch: w.fetch, pin: () => PIN })
  return { api, bot: await api.bot() }
}

describe('bot en la interfaz', () => {
  test('las 14 métricas de §7.7 con etiqueta, a partir del bot real', async () => {
    const { bot } = await botReal()
    const filas = filasMetricas(bot.metricas)
    assert.deepEqual(filas.map((f) => f.etiqueta), [
      'Valor de cartera', 'Saldo disponible', 'Beneficio realizado', 'Beneficio no realizado', 'Rentabilidad neta',
      'Comprar y mantener', 'Drawdown máximo', 'Drawdown de comprar y mantener', 'Operaciones (compras + ventas)',
      'Ganadoras / perdedoras', 'Beneficio medio por operación cerrada', 'Comisiones', 'Deslizamiento', 'Frecuencia',
    ])
    const valor = (/** @type {string} */ e) => filas.find((f) => f.etiqueta === e)?.valor
    assert.equal(valor('Valor de cartera'), `10.030,73${ESP}€`)
    assert.equal(valor('Beneficio realizado'), `+32,74${ESP}€`)
    assert.equal(valor('Rentabilidad neta'), `+0,31${ESP}%`)
    assert.equal(valor('Drawdown máximo'), `-0,62${ESP}%`)
    assert.equal(valor('Ganadoras / perdedoras'), '1 / 1')
    assert.equal(valor('Frecuencia'), '201,6 por semana')
  })

  test('por moneda en el orden pedido, con costes = comisiones + deslizamiento', async () => {
    const { bot } = await botReal()
    const filas = filasPorMoneda(bot.porMoneda, ['ETH', 'BTC'])
    assert.deepEqual(filas.map((f) => f.simbolo), ['ETH', 'BTC'])
    assert.deepEqual([filas[1].ganadorasPerdedoras, filas[1].beneficio, filas[1].clase], ['0 / 1', `-69,10${ESP}€`, 'baja'])
    assert.equal(filas[0].costes, `9,16${ESP}€`)
    assert.deepEqual(filasPorMoneda({}), [])
  })

  test('posiciones abiertas con SL/TP fijos y operaciones con motivo', async () => {
    const { api, bot } = await botReal()
    const p = filaPosicion(bot.abiertas[0])
    assert.deepEqual([p.simbolo, p.stopLoss, p.takeProfit, p.clase], ['ETH', `9,65${ESP}€`, `10,50${ESP}€`, 'sube'])
    assert.equal(p.pnl, `+1,00${ESP}€ (+0,05${ESP}%)`)
    const ops = (await api.operaciones()).items.map(filaOperacion)
    const venta = ops.find((o) => o.lado === 'Venta' && o.simbolo === 'BTC')
    assert.deepEqual([venta?.motivo, venta?.clase], ['Stop-loss', 'baja'])
    assert.equal(ops.find((o) => o.lado === 'Compra')?.pnl, '')
  })

  test('frente a comprar y mantener, en puntos', () => {
    assert.deepEqual(frenteAHodl(-0.185108990116729, 0.19968549372488598),
      { texto: `38,48 puntos por debajo de comprar y mantener (+19,97${ESP}%).`, clase: 'baja', bate: false })
    assert.equal(frenteAHodl(0.1, 0.05).bate, true)
    assert.equal(frenteAHodl(0.1, null).bate, null)
  })

  test('filtro de decisiones: ejecutadas, no ejecutadas (compra/venta) y HOLD', () => {
    const d = [
      { id: 1, veredicto: 'COMPRAR', accion: 'abrir' },
      { id: 2, veredicto: 'COMPRAR', accion: 'ninguna' },
      { id: 3, veredicto: 'MANTENER', accion: 'ninguna' },
      { id: 4, veredicto: 'VENDER', accion: 'ninguna' },
      { id: 5, veredicto: 'VENDER', accion: 'cerrar' },
      { id: 6, veredicto: 'SIN_DATOS', accion: 'ninguna' },
    ]
    const ids = (/** @type {string} */ f) => filtrarDecisiones(d, f).map((x) => x.id)
    assert.deepEqual(FILTROS_DECISION.map((f) => f.clave), ['todas', 'ejecutadas', 'no_ejecutadas', 'hold'])
    assert.deepEqual(ids('todas'), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(ids('ejecutadas'), [1, 5])
    assert.deepEqual(ids('no_ejecutadas'), [2, 4])
    assert.deepEqual(ids('hold'), [3])
    assert.deepEqual(ids('raro'), [1, 2, 3, 4, 5, 6])
  })

  test('selector de simulaciones tras un reinicio', async () => {
    const { api } = await botReal()
    await api.reiniciar(2500)
    const opciones = opcionesSimulacion((await api.simulaciones()).items)
    assert.deepEqual(opciones.map((o) => o.valor), ['2', '1'])
    assert.match(opciones[0].texto, new RegExp(`^Simulación 2 · v1 · 2500,00${ESP}€ · activa desde \\d\\d/\\d\\d/\\d{4}$`))
    assert.match(opciones[1].texto, /^Simulación 1 · v1 · 10\.000,00\s€ · cerrada el \d\d\/\d\d\/\d{4}$/)
  })

  test('validarCapital: formato español y los mismos límites que el Worker', () => {
    assert.deepEqual([CAPITAL_MINIMO, CAPITAL_MAXIMO], [MIN_WORKER, MAX_WORKER])
    assert.deepEqual(validarCapital('10.000'), { ok: true, capital: 10_000 })
    assert.deepEqual(validarCapital('100'), { ok: true, capital: 100 })
    assert.equal(validarCapital('99,99').ok, false)
    assert.equal(validarCapital('1.000.001').ok, false)
    assert.deepEqual(validarCapital('mucho'), { ok: false, error: 'Escribe un importe en euros, por ejemplo 10.000.' })
  })
})

describe('backtest en la interfaz', () => {
  test('hay un data/backtest-vN.json por estrategia registrada', () => {
    for (const v of Object.keys(ESTRATEGIAS)) assert.equal(backtest(v).version, v)
  })

  test('lectura de data/backtest-v1.json: etiqueta, periodo, métricas y curva', () => {
    const b = backtest('v1')
    const l = lecturaBacktest(b)
    assert.equal(l.version, 'v1')
    assert.equal(l.variante, 'técnico + Fear & Greed')
    assert.equal(l.periodo, '19/10/2024 – 19/10/2026')
    assert.equal(l.capitalInicial, `10.000,00${ESP}€`)
    assert.equal(l.cadencia, 'cada hora')
    assert.equal(l.metricas.find((f) => f.etiqueta === 'Rentabilidad neta')?.valor, `-18,46${ESP}%`)
    assert.equal(l.metricas.find((f) => f.etiqueta === 'Comprar y mantener')?.valor, `+21,66${ESP}%`)
    assert.equal(l.rentabilidad, `-18,46${ESP}%`)
    assert.equal(l.frenteHodl.bate, false)
    assert.equal(filasMetricas({ ...b.metricas, drawdownMaximo: 0 }).find((f) => f.etiqueta === 'Drawdown máximo')?.valor, `0,00${ESP}%`)
    assert.deepEqual(l.porMoneda.map((f) => f.simbolo), ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'])
    assert.equal(l.curva.length, b.curvaDiaria.length)
    assert.match(l.aviso, /No es asesoramiento financiero ni garantía de beneficio/)
    assert.equal(lecturaBacktest(backtest('v2')).cadencia, 'una vez al día (00:00 UTC)')
    assert.equal(lecturaBacktest(backtest('v2')).variante, 'técnico + Fear & Greed')
    for (const v of ['v3', 'v4', 'v5']) {
      const bv = backtest(v)
      assert.equal(bv.variante, 'tecnico', v)
      assert.equal(lecturaBacktest(bv).variante, 'solo técnico', v)
      assert.doesNotMatch(bv.aviso, /Variante técnico \+ Fear & Greed/, v)
    }
  })

  test('recuentos de decisiones y de cierres por motivo', () => {
    const b = backtest('v1')
    const filas = filasDecisionesBacktest(b.decisiones)
    assert.deepEqual(filas[0], { veredicto: 'Mantener', claseVeredicto: 'mantener', motivo: 'Mantener', n: 62504, cantidad: '62.504' })
    assert.equal(filas.reduce((s, f) => s + f.n, 0), Object.values(b.decisiones).reduce((s, n) => s + n, 0))
    const salidas = salidasBacktest(b.operaciones)
    assert.deepEqual(salidas.map((s) => s.motivo).sort(), ['Stop-loss', 'Take-profit'], 'v1 no cierra ninguna por VENDER (spec §6.6)')
    assert.equal(salidas.reduce((s, x) => s + Number(x.cantidad.replace('.', '')), 0), b.metricas.cerradas)
  })

  test('nota honesta: ninguna estrategia bate a comprar y mantener', () => {
    assert.equal(notaBacktest([backtest('v1'), backtest('v2')]),
      'Ninguna de las estrategias (v1 y v2) bate a comprar y mantener en este periodo. Un backtest no garantiza resultados futuros.')
    assert.equal(notaBacktest([backtest('v2')]),
      'La estrategia v2 no bate a comprar y mantener en este periodo. Un backtest no garantiza resultados futuros.')
    assert.match(notaBacktest([{ version: 'v9', metricas: { rentabilidad: 0.5, rentabilidadHodl: 0.1 } }]), /^Alguna estrategia supera/)
    assert.equal(notaBacktest([]), 'Un backtest no garantiza resultados futuros.')
  })
})

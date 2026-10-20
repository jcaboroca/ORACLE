// @ts-check
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { MAX_EN_VUELO, crearApi } from '../../js/api.js'
import { filasComparativa, textoConsejo } from '../../js/cartera.js'
import { COLORES, COLORES_ESTRATEGIAS, graficoComparativa } from '../../js/graficos.js'
import { curvasComparativa } from '../../js/series.js'
import { vivoDePrueba } from '../../worker/test/vivo.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'
import { leer } from './modulos.js'

const ESP = '\u00a0'

/** Worker con 3 estrategias de prueba en vivo (la principal, v2) y su cliente. */
async function conTres() {
  const w = await workerSimulado({ vivo: vivoDePrueba(['v1', 'v2', 'v1b'], 'v2') })
  return { w, api: crearApi({ base: BASE, fetch: w.fetch, pin: () => PIN }) }
}

describe('comparativa de estrategias en la interfaz', () => {
  afterEach(() => { delete (/** @type {any} */ (globalThis)).LightweightCharts })

  test('api.comparativa() contra el Worker real: ruta y forma del contrato', async () => {
    const { w, api } = await conTres()
    const c = await api.comparativa()
    assert.equal(w.llamadas[0].url, `${BASE}/api/bot/comparativa`)
    assert.deepEqual(Object.keys(c), ['ahora', 'simulaciones', 'hodl', 'resumenHodl'])
    assert.deepEqual(c.simulaciones.map((/** @type {any} */ s) => [s.estrategiaVersion, s.etiqueta, s.principal]), [
      ['v1', 'v1', false], ['v2', 'v2', true], ['v1b', 'v1 al 10 %', false],
    ])
    assert.ok(c.simulaciones.every((/** @type {any} */ s) => s.curva.length === 6 && s.curva.every((/** @type {any} */ p) => Object.keys(p).join() === 't,valor')))
    assert.equal(c.hodl.length, 6)
  })

  test('curvasComparativa: una línea por estrategia y comprar y mantener, en segundos crecientes y sin repetidos', async () => {
    const { api } = await conTres()
    const c = await api.comparativa()
    const curvas = curvasComparativa(c)
    assert.deepEqual(curvas.estrategias.map((e) => e.etiqueta), ['v1', 'v2', 'v1 al 10 %'])
    for (const [i, e] of curvas.estrategias.entries()) {
      assert.deepEqual(e.puntos, c.simulaciones[i].curva.map((/** @type {any} */ p) => ({ time: p.t / 1000, value: p.valor })))
    }
    assert.deepEqual(curvas.hodl.map((p) => p.value), c.hodl.map((/** @type {any} */ p) => p.valor))
    const raro = curvasComparativa({
      simulaciones: [{ estrategiaVersion: 'v9', curva: [{ t: 2000, valor: 2 }, { t: 1000, valor: 1 }, { t: 2500, valor: 3 }, { t: 3000, valor: Number.NaN }] }],
    })
    assert.deepEqual(raro, { estrategias: [{ etiqueta: 'v9', puntos: [{ time: 1, value: 1 }, { time: 2, value: 3 }] }], hodl: [] })
    assert.deepEqual(curvasComparativa({}), { estrategias: [], hodl: [] })
  })

  test('filasComparativa: una fila por estrategia (la principal marcada) y comprar y mantener al final', async () => {
    const { api } = await conTres()
    const c = await api.comparativa()
    const filas = filasComparativa(c)
    assert.deepEqual(filas.map((f) => [f.id, f.estrategia, f.principal]), [
      [1, 'v1', false], [2, 'v2 (principal)', true], [3, 'v1b · v1 al 10 %', false], [null, 'Comprar y mantener', false],
    ])
    assert.match(filas[0].valor, new RegExp(`^\\d{1,2}\\.\\d{3},\\d\\d${ESP}€$`))
    assert.match(filas[0].rentabilidad, new RegExp(`^[+-]?\\d+,\\d\\d${ESP}%$`))
    assert.equal(filas[0].operaciones, String(c.simulaciones[0].operaciones))
    assert.equal(filas[3].operaciones, '—')
    assert.deepEqual(filasComparativa({
      simulaciones: [{ id: 7, estrategiaVersion: 'v3', etiqueta: 'v3', principal: true, valorCartera: 10_000, rentabilidad: 0, drawdownMaximo: 0.1234, operaciones: 0 }],
      resumenHodl: null,
    }), [{
      id: 7, estrategia: 'v3 (principal)', valor: `10.000,00${ESP}€`, rentabilidad: `0,00${ESP}%`, caida: `-12,34${ESP}%`, operaciones: '0', clase: 'neutro', principal: true,
    }])
    assert.deepEqual(filasComparativa(null), [])
  })

  test('graficoComparativa: comprar y mantener discontinua y una línea por estrategia con su color, en euros, encuadrado', () => {
    /** @type {{ op: any, datos: any[] }[]} */
    const series = []
    let ajustado = false
    let eliminado = false
    const grafico = {
      addSeries: (/** @type {string} */ _def, /** @type {any} */ op) => {
        const s = { op, datos: /** @type {any[]} */ ([]) }
        series.push(s)
        return { setData: (/** @type {any[]} */ d) => { s.datos = d } }
      },
      timeScale: () => ({ fitContent: () => { ajustado = true } }),
      remove: () => { eliminado = true },
    }
    Object.assign(globalThis, { LightweightCharts: { LineSeries: 'linea', createChart: () => grafico } })
    const curvas = {
      estrategias: ['v3', 'v4', 'v5'].map((etiqueta, i) => ({ etiqueta, puntos: [{ time: 1, value: 10_000 }, { time: 2, value: 10_000 + i }] })),
      hodl: [{ time: 1, value: 10_000 }, { time: 2, value: 9_000 }],
    }
    const limpiar = graficoComparativa(/** @type {any} */ ({}), curvas)
    assert.deepEqual(series.map((s) => s.op.title), ['Comprar y mantener', 'v3', 'v4', 'v5'])
    assert.deepEqual(series.map((s) => s.op.color), [COLORES.hodl, ...COLORES_ESTRATEGIAS.slice(0, 3)])
    assert.equal(series[0].op.lineStyle, 2)
    assert.deepEqual(series[2].datos, curvas.estrategias[1].puntos)
    assert.equal(series[1].op.priceFormat.formatter(10085.4), '10.085')
    assert.equal(ajustado, true)
    limpiar()
    assert.equal(eliminado, true)
  })

  test('textoConsejo: el Panel dice qué estrategia da el consejo', async () => {
    const { api } = await conTres()
    const r = await api.resumen()
    assert.deepEqual(r.estrategiaPrincipal, { version: 'v2', etiqueta: 'v2', enVivo: 3 })
    assert.equal(textoConsejo(r.estrategiaPrincipal), 'Consejo de la estrategia v2, la principal de las 3 en vivo.')
    assert.equal(textoConsejo({ version: 'v3', etiqueta: 'Ruptura 55/20', enVivo: 1 }), 'Consejo de la estrategia v3 (Ruptura 55/20).')
    assert.equal(textoConsejo(undefined), '')
  })

  test('reiniciar con 3 estrategias: 3 nuevas con el mismo capital; simulacion es la nueva principal', async () => {
    const { api } = await conTres()
    const r = await api.reiniciar(5000)
    assert.deepEqual(r.simulaciones.map((/** @type {any} */ s) => [s.estrategiaVersion, s.capitalInicial, s.activa]), [
      ['v1', 5000, true], ['v2', 5000, true], ['v1b', 5000, true],
    ])
    assert.equal(r.simulacion.estrategiaVersion, 'v2')
    const sims = (await api.simulaciones()).items
    assert.equal(sims.filter((/** @type {any} */ s) => s.activa).length, 3)
    assert.equal(sims.filter((/** @type {any} */ s) => !s.activa).length, 3)
  })

  test(`la vista Bot (comparativa, bot y 3 a la vez) refrescada varias veces: nunca más de ${MAX_EN_VUELO} en vuelo`, async () => {
    let enVuelo = 0
    let maximo = 0
    /** @type {string[]} */
    const rutas = []
    const api = crearApi({
      base: BASE, pin: () => PIN,
      fetch: async (url) => {
        rutas.push(new URL(String(url)).pathname)
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        await new Promise((r) => setTimeout(r, 2))
        enVuelo--
        return new Response('{"ok":true}')
      },
    })
    for (let i = 0; i < 3; i++) {
      await api.comparativa()
      await api.bot()
      await Promise.all([api.simulaciones(), api.operaciones({ simulacion: 1 }), api.decisiones({ simulacion: 1 })])
    }
    assert.equal(rutas.length, 15)
    assert.equal(rutas[0], '/api/bot/comparativa')
    assert.equal(maximo, MAX_EN_VUELO)
  })
})

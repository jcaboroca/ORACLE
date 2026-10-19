// @ts-check
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, test } from 'node:test'
import { ATRIBUCION, COLORES, graficoCurva, graficoVelas } from '../../js/graficos.js'
import { curvaComparada, etiquetaTick, indicadoresDe } from '../../js/series.js'
import { serie } from '../ayudantes.js'

/** @param {string} ruta */
const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url))

describe('librería de gráficos (vendor)', () => {
  test('TradingView Lightweight Charts v5.2.1 sin modificar, con su licencia y su NOTICE', () => {
    const js = leer('vendor/lightweight-charts.standalone.production.js')
    assert.equal(createHash('sha256').update(js).digest('hex'), 'e21cc5caa0226ef30bd8549c50b9ef926615f2a4ee6b4e486353477a55f598cf')
    assert.match(js.toString('utf8', 0, 200), /TradingView Lightweight Charts™ v5\.2\.1/)
    assert.match(leer('vendor/lightweight-charts-LICENSE.txt').toString(), /Apache License\s+Version 2\.0/)
    assert.equal(leer('vendor/lightweight-charts-NOTICE.txt').toString(), `${ATRIBUCION.producto}\n${ATRIBUCION.copyright} ${ATRIBUCION.url}\n`)
  })
})

/** Doble de la API de Lightweight Charts v5 que anota lo que se le pide. */
function libreriaFalsa() {
  const registro = {
    /** @type {any} */ opciones: null,
    /** @type {{ def: string, op: any, panel: number|undefined, datos: any[] }[]} */ series: [],
    /** @type {number[]} */ guias: [],
    /** @type {number[]} */ alturas: [],
    /** @type {any} */ rango: null,
    ajustado: false,
    eliminado: false,
  }
  const panel = { setHeight: (/** @type {number} */ alto) => { registro.alturas.push(alto) } }
  const grafico = {
    /** @param {string} def @param {any} op @param {number} [indicePanel] */
    addSeries(def, op, indicePanel) {
      const s = { def, op, panel: indicePanel, datos: /** @type {any[]} */ ([]) }
      registro.series.push(s)
      return {
        setData: (/** @type {any[]} */ d) => { s.datos = d },
        createPriceLine: (/** @type {{ price: number }} */ o) => { registro.guias.push(o.price) },
      }
    },
    panes: () => [{ setHeight: () => {} }, panel],
    timeScale: () => ({
      setVisibleLogicalRange: (/** @type {any} */ r) => { registro.rango = r },
      fitContent: () => { registro.ajustado = true },
    }),
    remove: () => { registro.eliminado = true },
  }
  const L = {
    CandlestickSeries: 'velas',
    LineSeries: 'linea',
    createChart: (/** @type {unknown} */ _contenedor, /** @type {any} */ op) => {
      registro.opciones = op
      return grafico
    },
  }
  return { L, registro }
}

describe('gráficos', () => {
  afterEach(() => { delete (/** @type {any} */ (globalThis)).LightweightCharts })

  test('sin la librería, error legible (la vista lo muestra en lugar del gráfico)', () => {
    assert.throws(() => graficoVelas(/** @type {any} */ ({}), { velas: [], indicadores: indicadoresDe([]) }), /^Error: No se pudo cargar la librería de gráficos\.$/)
  })

  test('velas con EMA20/50/200 y panel de RSI con guías 30 y 70, en español y con el logo de TradingView', () => {
    const { L, registro } = libreriaFalsa()
    Object.assign(globalThis, { LightweightCharts: L })
    const velas = serie(300, (i) => 72000 + i)
    const limpiar = graficoVelas(/** @type {any} */ ({}), { velas, indicadores: indicadoresDe(velas) })
    assert.equal(registro.opciones.layout.attributionLogo, true)
    assert.equal(registro.opciones.localization.locale, 'es-ES')
    assert.equal(registro.opciones.timeScale.tickMarkFormatter, etiquetaTick)
    assert.equal(registro.opciones.autoSize, true)
    assert.deepEqual(registro.series.map((s) => [s.def, s.panel ?? 0]), [['velas', 0], ['linea', 0], ['linea', 0], ['linea', 0], ['linea', 1]])
    assert.equal(registro.series[0].datos.length, 300)
    assert.equal(registro.series[0].op.priceFormat.formatter(72857.05), '72.857,05')
    assert.deepEqual(registro.series.slice(1, 4).map((s) => s.op.color), [COLORES.ema20, COLORES.ema50, COLORES.ema200])
    assert.equal(registro.series[3].datos.length, 300 - 199)
    assert.deepEqual(registro.guias, [30, 70])
    assert.deepEqual(registro.alturas, [110])
    assert.deepEqual(registro.rango, { from: 180, to: 302 })
    limpiar()
    assert.equal(registro.eliminado, true)
  })

  test('curva: comprar y mantener y bot en euros sin decimales, encuadrada entera', () => {
    const { L, registro } = libreriaFalsa()
    Object.assign(globalThis, { LightweightCharts: L })
    const curva = curvaComparada([{ t: 0, valor: 10_000, hodl: 10_000 }, { t: 3_600_000, valor: 10_050, hodl: 9_990 }])
    graficoCurva(/** @type {any} */ ({}), curva)
    assert.deepEqual(registro.series.map((s) => s.op.title), ['Comprar y mantener', 'Bot'])
    assert.deepEqual(registro.series[1].datos, curva.bot)
    assert.equal(registro.series[0].op.priceFormat.formatter(10085.4), '10.085')
    assert.equal(registro.ajustado, true)
  })

  test('el logo de TradingView no se desactiva en ningún gráfico', () => {
    assert.match(leer('js/graficos.js').toString(), /attributionLogo: true/)
    assert.doesNotMatch(leer('js/graficos.js').toString(), /attributionLogo: false/)
  })
})

// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ema, rsi } from '../../core/indicadores.js'
import { DURACION } from '../../core/velas.js'
import { aRespuestaOkx, cuerposConsumidos, simularFetch } from '../../worker/test/ayudantes.js'
import { curvaComparada, datosVelas, etiquetaTick, formatoNumero, formatoPrecio, indicadoresDe, linea, velasDeMoneda } from '../../js/series.js'
import { BINANCE, OKX, leerKlines, leerVelasOkx, velasOkx } from '../../js/velas.js'
import { serie } from '../ayudantes.js'

const KLINES_BTCEUR = JSON.parse(readFileSync(new URL('./fixtures/binance-klines-BTCEUR-1h.json', import.meta.url), 'utf8'))
const OKX_BTCEUR = JSON.parse(readFileSync(new URL('../../worker/test/fixtures/okx-candles-BTC-EUR-1H.json', import.meta.url), 'utf8'))

/** Velas → filas de /api/v3/klines de Binance (mismo formato: textos y cierre en el ms anterior). @param {import('../../core/velas.js').Vela[]} velas */
const aFilasBinance = (velas) => velas.map((v) => [
  v.inicio, String(v.apertura), String(v.maximo), String(v.minimo), String(v.cierre), String(v.volumen), v.fin - 1, '0', 1, '0', '0', '0',
])

describe('velas del navegador: Binance y, si falla, OKX', () => {
  test('pide el par en euros a data-api.binance.vision (respuesta real grabada)', async () => {
    const fetch = simularFetch(() => ({ cuerpo: KLINES_BTCEUR }))
    const r = await velasDeMoneda({ simbolo: 'BTC', temporalidad: '4h', fetch })
    assert.equal(fetch.llamadas[0].url, `${BINANCE}?symbol=BTCEUR&interval=4h&limit=500`)
    assert.deepEqual([r.par, r.divisa, r.respaldo, r.fuente], ['BTCEUR', 'EUR', false, 'Binance'])
    assert.equal(r.velas.length, 3)
    assert.deepEqual(r.velas[0], {
      inicio: 1792350000000, fin: 1792353600000, apertura: 72227.92, maximo: 72256.2, minimo: 71897.67, cierre: 71989.84, volumen: 1.98418,
    })
  })

  test('Binance caído → velas en euros de OKX (respuesta real grabada, de la más antigua a la más reciente)', async () => {
    const fetch = simularFetch((url) => (url.startsWith(BINANCE) ? { error: new TypeError('Failed to fetch') } : { cuerpo: OKX_BTCEUR }))
    const r = await velasDeMoneda({ simbolo: 'BTC', temporalidad: '1h', fetch })
    assert.equal(fetch.llamadas[1].url, `${OKX}?instId=BTC-EUR&bar=1H&limit=300`)
    assert.deepEqual([r.par, r.divisa, r.respaldo, r.fuente], ['BTC-EUR', 'EUR', false, 'OKX'])
    assert.deepEqual(r.velas.map((v) => v.inicio), [1792357200000, 1792360800000, 1792364400000])
    assert.deepEqual(r.velas[0], {
      inicio: 1792357200000, fin: 1792360800000, apertura: 72096.9, maximo: 72489.4, minimo: 72096.9, cierre: 72454.4, volumen: 7.0800421,
    })
    assert.ok(cuerposConsumidos(fetch))
  })

  test('barras de OKX: 4H y la diaria en UTC', async () => {
    const velas = serie(5, (i) => 100 + i, { duracion: DURACION['1d'], inicio: 20_000 * DURACION['1d'] })
    const fetch = simularFetch(() => ({ cuerpo: aRespuestaOkx(velas, Infinity) }))
    const r = await velasOkx(fetch, 'ETH-EUR', '1d')
    assert.equal(fetch.llamadas[0].url, `${OKX}?instId=ETH-EUR&bar=1Dutc&limit=300`)
    assert.deepEqual(r, velas)
    await velasOkx(fetch, 'ETH-EUR', '4h', 500)
    assert.equal(fetch.llamadas[1].url, `${OKX}?instId=ETH-EUR&bar=4H&limit=300`)
  })

  test('sin par en euros (error o lista vacía) en ninguna fuente usa USDT y lo marca como respaldo', async () => {
    const velas = serie(30, (i) => 100 + i)
    const sinEur = [
      { binance: { estado: 400, cuerpo: { code: -1121, msg: 'Invalid symbol.' } }, okx: { cuerpo: { code: '51001', msg: 'Instrument ID does not exist', data: [] } } },
      { binance: { cuerpo: [] }, okx: { cuerpo: { code: '0', msg: '', data: [] } } },
    ]
    for (const eur of sinEur) {
      const fetch = simularFetch((url) => {
        if (url.includes('symbol=XYZEUR')) return eur.binance
        if (url.includes('instId=XYZ-EUR')) return eur.okx
        return { cuerpo: aFilasBinance(velas) }
      })
      const r = await velasDeMoneda({ simbolo: 'XYZ', temporalidad: '1h', fetch })
      assert.deepEqual([r.par, r.divisa, r.respaldo, r.fuente, r.velas.length], ['XYZUSDT', 'USDT', true, 'Binance', 30])
      assert.deepEqual(r.velas, velas)
      assert.equal(fetch.llamadas.length, 3)
    }
  })

  test('si fallan todas las fuentes lanza en vez de inventar precios', async () => {
    const fetch = simularFetch((url) => {
      if (url.startsWith(OKX)) return { estado: 429, cuerpo: { code: '50011', msg: 'Too Many Requests' } }
      return url.includes('EUR') ? { error: new TypeError('Failed to fetch') } : { cuerpo: [[1, 'x']] }
    })
    await assert.rejects(velasDeMoneda({ simbolo: 'BTC', temporalidad: '1d', fetch }),
      /^Error: No se pudieron descargar velas de BTC \(Binance BTCEUR: Failed to fetch; OKX BTC-EUR: HTTP 429; Binance BTCUSDT: klines: fila mal formada; OKX BTC-USDT: HTTP 429\)\.$/)
    assert.equal(fetch.llamadas.length, 4)
  })

  test('filas no válidas de Binance y de OKX se rechazan', () => {
    const fila = [0, '1', '2', '0.5', '1.5', '10', 3_599_999]
    assert.equal(leerKlines([fila]).length, 1)
    assert.throws(() => leerKlines({}), /no es una lista/)
    assert.throws(() => leerKlines([[0, '1', '2', '0.5', '1.5', '10', -1]]), /tiempos no válidos/)
    assert.throws(() => leerKlines([[0, '1', '0.9', '0.5', '1.5', '10', 3_599_999]]), /OHLC incoherente/)
    assert.throws(() => leerKlines([[0, 'NaN', '2', '0.5', '1.5', '10', 3_599_999]]), /precio no válido/)
    assert.throws(() => leerKlines([fila, fila]), /desordenadas o repetidas/)
    const okx = (/** @type {unknown[][]} */ data) => ({ code: '0', msg: '', data })
    assert.throws(() => leerVelasOkx({ code: '51001', msg: 'no existe', data: [] }, 3_600_000), /^Error: OKX 51001: no existe$/)
    assert.throws(() => leerVelasOkx(okx([['3600000', '1', '2', '0.5', '1.5', '-1']]), 3_600_000), /volumen no válido/)
    assert.throws(() => leerVelasOkx(okx([['0', '1', '2', '0.5', '1.5', '1']]), 3_600_000), /tiempo no válido/)
    assert.throws(() => leerVelasOkx(okx([['3600000', '1', '2', '0.5', '1.5', '1'], ['7200000', '1', '2', '0.5', '1.5', '1']]), 3_600_000),
      /desordenadas o repetidas/)
  })
})

describe('series para lightweight-charts', () => {
  const velas = serie(260, (i) => 100 + 10 * Math.sin(i / 9) + i / 10)

  test('velas en segundos UTC con OHLC', () => {
    const d = datosVelas(velas)
    assert.equal(d.length, 260)
    assert.deepEqual(d[1], { time: 3600, open: velas[0].cierre, high: velas[1].maximo, low: velas[1].minimo, close: velas[1].cierre })
  })

  test('eje de precios a la española: 2 decimales desde 1 €, 4 por debajo', () => {
    const f = formatoPrecio(serie(3, () => 72857.05))
    assert.deepEqual([f.type, f.minMove, f.formatter(72857.05)], ['custom', 0.01, '72.857,05'])
    const g = formatoPrecio(serie(3, () => 0.52))
    assert.deepEqual([g.minMove, g.formatter(0.523456)], [0.0001, '0,5235'])
    assert.equal(formatoNumero(0).formatter(10085.4), '10.085')
  })

  test('EMA20/50/200 y RSI14 iguales a los de core, sin los null iniciales', () => {
    const cierres = velas.map((v) => v.cierre)
    const ind = indicadoresDe(velas)
    assert.equal(ind.ema20.length, 260 - 19)
    assert.equal(ind.ema50.length, 260 - 49)
    assert.equal(ind.ema200.length, 260 - 199)
    assert.equal(ind.rsi.length, 260 - 14)
    assert.deepEqual(ind.ema200[0], { time: 199 * 3600, value: ema(cierres, 200)[199] })
    assert.equal(ind.rsi.at(-1)?.value, rsi(cierres, 14)[259])
    assert.deepEqual(linea(velas.slice(0, 3), [null, 1, null]), [{ time: 3600, value: 1 }])
  })

  test('con menos de 200 velas la EMA200 queda vacía (no se finge)', () => {
    assert.deepEqual(indicadoresDe(velas.slice(0, 150)).ema200, [])
  })

  test('curva del bot y de comprar y mantener: tiempos únicos crecientes y HODL ausente sin punto', () => {
    const c = curvaComparada([
      { t: 7_200_000, valor: 10_010, hodl: 9_990 },
      { t: 3_600_000, valor: 10_000, hodl: null },
      { t: 7_200_500, valor: 10_020, hodl: 9_980 },
    ])
    assert.deepEqual(c.bot, [{ time: 3600, value: 10_000 }, { time: 7200, value: 10_020 }])
    assert.deepEqual(c.hodl, [{ time: 7200, value: 9_980 }])
  })

  test('etiquetas del eje en hora de Madrid', () => {
    const t = 1792361228 // 19/10/2026 00:07 en Madrid, 18/10 22:07 UTC
    assert.equal(etiquetaTick(t, 0), '2026')
    assert.match(etiquetaTick(t, 1), /^oct\.?$/)
    assert.equal(etiquetaTick(t, 2), '19')
    assert.equal(etiquetaTick(t, 3), '00:07')
    assert.equal(etiquetaTick(t, 4), '00:07:08')
  })
})

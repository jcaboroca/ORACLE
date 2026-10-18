// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA, desdeBinance } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { BINANCE, LIMITE_EUR, cambio24h, descargarMoneda, descargarVelas, leerKlines, ultimoCierre } from '../src/fuentes/binance.js'
import {
  FAPI, completarDerivados, descargarDerivados, leerFunding, leerLongShort, leerOpenInterest,
} from '../src/fuentes/derivados.js'
import { FNG, descargarFng, leerFng } from '../src/fuentes/fng.js'
import { fixtureJson, simularFetch } from './ayudantes.js'

const KLINES = fixtureJson('binance-klines-BTCEUR-1h.json')

describe('binance', () => {
  test('valida y convierte el fixture real de klines', async () => {
    const fetch = simularFetch(() => ({ cuerpo: KLINES }))
    const velas = await descargarVelas(fetch, 'BTCEUR', '1h')
    assert.equal(fetch.llamadas[0].url, `${BINANCE}?symbol=BTCEUR&interval=1h&limit=300`)
    assert.equal(velas.length, 3)
    assert.deepEqual(velas[0], {
      inicio: 1792350000000, fin: 1792353600000, apertura: 72227.92, maximo: 72256.2, minimo: 71897.67,
      cierre: 71989.84, volumen: 1.98418,
    })
  })

  test('rechaza respuestas mal formadas mientras las convierte (una sola pasada)', () => {
    const buena = KLINES[0]
    assert.throws(() => leerKlines({ code: -1121 }), /no es una lista/)
    assert.throws(() => leerKlines([buena.slice(0, 6)]), /mal formada/)
    assert.throws(() => leerKlines([[buena[0], 'NaN', ...buena.slice(2)]]), /precio no válido/)
    assert.throws(() => leerKlines([[buena[0], '0', ...buena.slice(2)]]), /precio no válido/)
    assert.throws(() => leerKlines([[buena[0], buena[1], '1', ...buena.slice(3)]]), /OHLC incoherente/)
    assert.throws(() => leerKlines([[buena[0], ...buena.slice(1, 5), '-1', ...buena.slice(6)]]), /volumen/)
    assert.throws(() => leerKlines([[buena[0], ...buena.slice(1, 6), buena[0] - 1, ...buena.slice(7)]]), /tiempos/)
    assert.throws(() => leerKlines([KLINES[1], KLINES[0]]), /desordenadas/)
    assert.throws(() => leerKlines([KLINES[0], KLINES[0]]), /desordenadas/)
    assert.deepEqual(leerKlines([]), [])
    assert.deepEqual(leerKlines(KLINES), desdeBinance(KLINES), 'mismas velas que la conversión de core/velas.js')
  })

  test('HTTP de error → excepción con el código', async () => {
    const fetch = simularFetch(() => ({ estado: 451, cuerpo: '' }))
    await assert.rejects(descargarVelas(fetch, 'BTCUSDT', '4h'), /HTTP 451/)
  })

  test('descargarMoneda pide 4 series; la que falla queda vacía y se anota', async () => {
    const fetch = simularFetch((url) => (url.includes('interval=4h') ? { estado: 500, cuerpo: '' } : { cuerpo: KLINES }))
    const m = await descargarMoneda(fetch, 'BTC')
    assert.deepEqual(fetch.llamadas.map((l) => l.url), [
      `${BINANCE}?symbol=BTCUSDT&interval=1h&limit=300`,
      `${BINANCE}?symbol=BTCUSDT&interval=4h&limit=300`,
      `${BINANCE}?symbol=BTCUSDT&interval=1d&limit=300`,
      `${BINANCE}?symbol=BTCEUR&interval=1h&limit=48`,
    ])
    assert.equal(LIMITE_EUR, 48)
    assert.equal(m.velas['1h'].length, 3)
    assert.deepEqual(m.velas['4h'], [])
    assert.equal(m.velasEur.length, 3)
    assert.deepEqual(m.fallos, ['velas BTCUSDT 4h: HTTP 500'])
  })

  test('ultimoCierre ignora la vela en curso del fixture', () => {
    const velas = leerKlines(KLINES)
    const ahora = 1792357200000 + 3 * 60_000 // la 3.ª vela del fixture sigue abierta
    assert.equal(ultimoCierre(velas, ahora), 72096.96)
    assert.equal(ultimoCierre([], ahora), null)
  })

  test('cambio24h compara con el cierre de 24 velas antes; null si faltan', () => {
    const velas = serie(30, (i) => 100 + i, { inicio: 0 })
    const ahora = 30 * HORA
    assert.equal(cambio24h(velas, ahora), 129 / 105 - 1)
    assert.equal(cambio24h(velas.slice(0, 24), ahora), null)
    const conHueco = [...velas.slice(0, 5), ...velas.slice(6)]
    assert.equal(cambio24h(conHueco, ahora), null)
  })
})

describe('derivados', () => {
  test('funding de una moneda desde el fixture real de premiumIndex?symbol=', () => {
    const fila = fixtureJson('binance-premiumIndex-BTCUSDT.json')
    assert.equal(leerFunding(fila, 'BTC'), 0.00003034)
    assert.throws(() => leerFunding(fila, 'ETH'), /otra moneda/)
    assert.throws(() => leerFunding([fila], 'BTC'), /no es un objeto/)
    assert.throws(() => leerFunding({ ...fila, lastFundingRate: 'x' }, 'BTC'), /funding no válido/)
  })

  test('long/short del fixture real', () => {
    assert.equal(leerLongShort(fixtureJson('binance-globalLongShortAccountRatio-BTCUSDT.json')), 1.8281)
    assert.throws(() => leerLongShort([]), /no válida/)
    assert.throws(() => leerLongShort([{ longShortRatio: 'x' }]), /ratio/)
  })

  test('open interest 24 h del fixture real (25 puntos horarios)', () => {
    const oi = leerOpenInterest(fixtureJson('binance-openInterestHist-BTCUSDT.json'))
    assert.ok(Math.abs(oi - (93600.797 / 93889.938 - 1)) < 1e-12)
    const puntos = fixtureJson('binance-openInterestHist-BTCUSDT.json')
    assert.throws(() => leerOpenInterest(puntos.slice(1)), /faltan puntos/)
    assert.throws(() => leerOpenInterest([...puntos.slice(0, 24), { ...puntos[24], timestamp: 0 }]), /24 h/)
  })

  test('descargarDerivados: 3·n peticiones pequeñas (premiumIndex por moneda) y cada dato por su lado', async () => {
    const fetch = simularFetch((url) => {
      if (url.includes('/fapi/v1/premiumIndex?symbol=')) {
        const simbolo = new URL(url).searchParams.get('symbol')
        return { cuerpo: { ...fixtureJson('binance-premiumIndex-BTCUSDT.json'), symbol: simbolo, lastFundingRate: simbolo === 'ETHUSDT' ? '0.0000112' : '0.00003034' } }
      }
      if (url.includes('globalLongShortAccountRatio')) return { cuerpo: fixtureJson('binance-globalLongShortAccountRatio-BTCUSDT.json') }
      if (url.includes('symbol=ETHUSDT')) return { estado: 451, cuerpo: '' }
      return { cuerpo: fixtureJson('binance-openInterestHist-BTCUSDT.json') }
    })
    const { base, fallos } = await descargarDerivados(fetch, ['BTC', 'ETH'])
    assert.equal(fetch.llamadas.length, 6)
    assert.deepEqual(fetch.llamadas.slice(0, 3).map((l) => l.url), [
      `${FAPI}/fapi/v1/premiumIndex?symbol=BTCUSDT`,
      `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`,
      `${FAPI}/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25`,
    ])
    assert.equal(base.BTC.funding, 0.00003034)
    assert.equal(base.BTC.ratioLongShort, 1.8281)
    assert.ok(base.BTC.oiCambio24h !== null)
    assert.equal(base.ETH.funding, 0.0000112)
    assert.equal(base.ETH.oiCambio24h, null)
    assert.deepEqual(fallos, ['derivados open interest ETH: HTTP 451'])
  })

  test('todo fapi bloqueado → derivados ausentes (null) y fallos anotados', async () => {
    const fetch = simularFetch(() => ({ estado: 451, cuerpo: '' }))
    const { base, fallos } = await descargarDerivados(fetch, ['BTC'])
    assert.equal(fallos.length, 3)
    assert.equal(completarDerivados(base.BTC, 0.01), null)
  })

  test('completarDerivados añade el cambio de precio 24 h', () => {
    assert.deepEqual(
      completarDerivados({ funding: 0.0001, ratioLongShort: null, oiCambio24h: null }, -0.02),
      { funding: 0.0001, ratioLongShort: null, oiCambio24h: null, precioCambio24h: -0.02 },
    )
    assert.equal(completarDerivados(undefined, 0), null)
  })
})

describe('fear & greed', () => {
  test('lee el fixture real de alternative.me', async () => {
    const fetch = simularFetch(() => ({ cuerpo: fixtureJson('alternative-fng.json') }))
    assert.deepEqual(await descargarFng(fetch), { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.equal(fetch.llamadas[0].url, FNG)
  })

  test('rechaza valores fuera de 0-100 o sin fecha', () => {
    assert.throws(() => leerFng({ data: [{ value: '101', timestamp: '1' }] }), /valor/)
    assert.throws(() => leerFng({ data: [{ value: '50' }] }), /fecha/)
    assert.throws(() => leerFng({}), /valor/)
  })
})

// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DURACION, HORA, VENTANA, cerradasHasta } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { completarDerivados, descargarDerivados, leerFunding, leerLongShort, leerOpenInterest } from '../src/fuentes/derivados.js'
import { FNG, descargarFng, leerFng } from '../src/fuentes/fng.js'
import {
  CONCURRENCIA, ESPACIADO_RUBIK_MS, LIMITE_EUR, LIMITE_VELAS, MAX_REINTENTOS, OKX, PAUSA_MAXIMA_MS, PAUSA_REINTENTO_MS, REINTENTOS_VELAS, VELAS,
  cambio24h, crearCliente, descargarMoneda, descargarVelas, leerVelas, ultimoCierre,
} from '../src/fuentes/okx.js'
import { cuerposConsumidos, fixtureJson, simularFetch } from './ayudantes.js'

const VELAS_1H = fixtureJson('okx-candles-BTC-USDT-1H.json')
const VELAS_4H = fixtureJson('okx-candles-BTC-USDT-4H.json')
const VELAS_1D = fixtureJson('okx-candles-BTC-USDT-1Dutc.json')
const VELAS_EUR = fixtureJson('okx-candles-BTC-EUR-1H.json')

/** esperar() que no espera y apunta cuánto se habría esperado. */
function crearEspera() {
  /** @type {number[]} */
  const esperas = []
  /** @param {number} ms */
  const esperar = async (ms) => { esperas.push(ms) }
  return Object.assign(esperar, { esperas })
}

/** @param {typeof fetch} fetch */
const cliente = (fetch) => crearCliente(fetch, { esperar: crearEspera() })

describe('okx: velas', () => {
  test('ventana: se piden VENTANA + 1 = 300 velas USDT (el máximo de OKX) y 48 EUR', () => {
    assert.equal(LIMITE_VELAS, VENTANA + 1)
    assert.equal(LIMITE_VELAS, 300)
    assert.equal(LIMITE_EUR, 48)
  })

  test('convierte el fixture real 1H en velas de core, de la más antigua a la más reciente', async () => {
    const fetch = simularFetch(() => ({ cuerpo: VELAS_1H }))
    const velas = await descargarVelas(cliente(fetch), 'BTC-USDT', '1h')
    assert.equal(fetch.llamadas[0].url, `${VELAS}?instId=BTC-USDT&bar=1H&limit=300`)
    assert.equal(velas.length, 5)
    assert.deepEqual(velas[0], {
      inicio: 1792350000000, fin: 1792353600000, apertura: 81197.2, maximo: 81197.7, minimo: 80800, cierre: 80876.8,
      volumen: 167.50404769,
    })
    assert.ok(velas.every((v, i) => i === 0 || v.inicio === velas[i - 1].inicio + HORA))
    // La más reciente sigue abierta (confirm "0"): cerradasHasta la descarta por su `fin`.
    const ahora = 1792364400000 + 3 * 60_000
    assert.equal(cerradasHasta(velas, ahora).length, 4)
    assert.ok(cuerposConsumidos(fetch))
  })

  test('4H y 1Dutc del fixture real alineadas a UTC (inicio múltiplo de la duración), como las de Binance', () => {
    const v4h = leerVelas(VELAS_4H.data, DURACION['4h'])
    const v1d = leerVelas(VELAS_1D.data, DURACION['1d'])
    assert.ok(v4h.every((v) => v.inicio % (4 * HORA) === 0 && v.fin === v.inicio + 4 * HORA))
    assert.ok(v1d.every((v) => v.inicio % (24 * HORA) === 0 && v.fin === v.inicio + 24 * HORA))
    assert.equal(new Date(v1d[v1d.length - 1].inicio).toISOString(), '2026-10-18T00:00:00.000Z', 'la vela del día UTC en curso')
  })

  test('pide 1Dutc (día UTC), nunca 1D (hora de Hong Kong)', async () => {
    const fetch = simularFetch(() => ({ cuerpo: VELAS_1D }))
    await descargarVelas(cliente(fetch), 'ETH-USDT', '1d')
    assert.equal(fetch.llamadas[0].url, `${VELAS}?instId=ETH-USDT&bar=1Dutc&limit=300`)
  })

  test('rechaza filas mal formadas mientras las convierte (una sola pasada)', () => {
    const datos = VELAS_1H.data
    const buena = datos[1]
    /** @param {unknown[]} fila */
    const una = (fila) => leerVelas([fila], HORA)
    assert.throws(() => leerVelas(/** @type {any} */ ({}), HORA), /no es una lista/)
    assert.throws(() => una(buena.slice(0, 8)), /mal formada/)
    assert.throws(() => una([buena[0], 'NaN', ...buena.slice(2)]), /precio no válido/)
    assert.throws(() => una([buena[0], '0', ...buena.slice(2)]), /precio no válido/)
    assert.throws(() => una([buena[0], buena[1], '1', ...buena.slice(3)]), /OHLC incoherente/)
    assert.throws(() => una([...buena.slice(0, 5), '-1', ...buena.slice(6)]), /volumen/)
    assert.throws(() => una([String(Number(buena[0]) + 60_000), ...buena.slice(1)]), /alineada/)
    assert.throws(() => una(['x', ...buena.slice(1)]), /tiempo/)
    assert.throws(() => leerVelas([datos[2], datos[1]], HORA), /desordenadas/)
    assert.throws(() => leerVelas([datos[1], datos[1]], HORA), /desordenadas/)
    assert.deepEqual(leerVelas([], HORA), [])
  })

  test('HTTP de error o code ≠ "0" → excepción con el estado o el código, y el cuerpo consumido', async () => {
    const http = simularFetch(() => ({ estado: 403, cuerpo: '<html>forbidden</html>' }))
    await assert.rejects(descargarVelas(cliente(http), 'BTC-USDT', '4h'), /^Error: HTTP 403$/)
    const codigo = simularFetch(() => ({ cuerpo: { code: '51001', msg: 'Instrument ID does not exist', data: [] } }))
    await assert.rejects(descargarVelas(cliente(codigo), 'XXX-USDT', '4h'), /OKX código 51001: Instrument ID does not exist/)
    const sinDatos = simularFetch(() => ({ cuerpo: { code: '0', msg: '' } }))
    await assert.rejects(descargarVelas(cliente(sinDatos), 'BTC-USDT', '4h'), /sin lista de datos/)
    const noJson = simularFetch(() => ({ cuerpo: 'no es json' }))
    await assert.rejects(descargarVelas(cliente(noJson), 'BTC-USDT', '4h'), /no es JSON/)
    for (const f of [http, codigo, sinDatos, noJson]) assert.ok(cuerposConsumidos(f))
  })

  test('descargarMoneda pide 4 series (USDT 1H/4H/1Dutc con 300 y EUR 1H con 48); la que falla queda vacía y se anota', async () => {
    const fetch = simularFetch((url) => {
      if (url.includes('bar=4H')) return { estado: 500, cuerpo: '' }
      if (url.includes('-EUR')) return { cuerpo: VELAS_EUR }
      return { cuerpo: url.includes('bar=1Dutc') ? VELAS_1D : VELAS_1H }
    })
    const m = await descargarMoneda(cliente(fetch), 'BTC')
    assert.deepEqual(fetch.llamadas.map((l) => l.url), [
      `${VELAS}?instId=BTC-USDT&bar=1H&limit=300`,
      `${VELAS}?instId=BTC-USDT&bar=4H&limit=300`,
      `${VELAS}?instId=BTC-USDT&bar=1Dutc&limit=300`,
      `${VELAS}?instId=BTC-EUR&bar=1H&limit=48`,
    ])
    assert.equal(m.velas['1h'].length, 5)
    assert.deepEqual(m.velas['4h'], [])
    assert.equal(m.velas['1d'].length, 5)
    assert.equal(m.velasEur.length, 3)
    assert.deepEqual(m.fallos, ['velas BTC-USDT 4h: HTTP 500'])
  })

  test('ultimoCierre ignora la vela en curso del fixture EUR', () => {
    const velas = leerVelas(VELAS_EUR.data, HORA)
    const ahora = 1792364400000 + 3 * 60_000 // la vela más reciente del fixture sigue abierta
    assert.equal(ultimoCierre(velas, ahora), 72889.9)
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

describe('okx: cliente con límite de ritmo', () => {
  /**
   * fetch que tarda un turno en responder y mide cuántas peticiones hay en vuelo a la vez.
   * @param {(url: string) => { estado?: number, cuerpo: unknown }} responder
   */
  function fetchLento(responder) {
    const medidas = { enVuelo: 0, maximo: 0, rubikEnVuelo: 0, maximoRubik: 0, llamadas: /** @type {string[]} */ ([]) }
    /** @type {Response[]} */
    const respuestas = []
    /** @param {string|URL|Request} entrada */
    const fetch = async (entrada) => {
      const url = String(entrada)
      const rubik = url.includes('/rubik/')
      medidas.llamadas.push(url)
      medidas.enVuelo++
      medidas.maximo = Math.max(medidas.maximo, medidas.enVuelo)
      if (rubik) medidas.maximoRubik = Math.max(medidas.maximoRubik, ++medidas.rubikEnVuelo)
      await new Promise((r) => setImmediate(r))
      medidas.enVuelo--
      if (rubik) medidas.rubikEnVuelo--
      const r = responder(url)
      const res = new Response(JSON.stringify(r.cuerpo), { status: r.estado ?? 200 })
      respuestas.push(res)
      return res
    }
    return Object.assign(fetch, { medidas, respuestas })
  }

  const OK = { code: '0', msg: '', data: [] }
  const LIMITE = { estado: 429, cuerpo: { code: '50011', msg: 'Too Many Requests', data: [] } }

  test('como mucho 2 peticiones en vuelo a la vez (OKX: 40 velas cada 2 s por IP, y la IP es compartida)', async () => {
    const fetch = fetchLento(() => ({ cuerpo: OK }))
    const c = crearCliente(fetch, { esperar: crearEspera() })
    await Promise.all(Array.from({ length: 20 }, (_, i) => c.pedir(`/api/v5/market/candles?instId=X${i}-USDT&bar=1H&limit=300`)))
    assert.equal(fetch.medidas.llamadas.length, 20)
    assert.equal(CONCURRENCIA, 2)
    assert.equal(fetch.medidas.maximo, CONCURRENCIA)
  })

  test('freno común: tras un 429 ninguna petición sale hasta que pasa la pausa; luego se reintenta la limitada', async () => {
    let n = 0
    const fetch = fetchLento(() => (n++ === 0 ? LIMITE : { cuerpo: OK }))
    /** @type {(() => void)[]} */
    const pendientes = []
    /** @type {number[]} */
    const esperas = []
    /** @param {number} ms */
    const esperar = (ms) => new Promise((r) => { esperas.push(ms); pendientes.push(() => r(undefined)) })
    const c = crearCliente(fetch, { esperar })
    const todas = Promise.all(Array.from({ length: 6 }, (_, i) => c.pedir(`/api/v5/market/candles?instId=X${i}-USDT`)))
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r))
    assert.deepEqual(esperas, [PAUSA_REINTENTO_MS], 'una sola pausa para todos')
    assert.equal(fetch.medidas.llamadas.length, 2, 'solo las 2 que ya estaban en vuelo')
    for (const p of pendientes) p()
    await todas
    assert.equal(fetch.medidas.llamadas.length, 6 + 1)
    assert.equal(c.reintentos, 1)
  })

  test(`rubik: de una en una y con ${ESPACIADO_RUBIK_MS} ms entre ellas (≈ 5 cada 2 s por IP)`, async () => {
    const fetch = fetchLento(() => ({ cuerpo: OK }))
    const esperar = crearEspera()
    const c = crearCliente(fetch, { esperar })
    await Promise.all([
      ...Array.from({ length: 6 }, (_, i) => c.pedir(`/api/v5/rubik/stat/contracts/open-interest-history?instId=X${i}-USDT-SWAP`)),
      ...Array.from({ length: 6 }, (_, i) => c.pedir(`/api/v5/public/funding-rate?instId=X${i}-USDT-SWAP`)),
    ])
    assert.equal(fetch.medidas.maximoRubik, 1)
    assert.deepEqual(esperar.esperas, Array(5).fill(ESPACIADO_RUBIK_MS), 'una pausa antes de cada rubik salvo la primera')
  })

  test(`429/50011 → un reintento tras ${PAUSA_REINTENTO_MS} ms; si vuelve a fallar, error con el código`, async () => {
    let n = 0
    const fetch = fetchLento(() => (n++ === 0 ? LIMITE : { cuerpo: { ...OK, data: [['1']] } }))
    const esperar = crearEspera()
    const c = crearCliente(fetch, { esperar })
    assert.deepEqual(await c.pedir('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), [['1']])
    assert.deepEqual(esperar.esperas, [PAUSA_REINTENTO_MS])
    assert.equal(c.reintentos, 1)

    const siempre = fetchLento(() => LIMITE)
    const c2 = crearCliente(siempre, { esperar: crearEspera() })
    await assert.rejects(c2.pedir('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), /^Error: HTTP 429 \(código 50011\)$/)
    assert.equal(siempre.medidas.llamadas.length, 2, 'un solo reintento por petición')
    assert.ok([...fetch.respuestas, ...siempre.respuestas].every((r) => r.bodyUsed))
  })

  test('las velas (imprescindibles) se reintentan hasta 2 veces; el resto, 1', async () => {
    const velas = fetchLento(() => LIMITE)
    await assert.rejects(descargarVelas(crearCliente(velas, { esperar: crearEspera() }), 'BTC-USDT', '1h'), /429/)
    assert.equal(velas.medidas.llamadas.length, 1 + REINTENTOS_VELAS)
    assert.equal(REINTENTOS_VELAS, 2)
    const derivado = fetchLento(() => LIMITE)
    await assert.rejects(crearCliente(derivado, { esperar: crearEspera() }).pedir('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), /429/)
    assert.equal(derivado.medidas.llamadas.length, 2)
  })

  test('el reintento no pierde su turno: va antes que las peticiones que esperaban en la cola', async () => {
    let n = 0
    const fetch = fetchLento(() => (n++ === 0 ? LIMITE : { cuerpo: OK }))
    const c = crearCliente(fetch, { esperar: crearEspera(), concurrencia: 1 })
    await Promise.all(['A', 'B', 'C'].map((x) => c.pedir(`/api/v5/market/candles?instId=${x}-USDT`)))
    assert.deepEqual(fetch.medidas.llamadas.map((u) => new URL(u).searchParams.get('instId')), ['A-USDT', 'A-USDT', 'B-USDT', 'C-USDT'])
  })

  test('frenos seguidos sin ningún acierto se alargan (1,2 s, 2,4 s, 4,8 s… hasta 8 s); un acierto lo reinicia', async () => {
    const respuestas = [LIMITE, LIMITE, LIMITE, LIMITE, LIMITE, { cuerpo: OK }, LIMITE, { cuerpo: OK }]
    let n = 0
    const fetch = fetchLento(() => respuestas[n++] ?? { cuerpo: OK })
    const esperar = crearEspera()
    const c = crearCliente(fetch, { esperar, concurrencia: 1 })
    await Promise.allSettled(Array.from({ length: 5 }, (_, i) => c.pedir(`/api/v5/market/candles?instId=X${i}-USDT`)))
    assert.deepEqual(esperar.esperas, [1200, 2400, 4800, 8000, 8000, 1200])
    assert.equal(PAUSA_MAXIMA_MS, 8000)
  })

  test('el código 50011 también se reintenta aunque llegue con HTTP 200; otros errores no', async () => {
    let n = 0
    const fetch = fetchLento(() => (n++ === 0 ? { cuerpo: LIMITE.cuerpo } : { cuerpo: OK }))
    const c = crearCliente(fetch, { esperar: crearEspera() })
    assert.deepEqual(await c.pedir('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), [])
    assert.equal(c.reintentos, 1)
    const caido = fetchLento(() => ({ estado: 503, cuerpo: {} }))
    const c2 = crearCliente(caido, { esperar: crearEspera() })
    await assert.rejects(c2.pedir('/api/v5/public/funding-rate?instId=BTC-USDT-SWAP'), /HTTP 503/)
    assert.equal(caido.medidas.llamadas.length, 1)
  })

  test(`como mucho ${MAX_REINTENTOS} reintentos por ejecución: las subpeticiones nunca pasan de 50`, async () => {
    const fetch = fetchLento(() => LIMITE)
    const c = crearCliente(fetch, { esperar: crearEspera() })
    const r = await Promise.allSettled(Array.from({ length: 35 }, (_, i) => c.pedir(`/api/v5/market/candles?instId=X${i}-USDT`)))
    assert.ok(r.every((x) => x.status === 'rejected'))
    assert.equal(MAX_REINTENTOS, 10, '20 velas + 15 derivados + 10 + F&G + 2 LLM = 48 ≤ 50')
    assert.equal(c.reintentos, MAX_REINTENTOS)
    assert.equal(fetch.medidas.llamadas.length, 35 + MAX_REINTENTOS)
  })

  test('la URL base es la de OKX', () => {
    assert.equal(OKX, 'https://www.okx.com')
    assert.equal(VELAS, `${OKX}/api/v5/market/candles`)
  })
})

describe('okx: derivados', () => {
  test('funding de una moneda desde el fixture real de public/funding-rate', () => {
    const datos = fixtureJson('okx-funding-rate-BTC-USDT-SWAP.json').data
    assert.equal(leerFunding(datos, 'BTC'), 0.0000700635916526)
    assert.throws(() => leerFunding(datos, 'ETH'), /otra moneda/)
    assert.throws(() => leerFunding([], 'BTC'), /funding no válido/)
    assert.throws(() => leerFunding([{ ...datos[0], fundingRate: 'x' }], 'BTC'), /funding no válido/)
  })

  test('long/short (cuentas) del fixture real del contrato perpetuo USDT', () => {
    assert.equal(leerLongShort(fixtureJson('okx-long-short-account-ratio-contract-BTC-USDT-SWAP.json').data), 1.8273419793502896)
    assert.throws(() => leerLongShort([]), /no válida/)
    assert.throws(() => leerLongShort([['1792364400000', 'x']]), /ratio/)
    assert.throws(() => leerLongShort([['1792364400000', '0']]), /ratio/)
  })

  test('open interest 24 h en monedas (oiCcy) del fixture real: 25 puntos horarios, el más reciente primero', () => {
    const puntos = fixtureJson('okx-open-interest-history-BTC-USDT-SWAP.json').data
    assert.ok(Math.abs(leerOpenInterest(puntos) - (30185.8208000001038 / 30576.6411000000826 - 1)) < 1e-12)
    assert.throws(() => leerOpenInterest(puntos.slice(1)), /faltan puntos/)
    assert.throws(() => leerOpenInterest([...puntos.slice(0, 24), ['0', '1', '1', '1']]), /24 h/)
    assert.throws(() => leerOpenInterest([...puntos.slice(0, 24), [puntos[24][0], '1', '0', '1']]), /valor no válido/)
  })

  test('descargarDerivados: 3 peticiones por moneda (funding + 2 rubik) y cada dato por su lado', async () => {
    const fetch = simularFetch((url) => {
      const instId = new URL(url).searchParams.get('instId')
      if (url.includes('/public/funding-rate')) {
        const fila = fixtureJson('okx-funding-rate-BTC-USDT-SWAP.json').data[0]
        return { cuerpo: { code: '0', msg: '', data: [{ ...fila, instId, fundingRate: instId === 'ETH-USDT-SWAP' ? '0.0000112' : fila.fundingRate }] } }
      }
      if (url.includes('long-short-account-ratio-contract')) return { cuerpo: fixtureJson('okx-long-short-account-ratio-contract-BTC-USDT-SWAP.json') }
      if (instId === 'ETH-USDT-SWAP') return { estado: 500, cuerpo: '' }
      return { cuerpo: fixtureJson('okx-open-interest-history-BTC-USDT-SWAP.json') }
    })
    const { base, fallos } = await descargarDerivados(cliente(fetch), ['BTC', 'ETH'])
    assert.equal(fetch.llamadas.length, 6)
    assert.deepEqual(fetch.llamadas.map((l) => l.url).filter((u) => u.includes('BTC')).sort(), [
      `${OKX}/api/v5/public/funding-rate?instId=BTC-USDT-SWAP`,
      `${OKX}/api/v5/rubik/stat/contracts/long-short-account-ratio-contract?instId=BTC-USDT-SWAP&period=1H&limit=1`,
      `${OKX}/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=1H&limit=25`,
    ])
    assert.equal(base.BTC.funding, 0.0000700635916526)
    assert.equal(base.BTC.ratioLongShort, 1.8273419793502896)
    assert.ok(base.BTC.oiCambio24h !== null)
    assert.equal(base.ETH.funding, 0.0000112)
    assert.equal(base.ETH.oiCambio24h, null)
    assert.deepEqual(fallos, ['derivados open interest ETH: HTTP 500'])
    assert.ok(cuerposConsumidos(fetch))
  })

  test('todo OKX caído → derivados ausentes (null) y fallos anotados; nunca lanza', async () => {
    const fetch = simularFetch(() => ({ estado: 403, cuerpo: '' }))
    const { base, fallos } = await descargarDerivados(cliente(fetch), ['BTC'])
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

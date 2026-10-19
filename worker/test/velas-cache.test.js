// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { DURACION, HORA, VENTANA, cerradasHasta } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { BYBIT_VELAS, descargarVelasBybit, leerVelasBybit } from '../src/fuentes/bybit.js'
import { LIMITE_EUR, LIMITE_VELAS, crearCliente, crearPresupuesto } from '../src/fuentes/okx.js'
import {
  LIMITE_INCREMENTAL, deserializar, descargarSeries, fusionar, limiteAPedir, planificarVelas, serializar, ultimaCerrada,
} from '../src/fuentes/velas.js'
import { aRespuestaBybit, aRespuestaOkx, cuerposConsumidos, fixtureJson, simularFetch } from './ayudantes.js'
import { servidasEn } from './escenario.js'

const DIA = 24 * HORA
/** Día UTC alineado a 4 h y a 1 d. */
const T0 = Date.UTC(2026, 9, 10)

/** @param {number} ms */
const sinEspera = async (ms) => { void ms }

/**
 * Series sintéticas largas de una moneda: 1H/4H/1D USDT y 1H EUR hasta T0 + 4 días.
 * @param {number} base
 */
function seriesLargas(base) {
  /** @param {number} duracion */
  const de = (duracion) => {
    const previas = 400
    const n = previas + Math.ceil((4 * DIA) / duracion) + 1
    return serie(n, (i) => base * (1 + 0.05 * Math.sin(i / 7)) * 1.0005 ** i, { duracion, inicio: T0 - previas * duracion })
  }
  return { '1h': de(HORA), '4h': de(4 * HORA), '1d': de(DIA), eur: serie(400 + 4 * 24 + 1, (i) => base * 0.9 * 1.0003 ** i, { inicio: T0 - 400 * HORA }) }
}

const BARRAS = /** @type {Record<string, '1h'|'4h'|'1d'>} */ ({ '1H': '1h', '4H': '4h', '1Dutc': '1d' })
const INTERVALOS_BYBIT = /** @type {Record<string, '1h'|'4h'|'1d'>} */ ({ 60: '1h', 240: '4h', D: '1d' })

/**
 * OKX (y Bybit) simulados sobre series en el instante `reloj.ahora`.
 * @param {Record<string, ReturnType<typeof seriesLargas>>} series
 * @param {{ ahora: number }} reloj
 * @param {{ okxCaido?: (url: string) => boolean }} [op]
 */
function fetchSeries(series, reloj, { okxCaido = () => false } = {}) {
  return simularFetch((url) => {
    const u = new URL(url)
    if (url.startsWith('https://www.okx.com/api/v5/market/candles?')) {
      if (okxCaido(url)) return { estado: 429, cuerpo: { code: '50011', msg: 'Too Many Requests', data: [] } }
      const [simbolo, cotizacion] = /** @type {string} */ (u.searchParams.get('instId')).split('-')
      const s = series[simbolo]
      const velas = cotizacion === 'EUR' ? s.eur : s[BARRAS[/** @type {string} */ (u.searchParams.get('bar'))]]
      return { cuerpo: aRespuestaOkx(servidasEn(velas, reloj.ahora, Number(u.searchParams.get('limit'))), reloj.ahora) }
    }
    if (url.startsWith(`${BYBIT_VELAS}?`)) {
      const simbolo = /** @type {string} */ (u.searchParams.get('symbol')).replace(/USDT$/, '')
      const velas = series[simbolo][INTERVALOS_BYBIT[/** @type {string} */ (u.searchParams.get('interval'))]]
      return { cuerpo: aRespuestaBybit(servidasEn(velas, reloj.ahora, Number(u.searchParams.get('limit'))), `${simbolo}USDT`) }
    }
    throw new Error(`URL inesperada en el test: ${url}`)
  })
}

/**
 * Lo que vería la estrategia pidiendo la serie entera cada vez (sin caché): las cerradas de las 300 últimas
 * velas servidas (299 cerradas + la que sigue abierta) y las 47 EUR cerradas de 48.
 * @param {ReturnType<typeof seriesLargas>} s
 * @param {number} ahora
 */
const directas = (s, ahora) => ({
  velas: {
    '1h': cerradasHasta(servidasEn(s['1h'], ahora, LIMITE_VELAS), ahora),
    '4h': cerradasHasta(servidasEn(s['4h'], ahora, LIMITE_VELAS), ahora),
    '1d': cerradasHasta(servidasEn(s['1d'], ahora, LIMITE_VELAS), ahora),
  },
  velasEur: cerradasHasta(servidasEn(s.eur, ahora, LIMITE_EUR), ahora),
})

/**
 * Caché en memoria con el mismo formato que la de D1 (texto JSON por serie).
 * @returns {{ filas: Record<string, string>, leer: () => Record<string, string>, guardar: (g: { clave: string, velas: any[] }[]) => void }}
 */
function cacheEnMemoria() {
  /** @type {Record<string, string>} */
  const filas = {}
  return {
    filas,
    leer: () => ({ ...filas }),
    guardar: (g) => { for (const { clave, velas } of g) filas[clave] = serializar(velas) },
  }
}

describe('velas en caché: piezas', () => {
  test('serializar y deserializar conservan cada número bit a bit; lo que no valga → null', () => {
    const velas = serie(5, (i) => 0.1 + i / 3, { duracion: 4 * HORA, inicio: T0 })
    const texto = serializar(velas)
    assert.deepEqual(JSON.parse(texto)[0], [velas[0].inicio, velas[0].apertura, velas[0].maximo, velas[0].minimo, velas[0].cierre, velas[0].volumen])
    assert.deepEqual(deserializar(texto, 4 * HORA), velas)
    assert.equal(deserializar('no es json', HORA), null)
    assert.equal(deserializar('{}', HORA), null)
    assert.equal(deserializar(texto, HORA * 3), null, 'no alineada a la duración')
    assert.equal(deserializar(serializar([velas[1], velas[0]]), 4 * HORA), null, 'desordenada')
    assert.equal(deserializar(JSON.stringify([[T0, 1, 2, 0.5, 1]]), HORA), null, 'fila corta')
    assert.equal(deserializar(JSON.stringify([[T0, 1, 2, 0.5, 'x', 1]]), HORA), null, 'no numérica')
    assert.deepEqual(deserializar('[]', HORA), [])
  })

  test('ultimaCerrada: inicio de la última vela ya cerrada en `ahora`', () => {
    assert.equal(ultimaCerrada(HORA, T0 + 3 * 60_000), T0 - HORA)
    assert.equal(ultimaCerrada(4 * HORA, T0 + 5 * HORA), T0)
    assert.equal(ultimaCerrada(4 * HORA, T0 + 3 * HORA), T0 - 4 * HORA)
    assert.equal(ultimaCerrada(DIA, T0 + 3 * 60_000), T0 - DIA)
    assert.equal(ultimaCerrada(HORA, T0), T0 - HORA, 'la vela que cierra justo en `ahora` ya está cerrada')
  })

  test('limiteAPedir: sin caché o corta → la serie entera; al día → nada; faltan 1-2 → limit=3; más → la serie entera', () => {
    const limites = { completo: LIMITE_VELAS, minimo: VENTANA }
    const cache = serie(VENTANA, () => 1, { inicio: T0 - VENTANA * HORA }) // última: T0 - 1 h
    assert.equal(LIMITE_INCREMENTAL, 3)
    assert.equal(limiteAPedir(null, HORA, T0 + 60_000, limites), 300)
    assert.equal(limiteAPedir(cache.slice(1), HORA, T0 + 60_000, limites), 300, 'menos de VENTANA cerradas')
    assert.equal(limiteAPedir(cache, HORA, T0 + 60_000, limites), 0)
    assert.equal(limiteAPedir(cache, HORA, T0 + HORA + 60_000, limites), 3)
    assert.equal(limiteAPedir(cache, HORA, T0 + 2 * HORA + 60_000, limites), 3)
    assert.equal(limiteAPedir(cache, HORA, T0 + 3 * HORA + 60_000, limites), 300, 'hueco de 3 velas')
    assert.equal(limiteAPedir(cache, HORA, T0 - HORA + 60_000, limites), 300, 'caché del futuro: no se fía')
  })

  test('fusionar: las nuevas mandan, solo cerradas, las `maximo` últimas; hueco o nada nuevo → null', () => {
    const todas = serie(10, (i) => 100 + i, { inicio: T0 })
    const ahora = T0 + 9 * HORA + 60_000 // la vela 9 sigue abierta
    const cache = todas.slice(0, 7)
    const corregida = { ...todas[6], cierre: 999, maximo: 1000 }
    const r = fusionar(cache, [corregida, ...todas.slice(7)], HORA, ahora, 100)
    assert.deepEqual(r, [...todas.slice(0, 6), corregida, todas[7], todas[8]])
    assert.deepEqual(fusionar(cache, todas.slice(7), HORA, ahora, 100), todas.slice(0, 9), 'contiguas')
    assert.deepEqual(fusionar(cache, todas.slice(7), HORA, ahora, 4), todas.slice(5, 9))
    assert.equal(fusionar(cache, todas.slice(8), HORA, ahora, 100), null, 'falta la vela 7')
    assert.equal(fusionar(cache, [], HORA, ahora, 100), null)
    assert.deepEqual(fusionar(null, todas, HORA, ahora, 3), todas.slice(6, 9))
    assert.deepEqual(fusionar([], todas.slice(7), HORA, ahora, 100), todas.slice(7, 9))
  })
})

describe('velas en caché: igual que pedir la serie entera', () => {
  test('hora a hora durante 4 días (con huecos de 1, 2, 3 y 30 h y análisis manuales): misma entrada para la estrategia y muchas menos velas pedidas', async () => {
    const series = { BTC: seriesLargas(100), ETH: seriesLargas(10) }
    const reloj = { ahora: 0 }
    const fetch = fetchSeries(series, reloj)
    const cache = cacheEnMemoria()
    const horas = [0, 1, 2, 3, 4, 6, 9, 13, 20, 23, 24, 25, 26, 27, 28, 58, 59, 60, 61, 72, 73, 95]
    let pedidasConCache = 0
    for (const h of horas) {
      for (const minuto of [3, 20]) {
        reloj.ahora = T0 + h * HORA + minuto * 60_000
        const antes = fetch.llamadas.length
        const okx = crearCliente(fetch, { esperar: sinEspera })
        const pedidos = planificarVelas(['BTC', 'ETH'], cache.leer(), reloj.ahora)
        const r = await descargarSeries({ okx, fetch, pedidos, ahora: reloj.ahora, presupuesto: crearPresupuesto(0) })
        assert.deepEqual(r.fallos, [])
        cache.guardar(r.guardar)
        pedidasConCache += fetch.llamadas.length - antes
        for (const s of /** @type {const} */ (['BTC', 'ETH'])) {
          const esperado = directas(series[s], reloj.ahora)
          assert.deepEqual(r.monedas[s].velas, esperado.velas, `${s} USDT a las ${h} h ${minuto} min`)
          assert.deepEqual(r.monedas[s].velasEur, esperado.velasEur, `${s} EUR a las ${h} h ${minuto} min`)
          assert.equal(r.monedas[s].velas['1h'].length, VENTANA)
        }
        if (minuto === 20) assert.equal(fetch.llamadas.length, antes, 'en la misma hora la caché ya está al día')
      }
    }
    // Sin caché serían 4 series por moneda y ejecución (2 ejecuciones por hora), siempre de 300 (USDT) o 48 (EUR).
    const sinCache = horas.length * 2 * 2 * 4
    assert.ok(pedidasConCache < sinCache * 0.4, `${pedidasConCache} peticiones de ${sinCache}`)
    const limites = fetch.llamadas.map((l) => Number(new URL(l.url).searchParams.get('limit')))
    assert.ok(limites.filter((l) => l === 3).length > limites.length / 2, 'la mayoría son incrementales (limit=3)')
    assert.ok(cuerposConsumidos(fetch))
  })

  test('una hora normal pide solo USDT 1H y EUR 1H con limit=3; al cerrar la 4H y el día, también esas (limit=3)', async () => {
    const series = { BTC: seriesLargas(100) }
    const reloj = { ahora: T0 - 3 * HORA + 3 * 60_000 }
    const fetch = fetchSeries(series, reloj)
    const cache = cacheEnMemoria()
    /** @returns {Promise<string[]>} */
    const ejecutar = async () => {
      const antes = fetch.llamadas.length
      const pedidos = planificarVelas(['BTC'], cache.leer(), reloj.ahora)
      const r = await descargarSeries({ okx: crearCliente(fetch, { esperar: sinEspera }), fetch, pedidos, ahora: reloj.ahora, presupuesto: crearPresupuesto(0) })
      cache.guardar(r.guardar)
      return fetch.llamadas.slice(antes).map((l) => new URL(l.url).search)
    }
    assert.deepEqual(await ejecutar(), [
      '?instId=BTC-USDT&bar=1H&limit=300', '?instId=BTC-USDT&bar=4H&limit=300', '?instId=BTC-USDT&bar=1Dutc&limit=300', '?instId=BTC-EUR&bar=1H&limit=48',
    ])
    assert.deepEqual(Object.keys(cache.filas).sort(), ['BTC-EUR 1h', 'BTC-USDT 1d', 'BTC-USDT 1h', 'BTC-USDT 4h'])
    reloj.ahora += HORA // 22:03
    assert.deepEqual(await ejecutar(), ['?instId=BTC-USDT&bar=1H&limit=3', '?instId=BTC-EUR&bar=1H&limit=3'])
    reloj.ahora += 2 * HORA // 00:03: cierran la 4H de las 20:00 y el día
    assert.deepEqual(await ejecutar(), [
      '?instId=BTC-USDT&bar=1H&limit=3', '?instId=BTC-USDT&bar=4H&limit=3', '?instId=BTC-USDT&bar=1Dutc&limit=3', '?instId=BTC-EUR&bar=1H&limit=3',
    ])
  })

  test('caché ilegible → se pide la serie entera y se reescribe', async () => {
    const series = { BTC: seriesLargas(100) }
    const reloj = { ahora: T0 + 3 * 60_000 }
    const fetch = fetchSeries(series, reloj)
    const pedidos = planificarVelas(['BTC'], { 'BTC-USDT 1h': '[[1,2', 'BTC-USDT 4h': '{}' }, reloj.ahora)
    assert.deepEqual(pedidos.map((p) => [p.clave, p.limite]), [['BTC-USDT 1h', 300], ['BTC-USDT 4h', 300], ['BTC-USDT 1d', 300], ['BTC-EUR 1h', 48]])
    const r = await descargarSeries({ okx: crearCliente(fetch, { esperar: sinEspera }), fetch, pedidos, ahora: reloj.ahora, presupuesto: crearPresupuesto(0) })
    assert.deepEqual(r.guardar.map((g) => g.clave), ['BTC-USDT 1h', 'BTC-USDT 4h', 'BTC-USDT 1d', 'BTC-EUR 1h'])
    assert.equal(r.guardar[0].velas.length, VENTANA)
  })

  test('hueco que la caché no veía (OKX devuelve velas que no empalman) → se pide la serie entera, con presupuesto', async () => {
    const series = { BTC: seriesLargas(100) }
    const reloj = { ahora: T0 + 3 * 60_000 }
    const fetch = fetchSeries(series, reloj)
    const cache = cacheEnMemoria()
    const primera = await descargarSeries({
      okx: crearCliente(fetch, { esperar: sinEspera }), fetch, pedidos: planificarVelas(['BTC'], {}, reloj.ahora), ahora: reloj.ahora, presupuesto: crearPresupuesto(0),
    })
    cache.guardar(primera.guardar)
    reloj.ahora += HORA
    // Respuesta incremental rara: solo la vela en curso (la recién cerrada no viene).
    const raro = simularFetch((url) => {
      const u = new URL(url)
      const velas = u.searchParams.get('instId') === 'BTC-EUR' ? series.BTC.eur : series.BTC['1h']
      const limite = Number(u.searchParams.get('limit'))
      return { cuerpo: aRespuestaOkx(servidasEn(velas, reloj.ahora, limite === 3 ? 1 : limite), reloj.ahora) }
    })
    const presupuesto = crearPresupuesto(5)
    const r = await descargarSeries({ okx: crearCliente(raro, { esperar: sinEspera }), fetch: raro, pedidos: planificarVelas(['BTC'], cache.leer(), reloj.ahora), ahora: reloj.ahora, presupuesto })
    assert.deepEqual(raro.llamadas.map((l) => new URL(l.url).search), [
      '?instId=BTC-USDT&bar=1H&limit=3', '?instId=BTC-EUR&bar=1H&limit=3', '?instId=BTC-USDT&bar=1H&limit=300', '?instId=BTC-EUR&bar=1H&limit=48',
    ])
    assert.equal(presupuesto.disponibles, 3, 'las 2 peticiones enteras salen del hueco de subpeticiones')
    const esperado = directas(series.BTC, reloj.ahora)
    assert.deepEqual(r.monedas.BTC.velas['1h'], esperado.velas['1h'])
    assert.deepEqual(r.monedas.BTC.velasEur, esperado.velasEur)
    assert.deepEqual(r.fallos, [])

    // Sin presupuesto para pedirla entera: la serie queda vacía y se anota (USDT intenta Bybit, que tampoco cabe).
    const sinHueco = await descargarSeries({ okx: crearCliente(raro, { esperar: sinEspera }), fetch: raro, pedidos: planificarVelas(['BTC'], cache.leer(), reloj.ahora), ahora: reloj.ahora, presupuesto: crearPresupuesto(0) })
    assert.deepEqual(sinHueco.monedas.BTC.velas['1h'], [])
    assert.deepEqual(sinHueco.fallos, [
      'velas BTC-USDT 1h: hueco en la caché y sin subpeticiones para pedir la serie entera',
      'velas BTC-USDT 1h (Bybit): sin subpeticiones libres',
      'velas BTC-EUR 1h: hueco en la caché y sin subpeticiones para pedir la serie entera',
    ])
  })
})

describe('velas: Bybit como respaldo de OKX (solo USDT)', () => {
  test('lee el fixture real de Bybit (la más reciente primero, 7 campos) como velas de core ascendentes y alineadas', () => {
    const json = fixtureJson('bybit-kline-BTCUSDT-60.json')
    const velas = leerVelasBybit(json, 'BTCUSDT', HORA)
    assert.equal(velas.length, 5)
    const fila = json.result.list[json.result.list.length - 1]
    assert.deepEqual(velas[0], {
      inicio: Number(fila[0]), fin: Number(fila[0]) + HORA, apertura: Number(fila[1]), maximo: Number(fila[2]),
      minimo: Number(fila[3]), cierre: Number(fila[4]), volumen: Number(fila[5]),
    })
    assert.ok(velas.every((v, i) => i === 0 || v.inicio === velas[i - 1].inicio + HORA))
    const v4h = leerVelasBybit(fixtureJson('bybit-kline-BTCUSDT-240.json'), 'BTCUSDT', DURACION['4h'])
    assert.ok(v4h.every((v) => v.inicio % (4 * HORA) === 0))
  })

  test('valida estrictamente: retCode, símbolo, lista y cada fila', () => {
    const json = fixtureJson('bybit-kline-BTCUSDT-60.json')
    assert.throws(() => leerVelasBybit({ ...json, retCode: 10001, retMsg: 'Not supported symbols' }, 'BTCUSDT', HORA), /Bybit código 10001: Not supported symbols/)
    assert.throws(() => leerVelasBybit(json, 'ETHUSDT', HORA), /otro símbolo/)
    assert.throws(() => leerVelasBybit({ ...json, result: { ...json.result, list: undefined } }, 'BTCUSDT', HORA), /lista/)
    const lista = json.result.list
    assert.throws(() => leerVelasBybit({ ...json, result: { ...json.result, list: [lista[0].slice(0, 6)] } }, 'BTCUSDT', HORA), /mal formada/)
    assert.throws(() => leerVelasBybit({ ...json, result: { ...json.result, list: [lista[1], lista[0]] } }, 'BTCUSDT', HORA), /desordenadas/)
    assert.throws(() => leerVelasBybit({ ...json, result: { ...json.result, list: [[lista[0][0], '0', ...lista[0].slice(2)]] } }, 'BTCUSDT', HORA), /precio/)
    assert.throws(() => leerVelasBybit(json, 'BTCUSDT', 7 * HORA), /alineada/)
  })

  test('descargarVelasBybit: URL spot con intervalo 60/240/D, cuerpo consumido y errores HTTP', async () => {
    const fetch = simularFetch((url) => (url.includes('interval=D') ? { estado: 403, cuerpo: 'bloqueado' } : { cuerpo: fixtureJson('bybit-kline-BTCUSDT-60.json') }))
    const velas = await descargarVelasBybit(fetch, 'BTC', '1h', 3)
    assert.equal(velas.length, 5)
    await assert.rejects(descargarVelasBybit(fetch, 'BTC', '1d', 300), /HTTP 403/)
    assert.deepEqual(fetch.llamadas.map((l) => l.url), [
      `${BYBIT_VELAS}?category=spot&symbol=BTCUSDT&interval=60&limit=3`,
      `${BYBIT_VELAS}?category=spot&symbol=BTCUSDT&interval=D&limit=300`,
    ])
    assert.ok(cuerposConsumidos(fetch))
  })

  test('OKX limitado en las velas USDT: Bybit las sirve (con la caché), se anota la fuente y no se guardan en la caché', async () => {
    const series = { BTC: seriesLargas(100), ETH: seriesLargas(10) }
    const reloj = { ahora: T0 + 3 * 60_000 }
    const cache = cacheEnMemoria()
    const sano = fetchSeries(series, reloj)
    cache.guardar((await descargarSeries({
      okx: crearCliente(sano, { esperar: sinEspera }), fetch: sano, pedidos: planificarVelas(['BTC', 'ETH'], {}, reloj.ahora), ahora: reloj.ahora, presupuesto: crearPresupuesto(0),
    })).guardar)
    const guardada = cache.filas['BTC-USDT 1h']
    reloj.ahora += HORA
    const fetch = fetchSeries(series, reloj, { okxCaido: (url) => url.includes('BTC-') })
    const presupuesto = crearPresupuesto(4)
    presupuesto.reserva = 2
    const r = await descargarSeries({
      okx: crearCliente(fetch, { esperar: sinEspera, presupuesto }), fetch, pedidos: planificarVelas(['BTC', 'ETH'], cache.leer(), reloj.ahora), ahora: reloj.ahora, presupuesto,
    })
    const esperado = directas(series.BTC, reloj.ahora)
    assert.deepEqual(r.monedas.BTC.velas['1h'], esperado.velas['1h'], 'Bybit (limit=3) + caché de OKX')
    assert.deepEqual(r.monedas.BTC.velas['4h'], esperado.velas['4h'], 'la 4H sigue al día en la caché: ni se pide')
    assert.deepEqual(r.monedas.BTC.velasEur, [], 'EUR no tiene respaldo')
    assert.deepEqual(r.bybit, ['BTC-USDT 1h'])
    assert.ok(r.fallos.includes('velas BTC-USDT 1h: HTTP 429 (código 50011)'))
    assert.ok(r.fallos.includes('velas BTC-EUR 1h: HTTP 429 (código 50011)'))
    assert.deepEqual(r.guardar.map((g) => g.clave).sort(), ['ETH-EUR 1h', 'ETH-USDT 1h'], 'lo de Bybit no entra en la caché')
    assert.equal(cache.filas['BTC-USDT 1h'], guardada)
    const bybit = fetch.llamadas.filter((l) => l.url.startsWith(BYBIT_VELAS))
    assert.deepEqual(bybit.map((l) => new URL(l.url).search), ['?category=spot&symbol=BTCUSDT&interval=60&limit=3'])
    const okx = fetch.llamadas.filter((l) => l.url.includes('BTC-'))
    assert.equal(okx.length, 2 + 2, '2 peticiones + 2 reintentos (los que deja la reserva para Bybit)')
    assert.equal(presupuesto.disponibles, 1)
  })

  test('Bybit también caído o sin presupuesto: la serie queda vacía y se anotan los dos fallos', async () => {
    const series = { BTC: seriesLargas(100) }
    const reloj = { ahora: T0 + 3 * 60_000 }
    const fetch = simularFetch((url) => (url.startsWith(BYBIT_VELAS)
      ? { estado: 500, cuerpo: '' }
      : { estado: 429, cuerpo: { code: '50011', msg: 'Too Many Requests', data: [] } }))
    const presupuesto = crearPresupuesto(1)
    presupuesto.reserva = 1
    const r = await descargarSeries({
      okx: crearCliente(fetch, { esperar: sinEspera, presupuesto }), fetch, pedidos: planificarVelas(['BTC'], {}, reloj.ahora), ahora: reloj.ahora, presupuesto,
    })
    void series
    assert.equal(fetch.llamadas.filter((l) => l.url.startsWith('https://www.okx.com/')).length, 4, 'la reserva no se gasta en reintentos de OKX')
    assert.deepEqual(r.monedas.BTC.velas, { '1h': [], '4h': [], '1d': [] })
    assert.deepEqual(r.bybit, [])
    assert.ok(r.fallos.includes('velas BTC-USDT 1h (Bybit): HTTP 500'))
    assert.ok(r.fallos.includes('velas BTC-USDT 4h (Bybit): sin subpeticiones libres'))
    assert.equal(presupuesto.disponibles, 0)
    assert.ok(cuerposConsumidos(fetch))
  })
})

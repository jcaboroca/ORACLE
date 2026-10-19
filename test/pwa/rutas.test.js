// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { INTERVALO_MS, crearRefresco } from '../../js/refresco.js'
import { conParams, hashDe, leerRuta, paramEntero, paramOpcion, seccionDe } from '../../js/rutas.js'

describe('rutas por hash', () => {
  test('vistas conocidas, símbolo en mayúsculas y parámetros', () => {
    assert.deepEqual(leerRuta(''), { vista: 'panel', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#/'), { vista: 'panel', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#/moneda/btc?tf=4h'), { vista: 'moneda', simbolo: 'BTC', params: { tf: '4h' } })
    assert.deepEqual(leerRuta('#/bot?simulacion=2&simbolo=ETH&filtro=hold'),
      { vista: 'bot', simbolo: null, params: { simulacion: '2', simbolo: 'ETH', filtro: 'hold' } })
    assert.deepEqual(leerRuta('#/backtest?v=v2'), { vista: 'backtest', simbolo: null, params: { v: 'v2' } })
    assert.deepEqual(leerRuta('#/login'), { vista: 'login', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#bot'), { vista: 'bot', simbolo: null, params: {} })
  })

  test('lo desconocido o mal formado va al Panel', () => {
    for (const h of ['#/nada', '#/moneda', '#/moneda/B', '#/moneda/BTC/extra', '#/moneda/<script>', '#/bot/3']) {
      assert.equal(leerRuta(h).vista, 'panel', h)
    }
  })

  test('hashDe y conParams son el inverso de leerRuta', () => {
    assert.equal(hashDe('panel'), '#/')
    assert.equal(hashDe('moneda', { simbolo: 'ETH', params: { tf: '1d' } }), '#/moneda/ETH?tf=1d')
    assert.equal(hashDe('bot', { params: { simulacion: 3, simbolo: null, filtro: '' } }), '#/bot?simulacion=3')
    const ruta = leerRuta('#/bot?simulacion=2&filtro=hold')
    assert.equal(conParams(ruta, { filtro: null, simbolo: 'BTC' }), '#/bot?simulacion=2&simbolo=BTC')
    assert.deepEqual(leerRuta(conParams(ruta, { simbolo: 'SOL' })).params, { simulacion: '2', filtro: 'hold', simbolo: 'SOL' })
  })

  test('parámetros validados', () => {
    assert.equal(paramEntero({ simulacion: '12' }, 'simulacion'), 12)
    for (const malo of ['0', '-1', 'x', '1.5', '']) assert.equal(paramEntero({ simulacion: malo }, 'simulacion'), null, malo)
    assert.equal(paramEntero({}, 'simulacion'), null)
    assert.equal(paramOpcion({ tf: '4h' }, 'tf', ['1h', '4h', '1d'], '1h'), '4h')
    assert.equal(paramOpcion({ tf: '15m' }, 'tf', ['1h', '4h', '1d'], '1h'), '1h')
    assert.equal(seccionDe(leerRuta('#/moneda/BTC')), 'panel')
    assert.equal(seccionDe(leerRuta('#/bot')), 'bot')
  })
})

/** Reloj simulado: el tiempo solo avanza con avanzar(ms). */
function relojFalso() {
  let t = 0
  /** @type {Map<number, { cuando: number, f: () => void }>} */
  const pendientes = new Map()
  let siguienteId = 1
  return {
    pendientes,
    ahora: () => t,
    /** @param {() => void} f @param {number} ms */
    setTimeout: (f, ms) => {
      const id = siguienteId++
      pendientes.set(id, { cuando: t + ms, f })
      return id
    },
    /** @param {unknown} id */
    clearTimeout: (id) => { pendientes.delete(/** @type {number} */ (id)) },
    /** @param {number} ms */
    async avanzar(ms) {
      const fin = t + ms
      for (;;) {
        const proximo = [...pendientes.entries()].sort((a, b) => a[1].cuando - b[1].cuando)[0]
        if (!proximo || proximo[1].cuando > fin) break
        pendientes.delete(proximo[0])
        t = proximo[1].cuando
        proximo[1].f()
        await new Promise((r) => setImmediate(r))
      }
      t = fin
      await new Promise((r) => setImmediate(r))
    },
  }
}

describe('refresco solo visible', () => {
  test('iniciar no carga (la carga inicial es de la app) y luego refresca cada 5 min', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(INTERVALO_MS - 1)
    assert.equal(n, 0)
    await reloj.avanzar(1)
    assert.equal(n, 1)
    await reloj.avanzar(2 * INTERVALO_MS)
    assert.equal(n, 3)
  })

  test('oculta no pide nada; al volver refresca si ya tocaba o espera lo que falta', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(60_000)
    r.visibilidad(false)
    assert.equal(reloj.pendientes.size, 0)
    await reloj.avanzar(60 * 60_000)
    assert.equal(n, 0, 'nada mientras está oculta')
    r.visibilidad(true)
    await reloj.avanzar(0)
    assert.equal(n, 1, 'al volver tras más de 5 min, refresca enseguida')
    await reloj.avanzar(60_000)
    r.visibilidad(false)
    r.visibilidad(true)
    await reloj.avanzar(0)
    assert.equal(n, 1, 'volver antes de 5 min no refresca')
    await reloj.avanzar(INTERVALO_MS - 60_000)
    assert.equal(n, 2, 'refresca cuando se cumplen los 5 min desde el último')
  })

  test('no solapa una acción lenta y sobrevive a errores', async () => {
    const reloj = relojFalso()
    let n = 0
    /** @type {() => void} */
    let terminar = () => {}
    const r = crearRefresco({
      accion: () => {
        n++
        if (n === 1) return new Promise((resolver) => { terminar = resolver })
        throw new Error('red caída')
      },
      reloj,
    })
    r.iniciar()
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 1)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 1, 'la primera sigue en curso: no se lanza otra')
    terminar()
    await reloj.avanzar(0)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 2)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 3, 'un error no para el ciclo')
  })

  test('reiniciarCuenta aplaza el siguiente y detener lo para todo', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(4 * 60_000)
    r.reiniciarCuenta()
    await reloj.avanzar(2 * 60_000)
    assert.equal(n, 0)
    await reloj.avanzar(3 * 60_000)
    assert.equal(n, 1)
    r.detener()
    r.visibilidad(true)
    await reloj.avanzar(10 * INTERVALO_MS)
    assert.equal(n, 1)
    assert.equal(reloj.pendientes.size, 0)
  })
})

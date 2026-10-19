// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ErrorApi, MAX_EN_VUELO, crearApi, crearLimitador, esBloqueo, mensajeError, pideLogin } from '../../js/api.js'
import { CLAVE_PIN, crearSesion, tratarErrorDeSesion } from '../../js/sesion.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'

/** @param {Awaited<ReturnType<typeof workerSimulado>>} w @param {string|null} [pin] */
const clienteDe = (w, pin = PIN) => crearApi({ base: BASE, fetch: w.fetch, pin: () => pin })

describe('cliente de la API contra el Worker real', () => {
  test('resumen con PIN: forma del contrato', async () => {
    const w = await workerSimulado()
    const r = await clienteDe(w).resumen()
    assert.equal(r.ahora, w.ahora)
    assert.deepEqual(r.senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
    for (const s of r.senales) {
      for (const clave of ['veredicto', 'indiceConfianza', 'puntuacion', 'precioEur', 'cambio24h', 'fresca', 'calculadaEn', 'frase']) {
        assert.ok(clave in s, clave)
      }
    }
    assert.equal(r.bot.simulacionId, 1)
    assert.equal(typeof r.datosDesactualizados, 'boolean')
    assert.equal(w.llamadas[0].url, `${BASE}/api/resumen`)
    assert.equal(new Headers(w.llamadas[0].init?.headers).get('Authorization'), `Bearer ${PIN}`)
  })

  test('moneda, bot, simulaciones, operaciones y decisiones con filtros y cursor', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const m = await api.moneda('btc')
    assert.equal(m.simbolo, 'BTC')
    assert.ok(m.senal.componentes && Array.isArray(m.titulares) && Array.isArray(m.decisiones))
    const b = await api.bot()
    assert.equal(b.simulacion.activa, true)
    assert.ok(Array.isArray(b.curva) && b.metricas.valorCartera > 0)
    assert.equal((await api.simulaciones()).items.length, 1)
    const ops = await api.operaciones({ simulacion: 1, simbolo: 'BTC' })
    assert.ok(ops.items.length > 0 && ops.items.every((/** @type {any} */ o) => o.simbolo === 'BTC'))
    const dec = await api.decisiones({ cursor: 1_000_000 })
    assert.ok(dec.items.length > 0)
    const urls = w.llamadas.map((l) => l.url)
    assert.ok(urls.includes(`${BASE}/api/bot/operaciones?simulacion=1&simbolo=BTC`))
    assert.ok(urls.includes(`${BASE}/api/bot/decisiones?cursor=1000000`))
    assert.ok(urls.includes(`${BASE}/api/bot`), 'sin parámetros vacíos')
  })

  test('PIN incorrecto → ErrorApi 401 que pide login; al 5.º fallo, bloqueo con hasta', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w, '0000')
    /** @type {ErrorApi|null} */
    let error = null
    for (let i = 0; i < 5; i++) {
      try {
        await api.resumen()
      } catch (e) {
        error = /** @type {ErrorApi} */ (e)
        if (i < 4) {
          assert.equal(error.estado, 401)
          assert.equal(error.codigo, 'pin_incorrecto')
          assert.ok(pideLogin(error))
        }
      }
    }
    assert.ok(error instanceof ErrorApi)
    assert.equal(error.estado, 429)
    assert.equal(error.codigo, 'bloqueado')
    assert.equal(error.hasta, w.ahora + 15 * 60_000)
    // El bloqueo no pide login: el PIN guardado puede ser el correcto (bloqueo global provocado por otros).
    assert.equal(pideLogin(error), false)
    assert.ok(esBloqueo(error))
    assert.match(mensajeError(error), /^Demasiados intentos con PIN incorrecto\. Acceso bloqueado hasta las \d\d:\d\d\.$/)
  })

  test('sin PIN guardado no llama al Worker (no gasta un intento): 401 sin_sesion local que pide login', async () => {
    const w = await workerSimulado()
    await assert.rejects(clienteDe(w, null).resumen(), (e) => e instanceof ErrorApi && e.estado === 401 && e.codigo === 'sin_sesion' && pideLogin(e))
    assert.equal(w.llamadas.length, 0)
  })

  test('reiniciar envía capital_inicial y confirmar: true; la anterior queda cerrada', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const r = await api.reiniciar(5000)
    assert.equal(r.simulacion.capitalInicial, 5000)
    assert.equal(r.simulacion.id, 2)
    assert.deepEqual(JSON.parse(String(w.llamadas[0].init?.body)), { capital_inicial: 5000, confirmar: true })
    const sims = (await api.simulaciones()).items
    assert.deepEqual(sims.map((/** @type {any} */ s) => [s.id, s.activa]), [[2, true], [1, false]])
    await assert.rejects(api.reiniciar(5), (e) => e instanceof ErrorApi && e.estado === 400 && e.codigo === 'peticion_invalida')
  })

  test('analizar dos veces → 429 demasiado_pronto con mensaje y hora', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const r = await api.analizar()
    assert.equal(r.ejecucion.tipo, 'manual')
    await assert.rejects(api.analizar(), (e) => {
      assert.ok(e instanceof ErrorApi)
      assert.equal(e.codigo, 'demasiado_pronto')
      assert.equal(pideLogin(e), false)
      assert.match(mensajeError(e), /^Solo se puede analizar una vez cada 5 minutos\. Espera hasta las \d\d:\d\d\.$/)
      return true
    })
  })

  test('moneda no seguida → 404 con el detalle del Worker', async () => {
    const w = await workerSimulado()
    await assert.rejects(clienteDe(w).moneda('DOGE'), (e) => e instanceof ErrorApi && e.estado === 404 && e.message === 'Moneda no seguida: DOGE')
  })
})

describe('cliente de la API sin servidor', () => {
  test('sin URL configurada no llama a la red', async () => {
    let llamadas = 0
    const api = crearApi({ base: '', fetch: async () => { llamadas++; return new Response('{}') }, pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.codigo === 'sin_configurar')
    assert.equal(llamadas, 0)
  })

  test('red caída → ErrorApi estado 0 con mensaje legible', async () => {
    const api = crearApi({ base: BASE, fetch: async () => { throw new TypeError('Failed to fetch') }, pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.estado === 0 && e.codigo === 'red')
  })

  test('error sin cuerpo JSON → ErrorApi con el estado HTTP', async () => {
    const api = crearApi({ base: BASE, fetch: async () => new Response('Bad gateway', { status: 502 }), pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.estado === 502 && e.codigo === 'http' && !pideLogin(e))
  })

  test('429 ocupado del Worker real (intentos en vuelo) → reintenta tras reintentar_en y acaba entrando', async () => {
    const w = await workerSimulado()
    // 5 intentos en vuelo de la misma IP, como si otras pestañas estuvieran comprobando el PIN
    await w.db.prepare('INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta, en_vuelo, vuelo_hasta, token) VALUES (?, 0, NULL, 5, ?, ?)')
      .bind('10.0.0.1', w.ahora + 30_000, 'otro').run()
    /** @type {number[]} */
    const esperas = []
    const api = crearApi({
      base: BASE, fetch: w.fetch, pin: () => PIN,
      esperar: async (ms) => {
        esperas.push(ms)
        if (esperas.length === 2) await w.db.prepare('DELETE FROM intentos_pin').run()
      },
    })
    const r = await api.resumen()
    assert.equal(r.ahora, w.ahora)
    assert.deepEqual(esperas, [2000, 2000])
    assert.equal(w.llamadas.length, 3)
  })

  test('429 ocupado más de 3 veces → ErrorApi ocupado que no pide login', async () => {
    let llamadas = 0
    const ocupado = () => new Response(JSON.stringify({ error: 'ocupado', detalle: 'Hay otros intentos de PIN en curso.', reintentar_en: 2 }), { status: 429 })
    const api = crearApi({ base: BASE, fetch: async () => { llamadas++; return ocupado() }, pin: () => PIN, esperar: async () => {} })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.codigo === 'ocupado' && !pideLogin(e))
    assert.equal(llamadas, 4)
  })

  test(`como mucho ${MAX_EN_VUELO} peticiones en vuelo; las demás esperan su turno`, async () => {
    let enVuelo = 0
    let maximo = 0
    const api = crearApi({
      base: BASE, pin: () => PIN,
      fetch: async () => {
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        await new Promise((r) => setTimeout(r, 5))
        enVuelo--
        return new Response('{"ok":true}')
      },
    })
    const r = await Promise.all([api.resumen(), api.bot(), api.simulaciones(), api.operaciones(), api.decisiones()])
    assert.equal(r.length, 5)
    assert.equal(maximo, MAX_EN_VUELO)
  })

  test(`la vista Bot refrescada varias veces: nunca más de ${MAX_EN_VUELO} en vuelo`, async () => {
    let enVuelo = 0
    let maximo = 0
    let llamadas = 0
    const api = crearApi({
      base: BASE, pin: () => PIN,
      fetch: async () => {
        llamadas++
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        await new Promise((r) => setTimeout(r, 2))
        enVuelo--
        return new Response('{"ok":true}')
      },
    })
    // Como vistaBot: bot() y luego simulaciones, operaciones y decisiones a la vez; tres refrescos seguidos.
    for (let i = 0; i < 3; i++) {
      await api.bot()
      await Promise.all([api.simulaciones(), api.operaciones({ simulacion: 1 }), api.decisiones({ simulacion: 1 }), api.resumen()])
    }
    assert.equal(llamadas, 15)
    assert.equal(maximo, MAX_EN_VUELO)
  })

  test('limitador: tandas consecutivas no superan el máximo y el contador vuelve a 0', async () => {
    const limitar = crearLimitador(2)
    let enVuelo = 0
    let maximo = 0
    const tarea = async () => {
      enVuelo++
      maximo = Math.max(maximo, enVuelo)
      await new Promise((r) => setTimeout(r, 2))
      enVuelo--
    }
    for (let tanda = 0; tanda < 3; tanda++) {
      await Promise.all(Array.from({ length: 5 }, () => limitar(tarea)))
      assert.equal(maximo, 2, `tanda ${tanda}`)
      assert.equal(limitar.ocupadas(), 0, `tanda ${tanda}`)
    }
  })

  test('una petición en cola que arranca tras cerrar sesión no llama al Worker', async () => {
    /** @type {string|null} */
    let pin = PIN
    /** @type {string[]} */
    const cabeceras = []
    const api = crearApi({
      base: BASE, pin: () => pin, maxEnVuelo: 1,
      fetch: async (_url, init) => {
        cabeceras.push(String(new Headers(init?.headers).get('Authorization')))
        await new Promise((r) => setTimeout(r, 5))
        return new Response('{"ok":true}')
      },
    })
    const primera = api.resumen()
    const segunda = api.bot()
    pin = null
    assert.deepEqual(await primera, { ok: true })
    await assert.rejects(segunda, (e) => e instanceof ErrorApi && e.codigo === 'sin_sesion' && pideLogin(e))
    assert.equal(cabeceras.length, 1)
    assert.ok(cabeceras[0].endsWith(PIN))
  })

  test('limitador: un fallo libera el hueco', async () => {
    const limitar = crearLimitador(1)
    await assert.rejects(limitar(async () => { throw new Error('x') }))
    assert.equal(await limitar(async () => 7), 7)
  })

  test('plazo agotado → ErrorApi tiempo; analizar tiene su propio plazo más largo', async () => {
    /** @type {string[]} */
    const vistas = []
    /** @type {typeof fetch} */
    const lento = (entrada, init) => new Promise((resolver, rechazar) => {
      vistas.push(String(entrada))
      const t = setTimeout(() => resolver(new Response('{"ejecucion":{}}')), 40)
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(t)
        rechazar(new DOMException('abortada', 'AbortError'))
      })
    })
    const api = crearApi({ base: BASE, fetch: lento, pin: () => PIN, plazoMs: 10, plazoAnalizarMs: 200 })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.codigo === 'tiempo' && e.estado === 0)
    assert.deepEqual(await api.analizar(), { ejecucion: {} })
    assert.equal(vistas.length, 2)
  })

  test('mensajeError de errores que no son de la API', () => {
    assert.equal(mensajeError(new Error('x')), 'Error inesperado: x')
  })
})

describe('sesión', () => {
  /** @returns {import('../../js/sesion.js').Almacen & { datos: Map<string, string> }} */
  const almacen = () => {
    const datos = new Map()
    return {
      datos,
      getItem: (c) => datos.get(c) ?? null,
      setItem: (c, v) => { datos.set(c, v) },
      removeItem: (c) => { datos.delete(c) },
    }
  }

  test('guarda, lee y olvida el PIN en el almacén', () => {
    const a = almacen()
    const s = crearSesion(a)
    assert.equal(s.pin(), null)
    s.guardar('1234')
    assert.equal(a.datos.get(CLAVE_PIN), '1234')
    assert.equal(crearSesion(a).pin(), '1234')
    s.olvidar()
    assert.equal(s.pin(), null)
  })

  test('401 olvida el PIN y pide login; un bloqueo (aunque sea global) lo conserva; otros errores no tocan la sesión', () => {
    const s = crearSesion(almacen())
    s.guardar('1234')
    const bloqueo = new ErrorApi(429, 'bloqueado', 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', Date.UTC(2026, 9, 19, 10))
    assert.equal(tratarErrorDeSesion(bloqueo, s), 'bloqueo')
    assert.equal(s.pin(), '1234')
    assert.match(mensajeError(bloqueo), /^Demasiados intentos con PIN incorrecto\. Acceso bloqueado hasta las \d\d:\d\d\.$/)
    assert.equal(tratarErrorDeSesion(new ErrorApi(502, 'http', 'Error 502 del servidor.'), s), null)
    assert.equal(tratarErrorDeSesion(new ErrorApi(429, 'ocupado', 'Hay otros intentos de PIN en curso.'), s), null)
    assert.equal(tratarErrorDeSesion(new Error('x'), s), null)
    assert.equal(s.pin(), '1234')
    assert.equal(tratarErrorDeSesion(new ErrorApi(401, 'pin_incorrecto', 'PIN incorrecto.'), s), 'login')
    assert.equal(s.pin(), null)
  })

  test('si el almacén falla, el PIN vive en memoria', () => {
    const roto = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    const s = crearSesion(roto)
    s.guardar('9999')
    assert.equal(s.pin(), '9999')
    s.olvidar()
    assert.equal(s.pin(), null)
    assert.equal(crearSesion(null).pin(), null)
  })
})

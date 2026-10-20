// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial, velaDeDecision } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { ejecutarBacktest } from '../../core/backtest.js'
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { ejecutarHora } from '../../core/hora.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { cargarEstado, crearSimulacion, obtenerSimulacion, senalesActuales } from '../src/repositorio.js'
import { cuerposConsumidos } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { CIERRE, ahoraDe, crearEscenario, entradasBacktest, fetchEscenario, servidasEn, sinEspera } from './escenario.js'

/** @param {ReturnType<typeof crearD1>|any} db @param {string} [monedas] */
const entorno = (db, monedas = 'BTC,ETH') => ({ DB: db, MONEDAS: monedas })

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

/** Saldo = capital − compras + (ventas − comisiones): el libro cuadra con la tabla de operaciones. @param {ReturnType<typeof crearD1>} db */
async function comprobarLibro(db) {
  const sim = await db.prepare('SELECT * FROM simulaciones WHERE activa = 1').first()
  const ops = await filas(db, 'SELECT * FROM operaciones WHERE simulacion_id = ? ORDER BY id', sim.id)
  const libro = ops.reduce((s, o) => (o.lado === 'compra' ? s - o.importe : s + o.importe - o.comision), sim.capital_inicial)
  assert.ok(Math.abs(libro - sim.saldo) < 1e-9, `libro ${libro} ≠ saldo ${sim.saldo}`)
  if (ops.length > 0) assert.equal(ops[ops.length - 1].saldo_tras, sim.saldo)
  const abiertas = await filas(db, "SELECT simbolo FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta'", sim.id)
  const compradas = ops.filter((o) => o.lado === 'compra').length - ops.filter((o) => o.lado === 'venta').length
  assert.equal(abiertas.length, compradas)
}

describe('ejecutarMercado (cron)', () => {
  test('primera ejecución: crea la simulación activa con 10.000 € y la estrategia activa, y lo guarda todo', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    const sim = await db.prepare('SELECT * FROM simulaciones').first()
    assert.equal(sim.estrategia_version, ESTRATEGIA_ACTIVA)
    assert.equal(sim.capital_inicial, 10_000)
    assert.equal(sim.activa, 1)
    assert.notEqual(sim.hodl_json, null)
    assert.equal((await filas(db, 'SELECT * FROM decisiones')).length, 2)
    assert.deepEqual((await filas(db, 'SELECT vela_1h FROM capital')).map((c) => c.vela_1h), [velaDeDecision(ahora)])
    const senales = await senalesActuales(db)
    assert.deepEqual(Object.keys(senales).sort(), ['BTC', 'ETH'])
    const btc = senales.BTC
    assert.equal(btc.precioEur, servidasEn(escenario.BTC.eur, ahora).at(-2)?.cierre, 'cierre EUR de la última vela cerrada')
    assert.equal(btc.motorExplicacion, 'plantilla')
    assert.equal(typeof btc.explicacion, 'string')
    assert.equal(typeof btc.cambio24h, 'number')
    const ejecucion = await db.prepare('SELECT * FROM ejecuciones').first()
    assert.equal(ejecucion.tipo, 'mercado')
    const detalle = JSON.parse(ejecucion.detalle_json)
    assert.deepEqual(detalle.fng, { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.equal(detalle.fallos.filter((/** @type {string} */ f) => f.startsWith('derivados')).length, 6, 'funding, long/short y OI de 2 monedas')
    await comprobarLibro(db)
  })

  test('hora a hora da exactamente lo mismo que core/hora.js con las ventanas del backtest (VENTANA = 299 velas cerradas)', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    let estado = estadoInicial(10_000)
    /** @type {Record<string, number>|null} */
    let hodl = null
    for (let k = 0; k < 8; k++) {
      const ahora = ahoraDe(k)
      const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      assert.deepEqual(r.repetidas, [])
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: v1,
      })
      estado = memoria.estado
      hodl = memoria.hodl
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, 1))
      const desdeD1 = await cargarEstado(db, sim, v1.PARAMETROS_BOT)
      assert.deepEqual(desdeD1.estado, memoria.estado, `estado en la hora ${k}`)
      assert.deepEqual(desdeD1.hodl, memoria.hodl, `HODL en la hora ${k}`)
      const capital = await db.prepare('SELECT * FROM capital WHERE vela_1h = ?').bind(velaDeDecision(ahora)).first()
      assert.equal(capital.valor_cartera, memoria.punto.valor, `capital en la hora ${k}`)
      assert.equal(capital.valor_hodl, memoria.punto.hodl)
      const decisiones = await filas(db, 'SELECT simbolo, motivo, desglose_json FROM decisiones WHERE vela_1h = ? ORDER BY id', velaDeDecision(ahora))
      assert.deepEqual(decisiones.map((d) => ({ simbolo: d.simbolo, motivo: d.motivo })), memoria.decisiones.map((d) => ({ simbolo: d.simbolo, motivo: d.motivo })))
      // La señal completa (indicadores incluidos) coincide bit a bit: misma ventana de velas que el backtest.
      assert.deepEqual(decisiones.map((d) => JSON.parse(d.desglose_json)), JSON.parse(JSON.stringify(memoria.senales)), `señales en la hora ${k}`)
    }
    const motivos = await filas(db, 'SELECT simbolo, lado, motivo FROM operaciones ORDER BY id')
    assert.deepEqual(motivos.map((o) => `${o.simbolo}:${o.lado}:${o.motivo}`), [
      'BTC:compra:senal', 'ETH:compra:senal', 'BTC:venta:stop_loss', 'ETH:venta:take_profit', 'ETH:compra:senal', 'BTC:compra:senal',
    ])
    await comprobarLibro(db)
    // El backtest real sobre las mismas series da las mismas operaciones y el mismo saldo, bit a bit.
    const bt = ejecutarBacktest({ series: escenario, fng: [{ t: 0, valor: 53 }], desde: CIERRE, hasta: ahoraDe(7), estrategia: v1 })
    const ops = await filas(db, 'SELECT * FROM operaciones ORDER BY id')
    assert.deepEqual(ops.map((o) => ({
      tipo: o.lado, simbolo: o.simbolo, vela: o.vela_1h, precio: o.precio, unidades: o.unidades, importe: o.importe,
      comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo, pnlNeto: o.pnl_neto ?? undefined,
    })), bt.operaciones.map((o) => ({
      tipo: o.tipo, simbolo: o.simbolo, vela: o.vela, precio: o.precio, unidades: o.unidades, importe: o.importe,
      comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo, pnlNeto: o.pnlNeto,
    })))
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), bt.metricas.saldo)
  })

  test('cada simulación usa su propia estrategia: una v2 decide solo al cierre diario y revisa stops cada hora', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v2', ahora: 0 })
    let estado = estadoInicial(10_000)
    /** @type {Record<string, number>|null} */
    let hodl = null
    for (let k = 0; k < 3; k++) {
      const ahora = ahoraDe(k)
      await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: v2,
      })
      estado = memoria.estado
      hodl = memoria.hodl
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, 1))
      assert.deepEqual((await cargarEstado(db, sim, v2.PARAMETROS_BOT)).estado, memoria.estado, `estado en la hora ${k}`)
    }
    const d = await filas(db, "SELECT vela_1h, motivo FROM decisiones WHERE simbolo = 'BTC' ORDER BY vela_1h")
    assert.deepEqual(d.map((x) => x.motivo), ['abierta', 'fuera_de_ventana', 'fuera_de_ventana'])
    const ops = await filas(db, "SELECT lado, motivo, estrategia_version FROM operaciones WHERE simbolo = 'BTC' ORDER BY id")
    assert.deepEqual(ops, [
      { lado: 'compra', motivo: 'senal', estrategia_version: 'v2' },
      { lado: 'venta', motivo: 'stop_loss', estrategia_version: 'v2' },
    ])
    assert.equal(JSON.parse((await db.prepare("SELECT desglose_json FROM decisiones WHERE simbolo = 'BTC'").first('desglose_json'))).version, 'v2')
  })

  test('repetir la misma hora (doble cron o reintento) no duplica nada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    const contar = async () => Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map(
      (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'),
    ))
    const antes = [...await contar(), await db.prepare('SELECT saldo FROM simulaciones').first('saldo')]
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora + 60_000), ahora: ahora + 60_000 })
    assert.deepEqual(r.repetidas, ['BTC', 'ETH'])
    assert.deepEqual([...await contar(), await db.prepare('SELECT saldo FROM simulaciones').first('saldo')], antes)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM ejecuciones').first('n'), 2)
  })

  test('si falla el lote de una moneda, el resto entra, el libro cuadra y la moneda se recupera después', async () => {
    const base = crearD1()
    await crearSimulacion(base, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const escenario = crearEscenario()
    // D1 que rechaza el lote de ETH, como un error transitorio de D1.
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO decisiones') && s.valores[1] === 'ETH')) {
          throw new Error('D1_ERROR: simulado')
        }
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.ok(r.ejecucion.fallos.includes('bot ETH: D1_ERROR: simulado'))
    assert.deepEqual((await filas(base, "SELECT simbolo FROM posiciones WHERE estado = 'abierta'")).map((p) => p.simbolo), ['BTC'])
    assert.deepEqual((await filas(base, 'SELECT simbolo FROM progreso')).map((p) => p.simbolo), ['BTC'])
    const sim = await base.prepare('SELECT * FROM simulaciones').first()
    const btc = await base.prepare('SELECT * FROM posiciones').first()
    const capital = await base.prepare('SELECT * FROM capital').first()
    const precioBtc = servidasEn(escenario.BTC.eur, ahora).at(-2)?.cierre ?? NaN
    assert.ok(Math.abs(capital.valor_cartera - (sim.saldo + btc.unidades * precioBtc)) < 1e-9)
    await comprobarLibro(base)

    const despues = ahoraDe(1)
    await ejecutarMercado({ esperar: sinEspera, env: entorno(base), fetch: fetchEscenario(escenario, despues), ahora: despues })
    const eth = await filas(base, "SELECT motivo FROM decisiones WHERE simbolo = 'ETH'")
    assert.deepEqual(eth.map((d) => d.motivo), ['abierta'])
    await comprobarLibro(base)
  })

  test('una moneda sin velas: SIN_DATOS registrado, las demás siguen y el capital se guarda', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(escenario, ahora, { caidas: ['SOL-USDT', 'SOL-EUR'] })
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db, 'BTC,ETH,SOL'), fetch, ahora })
    assert.ok(r.ejecucion.fallos.includes('velas SOL-USDT 1h: HTTP 500'))
    assert.ok(r.ejecucion.fallos.includes('velas SOL-EUR 1h: HTTP 500'))
    const sol = await db.prepare("SELECT veredicto, motivo, accion FROM decisiones WHERE simbolo = 'SOL'").first()
    assert.deepEqual(sol, { veredicto: 'SIN_DATOS', motivo: 'sin_datos', accion: 'ninguna' })
    assert.equal((await filas(db, 'SELECT * FROM decisiones')).length, 3)
    const capital = await db.prepare('SELECT * FROM capital').first()
    assert.equal(capital.valor_hodl, null, 'sin precio de SOL no hay comprar y mantener todavía')
    assert.equal((await db.prepare('SELECT hodl_json FROM simulaciones').first('hodl_json')), null)
  })

  test('la contradicción técnico/derivados llega a decisiones.motivo como texto libre', async () => {
    const db = crearD1()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    // Técnico claramente alcista y funding de +0,06 % por 8 h (derivados −1): v1 manda MANTENER.
    const funding = { 'BTC-USDT-SWAP': '0.0006' }
    await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora, { funding }), ahora })
    const btc = await db.prepare("SELECT veredicto, motivo, accion FROM decisiones WHERE simbolo = 'BTC'").first()
    assert.deepEqual(btc, { veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados', accion: 'ninguna' })
    const eth = await db.prepare("SELECT motivo FROM decisiones WHERE simbolo = 'ETH'").first('motivo')
    assert.equal(eth, 'abierta', 'ETH no tiene funding en la respuesta: derivados ausentes')
  })

  test('presupuesto §9 con 5 monedas y la caché vacía: 38 subpeticiones externas, todas las de mercado a OKX, y como mucho 19 llamadas a D1', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(crearEscenario(), ahora)
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    await ejecutarMercado({ esperar: sinEspera, env, fetch, ahora })
    assert.equal(fetch.llamadas.length, 20 + 15 + 1 + 2)
    assert.equal(fetch.llamadas.filter((l) => l.url.startsWith('https://www.okx.com/')).length, 20 + 15)
    assert.ok(fetch.llamadas.every((l) => !l.url.includes('binance')), 'Binance no responde desde Cloudflare')
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('-USDT&bar=') && l.url.endsWith('&limit=300')).length, 15)
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('-EUR&bar=1H&limit=48')).length, 5)
    const okx = fetch.llamadas.map((l) => l.url).filter((u) => u.startsWith('https://www.okx.com/'))
    assert.ok(okx.slice(0, 20).every((u) => u.includes('/market/candles')), 'primero las velas (imprescindibles), luego los derivados')
    assert.ok(cuerposConsumidos(fetch), 'ningún cuerpo de respuesta queda sin leer o cancelar')
    assert.ok(db.llamadas <= 19, `${db.llamadas} llamadas a D1`)
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
    assert.equal(detalle.subpeticiones, 38)
    assert.deepEqual(detalle.velasBybit, [])
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM cache_velas').first('n'), 20)
  })

  test('con la caché: una hora normal pide solo 1H USDT y EUR con limit=3 (23 subpeticiones); al cerrar la 4H, también la 4H', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    const funding = Object.fromEntries(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].map((s) => [`${s}-USDT-SWAP`, '0.0001']))
    /** @param {number} k */
    const hora = async (k) => {
      const fetch = fetchEscenario(escenario, ahoraDe(k), { funding })
      const r = await ejecutarMercado({ esperar: sinEspera, env, fetch, ahora: ahoraDe(k) })
      assert.deepEqual(r.ejecucion.fallos.filter((f) => f.startsWith('velas')), [])
      return fetch.llamadas.map((l) => l.url)
    }
    assert.equal((await hora(0)).length, 38)
    const h1 = await hora(1)
    const velas1 = h1.filter((u) => u.includes('/market/candles'))
    assert.equal(velas1.length, 10)
    assert.ok(velas1.every((u) => u.endsWith('&bar=1H&limit=3')), velas1.join(' '))
    assert.equal(h1.filter((u) => u.includes('funding-rate')).length, 0, 'el funding sigue en la caché')
    assert.equal(h1.length, 10 + 10 + 1 + 2)
    const velas4 = (await hora(4)).filter((u) => u.includes('/market/candles'))
    assert.equal(velas4.filter((u) => u.endsWith('&bar=4H&limit=3')).length, 5)
    assert.equal(velas4.length, 15)
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones ORDER BY id DESC').first('detalle_json'))
    assert.equal(detalle.subpeticiones, 15 + 10 + 1 + 2)
  })

  test('OKX limitando las velas USDT de BTC: Bybit las sirve, BTC no queda SIN_DATOS y la fuente queda anotada (sin entrar en la caché)', async () => {
    const db = crearD1()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(escenario, ahora, { limitado: (url) => url.includes('candles?instId=BTC-USDT') })
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch, ahora })
    assert.deepEqual(r.senales.map((s) => s.veredicto), ['COMPRAR', 'COMPRAR'])
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
    assert.deepEqual(detalle.velasBybit, ['BTC-USDT 1h', 'BTC-USDT 4h', 'BTC-USDT 1d'])
    assert.ok(detalle.fallos.includes('velas BTC-USDT 1h: HTTP 429 (código 50011)'))
    const bybit = fetch.llamadas.filter((l) => l.url.startsWith('https://api.bybit.com/'))
    assert.equal(bybit.length, 3)
    assert.ok(bybit.every((l) => l.url.endsWith('&limit=300')))
    const claves = await filas(db, 'SELECT instrumento, intervalo FROM cache_velas ORDER BY instrumento, intervalo')
    assert.deepEqual(claves.map((c) => `${c.instrumento} ${c.intervalo}`), ['BTC-EUR 1h', 'ETH-EUR 1h', 'ETH-USDT 1d', 'ETH-USDT 1h', 'ETH-USDT 4h'])
    // Igual que con OKX: la misma señal que una ejecución sin límite.
    const otra = crearD1()
    await crearSimulacion(otra, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const normal = await ejecutarMercado({ esperar: sinEspera, env: entorno(otra), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.deepEqual(r.senales[0].componentes, normal.senales[0].componentes)
  })

  test('funding en caché: se pide como mucho cada 8 h; si entonces falla, vale el guardado (< 24 h) y se anota', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const funding = { 'BTC-USDT-SWAP': '0.0006' }
    for (let k = 0; k <= 8; k++) {
      const fetch = fetchEscenario(escenario, ahoraDe(k), { funding: k < 8 ? funding : null })
      const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch, ahora: ahoraDe(k) })
      const pedidas = fetch.llamadas.filter((l) => l.url.includes('/public/funding-rate')).map((l) => new URL(l.url).searchParams.get('instId'))
      // ETH nunca tiene funding en este escenario: se reintenta cada hora.
      assert.deepEqual(pedidas, k === 0 || k === 8 ? ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'] : ['ETH-USDT-SWAP'], `hora ${k}`)
      const motivo = await db.prepare("SELECT motivo FROM decisiones WHERE simbolo = 'BTC' AND vela_1h = ?").bind(velaDeDecision(ahoraDe(k))).first('motivo')
      assert.equal(motivo, 'contradiccion_tecnico_derivados', `hora ${k}: el funding guardado sigue contando`)
      if (k === 8) assert.ok(r.ejecucion.fallos.includes('derivados funding BTC: HTTP 503'))
    }
    assert.equal(await db.prepare("SELECT actualizado_en FROM cache_funding WHERE simbolo = 'BTC'").first('actualizado_en'), ahoraDe(0))
  })

  test('si no se puede escribir la caché, la ejecución sigue ok y lo anota', async () => {
    const base = crearD1()
    await crearSimulacion(base, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO cache_velas'))) throw new Error('D1_ERROR: simulado')
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    assert.ok(r.ejecucion.fallos.includes('caché: D1_ERROR: simulado'))
    assert.deepEqual(r.senales.map((s) => s.veredicto), ['COMPRAR', 'COMPRAR'])
  })

  test('OKX limitando (429/50011) en todo y Bybit caído: reintentos y respaldo llenan el hueco hasta 49 subpeticiones (≤ 50), SIN_DATOS y ejecución ok', async () => {
    for (const [claves, llm, reintentos, bybit] of /** @type {const} */ ([[true, 2, 6, 5], [false, 0, 7, 6]])) {
      const db = crearD1()
      const ahora = ahoraDe(0)
      const fetch = fetchEscenario(crearEscenario(), ahora, { limitado: true, bybitCaido: true })
      const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), ...(claves ? { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' } : {}) }
      const r = await ejecutarMercado({ esperar: sinEspera, env, fetch, ahora })
      assert.equal(r.ejecucion.ok, true)
      // 35 a OKX + reintentos + Bybit + F&G + LLM externos configurados + 1 de margen = 50.
      assert.equal(fetch.llamadas.length, 20 + 15 + reintentos + bybit + 1 + llm)
      assert.equal(fetch.llamadas.length, 49)
      assert.equal(fetch.llamadas.filter((l) => l.url.startsWith('https://api.bybit.com/')).length, bybit)
      assert.ok(r.senales.every((s) => s.veredicto === 'SIN_DATOS'))
      const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
      assert.equal(detalle.reintentosOkx, reintentos)
      assert.equal(detalle.subpeticiones, 49)
    }
  })
})

describe('ejecutarMercado (manual: POST /api/analizar)', () => {
  test('refresca las señales sin crear simulaciones ni operar', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.equal(r.ejecucion.tipo, 'manual')
    assert.equal(r.senales.length, 2)
    for (const t of ['simulaciones', 'decisiones', 'operaciones', 'posiciones', 'capital', 'progreso']) {
      assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'), 0, t)
    }
    assert.deepEqual(Object.keys(await senalesActuales(db)).sort(), ['BTC', 'ETH'])
  })

  test('con una simulación activa tampoco toca su saldo, decisiones ni posiciones', async () => {
    const db = crearD1()
    const sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.ok(r.senales.every((s) => s.veredicto === 'COMPRAR'), 'la señal es de compra y aun así no se abre nada')
    assert.deepEqual(await obtenerSimulacion(db, sim.id), sim)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM decisiones').first('n'), 0)
    assert.equal(r.senales[0].orientativo?.stopLoss < r.senales[0].precioEur, true)
  })
})

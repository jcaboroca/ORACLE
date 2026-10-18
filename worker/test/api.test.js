// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { velaDeDecision } from '../../core/bot.js'
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { HORA } from '../../core/velas.js'
import { ESPERA_ANALIZAR_MS, TAMANO_PAGINA, atender, primeraFrase, submuestrearCurva } from '../src/api.js'
import { BLOQUEO_MS, compararSeguro } from '../src/auth.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearSimulacion, guardarPuntuaciones, insertarTitulares } from '../src/repositorio.js'
import { simularFetch } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario } from './escenario.js'

const PIN = '4815162342'
const ORIGEN = 'https://jcaboroca.github.io'

/** @param {ReturnType<typeof crearD1>} db */
const entorno = (db) => ({
  DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: `${ORIGEN},http://localhost:8080`,
})

/**
 * Llama a la API como lo haría la PWA.
 * @param {ReturnType<typeof crearD1>} db
 * @param {string} ruta
 * @param {{ metodo?: string, pin?: string|null, origen?: string, ip?: string, cuerpo?: unknown, ahora?: number,
 *   fetch?: typeof fetch }} [op]
 */
async function pedir(db, ruta, { metodo = 'GET', pin = PIN, origen = ORIGEN, ip = '1.2.3.4', cuerpo, ahora = ahoraDe(6), fetch } = {}) {
  /** @type {Record<string, string>} */
  const cabeceras = { Origin: origen, 'CF-Connecting-IP': ip }
  if (pin !== null) cabeceras.Authorization = `Bearer ${pin}`
  const peticion = new Request(`https://oracle.workers.dev${ruta}`, {
    method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const res = await atender(peticion, {
    env: entorno(db), fetch: fetch ?? fetchEscenario(crearEscenario(), ahora), ahora,
  })
  const texto = await res.text()
  return { estado: res.status, cabeceras: res.headers, cuerpo: texto ? JSON.parse(texto) : null }
}

/** Base con 6 horas del escenario ejecutadas (simulación v1) y titulares de prueba. */
async function conDatos() {
  const db = crearD1()
  const escenario = crearEscenario()
  await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
  for (let k = 0; k < 6; k++) {
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
  }
  const t = ahoraDe(5)
  await insertarTitulares(db, [
    { id: 't1', fuente: 'CoinDesk', origen: 'rss', titulo: 'Bitcoin rally', url: 'https://x.test/1', publicadoEn: t - HORA },
    { id: 't2', fuente: 'r/Bitcoin', origen: 'reddit', titulo: 'Market crash', url: null, publicadoEn: t - 2 * HORA },
    { id: 't3', fuente: 'Decrypt', origen: 'rss', titulo: 'Ether news', url: null, publicadoEn: t - 3 * HORA },
  ])
  await guardarPuntuaciones(db, {
    t1: { puntuacion: 0.5, monedas: ['BTC'], motor: 'cf' },
    t2: { puntuacion: -0.5, monedas: ['MERCADO'], motor: 'lexico' },
    t3: { puntuacion: 0, monedas: ['ETH'], motor: 'groq' },
  })
  return db
}

describe('PIN, bloqueo y CORS', () => {
  test('compararSeguro: igual solo si son idénticos, sin importar la longitud', async () => {
    assert.equal(await compararSeguro(PIN, PIN), true)
    assert.equal(await compararSeguro(PIN, `${PIN}0`), false)
    assert.equal(await compararSeguro('', PIN), false)
  })

  test('sin PIN o con PIN incorrecto → 401 y los intentos que quedan; con PIN correcto → 200', async () => {
    const db = crearD1()
    const sin = await pedir(db, '/api/simulaciones', { pin: null })
    assert.equal(sin.estado, 401)
    assert.deepEqual(sin.cuerpo, { error: 'pin_incorrecto', detalle: 'PIN incorrecto. Quedan 4 intentos.' })
    const mal = await pedir(db, '/api/simulaciones', { pin: '0000' })
    assert.equal(mal.cuerpo.detalle, 'PIN incorrecto. Quedan 3 intentos.')
    const bien = await pedir(db, '/api/simulaciones')
    assert.equal(bien.estado, 200)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM intentos_pin').first('n'), 0, 'acertar borra los fallos')
  })

  test('5 fallos desde una IP → bloqueo de 15 min, incluso con el PIN correcto; otras IPs no se ven afectadas', async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    for (let i = 0; i < 4; i++) assert.equal((await pedir(db, '/api/resumen', { pin: 'x', ahora })).estado, 401)
    const quinto = await pedir(db, '/api/resumen', { pin: 'x', ahora })
    assert.equal(quinto.estado, 429)
    assert.deepEqual(quinto.cuerpo, {
      error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta: ahora + BLOQUEO_MS,
    })
    assert.equal((await pedir(db, '/api/resumen', { ahora: ahora + BLOQUEO_MS - 1 })).estado, 429)
    assert.equal((await pedir(db, '/api/resumen', { ip: '5.6.7.8', ahora })).estado, 200)
    assert.equal((await pedir(db, '/api/resumen', { ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('sin el secret ORACLE_PIN nadie entra', async () => {
    const db = crearD1()
    const res = await atender(new Request('https://o.dev/api/resumen', { headers: { Authorization: 'Bearer ' } }), {
      env: { DB: db }, fetch: simularFetch(() => ({})), ahora: 0,
    })
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' })
  })

  test('CORS solo para los orígenes de ORIGENES; OPTIONS responde 204 sin PIN', async () => {
    const db = crearD1()
    const permitido = await pedir(db, '/api/simulaciones', { origen: 'http://localhost:8080' })
    assert.equal(permitido.cabeceras.get('Access-Control-Allow-Origin'), 'http://localhost:8080')
    const ajeno = await pedir(db, '/api/simulaciones', { origen: 'https://evil.example' })
    assert.equal(ajeno.cabeceras.get('Access-Control-Allow-Origin'), null)
    const previa = await pedir(db, '/api/bot', { metodo: 'OPTIONS', pin: null })
    assert.equal(previa.estado, 204)
    assert.equal(previa.cabeceras.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type')
    assert.equal(permitido.cabeceras.get('Cache-Control'), 'no-store')
  })

  test('ruta inexistente → 404; método equivocado → 405; ambos en JSON', async () => {
    const db = crearD1()
    const inexistente = await pedir(db, '/api/ordenes')
    assert.equal(inexistente.estado, 404)
    assert.deepEqual(inexistente.cuerpo, { error: 'no_encontrado', detalle: 'No existe /api/ordenes' })
    const r = await pedir(db, '/api/analizar')
    assert.equal(r.estado, 405)
    assert.equal(r.cuerpo.error, 'metodo_no_permitido')
  })
})

describe('GET /api/salud (pública)', () => {
  test('503 sin ejecuciones; 200 con una de mercado correcta de hace ≤ 2 h; 503 si es más vieja', async () => {
    const db = crearD1()
    assert.deepEqual((await pedir(db, '/api/salud', { pin: null })).cuerpo, { ok: false, ultimaEjecucion: null })
    const ahora = ahoraDe(0)
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    const r = await pedir(db, '/api/salud', { pin: null, ahora: ahora + HORA })
    assert.equal(r.estado, 200)
    assert.equal(r.cuerpo.ok, true)
    assert.deepEqual(Object.keys(r.cuerpo.ultimaEjecucion), ['id', 'tipo', 'inicio', 'fin', 'ok', 'fallos'])
    assert.equal(r.cuerpo.ultimaEjecucion.tipo, 'mercado')
    assert.equal((await pedir(db, '/api/salud', { pin: null, ahora: ahora + 3 * HORA })).estado, 503)
  })
})

describe('rutas con PIN', () => {
  test('GET /api/resumen: señales en el orden de MONEDAS, F&G, bot y frescura', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 60_000 })
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['ahora', 'senales', 'fng', 'bot', 'ultimaEjecucion', 'ultimaNoticias', 'datosDesactualizados'])
    assert.deepEqual(r.cuerpo.senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
    assert.deepEqual(Object.keys(r.cuerpo.senales[0]), [
      'simbolo', 'veredicto', 'indiceConfianza', 'puntuacion', 'precioEur', 'cambio24h', 'fresca', 'calculadaEn', 'vela1h',
      'frase', 'motorExplicacion', 'estrategiaVersion',
    ])
    assert.match(r.cuerpo.senales[0].frase, /^Señal de compra en BTC/)
    assert.deepEqual(r.cuerpo.fng, { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.deepEqual(Object.keys(r.cuerpo.bot), [
      'simulacionId', 'estrategiaVersion', 'capitalInicial', 'saldo', 'valorCartera', 'valorHodl', 'rentabilidad',
      'rentabilidadHodl', 'posicionesAbiertas', 'actualizadoEn',
    ])
    assert.equal(r.cuerpo.bot.posicionesAbiertas, 2)
    assert.equal(r.cuerpo.bot.actualizadoEn, velaDeDecision(ahoraDe(5)))
    assert.equal(r.cuerpo.ultimaEjecucion.tipo, 'mercado')
    assert.equal(r.cuerpo.ultimaNoticias, null)
    assert.equal(r.cuerpo.datosDesactualizados, false)
    const tarde = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 3 * HORA })
    assert.equal(tarde.cuerpo.datosDesactualizados, true)
  })

  test('GET /api/moneda/:sym: señal completa, titulares de la moneda o del mercado y últimas decisiones', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/moneda/btc')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['simbolo', 'senal', 'titulares', 'decisiones'])
    assert.equal(r.cuerpo.simbolo, 'BTC')
    const s = r.cuerpo.senal
    for (const k of ['version', 'veredicto', 'componentes', 'ausentes', 'detalle', 'precioEur', 'cambio24h', 'explicacion', 'motorExplicacion', 'orientativo']) {
      assert.ok(k in s, k)
    }
    assert.deepEqual(r.cuerpo.titulares.map((/** @type {any} */ t) => t.id), ['t1', 't2'])
    assert.deepEqual(r.cuerpo.titulares[0], {
      id: 't1', fuente: 'CoinDesk', origen: 'rss', titulo: 'Bitcoin rally', url: 'https://x.test/1', publicadoEn: ahoraDe(5) - HORA,
      monedas: ['BTC'], puntuacion: 0.5, motor: 'cf', usado: false,
    })
    assert.equal(r.cuerpo.decisiones.length, 6)
    assert.deepEqual(Object.keys(r.cuerpo.decisiones[0]), [
      'id', 'simbolo', 'vela1h', 'veredicto', 'indiceConfianza', 'puntuacion', 'accion', 'motivo', 'precio', 'estrategiaVersion', 'creadaEn',
    ])
    assert.equal(r.cuerpo.decisiones[0].vela1h, velaDeDecision(ahoraDe(5)), 'la más reciente primero')
    assert.equal((await pedir(db, '/api/moneda/DOGE')).estado, 404)
  })

  test('GET /api/bot: métricas, posiciones con precio actual, curva y HODL', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/bot')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['simulacion', 'metricas', 'porMoneda', 'abiertas', 'curva', 'hodl'])
    assert.deepEqual(r.cuerpo.simulacion, {
      id: 1, creadaEn: 0, cerradaEn: null, activa: true, estrategiaVersion: 'v1', capitalInicial: 10_000, saldo: r.cuerpo.simulacion.saldo,
    })
    const m = r.cuerpo.metricas
    assert.equal(m.operaciones, 6)
    assert.equal(m.cerradas, 2)
    assert.equal(m.ganadoras + m.perdedoras, 2)
    assert.ok(Math.abs(m.valorCartera - r.cuerpo.curva.at(-1).valor) < 1e-9, 'valor = último punto de capital')
    assert.deepEqual(Object.keys(r.cuerpo.porMoneda).sort(), ['BTC', 'ETH'])
    assert.deepEqual(r.cuerpo.abiertas.map((/** @type {any} */ p) => p.simbolo), ['ETH', 'BTC'])
    assert.deepEqual(Object.keys(r.cuerpo.abiertas[0]), [
      'id', 'simbolo', 'velaEntrada', 'precioEntrada', 'unidades', 'coste', 'stopLoss', 'takeProfit', 'precioActual',
      'valorActual', 'pnlNoRealizado', 'pnlNoRealizadoPct',
    ])
    assert.equal(r.cuerpo.curva.length, 6)
    assert.deepEqual(Object.keys(r.cuerpo.curva[0]), ['t', 'valor', 'saldo', 'hodl'])
    assert.deepEqual(Object.keys(r.cuerpo.hodl), ['BTC', 'ETH'])
    assert.equal((await pedir(db, '/api/bot?simulacion=99')).estado, 404)
    assert.deepEqual((await pedir(db, '/api/bot?simulacion=abc')).cuerpo, {
      error: 'peticion_invalida', detalle: 'simulacion debe ser un entero positivo',
    })
  })

  test('paginación de decisiones y operaciones por id descendente, con filtro de símbolo', async () => {
    const db = await conDatos()
    const insertar = db.prepare(
      `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
       VALUES (1, 'XRP', ?, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`,
    )
    for (let i = 0; i < 55; i++) await insertar.bind(i * HORA).run()
    const p1 = await pedir(db, '/api/bot/decisiones?simbolo=XRP')
    assert.equal(p1.cuerpo.items.length, TAMANO_PAGINA)
    assert.equal(p1.cuerpo.siguienteCursor, p1.cuerpo.items.at(-1).id)
    const p2 = await pedir(db, `/api/bot/decisiones?simbolo=XRP&cursor=${p1.cuerpo.siguienteCursor}`)
    assert.equal(p2.cuerpo.items.length, 5)
    assert.equal(p2.cuerpo.siguienteCursor, null)
    const todas = await pedir(db, '/api/bot/decisiones')
    assert.ok(todas.cuerpo.items.every((/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ a) => i === 0 || a[i - 1].id > d.id))
    const ops = await pedir(db, '/api/bot/operaciones?simbolo=BTC')
    assert.deepEqual(ops.cuerpo.items.map((/** @type {any} */ o) => `${o.lado}:${o.motivo}`), ['compra:senal', 'venta:stop_loss', 'compra:senal'])
    assert.deepEqual(Object.keys(ops.cuerpo.items[0]), [
      'id', 'posicionId', 'simbolo', 'lado', 'vela1h', 'precio', 'unidades', 'importe', 'comision', 'deslizamiento', 'motivo',
      'saldoTras', 'pnlNeto', 'estrategiaVersion', 'creadaEn',
    ])
    assert.equal(ops.cuerpo.items[1].pnlNeto < 0, true, 'el stop-loss cierra con pérdida')
    assert.equal((await pedir(db, '/api/bot/operaciones?simbolo=b%27')).estado, 400)
  })

  test('POST /api/bot/reiniciar exige confirmar y un capital válido; cierra la activa y abre otra', async () => {
    const db = await conDatos()
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000 } })).estado, 400)
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 50, confirmar: true } })).estado, 400)
    const r = await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000, confirmar: true }, ahora: 777 })
    assert.equal(r.estado, 201)
    assert.deepEqual(r.cuerpo, {
      simulacion: { id: 2, creadaEn: 777, cerradaEn: null, activa: true, estrategiaVersion: ESTRATEGIA_ACTIVA, capitalInicial: 5000, saldo: 5000 },
    })
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.cerradaEn]), [[2, true, null], [1, false, 777]])
    assert.equal((await pedir(db, '/api/bot?simulacion=1')).cuerpo.metricas.operaciones, 6, 'la cerrada conserva su historia')
  })

  test('POST /api/analizar refresca las señales sin operar; 429 si no han pasado 5 minutos', async () => {
    const db = await conDatos()
    const contar = () => db.prepare('SELECT (SELECT COUNT(*) FROM decisiones) + (SELECT COUNT(*) FROM operaciones) AS n').first('n')
    const antes = await contar()
    const ahora = ahoraDe(5) + 20 * 60_000
    const r = await pedir(db, '/api/analizar', { metodo: 'POST', ahora })
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['senales', 'ejecucion'])
    assert.equal(r.cuerpo.ejecucion.tipo, 'manual')
    assert.equal(r.cuerpo.senales.length, 2)
    assert.equal(await contar(), antes)
    const pronto = await pedir(db, '/api/analizar', { metodo: 'POST', ahora: ahora + 60_000 })
    assert.equal(pronto.estado, 429)
    assert.deepEqual(pronto.cuerpo, {
      error: 'demasiado_pronto', detalle: 'Solo se puede analizar una vez cada 5 minutos.', hasta: ahora + ESPERA_ANALIZAR_MS,
    })
    assert.equal((await pedir(db, '/api/analizar', { metodo: 'POST', ahora: ahora + ESPERA_ANALIZAR_MS })).estado, 200)
  })
})

describe('utilidades de la API', () => {
  test('primeraFrase corta en el primer . ! ? seguido de espacio, sin partir decimales', () => {
    assert.equal(primeraFrase('Sube 1.5 puntos. Luego baja.'), 'Sube 1.5 puntos.')
    assert.equal(primeraFrase('Sin punto final'), 'Sin punto final')
    assert.equal(primeraFrase(''), '')
  })

  test('submuestrearCurva: horaria los últimos 30 días y diaria antes', () => {
    const dia = 24 * HORA
    const puntos = Array.from({ length: 40 * 24 }, (_, i) => ({ t: i * HORA, valor: i, saldo: i, hodl: null }))
    const r = submuestrearCurva(puntos)
    const corte = puntos.at(-1)?.t - 30 * dia
    assert.equal(r.filter((p) => p.t >= corte).length, puntos.filter((p) => p.t >= corte).length)
    const antiguos = r.filter((p) => p.t < corte)
    assert.ok(antiguos.every((p) => (p.t + HORA) % dia === 0), 'último punto de cada día')
    assert.equal(antiguos.length, 9)
    assert.deepEqual(submuestrearCurva([]), [])
  })
})

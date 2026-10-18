// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { velaDeDecision } from '../../core/bot.js'
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { calcularMetricas } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import {
  CURVA_MAXIMA, ESPERA_ANALIZAR_MS, TAMANO_PAGINA, atender, limitarCurva, primeraFrase, submuestrearCurva,
} from '../src/api.js'
import { BLOQUEO_MS, MAX_FALLOS_GLOBAL, REINTENTAR_EN_S, VENTANA_GLOBAL_MS, VUELO_MS, compararSeguro } from '../src/auth.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearSimulacion, guardarCapital, guardarPuntuaciones, insertarTitulares } from '../src/repositorio.js'
import { simularFetch } from './ayudantes.js'
import { Sentencia, crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from './escenario.js'

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
    env: entorno(db), fetch: fetch ?? fetchEscenario(crearEscenario(), ahora), ahora, esperar: sinEspera,
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
    await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
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

  test('ráfaga en paralelo desde una IP: como mucho 5 PIN comparados; el resto, 429 sin comparar (ni el correcto)', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // 20 a la vez; la 11.ª lleva el PIN correcto: llega con 5 intentos ya en vuelo y no debe ni compararse.
    const pines = Array.from({ length: 20 }, (_, i) => (i === 10 ? PIN : `00${i}`))
    const r = await Promise.all(pines.map((pin) => pedir(db, '/api/simulaciones', { pin, ahora })))
    assert.deepEqual(r.slice(0, 4).map((x) => x.cuerpo.detalle), [
      'PIN incorrecto. Quedan 4 intentos.', 'PIN incorrecto. Quedan 3 intentos.', 'PIN incorrecto. Quedan 2 intentos.',
      'PIN incorrecto. Quedan 1 intentos.',
    ])
    assert.equal(r.filter((x) => x.estado === 401).length, 4, '4 fallos con 401 y el 5.º ya bloquea')
    assert.deepEqual(r[4].cuerpo, {
      error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta: ahora + BLOQUEO_MS,
    })
    assert.ok(r.slice(5).every((x) => x.estado === 429 && x.cuerpo.error === 'ocupado'), 'el resto, sin comparar: reintento corto')
    assert.equal(r[10].estado, 429, 'el PIN correcto llegó con la IP ya agotada')
    const fila = await db.prepare('SELECT fallos, en_vuelo FROM intentos_pin').first()
    assert.deepEqual({ ...fila }, { fallos: 5, en_vuelo: 0 }, 'solo se compararon 5 PIN')
    const despues = await pedir(db, '/api/simulaciones', { ahora: ahora + 60_000 })
    assert.equal(despues.estado, 429)
    assert.equal(despues.cuerpo.error, 'bloqueado', 'ahora sí, el bloqueo de 15 min')
    assert.equal((await pedir(db, '/api/simulaciones', { ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('6 peticiones a la vez con el PIN correcto desde una IP: 200 o reintento corto, nunca el bloqueo', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    const r = await Promise.all(Array.from({ length: 6 }, () => pedir(db, '/api/simulaciones', { ahora })))
    assert.ok(r.every((x) => x.estado === 200 || x.cuerpo.error === 'ocupado'), JSON.stringify(r.map((x) => x.cuerpo.error ?? x.estado)))
    assert.ok(r.filter((x) => x.estado === 200).length >= 5)
    const ocupado = r.find((x) => x.estado === 429)
    if (ocupado) {
      assert.deepEqual(ocupado.cuerpo, {
        error: 'ocupado', detalle: 'Hay otros intentos de PIN en curso. Vuelve a probar en unos segundos.', reintentar_en: REINTENTAR_EN_S,
      })
    }
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM intentos_pin').first('n'), 0, 'los aciertos no dejan rastro')
    const siguiente = await Promise.all(Array.from({ length: 6 }, () => pedir(db, '/api/simulaciones', { ahora: ahora + 2_000 })))
    assert.ok(siguiente.every((x) => x.estado === 200 || x.cuerpo.error === 'ocupado'))
  })

  test(`una reserva que nunca se libera (invocación caída) caduca a los ${VUELO_MS / 1000} s`, async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    await db.prepare('INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta, en_vuelo, vuelo_hasta) VALUES (?, 0, NULL, 5, ?)')
      .bind('1.2.3.4', ahora + VUELO_MS).run()
    assert.equal((await pedir(db, '/api/simulaciones', { ahora })).cuerpo.error, 'ocupado')
    assert.equal((await pedir(db, '/api/simulaciones', { ahora: ahora + VUELO_MS })).estado, 200)
  })

  test('caducado el bloqueo, la IP vuelve a tener 5 intentos', async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    for (let i = 0; i < 5; i++) await pedir(db, '/api/resumen', { pin: 'x', ahora })
    const despues = await pedir(db, '/api/resumen', { pin: 'x', ahora: ahora + BLOQUEO_MS })
    assert.equal(despues.estado, 401)
    assert.equal(despues.cuerpo.detalle, 'PIN incorrecto. Quedan 4 intentos.')
  })

  test(`tope global: más de ${MAX_FALLOS_GLOBAL} fallos en 15 min entre todas las IPs → 429 para todos durante 15 min`, async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // Una IP distinta por intento (rotación de IPs contra un PIN de 4 cifras), todos a la vez.
    const r = await Promise.all(Array.from({ length: 60 }, (_, i) => pedir(db, '/api/simulaciones', { pin: 'x', ip: `10.0.0.${i}`, ahora })))
    assert.equal(await db.prepare('SELECT fallos FROM pin_global').first('fallos'), MAX_FALLOS_GLOBAL, `solo ${MAX_FALLOS_GLOBAL} se comparan`)
    const comparados = r.filter((x) => x.estado === 401 || x.cuerpo.error === 'bloqueado')
    assert.equal(comparados.length, MAX_FALLOS_GLOBAL)
    assert.ok(comparados.filter((x) => x.estado === 429).every((x) => x.cuerpo.hasta === ahora + BLOQUEO_MS && /en total/.test(x.cuerpo.detalle)))
    const resto = r.filter((x) => x.cuerpo.error === 'ocupado')
    assert.equal(resto.length, 60 - MAX_FALLOS_GLOBAL, 'los que llegaron con 50 en vuelo: reintento corto, sin comparar')
    const dueno = await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora: ahora + 60_000 })
    assert.equal(dueno.estado, 429, 'ni con el PIN correcto desde otra IP')
    assert.match(dueno.cuerpo.detalle, /en total/)
    assert.equal((await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('el tope global solo cuenta fallos: aciertos y peticiones de una IP ya bloqueada no lo consumen', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // 16 rondas de 5 peticiones a la vez (lo que hace la PWA al abrirse): 80 aciertos en la misma ventana.
    for (let ronda = 0; ronda < 16; ronda++) {
      const aciertos = await Promise.all(Array.from({ length: 5 }, () => pedir(db, '/api/simulaciones', { ahora })))
      assert.ok(aciertos.every((x) => x.estado === 200))
    }
    // Una sola IP insistiendo: se bloquea ella, no el resto.
    const ip = await Promise.all(Array.from({ length: 80 }, () => pedir(db, '/api/simulaciones', { pin: 'x', ip: '6.6.6.6', ahora })))
    assert.equal(ip.filter((x) => x.estado === 401).length, 4)
    assert.equal((await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora })).estado, 200)
    const fallosGlobales = await db.prepare('SELECT fallos FROM pin_global').first('fallos')
    assert.equal(fallosGlobales, 5, 'los 5 PIN comparados de esa IP')
    assert.equal(VENTANA_GLOBAL_MS, 15 * 60_000)
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
    await ejecutarMercado({ esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
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

  test('POST /api/analizar en paralelo: solo uno analiza; el resto, 429 sin descargar nada', async () => {
    const db = await conDatos()
    db.latencia = true
    const ahora = ahoraDe(5) + 20 * 60_000
    const fetch = fetchEscenario(crearEscenario(), ahora)
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => pedir(db, '/api/analizar', { metodo: 'POST', ahora, fetch })))
    assert.deepEqual(respuestas.map((r) => r.estado).sort(), [200, 429, 429, 429, 429])
    for (const r of respuestas.filter((x) => x.estado === 429)) assert.equal(r.cuerpo.hasta, ahora + ESPERA_ANALIZAR_MS)
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM ejecuciones WHERE tipo = 'manual'").first('n'), 1)
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('/market/candles')).length, 2 * 4, 'un solo análisis descargó velas')
  })
})

/**
 * Ejecuta `fn` anotando cada sentencia SQL que llega al D1 simulado y cuántas filas devuelve.
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<{ sql: string, valores: any[], filas: number }[]>}
 */
async function espiarSql(fn) {
  const original = Sentencia.prototype.ejecutar
  /** @type {{ sql: string, valores: any[], filas: number }[]} */
  const vistas = []
  Sentencia.prototype.ejecutar = function () {
    const r = original.call(this)
    vistas.push({ sql: this.sql, valores: this.valores, filas: r.results.length })
    return r
  }
  try {
    await fn()
  } finally {
    Sentencia.prototype.ejecutar = original
  }
  return vistas
}

describe('lecturas de D1 acotadas', () => {
  test('ninguna ruta recorre una tabla entera ni ordena con un B-tree temporal (EXPLAIN QUERY PLAN)', async () => {
    const db = await conDatos()
    const ahora = ahoraDe(5) + 20 * 60_000
    const vistas = await espiarSql(async () => {
      for (const ruta of [
        '/api/salud', '/api/resumen', '/api/moneda/BTC', '/api/bot', '/api/bot?simulacion=1', '/api/bot/operaciones',
        '/api/bot/operaciones?simbolo=BTC', '/api/bot/operaciones?cursor=3', '/api/bot/decisiones',
        '/api/bot/decisiones?simbolo=ETH&cursor=9', '/api/simulaciones',
      ]) assert.equal((await pedir(db, ruta, { ahora })).estado, 200, ruta)
      assert.equal((await pedir(db, '/api/analizar', { metodo: 'POST', ahora })).estado, 200)
      assert.equal((await pedir(db, '/api/resumen', { pin: 'x', ahora })).estado, 401)
    })
    // Tablas pequeñas por diseño: una fila por simulación o por moneda seguida.
    const pequenas = new Set(['simulaciones', 'senales_actuales'])
    /** @type {string[]} */
    const problemas = []
    for (const { sql, valores } of vistas) {
      const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...valores).map((f) => String(f.detail))
      // Recorrer una CTE (p. ej. la lista de días de la curva) o una fila constante no lee ninguna tabla.
      const ctes = new Set(['CONSTANT', ...[...sql.matchAll(/(\w+)(?:\(\w+\))?\s+AS\s+\(/g)].map((m) => m[1])])
      for (const paso of plan) {
        const scan = /^SCAN (\w+)/.exec(paso)
        if (/TEMP B-TREE/.test(paso) || (scan && !pequenas.has(scan[1]) && !ctes.has(scan[1]))) {
          problemas.push(`${paso} ← ${sql.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
      }
    }
    assert.deepEqual(problemas, [])
  })

  test('GET /api/bot con meses de historia: filas leídas acotadas y métricas idénticas a las de la curva completa', async () => {
    const db = await conDatos()
    // 100 días más de puntos horarios (un paseo determinista), HODL incluido.
    const ultima = await db.prepare('SELECT MAX(vela_1h) AS t FROM capital').first('t')
    /** @type {{ t: number, valor: number, saldo: number, hodl: number|null }[]} */
    const extra = []
    let valor = 10_000
    for (let i = 1; i <= 100 * 24; i++) {
      valor *= 1 + Math.sin(i * 1.7) * 0.01
      extra.push({ t: ultima + i * HORA, valor, saldo: valor / 2, hodl: valor * 0.9 })
    }
    for (const p of extra) {
      await guardarCapital(db, { simulacionId: 1, vela: p.t, valorCartera: p.valor, saldo: p.saldo, valorHodl: p.hodl })
    }
    const curvaCompleta = (await db.prepare('SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital ORDER BY vela_1h').all())
      .results.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
    /** @type {any} */
    let r
    const vistas = await espiarSql(async () => { r = await pedir(db, '/api/bot') })
    assert.equal(r.estado, 200)
    const filasLeidas = vistas.reduce((s, v) => s + v.filas, 0)
    assert.ok(filasLeidas < 30 * 24 + 100 + 50, `${filasLeidas} filas devueltas por D1 para ${curvaCompleta.length} puntos de capital`)
    assert.deepEqual(r.cuerpo.curva, submuestrearCurva(curvaCompleta), 'misma curva que antes: horaria 30 días y diaria antes')
    // Métricas: las de la curva completa, bit a bit (la PWA no nota la diferencia).
    const sim = await db.prepare('SELECT * FROM simulaciones WHERE id = 1').first()
    const ops = (await db.prepare('SELECT lado, simbolo, comision, deslizamiento, pnl_neto FROM operaciones ORDER BY id').all()).results
    const esperadas = calcularMetricas({
      capitalInicial: sim.capital_inicial, saldo: sim.saldo,
      abiertas: r.cuerpo.abiertas.map((/** @type {any} */ p) => ({ unidades: p.unidades, coste: p.coste, precioActual: p.precioActual })),
      operaciones: ops.map((o) => ({ tipo: o.lado, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnl_neto ?? undefined })),
      curva: curvaCompleta,
    })
    assert.deepEqual(r.cuerpo.metricas, JSON.parse(JSON.stringify(esperadas)))
    assert.ok(r.cuerpo.metricas.drawdownMaximo > 0)
  })

  test('GET /api/bot: precio actual de cada posición = precio de su última decisión con precio', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/bot')
    for (const p of r.cuerpo.abiertas) {
      const precio = await db.prepare(
        'SELECT precio FROM decisiones WHERE simbolo = ? AND precio IS NOT NULL ORDER BY vela_1h DESC LIMIT 1',
      ).bind(p.simbolo).first('precio')
      assert.equal(p.precioActual, precio, p.simbolo)
    }
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

  test('limitarCurva: con más de 2000 puntos deja como mucho CURVA_MAXIMA, con el primero y el último', () => {
    const puntos = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ t: i * HORA, valor: i, saldo: i, hodl: null }))
    assert.equal(CURVA_MAXIMA, 1000)
    const corta = puntos(2000)
    assert.equal(limitarCurva(corta), corta, 'hasta 2000 puntos no se toca')
    for (const n of [2001, 2500, 35_000]) {
      const r = limitarCurva(puntos(n))
      assert.ok(r.length <= CURVA_MAXIMA && r.length >= CURVA_MAXIMA - 1, `${n} → ${r.length}`)
      assert.equal(r[0].t, 0)
      assert.equal(r.at(-1)?.t, (n - 1) * HORA)
      assert.ok(r.every((p, i) => i === 0 || p.t > r[i - 1].t), 'orden creciente y sin repetidos')
    }
  })
})

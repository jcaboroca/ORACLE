// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial, velaDeDecision } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { ejecutarHora } from '../../core/hora.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import {
  cargarEstado, cargarEstados, crearSimulacion, guardarCapital, guardarCapitales, obtenerSimulacion, reiniciarSimulaciones,
  senalesActuales, simulacionActiva, simulacionesActivas, sincronizarSimulaciones,
} from '../src/repositorio.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, entradasBacktest, fetchEscenario, sinEspera } from './escenario.js'
import { v1b, vivoDePrueba } from './vivo.js'

const V1 = vivoDePrueba(['v1'])
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')
/** Módulo de cada versión de prueba. */
const MODULOS = /** @type {Record<string, import('../../core/hora.js').Estrategia>} */ ({ v1, v2, v1b })

/** @param {ReturnType<typeof crearD1>|any} db @param {string} [monedas] */
const entorno = (db, monedas = 'BTC,ETH') => ({ DB: db, MONEDAS: monedas })

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

/** @param {ReturnType<typeof crearD1>} db @param {string} tabla */
const contar = (db, tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).first('n')

describe('repositorio con varias simulaciones', () => {
  test('sincronizarSimulaciones crea las que faltan, en el orden de la lista, y repetida no escribe nada', async () => {
    const db = crearD1()
    const sims = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1'], capitalInicial: 10_000, ahora: 100 })
    assert.deepEqual(sims.map((s) => [s.estrategia_version, s.capital_inicial, s.saldo, s.creada_en, s.activa]), [['v2', 10_000, 10_000, 100, 1], ['v1', 10_000, 10_000, 100, 1]])
    const cambios = db.sqlite.prepare('SELECT total_changes() AS n').get()?.n
    const otra = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1'], capitalInicial: 5, ahora: 200 })
    assert.deepEqual(otra, sims)
    assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get()?.n, cambios, 'ninguna fila escrita')
    await assert.rejects(sincronizarSimulaciones(db, { versiones: [], capitalInicial: 1, ahora: 1 }), RangeError)
  })

  test('sincronizarSimulaciones cierra las de estrategias que salen de la lista (sin borrar nada) y crea las nuevas', async () => {
    const db = crearD1()
    const v1Sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })
    await db.prepare('UPDATE simulaciones SET saldo = 8000 WHERE id = ?').bind(v1Sim.id).run()
    const sims = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1b'], capitalInicial: 10_000, ahora: 500 })
    assert.deepEqual(sims.map((s) => s.estrategia_version), ['v2', 'v1b'])
    assert.deepEqual(await obtenerSimulacion(db, v1Sim.id), { ...v1Sim, saldo: 8000, activa: 0, cerrada_en: 500 })
    assert.equal(await simulacionActiva(db, 'v1'), null)
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.estrategia_version), ['v2', 'v1b'])
  })

  test('crearSimulacion solo cierra la activa de su misma estrategia; reiniciarSimulaciones las cierra todas y abre una por versión', async () => {
    const db = crearD1()
    const a = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })
    const b = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v2', ahora: 2 })
    const c = await crearSimulacion(db, { capitalInicial: 3_000, version: 'v1', ahora: 3 })
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.id), [b.id, c.id])
    assert.equal((await obtenerSimulacion(db, a.id))?.cerrada_en, 3)
    const nuevas = await reiniciarSimulaciones(db, { capitalInicial: 5_000, versiones: ['v1b', 'v1', 'v2'], ahora: 9 })
    assert.deepEqual(nuevas.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v1b', 5_000, 9], ['v1', 5_000, 9], ['v2', 5_000, 9]])
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.id), nuevas.map((s) => s.id))
    assert.deepEqual((await filas(db, 'SELECT cerrada_en FROM simulaciones WHERE activa = 0 ORDER BY id')).map((f) => f.cerrada_en), [3, 9, 9])
  })

  test('cargarEstados = obtenerSimulacion + cargarEstado de cada una, en una sola llamada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    for (let k = 0; k < 3; k++) {
      await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
    }
    const ids = (await simulacionesActivas(db)).map((s) => s.id).reverse()
    const antes = db.llamadas
    const juntos = await cargarEstados(db, ids, (v) => MODULOS[v].PARAMETROS_BOT)
    assert.equal(db.llamadas - antes, 1)
    for (const [i, id] of ids.entries()) {
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, id))
      assert.deepEqual(juntos[i], { sim, ...(await cargarEstado(db, sim, MODULOS[sim.estrategia_version].PARAMETROS_BOT)) })
    }
    assert.deepEqual(await cargarEstados(db, [], () => v1.PARAMETROS_BOT), [])
    await assert.rejects(cargarEstados(db, [99], () => v1.PARAMETROS_BOT), /No existe la simulación 99/)
  })

  test('guardarCapitales: los puntos de varias simulaciones en un lote, iguales que con guardarCapital', async () => {
    const a = crearD1()
    const b = crearD1()
    for (const db of [a, b]) for (const v of ['v1', 'v2']) await crearSimulacion(db, { capitalInicial: 10_000, version: v, ahora: 0 })
    const puntos = [
      { simulacionId: 1, vela: 0, valorCartera: 10_000, saldo: 10_000, valorHodl: null },
      { simulacionId: 2, vela: 0, valorCartera: 9_000, saldo: 9_000, valorHodl: 9_500 },
    ]
    const antes = a.llamadas
    await guardarCapitales(a, puntos)
    assert.equal(a.llamadas - antes, 1)
    for (const p of puntos) await guardarCapital(b, p)
    const leer = (/** @type {ReturnType<typeof crearD1>} */ db) => filas(db, 'SELECT * FROM capital ORDER BY simulacion_id')
    assert.deepEqual(await leer(a), await leer(b))
    const llamadas = a.llamadas
    await guardarCapitales(a, [])
    assert.equal(a.llamadas, llamadas, 'sin puntos no llama a D1')
  })
})

describe('ejecutarMercado con varias estrategias en vivo', () => {
  test('3 estrategias: una simulación por cada una, cada una idéntica a core/hora.js con su estrategia; la principal da las señales', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    /** @type {Record<string, { estado: import('../../core/bot.js').Estado, hodl: Record<string, number>|null }>} */
    const memoria = Object.fromEntries(['v1', 'v2', 'v1b'].map((v) => [v, { estado: estadoInicial(10_000), hodl: null }]))
    for (let k = 0; k < 4; k++) {
      const ahora = ahoraDe(k)
      const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      assert.equal(r.ejecucion.ok, true)
      assert.deepEqual(r.repetidas, [])
      const sims = await simulacionesActivas(db)
      assert.deepEqual(sims.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v1', 10_000, ahoraDe(0)], ['v2', 10_000, ahoraDe(0)], ['v1b', 10_000, ahoraDe(0)]])
      assert.deepEqual(r.simulaciones.map((s) => [s.id, s.version]), sims.map((s) => [s.id, s.estrategia_version]))
      for (const sim of sims) {
        const est = MODULOS[sim.estrategia_version]
        const m = memoria[sim.estrategia_version]
        const hora = ejecutarHora({ ...m, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: est })
        memoria[sim.estrategia_version] = { estado: hora.estado, hodl: hora.hodl }
        const desdeD1 = await cargarEstado(db, sim, est.PARAMETROS_BOT)
        assert.deepEqual(desdeD1, { estado: hora.estado, hodl: hora.hodl }, `${sim.estrategia_version} en la hora ${k}`)
        const capital = await db.prepare('SELECT valor_cartera, valor_hodl FROM capital WHERE simulacion_id = ? AND vela_1h = ?').bind(sim.id, velaDeDecision(ahora)).first()
        assert.deepEqual(capital, { valor_cartera: hora.punto.valor, valor_hodl: hora.punto.hodl }, `capital de ${sim.estrategia_version} en la hora ${k}`)
        const versiones = await filas(db, 'SELECT DISTINCT json_extract(desglose_json, \'$.version\') AS v, estrategia_version FROM decisiones WHERE simulacion_id = ?', sim.id)
        assert.deepEqual(versiones, [{ v: sim.estrategia_version, estrategia_version: sim.estrategia_version }])
      }
      assert.ok(r.senales.every((s) => s.version === 'v2'), 'las señales devueltas son las de la principal')
      const guardadas = await senalesActuales(db)
      assert.deepEqual(Object.values(guardadas).map((s) => s.version), ['v2', 'v2'])
      const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones ORDER BY id DESC').first('detalle_json'))
      assert.equal(detalle.estrategiaPrincipal, 'v2')
      assert.equal(detalle.simulacionId, sims[1].id)
      assert.deepEqual(detalle.simulaciones.map((/** @type {any} */ s) => s.version), ['v1', 'v2', 'v1b'])
      assert.equal(detalle.operaciones, detalle.simulaciones.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.operaciones, 0))
    }
    // Estrategias distintas, resultados distintos: v1b compra la mitad que v1 y v2 solo decide al cierre diario.
    const unidades = await filas(db, "SELECT simulacion_id, unidades FROM operaciones WHERE simbolo = 'BTC' AND lado = 'compra' ORDER BY id LIMIT 3")
    assert.equal(unidades.length, 3)
    const porSim = Object.fromEntries(unidades.map((u) => [u.simulacion_id, u.unidades]))
    assert.ok(Math.abs(porSim[3] / porSim[1] - 0.5) < 0.01, 'v1b invierte el 10 % y v1 el 20 %')
  })

  test('al cambiar la lista, la v1 activa se cierra con su historia intacta y las nuevas empiezan con 10.000 €', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    for (let k = 0; k < 2; k++) {
      await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
    }
    const vieja = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await simulacionActiva(db, 'v1'))
    const historia = await Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map((t) => filas(db, `SELECT * FROM ${t} WHERE simulacion_id = ?`, vieja.id)))
    const nuevo = vivoDePrueba(['v2', 'v1b'])
    const r = await ejecutarMercado({ vivo: nuevo, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(2)), ahora: ahoraDe(2) })
    assert.equal(r.ejecucion.ok, true)
    assert.deepEqual(await obtenerSimulacion(db, vieja.id), { ...vieja, activa: 0, cerrada_en: ahoraDe(2) })
    assert.deepEqual(await Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map((t) => filas(db, `SELECT * FROM ${t} WHERE simulacion_id = ?`, vieja.id))), historia,
      'la cerrada no opera más y conserva todo')
    const activas = await simulacionesActivas(db)
    assert.deepEqual(activas.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v2', 10_000, ahoraDe(2)], ['v1b', 10_000, ahoraDe(2)]])
    for (const s of activas) {
      assert.deepEqual((await filas(db, 'SELECT vela_1h FROM decisiones WHERE simulacion_id = ? GROUP BY vela_1h', s.id)).map((d) => d.vela_1h), [velaDeDecision(ahoraDe(2))])
    }
    assert.equal(await contar(db, 'simulaciones'), 3)
  })

  test('repetir la misma hora con 3 simulaciones no duplica nada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    const foto = async () => [...await Promise.all(['simulaciones', 'decisiones', 'operaciones', 'posiciones', 'capital', 'progreso'].map((t) => contar(db, t))),
      ...(await filas(db, 'SELECT saldo FROM simulaciones ORDER BY id')).map((f) => f.saldo)]
    const antes = await foto()
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora + 60_000), ahora: ahora + 60_000 })
    assert.deepEqual(r.repetidas, ['BTC', 'ETH'])
    assert.deepEqual(r.simulaciones.map((s) => s.repetidas), [['BTC', 'ETH'], ['BTC', 'ETH'], ['BTC', 'ETH']])
    assert.equal(r.operaciones, 0)
    assert.deepEqual(await foto(), antes)
  })

  test('si falla el lote de una moneda de una simulación, las otras simulaciones siguen y el fallo dice cuál', async () => {
    const base = crearD1()
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO decisiones') && s.valores[0] === 2 && s.valores[1] === 'ETH')) {
          throw new Error('D1_ERROR: simulado')
        }
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    assert.deepEqual(r.ejecucion.fallos.filter((f) => f.startsWith('bot')), ['bot v2 ETH: D1_ERROR: simulado'])
    const decisiones = await filas(base, 'SELECT simulacion_id, simbolo FROM decisiones ORDER BY simulacion_id, simbolo')
    assert.deepEqual(decisiones.map((d) => `${d.simulacion_id}:${d.simbolo}`), ['1:BTC', '1:ETH', '2:BTC', '3:BTC', '3:ETH'])
    assert.equal(await contar(base, 'capital'), 3)
  })

  test('presupuesto con 3 estrategias y 5 monedas: 28 llamadas a D1 la primera hora y 25 después; las subpeticiones no cambian', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    const fetch = fetchEscenario(escenario, ahoraDe(0))
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env, fetch, ahora: ahoraDe(0) })
    assert.equal(fetch.llamadas.length, 38, 'las mismas que con una estrategia: los datos se descargan una vez')
    assert.equal(db.llamadas, 28, '10 + 3 simulaciones × 5 monedas + 3 HODL')
    const antes = db.llamadas
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env, fetch: fetchEscenario(escenario, ahoraDe(1)), ahora: ahoraDe(1) })
    assert.equal(r.ejecucion.ok, true)
    assert.equal(db.llamadas - antes, 25)
  })

  test('el LLM explica solo las señales de la principal: las mismas llamadas con 1 que con 3 estrategias', async () => {
    /** @param {import('../src/vivo.js').Vivo} vivo */
    const llamadasLlm = async (vivo) => {
      const db = crearD1()
      let n = 0
      const AI = { run: async () => { n++; throw new Error('sin cuota') } }
      const ahora = ahoraDe(0)
      const r = await ejecutarMercado({ vivo, esperar: sinEspera, env: { ...entorno(db), AI, LLM_MODELO_CF: '@cf/x' }, fetch: fetchEscenario(crearEscenario(), ahora), ahora })
      assert.ok(Object.values(await senalesActuales(db)).every((s) => s.motorExplicacion === 'plantilla'))
      assert.equal(r.senales.length, 2)
      return n
    }
    const una = await llamadasLlm(V1)
    assert.ok(una > 0)
    assert.equal(await llamadasLlm(TRES), una)
  })

  test('manual con 3 estrategias: señales de la principal, sin crear ni tocar simulaciones', async () => {
    const db = crearD1()
    const sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.equal(r.ejecucion.ok, true)
    assert.ok(r.senales.every((s) => s.version === 'v2'))
    assert.deepEqual(await simulacionesActivas(db), [sim])
    for (const t of ['decisiones', 'operaciones', 'capital']) assert.equal(await contar(db, t), 0, t)
  })
})

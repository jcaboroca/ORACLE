// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA } from '../../core/velas.js'
import { idTitular, ejecutarNoticias, prepararTitulares } from '../src/ejecuciones/noticias.js'
import { urlSubreddit } from '../src/fuentes/reddit.js'
import { titularesParaEstrategia } from '../src/repositorio.js'
import { simularFetch, fixtureTexto } from './ayudantes.js'
import { crearD1 } from './d1.js'

const AHORA = Date.parse('2026-10-18T21:01:00Z')
const DIA = 24 * HORA

/** CoinTelegraph y r/CryptoCurrency responden con sus fixtures; el resto de feeds falla. */
const fetchFixtures = () => simularFetch((url) => {
  if (url === 'https://cointelegraph.com/rss') return { cuerpo: fixtureTexto('rss-cointelegraph.xml') }
  if (url === urlSubreddit('CryptoCurrency')) return { cuerpo: fixtureTexto('reddit-cryptocurrency.xml') }
  return { estado: 503, cuerpo: '' }
})

/** @param {ReturnType<typeof crearD1>} db */
const titulares = async (db) => (await db.prepare('SELECT * FROM titulares ORDER BY publicado_en DESC').all()).results

describe('prepararTitulares', () => {
  test('id = hash del título normalizado: mayúsculas, acentos y signos no cuentan', async () => {
    assert.equal(await idTitular('Bitcoin sube: ¡récord!'), await idTitular('bitcoin SUBE recórd'))
    assert.notEqual(await idTitular('Bitcoin sube'), await idTitular('Bitcoin baja'))
    assert.match(await idTitular('x'), /^[0-9a-f]{32}$/)
  })

  test('descarta > 48 h, > 1 h en el futuro y títulos vacíos; deduplica (gana el primero)', async () => {
    /** @param {string} titulo @param {number} publicadoEn @param {string} [fuente] */
    const t = (titulo, publicadoEn, fuente = 'A') => ({ fuente, origen: /** @type {const} */ ('rss'), titulo, url: null, publicadoEn })
    const r = await prepararTitulares([
      t('Viejo', AHORA - 49 * HORA),
      t('Límite', AHORA - 48 * HORA),
      t('Futuro', AHORA + 2 * HORA),
      t('¡!', AHORA),
      t('Bitcoin rally', AHORA - HORA, 'A'),
      t('BITCOIN RALLY!', AHORA, 'B'),
    ], AHORA)
    assert.deepEqual(r.map((x) => `${x.titulo}/${x.fuente}`), ['Límite/A', 'Bitcoin rally/A'])
  })
})

describe('ejecutarNoticias', () => {
  test('guarda los titulares nuevos de RSS y Reddit, los puntúa con el léxico y anota los feeds caídos', async () => {
    const db = crearD1()
    const fetch = fetchFixtures()
    const r = await ejecutarNoticias({ env: { DB: db }, fetch, ahora: AHORA })
    assert.equal(fetch.llamadas.length, 17, '14 RSS + 3 Reddit, sin LLM configurado')
    assert.equal(r.ok, true)
    assert.equal(r.nuevos, 6)
    assert.equal(r.puntuados, 6)
    assert.deepEqual(r.motores, { lexico: 6 })
    assert.equal(r.fallos.length, 15)
    const filas = await titulares(db)
    assert.deepEqual(filas.map((f) => [f.origen, f.titulo, f.monedas_json, f.puntuacion, f.motor]), [
      ['reddit', 'Solana Ecosystem News - October 18-2026', '["SOL"]', 0, 'lexico'],
      ['reddit', "Bitcoin's Quantum Transition Won't Stop at Bitcoin", '["BTC"]', 0, 'lexico'],
      ['reddit', 'Saved by KYC', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Here’s what happened in crypto today', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Most Americans polled oppose betting on elections: Reuters', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Cysic crypto bridge halted after unauthorized mint of 10M CYS', '["MERCADO"]', -1, 'lexico'],
    ])
    const ejecucion = await db.prepare('SELECT * FROM ejecuciones').first()
    assert.equal(ejecucion?.tipo, 'noticias')
    assert.equal(ejecucion?.ok, 1)
    assert.equal(JSON.parse(ejecucion?.detalle_json).fallos.length, 15)
    assert.ok(db.llamadas <= 50)
  })

  test('segunda ejecución con los mismos feeds: nada nuevo y nada que puntuar', async () => {
    const db = crearD1()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    const r = await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA + HORA })
    assert.equal(r.nuevos, 0)
    assert.equal(r.puntuados, 0)
    assert.equal((await titulares(db)).length, 6)
  })

  test('con Workers AI el lote va en una sola llamada y se guarda el motor de cada titular', async () => {
    const db = crearD1()
    /** @type {any[]} */
    const entradas = []
    const AI = {
      /** @param {string} _modelo @param {any} entrada */
      async run(_modelo, entrada) {
        entradas.push(entrada)
        const lote = JSON.parse(entrada.messages[1].content).titulares
        const saved = lote.find((/** @type {any} */ t) => t.titulo === 'Saved by KYC')
        return { response: JSON.stringify({ titulares: [{ n: saved.n, puntuacion: 0.2, monedas: ['MERCADO'] }] }) }
      },
    }
    const r = await ejecutarNoticias({ env: { DB: db, AI, LLM_MODELO_CF: 'm' }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(entradas.length, 1)
    assert.deepEqual(r.motores, { cf: 1, lexico: 5 })
    const saved = (await titulares(db)).find((f) => f.titulo === 'Saved by KYC')
    assert.deepEqual([saved?.puntuacion, saved?.monedas_json, saved?.motor], [0.2, '["MERCADO"]', 'cf'])
  })

  test('los titulares guardados llegan a la estrategia con su forma de core', async () => {
    const db = crearD1()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    const t = await titularesParaEstrategia(db, AHORA - DIA, AHORA)
    assert.equal(t.length, 6)
    const sol = t.find((x) => x.monedas.includes('SOL'))
    assert.deepEqual(Object.keys(sol ?? {}).sort(), ['id', 'monedas', 'origen', 'publicadoEn', 'puntuacion'])
    assert.equal(sol?.origen, 'reddit')
    assert.equal(sol?.publicadoEn, Date.parse('2026-10-18T17:31:51Z'))
  })

  test('purga titulares > 7 días, ejecuciones > 30 días y bloqueos de PIN caducados', async () => {
    const db = crearD1()
    await db.prepare("INSERT INTO titulares (id, fuente, origen, titulo, publicado_en) VALUES ('viejo', 'X', 'rss', 'Viejo', ?)")
      .bind(AHORA - 8 * DIA).run()
    await db.prepare("INSERT INTO ejecuciones (tipo, inicio) VALUES ('mercado', ?)").bind(AHORA - 31 * DIA).run()
    await db.prepare("INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta) VALUES ('1.1.1.1', 0, ?), ('2.2.2.2', 0, ?)").bind(AHORA - 1, AHORA + HORA).run()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM titulares WHERE id = 'viejo'").first('n'), 0)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM ejecuciones').first('n'), 1)
    assert.deepEqual((await db.prepare('SELECT ip FROM intentos_pin').all()).results, [{ ip: '2.2.2.2' }])
  })

  test('un fallo de D1 a mitad deja la ejecución registrada con ok = 0 y el error', async () => {
    const db = crearD1()
    await db.prepare('DROP TABLE titulares').run()
    const r = await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(r.ok, false)
    assert.match(String(r.error), /no such table: titulares/)
    const ejecucion = await db.prepare('SELECT ok, fin, detalle_json FROM ejecuciones').first()
    assert.equal(ejecucion?.ok, 0)
    assert.ok(ejecucion?.fin)
    assert.match(JSON.parse(ejecucion?.detalle_json).error, /titulares/)
  })
})

// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { CRON_MERCADO, CRON_NOTICIAS, programado } from '../src/crones.js'
import worker from '../src/index.js'
import { simularFetch } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario } from './escenario.js'

const WRANGLER = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')

describe('index', () => {
  test('wrangler.toml declara exactamente los dos crons que atiende el Worker', () => {
    const crons = /crons = \[(.*)\]/.exec(WRANGLER)?.[1]
    assert.equal(crons, `"${CRON_NOTICIAS}", "${CRON_MERCADO}"`)
  })

  test('wrangler.toml: D1 como DB con migraciones, AI y las vars de la spec; sin KV ni secrets', () => {
    assert.match(WRANGLER, /^name = "oracle"$/m)
    assert.match(WRANGLER, /binding = "DB"\ndatabase_name = "oracle"/)
    assert.match(WRANGLER, /migrations_dir = "migrations"/)
    assert.match(WRANGLER, /\[ai\]\nbinding = "AI"/)
    for (const v of ['MONEDAS', 'LLM_MODELO_CF', 'LLM_MODELO_GROQ', 'LLM_MODELO_GEMINI', 'ORIGENES']) assert.match(WRANGLER, new RegExp(`^${v} = "`, 'm'))
    assert.doesNotMatch(WRANGLER, /kv_namespaces/)
    assert.doesNotMatch(WRANGLER, /^(ORACLE_PIN|GROQ_API_KEY|GEMINI_API_KEY) =/m)
  })

  test('programado: el minuto 1 son noticias y el 3 mercado; otro cron es un error', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const noticias = /** @type {any} */ (await programado(CRON_NOTICIAS, { env: { DB: db }, fetch: simularFetch(() => ({ estado: 503, cuerpo: '' })), ahora }))
    assert.equal(noticias.ok, true)
    const mercado = /** @type {any} */ (await programado(CRON_MERCADO, { env: { DB: db, MONEDAS: 'BTC,ETH' }, fetch: fetchEscenario(crearEscenario(), ahora), ahora }))
    assert.equal(mercado.ejecucion.ok, true)
    const tipos = (await db.prepare('SELECT tipo FROM ejecuciones ORDER BY id').all()).results.map((f) => f.tipo)
    assert.deepEqual(tipos, ['noticias', 'mercado'])
    await assert.rejects(programado('*/5 * * * *', { env: { DB: db }, fetch: simularFetch(() => ({})), ahora }), /Cron desconocido/)
  })

  test('scheduled usa la hora programada como `ahora`, el fetch global y deja el trabajo en waitUntil', async () => {
    const db = crearD1()
    const original = globalThis.fetch
    const falso = simularFetch(() => ({ estado: 503, cuerpo: '' }))
    globalThis.fetch = falso // sin red en los tests
    try {
      /** @type {Promise<unknown>[]} */
      const pendientes = []
      worker.scheduled({ cron: CRON_NOTICIAS, scheduledTime: 1_792_357_260_000 }, { DB: db }, { waitUntil: (p) => pendientes.push(p) })
      assert.equal(pendientes.length, 1)
      await Promise.all(pendientes)
    } finally {
      globalThis.fetch = original
    }
    assert.equal(falso.llamadas.length, 17)
    assert.equal(await db.prepare('SELECT inicio FROM ejecuciones').first('inicio'), 1_792_357_260_000)
  })

  test('el módulo principal solo exporta el manejador por defecto (el runtime rechaza el resto)', async () => {
    assert.deepEqual(Object.keys(await import('../src/index.js')), ['default'])
  })

  test('fetch delega en la API', async () => {
    const res = await worker.fetch(new Request('https://oracle.workers.dev/api/salud'), { DB: crearD1() })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { ok: false, ultimaEjecucion: null })
  })
})

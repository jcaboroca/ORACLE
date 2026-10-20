// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resumirCurva } from '../../core/metricas.js'
import { atender, submuestrearCurva } from '../src/api.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from './escenario.js'
import { vivoDePrueba } from './vivo.js'

const PIN = '4815162342'
/** v1, v2 y v1b en vivo; la principal, v2. */
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')

/** @param {ReturnType<typeof crearD1>} db */
const entorno = (db) => ({ DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: 'https://jcaboroca.github.io' })

/**
 * @param {ReturnType<typeof crearD1>} db @param {string} ruta
 * @param {{ metodo?: string, cuerpo?: unknown, ahora?: number, vivo?: import('../src/vivo.js').Vivo }} [op]
 */
async function pedir(db, ruta, { metodo = 'GET', cuerpo, ahora = ahoraDe(6), vivo = TRES } = {}) {
  const peticion = new Request(`https://oracle.workers.dev${ruta}`, {
    method: metodo, headers: { Authorization: `Bearer ${PIN}`, 'CF-Connecting-IP': '1.2.3.4' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const res = await atender(peticion, { env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, esperar: sinEspera, vivo })
  return { estado: res.status, cuerpo: await res.json() }
}

/** 6 horas del escenario con las 3 estrategias en vivo. */
async function conTres() {
  const db = crearD1()
  const escenario = crearEscenario()
  for (let k = 0; k < 6; k++) {
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
  }
  return db
}

/** Curva completa de una simulación desde D1. @param {ReturnType<typeof crearD1>} db @param {number} id */
async function curvaDe(db, id) {
  const { results } = await db.prepare('SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital WHERE simulacion_id = ? ORDER BY vela_1h').bind(id).all()
  return results.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
}

describe('API con varias estrategias en vivo', () => {
  test('GET /api/bot/comparativa: contrato exacto, en el orden de la lista, curvas en € y ms y HODL de la principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/bot/comparativa')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['ahora', 'simulaciones', 'hodl', 'resumenHodl'])
    assert.equal(r.cuerpo.ahora, ahoraDe(6))
    const sims = r.cuerpo.simulaciones
    assert.deepEqual(sims.map((/** @type {any} */ s) => [s.id, s.estrategiaVersion, s.etiqueta, s.principal]), [
      [1, 'v1', 'v1', false], [2, 'v2', 'v2', true], [3, 'v1b', 'v1 al 10 %', false],
    ])
    for (const s of sims) {
      assert.deepEqual(Object.keys(s), [
        'id', 'estrategiaVersion', 'etiqueta', 'principal', 'capitalInicial', 'valorCartera', 'rentabilidad', 'drawdownMaximo', 'operaciones', 'curva',
      ])
      const completa = await curvaDe(db, s.id)
      assert.equal(s.capitalInicial, 10_000)
      assert.equal(s.valorCartera, completa.at(-1)?.valor)
      assert.equal(s.rentabilidad, s.valorCartera / 10_000 - 1)
      assert.equal(s.drawdownMaximo, resumirCurva(completa).drawdownMaximo)
      assert.equal(s.operaciones, await db.prepare('SELECT COUNT(*) AS n FROM operaciones WHERE simulacion_id = ?').bind(s.id).first('n'))
      assert.deepEqual(s.curva, submuestrearCurva(completa).map((p) => ({ t: p.t, valor: p.valor })))
    }
    assert.ok(sims[0].operaciones > 0 && sims[2].operaciones > 0)
    assert.notEqual(sims[0].valorCartera, sims[2].valorCartera, 'estrategias distintas, carteras distintas')
    const principal = await curvaDe(db, 2)
    assert.deepEqual(r.cuerpo.hodl, principal.filter((p) => p.hodl !== null).map((p) => ({ t: p.t, valor: p.hodl })))
    assert.ok(r.cuerpo.hodl.length > 1)
    const resumen = resumirCurva(principal)
    assert.deepEqual(r.cuerpo.resumenHodl, {
      valor: resumen.ultimoHodl, rentabilidad: /** @type {number} */ (resumen.ultimoHodl) / 10_000 - 1, drawdownMaximo: resumen.drawdownMaximoHodl,
    })
  })

  test('GET /api/bot/comparativa sin simulaciones activas (antes del primer cron): listas vacías', async () => {
    const r = await pedir(crearD1(), '/api/bot/comparativa')
    assert.equal(r.estado, 200)
    assert.deepEqual(r.cuerpo, { ahora: ahoraDe(6), simulaciones: [], hodl: [], resumenHodl: null })
  })

  test('GET /api/simulaciones marca activas, estrategia, etiqueta y principal; GET /api/bot sin parámetro = la principal', async () => {
    const db = await conTres()
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.estrategiaVersion, s.etiqueta, s.principal]), [
      [3, true, 'v1b', 'v1 al 10 %', false], [2, true, 'v2', 'v2', true], [1, true, 'v1', 'v1', false],
    ])
    assert.equal((await pedir(db, '/api/bot')).cuerpo.simulacion.id, 2)
    const otra = await pedir(db, '/api/bot?simulacion=3')
    assert.deepEqual([otra.cuerpo.simulacion.estrategiaVersion, otra.cuerpo.simulacion.principal], ['v1b', false])
    const ops = await pedir(db, '/api/bot/operaciones?simulacion=1')
    assert.ok(ops.cuerpo.items.length > 0 && ops.cuerpo.items.every((/** @type {any} */ o) => o.estrategiaVersion === 'v1'))
    const decs = await pedir(db, '/api/bot/decisiones')
    assert.ok(decs.cuerpo.items.every((/** @type {any} */ d) => d.estrategiaVersion === 'v2'), 'sin parámetro, las de la principal')
  })

  test('GET /api/resumen y /api/moneda: consejo, bot y decisiones de la estrategia principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 60_000 })
    assert.deepEqual(r.cuerpo.estrategiaPrincipal, { version: 'v2', etiqueta: 'v2', enVivo: 3 })
    assert.ok(r.cuerpo.senales.every((/** @type {any} */ s) => s.estrategiaVersion === 'v2'))
    assert.deepEqual([r.cuerpo.bot.simulacionId, r.cuerpo.bot.estrategiaVersion], [2, 'v2'])
    const m = await pedir(db, '/api/moneda/BTC')
    assert.equal(m.cuerpo.senal.version, 'v2')
    assert.equal(m.cuerpo.decisiones.length, 6)
    assert.ok(m.cuerpo.decisiones.every((/** @type {any} */ d) => d.estrategiaVersion === 'v2'))
  })

  test('POST /api/bot/reiniciar con 3 estrategias: cierra las 3 y abre 3 con el mismo capital; simulacion = la nueva principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000, confirmar: true }, ahora: 777 })
    assert.equal(r.estado, 201)
    assert.deepEqual(r.cuerpo.simulaciones.map((/** @type {any} */ s) => [s.id, s.estrategiaVersion, s.capitalInicial, s.creadaEn, s.principal]), [
      [4, 'v1', 5000, 777, false], [5, 'v2', 5000, 777, true], [6, 'v1b', 5000, 777, false],
    ])
    assert.deepEqual(r.cuerpo.simulacion, r.cuerpo.simulaciones[1])
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.cerradaEn]), [
      [6, true, null], [5, true, null], [4, true, null], [3, false, 777], [2, false, 777], [1, false, 777],
    ])
    const comparativa = await pedir(db, '/api/bot/comparativa')
    assert.deepEqual(comparativa.cuerpo.simulaciones.map((/** @type {any} */ s) => [s.id, s.valorCartera, s.operaciones, s.curva]), [
      [4, 5000, 0, []], [5, 5000, 0, []], [6, 5000, 0, []],
    ])
  })
})

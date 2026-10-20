// @ts-check
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { VIVO, crearVivo, etiquetaDe } from '../src/vivo.js'
import { crearD1 } from './d1.js'
import { vivoDePrueba } from './vivo.js'

const MIGRACIONES = new URL('../migrations/', import.meta.url)
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')

describe('migración 0006: una simulación activa por estrategia', () => {
  /** @param {ReturnType<typeof crearD1>} db @param {string} version */
  const insertar = (db, version) => db.prepare(
    'INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (0, ?, 10000, 10000)',
  ).bind(version).run()

  test('dos activas de la misma estrategia fallan; de estrategias distintas conviven; las cerradas no cuentan', async () => {
    const db = crearD1()
    await insertar(db, 'v1')
    await insertar(db, 'v2')
    await insertar(db, 'v1b')
    await assert.rejects(insertar(db, 'v1'), /UNIQUE/)
    await db.prepare("UPDATE simulaciones SET activa = 0 WHERE estrategia_version = 'v1'").run()
    await insertar(db, 'v1')
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM simulaciones WHERE activa = 1').first('n'), 3)
  })

  test('sobre la base de producción (0001-0005 con la v1 activa y su historia): la conserva intacta y admite las nuevas', () => {
    const sqlite = new DatabaseSync(':memory:')
    const archivos = readdirSync(MIGRACIONES).filter((a) => a.endsWith('.sql')).sort()
    assert.equal(archivos.at(-1), '0006_multisim.sql', 'la última migración')
    for (const a of archivos.slice(0, -1)) sqlite.exec(readFileSync(new URL(a, MIGRACIONES), 'utf8'))
    sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (5, 'v1', 10000, 7000)")
    sqlite.exec(`INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
      VALUES (1, 'BTC', 0, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`)
    sqlite.exec(readFileSync(new URL('0006_multisim.sql', MIGRACIONES), 'utf8'))
    const indices = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'simulaciones'").all().map((f) => f.name)
    assert.deepEqual(indices, ['una_activa_por_estrategia'])
    assert.deepEqual({ ...sqlite.prepare('SELECT id, activa, saldo, cerrada_en FROM simulaciones').get() }, { id: 1, activa: 1, saldo: 7000, cerrada_en: null })
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM decisiones').get()?.n, 1)
    sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (9, 'v3', 10000, 10000)")
    assert.throws(() => sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (9, 'v1', 1, 1)"), /UNIQUE/)
  })
})

describe('estrategias en vivo (worker/src/vivo.js)', () => {
  test('VIVO sale de core/estrategias.js: la principal está en la lista y todas existen', () => {
    assert.ok(VIVO.versiones.length >= 1)
    assert.ok(VIVO.versiones.includes(VIVO.principal))
    for (const v of VIVO.versiones) assert.equal(VIVO.estrategia(v).VERSION, v)
  })

  test('crearVivo rechaza listas vacías, repetidas, versiones desconocidas y una principal fuera de la lista', () => {
    const estrategia = (/** @type {string} */ v) => {
      if (v !== 'v1' && v !== 'v2') throw new RangeError(`Estrategia desconocida: ${v}`)
      return v === 'v1' ? v1 : v2
    }
    assert.throws(() => crearVivo({ versiones: [], principal: 'v1', estrategia }), /No hay estrategias en vivo/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v1'], principal: 'v1', estrategia }), /repetidas/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v9'], principal: 'v1', estrategia }), /desconocida: v9/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v2'], principal: 'v3', estrategia }), /principal v3 no está en vivo/)
    const vivo = crearVivo({ versiones: ['v2', 'v1'], principal: 'v1', estrategia })
    assert.deepEqual(vivo.versiones, ['v2', 'v1'])
    assert.ok(Object.isFrozen(vivo) && Object.isFrozen(vivo.versiones))
  })

  test('etiquetaDe: ETIQUETA del módulo si la tiene; si no, o si la versión ya no existe, la versión', () => {
    assert.equal(etiquetaDe(TRES, 'v1b'), 'v1 al 10 %')
    assert.equal(etiquetaDe(TRES, 'v1'), 'v1')
    assert.equal(etiquetaDe(TRES, 'v0'), 'v0')
  })
})

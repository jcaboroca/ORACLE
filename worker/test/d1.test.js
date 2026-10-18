// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import { resumirCurva } from '../../core/metricas.js'
import { crearD1 } from './d1.js'

/** @param {ReturnType<typeof crearD1>} db @param {number} [saldo] */
async function simulacion(db, saldo = 10_000) {
  const r = await db.prepare(
    "INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (0, 'v1', ?, ?)",
  ).bind(saldo, saldo).run()
  return r.meta.last_row_id
}

/** @param {number} simulacionId @param {string} simbolo @param {'abierta'|'cerrada'} [estado] */
const posicion = (simulacionId, simbolo, estado = 'abierta') => [
  `INSERT INTO posiciones (simulacion_id, simbolo, estado, vela_entrada, precio_entrada, unidades, coste, stop_loss, take_profit)
   VALUES (?, ?, ?, 0, 100, 1, 100, 90, 120)`,
  [simulacionId, simbolo, estado],
]

/** @param {number} simulacionId @param {string} simbolo @param {number} vela */
const decision = (simulacionId, simbolo, vela) => [
  `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
   VALUES (?, ?, ?, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`,
  [simulacionId, simbolo, vela],
]

describe('D1 simulado', () => {
  test('aplica las migraciones: existen todas las tablas de la spec §10', async () => {
    const db = crearD1()
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    assert.deepEqual(results.map((r) => r.name), [
      'capital', 'decisiones', 'ejecuciones', 'intentos_pin', 'operaciones', 'pin_global', 'posiciones', 'progreso',
      'senales_actuales', 'simulaciones', 'titulares',
    ])
  })

  test('first devuelve la fila, una columna o null; all devuelve results; run devuelve meta', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    assert.equal(id, 1)
    const fila = await db.prepare('SELECT id, saldo FROM simulaciones WHERE id = ?').bind(id).first()
    assert.deepEqual(fila, { id: 1, saldo: 10_000 })
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), 10_000)
    assert.equal(await db.prepare('SELECT * FROM simulaciones WHERE id = 99').first(), null)
    const r = await db.prepare('UPDATE simulaciones SET saldo = saldo - 1').run()
    assert.equal(r.meta.changes, 1)
  })

  test('RETURNING devuelve filas también en batch', async () => {
    const db = crearD1()
    const [r] = await db.batch([
      db.prepare("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (5, 'v1', 1, 1) RETURNING id, creada_en"),
    ])
    assert.deepEqual(r.results, [{ id: 1, creada_en: 5 }])
  })

  test('batch es atómico: un error revierte todas las sentencias anteriores', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const [sqlD, valoresD] = decision(id, 'BTC', 0)
    await db.prepare(sqlD).bind(...valoresD).run()
    const [sqlP, valoresP] = posicion(id, 'ETH')
    await assert.rejects(db.batch([
      db.prepare('UPDATE simulaciones SET saldo = 1 WHERE id = ?').bind(id),
      db.prepare(sqlP).bind(...valoresP),
      db.prepare(sqlD).bind(...valoresD), // repetida: UNIQUE(simulacion_id, simbolo, vela_1h)
    ]), /UNIQUE/)
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), 10_000)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM posiciones').first('n'), 0)
  })

  test('el saldo nunca puede quedar negativo', async () => {
    const db = crearD1()
    const id = await simulacion(db, 5)
    await assert.rejects(db.prepare('UPDATE simulaciones SET saldo = saldo - 6 WHERE id = ?').bind(id).run(), /CHECK/)
  })

  test('solo una simulación activa', async () => {
    const db = crearD1()
    await simulacion(db)
    await assert.rejects(simulacion(db), /UNIQUE/)
    await db.prepare('UPDATE simulaciones SET activa = 0').run()
    assert.equal(await simulacion(db), 2)
  })

  test('una sola posición abierta por moneda y simulación; las cerradas no cuentan', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const ejecutar = (/** @type {any[]} */ [sql, valores]) => db.prepare(sql).bind(...valores).run()
    await ejecutar(posicion(id, 'BTC', 'cerrada'))
    await ejecutar(posicion(id, 'BTC', 'cerrada'))
    await ejecutar(posicion(id, 'BTC'))
    await assert.rejects(ejecutar(posicion(id, 'BTC')), /UNIQUE/)
    await ejecutar(posicion(id, 'ETH'))
  })

  test('una posición se abre y se cierra una sola vez', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const [sql, valores] = posicion(id, 'BTC')
    const { meta } = await db.prepare(sql).bind(...valores).run()
    const operacion = (/** @type {string} */ lado) => db.prepare(
      `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades, importe, comision,
         deslizamiento, motivo, saldo_tras, estrategia_version, creada_en)
       VALUES (?, ?, 'BTC', ?, 0, 100, 1, 100, 0.1, 0.05, 'senal', 9900, 'v1', 0)`,
    ).bind(id, meta.last_row_id, lado).run()
    await operacion('compra')
    await operacion('venta')
    await assert.rejects(operacion('venta'), /UNIQUE/)
  })

  test('las claves foráneas se respetan: no hay operaciones de posiciones inexistentes', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    await assert.rejects(db.prepare(
      `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades, importe, comision,
         deslizamiento, motivo, saldo_tras, estrategia_version, creada_en)
       VALUES (?, 999, 'BTC', 'compra', 0, 100, 1, 100, 0.1, 0.05, 'senal', 9900, 'v1', 0)`,
    ).bind(id).run(), /FOREIGN KEY/)
  })

  test('capital: INSERT OR IGNORE conserva el primer punto de cada vela', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const punto = (/** @type {number} */ valor) => db.prepare(
      'INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl) VALUES (?, 0, ?, ?, NULL)',
    ).bind(id, valor, valor).run()
    await punto(1)
    await punto(2)
    assert.equal(await db.prepare('SELECT valor_cartera FROM capital').first('valor_cartera'), 1)
  })

  test('cuenta cada llamada a D1 (first/all/run/batch), no cada sentencia del lote', async () => {
    const db = crearD1()
    await simulacion(db)
    await db.prepare('SELECT 1').first()
    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])
    assert.equal(db.llamadas, 3)
  })

  test('0002 rellena el resumen acumulado de los puntos de capital que ya existían, por simulación', () => {
    const sqlite = new DatabaseSync(':memory:')
    const migracion = (/** @type {string} */ n) => readFileSync(new URL(`../migrations/${n}`, import.meta.url), 'utf8')
    sqlite.exec(migracion('0001_inicial.sql'))
    /** @type {Record<number, { t: number, valor: number, hodl: number|null }[]>} */
    const curvas = {
      1: [[100, null], [120, null], [90, 50], [130.5, 40], [117, null], [60.25, 55]].map(([v, h], i) => ({ t: i * 3_600_000, valor: /** @type {number} */ (v), hodl: h })),
      2: [[10, null], [5, null]].map(([v, h], i) => ({ t: i * 3_600_000, valor: /** @type {number} */ (v), hodl: h })),
    }
    const insertar = sqlite.prepare('INSERT INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl) VALUES (?, ?, ?, 0, ?)')
    // Desordenadas a propósito: el relleno sigue el orden de vela, no el de inserción.
    for (const [id, curva] of Object.entries(curvas)) for (const p of [...curva].reverse()) insertar.run(Number(id), p.t, p.valor, p.hodl)
    sqlite.exec(migracion('0002_indices.sql'))
    for (const [id, curva] of Object.entries(curvas)) {
      const filas = sqlite.prepare('SELECT drawdown, drawdown_hodl, ultimo_hodl FROM capital WHERE simulacion_id = ? ORDER BY vela_1h').all(Number(id))
      filas.forEach((f, k) => {
        const r = resumirCurva(curva.slice(0, k + 1))
        assert.deepEqual({ ...f }, { drawdown: r.drawdownMaximo, drawdown_hodl: r.drawdownMaximoHodl, ultimo_hodl: r.ultimoHodl }, `sim ${id} punto ${k}`)
      })
    }
  })
})

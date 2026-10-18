// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import { ejecutarHora } from '../../core/hora.js'
import { resumirCurva } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import {
  cargarEstado, crearSimulacion, guardarCapital, guardarHodl, guardarPasoMoneda, listarSimulaciones,
  obtenerSimulacion, simulacionActiva,
} from '../src/repositorio.js'
import { crearD1 } from './d1.js'
import { CIERRE, ahoraDe, crearEscenario, entradasEn } from './escenario.js'

/** @param {ReturnType<typeof crearD1>} db */
const nuevaSimulacion = (db) => crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })

/**
 * Ejecuta las horas 0..n−1 del escenario en memoria y persiste cada una como lo hará el Worker.
 * Devuelve el estado en memoria y el reconstruido desde D1 tras cada hora.
 * @param {ReturnType<typeof crearD1>} db
 * @param {number} n
 */
async function recorrer(db, n) {
  const escenario = crearEscenario()
  let sim = await nuevaSimulacion(db)
  let estado = estadoInicial(10_000)
  /** @type {Record<string, number>|null} */
  let hodl = null
  const horas = []
  for (let k = 0; k < n; k++) {
    const ahora = ahoraDe(k)
    const r = ejecutarHora({
      estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasEn(escenario, ahora), titulares: [], fng: null, estrategia: v1,
    })
    if (hodl === null && r.hodl) await guardarHodl(db, sim.id, r.hodl)
    for (let i = 0; i < r.decisiones.length; i++) {
      const decision = r.decisiones[i]
      await guardarPasoMoneda(db, {
        simulacionId: sim.id, version: 'v1', decision, senal: r.senales[i],
        eventos: r.eventos.filter((e) => e.simbolo === decision.simbolo),
        ultimaRevisada: r.estado.ultimaRevisada[decision.simbolo], ahora,
      })
    }
    estado = r.estado
    hodl = r.hodl
    sim = /** @type {NonNullable<typeof sim>} */ (await obtenerSimulacion(db, sim.id))
    horas.push({ r, desdeD1: await cargarEstado(db, sim, v1.PARAMETROS_BOT) })
  }
  return { sim, horas }
}

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

describe('simulaciones', () => {
  test('crear cierra la activa anterior (sin borrar nada) y abre otra con su versión y capital', async () => {
    const db = crearD1()
    const a = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 100 })
    assert.equal(a.activa, 1)
    assert.equal(a.saldo, 10_000)
    assert.equal(a.hodl_json, null)
    const b = await crearSimulacion(db, { capitalInicial: 5_000, version: 'v2', ahora: 200 })
    assert.deepEqual(await simulacionActiva(db), b)
    assert.deepEqual(await obtenerSimulacion(db, a.id), { ...a, activa: 0, cerrada_en: 200 })
    assert.deepEqual((await listarSimulaciones(db)).map((s) => s.id), [b.id, a.id])
    assert.equal(await obtenerSimulacion(db, 99), null)
  })

  test('el HODL se guarda solo la primera vez', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    await guardarHodl(db, sim.id, { BTC: 1 })
    await guardarHodl(db, sim.id, { BTC: 2 })
    assert.equal((await obtenerSimulacion(db, sim.id))?.hodl_json, '{"BTC":1}')
  })
})

describe('estado del bot ↔ D1', () => {
  test('simulación nueva: mismo estado que estadoInicial y sin HODL; sin progreso = nunca revisada', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    assert.deepEqual(await cargarEstado(db, sim, v1.PARAMETROS_BOT), { estado: estadoInicial(10_000), hodl: null })
  })

  test('tras cada hora del escenario, el estado reconstruido desde D1 es idéntico al de memoria', async () => {
    const db = crearD1()
    const { horas } = await recorrer(db, 8)
    for (const [k, { r, desdeD1 }] of horas.entries()) {
      assert.deepEqual(desdeD1.estado, r.estado, `hora ${k}`)
      assert.deepEqual(desdeD1.hodl, r.hodl, `hora ${k}`)
      // valorCartera suma en el orden de las claves: el orden de apertura también debe coincidir
      assert.deepEqual(Object.keys(desdeD1.estado.posiciones), Object.keys(r.estado.posiciones), `orden en la hora ${k}`)
    }
    const motivos = horas.flatMap(({ r }) => r.eventos.map((e) => `${e.simbolo}:${e.tipo}:${e.motivo}`))
    assert.deepEqual(motivos, [
      'BTC:compra:senal', 'ETH:compra:senal', 'BTC:venta:stop_loss', 'ETH:venta:take_profit',
      'ETH:compra:senal', 'BTC:compra:senal',
    ])
    assert.deepEqual(horas[7].desdeD1.estado.enfriamientoHasta, { BTC: CIERRE + 4 * HORA }, 'solo el stop-loss enfría')
  })

  test('decisiones: una por moneda y hora, con desglose y motivos del bot', async () => {
    const db = crearD1()
    await recorrer(db, 6)
    const d = await filas(db, "SELECT vela_1h, motivo, accion, precio, desglose_json FROM decisiones WHERE simbolo = 'BTC' ORDER BY vela_1h")
    assert.deepEqual(d.map((x) => x.motivo), ['abierta', 'cerrada_por_stop', 'enfriamiento', 'enfriamiento', 'enfriamiento', 'abierta'])
    assert.deepEqual(d.map((x) => x.vela_1h), [0, 1, 2, 3, 4, 5].map((k) => CIERRE + (k - 1) * HORA))
    assert.equal(JSON.parse(d[0].desglose_json).veredicto, 'COMPRAR')
    assert.ok(d.every((x) => typeof x.precio === 'number'))
  })

  test('operaciones y posiciones: coste, pnl_neto en ventas y saldo_tras igual al saldo real', async () => {
    const db = crearD1()
    const { sim, horas } = await recorrer(db, 8)
    const ops = await filas(db, 'SELECT * FROM operaciones ORDER BY id')
    assert.ok(ops.filter((o) => o.lado === 'compra').every((o) => o.pnl_neto === null))
    const ventas = ops.filter((o) => o.lado === 'venta')
    assert.deepEqual(ventas.map((o) => o.motivo), ['stop_loss', 'take_profit'])
    const eventosVenta = horas.flatMap(({ r }) => r.eventos.filter((e) => e.tipo === 'venta'))
    assert.deepEqual(ventas.map((o) => o.pnl_neto), eventosVenta.map((e) => e.pnlNeto))
    assert.deepEqual(ops.map((o) => o.saldo_tras), horas.flatMap(({ r }) => r.eventos.map((e) => e.saldoTras)))
    const cerradas = await filas(db, "SELECT * FROM posiciones WHERE estado = 'cerrada' ORDER BY id")
    assert.deepEqual(cerradas.map((p) => p.motivo_salida), ['stop_loss', 'take_profit'])
    assert.deepEqual(cerradas.map((p) => p.pnl_neto), eventosVenta.map((e) => e.pnlNeto))
    assert.deepEqual(cerradas.map((p) => p.coste), eventosVenta.map((e) => e.posicion.coste))
    const libro = ops.reduce((s, o) => (o.lado === 'compra' ? s - o.importe : s + o.importe - o.comision), 10_000)
    assert.ok(Math.abs(libro - sim.saldo) < 1e-9)
  })
})

describe('atomicidad e idempotencia', () => {
  /** Primera hora del escenario lista para persistir. */
  async function primeraHora() {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    const ahora = ahoraDe(0)
    const r = ejecutarHora({
      estado: estadoInicial(10_000), hodl: null, capitalInicial: 10_000, ahora,
      monedas: entradasEn(crearEscenario(), ahora), titulares: [], fng: null, estrategia: v1,
    })
    /** @param {number} i */
    const paso = (i) => ({
      simulacionId: sim.id, version: 'v1', decision: r.decisiones[i], senal: r.senales[i],
      eventos: r.eventos.filter((e) => e.simbolo === r.decisiones[i].simbolo),
      ultimaRevisada: r.estado.ultimaRevisada[r.decisiones[i].simbolo], ahora,
    })
    return { db, sim, paso }
  }

  /** @param {ReturnType<typeof crearD1>} db */
  const recuento = async (db) => ({
    saldo: await db.prepare('SELECT saldo FROM simulaciones').first('saldo'),
    decisiones: await db.prepare('SELECT COUNT(*) AS n FROM decisiones').first('n'),
    operaciones: await db.prepare('SELECT COUNT(*) AS n FROM operaciones').first('n'),
    posiciones: await db.prepare('SELECT COUNT(*) AS n FROM posiciones').first('n'),
    progreso: await db.prepare('SELECT COUNT(*) AS n FROM progreso').first('n'),
  })

  test('repetir el lote de una moneda en la misma vela no cambia nada (UNIQUE de la decisión)', async () => {
    const { db, paso } = await primeraHora()
    await guardarPasoMoneda(db, paso(0))
    const antes = await recuento(db)
    assert.equal(antes.operaciones, 1)
    await assert.rejects(guardarPasoMoneda(db, paso(0)), /UNIQUE constraint failed: decisiones/)
    assert.deepEqual(await recuento(db), antes)
  })

  test('una compra que no cabe en el saldo real revierte el lote entero (CHECK saldo >= 0)', async () => {
    const { db, paso } = await primeraHora()
    await db.prepare('UPDATE simulaciones SET saldo = 5').run()
    await assert.rejects(guardarPasoMoneda(db, paso(0)), /CHECK constraint failed/)
    assert.deepEqual(await recuento(db), { saldo: 5, decisiones: 0, operaciones: 0, posiciones: 0, progreso: 0 })
  })

  test('una venta sin posición abierta en D1 revierte el lote (posicion_id NOT NULL)', async () => {
    const { db, paso } = await primeraHora()
    const p = paso(0)
    const compra = p.eventos[0]
    const venta = { ...compra, tipo: /** @type {const} */ ('venta'), pnlNeto: 0 }
    await assert.rejects(guardarPasoMoneda(db, { ...p, eventos: [venta] }), /NOT NULL constraint failed: operaciones.posicion_id/)
    assert.equal((await recuento(db)).decisiones, 0)
  })

  test('un evento de otra moneda en el lote es un error de programación', async () => {
    const { db, paso } = await primeraHora()
    const p = paso(0)
    await assert.rejects(guardarPasoMoneda(db, { ...p, eventos: paso(1).eventos }), RangeError)
  })

  test('capital: un punto por vela; el segundo intento se ignora', async () => {
    const { db, sim } = await primeraHora()
    await guardarCapital(db, { simulacionId: sim.id, vela: CIERRE, valorCartera: 10_000, saldo: 10_000, valorHodl: null })
    await guardarCapital(db, { simulacionId: sim.id, vela: CIERRE, valorCartera: 1, saldo: 1, valorHodl: 1 })
    assert.deepEqual(await filas(db, 'SELECT simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl FROM capital'), [
      { simulacion_id: sim.id, vela_1h: CIERRE, valor_cartera: 10_000, saldo: 10_000, valor_hodl: null },
    ])
  })

  test('capital: cada punto guarda el resumen de la curva hasta él, idéntico a core/metricas.js (bit a bit)', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    // Enteros incluidos (10.000, 12.000, 9.000): la división no puede ser entera.
    const valores = [10_000, 12_000, 9_000, 9_500.123, 13_000, 12_999.5, 7_000.25, 7_100, 13_500, 1_000.75]
    const hodls = [null, null, 10_000, 9_000, null, 11_000.5, 8_000, 8_000, 12_000, 5_000.125]
    /** @type {{ t: number, valor: number, hodl: number|null }[]} */
    const curva = []
    for (let k = 0; k < valores.length; k++) {
      const p = { t: CIERRE + k * HORA, valor: valores[k], hodl: hodls[k] }
      curva.push(p)
      await guardarCapital(db, { simulacionId: sim.id, vela: p.t, valorCartera: p.valor, saldo: 1, valorHodl: p.hodl })
      const fila = await db.prepare('SELECT drawdown, drawdown_hodl, ultimo_hodl FROM capital WHERE vela_1h = ?').bind(p.t).first()
      const r = resumirCurva(curva)
      assert.deepEqual(
        { drawdownMaximo: fila.drawdown, drawdownMaximoHodl: fila.drawdown_hodl, ultimoHodl: fila.ultimo_hodl },
        { drawdownMaximo: r.drawdownMaximo, drawdownMaximoHodl: r.drawdownMaximoHodl, ultimoHodl: r.ultimoHodl },
        `punto ${k}`,
      )
    }
    assert.ok(resumirCurva(curva).drawdownMaximo > 0.9)
  })
})

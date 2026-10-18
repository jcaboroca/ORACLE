// @ts-check
// Todas las consultas D1 de ORACLE. Ninguna otra parte del Worker escribe SQL.
import { HORA } from '../../core/velas.js'

/** @typedef {import('../../core/bot.js').Estado} Estado */
/** @typedef {import('../../core/bot.js').Evento} Evento */
/** @typedef {import('../../core/bot.js').Decision} Decision */
/** @typedef {import('../../core/bot.js').ParametrosBot} ParametrosBot */
/** @typedef {import('../../core/hora.js').Senal} Senal */
/**
 * @typedef {{ prepare: (sql: string) => any, batch: (sentencias: any[]) => Promise<any[]> }} D1
 * Subconjunto de D1Database que usa ORACLE.
 */
/**
 * @typedef {{ id: number, creada_en: number, cerrada_en: number|null, activa: number,
 *   estrategia_version: string, capital_inicial: number, saldo: number, hodl_json: string|null }} FilaSimulacion
 */

// ── Simulaciones ─────────────────────────────────────────────────────────────

/** @param {D1} db @returns {Promise<FilaSimulacion|null>} */
export function simulacionActiva(db) {
  return db.prepare('SELECT * FROM simulaciones WHERE activa = 1').first()
}

/** @param {D1} db @param {number} id @returns {Promise<FilaSimulacion|null>} */
export function obtenerSimulacion(db, id) {
  return db.prepare('SELECT * FROM simulaciones WHERE id = ?').bind(id).first()
}

/** @param {D1} db @returns {Promise<FilaSimulacion[]>} */
export async function listarSimulaciones(db) {
  return (await db.prepare('SELECT * FROM simulaciones ORDER BY id DESC').all()).results
}

/**
 * Cierra la simulación activa (si hay) y abre otra, en un solo lote. Nada se borra.
 * @param {D1} db
 * @param {{ capitalInicial: number, version: string, ahora: number }} datos
 * @returns {Promise<FilaSimulacion>}
 */
export async function crearSimulacion(db, { capitalInicial, version, ahora }) {
  const [, insercion] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1').bind(ahora),
    db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, version, capitalInicial, capitalInicial),
  ])
  return insercion.results[0]
}

/**
 * Guarda las unidades de comprar y mantener solo la primera vez (nunca las cambia después).
 * @param {D1} db @param {number} simulacionId @param {Record<string, number>} hodl
 */
export function guardarHodl(db, simulacionId, hodl) {
  return db.prepare('UPDATE simulaciones SET hodl_json = ? WHERE id = ? AND hodl_json IS NULL')
    .bind(JSON.stringify(hodl), simulacionId).run()
}

// ── Estado del bot (spec §10, «Reconstrucción del estado del bot») ──────────

/**
 * Estado de core/bot.js reconstruido sin pérdida desde D1, con una sola llamada (lote de 3 lecturas).
 * Sin fila de progreso = moneda nunca revisada (la clave no existe → −∞ en el bot).
 * @param {D1} db
 * @param {FilaSimulacion} simulacion
 * @param {ParametrosBot} parametrosBot de la estrategia de la simulación (enfriamientoHoras)
 * @returns {Promise<{ estado: Estado, hodl: Record<string, number>|null }>}
 */
export async function cargarEstado(db, simulacion, parametrosBot) {
  const id = simulacion.id
  const [abiertas, progreso, stops] = await db.batch([
    // ORDER BY id = orden de apertura, el mismo orden de claves que en memoria: valorCartera suma en ese
    // orden y así el resultado es idéntico al del backtest hasta el último bit.
    db.prepare("SELECT * FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta' ORDER BY id").bind(id),
    db.prepare('SELECT simbolo, ultima_vela_revisada FROM progreso WHERE simulacion_id = ?').bind(id),
    db.prepare(
      `SELECT simbolo, MAX(vela_salida) AS vela FROM posiciones
       WHERE simulacion_id = ? AND estado = 'cerrada' AND motivo_salida = 'stop_loss' GROUP BY simbolo`,
    ).bind(id),
  ])
  /** @type {Estado} */
  const estado = { saldo: simulacion.saldo, posiciones: {}, ultimaRevisada: {}, enfriamientoHasta: {} }
  for (const p of abiertas.results) {
    estado.posiciones[p.simbolo] = {
      simbolo: p.simbolo, velaEntrada: p.vela_entrada, precioEntrada: p.precio_entrada, unidades: p.unidades,
      coste: p.coste, stopLoss: p.stop_loss, takeProfit: p.take_profit,
    }
  }
  for (const p of progreso.results) estado.ultimaRevisada[p.simbolo] = p.ultima_vela_revisada
  for (const s of stops.results) estado.enfriamientoHasta[s.simbolo] = s.vela + parametrosBot.enfriamientoHoras * HORA
  return { estado, hodl: simulacion.hodl_json === null ? null : JSON.parse(simulacion.hodl_json) }
}

/**
 * Sentencias de una moneda en una hora, para UN db.batch() (spec §7.5):
 * 1. INSERT de la decisión, sin OR IGNORE: si ya existe (reintento), todo el lote se revierte.
 * 2. Por evento: el saldo se mueve con un delta (no con un valor absoluto), así cada lote que entra
 *    es coherente por sí solo aunque el de otra moneda falle; `saldo_tras` se lee del saldo real.
 *    Venta: saldo += importe − comisión; operación; posición cerrada con su pnl_neto.
 *    Compra: saldo −= importe; posición abierta; operación. CHECK (saldo >= 0) revierte si no alcanza.
 * 3. progreso de la moneda.
 * @param {D1} db
 * @param {{ simulacionId: number, version: string, decision: Decision, senal: Senal, eventos: Evento[],
 *   ultimaRevisada: number|undefined, ahora: number }} paso
 */
export function sentenciasPasoMoneda(db, { simulacionId, version, decision, senal, eventos, ultimaRevisada, ahora }) {
  const s = decision.simbolo
  const posicionAbierta = "(SELECT id FROM posiciones WHERE simulacion_id = ? AND simbolo = ? AND estado = 'abierta')"
  const saldoActual = '(SELECT saldo FROM simulaciones WHERE id = ?)'
  const insertarOperacion = `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades,
      importe, comision, deslizamiento, motivo, saldo_tras, pnl_neto, estrategia_version, creada_en)
    VALUES (?, ${posicionAbierta}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${saldoActual}, ?, ?, ?)`
  /** @param {Evento} e */
  const operacion = (e) => db.prepare(insertarOperacion).bind(
    simulacionId, simulacionId, s, s, e.tipo, e.vela, e.precio, e.unidades, e.importe, e.comision, e.deslizamiento,
    e.motivo, simulacionId, e.pnlNeto ?? null, version, ahora,
  )
  const sentencias = [
    db.prepare(
      `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, indice_confianza, puntuacion, accion, motivo,
         precio, desglose_json, estrategia_version, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      simulacionId, s, decision.vela, decision.veredicto, decision.indiceConfianza, decision.puntuacion, decision.accion,
      decision.motivo, decision.precio, JSON.stringify(senal), version, ahora,
    ),
  ]
  for (const e of eventos) {
    if (e.simbolo !== s) throw new RangeError(`evento de ${e.simbolo} en el lote de ${s}`)
    if (e.tipo === 'venta') {
      sentencias.push(
        db.prepare('UPDATE simulaciones SET saldo = saldo + ? WHERE id = ?').bind(e.importe - e.comision, simulacionId),
        operacion(e),
        db.prepare(
          `UPDATE posiciones SET estado = 'cerrada', vela_salida = ?, precio_salida = ?, motivo_salida = ?, pnl_neto = ?
           WHERE simulacion_id = ? AND simbolo = ? AND estado = 'abierta'`,
        ).bind(e.vela, e.precio, e.motivo, e.pnlNeto ?? null, simulacionId, s),
      )
    } else {
      const p = e.posicion
      sentencias.push(
        db.prepare('UPDATE simulaciones SET saldo = saldo - ? WHERE id = ?').bind(e.importe, simulacionId),
        db.prepare(
          `INSERT INTO posiciones (simulacion_id, simbolo, estado, vela_entrada, precio_entrada, unidades, coste, stop_loss, take_profit)
           VALUES (?, ?, 'abierta', ?, ?, ?, ?, ?, ?)`,
        ).bind(simulacionId, s, p.velaEntrada, p.precioEntrada, p.unidades, p.coste, p.stopLoss, p.takeProfit),
        operacion(e),
      )
    }
  }
  if (ultimaRevisada !== undefined) {
    sentencias.push(db.prepare(
      `INSERT INTO progreso (simulacion_id, simbolo, ultima_vela_revisada) VALUES (?, ?, ?)
       ON CONFLICT (simulacion_id, simbolo) DO UPDATE SET ultima_vela_revisada = excluded.ultima_vela_revisada`,
    ).bind(simulacionId, s, ultimaRevisada))
  }
  return sentencias
}

/**
 * Persiste el paso de una moneda de forma atómica (1 llamada a D1).
 * @param {D1} db
 * @param {Parameters<typeof sentenciasPasoMoneda>[1]} paso
 */
export async function guardarPasoMoneda(db, paso) {
  await db.batch(sentenciasPasoMoneda(db, paso))
}

/**
 * Punto horario de la curva de capital; si ya existe, se conserva el primero.
 * @param {D1} db
 * @param {{ simulacionId: number, vela: number, valorCartera: number, saldo: number, valorHodl: number|null }} punto
 */
export function guardarCapital(db, { simulacionId, vela, valorCartera, saldo, valorHodl }) {
  return db.prepare(
    'INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl) VALUES (?, ?, ?, ?, ?)',
  ).bind(simulacionId, vela, valorCartera, saldo, valorHodl).run()
}

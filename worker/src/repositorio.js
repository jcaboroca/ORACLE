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
// Una simulación activa por estrategia (migración 0006: índice único parcial sobre estrategia_version).

/** @param {number} n */
const marcas = (n) => Array.from({ length: n }, () => '?').join(', ')

/** Simulación activa de una estrategia. @param {D1} db @param {string} version @returns {Promise<FilaSimulacion|null>} */
export function simulacionActiva(db, version) {
  return db.prepare('SELECT * FROM simulaciones WHERE activa = 1 AND estrategia_version = ?').bind(version).first()
}

/** Todas las simulaciones activas, por id. @param {D1} db @returns {Promise<FilaSimulacion[]>} */
export async function simulacionesActivas(db) {
  return (await db.prepare('SELECT * FROM simulaciones WHERE activa = 1 ORDER BY id').all()).results
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
 * Cierra la simulación activa de la misma estrategia (si hay) y abre otra, en un solo lote. Las de otras
 * estrategias no se tocan. Nada se borra.
 * @param {D1} db
 * @param {{ capitalInicial: number, version: string, ahora: number }} datos
 * @returns {Promise<FilaSimulacion>}
 */
export async function crearSimulacion(db, { capitalInicial, version, ahora }) {
  const [, insercion] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1 AND estrategia_version = ?').bind(ahora, version),
    db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, version, capitalInicial, capitalInicial),
  ])
  return insercion.results[0]
}

/**
 * Reinicio del bot: cierra TODAS las simulaciones activas y abre una por cada versión, todas con el mismo
 * capital y el mismo instante (la comparativa empieza igualada). Un solo lote. Devuelve las nuevas en el orden
 * de `versiones`.
 * @param {D1} db
 * @param {{ capitalInicial: number, versiones: readonly string[], ahora: number }} datos
 * @returns {Promise<FilaSimulacion[]>}
 */
export async function reiniciarSimulaciones(db, { capitalInicial, versiones, ahora }) {
  const [, ...inserciones] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1').bind(ahora),
    ...versiones.map((v) => db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, v, capitalInicial, capitalInicial)),
  ])
  return inserciones.map((r) => r.results[0])
}

/**
 * Deja exactamente una simulación activa por cada versión de `versiones`, en un solo lote (1 llamada):
 * 1. cierra (activa = 0, cerrada_en) las activas cuya estrategia ya no está en la lista: quedan en el historial;
 * 2. crea con `capitalInicial` las que falten;
 * 3. devuelve las activas en el orden de `versiones`.
 * Si nada cambia, no escribe ninguna fila. Dos ejecuciones a la vez no pueden crear dos de la misma estrategia:
 * el índice único parcial revierte el lote de la segunda.
 * @param {D1} db
 * @param {{ versiones: readonly string[], capitalInicial: number, ahora: number }} datos
 * @returns {Promise<FilaSimulacion[]>}
 */
export async function sincronizarSimulaciones(db, { versiones, capitalInicial, ahora }) {
  if (versiones.length === 0) throw new RangeError('No hay estrategias en vivo')
  const resultados = await db.batch([
    db.prepare(`UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1 AND estrategia_version NOT IN (${marcas(versiones.length)})`)
      .bind(ahora, ...versiones),
    ...versiones.map((v) => db.prepare(
      `INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo)
       SELECT ?, 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM simulaciones WHERE activa = 1 AND estrategia_version = ?)`,
    ).bind(ahora, v, capitalInicial, capitalInicial, v)),
    db.prepare('SELECT * FROM simulaciones WHERE activa = 1 ORDER BY id'),
  ])
  /** @type {FilaSimulacion[]} */
  const activas = resultados[resultados.length - 1].results
  return versiones.map((v) => {
    const sim = activas.find((s) => s.estrategia_version === v)
    if (!sim) throw new Error(`No quedó activa la simulación de ${v}`)
    return sim
  })
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
 * Las 3 lecturas del estado de una simulación (posiciones abiertas, progreso y último stop por moneda).
 * @param {D1} db @param {number} id
 */
const lecturasEstado = (db, id) => [
  // ORDER BY id = orden de apertura, el mismo orden de claves que en memoria: valorCartera suma en ese
  // orden y así el resultado es idéntico al del backtest hasta el último bit.
  db.prepare("SELECT * FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta' ORDER BY id").bind(id),
  db.prepare('SELECT simbolo, ultima_vela_revisada FROM progreso WHERE simulacion_id = ?').bind(id),
  db.prepare(
    `SELECT simbolo, MAX(vela_salida) AS vela FROM posiciones
     WHERE simulacion_id = ? AND estado = 'cerrada' AND motivo_salida = 'stop_loss' GROUP BY simbolo`,
  ).bind(id),
]

/**
 * @param {FilaSimulacion} simulacion
 * @param {{ results: any[] }[]} lecturas resultados de lecturasEstado, en su orden
 * @param {ParametrosBot} parametrosBot
 * @returns {{ estado: Estado, hodl: Record<string, number>|null }}
 */
function estadoDesde(simulacion, [abiertas, progreso, stops], parametrosBot) {
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
 * Estado de core/bot.js reconstruido sin pérdida desde D1, con una sola llamada (lote de 3 lecturas).
 * Sin fila de progreso = moneda nunca revisada (la clave no existe → −∞ en el bot).
 * @param {D1} db
 * @param {FilaSimulacion} simulacion
 * @param {ParametrosBot} parametrosBot de la estrategia de la simulación (enfriamientoHoras)
 * @returns {Promise<{ estado: Estado, hodl: Record<string, number>|null }>}
 */
export async function cargarEstado(db, simulacion, parametrosBot) {
  return estadoDesde(simulacion, await db.batch(lecturasEstado(db, simulacion.id)), parametrosBot)
}

/**
 * Fila y estado de varias simulaciones en UNA llamada (lote de 1 + 3 × n lecturas), en el orden de `ids`.
 * Igual que obtenerSimulacion + cargarEstado de cada una.
 * @param {D1} db
 * @param {number[]} ids
 * @param {(version: string) => ParametrosBot} parametrosDe parámetros de bot de cada estrategia
 * @returns {Promise<{ sim: FilaSimulacion, estado: Estado, hodl: Record<string, number>|null }[]>}
 */
export async function cargarEstados(db, ids, parametrosDe) {
  if (ids.length === 0) return []
  const [filas, ...lecturas] = await db.batch([
    db.prepare(`SELECT * FROM simulaciones WHERE id IN (${marcas(ids.length)})`).bind(...ids),
    ...ids.flatMap((id) => lecturasEstado(db, id)),
  ])
  return ids.map((id, i) => {
    /** @type {FilaSimulacion|undefined} */
    const sim = filas.results.find((f) => f.id === id)
    if (!sim) throw new RangeError(`No existe la simulación ${id}`)
    return { sim, ...estadoDesde(sim, lecturas.slice(3 * i, 3 * i + 3), parametrosDe(sim.estrategia_version)) }
  })
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
 * Punto horario de la curva de capital; si ya existe, se conserva el primero. Guarda además el resumen
 * acumulado de la curva hasta este punto (máximos, drawdowns y último HODL) a partir del punto anterior,
 * con las mismas operaciones y en el mismo orden que drawdownMaximo de core/metricas.js: el resultado es
 * idéntico al de recorrer la curva entera. Los puntos llegan en orden de vela (uno por ejecución de mercado).
 * Devuelve la sentencia sin ejecutar (guardarCapital la ejecuta; guardarCapitales las agrupa en un lote).
 * @param {D1} db
 * @param {PuntoCapital} punto
 */
export function sentenciaCapital(db, { simulacionId, vela, valorCartera, saldo, valorHodl }) {
  // Valor y HODL como REAL: un entero enlazado haría división entera en (máximo − valor) / máximo.
  return db.prepare(
    `INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl,
       maximo, drawdown, maximo_hodl, drawdown_hodl, ultimo_hodl)
     SELECT s, t, v, ?, h,
       mx, MAX(COALESCE(dd, 0), CASE WHEN mx > 0 THEN (mx - v) / mx ELSE 0 END),
       mh, CASE WHEN mh IS NULL THEN NULL WHEN h IS NULL THEN ddh
         ELSE MAX(COALESCE(ddh, 0), CASE WHEN mh > 0 THEN (mh - h) / mh ELSE 0 END) END,
       COALESCE(h, uh)
     FROM (
       SELECT s, t, v, h, MAX(COALESCE(p.maximo, v), v) AS mx,
         CASE WHEN h IS NULL THEN p.maximo_hodl ELSE MAX(COALESCE(p.maximo_hodl, h), h) END AS mh,
         p.drawdown AS dd, p.drawdown_hodl AS ddh, p.ultimo_hodl AS uh
       FROM (SELECT ? AS s, ? AS t, CAST(? AS REAL) AS v, CAST(? AS REAL) AS h)
       LEFT JOIN (SELECT maximo, drawdown, maximo_hodl, drawdown_hodl, ultimo_hodl FROM capital
         WHERE simulacion_id = ? AND vela_1h < ? ORDER BY vela_1h DESC LIMIT 1) p ON 1
     )`,
  ).bind(saldo, simulacionId, vela, valorCartera, valorHodl, simulacionId, vela)
}

/**
 * @typedef {{ simulacionId: number, vela: number, valorCartera: number, saldo: number, valorHodl: number|null }} PuntoCapital
 */

/** Un punto de capital (1 llamada). @param {D1} db @param {PuntoCapital} punto */
export function guardarCapital(db, punto) {
  return sentenciaCapital(db, punto).run()
}

/** Los puntos de capital de varias simulaciones en un lote (1 llamada; nada si no hay). @param {D1} db @param {PuntoCapital[]} puntos */
export async function guardarCapitales(db, puntos) {
  if (puntos.length > 0) await db.batch(puntos.map((p) => sentenciaCapital(db, p)))
}

// ── Ejecuciones ──────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: number, tipo: 'noticias'|'mercado'|'manual', inicio: number, fin: number|null,
 *   ok: boolean|null, fallos: string[] }} Ejecucion
 */

/** @param {D1} db @param {'noticias'|'mercado'|'manual'} tipo @param {number} inicio @returns {Promise<number>} */
export function iniciarEjecucion(db, tipo, inicio) {
  return db.prepare('INSERT INTO ejecuciones (tipo, inicio) VALUES (?, ?) RETURNING id').bind(tipo, inicio).first('id')
}

/**
 * Reserva el análisis manual de forma atómica: inserta la ejecución 'manual' solo si no hay otra que haya
 * empezado en los últimos `esperaMs` (una sola sentencia: dos peticiones a la vez no pueden pasar las dos).
 * @param {D1} db @param {number} inicio @param {number} esperaMs
 * @returns {Promise<number|null>} id de la ejecución, o null si es demasiado pronto
 */
export function reservarManual(db, inicio, esperaMs) {
  return db.prepare(
    `INSERT INTO ejecuciones (tipo, inicio) SELECT 'manual', ?
     WHERE NOT EXISTS (SELECT 1 FROM ejecuciones WHERE tipo = 'manual' AND inicio > ?) RETURNING id`,
  ).bind(inicio, inicio - esperaMs).first('id')
}

/**
 * @param {D1} db @param {number} id
 * @param {{ fin: number, ok: boolean, detalle: { fallos: string[] } & Record<string, unknown> }} cierre
 */
export function finalizarEjecucion(db, id, { fin, ok, detalle }) {
  return db.prepare('UPDATE ejecuciones SET fin = ?, ok = ?, detalle_json = ? WHERE id = ?')
    .bind(fin, ok ? 1 : 0, JSON.stringify(detalle), id).run()
}

/** @param {any} fila @returns {Ejecucion} */
export function filaAEjecucion(fila) {
  const detalle = fila.detalle_json ? JSON.parse(fila.detalle_json) : {}
  return {
    id: fila.id, tipo: fila.tipo, inicio: fila.inicio, fin: fila.fin,
    ok: fila.ok === null ? null : fila.ok === 1, fallos: Array.isArray(detalle.fallos) ? detalle.fallos : [],
  }
}

/** La más reciente (inicio, id) de varias filas de ejecuciones. @param {any[]} filas */
const masReciente = (filas) => filas.reduce(
  (a, f) => (f && (!a || f.inicio > a.inicio || (f.inicio === a.inicio && f.id > a.id)) ? f : a), null,
)

/**
 * Ejecución más reciente de alguno de los tipos dados: una búsqueda con LIMIT 1 por tipo sobre
 * ejecuciones(tipo, inicio), en una sola llamada. Nunca ordena la tabla.
 * @param {D1} db @param {('noticias'|'mercado'|'manual')[]} tipos
 * @returns {Promise<Ejecucion|null>}
 */
export async function ultimaEjecucion(db, tipos) {
  const resultados = await db.batch(tipos.map((t) => db.prepare(
    'SELECT * FROM ejecuciones WHERE tipo = ? ORDER BY inicio DESC, id DESC LIMIT 1',
  ).bind(t)))
  const fila = masReciente(resultados.map((r) => r.results[0]))
  return fila ? filaAEjecucion(fila) : null
}

// ── Titulares ────────────────────────────────────────────────────────────────

/** @typedef {import('./fuentes/rss.js').TitularCrudo & { id: string }} TitularNuevo */

/**
 * Inserta en 1 sentencia (json_each) solo los titulares cuyo id no existe. Devuelve cuántos entraron.
 * @param {D1} db @param {TitularNuevo[]} titulares
 */
export async function insertarTitulares(db, titulares) {
  if (titulares.length === 0) return 0
  const r = await db.prepare(
    `INSERT OR IGNORE INTO titulares (id, fuente, origen, titulo, url, publicado_en)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.fuente'), json_extract(value, '$.origen'),
            json_extract(value, '$.titulo'), json_extract(value, '$.url'), json_extract(value, '$.publicadoEn')
     FROM json_each(?)`,
  ).bind(JSON.stringify(titulares)).run()
  return r.meta.changes
}

/**
 * Titulares sin puntuar publicados desde `desde`, los más recientes primero.
 * @param {D1} db @param {number} desde @param {number} limite
 * @returns {Promise<{ id: string, titulo: string }[]>}
 */
export async function titularesSinPuntuar(db, desde, limite) {
  return (await db.prepare(
    'SELECT id, titulo FROM titulares WHERE puntuacion IS NULL AND publicado_en >= ? ORDER BY publicado_en DESC LIMIT ?',
  ).bind(desde, limite).all()).results
}

/**
 * Guarda puntuación, monedas y motor de cada titular en 1 sentencia (UPDATE … FROM json_each).
 * @param {D1} db @param {Record<string, { puntuacion: number, monedas: string[], motor: string }>} resultados
 */
export async function guardarPuntuaciones(db, resultados) {
  const lista = Object.entries(resultados).map(([id, r]) => ({ id, ...r }))
  if (lista.length === 0) return
  await db.prepare(
    `UPDATE titulares SET puntuacion = json_extract(j.value, '$.puntuacion'),
       monedas_json = json_extract(j.value, '$.monedas'), motor = json_extract(j.value, '$.motor')
     FROM json_each(?) AS j WHERE titulares.id = json_extract(j.value, '$.id')`,
  ).bind(JSON.stringify(lista)).run()
}

/**
 * Titulares puntuados de (desde, hasta] para la estrategia.
 * @param {D1} db @param {number} desde @param {number} hasta
 * @returns {Promise<import('../../core/estrategia-v1.js').Titular[]>}
 */
export async function titularesParaEstrategia(db, desde, hasta) {
  const { results } = await db.prepare(
    `SELECT id, origen, publicado_en, monedas_json, puntuacion FROM titulares
     WHERE publicado_en > ? AND publicado_en <= ? AND puntuacion IS NOT NULL ORDER BY publicado_en`,
  ).bind(desde, hasta).all()
  return results.map((t) => ({
    id: t.id, origen: t.origen, publicadoEn: t.publicado_en, monedas: JSON.parse(t.monedas_json ?? '[]'), puntuacion: t.puntuacion,
  }))
}

/**
 * Purga (spec §10): titulares > 7 días, ejecuciones > 30 días y bloqueos de PIN caducados. 1 llamada.
 * @param {D1} db @param {number} ahora
 */
export async function purgar(db, ahora) {
  const dia = 24 * HORA
  await db.batch([
    db.prepare('DELETE FROM titulares WHERE publicado_en < ?').bind(ahora - 7 * dia),
    db.prepare('DELETE FROM ejecuciones WHERE inicio < ?').bind(ahora - 30 * dia),
    db.prepare('DELETE FROM intentos_pin WHERE bloqueado_hasta IS NOT NULL AND bloqueado_hasta < ?').bind(ahora),
  ])
}

// ── Caché de mercado (spec §4 y §9) ──────────────────────────────────────────

/**
 * Velas y funding guardados de las monedas configuradas, en una llamada (lote de 2 lecturas por clave primaria).
 * @param {D1} db
 * @param {string[]} monedas
 * @returns {Promise<{ velas: Record<string, string>, funding: Record<string, { valor: number, actualizadoEn: number }> }>}
 *   velas: 'BTC-USDT 1h' → velas_json
 */
export async function leerCacheMercado(db, monedas) {
  const instrumentos = monedas.flatMap((s) => [`${s}-USDT`, `${s}-EUR`])
  const [velas, funding] = await db.batch([
    db.prepare(`SELECT instrumento, intervalo, velas_json FROM cache_velas WHERE instrumento IN (${marcas(instrumentos.length)})`)
      .bind(...instrumentos),
    db.prepare(`SELECT simbolo, valor, actualizado_en FROM cache_funding WHERE simbolo IN (${marcas(monedas.length)})`).bind(...monedas),
  ])
  return {
    velas: Object.fromEntries(velas.results.map((f) => [`${f.instrumento} ${f.intervalo}`, f.velas_json])),
    funding: Object.fromEntries(funding.results.map((f) => [f.simbolo, { valor: f.valor, actualizadoEn: f.actualizado_en }])),
  }
}

/**
 * Reescribe las series y el funding que han cambiado, en un lote (nada si no hay cambios).
 * @param {D1} db
 * @param {{ velas: { instrumento: string, intervalo: string, json: string }[], funding: Record<string, number>, ahora: number }} datos
 */
export async function guardarCacheMercado(db, { velas, funding, ahora }) {
  const sentencias = [
    ...velas.map((v) => db.prepare(
      `INSERT INTO cache_velas (instrumento, intervalo, velas_json, actualizado_en) VALUES (?, ?, ?, ?)
       ON CONFLICT (instrumento, intervalo) DO UPDATE SET velas_json = excluded.velas_json, actualizado_en = excluded.actualizado_en`,
    ).bind(v.instrumento, v.intervalo, v.json, ahora)),
    ...Object.entries(funding).map(([simbolo, valor]) => db.prepare(
      `INSERT INTO cache_funding (simbolo, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT (simbolo) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    ).bind(simbolo, valor, ahora)),
  ]
  if (sentencias.length > 0) await db.batch(sentencias)
}

// ── Señales actuales ─────────────────────────────────────────────────────────

/**
 * Sustituye la señal vigente de cada moneda (1 llamada).
 * @param {D1} db
 * @param {{ simbolo: string, calculadaEn: number, vela1h: number, senal: object }[]} senales
 */
export async function guardarSenales(db, senales) {
  if (senales.length === 0) return
  await db.batch(senales.map((s) => db.prepare(
    `INSERT INTO senales_actuales (simbolo, calculada_en, vela_1h, senal_json) VALUES (?, ?, ?, ?)
     ON CONFLICT (simbolo) DO UPDATE SET calculada_en = excluded.calculada_en, vela_1h = excluded.vela_1h,
       senal_json = excluded.senal_json`,
  ).bind(s.simbolo, s.calculadaEn, s.vela1h, JSON.stringify(s.senal))))
}

/** @param {D1} db @returns {Promise<Record<string, any>>} señal guardada por símbolo */
export async function senalesActuales(db) {
  const { results } = await db.prepare('SELECT simbolo, senal_json FROM senales_actuales').all()
  return Object.fromEntries(results.map((f) => [f.simbolo, JSON.parse(f.senal_json)]))
}

// ── Lecturas de la API ───────────────────────────────────────────────────────

/**
 * Último Fear & Greed guardado por una ejecución de mercado o manual (una búsqueda por tipo, 1 llamada).
 * @param {D1} db
 */
export async function ultimoFng(db) {
  const resultados = await db.batch(['mercado', 'manual'].map((t) => db.prepare(
    `SELECT id, inicio, detalle_json FROM ejecuciones WHERE tipo = ? AND json_extract(detalle_json, '$.fng') IS NOT NULL
     ORDER BY inicio DESC, id DESC LIMIT 1`,
  ).bind(t)))
  const fila = masReciente(resultados.map((r) => r.results[0]))
  return fila ? /** @type {import('./fuentes/fng.js').Fng} */ (JSON.parse(fila.detalle_json).fng) : null
}

/**
 * Último punto de capital y número de posiciones abiertas (1 llamada).
 * @param {D1} db @param {number} simulacionId
 */
export async function resumenBot(db, simulacionId) {
  const [capital, abiertas] = await db.batch([
    db.prepare('SELECT * FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1').bind(simulacionId),
    db.prepare("SELECT COUNT(*) AS n FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta'").bind(simulacionId),
  ])
  return { capital: capital.results[0] ?? null, abiertas: /** @type {number} */ (abiertas.results[0].n) }
}

/**
 * Las 2 lecturas de la curva para la interfaz (definición de referencia: submuestrearCurva de api.js):
 * todos los puntos de los últimos `horariaMs` y, antes, el último punto de cada día UTC, con una búsqueda por día.
 * Juntar sus resultados con unirCurva.
 * @param {D1} db @param {number} simulacionId @param {number} horariaMs
 */
function lecturasCurva(db, simulacionId, horariaMs) {
  const dia = 24 * HORA
  return [
    db.prepare(
      `SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital
       WHERE simulacion_id = ? AND vela_1h >= (SELECT vela_1h FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1) - ?
       ORDER BY vela_1h`,
    ).bind(simulacionId, simulacionId, horariaMs),
    db.prepare(
      `WITH RECURSIVE
         limites AS (
           SELECT s, d,
             (SELECT vela_1h FROM capital WHERE simulacion_id = s ORDER BY vela_1h LIMIT 1) AS primera,
             (SELECT vela_1h FROM capital WHERE simulacion_id = s ORDER BY vela_1h DESC LIMIT 1) - ? AS corte
           -- Enteros explícitos: un número enlazado puede llegar como REAL y primera / d no truncaría.
           FROM (SELECT ? AS s, CAST(? AS INTEGER) AS d)
         ),
         dias(fin) AS (
           SELECT (primera / d + 1) * d FROM limites WHERE primera IS NOT NULL
           UNION ALL SELECT fin + d FROM dias, limites WHERE fin < corte
         )
       SELECT c.vela_1h, c.valor_cartera, c.saldo, c.valor_hodl FROM dias, limites l JOIN capital c
         ON c.simulacion_id = l.s AND c.vela_1h = (SELECT vela_1h FROM capital
           WHERE simulacion_id = l.s AND vela_1h >= dias.fin - l.d AND vela_1h < dias.fin ORDER BY vela_1h DESC LIMIT 1)
       WHERE c.vela_1h < l.corte`,
    ).bind(horariaMs, simulacionId, dia),
  ]
}

/** Curva diaria (ordenada) seguida de la horaria. @param {{ results: any[] }} horaria @param {{ results: any[] }} diaria */
const unirCurva = (horaria, diaria) => [...diaria.results.sort((a, b) => a.vela_1h - b.vela_1h), ...horaria.results]

/**
 * Todo lo que necesita GET /api/bot (1 llamada), con lecturas acotadas:
 * - posiciones abiertas, cada una con `precio_actual` = precio de la última decisión con precio de su
 *   moneda (búsqueda por el índice único de decisiones, no un recorrido de la historia);
 * - operaciones (crecen con la actividad del bot, no con las horas);
 * - el último punto de capital, con el resumen acumulado de la curva (core/metricas.js `ResumenCurva`);
 * - la curva para la interfaz (lecturasCurva).
 * @param {D1} db @param {number} simulacionId @param {number} horariaMs
 */
export async function datosBot(db, simulacionId, horariaMs) {
  const [abiertas, operaciones, ultimo, horaria, diaria] = await db.batch([
    db.prepare(
      `SELECT p.*, (SELECT d.precio FROM decisiones d WHERE d.simulacion_id = p.simulacion_id AND d.simbolo = p.simbolo
         AND d.precio IS NOT NULL ORDER BY d.vela_1h DESC LIMIT 1) AS precio_actual
       FROM posiciones p WHERE p.simulacion_id = ? AND p.estado = 'abierta' ORDER BY p.id`,
    ).bind(simulacionId),
    db.prepare('SELECT lado, simbolo, comision, deslizamiento, pnl_neto FROM operaciones WHERE simulacion_id = ? ORDER BY id')
      .bind(simulacionId),
    db.prepare(
      `SELECT vela_1h, drawdown, drawdown_hodl, ultimo_hodl,
         (SELECT vela_1h FROM capital WHERE simulacion_id = ? ORDER BY vela_1h LIMIT 1) AS primera
       FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1`,
    ).bind(simulacionId, simulacionId),
    ...lecturasCurva(db, simulacionId, horariaMs),
  ])
  const u = ultimo.results[0]
  /** @type {import('../../core/metricas.js').ResumenCurva} */
  const resumenCurva = u
    ? { ultimoHodl: u.ultimo_hodl, drawdownMaximo: u.drawdown, drawdownMaximoHodl: u.drawdown_hodl, duracion: u.vela_1h - u.primera }
    : { ultimoHodl: null, drawdownMaximo: 0, drawdownMaximoHodl: null, duracion: 0 }
  return {
    abiertas: abiertas.results,
    operaciones: operaciones.results,
    resumenCurva,
    curva: unirCurva(horaria, diaria),
  }
}

/**
 * Lo que necesita GET /api/bot/comparativa de cada simulación, en 1 llamada (lote de 4 lecturas acotadas por
 * simulación), en el orden de `ids`: el último punto de capital (valor, drawdown acumulado y los del HODL),
 * el número de operaciones (índice operaciones(simulacion_id)) y la curva para la interfaz (lecturasCurva).
 * @param {D1} db @param {number[]} ids @param {number} horariaMs
 * @returns {Promise<{ ultimo: any|null, operaciones: number, curva: any[] }[]>}
 */
export async function datosComparativa(db, ids, horariaMs) {
  if (ids.length === 0) return []
  const resultados = await db.batch(ids.flatMap((id) => [
    db.prepare(
      `SELECT vela_1h, valor_cartera, valor_hodl, drawdown, drawdown_hodl, ultimo_hodl FROM capital
       WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1`,
    ).bind(id),
    db.prepare('SELECT COUNT(*) AS n FROM operaciones WHERE simulacion_id = ?').bind(id),
    ...lecturasCurva(db, id, horariaMs),
  ]))
  return ids.map((_, i) => {
    const [ultimo, operaciones, horaria, diaria] = resultados.slice(4 * i, 4 * i + 4)
    return { ultimo: ultimo.results[0] ?? null, operaciones: /** @type {number} */ (operaciones.results[0].n), curva: unirCurva(horaria, diaria) }
  })
}

/**
 * Titulares de una moneda o de MERCADO en (desde, hasta], los más recientes primero.
 * @param {D1} db @param {string} simbolo @param {number} desde @param {number} hasta @param {number} limite
 */
export async function titularesDeMoneda(db, simbolo, desde, hasta, limite) {
  return (await db.prepare(
    `SELECT * FROM titulares WHERE publicado_en > ? AND publicado_en <= ?
       AND (monedas_json LIKE ? OR monedas_json LIKE '%"MERCADO"%') ORDER BY publicado_en DESC LIMIT ?`,
  ).bind(desde, hasta, `%"${simbolo}"%`, limite).all()).results
}

/**
 * Página de una tabla por id descendente. Pide limite + 1 filas para saber si hay más.
 * @param {D1} db @param {'decisiones'|'operaciones'} tabla
 * @param {{ simulacionId: number, simbolo: string|null, cursor: number|null, limite: number }} filtro
 * @returns {Promise<{ filas: any[], siguienteCursor: number|null }>}
 */
export async function pagina(db, tabla, { simulacionId, simbolo, cursor, limite }) {
  // Solo los filtros presentes, para que el plan use el índice que ya viene ordenado por id.
  const condiciones = ['simulacion_id = ?']
  /** @type {(number|string)[]} */
  const valores = [simulacionId]
  if (simbolo !== null) condiciones.push('simbolo = ?') && valores.push(simbolo)
  if (cursor !== null) condiciones.push('id < ?') && valores.push(cursor)
  const { results } = await db.prepare(
    `SELECT * FROM ${tabla} WHERE ${condiciones.join(' AND ')} ORDER BY id DESC LIMIT ?`,
  ).bind(...valores, limite + 1).all()
  const filas = results.slice(0, limite)
  return { filas, siguienteCursor: results.length > limite ? filas[filas.length - 1].id : null }
}

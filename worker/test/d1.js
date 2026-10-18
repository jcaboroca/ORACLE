// @ts-check
// D1 simulado sobre node:sqlite, solo para tests: misma API que usa el Worker
// (prepare/bind/first/all/run y batch atómico) y las mismas migraciones.
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const MIGRACIONES = new URL('../migrations/', import.meta.url)
const DEVUELVE_FILAS = /^\s*(select|with|pragma)\b|\breturning\b/i

/** @typedef {null|number|string} Valor */
/** @typedef {{ results: Record<string, any>[], success: true, meta: { changes: number, last_row_id: number } }} Resultado */

export class Sentencia {
  /** @param {DatabaseSync} db @param {string} sql @param {Valor[]} valores */
  constructor(db, sql, valores = []) {
    this.db = db
    this.sql = sql
    this.valores = valores
  }

  /** @param {...Valor} valores */
  bind(...valores) {
    return new Sentencia(this.db, this.sql, valores)
  }

  /** Ejecuta de forma síncrona (lo usa batch dentro de su transacción). @returns {Resultado} */
  ejecutar() {
    const sentencia = this.db.prepare(this.sql)
    if (DEVUELVE_FILAS.test(this.sql)) {
      const filas = sentencia.all(...this.valores).map((f) => ({ ...f }))
      return { results: filas, success: true, meta: { changes: 0, last_row_id: 0 } }
    }
    const r = sentencia.run(...this.valores)
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }

  /** @param {string} [columna] */
  async first(columna) {
    const fila = this.ejecutar().results[0] ?? null
    if (fila === null || columna === undefined) return fila
    return fila[columna] ?? null
  }

  async all() {
    return this.ejecutar()
  }

  async run() {
    return this.ejecutar()
  }
}

/** Espera a la siguiente vuelta del bucle de eventos, como un viaje de ida y vuelta a D1. */
const viaje = () => new Promise((resolver) => setImmediate(resolver))

/**
 * Base de datos en memoria con todas las migraciones de worker/migrations aplicadas en orden.
 * `llamadas` cuenta las llamadas a D1 (first/all/run/batch), como las cuenta Cloudflare.
 * latencia: cada llamada cede el turno antes de ejecutarse (como la red de D1), así las peticiones
 * en paralelo se intercalan entre llamadas y los tests pueden reproducir carreras de leer-y-escribir.
 * Cada sentencia o lote sigue siendo atómico, como en D1.
 * @param {{ latencia?: boolean }} [opciones]
 */
export function crearD1({ latencia = false } = {}) {
  const sqlite = new DatabaseSync(':memory:')
  for (const archivo of readdirSync(MIGRACIONES).filter((a) => a.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(archivo, MIGRACIONES), 'utf8'))
  }
  const d1 = {
    sqlite,
    llamadas: 0,
    latencia,
    /** @param {string} sql */
    prepare(sql) {
      const base = new Sentencia(sqlite, sql)
      return contar(base, d1)
    },
    /** Todas o ninguna: cualquier error revierte el lote completo. @param {Sentencia[]} sentencias */
    async batch(sentencias) {
      d1.llamadas++
      if (d1.latencia) await viaje()
      sqlite.exec('BEGIN')
      try {
        const resultados = sentencias.map((s) => s.ejecutar())
        sqlite.exec('COMMIT')
        return resultados
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    /** @param {string} sql */
    async exec(sql) {
      d1.llamadas++
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
  return d1
}

/**
 * Envuelve una sentencia para que first/all/run sumen una llamada (bind conserva el contador).
 * @param {Sentencia} sentencia
 * @param {{ llamadas: number, latencia: boolean }} d1
 * @returns {Sentencia}
 */
function contar(sentencia, d1) {
  const envuelta = Object.create(sentencia)
  envuelta.bind = (/** @type {Valor[]} */ ...valores) => contar(sentencia.bind(...valores), d1)
  for (const metodo of /** @type {const} */ (['first', 'all', 'run'])) {
    envuelta[metodo] = async (/** @type {any[]} */ ...args) => {
      d1.llamadas++
      if (d1.latencia) await viaje()
      return /** @type {any} */ (sentencia)[metodo](...args)
    }
  }
  return envuelta
}

/** @typedef {ReturnType<typeof crearD1>} D1Simulado */

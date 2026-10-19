// @ts-check
// Ayudantes de los tests de la PWA: el Worker real (api.js sobre D1 simulado y el escenario sintético
// de sus tests) como fetch, para comprobar el «Contrato de la API» con respuestas de verdad. Solo tests.
import { atender } from '../../worker/src/api.js'
import { ejecutarMercado } from '../../worker/src/ejecuciones/mercado.js'
import { crearSimulacion } from '../../worker/src/repositorio.js'
import { crearD1 } from '../../worker/test/d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from '../../worker/test/escenario.js'

export const PIN = '4815162342'
export const BASE = 'https://oracle.test.workers.dev'
export const HORAS = 6

/**
 * Worker con `HORAS` horas del escenario ejecutadas (BTC cierra por stop, ETH por take-profit).
 * Devuelve un fetch que atiende la PWA con ese Worker en el instante `ahora`.
 * @param {{ ahora?: number, ip?: string }} [op]
 */
export async function workerSimulado({ ahora = ahoraDe(HORAS), ip = '10.0.0.1' } = {}) {
  const db = crearD1()
  const escenario = crearEscenario()
  const env = { DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: 'http://localhost:8080' }
  await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
  for (let k = 0; k < HORAS; k++) {
    await ejecutarMercado({ env, fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k), esperar: sinEspera })
  }
  /** @type {{ url: string, init: RequestInit|undefined }[]} */
  const llamadas = []
  /** @type {typeof fetch} */
  const fetch = async (entrada, init) => {
    const url = String(entrada)
    llamadas.push({ url, init })
    const cabeceras = new Headers(init?.headers)
    cabeceras.set('CF-Connecting-IP', ip)
    const peticion = new Request(url, { ...init, headers: cabeceras })
    return atender(peticion, { env, fetch: fetchEscenario(escenario, ahora), ahora, esperar: sinEspera })
  }
  return { db, env, ahora, fetch, llamadas }
}

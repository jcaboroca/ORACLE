// @ts-check
// Ayudantes de los tests del Worker: fetch simulado y fixtures grabados. Solo para tests.
import { readFileSync } from 'node:fs'

const FIXTURES = new URL('../../test/fixtures/', import.meta.url)

/** Contenido de test/fixtures/<nombre> como texto. @param {string} nombre */
export const fixtureTexto = (nombre) => readFileSync(new URL(nombre, FIXTURES), 'utf8')

/** Contenido de test/fixtures/<nombre> como JSON. @param {string} nombre */
export const fixtureJson = (nombre) => JSON.parse(fixtureTexto(nombre))

/**
 * @typedef {{ estado?: number, cuerpo?: unknown, error?: Error }} RespuestaSimulada
 * cuerpo: string se envía tal cual; cualquier otra cosa, como JSON. error: el fetch lanza (red caída).
 */

/**
 * fetch simulado: `responder(url, init)` decide la respuesta; `llamadas` guarda cada petición.
 * @param {(url: string, init: RequestInit|undefined) => RespuestaSimulada} responder
 */
export function simularFetch(responder) {
  /** @type {{ url: string, init: RequestInit|undefined }[]} */
  const llamadas = []
  /** @param {string|URL|Request} entrada @param {RequestInit} [init] */
  const fetch = async (entrada, init) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada)
    llamadas.push({ url, init })
    const r = responder(url, init)
    if (r.error) throw r.error
    const cuerpo = typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo ?? null)
    return new Response(cuerpo, { status: r.estado ?? 200 })
  }
  return Object.assign(fetch, { llamadas })
}

/**
 * Velas → filas de /api/v3/klines (mismo formato que devuelve Binance).
 * @param {import('../../core/velas.js').Vela[]} velas
 */
export function aFilasBinance(velas) {
  return velas.map((v) => [
    v.inicio, String(v.apertura), String(v.maximo), String(v.minimo), String(v.cierre), String(v.volumen),
    v.fin - 1, '0', 0, '0', '0', '0',
  ])
}

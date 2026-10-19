// @ts-check
// Cron `1 * * * *` (spec §5): RSS + Reddit → titulares nuevos → LLM en lotes de 25 → purga.
// Subpeticiones externas: 14 RSS + 3 Reddit + hasta 2 LLM (Groq, Gemini) por lote × 4 lotes = 25. Llamadas a D1: 6.
import { normalizarTexto } from '../../../core/lexico.js'
import { HORA } from '../../../core/velas.js'
import { leerMonedas } from '../config.js'
import { puntuarTitulares } from '../fuentes/llm.js'
import { descargarReddit } from '../fuentes/reddit.js'
import { descargarFeeds } from '../fuentes/rss.js'
import {
  finalizarEjecucion, guardarPuntuaciones, iniciarEjecucion, insertarTitulares, purgar, titularesSinPuntuar,
} from '../repositorio.js'

/** @typedef {import('../fuentes/rss.js').TitularCrudo} TitularCrudo */

/** Solo se guardan titulares de las últimas 48 h. */
export const VENTANA_MS = 48 * HORA
/** Fechas de hasta 1 h en el futuro se aceptan (relojes de los feeds). */
export const TOLERANCIA_FUTURO_MS = HORA
/** Titulares al LLM por ejecución (4 llamadas de 25); los que no entren se puntúan en la ejecución siguiente. */
export const LOTE_LLM = 80
/**
 * La estrategia solo usa las últimas 24 h: no merece la pena puntuar lo más antiguo. Los titulares de 24-48 h
 * se guardan (para deduplicar) pero se quedan sin puntuar a propósito: `puntuacion` y `motor` NULL.
 */
export const VENTANA_PUNTUAR_MS = 24 * HORA

/**
 * Id de un titular: SHA-256 (hex, 32 caracteres) del título normalizado. Mismo título en dos feeds = mismo id.
 * @param {string} titulo
 */
export async function idTitular(titulo) {
  const datos = new TextEncoder().encode(normalizarTexto(titulo).trim())
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos))
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Normaliza, descarta los de fuera de la ventana y deduplica por id (gana el primero visto).
 * @param {TitularCrudo[]} crudos
 * @param {number} ahora
 */
export async function prepararTitulares(crudos, ahora) {
  /** @type {Map<string, TitularCrudo & { id: string }>} */
  const unicos = new Map()
  for (const t of crudos) {
    if (t.publicadoEn < ahora - VENTANA_MS || t.publicadoEn > ahora + TOLERANCIA_FUTURO_MS) continue
    if (normalizarTexto(t.titulo).trim().length < 3) continue
    const id = await idTitular(t.titulo)
    if (!unicos.has(id)) unicos.set(id, { ...t, id })
  }
  return [...unicos.values()]
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number }} deps
 */
export async function ejecutarNoticias({ env, fetch, ahora }) {
  const db = env.DB
  const id = await iniciarEjecucion(db, 'noticias', ahora)
  /** @type {string[]} */
  const fallos = []
  const resumen = { descargados: 0, nuevos: 0, puntuados: 0, /** @type {Record<string, number>} */ motores: {} }
  try {
    const [rss, reddit] = await Promise.all([descargarFeeds(fetch), descargarReddit(fetch)])
    fallos.push(...rss.fallos, ...reddit.fallos)
    const titulares = await prepararTitulares([...rss.titulares, ...reddit.titulares], ahora)
    resumen.descargados = titulares.length
    resumen.nuevos = await insertarTitulares(db, titulares)
    const pendientes = await titularesSinPuntuar(db, ahora - VENTANA_PUNTUAR_MS, LOTE_LLM)
    const { resultados, fallos: fallosLlm } = await puntuarTitulares({ env, fetch, titulares: pendientes, monedas: leerMonedas(env.MONEDAS) })
    fallos.push(...fallosLlm)
    await guardarPuntuaciones(db, resultados)
    resumen.puntuados = pendientes.length
    for (const r of Object.values(resultados)) resumen.motores[r.motor] = (resumen.motores[r.motor] ?? 0) + 1
    await purgar(db, ahora)
    await finalizarEjecucion(db, id, { fin: Date.now(), ok: true, detalle: { fallos, ...resumen } })
    return { id, ok: true, fallos, ...resumen }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await finalizarEjecucion(db, id, { fin: Date.now(), ok: false, detalle: { fallos, error, ...resumen } })
    return { id, ok: false, fallos, error, ...resumen }
  }
}

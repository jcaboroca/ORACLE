// @ts-check
// Qué ejecución corresponde a cada cron de wrangler.toml. Vive fuera de index.js porque el módulo
// principal de un Worker solo puede exportar manejadores: cualquier otra exportación rompe el arranque.
import { ejecutarMercado } from './ejecuciones/mercado.js'
import { ejecutarNoticias } from './ejecuciones/noticias.js'

export const CRON_NOTICIAS = '1 * * * *'
export const CRON_MERCADO = '3 * * * *'

/**
 * @param {string} cron expresión del trigger que ha saltado
 * @param {{ env: any, fetch: typeof fetch, ahora: number }} deps
 */
export function programado(cron, deps) {
  if (cron === CRON_NOTICIAS) return ejecutarNoticias(deps)
  if (cron === CRON_MERCADO) return ejecutarMercado(deps)
  return Promise.reject(new Error(`Cron desconocido: ${cron}`))
}

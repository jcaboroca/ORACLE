// @ts-check
// Dónde está la API del Worker. Es el único archivo que cambia al desplegar.

/** URL del Worker desplegado, sin barra final. Vacía, la app avisa de que falta y no pide datos. */
export const API_PRODUCCION = 'https://oracle.mundialisimo.workers.dev'

/** `npx wrangler@4 dev` escucha aquí. */
export const API_LOCAL = 'http://localhost:8787'

/**
 * Base de la API según dónde se abra la PWA: en localhost, el Worker local; si no, el desplegado.
 * @param {{ hostname: string }} ubicacion
 * @param {string} [produccion]
 */
export function baseApi(ubicacion, produccion = API_PRODUCCION) {
  const local = ubicacion.hostname === 'localhost' || ubicacion.hostname === '127.0.0.1'
  return (local ? API_LOCAL : produccion).replace(/\/+$/, '')
}

// @ts-check
// Lectura de las vars de wrangler.toml. Valores por defecto = los de la spec.

export const MONEDAS_POR_DEFECTO = Object.freeze(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'])
export const CAPITAL_POR_DEFECTO = 10_000

/**
 * "BTC, eth,SOL" → ['BTC', 'ETH', 'SOL']. Descarta lo que no parezca un símbolo y los repetidos.
 * @param {string|undefined} texto
 */
export function leerMonedas(texto) {
  if (!texto) return [...MONEDAS_POR_DEFECTO]
  const monedas = [...new Set(texto.split(',').map((m) => m.trim().toUpperCase()).filter((m) => /^[A-Z0-9]{2,10}$/.test(m)))]
  return monedas.length > 0 ? monedas : [...MONEDAS_POR_DEFECTO]
}

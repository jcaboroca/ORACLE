// @ts-check
// Índice Fear & Greed de alternative.me (1 subpetición). Opcional: si falla, el componente queda ausente.

export const FNG = 'https://api.alternative.me/fng/?limit=1'

/** @typedef {{ valor: number, clasificacion: string, t: number }} Fng */

/**
 * @param {unknown} json
 * @returns {Fng}
 */
export function leerFng(json) {
  const dato = /** @type {any} */ (json)?.data?.[0]
  const valor = Number(dato?.value)
  const t = Number(dato?.timestamp) * 1000
  if (!Number.isInteger(valor) || valor < 0 || valor > 100) throw new TypeError('fng: valor no válido')
  if (!Number.isFinite(t) || t <= 0) throw new TypeError('fng: fecha no válida')
  return { valor, clasificacion: typeof dato.value_classification === 'string' ? dato.value_classification : '', t }
}

/**
 * @param {typeof fetch} fetch
 * @returns {Promise<Fng>}
 */
export async function descargarFng(fetch) {
  const res = await fetch(FNG)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return leerFng(await res.json())
}

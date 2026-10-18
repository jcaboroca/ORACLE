// @ts-check
// Derivados de Binance Futures (opcionales: fapi responde 451 desde algunas regiones).
// 3·n subpeticiones: premiumIndex, long/short y open interest por moneda. El premiumIndex se pide por símbolo:
// la respuesta de todo el exchange pesa ~200 KB y parsearla gastaba CPU de la ejecución (spec §9).

/** @typedef {import('../../../core/estrategia-v1.js').Derivados} Derivados */
/** @typedef {{ funding: number|null, ratioLongShort: number|null, oiCambio24h: number|null }} DerivadosBase */

export const FAPI = 'https://fapi.binance.com'

/** @param {unknown} x */
const numero = (x) => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : typeof x === 'number' ? x : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Funding por 8 h (fracción) de una moneda a partir de /fapi/v1/premiumIndex?symbol={SYM}USDT.
 * @param {unknown} json
 * @param {string} simbolo
 * @returns {number}
 */
export function leerFunding(json, simbolo) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new TypeError('premiumIndex: la respuesta no es un objeto')
  const fila = /** @type {Record<string, unknown>} */ (json)
  if (fila.symbol !== `${simbolo}USDT`) throw new TypeError('premiumIndex: respuesta de otra moneda')
  const funding = numero(fila.lastFundingRate)
  if (funding === null) throw new TypeError('premiumIndex: funding no válido')
  return funding
}

/**
 * Último ratio de cuentas long/short (globalLongShortAccountRatio).
 * @param {unknown} json
 */
export function leerLongShort(json) {
  if (!Array.isArray(json) || json.length === 0) throw new TypeError('longShort: lista vacía o no válida')
  const ratio = numero(json[json.length - 1]?.longShortRatio)
  if (ratio === null || ratio <= 0) throw new TypeError('longShort: ratio no válido')
  return ratio
}

/**
 * Cambio del open interest (en contratos) en 24 h: último punto frente al de 24 puntos horarios antes.
 * @param {unknown} json respuesta de openInterestHist con period=1h y limit=25
 */
export function leerOpenInterest(json) {
  if (!Array.isArray(json) || json.length < 25) throw new TypeError('openInterest: faltan puntos')
  const ultimo = json[json.length - 1]
  const previo = json[json.length - 25]
  const actual = numero(ultimo?.sumOpenInterest)
  const antes = numero(previo?.sumOpenInterest)
  if (actual === null || antes === null || antes <= 0) throw new TypeError('openInterest: valor no válido')
  if (numero(ultimo.timestamp) !== /** @type {number} */ (numero(previo.timestamp)) + 24 * 3_600_000) {
    throw new TypeError('openInterest: los puntos no abarcan 24 h')
  }
  return actual / antes - 1
}

/**
 * @param {typeof fetch} fetch
 * @param {string} url
 */
async function pedirJson(fetch, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * @param {typeof fetch} fetch
 * @param {string[]} simbolos
 * @returns {Promise<{ base: Record<string, DerivadosBase>, fallos: string[] }>}
 */
export async function descargarDerivados(fetch, simbolos) {
  /** @type {string[]} */
  const fallos = []
  const porMoneda = await Promise.allSettled(simbolos.flatMap((s) => [
    pedirJson(fetch, `${FAPI}/fapi/v1/premiumIndex?symbol=${s}USDT`).then((j) => leerFunding(j, s)),
    pedirJson(fetch, `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${s}USDT&period=1h&limit=1`).then(leerLongShort),
    pedirJson(fetch, `${FAPI}/futures/data/openInterestHist?symbol=${s}USDT&period=1h&limit=25`).then(leerOpenInterest),
  ]))
  /** @type {Record<string, DerivadosBase>} */
  const base = {}
  simbolos.forEach((s, i) => {
    const [funding, ls, oi] = porMoneda.slice(3 * i, 3 * i + 3)
    if (funding.status === 'rejected') fallos.push(`derivados funding ${s}: ${mensaje(funding.reason)}`)
    if (ls.status === 'rejected') fallos.push(`derivados long/short ${s}: ${mensaje(ls.reason)}`)
    if (oi.status === 'rejected') fallos.push(`derivados open interest ${s}: ${mensaje(oi.reason)}`)
    base[s] = {
      funding: funding.status === 'fulfilled' ? funding.value : null,
      ratioLongShort: ls.status === 'fulfilled' ? ls.value : null,
      oiCambio24h: oi.status === 'fulfilled' ? oi.value : null,
    }
  })
  return { base, fallos }
}

/**
 * Derivados para la estrategia: añade el cambio de precio 24 h (USDT). null si no hay ningún dato de derivados.
 * @param {DerivadosBase|undefined} base
 * @param {number|null} precioCambio24h
 * @returns {Derivados|null}
 */
export function completarDerivados(base, precioCambio24h) {
  if (!base || (base.funding === null && base.ratioLongShort === null && base.oiCambio24h === null)) return null
  return { ...base, precioCambio24h }
}

// @ts-check
// Derivados del perpetuo {SYM}-USDT-SWAP de OKX (opcionales: si fallan, el componente queda ausente).
// 3·n subpeticiones: funding, long/short de cuentas y open interest horario. Las dos últimas son
// estadísticas «rubik» (límite estricto por IP): el cliente de okx.js las hace de una en una.

/** @typedef {import('../../../core/estrategia-v1.js').Derivados} Derivados */
/** @typedef {{ funding: number|null, ratioLongShort: number|null, oiCambio24h: number|null }} DerivadosBase */
/** @typedef {import('./okx.js').ClienteOkx} ClienteOkx */

export const RUTA_FUNDING = '/api/v5/public/funding-rate'
export const RUTA_LONG_SHORT = '/api/v5/rubik/stat/contracts/long-short-account-ratio-contract'
export const RUTA_OPEN_INTEREST = '/api/v5/rubik/stat/contracts/open-interest-history'

/** @param {string} simbolo */
const perpetuo = (simbolo) => `${simbolo}-USDT-SWAP`

/** @param {unknown} x */
const numero = (x) => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : typeof x === 'number' ? x : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Funding por 8 h (fracción) del periodo en curso, de /public/funding-rate?instId={SYM}-USDT-SWAP.
 * @param {unknown[]} datos campo `data`
 * @param {string} simbolo
 * @returns {number}
 */
export function leerFunding(datos, simbolo) {
  const fila = /** @type {Record<string, unknown>|undefined} */ (Array.isArray(datos) ? datos[0] : undefined)
  if (!fila || typeof fila !== 'object') throw new TypeError('funding: funding no válido')
  if (fila.instId !== perpetuo(simbolo)) throw new TypeError('funding: respuesta de otra moneda')
  const funding = numero(fila.fundingRate)
  if (funding === null) throw new TypeError('funding: funding no válido')
  return funding
}

/**
 * Último ratio de cuentas long/short del perpetuo ([ts, ratio], el más reciente primero).
 * @param {unknown[]} datos
 */
export function leerLongShort(datos) {
  if (!Array.isArray(datos) || datos.length === 0) throw new TypeError('longShort: lista vacía o no válida')
  const ratio = numero(/** @type {any} */ (datos[0])?.[1])
  if (ratio === null || ratio <= 0) throw new TypeError('longShort: ratio no válido')
  return ratio
}

/**
 * Cambio del open interest en monedas (oiCcy) en 24 h: punto más reciente frente al de 24 puntos horarios
 * antes. Filas [ts, oi en contratos, oi en monedas, oi en USD], la más reciente primero. Se usan monedas y
 * no USD para que el cambio de precio no se cuele en el del open interest.
 * @param {unknown[]} datos respuesta de open-interest-history con period=1H y limit=25
 */
export function leerOpenInterest(datos) {
  if (!Array.isArray(datos) || datos.length < 25) throw new TypeError('openInterest: faltan puntos')
  const ultimo = /** @type {any} */ (datos[0])
  const previo = /** @type {any} */ (datos[24])
  const actual = numero(ultimo?.[2])
  const antes = numero(previo?.[2])
  if (actual === null || antes === null || actual < 0 || antes <= 0) throw new TypeError('openInterest: valor no válido')
  if (numero(ultimo[0]) !== /** @type {number} */ (numero(previo[0])) + 24 * 3_600_000) {
    throw new TypeError('openInterest: los puntos no abarcan 24 h')
  }
  return actual / antes - 1
}

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * Nunca lanza: lo que falla queda null y se anota.
 * @param {ClienteOkx} cliente
 * @param {string[]} simbolos
 * @returns {Promise<{ base: Record<string, DerivadosBase>, fallos: string[] }>}
 */
export async function descargarDerivados(cliente, simbolos) {
  /** @type {string[]} */
  const fallos = []
  const porMoneda = await Promise.allSettled(simbolos.flatMap((s) => [
    cliente.pedir(`${RUTA_FUNDING}?instId=${perpetuo(s)}`).then((d) => leerFunding(d, s)),
    cliente.pedir(`${RUTA_LONG_SHORT}?instId=${perpetuo(s)}&period=1H&limit=1`).then(leerLongShort),
    cliente.pedir(`${RUTA_OPEN_INTEREST}?instId=${perpetuo(s)}&period=1H&limit=25`).then(leerOpenInterest),
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

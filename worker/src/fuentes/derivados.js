// @ts-check
// Derivados del perpetuo {SYM}-USDT-SWAP de OKX (opcionales: si fallan, el componente queda ausente).
// Funding, long/short de cuentas y open interest horario. El funding se liquida cada 8 h: se guarda en D1
// (cache_funding) y se pide como mucho cada FUNDING_VIGENCIA_MS. Long/short y open interest, cada hora: son
// estadísticas «rubik» (límite estricto por IP) y el cliente de okx.js las hace de una en una.
// Subpeticiones: 2·n rubik + los funding que toque refrescar (0-n).

/** @typedef {import('../../../core/estrategia-v1.js').Derivados} Derivados */
/** @typedef {{ funding: number|null, ratioLongShort: number|null, oiCambio24h: number|null }} DerivadosBase */
/** @typedef {import('./okx.js').ClienteOkx} ClienteOkx */
/** @typedef {{ valor: number, actualizadoEn: number }} FundingGuardado */

/** El funding guardado se usa sin pedirlo durante 8 h (un periodo de liquidación). */
export const FUNDING_VIGENCIA_MS = 8 * 3_600_000
/** Si al refrescarlo falla, el guardado vale todavía hasta 24 h después de pedirlo. */
export const FUNDING_CADUCIDAD_MS = 24 * 3_600_000

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
 * Monedas cuyo funding hay que pedir: sin guardar, guardado hace 8 h o más (o con fecha futura).
 * @param {string[]} simbolos
 * @param {Record<string, FundingGuardado>} guardado
 * @param {number} ahora
 */
export function fundingAPedir(simbolos, guardado, ahora) {
  return simbolos.filter((s) => {
    const g = guardado[s]
    return !g || !(ahora >= g.actualizadoEn && ahora - g.actualizadoEn < FUNDING_VIGENCIA_MS)
  })
}

/**
 * Nunca lanza: lo que falla queda null y se anota (el funding que falla usa el guardado si tiene < 24 h).
 * @param {ClienteOkx} cliente
 * @param {string[]} simbolos
 * @param {{ funding?: Record<string, FundingGuardado>, ahora?: number }} [cache] funding guardado en D1
 * @returns {Promise<{ base: Record<string, DerivadosBase>, fallos: string[], fundingNuevo: Record<string, number> }>}
 */
export async function descargarDerivados(cliente, simbolos, { funding: guardado = {}, ahora = 0 } = {}) {
  /** @type {string[]} */
  const fallos = []
  const pedir = new Set(fundingAPedir(simbolos, guardado, ahora))
  const porMoneda = await Promise.allSettled(simbolos.flatMap((s) => [
    pedir.has(s)
      ? cliente.pedir(`${RUTA_FUNDING}?instId=${perpetuo(s)}`).then((d) => leerFunding(d, s))
      : Promise.resolve(guardado[s].valor),
    cliente.pedir(`${RUTA_LONG_SHORT}?instId=${perpetuo(s)}&period=1H&limit=1`).then(leerLongShort),
    cliente.pedir(`${RUTA_OPEN_INTEREST}?instId=${perpetuo(s)}&period=1H&limit=25`).then(leerOpenInterest),
  ]))
  /** @type {Record<string, DerivadosBase>} */
  const base = {}
  /** @type {Record<string, number>} */
  const fundingNuevo = {}
  simbolos.forEach((s, i) => {
    const [f, ls, oi] = porMoneda.slice(3 * i, 3 * i + 3)
    /** @type {number|null} */
    let valorFunding = null
    if (f.status === 'fulfilled') {
      valorFunding = f.value
      if (pedir.has(s)) fundingNuevo[s] = f.value
    } else {
      fallos.push(`derivados funding ${s}: ${mensaje(f.reason)}`)
      const g = guardado[s]
      if (g && ahora >= g.actualizadoEn && ahora - g.actualizadoEn < FUNDING_CADUCIDAD_MS) valorFunding = g.valor
    }
    if (ls.status === 'rejected') fallos.push(`derivados long/short ${s}: ${mensaje(ls.reason)}`)
    if (oi.status === 'rejected') fallos.push(`derivados open interest ${s}: ${mensaje(oi.reason)}`)
    base[s] = {
      funding: valorFunding,
      ratioLongShort: ls.status === 'fulfilled' ? ls.value : null,
      oiCambio24h: oi.status === 'fulfilled' ? oi.value : null,
    }
  })
  return { base, fallos, fundingNuevo }
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

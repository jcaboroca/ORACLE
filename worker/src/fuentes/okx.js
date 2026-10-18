// @ts-check
// Velas de OKX (API pública v5) y cliente con límite de ritmo para todas las peticiones a OKX.
// Desde la red de Cloudflare todos los dominios de Binance responden 403; OKX no. Cada fila se valida
// mientras se convierte (una sola pasada: el parseo es lo que más CPU gasta de la ejecución, spec §9).
import { DURACION, VENTANA, cerradasHasta } from '../../../core/velas.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */
/** @typedef {'1h'|'4h'|'1d'} Intervalo */

export const OKX = 'https://www.okx.com'
const RUTA_VELAS = '/api/v5/market/candles'
export const VELAS = `${OKX}${RUTA_VELAS}`
/** Barras de OKX: '1Dutc' es el día UTC (como Binance y el backtest); '1D' sería el día de Hong Kong. */
export const BARRAS = /** @type {const} */ ({ '1h': '1H', '4h': '4H', '1d': '1Dutc' })
/** OKX sirve como mucho 300 velas, incluida la que sigue abierta: quedan VENTANA (299) cerradas. */
export const LIMITE_VELAS = VENTANA + 1
/**
 * Velas 1H EUR que se piden (47 cerradas + la vela en curso): bastan para el cambio 24 h (25 cerradas) y para
 * recuperar los stops de ~2 días de ejecuciones perdidas. Con un hueco mayor de 47 h sin ejecuciones, las
 * velas más antiguas del hueco no se revisan (spec §7.4 y §13).
 */
export const LIMITE_EUR = 48

/** Peticiones a OKX en vuelo a la vez, como mucho. */
export const CONCURRENCIA = 4
/** Pausa entre peticiones rubik (estadísticas de contratos: ~5 cada 2 s por IP, y Cloudflare comparte IPs). */
export const ESPACIADO_RUBIK_MS = 450
/** Pausa antes del único reintento de una petición limitada (HTTP 429 o código 50011). */
export const PAUSA_REINTENTO_MS = 1200
/** Reintentos por ejecución entre todas las peticiones: 35 a OKX + 6 + F&G + 2 LLM = 44 ≤ 50 subpeticiones. */
export const MAX_REINTENTOS = 6
const CODIGO_LIMITE = '50011'

/** @param {number} ms */
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * @param {string} mensaje
 * @param {boolean} limite la petición se rechazó por límite de ritmo (se puede reintentar)
 */
const errorOkx = (mensaje, limite) => Object.assign(new Error(mensaje), { limite })

/**
 * Una petición a OKX. El cuerpo se lee siempre entero (también en los errores, que son pequeños).
 * HTTP no 2xx, JSON ilegible o code ≠ "0" → excepción con el estado HTTP o el código de OKX.
 * @param {typeof fetch} fetch
 * @param {string} url
 * @returns {Promise<unknown[]>} el campo `data`
 */
async function pedirOkx(fetch, url) {
  const res = await fetch(url)
  const texto = await res.text()
  /** @type {any} */
  let json = null
  try {
    json = JSON.parse(texto)
  } catch {
    // Se informa abajo según el estado HTTP.
  }
  const codigo = typeof json?.code === 'string' ? json.code : null
  const limite = res.status === 429 || codigo === CODIGO_LIMITE
  if (!res.ok) throw errorOkx(`HTTP ${res.status}${codigo && codigo !== '0' ? ` (código ${codigo})` : ''}`, limite)
  if (json === null || typeof json !== 'object') throw errorOkx('OKX: la respuesta no es JSON', false)
  if (codigo !== '0') throw errorOkx(`OKX código ${codigo ?? '?'}${json.msg ? `: ${json.msg}` : ''}`, limite)
  if (!Array.isArray(json.data)) throw errorOkx('OKX: respuesta sin lista de datos', false)
  return json.data
}

/**
 * Cliente de OKX para una ejecución: como mucho CONCURRENCIA peticiones en vuelo; las rubik, de una en una
 * y separadas ESPACIADO_RUBIK_MS; una petición limitada (429/50011) se reintenta una vez tras
 * PAUSA_REINTENTO_MS, con MAX_REINTENTOS en total para no pasar de 50 subpeticiones.
 * @param {typeof fetch} fetch
 * @param {{ esperar?: (ms: number) => Promise<void>, concurrencia?: number, espaciadoRubik?: number,
 *   pausaReintento?: number, maxReintentos?: number }} [opciones] esperar: inyectable en los tests.
 */
export function crearCliente(fetch, {
  esperar = esperarMs, concurrencia = CONCURRENCIA, espaciadoRubik = ESPACIADO_RUBIK_MS,
  pausaReintento = PAUSA_REINTENTO_MS, maxReintentos = MAX_REINTENTOS,
} = {}) {
  let enVuelo = 0
  /** @type {(() => void)[]} */
  const cola = []
  let reintentos = 0
  let rubikPedidas = 0
  /** @type {Promise<unknown>} */
  let turnoRubik = Promise.resolve()

  const adquirir = () => {
    if (enVuelo < concurrencia) {
      enVuelo++
      return Promise.resolve()
    }
    return new Promise((r) => { cola.push(() => r(undefined)) })
  }
  // El hueco pasa directamente al siguiente de la cola (enVuelo no cambia).
  const liberar = () => {
    const siguiente = cola.shift()
    if (siguiente) siguiente()
    else enVuelo--
  }

  /** @param {string} url */
  const intentar = async (url) => {
    await adquirir()
    try {
      return await pedirOkx(fetch, url)
    } finally {
      liberar()
    }
  }

  /** @param {string} url */
  const conReintento = async (url) => {
    try {
      return await intentar(url)
    } catch (e) {
      if (!(/** @type {any} */ (e)?.limite) || reintentos >= maxReintentos) throw e
      reintentos++
      await esperar(pausaReintento)
      return intentar(url)
    }
  }

  return {
    /**
     * @param {string} ruta p. ej. '/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=300'
     * @returns {Promise<unknown[]>}
     */
    pedir(ruta) {
      const url = `${OKX}${ruta}`
      if (!ruta.startsWith('/api/v5/rubik/')) return conReintento(url)
      const pausa = rubikPedidas++ > 0
      const peticion = turnoRubik.then(async () => {
        if (pausa) await esperar(espaciadoRubik)
        return conReintento(url)
      })
      turnoRubik = peticion.catch(() => undefined)
      return peticion
    },
    /** Reintentos gastados hasta ahora. */
    get reintentos() {
      return reintentos
    },
  }
}

/** @typedef {ReturnType<typeof crearCliente>} ClienteOkx */

/**
 * Valida el `data` de /market/candles (filas de la más reciente a la más antigua) y lo convierte en velas
 * de core ordenadas de la más antigua a la más reciente, todo en una pasada. `fin` = inicio + duración.
 * La vela en curso (confirm "0") se incluye: cerradasHasta la descarta por su `fin`.
 * @param {unknown[]} datos
 * @param {number} duracion ms de la barra; cada vela debe empezar en un múltiplo (alineada a UTC)
 * @returns {Vela[]}
 */
export function leerVelas(datos, duracion) {
  if (!Array.isArray(datos)) throw new TypeError('velas: no es una lista')
  const n = datos.length
  /** @type {Vela[]} */
  const velas = new Array(n)
  let posterior = Infinity
  for (let i = 0; i < n; i++) {
    const fila = datos[i]
    if (!Array.isArray(fila) || fila.length < 9) throw new TypeError('velas: fila mal formada')
    const inicio = Number(fila[0])
    const apertura = Number(fila[1])
    const maximo = Number(fila[2])
    const minimo = Number(fila[3])
    const cierre = Number(fila[4])
    const volumen = Number(fila[5])
    if (!Number.isSafeInteger(inicio) || inicio <= 0) throw new TypeError('velas: tiempo no válido')
    if (inicio % duracion !== 0) throw new TypeError('velas: vela no alineada a UTC')
    // `!(x > 0)` también rechaza NaN; y ±Infinity no es finito.
    if (!(apertura > 0 && maximo > 0 && minimo > 0 && cierre > 0)
      || !Number.isFinite(apertura + maximo + minimo + cierre)) {
      throw new TypeError('velas: precio no válido')
    }
    if (!(volumen >= 0) || !Number.isFinite(volumen)) throw new TypeError('velas: volumen no válido')
    if (maximo < apertura || maximo < cierre || maximo < minimo || minimo > apertura || minimo > cierre) {
      throw new TypeError('velas: OHLC incoherente')
    }
    if (inicio >= posterior) throw new TypeError('velas: velas desordenadas o repetidas')
    posterior = inicio
    velas[n - 1 - i] = { inicio, fin: inicio + duracion, apertura, maximo, minimo, cierre, volumen }
  }
  return velas
}

/**
 * @param {ClienteOkx} cliente
 * @param {string} instId p. ej. BTC-USDT o BTC-EUR
 * @param {Intervalo} intervalo
 * @param {number} [limite]
 * @returns {Promise<Vela[]>}
 */
export async function descargarVelas(cliente, instId, intervalo, limite = LIMITE_VELAS) {
  const datos = await cliente.pedir(`${RUTA_VELAS}?instId=${instId}&bar=${BARRAS[intervalo]}&limit=${limite}`)
  return leerVelas(datos, DURACION[intervalo])
}

/**
 * Las 4 series de una moneda (4 subpeticiones): USDT 1H/4H/1Dutc con LIMITE_VELAS y EUR 1H con LIMITE_EUR.
 * Una serie que falla queda vacía y se anota.
 * @param {ClienteOkx} cliente
 * @param {string} simbolo
 */
export async function descargarMoneda(cliente, simbolo) {
  /** @type {[string, Intervalo, number][]} */
  const pedidos = [
    [`${simbolo}-USDT`, '1h', LIMITE_VELAS], [`${simbolo}-USDT`, '4h', LIMITE_VELAS], [`${simbolo}-USDT`, '1d', LIMITE_VELAS],
    [`${simbolo}-EUR`, '1h', LIMITE_EUR],
  ]
  const resultados = await Promise.allSettled(pedidos.map(([instId, intervalo, limite]) => descargarVelas(cliente, instId, intervalo, limite)))
  /** @type {string[]} */
  const fallos = []
  /** @param {number} i @returns {Vela[]} */
  const serie = (i) => {
    const r = resultados[i]
    if (r.status === 'fulfilled') return r.value
    fallos.push(`velas ${pedidos[i][0]} ${pedidos[i][1]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    return []
  }
  return { simbolo, velas: { '1h': serie(0), '4h': serie(1), '1d': serie(2) }, velasEur: serie(3), fallos }
}

/**
 * Variación del cierre en 24 h con velas 1H ya cerradas en `ahora` (0,02 = +2 %). null si faltan velas.
 * @param {Vela[]} velas1h
 * @param {number} ahora
 */
export function cambio24h(velas1h, ahora) {
  const cerradas = cerradasHasta(velas1h, ahora)
  if (cerradas.length < 25) return null
  const ultima = cerradas[cerradas.length - 1]
  const hace24h = cerradas[cerradas.length - 25]
  if (ultima.inicio - hace24h.inicio !== 24 * 3_600_000) return null
  return ultima.cierre / hace24h.cierre - 1
}

/**
 * Cierre de la última vela cerrada en `ahora`, o null.
 * @param {Vela[]} velas
 * @param {number} ahora
 */
export function ultimoCierre(velas, ahora) {
  const cerradas = cerradasHasta(velas, ahora)
  return cerradas.length > 0 ? cerradas[cerradas.length - 1].cierre : null
}

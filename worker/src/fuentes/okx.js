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

/**
 * Peticiones a OKX en vuelo a la vez, como mucho. Las velas admiten 40 cada 2 s por IP, pero la IP de
 * salida de Cloudflare es compartida: en producción, 4 a la vez a las hh:03 recibieron 429 en ráfaga.
 * Con 2 el tiempo total apenas cambia (lo marca la cola rubik).
 */
export const CONCURRENCIA = 2
/** Pausa entre peticiones rubik (estadísticas de contratos: ~5 cada 2 s por IP, y Cloudflare comparte IPs). */
export const ESPACIADO_RUBIK_MS = 450
/**
 * Pausa tras una respuesta limitada (HTTP 429 o código 50011): frena a TODAS las peticiones a OKX (no
 * sale ninguna nueva) y después la limitada se reintenta una vez.
 */
export const PAUSA_REINTENTO_MS = 1200
/**
 * Frenos seguidos sin ningún acierto entre medias duplican la pausa hasta este tope: la IP compartida
 * puede seguir saturada varios segundos (en producción, una pausa fija de 1,2 s agotaba los reintentos).
 */
export const PAUSA_MAXIMA_MS = 8000
/**
 * Reintentos de cada petición de velas (imprescindibles: sin ellas la moneda queda SIN_DATOS). El resto
 * (derivados, opcionales) se reintenta una vez. En producción, con un solo reintento, alguna serie seguía
 * cayendo con la IP compartida saturada.
 */
export const REINTENTOS_VELAS = 2
/**
 * Reintentos por ejecución entre todas las peticiones, por defecto: 35 a OKX + 10 + F&G + 2 LLM = 48 ≤ 50.
 * La ejecución de mercado pasa su propio presupuesto con lo que de verdad cabe (ejecuciones/mercado.js).
 */
export const MAX_REINTENTOS = 10
const CODIGO_LIMITE = '50011'

/**
 * Subpeticiones fuera del plan de una ejecución (reintentos de OKX, series enteras por un hueco de la caché y
 * el respaldo de Bybit), compartidas entre todas. `reserva`: las que solo puede gastar quien pida
 * `deReserva` (el respaldo de Bybit), para que los reintentos de OKX no se las coman todas.
 * @param {number} disponibles
 */
export function crearPresupuesto(disponibles) {
  return {
    disponibles: Math.max(0, disponibles),
    reserva: 0,
    /** Gasta una si queda alguna libre (con `deReserva`, también de la reserva). @param {boolean} [deReserva] */
    gastar(deReserva = false) {
      if (this.disponibles - (deReserva ? 0 : this.reserva) <= 0) return false
      this.disponibles--
      return true
    },
  }
}

/** @typedef {ReturnType<typeof crearPresupuesto>} Presupuesto */

/** @param {number} ms */
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

/** 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=1H&…' → 'candles BTC-USDT 1H'. @param {string} url */
const resumir = (url) => {
  const u = new URL(url)
  return [u.pathname.split('/').pop(), u.searchParams.get('instId'), u.searchParams.get('bar')].filter(Boolean).join(' ')
}

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
 * y separadas ESPACIADO_RUBIK_MS. Una respuesta limitada (429/50011) activa un freno común de
 * PAUSA_REINTENTO_MS (ninguna petición sale mientras dura: las que ya estaban en vuelo son las únicas que
 * pueden fallar), que se duplica con cada freno seguido sin aciertos hasta PAUSA_MAXIMA_MS; la limitada se
 * reintenta al acabar (una vez; las velas, REINTENTOS_VELAS) si queda presupuesto (por defecto, MAX_REINTENTOS
 * en total) para no pasar de 50 subpeticiones.
 * @param {typeof fetch} fetch
 * @param {{ esperar?: (ms: number) => Promise<void>, concurrencia?: number, espaciadoRubik?: number,
 *   pausaReintento?: number, pausaMaxima?: number, maxReintentos?: number, presupuesto?: Presupuesto }} [opciones]
 *   esperar: inyectable en los tests; presupuesto: compartido con el resto de la ejecución (manda sobre maxReintentos).
 */
export function crearCliente(fetch, {
  esperar = esperarMs, concurrencia = CONCURRENCIA, espaciadoRubik = ESPACIADO_RUBIK_MS,
  pausaReintento = PAUSA_REINTENTO_MS, pausaMaxima = PAUSA_MAXIMA_MS, maxReintentos = MAX_REINTENTOS,
  presupuesto = crearPresupuesto(maxReintentos),
} = {}) {
  let enVuelo = 0
  /** @type {(() => void)[]} */
  const cola = []
  let reintentos = 0
  let rubikPedidas = 0
  const inicio = Date.now()
  /** @type {string[]} */
  const limitadas = []
  /** @type {Promise<void>|null} */
  let freno = null
  let frenosSeguidos = 0
  const frenar = () => {
    if (!freno) {
      freno = esperar(Math.min(pausaReintento * 2 ** frenosSeguidos, pausaMaxima)).then(() => { freno = null })
      frenosSeguidos++
    }
    return freno
  }
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

  /**
   * Pide `url` ocupando un hueco de CONCURRENCIA; si la limitan, espera al freno y la reintenta (hasta
   * `maximo` veces) sin soltar el hueco (así no pierde el turno frente a las que esperaban en la cola).
   * @param {string} url
   * @param {number} maximo
   */
  const conReintento = async (url, maximo) => {
    await adquirir()
    try {
      for (let intento = 0; ; intento++) {
        while (freno) await freno
        try {
          const datos = await pedirOkx(fetch, url)
          frenosSeguidos = 0
          return datos
        } catch (e) {
          if (!(/** @type {any} */ (e)?.limite)) throw e
          limitadas.push(`${Date.now() - inicio}ms ${resumir(url)}`)
          frenar()
          if (intento >= maximo || !presupuesto.gastar()) throw e
          reintentos++
        }
      }
    } finally {
      liberar()
    }
  }

  return {
    /**
     * @param {string} ruta p. ej. '/api/v5/market/candles?instId=BTC-USDT&bar=1H&limit=300'
     * @param {number} [maximo] reintentos de esta petición si la limitan (429/50011)
     * @returns {Promise<unknown[]>}
     */
    pedir(ruta, maximo = 1) {
      const url = `${OKX}${ruta}`
      if (!ruta.startsWith('/api/v5/rubik/')) return conReintento(url, maximo)
      const pausa = rubikPedidas++ > 0
      const peticion = turnoRubik.then(async () => {
        if (pausa) await esperar(espaciadoRubik)
        return conReintento(url, maximo)
      })
      turnoRubik = peticion.catch(() => undefined)
      return peticion
    },
    /** Reintentos gastados hasta ahora. */
    get reintentos() {
      return reintentos
    },
    /** Respuestas limitadas (429/50011): «<ms desde el inicio> <endpoint> <instrumento> [barra]». */
    get limitadas() {
      return limitadas
    },
  }
}

/** @typedef {ReturnType<typeof crearCliente>} ClienteOkx */

/**
 * Valida filas de velas [inicio, apertura, máximo, mínimo, cierre, volumen, …] de la más reciente a la más
 * antigua (así las sirven OKX y Bybit) y las convierte en velas de core ordenadas de la más antigua a la más
 * reciente, todo en una pasada. `fin` = inicio + duración. La vela en curso se incluye: cerradasHasta la
 * descarta por su `fin`.
 * @param {unknown[]} datos
 * @param {number} duracion ms de la barra; cada vela debe empezar en un múltiplo (alineada a UTC)
 * @param {number} campos campos mínimos por fila
 * @returns {Vela[]}
 */
export function leerFilasVelas(datos, duracion, campos) {
  if (!Array.isArray(datos)) throw new TypeError('velas: no es una lista')
  const n = datos.length
  /** @type {Vela[]} */
  const velas = new Array(n)
  let posterior = Infinity
  for (let i = 0; i < n; i++) {
    const fila = datos[i]
    if (!Array.isArray(fila) || fila.length < campos) throw new TypeError('velas: fila mal formada')
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
 * Valida el `data` de /market/candles de OKX (filas de 9 campos, la más reciente primero; confirm "0" en la
 * vela en curso) y lo convierte en velas de core ascendentes (leerFilasVelas).
 * @param {unknown[]} datos
 * @param {number} duracion
 */
export const leerVelas = (datos, duracion) => leerFilasVelas(datos, duracion, 9)

/**
 * @param {ClienteOkx} cliente
 * @param {string} instId p. ej. BTC-USDT o BTC-EUR
 * @param {Intervalo} intervalo
 * @param {number} [limite]
 * @returns {Promise<Vela[]>}
 */
export async function descargarVelas(cliente, instId, intervalo, limite = LIMITE_VELAS) {
  const datos = await cliente.pedir(`${RUTA_VELAS}?instId=${instId}&bar=${BARRAS[intervalo]}&limit=${limite}`, REINTENTOS_VELAS)
  return leerVelas(datos, DURACION[intervalo])
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

// @ts-check
// Cliente de la API del Worker («Contrato de la API» del plan 2). fetch inyectado: en los tests, el propio Worker.
import { hora } from './formato.js'

/** Error de la API con el cuerpo `{ error, detalle, hasta?, reintentar_en? }` del Worker. estado 0 = sin respuesta. */
export class ErrorApi extends Error {
  /** @param {number} estado @param {string} codigo @param {string} detalle @param {number|null} [hasta] */
  constructor(estado, codigo, detalle, hasta = null) {
    super(detalle)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
    this.hasta = hasta
    /** @type {number|null} ms que pide esperar el Worker antes de reintentar (429 `ocupado`) */
    this.reintentarEn = null
  }
}

/** @typedef {Record<string, string|number|null|undefined>} Consulta */

/** Peticiones a la vez como mucho: el Worker reserva un intento de PIN por cada petición en vuelo (5 por IP). */
export const MAX_EN_VUELO = 2
/** Reintentos automáticos ante 429 `ocupado` (otros intentos de PIN en vuelo; no es un bloqueo). */
export const MAX_REINTENTOS_OCUPADO = 3
/** Espera por defecto antes de reintentar si el Worker no dice `reintentar_en`. */
export const REINTENTO_MS = 2000
/** Plazo de cada petición; /api/analizar tarda 25-35 s (descarga y analiza las 5 monedas). */
export const PLAZO_MS = 20_000
export const PLAZO_ANALIZAR_MS = 60_000

/** @param {number} ms */
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Semáforo FIFO: como mucho `max` tareas a la vez. `ocupadas()` cuenta los huecos en uso.
 * @param {number} max
 */
export function crearLimitador(max) {
  let activas = 0
  /** @type {(() => void)[]} */
  const cola = []
  // El hueco pasa directamente a la siguiente en cola (el contador no cambia); solo se libera si nadie espera.
  const soltar = () => {
    const siguiente = cola.shift()
    if (siguiente) siguiente()
    else activas--
  }
  /**
   * @template T
   * @param {() => Promise<T>} tarea
   * @returns {Promise<T>}
   */
  async function limitar(tarea) {
    if (activas >= max) await new Promise((r) => cola.push(() => r(undefined)))
    else activas++
    try {
      return await tarea()
    } finally {
      soltar()
    }
  }
  return Object.assign(limitar, { ocupadas: () => activas })
}

/**
 * @param {{ base: string, fetch: typeof fetch, pin: () => string|null, esperar?: (ms: number) => Promise<void>,
 *   maxEnVuelo?: number, plazoMs?: number, plazoAnalizarMs?: number }} op
 */
export function crearApi({
  base, fetch, pin, esperar = esperarMs, maxEnVuelo = MAX_EN_VUELO, plazoMs = PLAZO_MS, plazoAnalizarMs = PLAZO_ANALIZAR_MS,
}) {
  const limitar = crearLimitador(maxEnVuelo)

  /**
   * @param {'GET'|'POST'} metodo
   * @param {string} ruta
   * @param {{ consulta?: Consulta, cuerpo?: unknown, plazo?: number }} [op]
   * @returns {Promise<any>}
   */
  async function pedir(metodo, ruta, { consulta = {}, cuerpo, plazo = plazoMs } = {}) {
    if (!base) throw new ErrorApi(0, 'sin_configurar', 'Falta la URL del Worker en config.js (API_PRODUCCION).')
    const url = new URL(base + ruta)
    for (const [clave, valor] of Object.entries(consulta)) {
      if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(clave, String(valor))
    }
    for (let intento = 0; ; intento++) {
      try {
        return await limitar(() => unaVez(metodo, url, cuerpo, plazo))
      } catch (e) {
        if (!(e instanceof ErrorApi) || e.codigo !== 'ocupado' || intento >= MAX_REINTENTOS_OCUPADO) throw e
        await esperar(e.reintentarEn ?? REINTENTO_MS)
      }
    }
  }

  /**
   * Una petición con su plazo, ya dentro del limitador.
   * @param {'GET'|'POST'} metodo @param {URL} url @param {unknown} cuerpo @param {number} plazo
   * @returns {Promise<any>}
   */
  async function unaVez(metodo, url, cuerpo, plazo) {
    // Sin PIN (sesión cerrada mientras esperaba turno) no se llama: el Worker contaría un intento fallido.
    const clave = pin()
    if (!clave) throw new ErrorApi(401, 'sin_sesion', 'Introduce el PIN para continuar.')
    /** @type {Record<string, string>} */
    const cabeceras = { Authorization: `Bearer ${clave}` }
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
    const control = new AbortController()
    let agotado = false
    const temporizador = setTimeout(() => {
      agotado = true
      control.abort()
    }, plazo)
    let respuesta
    /** @type {any} */
    let datos = null
    try {
      try {
        respuesta = await fetch(url.href, {
          method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: control.signal,
        })
      } catch {
        if (agotado) throw new ErrorApi(0, 'tiempo', `El servidor no respondió en ${Math.round(plazo / 1000)} s. Vuelve a probar.`)
        throw new ErrorApi(0, 'red', 'No se pudo contactar con el servidor. Comprueba la conexión.')
      }
      try {
        datos = await respuesta.json()
      } catch {
        if (agotado) throw new ErrorApi(0, 'tiempo', `El servidor no respondió en ${Math.round(plazo / 1000)} s. Vuelve a probar.`)
        datos = null
      }
    } finally {
      clearTimeout(temporizador)
    }
    if (!respuesta.ok) {
      const error = new ErrorApi(respuesta.status, datos?.error ?? 'http', datos?.detalle ?? `Error ${respuesta.status} del servidor.`,
        typeof datos?.hasta === 'number' ? datos.hasta : null)
      if (typeof datos?.reintentar_en === 'number') error.reintentarEn = Math.min(Math.max(datos.reintentar_en, 0.5), 10) * 1000
      throw error
    }
    if (datos === null || typeof datos !== 'object') throw new ErrorApi(respuesta.status, 'respuesta_invalida', 'Respuesta no válida del servidor.')
    return datos
  }

  return {
    resumen: () => pedir('GET', '/api/resumen'),
    /** @param {string} simbolo */
    moneda: (simbolo) => pedir('GET', `/api/moneda/${encodeURIComponent(simbolo)}`),
    /** @param {number|null} [simulacion] sin valor: la activa de la estrategia principal */
    bot: (simulacion = null) => pedir('GET', '/api/bot', { consulta: { simulacion } }),
    /** Simulaciones activas lado a lado: métricas, curvas y comprar y mantener (una por estrategia en vivo). */
    comparativa: () => pedir('GET', '/api/bot/comparativa'),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    operaciones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/operaciones', { consulta: { simulacion, simbolo, cursor } }),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    decisiones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/decisiones', { consulta: { simulacion, simbolo, cursor } }),
    simulaciones: () => pedir('GET', '/api/simulaciones'),
    /** Cierra todas las simulaciones activas y abre una por estrategia en vivo. @param {number} capitalInicial */
    reiniciar: (capitalInicial) => pedir('POST', '/api/bot/reiniciar', { cuerpo: { capital_inicial: capitalInicial, confirmar: true } }),
    analizar: () => pedir('POST', '/api/analizar', { plazo: plazoAnalizarMs }),
  }
}

/** @typedef {ReturnType<typeof crearApi>} Api */

/**
 * El error obliga a volver a pedir el PIN: incorrecto o sin sesión (401).
 * @param {unknown} e
 */
export const pideLogin = (e) => e instanceof ErrorApi && e.estado === 401

/**
 * Acceso bloqueado (429 `bloqueado`, por IP o global). No dice que el PIN guardado sea malo: se conserva.
 * @param {unknown} e
 */
export const esBloqueo = (e) => e instanceof ErrorApi && e.codigo === 'bloqueado'

/**
 * Mensaje para la persona usuaria, en español.
 * @param {unknown} e
 */
export function mensajeError(e) {
  if (!(e instanceof ErrorApi)) return `Error inesperado: ${e instanceof Error ? e.message : String(e)}`
  if (e.codigo === 'bloqueado') {
    return `Demasiados intentos con PIN incorrecto. Acceso bloqueado${e.hasta ? ` hasta las ${hora(e.hasta)}` : ''}.`
  }
  if (e.codigo === 'demasiado_pronto') {
    return `Solo se puede analizar una vez cada 5 minutos.${e.hasta ? ` Espera hasta las ${hora(e.hasta)}.` : ''}`
  }
  return e.message
}

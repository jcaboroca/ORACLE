// @ts-check
// Velas de la ejecución de mercado con caché en D1 (spec §4 y §9). Una vela cerrada no cambia: se guardan las
// últimas cerradas de cada serie (tabla cache_velas) y cada ejecución pide a OKX solo lo que puede haber
// cambiado: 1H (USDT y EUR) cada hora con limit=3, 4H solo cuando ha cerrado una 4H nueva y 1Dutc solo cuando
// ha cerrado el día. Sin caché, con caché corta o con un hueco, la serie entera (300 USDT, 48 EUR).
// La estrategia recibe exactamente lo mismo que pidiendo la serie entera: las VENTANA (299) últimas USDT
// cerradas y las 47 EUR cerradas. Si OKX sigue limitando tras los reintentos, las USDT se piden a Bybit
// (solo para esa ejecución: lo de Bybit no entra en la caché, que es solo de OKX).
import { DURACION, VENTANA, cerradasHasta } from '../../../core/velas.js'
import { descargarVelasBybit } from './bybit.js'
import { LIMITE_EUR, LIMITE_VELAS, descargarVelas } from './okx.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */
/** @typedef {import('./okx.js').Intervalo} Intervalo */
/** @typedef {import('./okx.js').ClienteOkx} ClienteOkx */
/** @typedef {import('./okx.js').Presupuesto} Presupuesto */

/** Velas que se piden con la caché al día: las 1-2 cerradas que faltan (o la última, otra vez) y la vela en curso. */
export const LIMITE_INCREMENTAL = 3

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * Inicio de la última vela ya cerrada en `ahora` (la que cerró al empezar el periodo en curso).
 * @param {number} duracion
 * @param {number} ahora
 */
export const ultimaCerrada = (duracion, ahora) => Math.floor(ahora / duracion) * duracion - duracion

/**
 * `limit` que hay que pedir a OKX: 0 si la caché ya tiene la última vela cerrada, LIMITE_INCREMENTAL si le faltan
 * 1 o 2, y la serie entera (`completo`) sin caché, con menos de `minimo` velas o con un hueco mayor.
 * @param {Vela[]|null} cache velas cerradas guardadas, ascendentes
 * @param {number} duracion
 * @param {number} ahora
 * @param {{ completo: number, minimo: number }} limites
 */
export function limiteAPedir(cache, duracion, ahora, { completo, minimo }) {
  if (!cache || cache.length === 0 || cache.length < minimo) return completo
  const faltan = (ultimaCerrada(duracion, ahora) - cache[cache.length - 1].inicio) / duracion
  if (faltan === 0) return 0
  return faltan >= 1 && faltan < LIMITE_INCREMENTAL ? LIMITE_INCREMENTAL : completo
}

/**
 * Une la caché con las velas recién descargadas (las nuevas mandan si repiten inicio), se queda con las cerradas
 * en `ahora` y de ellas con las `maximo` más recientes. null si las nuevas no empalman con la caché (hueco) o no
 * llega ninguna: entonces hay que pedir la serie entera.
 * @param {Vela[]|null} cache
 * @param {Vela[]} nuevas ascendentes (la vela en curso puede venir: se descarta)
 * @param {number} duracion
 * @param {number} ahora
 * @param {number} maximo
 * @returns {Vela[]|null}
 */
export function fusionar(cache, nuevas, duracion, ahora, maximo) {
  let todas = nuevas
  if (cache && cache.length > 0) {
    if (nuevas.length === 0 || nuevas[0].inicio > cache[cache.length - 1].inicio + duracion) return null
    const primera = nuevas[0].inicio
    let corte = cache.length
    while (corte > 0 && cache[corte - 1].inicio >= primera) corte--
    todas = cache.slice(Math.max(0, corte - maximo), corte).concat(nuevas)
  }
  const cerradas = cerradasHasta(todas, ahora)
  return cerradas.length > maximo ? cerradas.slice(cerradas.length - maximo) : cerradas
}

/**
 * Formato compacto de la caché: [[inicio, apertura, máximo, mínimo, cierre, volumen], …] (JSON conserva cada
 * número bit a bit).
 * @param {Vela[]} velas
 */
export const serializar = (velas) => JSON.stringify(velas.map((v) => [v.inicio, v.apertura, v.maximo, v.minimo, v.cierre, v.volumen]))

/**
 * Lee una serie de la caché. null si no es válida (se pide entera y se reescribe).
 * @param {string} texto
 * @param {number} duracion
 * @returns {Vela[]|null}
 */
export function deserializar(texto, duracion) {
  /** @type {unknown} */
  let filas
  try {
    filas = JSON.parse(texto)
  } catch {
    return null
  }
  if (!Array.isArray(filas)) return null
  /** @type {Vela[]} */
  const velas = new Array(filas.length)
  let anterior = -Infinity
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i]
    if (!Array.isArray(f) || f.length !== 6) return null
    const [inicio, apertura, maximo, minimo, cierre, volumen] = f
    if (!Number.isSafeInteger(inicio) || inicio % duracion !== 0 || inicio <= anterior) return null
    if (![apertura, maximo, minimo, cierre, volumen].every((x) => typeof x === 'number' && Number.isFinite(x))) return null
    anterior = inicio
    velas[i] = { inicio, fin: inicio + duracion, apertura, maximo, minimo, cierre, volumen }
  }
  return velas
}

/**
 * @typedef {{ clave: string, simbolo: string, instrumento: string, intervalo: Intervalo, eur: boolean,
 *   cacheada: Vela[]|null, limite: number, completo: number, guardar: number, salida: number }} Pedido
 * clave: 'BTC-USDT 1h'; limite: lo que se pide a OKX (0 = de la caché); completo: la serie entera; guardar:
 * cerradas que se guardan; salida: cerradas que recibe la estrategia.
 */

/**
 * Qué pedir de cada serie (USDT 1H/4H/1Dutc y EUR 1H por moneda) según la caché.
 * @param {string[]} monedas
 * @param {Record<string, string>} cache clave → velas_json
 * @param {number} ahora
 * @returns {Pedido[]}
 */
export function planificarVelas(monedas, cache, ahora) {
  /** @type {[string, Intervalo][]} */
  const series = [['USDT', '1h'], ['USDT', '4h'], ['USDT', '1d'], ['EUR', '1h']]
  return monedas.flatMap((simbolo) => series.map(([cotizacion, intervalo]) => {
    const instrumento = `${simbolo}-${cotizacion}`
    const clave = `${instrumento} ${intervalo}`
    const eur = cotizacion === 'EUR'
    const duracion = DURACION[intervalo]
    const completo = eur ? LIMITE_EUR : LIMITE_VELAS
    const cerradas = eur ? LIMITE_EUR - 1 : VENTANA
    const texto = cache[clave]
    const cacheada = typeof texto === 'string' ? deserializar(texto, duracion) : null
    return {
      clave, simbolo, instrumento, intervalo, eur, cacheada, completo,
      limite: limiteAPedir(cacheada, duracion, ahora, { completo, minimo: cerradas }),
      guardar: eur ? cerradas : LIMITE_VELAS,
      salida: cerradas,
    }
  }))
}

/**
 * Una serie desde OKX (o la caché): incremental si se puede; si no empalma, la serie entera con una subpetición
 * del presupuesto. Lanza si OKX falla.
 * @param {ClienteOkx} okx
 * @param {Pedido} p
 * @param {number} ahora
 * @param {Presupuesto} presupuesto
 */
async function desdeOkx(okx, p, ahora, presupuesto) {
  const duracion = DURACION[p.intervalo]
  if (p.limite === 0) return /** @type {Vela[]} */ (p.cacheada)
  const nuevas = await descargarVelas(okx, p.instrumento, p.intervalo, p.limite)
  const unidas = fusionar(p.limite === p.completo ? null : p.cacheada, nuevas, duracion, ahora, p.guardar)
  if (unidas) return unidas
  if (!presupuesto.gastar()) throw new Error('hueco en la caché y sin subpeticiones para pedir la serie entera')
  const enteras = await descargarVelas(okx, p.instrumento, p.intervalo, p.completo)
  return /** @type {Vela[]} */ (fusionar(null, enteras, duracion, ahora, p.guardar))
}

/**
 * Respaldo de Bybit para una serie USDT, unida a la caché de OKX si empalma.
 * @param {typeof fetch} fetch
 * @param {Pedido} p
 * @param {number} ahora
 */
async function desdeBybit(fetch, p, ahora) {
  const nuevas = await descargarVelasBybit(fetch, p.simbolo, p.intervalo, p.limite)
  const unidas = fusionar(p.limite === p.completo ? null : p.cacheada, nuevas, DURACION[p.intervalo], ahora, p.guardar)
  if (!unidas) throw new Error('no empalma con la caché')
  return unidas
}

/**
 * Descarga las series planificadas. Primero OKX (todas a la vez por el cliente con límite de ritmo); después, para
 * las USDT que fallen, Bybit (una subpetición del presupuesto cada una, en orden, pudiendo usar la reserva).
 * Nunca lanza: una serie sin datos queda vacía y se anota.
 * @param {{ okx: ClienteOkx, fetch: typeof fetch, pedidos: Pedido[], ahora: number, presupuesto: Presupuesto }} entrada
 * @returns {Promise<{ monedas: Record<string, { velas: { '1h': Vela[], '4h': Vela[], '1d': Vela[] }, velasEur: Vela[] }>,
 *   guardar: { clave: string, instrumento: string, intervalo: Intervalo, velas: Vela[] }[], fallos: string[], bybit: string[] }>}
 */
export async function descargarSeries({ okx, fetch, pedidos, ahora, presupuesto }) {
  const okxResultados = await Promise.allSettled(pedidos.map((p) => desdeOkx(okx, p, ahora, presupuesto)))
  const respaldo = await Promise.all(pedidos.map((p, i) => {
    if (okxResultados[i].status === 'fulfilled' || p.eur) return null
    if (!presupuesto.gastar(true)) return Promise.reject(new Error('sin subpeticiones libres'))
    return desdeBybit(fetch, p, ahora)
  }).map((promesa) => (promesa === null ? null : promesa.then(
    (velas) => ({ velas, error: null }),
    (e) => ({ velas: null, error: mensaje(e) }),
  ))))
  /** @type {Record<string, { velas: { '1h': Vela[], '4h': Vela[], '1d': Vela[] }, velasEur: Vela[] }>} */
  const monedas = {}
  /** @type {{ clave: string, instrumento: string, intervalo: Intervalo, velas: Vela[] }[]} */
  const guardar = []
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  const bybit = []
  pedidos.forEach((p, i) => {
    const r = okxResultados[i]
    /** @type {Vela[]} */
    let velas = []
    if (r.status === 'fulfilled') {
      velas = r.value
      if (p.limite > 0) guardar.push({ clave: p.clave, instrumento: p.instrumento, intervalo: p.intervalo, velas })
    } else {
      fallos.push(`velas ${p.clave}: ${mensaje(r.reason)}`)
      const b = respaldo[i]
      if (b?.velas) {
        velas = b.velas
        bybit.push(p.clave)
      } else if (b) {
        fallos.push(`velas ${p.clave} (Bybit): ${b.error}`)
      }
    }
    const salida = velas.length > p.salida ? velas.slice(velas.length - p.salida) : velas
    monedas[p.simbolo] ??= { velas: { '1h': [], '4h': [], '1d': [] }, velasEur: [] }
    if (p.eur) monedas[p.simbolo].velasEur = salida
    else monedas[p.simbolo].velas[/** @type {'1h'|'4h'|'1d'} */ (p.intervalo)] = salida
  })
  return { monedas, guardar, fallos, bybit }
}

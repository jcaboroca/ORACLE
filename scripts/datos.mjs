// @ts-check
// Descarga de histórico con caché local (scripts/.cache/, ignorada por git), compartida por el backtest
// y el laboratorio. Binance: data-api.binance.vision (solo datos de mercado públicos). Fear & Greed: alternative.me.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HORA, desdeBinance } from '../core/velas.js'

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(RAIZ, 'scripts', '.cache')
export const DIA = 24 * HORA
const BINANCE = 'https://data-api.binance.vision/api/v3/klines'

/**
 * @param {string} clave
 * @param {() => Promise<unknown>} obtener
 */
export async function conCache(clave, obtener) {
  const ruta = join(CACHE, `${clave}.json`)
  try {
    return JSON.parse(await readFile(ruta, 'utf8'))
  } catch {
    const datos = await obtener()
    await mkdir(CACHE, { recursive: true })
    await writeFile(ruta, JSON.stringify(datos))
    return datos
  }
}

/**
 * Filas de klines de Binance en [inicio, fin), paginadas de 1000 en 1000.
 * @param {string} par p. ej. BTCUSDT
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} inicio
 * @param {number} fin
 */
async function pedirFilas(par, intervalo, inicio, fin) {
  /** @type {unknown[][]} */
  const todas = []
  let cursor = inicio
  while (cursor < fin) {
    const url = `${BINANCE}?symbol=${par}&interval=${intervalo}&startTime=${cursor}&endTime=${fin - 1}&limit=1000`
    let res = await fetch(url)
    for (let intento = 1; !res.ok && intento <= 3; intento++) {
      await new Promise((r) => setTimeout(r, 2000 * intento))
      res = await fetch(url)
    }
    if (!res.ok) throw new Error(`Binance ${res.status} en ${url}`)
    /** @type {unknown[][]} */
    const lote = await res.json()
    if (lote.length === 0) break
    todas.push(...lote)
    cursor = Number(lote[lote.length - 1][0]) + 1
    if (lote.length < 1000) break
  }
  return todas
}

/**
 * Velas de Binance en [inicio, fin), cacheadas con esa misma clave (como siempre en el backtest).
 * @param {string} par
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} inicio
 * @param {number} fin
 */
export async function descargarVelas(par, intervalo, inicio, fin) {
  /** @type {unknown[][]} */
  const filas = await conCache(`${par}-${intervalo}-${inicio}-${fin}`, () => pedirFilas(par, intervalo, inicio, fin))
  return desdeBinance(filas)
}

/**
 * Todo el histórico en [inicio, fin) por años naturales: los años completos se cachean con una clave fija
 * (`PAR-intervalo-AAAA`) y se reutilizan en cada ejecución; solo el tramo del año en curso se vuelve a pedir.
 * Antes de que el par cotice, Binance no devuelve nada.
 * @param {string} par
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} inicio
 * @param {number} fin
 */
export async function descargarHistorico(par, intervalo, inicio, fin) {
  /** @type {import('../core/velas.js').Vela[]} */
  const velas = []
  for (let ano = new Date(inicio).getUTCFullYear(); Date.UTC(ano, 0, 1) < fin; ano++) {
    const desde = Math.max(inicio, Date.UTC(ano, 0, 1))
    const hasta = Math.min(fin, Date.UTC(ano + 1, 0, 1))
    const completo = desde === Date.UTC(ano, 0, 1) && hasta === Date.UTC(ano + 1, 0, 1)
    const clave = completo ? `${par}-${intervalo}-${ano}` : `${par}-${intervalo}-${desde}-${hasta}`
    /** @type {unknown[][]} */
    const filas = await conCache(clave, () => pedirFilas(par, intervalo, desde, hasta))
    velas.push(...desdeBinance(filas))
  }
  return velas
}

/**
 * Histórico completo de Fear & Greed (desde 2018-02), cacheado por día.
 * @param {number} hasta ms
 * @returns {Promise<{ t: number, valor: number }[]>}
 */
export async function descargarFng(hasta) {
  /** @type {{ data: { value: string, timestamp: string }[] }} */
  const json = /** @type {any} */ (await conCache(`fng-${Math.floor(hasta / DIA)}`, async () => {
    const res = await fetch('https://api.alternative.me/fng/?limit=0&format=json')
    if (!res.ok) throw new Error(`Fear & Greed ${res.status}`)
    return res.json()
  }))
  return json.data.map((d) => ({ t: Number(d.timestamp) * 1000, valor: Number(d.value) })).sort((a, b) => a.t - b.t)
}

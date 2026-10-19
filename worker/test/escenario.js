// @ts-check
// Escenario sintético de varias horas para los tests del Worker (nunca se usa en producción):
// tendencia alcista limpia en USDT (la estrategia v1 da COMPRAR con confianza 0,75) y, en EUR,
// un desplome de BTC en la vela CIERRE (stop-loss) y un pico de ETH en CIERRE + 2 h (take-profit).
import { HORA, VENTANA } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { GEMINI, GROQ } from '../src/fuentes/llm.js'
import { BYBIT_VELAS } from '../src/fuentes/bybit.js'
import { aRespuestaBybit, aRespuestaOkx, fixtureJson, simularFetch } from './ayudantes.js'

/** Inicio de la vela 1H que dispara el stop de BTC. Alineado a día y a 4 h. */
export const CIERRE = Date.UTC(2026, 9, 1)
/** Instante del cron de mercado de la hora k (minuto 3). @param {number} k */
export const ahoraDe = (k) => CIERRE + k * HORA + 3 * 60_000
export const HORAS_EXTRA = 12

/** @typedef {import('../../core/velas.js').Vela} Vela */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} Series */

/** @param {number} base */
function seriesDe(base) {
  /** @param {number} duracion @param {number} previas */
  const subida = (duracion, previas) => serie(previas + Math.ceil((HORAS_EXTRA * HORA) / duracion) + 1, (i) => base * 1.002 ** i, {
    duracion, inicio: CIERRE - previas * duracion,
  })
  return {
    // Más de VENTANA + 1 velas por serie: así la ventana de velas cerradas del backtest recorta de verdad.
    '1h': subida(HORA, 600),
    '4h': subida(4 * HORA, 600),
    '1d': subida(24 * HORA, 600),
    eur: serie(48 + HORAS_EXTRA + 1, (i) => base * 0.9 * 1.002 ** i, { inicio: CIERRE - 48 * HORA }),
  }
}

/** @returns {Record<string, Series>} */
export function crearEscenario() {
  const btc = seriesDe(100)
  const eth = seriesDe(10)
  const desplome = btc.eur.find((v) => v.inicio === CIERRE)
  const pico = eth.eur.find((v) => v.inicio === CIERRE + 2 * HORA)
  if (!desplome || !pico) throw new Error('escenario mal construido')
  desplome.minimo = desplome.minimo * 0.5
  pico.maximo = pico.maximo * 2
  return { BTC: btc, ETH: eth }
}

/** esperar() de los tests: el límite de ritmo de OKX no espera de verdad. */
export const sinEspera = async () => {}

/**
 * Lo que serviría OKX en `ahora` con `limit`: velas ya empezadas (incluida la que sigue abierta), las `limite` últimas.
 * @param {Vela[]} velas
 * @param {number} ahora
 * @param {number} [limite]
 */
export const servidasEn = (velas, ahora, limite = VENTANA + 1) => velas.filter((v) => v.inicio < ahora).slice(-limite)

/**
 * Entradas de core/hora.js para `ahora` con las ventanas de core/backtest.js: las VENTANA últimas velas USDT
 * cerradas y las 24 últimas EUR cerradas, sin derivados.
 * @param {Record<string, Series>} escenario
 * @param {number} ahora
 */
export function entradasBacktest(escenario, ahora) {
  /** @param {Vela[]} velas @param {number} n */
  const ultimas = (velas, n) => velas.filter((v) => v.fin <= ahora).slice(-n)
  return Object.entries(escenario).map(([simbolo, s]) => ({
    simbolo,
    velas: { '1h': ultimas(s['1h'], VENTANA), '4h': ultimas(s['4h'], VENTANA), '1d': ultimas(s['1d'], VENTANA) },
    velasEur: ultimas(s.eur, 24),
    derivados: null,
  }))
}

/**
 * Entradas de core/hora.js para `ahora`, sin derivados.
 * @param {Record<string, Series>} escenario
 * @param {number} ahora
 */
export function entradasEn(escenario, ahora) {
  return Object.entries(escenario).map(([simbolo, s]) => ({
    simbolo,
    velas: { '1h': servidasEn(s['1h'], ahora), '4h': servidasEn(s['4h'], ahora), '1d': servidasEn(s['1d'], ahora) },
    velasEur: servidasEn(s.eur, ahora),
    derivados: null,
  }))
}

const FNG = fixtureJson('alternative-fng.json')

const BARRAS = /** @type {Record<string, '1h'|'4h'|'1d'>} */ ({ '1H': '1h', '4H': '4h', '1Dutc': '1d' })
const INTERVALOS_BYBIT = /** @type {Record<string, '1h'|'4h'|'1d'>} */ ({ 60: '1h', 240: '4h', D: '1d' })

/**
 * OKX, Bybit (respaldo de las velas USDT) y alternative.me simulados sobre el escenario en el instante `ahora`.
 * Los derivados de OKX responden 503 (salvo el funding de `funding`), Groq y Gemini 500. Una moneda que no
 * está en el escenario usa las series de BTC.
 * @param {ReturnType<typeof crearEscenario>} escenario
 * @param {number} ahora
 * @param {{ caidas?: string[], funding?: Record<string, string>|null, limitado?: boolean | ((url: string) => boolean),
 *   bybitCaido?: boolean }} [op]
 *   caidas: instrumentos cuyas velas responden 500 en OKX y en Bybit (p. ej. 'SOL-USDT'); funding: fundingRate
 *   por perpetuo (p. ej. { 'BTC-USDT-SWAP': '0.0006' }); limitado: OKX (todo, o las URL que diga la función)
 *   responde 429 con el código 50011; bybitCaido: Bybit responde 403.
 */
export function fetchEscenario(escenario, ahora, { caidas = [], funding = null, limitado = false, bybitCaido = false } = {}) {
  return simularFetch((url) => {
    if (url.startsWith('https://www.okx.com/') && (typeof limitado === 'function' ? limitado(url) : limitado)) {
      return { estado: 429, cuerpo: { code: '50011', msg: 'Too Many Requests', data: [] } }
    }
    if (url.startsWith(`${BYBIT_VELAS}?`)) {
      const p = new URL(url).searchParams
      const simbolo = /** @type {string} */ (p.get('symbol')).replace(/USDT$/, '')
      if (bybitCaido || caidas.includes(`${simbolo}-USDT`)) return { estado: 403, cuerpo: '' }
      const intervalo = INTERVALOS_BYBIT[/** @type {string} */ (p.get('interval'))]
      if (!intervalo || p.get('category') !== 'spot') throw new Error(`petición a Bybit inesperada en el test: ${url}`)
      const velas = (escenario[simbolo] ?? escenario.BTC)[intervalo]
      return { cuerpo: aRespuestaBybit(servidasEn(velas, ahora, Number(p.get('limit'))), `${simbolo}USDT`) }
    }
    if (url.startsWith('https://www.okx.com/api/v5/market/candles?')) {
      const p = new URL(url).searchParams
      const instId = /** @type {string} */ (p.get('instId'))
      if (caidas.includes(instId)) return { estado: 500, cuerpo: '' }
      const [simbolo, cotizacion] = instId.split('-')
      const series = escenario[simbolo] ?? escenario.BTC
      const intervalo = BARRAS[/** @type {string} */ (p.get('bar'))]
      if (!intervalo) throw new Error(`barra inesperada en el test: ${url}`)
      const velas = cotizacion === 'EUR' ? series.eur : series[/** @type {'1h'|'4h'|'1d'} */ (intervalo)]
      return { cuerpo: aRespuestaOkx(servidasEn(velas, ahora, Number(p.get('limit'))), ahora) }
    }
    if (url.startsWith('https://api.alternative.me/fng/')) return { cuerpo: FNG }
    if (funding && url.startsWith('https://www.okx.com/api/v5/public/funding-rate?')) {
      const instId = /** @type {string} */ (new URL(url).searchParams.get('instId'))
      if (funding[instId]) return { cuerpo: { code: '0', msg: '', data: [{ instId, fundingRate: funding[instId] }] } }
    }
    if (url.startsWith('https://www.okx.com/api/v5/public/') || url.startsWith('https://www.okx.com/api/v5/rubik/')) {
      return { estado: 503, cuerpo: '' }
    }
    if (url === GROQ || url.startsWith(GEMINI)) return { estado: 500, cuerpo: '' }
    throw new Error(`URL inesperada en el test: ${url}`)
  })
}

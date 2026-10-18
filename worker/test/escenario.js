// @ts-check
// Escenario sintético de varias horas para los tests del Worker (nunca se usa en producción):
// tendencia alcista limpia en USDT (la estrategia v1 da COMPRAR con confianza 0,75) y, en EUR,
// un desplome de BTC en la vela CIERRE (stop-loss) y un pico de ETH en CIERRE + 2 h (take-profit).
import { HORA } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { GEMINI, GROQ } from '../src/fuentes/llm.js'
import { aFilasBinance, fixtureJson, simularFetch } from './ayudantes.js'

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
    '1h': subida(HORA, 300),
    '4h': subida(4 * HORA, 300),
    '1d': subida(24 * HORA, 300),
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

/**
 * Lo que serviría Binance en `ahora`: velas ya empezadas (incluida la que sigue abierta), las 500 últimas.
 * @param {Vela[]} velas
 * @param {number} ahora
 */
export const servidasEn = (velas, ahora) => velas.filter((v) => v.inicio < ahora).slice(-500)

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

/**
 * Binance y alternative.me simulados sobre el escenario en el instante `ahora`. fapi responde 451 (bloqueado),
 * Groq y Gemini 500. Una moneda que no está en el escenario usa las series de BTC.
 * @param {ReturnType<typeof crearEscenario>} escenario
 * @param {number} ahora
 * @param {{ caidas?: string[], premium?: object[]|null }} [op] caidas: pares cuyas velas responden 500
 *   (p. ej. 'SOLUSDT'); premium: respuesta de /fapi/v1/premiumIndex (el resto de fapi sigue en 451).
 */
export function fetchEscenario(escenario, ahora, { caidas = [], premium = null } = {}) {
  return simularFetch((url) => {
    if (url.startsWith('https://data-api.binance.vision/api/v3/klines')) {
      const p = new URL(url).searchParams
      const par = /** @type {string} */ (p.get('symbol'))
      if (caidas.includes(par)) return { estado: 500, cuerpo: '' }
      const eur = par.endsWith('EUR')
      const series = escenario[par.replace(/(USDT|EUR)$/, '')] ?? escenario.BTC
      const velas = eur ? series.eur : series[/** @type {'1h'|'4h'|'1d'} */ (p.get('interval'))]
      return { cuerpo: aFilasBinance(servidasEn(velas, ahora)) }
    }
    if (url.startsWith('https://api.alternative.me/fng/')) return { cuerpo: FNG }
    if (premium && url === 'https://fapi.binance.com/fapi/v1/premiumIndex') return { cuerpo: premium }
    if (url.startsWith('https://fapi.binance.com/')) return { estado: 451, cuerpo: '' }
    if (url === GROQ || url.startsWith(GEMINI)) return { estado: 500, cuerpo: '' }
    throw new Error(`URL inesperada en el test: ${url}`)
  })
}

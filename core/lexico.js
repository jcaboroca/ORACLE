// @ts-check
// Análisis de titulares sin IA: último recurso cuando ningún LLM responde. Puro, sin red.

/** Alias por moneda. Se buscan como palabras completas sobre el texto normalizado. */
export const ALIAS_MONEDAS = Object.freeze({
  BTC: Object.freeze(['bitcoin', 'btc']),
  ETH: Object.freeze(['ethereum', 'ether', 'eth']),
  SOL: Object.freeze(['solana', 'sol']),
  BNB: Object.freeze(['bnb', 'binance coin', 'bnb chain']),
  XRP: Object.freeze(['xrp', 'ripple']),
})

export const POSITIVAS = Object.freeze([
  'surge', 'surges', 'surged', 'soar', 'soars', 'soared', 'rally', 'rallies', 'rallied',
  'jump', 'jumps', 'jumped', 'gain', 'gains', 'climb', 'climbs', 'rise', 'rises', 'bullish',
  'record high', 'all time high', 'ath', 'breakout', 'rebound', 'rebounds', 'recovers', 'recovery',
  'approval', 'approved', 'approves', 'adoption', 'inflows', 'upgrade', 'partnership',
  'buys', 'accumulate', 'accumulates',
  'sube', 'suben', 'dispara', 'alcista', 'maximo historico', 'aprobacion', 'aprueba', 'adopcion',
])

export const NEGATIVAS = Object.freeze([
  'crash', 'crashes', 'crashed', 'plunge', 'plunges', 'plunged', 'drop', 'drops', 'dropped',
  'fall', 'falls', 'fell', 'slump', 'slumps', 'tumble', 'tumbles', 'sink', 'sinks', 'bearish',
  'hack', 'hacked', 'hacker', 'hackers', 'exploit', 'exploited', 'stolen', 'theft', 'unauthorized',
  'lawsuit', 'sues', 'sued', 'ban', 'bans', 'banned', 'outflows', 'liquidation', 'liquidations',
  'sell off', 'selloff', 'dump', 'dumps', 'fraud', 'scam', 'investigation', 'probe',
  'delist', 'delists', 'delisting', 'halted', 'halts', 'bankruptcy', 'insolvent',
  'cae', 'caen', 'caida', 'desploma', 'bajista', 'hackeo', 'robo', 'demanda', 'prohibe',
  'prohibicion', 'quiebra', 'fraude', 'estafa',
])

/**
 * Minúsculas, sin acentos y con todo lo que no sea letra o número convertido en espacio.
 * Devuelve el texto rodeado de un espacio para buscar palabras completas con `includes(' x ')`.
 * @param {string} texto
 */
export function normalizarTexto(texto) {
  const limpio = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
  return ` ${limpio} `
}

/** @param {string} texto normalizado @param {readonly string[]} terminos */
const contar = (texto, terminos) => terminos.filter((t) => texto.includes(normalizarTexto(t))).length

/**
 * Monedas seguidas que menciona el titular, en el orden de ALIAS_MONEDAS.
 * @param {string} titulo
 * @returns {string[]}
 */
export function detectarMonedas(titulo) {
  const texto = normalizarTexto(titulo)
  return Object.entries(ALIAS_MONEDAS).filter(([, alias]) => contar(texto, alias) > 0).map(([simbolo]) => simbolo)
}

/**
 * (positivas − negativas) / máx(2, positivas + negativas): un acierto vale ±0,5 y dos del mismo signo ±1.
 * @param {string} titulo
 * @returns {number} en [-1, 1]
 */
export function puntuarTitular(titulo) {
  const texto = normalizarTexto(titulo)
  const positivas = contar(texto, POSITIVAS)
  const negativas = contar(texto, NEGATIVAS)
  return (positivas - negativas) / Math.max(2, positivas + negativas)
}

/**
 * Sin monedas reconocidas el titular cuenta como de mercado general.
 * @param {string} titulo
 * @returns {{ puntuacion: number, monedas: string[] }}
 */
export function analizarTitular(titulo) {
  const monedas = detectarMonedas(titulo)
  return { puntuacion: puntuarTitular(titulo), monedas: monedas.length > 0 ? monedas : ['MERCADO'] }
}

// @ts-check
// Rumores de Reddit, best-effort: el feed Atom (.rss) de cada subreddit. El .json responde 403
// a clientes que no son navegador y Reddit limita mucho las IPs de nube; si falla, se ignora.
import { pedirTexto } from './http.js'
import { leerFeed } from './rss.js'

/** @typedef {import('./rss.js').TitularCrudo} TitularCrudo */

export const SUBREDDITS = Object.freeze(['CryptoCurrency', 'Bitcoin', 'ethereum'])

export const CABECERAS_REDDIT = Object.freeze({
  'User-Agent': 'web:oracle-paper-trading:v0.1 (simulacion personal)',
  Accept: 'application/atom+xml',
})

/** @param {string} subreddit */
export const urlSubreddit = (subreddit) => `https://www.reddit.com/r/${subreddit}/new/.rss?limit=25`

/**
 * @param {string} xml
 * @param {string} subreddit
 * @returns {TitularCrudo[]}
 */
export const leerReddit = (xml, subreddit) => leerFeed(xml, `r/${subreddit}`, 'reddit')

/**
 * 3 subpeticiones en paralelo.
 * @param {typeof fetch} fetch
 * @returns {Promise<{ titulares: TitularCrudo[], fallos: string[] }>}
 */
export async function descargarReddit(fetch) {
  const resultados = await Promise.allSettled(SUBREDDITS.map(async (s) => (
    leerReddit(await pedirTexto(fetch, urlSubreddit(s), { headers: CABECERAS_REDDIT }), s)
  )))
  /** @type {TitularCrudo[]} */
  const titulares = []
  /** @type {string[]} */
  const fallos = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') titulares.push(...r.value)
    else fallos.push(`reddit r/${SUBREDDITS[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
  })
  return { titulares, fallos }
}

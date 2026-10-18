// @ts-check
// Titulares de feeds RSS 2.0 y Atom con expresiones regulares (sin librerías XML: CPU mínima).
import { pedirTexto } from './http.js'

/** @typedef {{ fuente: string, origen: 'rss'|'reddit', titulo: string, url: string|null, publicadoEn: number }} TitularCrudo */

/** Los 14 feeds de CryptoTrade (14 subpeticiones). */
export const FEEDS = Object.freeze([
  { fuente: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { fuente: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { fuente: 'Decrypt', url: 'https://decrypt.co/feed' },
  { fuente: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed/' },
  { fuente: 'Bitcoin.com News', url: 'https://news.bitcoin.com/feed/' },
  { fuente: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { fuente: 'NewsBTC', url: 'https://www.newsbtc.com/feed/' },
  { fuente: 'CryptoPotato', url: 'https://cryptopotato.com/feed/' },
  { fuente: 'AMBCrypto', url: 'https://ambcrypto.com/feed/' },
  { fuente: 'U.Today', url: 'https://u.today/rss' },
  { fuente: 'BeInCrypto', url: 'https://beincrypto.com/feed/' },
  { fuente: 'CoinGape', url: 'https://coingape.com/feed/' },
  { fuente: 'Bitcoinist', url: 'https://bitcoinist.com/feed/' },
  { fuente: 'CryptoBriefing', url: 'https://cryptobriefing.com/feed/' },
])

export const CABECERAS_FEED = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (compatible; ORACLE/0.1; simulacion personal)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
})

/** @type {Record<string, string>} */
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** @param {string} texto */
export function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === '#') {
      const codigo = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo
    }
    return ENTIDADES[e.toLowerCase()] ?? todo
  })
}

/**
 * Texto plano: quita CDATA y etiquetas, decodifica entidades y compacta espacios.
 * @param {string|null} texto
 */
export function limpiar(texto) {
  if (texto === null) return ''
  const sinCdata = texto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodificarEntidades(sinCdata.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Contenido de la primera etiqueta `<nombre>…</nombre>` (no autocerrada) del bloque.
 * @param {string} bloque
 * @param {string} nombre p. ej. 'title', 'pubDate', 'dc:date'
 */
function etiqueta(bloque, nombre) {
  const m = bloque.match(new RegExp(`<${nombre}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${nombre}>`, 'i'))
  return m ? m[1] : null
}

/** @param {string} bloque */
function enlace(bloque) {
  const texto = limpiar(etiqueta(bloque, 'link'))
  if (texto) return texto
  const atom = bloque.match(/<link\b[^>]*\bhref="([^"]+)"/i)
  return atom ? decodificarEntidades(atom[1]) : null
}

/**
 * Titulares de un feed RSS 2.0 (`<item>`) o Atom (`<entry>`). Descarta los que no tienen título o fecha.
 * @param {string} xml
 * @param {string} fuente
 * @param {'rss'|'reddit'} [origen]
 * @returns {TitularCrudo[]}
 */
export function leerFeed(xml, fuente, origen = 'rss') {
  const bloques = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  /** @type {TitularCrudo[]} */
  const titulares = []
  for (const bloque of bloques) {
    const titulo = limpiar(etiqueta(bloque, 'title'))
    const fecha = etiqueta(bloque, 'pubDate') ?? etiqueta(bloque, 'published') ?? etiqueta(bloque, 'updated')
      ?? etiqueta(bloque, 'dc:date')
    const publicadoEn = Date.parse(limpiar(fecha))
    if (!titulo || !Number.isFinite(publicadoEn)) continue
    titulares.push({ fuente, origen, titulo, url: enlace(bloque), publicadoEn })
  }
  return titulares
}

/**
 * Descarga todos los feeds en paralelo. Uno que falle se ignora y se anota.
 * @param {typeof fetch} fetch
 * @returns {Promise<{ titulares: TitularCrudo[], fallos: string[] }>}
 */
export async function descargarFeeds(fetch) {
  const resultados = await Promise.allSettled(FEEDS.map(async (f) => (
    leerFeed(await pedirTexto(fetch, f.url, { headers: CABECERAS_FEED }), f.fuente)
  )))
  /** @type {TitularCrudo[]} */
  const titulares = []
  /** @type {string[]} */
  const fallos = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') titulares.push(...r.value)
    else fallos.push(`rss ${FEEDS[i].fuente}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
  })
  return { titulares, fallos }
}

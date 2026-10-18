// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CABECERAS_REDDIT, SUBREDDITS, descargarReddit, leerReddit, urlSubreddit } from '../src/fuentes/reddit.js'
import { FEEDS, decodificarEntidades, descargarFeeds, leerFeed, limpiar } from '../src/fuentes/rss.js'
import { fixtureTexto, simularFetch } from './ayudantes.js'

const RSS = fixtureTexto('rss-cointelegraph.xml')
const REDDIT = fixtureTexto('reddit-cryptocurrency.xml')

describe('rss', () => {
  test('lee los 3 items del fixture real de CoinTelegraph (RSS 2.0)', () => {
    const t = leerFeed(RSS, 'CoinTelegraph')
    assert.equal(t.length, 3)
    assert.deepEqual(t[0], {
      fuente: 'CoinTelegraph',
      origen: 'rss',
      titulo: 'Here’s what happened in crypto today',
      url: 'https://cointelegraph.com/news/what-happened-in-crypto-today?utm_source=rss_feed&utm_medium=rss&utm_campaign=rss_partner_inbound',
      publicadoEn: Date.parse('2026-10-18T13:54:00Z'),
    })
    assert.equal(t[2].titulo, 'Cysic crypto bridge halted after unauthorized mint of 10M CYS')
    assert.equal(t[2].publicadoEn, Date.parse('2026-10-18T10:46:00Z'))
  })

  test('limpiar quita CDATA y etiquetas y decodifica entidades', () => {
    assert.equal(limpiar('<![CDATA[<b>BTC</b> &amp; ETH]]>'), 'BTC & ETH')
    assert.equal(limpiar('  Ripple&#8217;s   win &#x2014; XRP &lt; $3 '), 'Ripple’s win — XRP < $3')
    assert.equal(limpiar(null), '')
    assert.equal(decodificarEntidades('&desconocida; &#0;'), '&desconocida; &#0;')
  })

  test('descarta items sin título o con fecha ilegible', () => {
    const xml = `<rss><channel>
      <item><title></title><pubDate>Sun, 18 Oct 2026 13:54:00 +0000</pubDate></item>
      <item><title>Sin fecha</title><pubDate>ayer</pubDate></item>
      <item><title>Válido</title><dc:date>2026-10-18T10:00:00Z</dc:date><link>https://x.test/a</link></item>
    </channel></rss>`
    assert.deepEqual(leerFeed(xml, 'X'), [
      { fuente: 'X', origen: 'rss', titulo: 'Válido', url: 'https://x.test/a', publicadoEn: Date.parse('2026-10-18T10:00:00Z') },
    ])
  })

  test('descargarFeeds: 14 feeds en paralelo; los que fallan se anotan y no paran el resto', async () => {
    const fetch = simularFetch((url) => {
      if (url === 'https://cointelegraph.com/rss') return { cuerpo: RSS }
      if (url === 'https://decrypt.co/feed') return { error: new Error('timeout') }
      return { estado: 403, cuerpo: '' }
    })
    const { titulares, fallos } = await descargarFeeds(fetch)
    assert.equal(fetch.llamadas.length, FEEDS.length)
    assert.equal(FEEDS.length, 14)
    assert.equal(titulares.length, 3)
    assert.equal(fallos.length, 13)
    assert.ok(fallos.includes('rss Decrypt: timeout'))
    assert.ok(fallos.includes('rss CoinDesk: HTTP 403'))
  })
})

describe('reddit', () => {
  test('lee las 3 entradas del fixture real de r/CryptoCurrency (Atom)', () => {
    const t = leerReddit(REDDIT, 'CryptoCurrency')
    assert.deepEqual(t.map((x) => x.titulo), [
      'Solana Ecosystem News - October 18-2026',
      "Bitcoin's Quantum Transition Won't Stop at Bitcoin",
      'Saved by KYC',
    ])
    assert.deepEqual(t[0], {
      fuente: 'r/CryptoCurrency',
      origen: 'reddit',
      titulo: 'Solana Ecosystem News - October 18-2026',
      url: 'https://www.reddit.com/r/CryptoCurrency/comments/1x991yw/solana_ecosystem_news_october_182026/',
      publicadoEn: Date.parse('2026-10-18T17:31:51Z'),
    })
  })

  test('descargarReddit: 3 subreddits con User-Agent propio; 429 se anota', async () => {
    const fetch = simularFetch((url) => (url === urlSubreddit('CryptoCurrency') ? { cuerpo: REDDIT } : { estado: 429, cuerpo: '' }))
    const { titulares, fallos } = await descargarReddit(fetch)
    assert.deepEqual(fetch.llamadas.map((l) => l.url), SUBREDDITS.map(urlSubreddit))
    assert.equal(fetch.llamadas[0].init?.headers, CABECERAS_REDDIT)
    assert.equal(titulares.length, 3)
    assert.deepEqual(fallos, ['reddit r/Bitcoin: HTTP 429', 'reddit r/ethereum: HTTP 429'])
  })
})

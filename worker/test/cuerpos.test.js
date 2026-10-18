// @ts-check
// Cada respuesta HTTP se lee entera o se cancela, también en los errores: un cuerpo sin leer bloquea la
// conexión y Workers lo corta con «A stalled HTTP response was canceled to prevent deadlock».
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { descargarFng } from '../src/fuentes/fng.js'
import { pedirJson, pedirTexto } from '../src/fuentes/http.js'
import { completarJson } from '../src/fuentes/llm.js'
import { descargarReddit } from '../src/fuentes/reddit.js'
import { descargarFeeds } from '../src/fuentes/rss.js'
import { cuerposConsumidos, simularFetch } from './ayudantes.js'

describe('cuerpos de las respuestas', () => {
  test('pedirJson y pedirTexto: HTTP de error → excepción con el código y el cuerpo cancelado', async () => {
    const fetch = simularFetch(() => ({ estado: 503, cuerpo: '<html>caído</html>' }))
    await assert.rejects(pedirJson(fetch, 'https://x.test/a'), /^Error: HTTP 503$/)
    await assert.rejects(pedirTexto(fetch, 'https://x.test/b'), /^Error: HTTP 503$/)
    assert.ok(cuerposConsumidos(fetch))
  })

  test('pedirJson y pedirTexto: respuesta correcta leída entera', async () => {
    const fetch = simularFetch((url) => ({ cuerpo: url.endsWith('json') ? { a: 1 } : 'hola' }))
    assert.deepEqual(await pedirJson(fetch, 'https://x.test/json', { headers: { A: 'b' } }), { a: 1 })
    assert.equal(await pedirTexto(fetch, 'https://x.test/texto'), 'hola')
    assert.deepEqual(fetch.llamadas[0].init, { headers: { A: 'b' } })
    assert.ok(cuerposConsumidos(fetch))
  })

  test('Fear & Greed, RSS y Reddit caídos no dejan cuerpos sin leer', async () => {
    const fetch = simularFetch(() => ({ estado: 500, cuerpo: 'error' }))
    await assert.rejects(descargarFng(fetch), /HTTP 500/)
    const feeds = await descargarFeeds(fetch)
    const reddit = await descargarReddit(fetch)
    assert.ok(feeds.fallos.length > 0 && reddit.fallos.length > 0)
    assert.ok(cuerposConsumidos(fetch))
  })

  test('Groq y Gemini caídos no dejan cuerpos sin leer', async () => {
    const fetch = simularFetch(() => ({ estado: 429, cuerpo: '{"error":"cuota"}' }))
    const r = await completarJson({
      env: { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }, fetch, sistema: 's', usuario: 'u', validar: () => null,
    })
    assert.deepEqual(r.fallos, ['llm groq: HTTP 429', 'llm gemini: HTTP 429'])
    assert.ok(cuerposConsumidos(fetch))
  })
})

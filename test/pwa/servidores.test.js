// @ts-check
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, test } from 'node:test'
import { crearApiSimulada } from '../../scripts/api-simulada.mjs'
import { crearServidor } from '../../scripts/servir.mjs'
import { PIN } from './ayudantes.js'

/**
 * Arranca un servidor en un puerto libre, ejecuta `f` y lo cierra.
 * @param {import('node:http').Server} servidor
 * @param {(base: string) => Promise<void>} f
 */
async function con(servidor, f) {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', () => r(undefined)))
  const { port } = /** @type {import('node:net').AddressInfo} */ (servidor.address())
  try {
    await f(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => servidor.close(() => r(undefined)))
  }
}

/** GET con la ruta tal cual (sin normalizar /../, como haría un atacante); devuelve el código HTTP. @param {string} base @param {string} ruta */
const crudo = (base, ruta) => new Promise((resolver, rechazar) => {
  const u = new URL(base)
  request({ host: u.hostname, port: u.port, path: ruta }, (r) => {
    r.resume()
    r.on('end', () => resolver(r.statusCode))
  }).on('error', rechazar).end()
})

describe('servidor estático de desarrollo', () => {
  test('sirve la app con su tipo MIME, sin caché, y nada fuera de la raíz', async () => {
    await con(crearServidor(), async (base) => {
      const portada = await fetch(`${base}/`)
      assert.equal(portada.status, 200)
      assert.equal(portada.headers.get('content-type'), 'text/html; charset=utf-8')
      assert.equal(portada.headers.get('cache-control'), 'no-store')
      assert.match(await portada.text(), /<title>ORACLE<\/title>/)
      const tipos = {
        '/js/app.js': 'text/javascript; charset=utf-8',
        '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
        '/icons/apple-touch-icon.png': 'image/png',
        '/data/backtest-v1.json': 'application/json; charset=utf-8',
      }
      for (const [ruta, tipo] of Object.entries(tipos)) {
        const r = await fetch(base + ruta)
        assert.equal(r.status, 200, ruta)
        assert.equal(r.headers.get('content-type'), tipo, ruta)
        await r.arrayBuffer()
      }
      assert.equal((await fetch(`${base}/no-existe.js`)).status, 404)
      // Las rutas que intentan salir de la raíz quedan dentro de ella (y no existen): nunca se sirve /etc/passwd.
      for (const ruta of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2F..%2F..%2Fetc%2Fpasswd']) {
        assert.equal(await crudo(base, ruta), 404, ruta)
      }
      assert.equal(await crudo(base, '/%E0%A4%A'), 400)
    })
  })
})

describe('API simulada de desarrollo', () => {
  test('es el Worker real: salud pública, PIN obligatorio y CORS para localhost:8080', async () => {
    await con(await crearApiSimulada(), async (base) => {
      assert.equal((await fetch(`${base}/api/salud`)).status, 200)
      assert.equal((await fetch(`${base}/api/resumen`)).status, 401)
      const r = await fetch(`${base}/api/resumen`, { headers: { Authorization: `Bearer ${PIN}`, Origin: 'http://localhost:8080' } })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080')
      assert.deepEqual((await r.json()).senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
      const reinicio = await fetch(`${base}/api/bot/reiniciar`, {
        method: 'POST', headers: { Authorization: `Bearer ${PIN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ capital_inicial: 2000, confirmar: true }),
      })
      assert.equal(reinicio.status, 201)
    })
  })
})

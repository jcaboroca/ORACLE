// @ts-check
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import { leerPng } from '../../scripts/iconos.mjs'
import { RAIZ, leer, modulosDeLaApp } from './modulos.js'

const AMBITO = 'https://jcaboroca.github.io/ORACLE/'

/**
 * Carga sw.js en un entorno mínimo de service worker con caché y red simuladas.
 * @param {{ red?: (url: string) => Response|Promise<Response> }} [op]
 */
function cargarSw({ red = (url) => new Response(`red:${url}`) } = {}) {
  /** @type {Record<string, (e: any) => void>} */
  const manejadores = {}
  /** @type {Map<string, Map<string, Response>>} */
  const almacenes = new Map()
  const llamadasRed = /** @type {string[]} */ ([])
  const almacen = (/** @type {string} */ nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map())
    const mapa = /** @type {Map<string, Response>} */ (almacenes.get(nombre))
    return {
      mapa,
      async addAll(/** @type {Request[]} */ peticiones) { for (const p of peticiones) mapa.set(p.url, new Response(`guardado:${p.url}`)) },
      async put(/** @type {string} */ clave, /** @type {Response} */ r) { mapa.set(String(clave), r) },
      async match(/** @type {string} */ clave) { return mapa.get(String(clave))?.clone() },
    }
  }
  class RequestRelativa extends Request {
    /** @param {string} url @param {RequestInit} [init] */
    constructor(url, init) { super(new URL(url, AMBITO), init) }
  }
  const self = {
    registration: { scope: AMBITO },
    location: new URL('sw.js', AMBITO),
    skipWaiting: async () => { self.saltado = true },
    saltado: false,
    clients: { claim: async () => {} },
    addEventListener: (/** @type {string} */ tipo, /** @type {(e: any) => void} */ f) => { manejadores[tipo] = f },
  }
  const caches = {
    open: async (/** @type {string} */ n) => almacen(n),
    keys: async () => [...almacenes.keys()],
    delete: async (/** @type {string} */ n) => almacenes.delete(n),
  }
  const fetch = async (/** @type {string} */ url) => {
    llamadasRed.push(String(url))
    return red(String(url))
  }
  vm.runInNewContext(leer('sw.js'), { self, caches, fetch, Request: RequestRelativa, Response, URL, Promise, Set, Map })
  /** @param {string} tipo @param {Record<string, unknown>} [extra] */
  async function disparar(tipo, extra = {}) {
    /** @type {Promise<unknown>[]} */
    const esperas = []
    /** @type {Promise<Response>|null} */
    let respuesta = null
    manejadores[tipo]({
      ...extra,
      waitUntil: (/** @type {Promise<unknown>} */ p) => esperas.push(p),
      respondWith: (/** @type {Promise<Response>} */ p) => { respuesta = p },
    })
    const r = respuesta ? await respuesta : null
    await Promise.all(esperas)
    return r
  }
  return { self, almacenes, almacen, llamadasRed, disparar }
}

/** @param {string} url @param {string} [metodo] */
const peticion = (url, metodo = 'GET') => ({ request: new Request(url, { method: metodo }) })

describe('service worker: solo la estructura de la app', () => {
  test('al instalar guarda toda la estructura en una caché versionada', async () => {
    const sw = cargarSw()
    await sw.disparar('install')
    const [nombre] = sw.almacenes.keys()
    assert.match(nombre, /^oracle-v\d+$/)
    const guardadas = [...(/** @type {Map<string, Response>} */ (sw.almacenes.get(nombre))).keys()]
    assert.ok(guardadas.includes(AMBITO))
    assert.ok(guardadas.includes(`${AMBITO}vendor/lightweight-charts.standalone.production.js`))
    assert.ok(guardadas.every((u) => u.startsWith(AMBITO)), 'todo bajo /ORACLE/')
    assert.equal(sw.self.saltado, true)
  })

  test('cada archivo de la estructura existe y están todos los módulos que carga js/app.js', async () => {
    const sw = cargarSw()
    await sw.disparar('install')
    const rutas = [...(/** @type {Map<string, Response>} */ ([...sw.almacenes.values()][0])).keys()].map((u) => u.slice(AMBITO.length))
    for (const ruta of rutas) if (ruta !== '') assert.ok(existsSync(new URL(ruta, RAIZ)), `falta ${ruta}`)
    const modulos = modulosDeLaApp()
    assert.ok(modulos.includes('config.js') && modulos.includes('core/indicadores.js') && modulos.includes('js/velas.js'))
    assert.ok(!modulos.some((m) => m.startsWith('worker/')), 'la app no carga código del Worker')
    for (const m of modulos) assert.ok(rutas.includes(m), `${m} no está en la estructura de sw.js`)
    for (const m of readdirSync(new URL('js/vistas/', RAIZ))) assert.ok(rutas.includes(`js/vistas/${m}`), m)
  })

  test('la API del Worker, Binance, OKX, data/*.json y los POST no pasan por el service worker', async () => {
    const sw = cargarSw()
    for (const url of [
      'https://oracle.x.workers.dev/api/resumen',
      'https://data-api.binance.vision/api/v3/klines?symbol=BTCEUR&interval=1h&limit=500',
      'https://www.okx.com/api/v5/market/candles?instId=BTC-EUR&bar=1H&limit=300',
      `${AMBITO}data/backtest-v1.json`,
    ]) {
      assert.equal(await sw.disparar('fetch', peticion(url)), null, url)
    }
    assert.equal(await sw.disparar('fetch', peticion(`${AMBITO}js/app.js`, 'POST')), null)
    assert.deepEqual(sw.llamadasRed, [])
  })

  test('estructura: red primero (y se guarda); sin red, la copia guardada', async () => {
    let conRed = true
    const sw = cargarSw({ red: (url) => (conRed ? new Response(`nuevo:${url}`) : Promise.reject(new TypeError('sin red'))) })
    await sw.disparar('install')
    const online = await sw.disparar('fetch', peticion(`${AMBITO}js/app.js?v=2#x`))
    assert.equal(await online?.text(), `nuevo:${AMBITO}js/app.js`)
    conRed = false
    const offline = await sw.disparar('fetch', peticion(`${AMBITO}js/app.js`))
    assert.equal(await offline?.text(), `nuevo:${AMBITO}js/app.js`)
    const portada = await sw.disparar('fetch', peticion(AMBITO))
    assert.equal(await portada?.text(), `guardado:${AMBITO}`)
  })

  test('al activar borra las versiones anteriores de ORACLE y no toca otras cachés', async () => {
    const sw = cargarSw()
    sw.almacen('oracle-v0')
    sw.almacen('otra-app')
    await sw.disparar('install')
    await sw.disparar('activate')
    const nombres = [...sw.almacenes.keys()]
    assert.ok(!nombres.includes('oracle-v0'))
    assert.ok(nombres.includes('otra-app'))
    assert.equal(nombres.filter((n) => n.startsWith('oracle-')).length, 1)
  })
})

describe('instalable en el iPhone y en Android', () => {
  const html = leer('index.html')

  test('index.html: icono de inicio, modo app, título, barra de estado, tema y zona segura', () => {
    for (const fragmento of [
      '<html lang="es">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="ORACLE">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="theme-color" content="#0b0f17">',
      '<link rel="manifest" href="manifest.webmanifest">',
      '<script type="module" src="js/app.js"></script>',
    ]) assert.ok(html.includes(fragmento), fragmento)
    assert.match(leer('styles.css'), /env\(safe-area-inset-bottom\)/)
  })

  test('rutas relativas: funciona bajo /ORACLE/ en GitHub Pages', () => {
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(!url.startsWith('/') && !url.startsWith('http'), url)
      if (!url.startsWith('#')) assert.ok(existsSync(new URL(url, RAIZ)), `falta ${url}`)
    }
  })

  test('manifest: standalone, ámbito relativo, colores e iconos any + maskable que existen', () => {
    const m = JSON.parse(leer('manifest.webmanifest'))
    assert.deepEqual([m.short_name, m.start_url, m.scope, m.display, m.lang], ['ORACLE', './', './', 'standalone', 'es'])
    assert.deepEqual([m.background_color, m.theme_color], ['#0b0f17', '#0b0f17'])
    const maskable = m.icons.filter((/** @type {any} */ i) => i.purpose === 'maskable')
    assert.equal(maskable.length, 1)
    for (const icono of m.icons) {
      assert.ok(existsSync(new URL(icono.src, RAIZ)), icono.src)
      if (icono.type === 'image/png') {
        const p = leerPng(readFileSync(new URL(icono.src, RAIZ)))
        assert.equal(`${p.ancho}x${p.alto}`, icono.sizes)
      }
    }
    assert.deepEqual(m.icons.filter((/** @type {any} */ i) => i.type === 'image/png').map((/** @type {any} */ i) => i.sizes).sort(), ['192x192', '512x512', '512x512'])
  })
})

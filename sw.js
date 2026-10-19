// ORACLE · service worker. Guarda SOLO la estructura de la app (HTML, CSS, JS, iconos y la librería de
// gráficos) para abrir sin conexión. Nunca guarda datos: ni la API del Worker, ni Binance/OKX, ni data/*.json.
// Estrategia: red primero (una versión nueva entra sin trucos) y, sin red, la copia guardada.
// Al cambiar cualquier archivo de ESTRUCTURA, sube VERSION.

const VERSION = 'oracle-v1'
const ESTRUCTURA = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './config.js',
  './js/app.js',
  './js/api.js',
  './js/cartera.js',
  './js/dom.js',
  './js/formato.js',
  './js/graficos.js',
  './js/refresco.js',
  './js/rutas.js',
  './js/senal.js',
  './js/series.js',
  './js/sesion.js',
  './js/velas.js',
  './js/vistas/backtest.js',
  './js/vistas/bot.js',
  './js/vistas/comun.js',
  './js/vistas/login.js',
  './js/vistas/moneda.js',
  './js/vistas/panel.js',
  './core/estrategia-v1.js',
  './core/estrategia-v2.js',
  './core/estrategias.js',
  './core/indicadores.js',
  './core/velas.js',
  './vendor/lightweight-charts.standalone.production.js',
  './icons/icono.svg',
  './icons/apple-touch-icon.png',
  './icons/icono-192.png',
  './icons/icono-512.png',
  './icons/icono-maskable-512.png',
]

const enEstructura = new Set(ESTRUCTURA.map((ruta) => new URL(ruta, self.registration.scope).href))

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ESTRUCTURA.map((ruta) => new Request(ruta, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith('oracle-') && n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  const url = new URL(peticion.url)
  url.hash = ''
  url.search = ''
  const clave = url.href
  // Lo que no es estructura (API, Binance, OKX, data/*.json…) va directo a la red, sin pasar por la caché.
  if (!enEstructura.has(clave)) return
  evento.respondWith(
    fetch(clave, { cache: 'no-store' })
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone()
          evento.waitUntil(caches.open(VERSION).then((cache) => cache.put(clave, copia)))
        }
        return respuesta
      })
      .catch(() => caches.open(VERSION).then((cache) => cache.match(clave)).then((guardada) => guardada || Response.error())),
  )
})

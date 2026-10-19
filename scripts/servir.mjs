// @ts-check
// Servidor estático mínimo para probar la PWA en local (los módulos ES no funcionan desde file://).
// No es para producción: la PWA se publica en GitHub Pages.
//
//   node scripts/servir.mjs            → http://localhost:8080 (PUERTO=… para cambiarlo)
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const PUERTO = 8080
/** Solo en local: nunca expone el repositorio a la red. */
export const ANFITRION = '127.0.0.1' // http://localhost:… sigue funcionando (mismo origen que admite el CORS)

/** @type {Record<string, string>} */
export const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
}

/** @param {{ raiz?: string }} [op] */
export function crearServidor({ raiz = RAIZ } = {}) {
  return createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? '/', 'http://localhost')
    let ruta
    try {
      ruta = decodeURIComponent(url.pathname)
    } catch {
      respuesta.writeHead(400).end('Ruta mal formada')
      return
    }
    if (ruta.endsWith('/')) ruta += 'index.html'
    // Nada oculto: ni .git/ ni worker/.dev.vars (secretos de desarrollo).
    if (ruta.split(/[\\/]/).some((parte) => parte.startsWith('.'))) {
      respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe')
      return
    }
    const destino = join(raiz, normalize(ruta))
    // Sin esto, /../../.ssh/id_rsa saldría del directorio servido.
    if (!destino.startsWith(raiz + sep)) {
      respuesta.writeHead(403).end('Fuera del directorio servido')
      return
    }
    try {
      const info = await stat(destino)
      if (!info.isFile()) throw new Error('no es un archivo')
      respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      createReadStream(destino).pipe(respuesta)
    } catch {
      respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe')
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.PUERTO ?? PUERTO)
  crearServidor().listen(puerto, ANFITRION, () => console.log(`ORACLE en http://localhost:${puerto}`))
}

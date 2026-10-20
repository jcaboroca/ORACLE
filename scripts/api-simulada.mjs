// @ts-check
// API simulada para probar la PWA sin desplegar ni usar wrangler: el Worker real (worker/src/api.js) sobre
// D1 en memoria (node:sqlite) con 6 horas del escenario SINTÉTICO de los tests (BTC y ETH, precios inventados)
// y 3 estrategias de prueba en vivo (v1, v2 y v1b; la principal, v1) para ver la comparativa del Bot.
// Solo desarrollo: nunca se publica ni la usa la PWA desplegada.
//
//   node scripts/api-simulada.mjs      → http://localhost:8787, PIN 4815162342 (PUERTO=… para cambiarlo)
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { PIN, workerSimulado } from '../test/pwa/ayudantes.js'
import { vivoDePrueba } from '../worker/test/vivo.js'

export const PUERTO = 8787
/** Solo en local: nunca expone la API simulada a la red. */
export const ANFITRION = '127.0.0.1'

/** @param {import('node:http').IncomingMessage} peticion */
async function cuerpoDe(peticion) {
  /** @type {Buffer[]} */
  const trozos = []
  for await (const trozo of peticion) trozos.push(trozo)
  return trozos.length > 0 ? Buffer.concat(trozos) : undefined
}

/** Servidor HTTP que atiende con el Worker simulado. */
export async function crearApiSimulada() {
  const w = await workerSimulado({ vivo: vivoDePrueba(['v1', 'v2', 'v1b'], 'v1') })
  return createServer(async (peticion, respuesta) => {
    const cabeceras = new Headers()
    for (const [clave, valor] of Object.entries(peticion.headers)) if (typeof valor === 'string') cabeceras.set(clave, valor)
    const r = await w.fetch(`https://oracle.simulado${peticion.url}`, {
      method: peticion.method, headers: cabeceras, body: peticion.method === 'GET' || peticion.method === 'HEAD' ? undefined : await cuerpoDe(peticion),
    })
    respuesta.writeHead(r.status, Object.fromEntries(r.headers))
    respuesta.end(Buffer.from(await r.arrayBuffer()))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.PUERTO ?? PUERTO)
  const servidor = await crearApiSimulada()
  servidor.listen(puerto, ANFITRION, () => console.log(`API simulada (datos sintéticos de los tests) en http://localhost:${puerto} · PIN ${PIN}`))
}

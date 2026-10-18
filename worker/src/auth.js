// @ts-check
// PIN único (Authorization: Bearer <PIN>) comparado en tiempo constante, con bloqueo por IP,
// y CORS solo para los orígenes de la var ORIGENES. El origen no es la seguridad: lo es el PIN.

export const MAX_FALLOS = 5
export const BLOQUEO_MS = 15 * 60_000

/**
 * Compara los SHA-256 de ambos textos con XOR acumulado: mismo tiempo sea cual sea la diferencia
 * y sin delatar la longitud del PIN.
 * @param {string} a @param {string} b
 */
export async function compararSeguro(a, b) {
  const codificador = new TextEncoder()
  const [ha, hb] = await Promise.all([a, b].map((x) => crypto.subtle.digest('SHA-256', codificador.encode(x))))
  const x = new Uint8Array(ha)
  const y = new Uint8Array(hb)
  let diferencia = 0
  for (let i = 0; i < x.length; i++) diferencia |= x[i] ^ y[i]
  return diferencia === 0
}

/** @param {Request} peticion */
export const ipDe = (peticion) => peticion.headers.get('CF-Connecting-IP') ?? 'desconocida'

/** @param {Request} peticion */
export function pinDe(peticion) {
  const m = /^Bearer\s+(.+)$/i.exec(peticion.headers.get('Authorization') ?? '')
  return m ? m[1].trim() : ''
}

/**
 * @typedef {{ ok: true } | { ok: false, estado: number, cuerpo: { error: string, detalle: string, hasta?: number } }} ResultadoPin
 */

/** @param {number} hasta @returns {ResultadoPin} */
const bloqueado = (hasta) => ({
  ok: false, estado: 429, cuerpo: { error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta },
})

/**
 * Sin bloqueo: compara el PIN. Acierto → borra los fallos de la IP. Fallo → +1; al 5.º, bloqueo de 15 min.
 * Con bloqueo vigente ni siquiera compara. Como mucho 2 llamadas a D1.
 * @param {import('./repositorio.js').D1} db
 * @param {Request} peticion
 * @param {string|undefined} pinEsperado secret ORACLE_PIN
 * @param {number} ahora
 * @returns {Promise<ResultadoPin>}
 */
export async function verificarPin(db, peticion, pinEsperado, ahora) {
  if (!pinEsperado) return { ok: false, estado: 500, cuerpo: { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' } }
  const ip = ipDe(peticion)
  const fila = await db.prepare('SELECT fallos, bloqueado_hasta FROM intentos_pin WHERE ip = ?').bind(ip).first()
  if (fila?.bloqueado_hasta && fila.bloqueado_hasta > ahora) return bloqueado(fila.bloqueado_hasta)
  if (await compararSeguro(pinDe(peticion), pinEsperado)) {
    if (fila) await db.prepare('DELETE FROM intentos_pin WHERE ip = ?').bind(ip).run()
    return { ok: true }
  }
  const fallos = (fila?.fallos ?? 0) + 1
  const hasta = fallos >= MAX_FALLOS ? ahora + BLOQUEO_MS : null
  await db.prepare(
    `INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta) VALUES (?, ?, ?)
     ON CONFLICT (ip) DO UPDATE SET fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta`,
  ).bind(ip, hasta === null ? fallos : 0, hasta).run()
  if (hasta !== null) return bloqueado(hasta)
  return { ok: false, estado: 401, cuerpo: { error: 'pin_incorrecto', detalle: `PIN incorrecto. Quedan ${MAX_FALLOS - fallos} intentos.` } }
}

/** "https://a.io, http://localhost:8080" → lista. @param {string|undefined} texto */
export const leerOrigenes = (texto) => (texto ?? '').split(',').map((o) => o.trim()).filter(Boolean)

/**
 * Cabeceras CORS: solo se abren al origen si está en la lista exacta.
 * @param {string|null} origen
 * @param {string[]} permitidos
 * @returns {Record<string, string>}
 */
export function cabecerasCors(origen, permitidos) {
  if (!origen || !permitidos.includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}

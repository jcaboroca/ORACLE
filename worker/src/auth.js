// @ts-check
// PIN único (Authorization: Bearer <PIN>) comparado en tiempo constante, con bloqueo por IP y tope global,
// y CORS solo para los orígenes de la var ORIGENES. El origen no es la seguridad: lo es el PIN.

export const MAX_FALLOS = 5
export const BLOQUEO_MS = 15 * 60_000
/** Tope de PIN fallidos entre todas las IPs por ventana: un PIN de 4 cifras aguanta así la rotación de IPs. */
export const MAX_FALLOS_GLOBAL = 50
export const VENTANA_GLOBAL_MS = 15 * 60_000

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

/** @param {number} hasta @returns {ResultadoPin} */
const bloqueadoGlobal = (hasta) => ({
  ok: false,
  estado: 429,
  cuerpo: { error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto en total. Espera y vuelve a probar.', hasta },
})

/**
 * Comprueba el PIN reservando el intento ANTES de comparar, en un lote atómico (spec §11):
 * 1. Intento de la IP: +1 (o vuelve a 1 si su bloqueo caducó); al 5.º, bloqueo de 15 min. No cuenta si
 *    hay bloqueo global vigente.
 * 2. Intento global (ventana fija de 15 min): +1 solo si la IP aún puede comparar; el que pasaría de 50
 *    bloquea la comprobación para todos 15 min.
 * Solo se compara si la reserva lo permite, así una ráfaga en paralelo no prueba más de 5 PIN por IP ni más
 * de 50 en total. Acierto → borra la fila de la IP y devuelve su hueco global (los aciertos no cuentan).
 * Como mucho 2 llamadas a D1.
 * @param {import('./repositorio.js').D1} db
 * @param {Request} peticion
 * @param {string|undefined} pinEsperado secret ORACLE_PIN
 * @param {number} ahora
 * @returns {Promise<ResultadoPin>}
 */
export async function verificarPin(db, peticion, pinEsperado, ahora) {
  if (!pinEsperado) return { ok: false, estado: 500, cuerpo: { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' } }
  const ip = ipDe(peticion)
  const hastaIp = ahora + BLOQUEO_MS
  const inicioVentana = ahora - VENTANA_GLOBAL_MS
  const [reservaIp, , estadoGlobal] = await db.batch([
    db.prepare(
      `INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta)
       SELECT ?, 1, NULL WHERE NOT EXISTS (SELECT 1 FROM pin_global WHERE id = 1 AND bloqueado_hasta > ?)
       ON CONFLICT (ip) DO UPDATE SET
         fallos = CASE WHEN bloqueado_hasta > ? THEN MAX(fallos, ?) + 1
                       WHEN bloqueado_hasta IS NOT NULL THEN 1
                       ELSE fallos + 1 END,
         bloqueado_hasta = CASE WHEN bloqueado_hasta > ? THEN bloqueado_hasta
                                WHEN bloqueado_hasta IS NULL AND fallos + 1 >= ? THEN ?
                                ELSE NULL END
       RETURNING fallos, bloqueado_hasta`,
    ).bind(ip, ahora, ahora, MAX_FALLOS, ahora, MAX_FALLOS, hastaIp),
    db.prepare(
      `INSERT INTO pin_global (id, desde, fallos, bloqueado_hasta)
       SELECT 1, ?, 1, NULL WHERE (SELECT fallos FROM intentos_pin WHERE ip = ?) <= ?
       ON CONFLICT (id) DO UPDATE SET
         desde = CASE WHEN bloqueado_hasta > ? THEN desde WHEN desde <= ? THEN ? ELSE desde END,
         fallos = CASE WHEN bloqueado_hasta > ? THEN fallos WHEN desde <= ? THEN 1 ELSE fallos + 1 END,
         bloqueado_hasta = CASE WHEN bloqueado_hasta > ? THEN bloqueado_hasta
                                WHEN desde > ? AND fallos + 1 > ? THEN ?
                                ELSE NULL END`,
    ).bind(
      ahora, ip, MAX_FALLOS, ahora, inicioVentana, ahora, ahora, inicioVentana, ahora, inicioVentana, MAX_FALLOS_GLOBAL, ahora + BLOQUEO_MS,
    ),
    db.prepare('SELECT desde, bloqueado_hasta FROM pin_global WHERE id = 1'),
  ])
  const global = estadoGlobal.results[0]
  if (global?.bloqueado_hasta > ahora) return bloqueadoGlobal(global.bloqueado_hasta)
  const fila = reservaIp.results[0]
  if (!fila || fila.fallos > MAX_FALLOS) return bloqueado(fila?.bloqueado_hasta ?? hastaIp)
  if (await compararSeguro(pinDe(peticion), pinEsperado)) {
    await db.batch([
      db.prepare('DELETE FROM intentos_pin WHERE ip = ?').bind(ip),
      db.prepare('UPDATE pin_global SET fallos = fallos - 1 WHERE id = 1 AND desde = ? AND fallos > 0').bind(global.desde),
    ])
    return { ok: true }
  }
  if (fila.fallos >= MAX_FALLOS) return bloqueado(fila.bloqueado_hasta)
  return { ok: false, estado: 401, cuerpo: { error: 'pin_incorrecto', detalle: `PIN incorrecto. Quedan ${MAX_FALLOS - fila.fallos} intentos.` } }
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

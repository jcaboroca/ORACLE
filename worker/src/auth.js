// @ts-check
// PIN único (Authorization: Bearer <PIN>) comparado en tiempo constante, con bloqueo por IP y tope global,
// y CORS solo para los orígenes de la var ORIGENES. El origen no es la seguridad: lo es el PIN.

export const MAX_FALLOS = 5
export const BLOQUEO_MS = 15 * 60_000
/** Tope de PIN fallidos entre todas las IPs por ventana: un PIN de 4 cifras aguanta así la rotación de IPs. */
export const MAX_FALLOS_GLOBAL = 50
export const VENTANA_GLOBAL_MS = 15 * 60_000
/** Una reserva de intento sin liberar (invocación caída a mitad) deja de contar pasado este tiempo. */
export const VUELO_MS = 30_000
/** Segundos que se pide esperar cuando hay demasiados intentos en vuelo (no es el bloqueo). */
export const REINTENTAR_EN_S = 2

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
 * @typedef {{ ok: true } | { ok: false, estado: number,
 *   cuerpo: { error: string, detalle: string, hasta?: number, reintentar_en?: number } }} ResultadoPin
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

/** Demasiados intentos en vuelo (aún sin comparar): no es un bloqueo, basta con reintentar enseguida. @type {ResultadoPin} */
const OCUPADO = {
  ok: false,
  estado: 429,
  cuerpo: { error: 'ocupado', detalle: 'Hay otros intentos de PIN en curso. Vuelve a probar en unos segundos.', reintentar_en: REINTENTAR_EN_S },
}

// Reservas en vuelo que aún cuentan (las de una invocación caída caducan en VUELO_MS).
const EN_VUELO = 'CASE WHEN vuelo_hasta > :ahora THEN en_vuelo ELSE 0 END'

/**
 * Sentencia con parámetros :nombre, traducidos a `?` posicionales (D1 no admite parámetros con nombre).
 * @param {import('./repositorio.js').D1} db
 * @param {string} sql
 * @param {Record<string, string|number>} valores
 */
function sentencia(db, sql, valores) {
  /** @type {(string|number)[]} */
  const orden = []
  const posicional = sql.replace(/:([a-zA-Z]+)/g, (_, nombre) => {
    if (!(nombre in valores)) throw new Error(`Falta el parámetro :${nombre}`)
    orden.push(valores[nombre])
    return '?'
  })
  return db.prepare(posicional).bind(...orden)
}

/**
 * Comprueba el PIN reservando el intento ANTES de comparar (spec §11). Los intentos en vuelo se cuentan
 * aparte de los fallos confirmados (migración 0004), así varias peticiones a la vez con el PIN correcto
 * nunca provocan un bloqueo falso:
 * 1. Lote atómico de reserva. La IP reserva (en_vuelo + 1) solo si no está bloqueada, si
 *    fallos + en_vuelo < 5 y si el tope global lo permite (sin bloqueo global y fallos + en_vuelo < 50
 *    en la ventana fija de 15 min); entonces también reserva su hueco global. Si su bloqueo caducó,
 *    sus fallos vuelven a 0.
 * 2. Sin reserva: bloqueo global o de la IP vigente → 429 con el bloqueo real; si no, solo hay demasiados
 *    intentos en vuelo → 429 «ocupado» con reintento corto (REINTENTAR_EN_S), sin comparar.
 * 3. Con reserva se compara y se libera en otro lote: acierto → fallos = 0, sin bloqueo y en_vuelo − 1
 *    (la fila se borra si no queda nada en vuelo; el hueco global se devuelve). Fallo → fallos + 1 y
 *    en_vuelo − 1 en la IP y en el global; al 5.º fallo de la IP, bloqueo de 15 min; al 50.º global, 15 min
 *    para todos.
 * Así una ráfaga en paralelo no compara más de 5 PIN por IP ni más de 50 en total, y solo los fallos
 * confirmados bloquean. Exactamente 2 llamadas a D1 si se compara (1 si no).
 * @param {import('./repositorio.js').D1} db
 * @param {Request} peticion
 * @param {string|undefined} pinEsperado secret ORACLE_PIN
 * @param {number} ahora
 * @returns {Promise<ResultadoPin>}
 */
export async function verificarPin(db, peticion, pinEsperado, ahora) {
  if (!pinEsperado) return { ok: false, estado: 500, cuerpo: { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' } }
  const ip = ipDe(peticion)
  const token = crypto.randomUUID()
  const vueloHasta = ahora + VUELO_MS
  const inicioVentana = ahora - VENTANA_GLOBAL_MS
  const v = { ahora, ip, token, vueloHasta, inicioVentana, max: MAX_FALLOS, maxGlobal: MAX_FALLOS_GLOBAL }
  const [, , estadoIp, estadoGlobal] = await db.batch([
    sentencia(db, `INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta, en_vuelo, vuelo_hasta, token)
       SELECT :ip, 0, NULL, 1, :vueloHasta, :token
       WHERE NOT EXISTS (SELECT 1 FROM pin_global WHERE id = 1 AND (bloqueado_hasta > :ahora
         OR (CASE WHEN desde > :inicioVentana THEN fallos ELSE 0 END) + ${EN_VUELO} >= :maxGlobal))
       ON CONFLICT (ip) DO UPDATE SET
         fallos = CASE WHEN bloqueado_hasta IS NULL THEN fallos ELSE 0 END,
         bloqueado_hasta = NULL,
         en_vuelo = ${EN_VUELO} + 1,
         vuelo_hasta = :vueloHasta,
         token = :token
       WHERE COALESCE(bloqueado_hasta, 0) <= :ahora
         AND (CASE WHEN bloqueado_hasta IS NULL THEN fallos ELSE 0 END) + ${EN_VUELO} < :max`, v),
    sentencia(db, `INSERT INTO pin_global (id, desde, fallos, bloqueado_hasta, en_vuelo, vuelo_hasta)
       SELECT 1, :ahora, 0, NULL, 1, :vueloHasta WHERE EXISTS (SELECT 1 FROM intentos_pin WHERE ip = :ip AND token = :token)
       ON CONFLICT (id) DO UPDATE SET
         desde = CASE WHEN desde > :inicioVentana THEN desde ELSE :ahora END,
         fallos = CASE WHEN desde > :inicioVentana THEN fallos ELSE 0 END,
         en_vuelo = ${EN_VUELO} + 1,
         vuelo_hasta = :vueloHasta`, v),
    db.prepare('SELECT bloqueado_hasta, token FROM intentos_pin WHERE ip = ?').bind(ip),
    db.prepare('SELECT bloqueado_hasta FROM pin_global WHERE id = 1'),
  ])
  const filaIp = estadoIp.results[0]
  const global = estadoGlobal.results[0]
  if (filaIp?.token !== token) {
    if (global?.bloqueado_hasta > ahora) return bloqueadoGlobal(global.bloqueado_hasta)
    if (filaIp?.bloqueado_hasta > ahora) return bloqueado(filaIp.bloqueado_hasta)
    return OCUPADO
  }
  if (await compararSeguro(pinDe(peticion), pinEsperado)) {
    await db.batch([
      db.prepare('UPDATE intentos_pin SET fallos = 0, bloqueado_hasta = NULL, en_vuelo = MAX(en_vuelo - 1, 0) WHERE ip = ?').bind(ip),
      db.prepare('DELETE FROM intentos_pin WHERE ip = ? AND en_vuelo = 0').bind(ip),
      db.prepare('UPDATE pin_global SET en_vuelo = MAX(en_vuelo - 1, 0) WHERE id = 1'),
    ])
    return { ok: true }
  }
  const f = { ahora, ip, hasta: ahora + BLOQUEO_MS, max: MAX_FALLOS, maxGlobal: MAX_FALLOS_GLOBAL }
  const [fallosIp, fallosGlobal] = await db.batch([
    sentencia(db, `UPDATE intentos_pin SET fallos = fallos + 1, en_vuelo = MAX(en_vuelo - 1, 0),
         bloqueado_hasta = CASE WHEN bloqueado_hasta > :ahora THEN bloqueado_hasta WHEN fallos + 1 >= :max THEN :hasta ELSE NULL END
       WHERE ip = :ip RETURNING fallos, bloqueado_hasta`, f),
    sentencia(db, `UPDATE pin_global SET fallos = fallos + 1, en_vuelo = MAX(en_vuelo - 1, 0),
         bloqueado_hasta = CASE WHEN bloqueado_hasta > :ahora THEN bloqueado_hasta WHEN fallos + 1 >= :maxGlobal THEN :hasta
                                ELSE bloqueado_hasta END
       WHERE id = 1 RETURNING bloqueado_hasta`, f),
  ])
  const g = fallosGlobal.results[0]
  if (g?.bloqueado_hasta > ahora) return bloqueadoGlobal(g.bloqueado_hasta)
  const fila = fallosIp.results[0]
  if (fila && fila.fallos >= MAX_FALLOS) return bloqueado(fila.bloqueado_hasta)
  const quedan = MAX_FALLOS - (fila?.fallos ?? 0)
  return { ok: false, estado: 401, cuerpo: { error: 'pin_incorrecto', detalle: `PIN incorrecto. Quedan ${quedan} intentos.` } }
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

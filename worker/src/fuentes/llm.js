// @ts-check
// LLM en cascada: Workers AI → Groq (si hay GROQ_API_KEY) → Gemini (si hay GEMINI_API_KEY).
// Cada respuesta se valida de forma estricta; si no vale, se pasa al siguiente. Sin ninguno:
// léxico local para puntuar titulares y plantilla para explicar señales.
import { analizarTitular } from '../../../core/lexico.js'
import { pedirJson } from './http.js'

/** @typedef {'cf'|'groq'|'gemini'} Motor */
/**
 * @typedef {{ AI?: { run: (modelo: string, entrada: object) => Promise<any> }, LLM_MODELO_CF?: string,
 *   GROQ_API_KEY?: string, LLM_MODELO_GROQ?: string, GEMINI_API_KEY?: string, LLM_MODELO_GEMINI?: string }} EntornoLlm
 */
/** @typedef {import('../../../core/hora.js').Senal} Senal */

export const TIEMPO_MAXIMO_MS = 20_000
export const MAX_TOKENS = 3000
export const GROQ = 'https://api.groq.com/openai/v1/chat/completions'
export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Primer objeto JSON del texto (los modelos a veces lo envuelven en ```json … ```). null si no hay.
 * @param {unknown} texto
 */
export function extraerJson(texto) {
  if (typeof texto !== 'string') return null
  const inicio = texto.indexOf('{')
  const fin = texto.lastIndexOf('}')
  if (inicio < 0 || fin <= inicio) return null
  try {
    return JSON.parse(texto.slice(inicio, fin + 1))
  } catch {
    return null
  }
}

/**
 * Proveedores configurados, en orden. Workers AI no gasta subpeticiones externas; Groq y Gemini, 1 cada uno.
 * @param {EntornoLlm} env
 * @param {typeof fetch} fetch
 * @returns {{ motor: Motor, llamar: (sistema: string, usuario: string) => Promise<string> }[]}
 */
export function proveedores(env, fetch) {
  /** @type {{ motor: Motor, llamar: (sistema: string, usuario: string) => Promise<string> }[]} */
  const lista = []
  if (env.AI && env.LLM_MODELO_CF) {
    const { AI, LLM_MODELO_CF: modelo } = env
    lista.push({
      motor: 'cf',
      llamar: async (sistema, usuario) => {
        const r = await AI.run(modelo, {
          messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
          max_tokens: MAX_TOKENS,
          temperature: 0.1,
        })
        return typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? null)
      },
    })
  }
  if (env.GROQ_API_KEY) {
    const clave = env.GROQ_API_KEY
    const modelo = env.LLM_MODELO_GROQ || 'llama-3.3-70b-versatile'
    lista.push({
      motor: 'groq',
      llamar: async (sistema, usuario) => {
        const json = await pedirJson(fetch, GROQ, {
          method: 'POST',
          headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelo,
            messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
            temperature: 0.1,
            max_tokens: MAX_TOKENS,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        return json?.choices?.[0]?.message?.content
      },
    })
  }
  if (env.GEMINI_API_KEY) {
    const clave = env.GEMINI_API_KEY
    const modelo = env.LLM_MODELO_GEMINI || 'gemini-flash-latest'
    lista.push({
      motor: 'gemini',
      llamar: async (sistema, usuario) => {
        const json = await pedirJson(fetch, `${GEMINI}/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sistema }] },
            contents: [{ role: 'user', parts: [{ text: usuario }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        return json?.candidates?.[0]?.content?.parts?.[0]?.text
      },
    })
  }
  return lista
}

/**
 * Prueba los proveedores en orden hasta que uno devuelve JSON que `validar` acepta (≠ null).
 * @template T
 * @param {{ env: EntornoLlm, fetch: typeof fetch, sistema: string, usuario: string, validar: (json: unknown) => T|null }} entrada
 * @returns {Promise<{ motor: Motor|null, datos: T|null, fallos: string[] }>}
 */
export async function completarJson({ env, fetch, sistema, usuario, validar }) {
  /** @type {string[]} */
  const fallos = []
  for (const p of proveedores(env, fetch)) {
    try {
      const datos = validar(extraerJson(await p.llamar(sistema, usuario)))
      if (datos !== null) return { motor: p.motor, datos, fallos }
      fallos.push(`llm ${p.motor}: respuesta no válida`)
    } catch (e) {
      fallos.push(`llm ${p.motor}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { motor: null, datos: null, fallos }
}

/** @param {string[]} monedas */
export const sistemaTitulares = (monedas) => [
  'Eres un analista de mercados de criptomonedas. Para cada titular estima su efecto probable sobre el precio en las próximas horas.',
  '"puntuacion": número entre -1 (muy negativo) y 1 (muy positivo); 0 si es neutro o irrelevante.',
  `"monedas": símbolos afectados de esta lista: ${monedas.join(', ')}; ["MERCADO"] si afecta al mercado cripto en general; [] si no afecta a ninguna.`,
  'Responde SOLO con JSON con esta forma exacta: {"titulares":[{"n":1,"puntuacion":0.4,"monedas":["BTC"]}]}',
].join('\n')

/**
 * @typedef {{ puntuacion: number, monedas: string[], motor: Motor|'lexico' }} Puntuado
 */

/**
 * Puntúa un lote de titulares en una sola llamada. Los que el LLM no devuelve bien se puntúan con el léxico.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, titulares: { id: string, titulo: string }[], monedas: string[] }} entrada
 * @returns {Promise<{ resultados: Record<string, Puntuado>, fallos: string[] }>}
 */
export async function puntuarTitulares({ env, fetch, titulares, monedas }) {
  if (titulares.length === 0) return { resultados: {}, fallos: [] }
  const permitidas = new Set([...monedas, 'MERCADO'])
  /** @param {unknown} json */
  const validar = (json) => {
    const lista = /** @type {any} */ (json)?.titulares
    if (!Array.isArray(lista)) return null
    /** @type {Map<number, { puntuacion: number, monedas: string[] }>} */
    const validos = new Map()
    for (const it of lista) {
      const n = it?.n
      if (!Number.isInteger(n) || n < 1 || n > titulares.length || validos.has(n)) continue
      const p = it.puntuacion
      if (typeof p !== 'number' || !Number.isFinite(p) || p < -1 || p > 1) continue
      if (!Array.isArray(it.monedas) || !it.monedas.every((/** @type {unknown} */ m) => typeof m === 'string')) continue
      const ms = [...new Set(it.monedas.map((/** @type {string} */ m) => m.trim().toUpperCase()))]
      if (!ms.every((m) => permitidas.has(m)) || (ms.includes('MERCADO') && ms.length > 1)) continue
      validos.set(n, { puntuacion: p, monedas: ms })
    }
    return validos.size > 0 ? validos : null
  }
  const usuario = JSON.stringify({ titulares: titulares.map((t, i) => ({ n: i + 1, titulo: t.titulo })) })
  const r = await completarJson({ env, fetch, sistema: sistemaTitulares(monedas), usuario, validar })
  /** @type {Record<string, Puntuado>} */
  const resultados = {}
  titulares.forEach((t, i) => {
    const v = r.datos?.get(i + 1)
    resultados[t.id] = v && r.motor ? { ...v, motor: r.motor } : { ...analizarTitular(t.titulo), motor: 'lexico' }
  })
  return { resultados, fallos: r.fallos }
}

const NOMBRES = /** @type {const} */ ({ tecnico: 'técnico', derivados: 'derivados', noticias: 'noticias', fng: 'Fear & Greed' })
/** @type {Record<string, string>} */
const VEREDICTOS = { COMPRAR: 'Señal de compra', VENDER: 'Señal de venta', MANTENER: 'Mantener' }

/** @param {number} x @param {number} [decimales] */
const es = (x, decimales = 2) => x.toFixed(decimales).replace('.', ',')

/**
 * Explicación sin LLM a partir del desglose. Nunca inventa datos: solo los de la señal.
 * @param {Senal} senal
 */
export function plantillaExplicacion(senal) {
  if (senal.veredicto === 'SIN_DATOS') {
    return `${senal.simbolo}: sin datos suficientes para analizar; el bot no abre posiciones.`
  }
  /** @type {Record<string, number|null|undefined>} */
  const componentes = /** @type {any} */ (senal.componentes) ?? {}
  const partes = Object.entries(NOMBRES).map(([clave, nombre]) => {
    const v = componentes[clave]
    return typeof v === 'number' ? `${nombre} ${v >= 0 ? '+' : ''}${es(v)}` : `${nombre} ausente`
  })
  const confianza = senal.indiceConfianza === null ? '—' : `${Math.round(senal.indiceConfianza * 100)} %`
  const contradiccion = senal.motivo === 'contradiccion_tecnico_derivados'
    ? ' Técnico y derivados se contradicen, así que se mantiene.'
    : ''
  return `${VEREDICTOS[senal.veredicto] ?? senal.veredicto} en ${senal.simbolo} (puntuación ${es(senal.puntuacion ?? 0)}, `
    + `confianza ${confianza}, sin calibrar). ${partes.join(' · ')}.${contradiccion}`
}

/** Lo que ve el LLM de cada señal: datos estructurados, nada de texto libre. @param {Senal} senal */
export function resumenParaLlm(senal) {
  /** @type {any} */
  const detalle = senal.detalle ?? {}
  /** @type {Record<string, string>} */
  const tendencias = {}
  for (const tf of ['1h', '4h', '1d']) {
    const t = detalle.timeframes?.[tf]?.tendencia
    if (typeof t === 'string') tendencias[tf] = t
  }
  return {
    simbolo: senal.simbolo,
    veredicto: senal.veredicto,
    indiceConfianza: senal.indiceConfianza,
    puntuacion: senal.puntuacion,
    motivo: senal.motivo,
    componentes: senal.componentes,
    ausentes: senal.ausentes,
    alineacion: senal.alineacion,
    atrPct: senal.atrPct,
    tendencias,
  }
}

export const SISTEMA_EXPLICACION = [
  'Eres el asistente de ORACLE, un simulador de trading de criptomonedas. Explica en español, en 2 o 3 frases claras',
  'y sin jerga, por qué cada moneda tiene ese veredicto, usando SOLO los datos recibidos (componentes entre -1 y 1;',
  'los ausentes no se usaron). No cambies el veredicto, no inventes cifras ni des consejos de inversión.',
  'Responde SOLO con JSON con esta forma exacta: {"explicaciones":{"BTC":"texto"}}',
].join(' ')

/**
 * Una sola llamada para explicar todas las señales; la que falte o no valga usa la plantilla.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, senales: Senal[] }} entrada
 * @returns {Promise<{ textos: Record<string, { texto: string, motor: Motor|'plantilla' }>, fallos: string[] }>}
 */
export async function explicarSenales({ env, fetch, senales }) {
  const simbolos = new Set(senales.map((s) => s.simbolo))
  /** @param {unknown} json */
  const validar = (json) => {
    const e = /** @type {any} */ (json)?.explicaciones
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null
    /** @type {Record<string, string>} */
    const validas = {}
    for (const [simbolo, texto] of Object.entries(e)) {
      if (!simbolos.has(simbolo) || typeof texto !== 'string') continue
      const limpio = texto.trim()
      if (limpio.length >= 20 && limpio.length <= 600) validas[simbolo] = limpio
    }
    return Object.keys(validas).length > 0 ? validas : null
  }
  const usuario = JSON.stringify({ senales: senales.map(resumenParaLlm) })
  const r = senales.length > 0
    ? await completarJson({ env, fetch, sistema: SISTEMA_EXPLICACION, usuario, validar })
    : { motor: null, datos: null, fallos: [] }
  /** @type {Record<string, { texto: string, motor: Motor|'plantilla' }>} */
  const textos = {}
  for (const s of senales) {
    const texto = r.datos?.[s.simbolo]
    textos[s.simbolo] = texto && r.motor ? { texto, motor: r.motor } : { texto: plantillaExplicacion(s), motor: 'plantilla' }
  }
  return { textos, fallos: r.fallos }
}

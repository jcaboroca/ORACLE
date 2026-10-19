// @ts-check
// LLM en cascada: Workers AI → Groq (si hay GROQ_API_KEY) → Gemini (si hay GEMINI_API_KEY).
// Cada respuesta se valida de forma estricta; si no vale, se pasa al siguiente. Sin ninguno:
// léxico local para puntuar titulares y plantilla para explicar señales.
// Workers AI se llama en modo JSON (esquema): el 8B sin él rompía el JSON en lotes grandes
// (salida real en test/fixtures/workers-ai-titulares-80-llama-3.1-8b-fp8.json).
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
/** Titulares por llamada: ~0,8 neuronas y ~20 tokens de salida por titular; lotes cortos no se truncan. */
export const TITULARES_POR_LLAMADA = 25
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
 * Rescate de una lista de titulares cuando el JSON completo no es válido: cada objeto plano `{…}` se
 * interpreta por separado tras reparar los fallos vistos en el 8B (comilla de clave sin cerrar en
 * `"monedas:[`, `+0.4`, comas finales). Lo que siga sin ser JSON se descarta; los valores se validan después.
 * @param {unknown} texto
 * @returns {{ titulares: unknown[] }|null}
 */
export function rescatarTitulares(texto) {
  const json = extraerJson(texto)
  if (Array.isArray(/** @type {any} */ (json)?.titulares)) return /** @type {any} */ (json)
  if (typeof texto !== 'string') return null
  /** @type {unknown[]} */
  const titulares = []
  for (const [objeto] of texto.matchAll(/\{[^{}]*\}/g)) {
    const reparado = objeto
      .replace(/"(n|puntuacion|monedas):/g, '"$1":')
      .replace(/:\s*\+(?=\d|\.)/g, ':')
      .replace(/,\s*([}\]])/g, '$1')
    try {
      titulares.push(JSON.parse(reparado))
    } catch { /* irreparable: ese titular pasa al siguiente recurso */ }
  }
  return titulares.length > 0 ? { titulares } : null
}

/** Texto de la respuesta de `AI.run`: en modo JSON `response` llega ya como objeto. @param {any} r */
function textoWorkersAi(r) {
  const x = r?.response
  if (typeof x === 'string') return x
  return x && typeof x === 'object' ? JSON.stringify(x) : ''
}

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * @typedef {{ motor: Motor, llamar: (sistema: string, usuario: string, esquema?: object) => Promise<string> }} Proveedor
 */

/**
 * Proveedores configurados, en orden. Workers AI no gasta subpeticiones externas; Groq y Gemini, 1 cada uno.
 * `esquema` (JSON Schema) solo lo usa Workers AI (`response_format: json_schema`); si el modelo no lo admite
 * (error 5025) se repite una vez sin él. Groq usa `json_object` y Gemini `application/json`.
 * @param {EntornoLlm} env
 * @param {typeof fetch} fetch
 * @returns {Proveedor[]}
 */
export function proveedores(env, fetch) {
  /** @type {Proveedor[]} */
  const lista = []
  if (env.AI && env.LLM_MODELO_CF) {
    const { AI, LLM_MODELO_CF: modelo } = env
    lista.push({
      motor: 'cf',
      llamar: async (sistema, usuario, esquema) => {
        const entrada = {
          messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
          max_tokens: MAX_TOKENS,
          temperature: 0.1,
        }
        if (!esquema) return textoWorkersAi(await AI.run(modelo, entrada))
        try {
          return textoWorkersAi(await AI.run(modelo, { ...entrada, response_format: { type: 'json_schema', json_schema: esquema } }))
        } catch (e) {
          if (!/\b5025\b/.test(mensaje(e))) throw e
          return textoWorkersAi(await AI.run(modelo, entrada))
        }
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
 * `interpretar` convierte el texto en JSON (por defecto, `extraerJson`); `etiqueta` se añade a los fallos.
 * @template T
 * @param {{ env: EntornoLlm, fetch: typeof fetch, sistema: string, usuario: string, validar: (json: unknown) => T|null,
 *   esquema?: object, interpretar?: (texto: unknown) => unknown, etiqueta?: string }} entrada
 * @returns {Promise<{ motor: Motor|null, datos: T|null, fallos: string[] }>}
 */
export async function completarJson({ env, fetch, sistema, usuario, validar, esquema, interpretar = extraerJson, etiqueta = '' }) {
  /** @type {string[]} */
  const fallos = []
  for (const p of proveedores(env, fetch)) {
    try {
      const datos = validar(interpretar(await p.llamar(sistema, usuario, esquema)))
      if (datos !== null) return { motor: p.motor, datos, fallos }
      fallos.push(`llm ${p.motor}${etiqueta}: respuesta no válida`)
    } catch (e) {
      fallos.push(`llm ${p.motor}${etiqueta}: ${mensaje(e)}`)
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
 * Esquema JSON de la respuesta de un lote (modo JSON de Workers AI): `n` acotado al lote y monedas de la lista.
 * @param {number} tamano @param {string[]} monedas
 */
export const esquemaTitulares = (tamano, monedas) => ({
  type: 'object',
  properties: {
    titulares: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          n: { type: 'integer', minimum: 1, maximum: tamano },
          puntuacion: { type: 'number', minimum: -1, maximum: 1 },
          monedas: { type: 'array', items: { type: 'string', enum: [...monedas, 'MERCADO'] } },
        },
        required: ['n', 'puntuacion', 'monedas'],
      },
    },
  },
  required: ['titulares'],
})

/**
 * Puntúa los titulares en lotes de TITULARES_POR_LLAMADA (en serie; cada lote recorre la cascada por su cuenta).
 * Los que el LLM no devuelve bien se puntúan con el léxico: ninguno queda sin puntuar.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, titulares: { id: string, titulo: string }[], monedas: string[] }} entrada
 * @returns {Promise<{ resultados: Record<string, Puntuado>, fallos: string[] }>}
 */
export async function puntuarTitulares({ env, fetch, titulares, monedas }) {
  /** @type {Record<string, Puntuado>} */
  const resultados = {}
  /** @type {string[]} */
  const fallos = []
  const lotes = Math.ceil(titulares.length / TITULARES_POR_LLAMADA)
  for (let i = 0; i < lotes; i++) {
    const lote = titulares.slice(i * TITULARES_POR_LLAMADA, (i + 1) * TITULARES_POR_LLAMADA)
    const etiqueta = lotes > 1 ? ` (lote ${i + 1}/${lotes})` : ''
    const r = await puntuarLote({ env, fetch, titulares: lote, monedas, etiqueta })
    Object.assign(resultados, r.resultados)
    fallos.push(...r.fallos)
  }
  return { resultados, fallos }
}

/**
 * Un lote en una sola llamada por proveedor.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, titulares: { id: string, titulo: string }[], monedas: string[], etiqueta: string }} entrada
 * @returns {Promise<{ resultados: Record<string, Puntuado>, fallos: string[] }>}
 */
async function puntuarLote({ env, fetch, titulares, monedas, etiqueta }) {
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
  const r = await completarJson({
    env, fetch, sistema: sistemaTitulares(monedas), usuario, validar,
    esquema: esquemaTitulares(titulares.length, monedas), interpretar: rescatarTitulares, etiqueta,
  })
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
  const lista = [...simbolos]
  const esquema = {
    type: 'object',
    properties: {
      explicaciones: { type: 'object', properties: Object.fromEntries(lista.map((s) => [s, { type: 'string' }])), required: lista },
    },
    required: ['explicaciones'],
  }
  const r = senales.length > 0
    ? await completarJson({ env, fetch, sistema: SISTEMA_EXPLICACION, usuario, validar, esquema })
    : { motor: null, datos: null, fallos: [] }
  /** @type {Record<string, { texto: string, motor: Motor|'plantilla' }>} */
  const textos = {}
  for (const s of senales) {
    const texto = r.datos?.[s.simbolo]
    textos[s.simbolo] = texto && r.motor ? { texto, motor: r.motor } : { texto: plantillaExplicacion(s), motor: 'plantilla' }
  }
  return { textos, fallos: r.fallos }
}

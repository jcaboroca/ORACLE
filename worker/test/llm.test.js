// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { readFileSync } from 'node:fs'
import {
  GEMINI, GROQ, TITULARES_POR_LLAMADA, explicarSenales, extraerJson, plantillaExplicacion, proveedores, puntuarTitulares,
  rescatarTitulares,
} from '../src/fuentes/llm.js'
import { simularFetch } from './ayudantes.js'

/** Salida real de `AI.run` grabada en producción (2026-10-19) con el prompt de titulares. @param {string} nombre */
const grabada = (nombre) => JSON.parse(readFileSync(new URL(`./fixtures/${nombre}`, import.meta.url), 'utf8'))
/** 80 titulares, llama-3.1-8b-instruct-fp8 sin modo JSON: 65 elementos con `"monedas:[]` y sin `}` final. */
const ROTA_80 = grabada('workers-ai-titulares-80-llama-3.1-8b-fp8.json')
/** 25 titulares, llama-3.1-8b-instruct-fp8-fast con esquema JSON: `response` llega como objeto. */
const ESQUEMA_25 = grabada('workers-ai-titulares-25-llama-3.1-8b-fp8-fast-esquema.json')
/** 5 señales reales, llama-3.1-8b-instruct-fp8-fast con esquema JSON. */
const EXPLICACIONES = grabada('workers-ai-explicaciones-llama-3.1-8b-fp8-fast-esquema.json')
/** @param {number} n */
const titularesDePrueba = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, titulo: `Titular de prueba ${i + 1}` }))

const MONEDAS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const TITULARES = [
  { id: 'a', titulo: 'Bitcoin rally continues' },
  { id: 'b', titulo: 'Crypto exchange hacked' },
  { id: 'c', titulo: 'Ether ETFs see inflows' },
]

/**
 * Binding AI simulado: devuelve las respuestas en orden y guarda las entradas. Un texto se envuelve en
 * `{ response }`; un objeto (salida grabada de `AI.run`) se devuelve tal cual.
 * @param {...(string|Error|object)} respuestas
 */
function simularAi(...respuestas) {
  /** @type {{ modelo: string, entrada: any }[]} */
  const llamadas = []
  return {
    llamadas,
    /** @param {string} modelo @param {any} entrada */
    async run(modelo, entrada) {
      llamadas.push({ modelo, entrada })
      const r = respuestas.shift() ?? new Error('sin respuesta')
      if (r instanceof Error) throw r
      return typeof r === 'string' ? { response: r } : r
    },
  }
}

/** @param {string} contenido */
const respuestaGroq = (contenido) => ({ cuerpo: { choices: [{ message: { content: contenido } }] } })
/** @param {string} texto */
const respuestaGemini = (texto) => ({ cuerpo: { candidates: [{ content: { parts: [{ text: texto }] } }] } })

/**
 * @param {Partial<import('../../core/hora.js').Senal>} [cambios]
 * @returns {import('../../core/hora.js').Senal}
 */
const senal = (cambios = {}) => ({
  version: 'v1', simbolo: 'BTC', calculadaEn: 0, vela1h: 0, precio: 100, fresca: true,
  veredicto: 'COMPRAR', puntuacion: 0.42, indiceConfianza: 0.71, alineacion: true, atrPct: 0.02, motivo: null,
  componentes: { tecnico: 0.6, derivados: null, noticias: -0.1, fng: 0 }, ausentes: ['derivados'],
  detalle: { timeframes: { '1h': { tendencia: 'alcista' }, '4h': { tendencia: 'lateral' }, '1d': { tendencia: 'alcista' } } },
  ...cambios,
})

describe('extraerJson', () => {
  test('acepta JSON envuelto en texto o en ```json; null si no hay objeto válido', () => {
    assert.deepEqual(extraerJson('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(extraerJson('Aquí tienes: {"a":{"b":2}} ¡suerte!'), { a: { b: 2 } })
    assert.equal(extraerJson('{"a":'), null)
    assert.equal(extraerJson('sin json'), null)
    assert.equal(extraerJson(undefined), null)
  })
})

describe('proveedores', () => {
  test('orden cf → groq → gemini, cada uno solo si está configurado', () => {
    const fetch = simularFetch(() => ({}))
    assert.deepEqual(proveedores({}, fetch).map((p) => p.motor), [])
    assert.deepEqual(proveedores({ GEMINI_API_KEY: 'g' }, fetch).map((p) => p.motor), ['gemini'])
    const todos = { AI: simularAi(), LLM_MODELO_CF: '@cf/x', GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g' }
    assert.deepEqual(proveedores(todos, fetch).map((p) => p.motor), ['cf', 'groq', 'gemini'])
    assert.deepEqual(proveedores({ AI: simularAi() }, fetch).map((p) => p.motor), [], 'sin modelo no hay cf')
  })
})

describe('puntuarTitulares', () => {
  test('Workers AI válido: puntúa todos con motor cf y envía el modelo de LLM_MODELO_CF', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 0.6, monedas: ['BTC'] },
      { n: 2, puntuacion: -0.8, monedas: ['MERCADO'] },
      { n: 3, puntuacion: 0.3, monedas: ['eth'] },
    ] }))
    const { resultados, fallos } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: '@cf/meta/llama-3.1-8b-instruct-fp8' }, fetch: simularFetch(() => ({})), titulares: TITULARES, monedas: MONEDAS,
    })
    assert.deepEqual(resultados, {
      a: { puntuacion: 0.6, monedas: ['BTC'], motor: 'cf' },
      b: { puntuacion: -0.8, monedas: ['MERCADO'], motor: 'cf' },
      c: { puntuacion: 0.3, monedas: ['ETH'], motor: 'cf' },
    })
    assert.deepEqual(fallos, [])
    assert.equal(ai.llamadas[0].modelo, '@cf/meta/llama-3.1-8b-instruct-fp8')
    assert.equal(ai.llamadas[0].entrada.messages[1].content,
      '{"titulares":[{"n":1,"titulo":"Bitcoin rally continues"},{"n":2,"titulo":"Crypto exchange hacked"},{"n":3,"titulo":"Ether ETFs see inflows"}]}')
  })

  test('elementos no válidos se descartan y esos titulares se puntúan con el léxico', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 1.5, monedas: ['BTC'] }, // fuera de rango
      { n: 2, puntuacion: -0.5, monedas: ['DOGE'] }, // moneda no seguida
      { n: 3, puntuacion: 0.2, monedas: ['ETH'] },
      { n: 3, puntuacion: 0.9, monedas: ['ETH'] }, // repetido: vale el primero
      { n: 9, puntuacion: 0.1, monedas: [] }, // no existe
    ] }))
    const { resultados } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: TITULARES, monedas: MONEDAS,
    })
    assert.deepEqual(resultados.a, { puntuacion: 0.5, monedas: ['BTC'], motor: 'lexico' })
    assert.deepEqual(resultados.b, { puntuacion: -0.5, monedas: ['MERCADO'], motor: 'lexico' })
    assert.deepEqual(resultados.c, { puntuacion: 0.2, monedas: ['ETH'], motor: 'cf' })
  })

  test('MERCADO junto a una moneda no es válido; [] (no afecta a ninguna) sí', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 0.1, monedas: ['MERCADO', 'BTC'] },
      { n: 2, puntuacion: 0, monedas: [] },
    ] }))
    const { resultados } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: TITULARES.slice(0, 2), monedas: MONEDAS,
    })
    assert.equal(resultados.a.motor, 'lexico')
    assert.deepEqual(resultados.b, { puntuacion: 0, monedas: [], motor: 'cf' })
  })

  test('cascada: cf lanza, Groq devuelve basura, Gemini responde bien → motor gemini', async () => {
    const fetch = simularFetch((url) => (url === GROQ
      ? respuestaGroq('no es json')
      : respuestaGemini('{"titulares":[{"n":1,"puntuacion":0.4,"monedas":["BTC"]}]}')))
    const { resultados, fallos } = await puntuarTitulares({
      env: {
        AI: simularAi(new Error('capacidad agotada')), LLM_MODELO_CF: 'm',
        GROQ_API_KEY: 'clave-groq', LLM_MODELO_GROQ: 'llama-3.3-70b-versatile',
        GEMINI_API_KEY: 'clave-gemini', LLM_MODELO_GEMINI: 'gemini-flash-latest',
      },
      fetch, titulares: TITULARES.slice(0, 1), monedas: MONEDAS,
    })
    assert.deepEqual(resultados.a, { puntuacion: 0.4, monedas: ['BTC'], motor: 'gemini' })
    assert.deepEqual(fallos, ['llm cf: capacidad agotada', 'llm groq: respuesta no válida'])
    const [groq, gemini] = fetch.llamadas
    assert.equal(groq.url, GROQ)
    assert.equal(/** @type {any} */ (groq.init?.headers).Authorization, 'Bearer clave-groq')
    const cuerpoGroq = JSON.parse(String(groq.init?.body))
    assert.equal(cuerpoGroq.model, 'llama-3.3-70b-versatile')
    assert.deepEqual(cuerpoGroq.response_format, { type: 'json_object' })
    assert.equal(gemini.url, `${GEMINI}/gemini-flash-latest:generateContent`)
    assert.equal(/** @type {any} */ (gemini.init?.headers)['x-goog-api-key'], 'clave-gemini')
  })

  test('sin ningún LLM configurado todo va al léxico, sin subpeticiones', async () => {
    const fetch = simularFetch(() => ({}))
    const { resultados, fallos } = await puntuarTitulares({ env: {}, fetch, titulares: TITULARES, monedas: MONEDAS })
    assert.deepEqual(Object.values(resultados).map((r) => r.motor), ['lexico', 'lexico', 'lexico'])
    assert.deepEqual(resultados.c, { puntuacion: 0.5, monedas: ['ETH'], motor: 'lexico' })
    assert.equal(fetch.llamadas.length, 0)
    assert.deepEqual(fallos, [])
  })

  test('lote vacío: no llama a nadie', async () => {
    const ai = simularAi()
    assert.deepEqual(
      await puntuarTitulares({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: [], monedas: MONEDAS }),
      { resultados: {}, fallos: [] },
    )
    assert.equal(ai.llamadas.length, 0)
  })
})

describe('explicaciones', () => {
  test('plantilla: veredicto, puntuación, confianza y componentes con los ausentes marcados', () => {
    assert.equal(plantillaExplicacion(senal()),
      'Señal de compra en BTC (puntuación 0,42, confianza 71 %, sin calibrar). técnico +0,60 · derivados ausente · noticias -0,10 · Fear & Greed +0,00.')
  })

  test('plantilla: contradicción técnico/derivados y SIN_DATOS', () => {
    const contradiccion = plantillaExplicacion(senal({ veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados' }))
    assert.ok(contradiccion.startsWith('Mantener en BTC'))
    assert.ok(contradiccion.endsWith('Técnico y derivados se contradicen, así que se mantiene.'))
    assert.equal(plantillaExplicacion(senal({ veredicto: 'SIN_DATOS', puntuacion: null, indiceConfianza: null })),
      'BTC: sin datos suficientes para analizar; el bot no abre posiciones.')
  })

  test('LLM válido para una moneda y ausente para otra → texto del LLM y plantilla', async () => {
    const ai = simularAi(JSON.stringify({ explicaciones: {
      BTC: 'El técnico es claramente alcista en dos de tres marcos temporales.', DOGE: 'No se pidió esta moneda.',
    } }))
    const senales = [senal(), senal({ simbolo: 'ETH', veredicto: 'MANTENER' })]
    const { textos } = await explicarSenales({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), senales })
    assert.deepEqual(textos.BTC, { texto: 'El técnico es claramente alcista en dos de tres marcos temporales.', motor: 'cf' })
    assert.equal(textos.ETH.motor, 'plantilla')
    assert.equal(textos.ETH.texto, plantillaExplicacion(senales[1]))
    assert.equal(Object.keys(textos).length, 2)
    const enviado = JSON.parse(ai.llamadas[0].entrada.messages[1].content)
    assert.deepEqual(enviado.senales[0].tendencias, { '1h': 'alcista', '4h': 'lateral', '1d': 'alcista' })
  })

  test('textos demasiado cortos o largos no valen → plantilla', async () => {
    const ai = simularAi(JSON.stringify({ explicaciones: { BTC: 'Sube.' } }))
    const { textos, fallos } = await explicarSenales({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), senales: [senal()] })
    assert.equal(textos.BTC.motor, 'plantilla')
    assert.deepEqual(fallos, ['llm cf: respuesta no válida'])
  })
})

describe('Workers AI con salidas reales', () => {
  test('rescatarTitulares recupera los 80 elementos de la salida rota grabada (comilla de clave sin cerrar, sin } final)', () => {
    assert.equal(extraerJson(ROTA_80.response)?.titulares, undefined, 'como JSON estricto no vale')
    const r = /** @type {any} */ (rescatarTitulares(ROTA_80.response))
    assert.equal(r.titulares.length, 80)
    assert.deepEqual(r.titulares.map((/** @type {any} */ t) => t.n), Array.from({ length: 80 }, (_, i) => i + 1))
    assert.deepEqual(r.titulares[4], { n: 5, puntuacion: 0, monedas: [] })
    assert.deepEqual(r.titulares[5], { n: 6, puntuacion: 0.2, monedas: ['BTC', 'SOL'] })
  })

  test('rescatarTitulares: signo + y comas finales se aceptan; lo irreparable se descarta; sin objetos → null', () => {
    const r = /** @type {any} */ (rescatarTitulares('Aquí va: {"n":1,"puntuacion":+0.4,"monedas":["BTC",],} {"n":2,"puntuacion":0.1,"monedas":[BTC]} {"n":3,"puntuacion":-0.3,"monedas":[]}'))
    assert.deepEqual(r.titulares, [{ n: 1, puntuacion: 0.4, monedas: ['BTC'] }, { n: 3, puntuacion: -0.3, monedas: [] }])
    assert.equal(rescatarTitulares('sin json'), null)
    assert.equal(rescatarTitulares(undefined), null)
  })

  test('la salida rota grabada ya no manda los titulares al léxico: el lote se puntúa con cf', async () => {
    const titulares = titularesDePrueba(TITULARES_POR_LLAMADA)
    const { resultados, fallos } = await puntuarTitulares({
      env: { AI: simularAi(ROTA_80), LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares, monedas: MONEDAS,
    })
    assert.deepEqual(fallos, [])
    assert.deepEqual(Object.values(resultados).map((r) => r.motor), Array(TITULARES_POR_LLAMADA).fill('cf'))
    assert.deepEqual(resultados.t6, { puntuacion: 0.2, monedas: ['BTC', 'SOL'], motor: 'cf' })
  })

  test('response como objeto (modo JSON) se interpreta; la petición lleva esquema con n acotado y monedas permitidas', async () => {
    const ai = simularAi(ESQUEMA_25)
    const titulares = titularesDePrueba(25)
    const { resultados, fallos } = await puntuarTitulares({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares, monedas: MONEDAS })
    assert.deepEqual(fallos, [])
    assert.deepEqual(Object.values(resultados).map((r) => r.motor), Array(25).fill('cf'))
    assert.deepEqual(resultados.t1, { puntuacion: -0.2, monedas: ['XRP'], motor: 'cf' })
    const formato = ai.llamadas[0].entrada.response_format
    assert.equal(formato.type, 'json_schema')
    const item = formato.json_schema.properties.titulares.items
    assert.deepEqual(item.required, ['n', 'puntuacion', 'monedas'])
    assert.deepEqual([item.properties.n.minimum, item.properties.n.maximum], [1, 25])
    assert.deepEqual([item.properties.puntuacion.minimum, item.properties.puntuacion.maximum], [-1, 1])
    assert.deepEqual(item.properties.monedas.items.enum, [...MONEDAS, 'MERCADO'])
  })

  test(`lotes de ${TITULARES_POR_LLAMADA}: 60 titulares → 3 llamadas numeradas desde 1; un lote fallido cae solo él en cascada`, async () => {
    /** @type {any[]} */
    const entradas = []
    const ai = {
      /** @param {string} _m @param {any} entrada */
      async run(_m, entrada) {
        entradas.push(entrada)
        const lote = JSON.parse(entrada.messages[1].content).titulares
        if (entradas.length === 2) return { response: 'lo siento, no puedo' }
        return { response: { titulares: lote.map((/** @type {any} */ t) => ({ n: t.n, puntuacion: 0.1, monedas: ['BTC'] })) } }
      },
    }
    const fetch = simularFetch(() => respuestaGroq(JSON.stringify({ titulares: Array.from({ length: 25 }, (_, i) => ({ n: i + 1, puntuacion: -0.3, monedas: [] })) })))
    const titulares = titularesDePrueba(60)
    const { resultados, fallos } = await puntuarTitulares({ env: { AI: ai, LLM_MODELO_CF: 'm', GROQ_API_KEY: 'k' }, fetch, titulares, monedas: MONEDAS })
    assert.deepEqual(entradas.map((e) => JSON.parse(e.messages[1].content).titulares.length), [25, 25, 10])
    assert.deepEqual(entradas.map((e) => JSON.parse(e.messages[1].content).titulares[0]), [
      { n: 1, titulo: 'Titular de prueba 1' }, { n: 1, titulo: 'Titular de prueba 26' }, { n: 1, titulo: 'Titular de prueba 51' },
    ])
    assert.equal(fetch.llamadas.length, 1, 'Groq solo para el lote 2')
    assert.deepEqual(fallos, ['llm cf (lote 2/3): respuesta no válida'])
    assert.deepEqual(resultados.t25, { puntuacion: 0.1, monedas: ['BTC'], motor: 'cf' })
    assert.deepEqual(resultados.t26, { puntuacion: -0.3, monedas: [], motor: 'groq' })
    assert.deepEqual(resultados.t50, { puntuacion: -0.3, monedas: [], motor: 'groq' })
    assert.deepEqual(resultados.t60, { puntuacion: 0.1, monedas: ['BTC'], motor: 'cf' })
  })

  test('modelo sin esquema JSON (error 5025): reintenta una vez sin response_format', async () => {
    const ai = simularAi(new Error("5025: This model doesn't support JSON Schema."), JSON.stringify({ titulares: [{ n: 1, puntuacion: 0.3, monedas: ['ETH'] }] }))
    const { resultados, fallos } = await puntuarTitulares({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: TITULARES.slice(0, 1), monedas: MONEDAS })
    assert.deepEqual(fallos, [])
    assert.deepEqual(resultados.a, { puntuacion: 0.3, monedas: ['ETH'], motor: 'cf' })
    assert.equal(ai.llamadas.length, 2)
    assert.ok(ai.llamadas[0].entrada.response_format)
    assert.equal(ai.llamadas[1].entrada.response_format, undefined)
  })

  test('explicaciones: response como objeto (salida grabada) → texto del LLM; la petición pide cada símbolo', async () => {
    const ai = simularAi(EXPLICACIONES)
    const senales = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].map((simbolo) => senal({ simbolo, veredicto: 'MANTENER' }))
    const { textos, fallos } = await explicarSenales({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), senales })
    assert.deepEqual(fallos, [])
    assert.deepEqual(Object.values(textos).map((t) => t.motor), Array(5).fill('cf'))
    assert.equal(textos.BTC.texto, EXPLICACIONES.response.explicaciones.BTC)
    const esquema = ai.llamadas[0].entrada.response_format.json_schema
    assert.deepEqual(esquema.properties.explicaciones.required, ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'])
  })
})

// @ts-check
// Lectura de la señal para la interfaz: veredicto, barras T/D/N/F (spec §6), Fear & Greed, titulares e historial.
// Funciones puras: reciben las formas del «Contrato de la API» y devuelven textos ya formateados.
import { ESTRATEGIAS } from '../core/estrategias.js'
import { claseSigno, fechaHora, hace, numero, porcentaje, precio } from './formato.js'

/** Más de 2 h sin recalcular = desactualizada (como `datosDesactualizados` del Worker). */
export const VIEJA_MS = 2 * 3_600_000

/** @type {Record<string, { texto: string, clase: string }>} */
export const VEREDICTOS = Object.freeze({
  COMPRAR: { texto: 'Comprar', clase: 'comprar' },
  MANTENER: { texto: 'Mantener', clase: 'mantener' },
  VENDER: { texto: 'Vender', clase: 'vender' },
  SIN_DATOS: { texto: 'Sin datos', clase: 'sin-datos' },
})

/** @param {string} v */
export const veredicto = (v) => VEREDICTOS[v] ?? { texto: v, clase: 'sin-datos' }

/** Componentes de la puntuación en el orden de la spec (§6.1-6.4). */
export const COMPONENTES = Object.freeze([
  { clave: 'tecnico', letra: 'T', nombre: 'Técnico' },
  { clave: 'derivados', letra: 'D', nombre: 'Derivados' },
  { clave: 'noticias', letra: 'N', nombre: 'Noticias y rumores' },
  { clave: 'fng', letra: 'F', nombre: 'Fear & Greed' },
])

/**
 * Pesos de la estrategia de la señal; las del laboratorio (v3…) no tienen y usan los de v1: solo dan T y el
 * peso efectivo se renormaliza sobre los presentes.
 * @param {string|undefined} version @returns {Record<string, number>}
 */
function pesosDe(version) {
  /** @type {{ PARAMETROS: { pesos?: Record<string, number> } }} */
  const e = version && Object.hasOwn(ESTRATEGIAS, version) ? ESTRATEGIAS[/** @type {keyof typeof ESTRATEGIAS} */ (version)] : ESTRATEGIAS.v1
  return e.PARAMETROS.pesos ?? ESTRATEGIAS.v1.PARAMETROS.pesos
}

/**
 * Barras T/D/N/F: valor en [-1, 1], ausentes marcados y peso renormalizado sobre los presentes (§6.5).
 * @param {any} senal SenalCompleta
 */
export function barrasComponentes(senal) {
  const pesos = pesosDe(senal?.version)
  const ausentes = new Set(Array.isArray(senal?.ausentes) ? senal.ausentes : [])
  const filas = COMPONENTES.map((c) => {
    const bruto = senal?.componentes?.[c.clave]
    const ausente = ausentes.has(c.clave) || typeof bruto !== 'number'
    const valor = ausente ? null : /** @type {number} */ (bruto)
    return {
      ...c, valor, ausente, peso: pesos[c.clave],
      texto: ausente ? 'ausente' : numero(valor, 2, { signo: true }),
      ancho: valor === null ? 0 : Math.min(1, Math.abs(valor)),
      sentido: valor === null || valor === 0 ? 'neutro' : valor > 0 ? 'positivo' : 'negativo',
    }
  })
  const sumaPresentes = filas.filter((f) => !f.ausente).reduce((s, f) => s + f.peso, 0)
  return filas.map((f) => ({ ...f, pesoEfectivo: f.ausente || sumaPresentes === 0 ? 0 : f.peso / sumaPresentes }))
}

/**
 * Tarjeta del Panel a partir de una SenalResumen.
 * @param {any} s SenalResumen
 * @param {number} ahora instante del servidor (`resumen.ahora`), no el reloj del móvil
 */
export function tarjetaMoneda(s, ahora) {
  const v = veredicto(s.veredicto)
  return {
    simbolo: s.simbolo,
    precio: precio(s.precioEur),
    cambio: porcentaje(s.cambio24h, { signo: true }),
    claseCambio: claseSigno(s.cambio24h),
    veredicto: v.texto,
    claseVeredicto: v.clase,
    confianza: porcentaje(s.indiceConfianza, { decimales: 0 }),
    puntuacion: numero(s.puntuacion, 2, { signo: true }),
    frase: s.frase || 'Sin explicación.',
    actualizada: hace(s.calculadaEn, ahora),
    desactualizada: !s.fresca || ahora - s.calculadaEn > VIEJA_MS,
    version: s.estrategiaVersion,
  }
}

/** @type {Record<string, string>} */
const FNG_ES = {
  'Extreme Fear': 'Miedo extremo', Fear: 'Miedo', Neutral: 'Neutral', Greed: 'Codicia', 'Extreme Greed': 'Codicia extrema',
}

/**
 * Punto del arco del medidor (semicírculo de izquierda, 0, a derecha, 100).
 * @param {number} valor 0-100
 * @param {number} cx @param {number} cy @param {number} r
 */
export function puntoArco(valor, cx, cy, r) {
  const angulo = Math.PI * (1 - Math.min(100, Math.max(0, valor)) / 100)
  return { x: cx + r * Math.cos(angulo), y: cy - r * Math.sin(angulo) }
}

/**
 * Medidor de Fear & Greed. null si no hay dato.
 * @param {{ valor: number, clasificacion: string, t: number }|null} fng
 */
export function lecturaFng(fng) {
  if (!fng || typeof fng.valor !== 'number') return null
  const v = fng.valor
  const clase = v < 25 ? 'miedo-extremo' : v < 45 ? 'miedo' : v <= 55 ? 'neutral' : v <= 75 ? 'codicia' : 'codicia-extrema'
  const P = ESTRATEGIAS.v1.PARAMETROS.fng
  return {
    valor: v,
    texto: FNG_ES[fng.clasificacion] ?? fng.clasificacion,
    clase,
    fecha: fechaHora(fng.t),
    cuenta: v < P.miedo || v > P.codicia,
    nota: `Solo cuenta en la señal en extremos (menos de ${P.miedo} o más de ${P.codicia}), a la contra.`,
  }
}

/** @type {Record<string, string>} */
export const MOTIVOS = Object.freeze({
  abierta: 'Abrió posición',
  cerrada: 'Cerró la posición por señal',
  mantener: 'Mantener',
  sin_posicion: 'Vender sin posición abierta',
  ya_en_posicion: 'Ya había posición',
  confianza_baja: 'Confianza por debajo del mínimo',
  saldo_insuficiente: 'Saldo insuficiente',
  datos_desactualizados: 'Datos desactualizados',
  sin_datos: 'Sin datos de velas',
  enfriamiento: 'Enfriamiento tras un stop-loss',
  cerrada_por_stop: 'Cerrada por stop en esta hora',
  fuera_de_ventana: 'Fuera de la ventana de decisión (las estrategias diarias deciden a las 00:00 UTC)',
  fuera_de_revision: 'Fuera del día de revisión (revisa una vez por semana, los lunes)',
  sobre_sma5: 'El cierre supera la SMA5',
  plazo: 'Plazo cumplido desde la entrada',
  contradiccion_tecnico_derivados: 'Técnico y derivados se contradicen',
  filtro_regimen: 'Filtro de régimen: cierre diario bajo la EMA200',
  velas_insuficientes: 'Velas insuficientes',
  senal: 'Señal',
  stop_loss: 'Stop-loss',
  take_profit: 'Take-profit',
})

/** @param {string|null|undefined} motivo */
export const textoMotivo = (motivo) => (motivo ? MOTIVOS[motivo] ?? motivo : '—')

/** @type {Record<string, string>} */
const MOTORES = { cf: 'Workers AI', groq: 'Groq', gemini: 'Gemini', lexico: 'Léxico local', plantilla: 'Plantilla' }

/** @param {string|null|undefined} motor */
export const textoMotor = (motor) => (motor ? MOTORES[motor] ?? motor : 'Sin puntuar')

/**
 * Indicadores por temporalidad (1D, 4H, 1H); null en la API → fila ausente.
 * @param {any} senal SenalCompleta
 */
export function filasTimeframes(senal) {
  return /** @type {const} */ (['1d', '4h', '1h']).map((tf) => {
    const t = senal?.detalle?.timeframes?.[tf]
    const etiqueta = tf.toUpperCase()
    if (!t) return { tf: etiqueta, ausente: true, tendencia: '—', rsi: '—', puntuacion: '—', ema200: '—', clase: 'neutro' }
    return {
      tf: etiqueta, ausente: false, tendencia: t.tendencia, rsi: numero(t.rsi, 1),
      puntuacion: numero(t.puntuacion, 2, { signo: true }), clase: claseSigno(t.puntuacion),
      ema200: t.precio > t.ema200 ? 'por encima' : 'por debajo',
    }
  })
}

/**
 * SL/TP orientativos en € si se abriera ahora (no son los de ninguna posición); null el nivel que la estrategia no usa.
 * @param {any} senal
 */
export const orientativo = (senal) => (senal?.orientativo
  ? {
    stopLoss: typeof senal.orientativo.stopLoss === 'number' ? precio(senal.orientativo.stopLoss) : null,
    takeProfit: typeof senal.orientativo.takeProfit === 'number' ? precio(senal.orientativo.takeProfit) : null,
  }
  : null)

/** Solo enlaces http(s): un titular nunca puede inyectar javascript:. @param {string|null|undefined} url */
export const urlSegura = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null)

/**
 * @param {any} t Titular
 * @param {number} ahora
 */
export const lecturaTitular = (t, ahora) => ({
  titulo: t.titulo,
  url: urlSegura(t.url),
  fuente: t.fuente,
  origen: t.origen === 'reddit' ? 'Reddit' : 'RSS',
  cuando: hace(t.publicadoEn, ahora),
  puntuacion: numero(t.puntuacion, 2, { signo: true }),
  clase: claseSigno(t.puntuacion),
  motor: textoMotor(t.motor),
  usado: t.usado === true,
  monedas: Array.isArray(t.monedas) ? t.monedas.join(', ') : '',
})

/** @param {any} d Decision */
export function filaDecision(d) {
  const v = veredicto(d.veredicto)
  return {
    id: d.id,
    simbolo: d.simbolo,
    cuando: fechaHora(d.vela1h),
    veredicto: v.texto,
    claseVeredicto: v.clase,
    puntuacion: numero(d.puntuacion, 2, { signo: true }),
    confianza: porcentaje(d.indiceConfianza, { decimales: 0 }),
    accion: d.accion === 'abrir' ? 'Abrir' : d.accion === 'cerrar' ? 'Cerrar' : 'Ninguna',
    ejecutada: d.accion === 'abrir' || d.accion === 'cerrar',
    motivo: textoMotivo(d.motivo),
    precio: precio(d.precio),
    version: d.estrategiaVersion,
  }
}

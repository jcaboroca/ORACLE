// @ts-check
// Detalle de moneda (spec §12): velas 1H/4H/1D de Binance (de OKX si Binance falla) con EMA20/50/200 y RSI,
// barras T/D/N/F con los ausentes marcados, explicación, titulares con puntuación y motor, historial de señales y SL/TP orientativos.
import { aviso, h, insignia, tabla } from '../dom.js'
import { claseSigno, hace, numero, porcentaje, precio } from '../formato.js'
import { graficoVelas } from '../graficos.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { ETIQUETA_TEMPORALIDAD, TEMPORALIDADES, indicadoresDe, velasDeMoneda } from '../series.js'
import {
  VIEJA_MS, barrasComponentes, filaDecision, filasTimeframes, lecturaTitular, orientativo, textoMotivo, textoMotor, veredicto,
} from '../senal.js'
import { avisoDeError, cabecera, intentar, notaAtribucion, seccion } from './comun.js'

/** @param {ReturnType<typeof barrasComponentes>[number]} b */
function barra(b) {
  const titulo = `${b.letra} · ${b.nombre}`
  const peso = b.ausente
    ? `peso ${porcentaje(b.peso, { decimales: 0 })}, no cuenta`
    : `peso ${porcentaje(b.peso, { decimales: 0 })} → ${porcentaje(b.pesoEfectivo, { decimales: 0 })}`
  return h('li', { class: `componente ${b.ausente ? 'ausente' : ''}` },
    h('div', { class: 'componente-cabecera' }, h('span', { class: 'componente-nombre' }, titulo), h('span', { class: 'componente-peso' }, peso)),
    h('div', { class: 'componente-pista', role: 'img', 'aria-label': b.ausente ? `${b.nombre}: ausente` : `${b.nombre}: ${b.texto} sobre 1` },
      b.ausente ? null : h('span', { class: `componente-barra ${b.sentido}`, style: `--ancho: ${(b.ancho * 50).toFixed(2)}%` })),
    h('span', { class: `componente-valor ${b.sentido}` }, b.ausente ? 'Ausente' : b.texto))
}

/** @param {any} senal SenalCompleta o null @param {number} ahora */
function bloqueSenal(senal, ahora) {
  if (!senal) return aviso('Aún no hay señal para esta moneda: llega con el cron de mercado.', 'info')
  const v = veredicto(senal.veredicto)
  const vieja = !senal.fresca || ahora - senal.calculadaEn > VIEJA_MS
  const sltp = orientativo(senal)
  return h('div', { class: 'senal' },
    h('div', { class: 'senal-cabecera' },
      insignia(v.texto, v.clase),
      h('span', { class: 'tarjeta-precio' }, precio(senal.precioEur)),
      h('span', { class: `cambio ${claseSigno(senal.cambio24h)}` }, `${porcentaje(senal.cambio24h, { signo: true })} 24 h`)),
    h('p', null, `Índice de confianza (sin calibrar): ${porcentaje(senal.indiceConfianza, { decimales: 0 })} · Puntuación S ${numero(senal.puntuacion, 2, { signo: true })}`
      + `${senal.alineacion ? ' · temporalidades alineadas' : ''} · estrategia ${senal.version}`),
    senal.motivo ? h('p', null, `Motivo: ${textoMotivo(senal.motivo)}.`) : null,
    h('p', { class: 'ayuda' }, `Calculada ${hace(senal.calculadaEn, ahora)}.`, vieja ? h('span', { class: 'chip chip-alerta' }, 'desactualizada') : null),
    sltp ? h('p', null, `Si se abriera ahora (orientativo): stop-loss ${sltp.stopLoss} · take-profit ${sltp.takeProfit}.`) : null)
}

/**
 * Contenedor del gráfico + función que lo dibuja al montar.
 * @param {import('./comun.js').Contexto} ctx @param {string} simbolo @param {'1h'|'4h'|'1d'} tf
 */
function bloqueGrafico(ctx, simbolo, tf) {
  const lienzo = h('div', { class: 'grafico grafico-velas', role: 'group', 'aria-label': `Velas ${ETIQUETA_TEMPORALIDAD[tf]} de ${simbolo} con EMA20, EMA50, EMA200 y RSI` })
  const par = h('p', { class: 'ayuda par' }, 'Cargando velas…')
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Temporalidad' }, TEMPORALIDADES.map((t) => h('a', {
    href: hashDe('moneda', { simbolo, params: { tf: t } }), class: 'pestana', 'aria-current': t === tf ? 'page' : null,
  }, ETIQUETA_TEMPORALIDAD[t])))
  const leyenda = h('p', { class: 'leyenda' },
    h('span', { class: 'l-ema20' }, 'EMA20'), h('span', { class: 'l-ema50' }, 'EMA50'), h('span', { class: 'l-ema200' }, 'EMA200'),
    h('span', { class: 'l-rsi' }, 'RSI 14 (guías 30 y 70)'))
  const nodo = seccion('Gráfico', pestanas, par, lienzo, leyenda, notaAtribucion())
  const montar = async () => {
    const r = await intentar(velasDeMoneda({ simbolo, temporalidad: tf, fetch: ctx.fetch }))
    if (!r.ok) {
      lienzo.replaceWith(aviso(`No se pudieron cargar las velas: ${r.error instanceof Error ? r.error.message : String(r.error)}`, 'error'))
      par.remove()
      return () => {}
    }
    const { respaldo, fuente, velas } = r.valor
    const origen = fuente === 'OKX' ? 'OKX, porque Binance no respondió' : 'Binance'
    par.textContent = respaldo
      ? `Par ${simbolo}/USDT · ${velas.length} velas de ${origen}. No hay par en euros: precios en dólares USDT.`
      : `Par ${simbolo}/EUR · ${velas.length} velas de ${origen} (la última puede estar abierta).`
    return graficoVelas(lienzo, { velas, indicadores: indicadoresDe(velas) })
  }
  return { nodo, montar }
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaMoneda(ctx) {
  const simbolo = /** @type {string} */ (ctx.ruta.simbolo)
  const tf = paramOpcion(ctx.ruta.params, 'tf', TEMPORALIDADES, '1h')
  const grafico = bloqueGrafico(ctx, simbolo, tf)
  const volver = h('a', { href: hashDe('panel'), class: 'volver' }, '← Panel')
  /** @type {any} */
  let m
  try {
    m = await ctx.api.moneda(simbolo)
  } catch (e) {
    const nodo = h('div', { class: 'vista' }, volver, cabecera(simbolo), avisoDeError(e), grafico.nodo)
    return { titulo: simbolo, nodo, montar: () => crearLimpieza(grafico.montar()) }
  }
  const ahora = ctx.ahora()
  const senal = m.senal
  const titulares = m.titulares.map((/** @type {any} */ t) => lecturaTitular(t, ahora))
  const nodo = h('div', { class: 'vista vista-moneda' },
    volver,
    cabecera(simbolo, bloqueSenal(senal, ahora)),
    grafico.nodo,
    senal ? seccion('Desglose de la puntuación',
      h('ul', { class: 'componentes' }, barrasComponentes(senal).map(barra)),
      h('p', { class: 'ayuda' }, 'Cada componente va de −1 a +1. Los ausentes no cuentan y su peso se reparte entre los presentes (§6.5). El Fear & Greed solo puntúa en extremos.'),
      tabla({
        titulo: 'Técnico por temporalidad',
        columnas: [{ clave: 'tf', texto: 'Temporalidad' }, { clave: 'tendencia', texto: 'Tendencia' }, { clave: 'rsi', texto: 'RSI', numerica: true },
          { clave: 'ema200', texto: 'Precio vs EMA200' }, { clave: 'puntuacion', texto: 'Puntuación', numerica: true }],
        filas: filasTimeframes(senal),
      })) : null,
    senal ? seccion('Explicación', h('p', { class: 'explicacion' }, senal.explicacion || 'Sin explicación.'),
      h('p', { class: 'ayuda' }, `Redactada por: ${textoMotor(senal.motorExplicacion)}.`)) : null,
    seccion(`Titulares (24 h, ${titulares.length})`, titulares.length === 0
      ? h('p', { class: 'vacio' }, 'Sin titulares de esta moneda ni del mercado en las 24 h previas a la señal.')
      : h('ul', { class: 'titulares' }, titulares.map((/** @type {ReturnType<typeof lecturaTitular>} */ t) => h('li', { class: 'titular' },
        t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, t.titulo) : h('span', null, t.titulo),
        h('p', { class: 'ayuda' },
          `${t.fuente} (${t.origen}) · ${t.cuando} · `, h('span', { class: t.clase }, `puntuación ${t.puntuacion}`), ` · ${t.motor}`,
          t.usado ? h('span', { class: 'chip' }, 'usado en N') : null))))),
    seccion('Historial de señales del bot', tabla({
      titulo: `Últimas decisiones de ${simbolo}`,
      columnas: [{ clave: 'cuando', texto: 'Vela' }, { clave: 'veredicto', texto: 'Señal' }, { clave: 'puntuacion', texto: 'S', numerica: true },
        { clave: 'confianza', texto: 'Confianza', numerica: true }, { clave: 'motivo', texto: 'Decisión' }],
      filas: m.decisiones.map(filaDecision),
      claseFila: (f) => (f.ejecutada ? 'ejecutada' : undefined),
      vacio: 'Sin decisiones en la simulación activa.',
    })))
  return { titulo: simbolo, nodo, montar: () => crearLimpieza(grafico.montar()) }
}

/**
 * El gráfico se dibuja de forma asíncrona; la limpieza espera a que exista.
 * @param {Promise<() => void>} promesa
 */
function crearLimpieza(promesa) {
  let limpiar = () => {}
  let cancelado = false
  promesa.then((f) => {
    if (cancelado) f()
    else limpiar = f
  }, () => {})
  return () => {
    cancelado = true
    limpiar()
  }
}

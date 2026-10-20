// @ts-check
// Lectura de la cartera del bot y del backtest para la interfaz: métricas de §7.7, posiciones, operaciones,
// filtros de decisiones, simulaciones y reinicio. Funciones puras sobre las formas del «Contrato de la API»
// y de data/backtest-vN.json.
import { claseSigno, entero, euros, fecha, fechaHora, leerImporte, numero, porcentaje, precio } from './formato.js'
import { textoMotivo, veredicto } from './senal.js'

/** Límites de `POST /api/bot/reiniciar` (CAPITAL_MINIMO y CAPITAL_MAXIMO de worker/src/api.js). */
export const CAPITAL_MINIMO = 100
export const CAPITAL_MAXIMO = 1_000_000
export const CAPITAL_POR_DEFECTO = 10_000

/** @typedef {{ etiqueta: string, valor: string, clase?: string, ayuda?: string }} Fila */

/** El drawdown llega positivo (0,25 = caída del 25 %) y se enseña negativo; sin caída, 0 (nunca '-0,00 %'). @param {number|null|undefined} d */
const caida = (d) => (typeof d === 'number' && d > 0 ? -d : d)

/**
 * Las métricas de §7.7 en filas etiquetadas.
 * @param {any} m Metricas (API) o `metricas` de data/backtest-vN.json (misma forma)
 * @returns {Fila[]}
 */
export function filasMetricas(m) {
  return [
    { etiqueta: 'Valor de cartera', valor: euros(m.valorCartera) },
    { etiqueta: 'Saldo disponible', valor: euros(m.saldo) },
    { etiqueta: 'Beneficio realizado', valor: euros(m.beneficioRealizado, { signo: true }), clase: claseSigno(m.beneficioRealizado) },
    { etiqueta: 'Beneficio no realizado', valor: euros(m.beneficioNoRealizado, { signo: true }), clase: claseSigno(m.beneficioNoRealizado) },
    { etiqueta: 'Rentabilidad neta', valor: porcentaje(m.rentabilidad, { signo: true }), clase: claseSigno(m.rentabilidad), ayuda: 'Después de comisiones y deslizamiento.' },
    { etiqueta: 'Comprar y mantener', valor: porcentaje(m.rentabilidadHodl, { signo: true }), clase: claseSigno(m.rentabilidadHodl), ayuda: 'El capital inicial repartido a partes iguales entre las monedas el primer día.' },
    { etiqueta: 'Drawdown máximo', valor: porcentaje(caida(m.drawdownMaximo)), ayuda: 'Mayor caída desde un máximo de la curva horaria.' },
    { etiqueta: 'Drawdown de comprar y mantener', valor: porcentaje(caida(m.drawdownMaximoHodl)) },
    { etiqueta: 'Operaciones (compras + ventas)', valor: entero(m.operaciones) },
    { etiqueta: 'Ganadoras / perdedoras', valor: `${entero(m.ganadoras)} / ${entero(m.perdedoras)}`, ayuda: `${entero(m.cerradas)} posiciones cerradas.` },
    { etiqueta: 'Beneficio medio por operación cerrada', valor: euros(m.beneficioMedio, { signo: true }), clase: claseSigno(m.beneficioMedio) },
    { etiqueta: 'Comisiones', valor: euros(m.comisiones) },
    { etiqueta: 'Deslizamiento', valor: euros(m.deslizamiento) },
    { etiqueta: 'Frecuencia', valor: m.operacionesPorSemana === null || m.operacionesPorSemana === undefined ? '—' : `${numero(m.operacionesPorSemana, 1)} por semana` },
  ]
}

/**
 * Métricas por moneda, en el orden dado (las que no operaron, al final y en orden alfabético).
 * @param {Record<string, any>} porMoneda ResumenOperaciones por símbolo
 * @param {string[]} [orden]
 */
export function filasPorMoneda(porMoneda, orden = []) {
  const simbolos = Object.keys(porMoneda ?? {}).sort((a, b) => {
    const ia = orden.indexOf(a)
    const ib = orden.indexOf(b)
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.localeCompare(b)
  })
  return simbolos.map((simbolo) => {
    const r = porMoneda[simbolo]
    return {
      simbolo,
      operaciones: entero(r.operaciones),
      ganadorasPerdedoras: `${entero(r.ganadoras)} / ${entero(r.perdedoras)}`,
      beneficio: euros(r.beneficioRealizado, { signo: true }),
      clase: claseSigno(r.beneficioRealizado),
      medio: euros(r.beneficioMedio, { signo: true }),
      costes: euros(r.comisiones + r.deslizamiento),
    }
  })
}

/**
 * Comparación honesta con comprar y mantener, en puntos porcentuales.
 * @param {number|null|undefined} rentabilidad @param {number|null|undefined} rentabilidadHodl fracciones
 */
export function frenteAHodl(rentabilidad, rentabilidadHodl) {
  if (typeof rentabilidad !== 'number' || typeof rentabilidadHodl !== 'number') {
    return { texto: 'Comprar y mantener aún sin valorar.', clase: 'neutro', bate: null }
  }
  const diferencia = rentabilidad - rentabilidadHodl
  const puntos = numero(Math.abs(diferencia) * 100, 2)
  const bate = diferencia > 0
  const texto = diferencia === 0
    ? 'Igual que comprar y mantener.'
    : `${puntos} puntos ${bate ? 'por encima' : 'por debajo'} de comprar y mantener (${porcentaje(rentabilidadHodl, { signo: true })}).`
  return { texto, clase: claseSigno(diferencia), bate }
}

/** @param {any} p Posicion */
export const filaPosicion = (p) => ({
  simbolo: p.simbolo,
  desde: fechaHora(p.velaEntrada),
  entrada: precio(p.precioEntrada),
  actual: precio(p.precioActual),
  unidades: numero(p.unidades, 6),
  coste: euros(p.coste),
  valor: euros(p.valorActual),
  stopLoss: precio(p.stopLoss),
  takeProfit: precio(p.takeProfit),
  pnl: `${euros(p.pnlNoRealizado, { signo: true })} (${porcentaje(p.pnlNoRealizadoPct, { signo: true })})`,
  clase: claseSigno(p.pnlNoRealizado),
})

/** @param {any} o Operacion de la API */
export const filaOperacion = (o) => ({
  id: o.id,
  cuando: fechaHora(o.vela1h),
  simbolo: o.simbolo,
  lado: o.lado === 'compra' ? 'Compra' : 'Venta',
  precio: precio(o.precio),
  unidades: numero(o.unidades, 6),
  importe: euros(o.importe),
  costes: euros(o.comision + o.deslizamiento),
  motivo: textoMotivo(o.motivo),
  pnl: o.pnlNeto === null || o.pnlNeto === undefined ? '' : euros(o.pnlNeto, { signo: true }),
  clase: claseSigno(o.pnlNeto),
})

/** Filtros del historial de decisiones (spec §12: incluye HOLD y no ejecutadas). */
export const FILTROS_DECISION = Object.freeze([
  { clave: 'todas', texto: 'Todas' },
  { clave: 'ejecutadas', texto: 'Ejecutadas' },
  { clave: 'no_ejecutadas', texto: 'Compra o venta no ejecutada' },
  { clave: 'hold', texto: 'Mantener (HOLD)' },
])

/**
 * @param {any[]} decisiones
 * @param {string} filtro clave de FILTROS_DECISION (otra → todas)
 */
export function filtrarDecisiones(decisiones, filtro) {
  const ejecutada = (/** @type {any} */ d) => d.accion === 'abrir' || d.accion === 'cerrar'
  if (filtro === 'ejecutadas') return decisiones.filter(ejecutada)
  if (filtro === 'no_ejecutadas') return decisiones.filter((d) => !ejecutada(d) && (d.veredicto === 'COMPRAR' || d.veredicto === 'VENDER'))
  if (filtro === 'hold') return decisiones.filter((d) => d.veredicto === 'MANTENER')
  return decisiones
}

/**
 * Opciones del selector de simulación (la API las da por id descendente).
 * @param {any[]} simulaciones
 */
export const opcionesSimulacion = (simulaciones) => simulaciones.map((s) => ({
  valor: String(s.id),
  texto: `Simulación ${s.id} · ${s.estrategiaVersion} · ${euros(s.capitalInicial)} · ${s.activa ? `activa desde ${fecha(s.creadaEn)}` : `cerrada el ${fecha(s.cerradaEn)}`}`,
}))

/**
 * Capital del reinicio escrito a la española, dentro de los límites del Worker.
 * @param {string} texto
 * @returns {{ ok: true, capital: number } | { ok: false, error: string }}
 */
export function validarCapital(texto) {
  const capital = leerImporte(texto)
  if (capital === null) return { ok: false, error: 'Escribe un importe en euros, por ejemplo 10.000.' }
  if (capital < CAPITAL_MINIMO || capital > CAPITAL_MAXIMO) {
    return { ok: false, error: `El capital debe estar entre ${euros(CAPITAL_MINIMO)} y ${euros(CAPITAL_MAXIMO)}.` }
  }
  return { ok: true, capital }
}

/** @type {Record<string, string>} */
const VARIANTES = { 'tecnico+fng': 'técnico + Fear & Greed', tecnico: 'solo técnico' }

/**
 * Recuento de decisiones del backtest ('COMPRAR:abierta' → n) en filas, de más a menos frecuente.
 * @param {Record<string, number>} decisiones
 */
export const filasDecisionesBacktest = (decisiones) => Object.entries(decisiones ?? {})
  .map(([clave, n]) => {
    const [v, motivo] = clave.split(':')
    return { veredicto: veredicto(v).texto, claseVeredicto: veredicto(v).clase, motivo: textoMotivo(motivo), n, cantidad: entero(n) }
  })
  .sort((a, b) => b.n - a.n)

/**
 * Cierres de posición del backtest por motivo (señal, stop-loss, take-profit).
 * @param {{ tipo: string, motivo: string }[]} operaciones
 */
export function salidasBacktest(operaciones) {
  /** @type {Record<string, number>} */
  const n = {}
  for (const o of operaciones ?? []) if (o.tipo === 'venta') n[o.motivo] = (n[o.motivo] ?? 0) + 1
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([motivo, cantidad]) => ({ motivo: textoMotivo(motivo), cantidad: entero(cantidad) }))
}

/**
 * Todo lo que enseña la pestaña Backtest de un data/backtest-vN.json.
 * @param {any} b
 */
export function lecturaBacktest(b) {
  return {
    version: b.version,
    variante: VARIANTES[b.variante] ?? b.variante,
    periodo: `${fecha(b.desde)} – ${fecha(b.hasta)}`,
    capitalInicial: euros(b.capitalInicial),
    monedas: (b.monedas ?? []).join(', '),
    cadencia: (b.parametros?.bot?.cadenciaHoras ?? 1) === 24 ? 'una vez al día (00:00 UTC)' : 'cada hora',
    metricas: filasMetricas(b.metricas),
    rentabilidad: porcentaje(b.metricas?.rentabilidad, { signo: true }),
    frenteHodl: frenteAHodl(b.metricas?.rentabilidad, b.metricas?.rentabilidadHodl),
    porMoneda: filasPorMoneda(b.porMoneda, b.monedas),
    decisiones: filasDecisionesBacktest(b.decisiones),
    salidas: salidasBacktest(b.operaciones),
    curva: b.curvaDiaria ?? [],
    aviso: b.aviso ?? '',
    generado: fechaHora(Date.parse(b.generadoEn)),
  }
}

/**
 * Nota honesta sobre todos los backtests cargados: si ninguno bate a comprar y mantener, se dice.
 * @param {any[]} backtests data/backtest-vN.json cargados
 */
export function notaBacktest(backtests) {
  const validos = backtests.filter((b) => typeof b?.metricas?.rentabilidad === 'number' && typeof b?.metricas?.rentabilidadHodl === 'number')
  const futuro = 'Un backtest no garantiza resultados futuros.'
  if (validos.length === 0) return futuro
  const versiones = validos.map((b) => b.version).join(' y ')
  if (validos.every((b) => b.metricas.rentabilidad <= b.metricas.rentabilidadHodl)) {
    return `${validos.length > 1 ? `Ninguna de las estrategias (${versiones})` : `La estrategia ${versiones} no`} bate a comprar y mantener en este periodo. ${futuro}`
  }
  return `Alguna estrategia supera a comprar y mantener en este periodo, pero sin noticias ni derivados y con costes aproximados. ${futuro}`
}

/**
 * Filas de la tabla de la comparativa (GET /api/bot/comparativa): una por simulación activa, en el orden de la API,
 * y al final comprar y mantener. `id` (null en comprar y mantener) sirve para enlazar el detalle.
 * @param {any} c
 * @returns {{ id: number|null, estrategia: string, valor: string, rentabilidad: string, caida: string, operaciones: string,
 *   clase: string, principal: boolean }[]}
 */
export function filasComparativa(c) {
  const filas = (Array.isArray(c?.simulaciones) ? c.simulaciones : []).map((/** @type {any} */ s) => ({
    id: s.id,
    estrategia: `${s.etiqueta && s.etiqueta !== s.estrategiaVersion ? `${s.estrategiaVersion} · ${s.etiqueta}` : s.estrategiaVersion}`
      + `${s.principal ? ' (principal)' : ''}`,
    valor: euros(s.valorCartera),
    rentabilidad: porcentaje(s.rentabilidad, { signo: true }),
    caida: porcentaje(caida(s.drawdownMaximo)),
    operaciones: entero(s.operaciones),
    clase: claseSigno(s.rentabilidad),
    principal: s.principal === true,
  }))
  const hodl = c?.resumenHodl
  if (hodl) {
    filas.push({
      id: null, estrategia: 'Comprar y mantener', valor: euros(hodl.valor), rentabilidad: porcentaje(hodl.rentabilidad, { signo: true }),
      caida: porcentaje(caida(hodl.drawdownMaximo)), operaciones: '—', clase: claseSigno(hodl.rentabilidad), principal: false,
    })
  }
  return filas
}

/**
 * Qué estrategia da el consejo del Panel (`estrategiaPrincipal` de GET /api/resumen). '' si no viene (Worker anterior).
 * @param {any} principal { version, etiqueta, enVivo }
 */
export function textoConsejo(principal) {
  if (typeof principal?.version !== 'string' || principal.version === '') return ''
  const nombre = principal.etiqueta && principal.etiqueta !== principal.version ? `${principal.version} (${principal.etiqueta})` : principal.version
  const enVivo = typeof principal.enVivo === 'number' && principal.enVivo > 1 ? `, la principal de las ${principal.enVivo} en vivo` : ''
  return `Consejo de la estrategia ${nombre}${enVivo}.`
}

// @ts-check
// Bot (spec §12): valor de cartera frente a comprar y mantener, curva de capital, métricas de §7.7 (también por
// moneda), posiciones abiertas con SL/TP fijos, operaciones, decisiones con filtro, selector de simulación y reinicio.
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { mensajeError } from '../api.js'
import {
  CAPITAL_POR_DEFECTO, FILTROS_DECISION, filaOperacion, filaPosicion, filasMetricas, filasPorMoneda, filtrarDecisiones,
  frenteAHodl, opcionesSimulacion, validarCapital,
} from '../cartera.js'
import { aviso, definiciones, filaTabla, h, tabla } from '../dom.js'
import { entero, euros, fechaHora, porcentaje } from '../formato.js'
import { graficoCurva } from '../graficos.js'
import { conParams, hashDe, paramEntero, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { filaDecision } from '../senal.js'
import { avisoDeError, cabecera, intentar, notaAtribucion, seccion } from './comun.js'

const COLUMNAS_OPERACIONES = [
  { clave: 'cuando', texto: 'Vela' }, { clave: 'simbolo', texto: 'Moneda' }, { clave: 'lado', texto: 'Lado' },
  { clave: 'precio', texto: 'Precio', numerica: true }, { clave: 'importe', texto: 'Importe', numerica: true },
  { clave: 'costes', texto: 'Costes', numerica: true }, { clave: 'motivo', texto: 'Motivo' }, { clave: 'pnl', texto: 'Resultado', numerica: true },
]
const COLUMNAS_DECISIONES = [
  { clave: 'cuando', texto: 'Vela' }, { clave: 'simbolo', texto: 'Moneda' }, { clave: 'veredicto', texto: 'Señal' },
  { clave: 'confianza', texto: 'Confianza', numerica: true }, { clave: 'accion', texto: 'Acción' }, { clave: 'motivo', texto: 'Motivo' },
]

/**
 * Tabla con «Cargar más» (cursor de la API: 50 por página, recientes primero).
 * @param {{ titulo: string, columnas: { clave: string, texto: string, numerica?: boolean }[], pagina: { items: any[], siguienteCursor: number|null },
 *   cargar: (cursor: number) => Promise<{ items: any[], siguienteCursor: number|null }>, aFila: (x: any) => Record<string, unknown>,
 *   filtrar?: (items: any[]) => any[], vacio: string, claseFila?: (f: any) => string|undefined, exigirPin: (e: unknown) => boolean }} op
 */
function listaPaginada({ titulo, columnas, pagina, cargar, aFila, filtrar = (x) => x, vacio, claseFila, exigirPin }) {
  const contenedor = h('div', { class: 'paginada' })
  const estado = h('p', { class: 'ayuda', 'aria-live': 'polite' })
  /** @type {Record<string, unknown>[]} */
  let filas = filtrar(pagina.items).map(aFila)
  let cursor = pagina.siguienteCursor
  const pintar = () => contenedor.replaceChildren(tabla({ titulo, columnas, filas, vacio, claseFila }))
  pintar()
  const boton = h('button', { type: 'button', class: 'boton' }, 'Cargar más')
  boton.hidden = cursor === null
  boton.addEventListener('click', async () => {
    if (cursor === null) return
    boton.disabled = true
    const r = await intentar(cargar(cursor))
    boton.disabled = false
    if (!r.ok) {
      if (exigirPin(r.error)) return
      estado.textContent = mensajeError(r.error)
      return
    }
    const nuevas = filtrar(r.valor.items).map(aFila)
    const cuerpo = contenedor.querySelector('tbody')
    if (cuerpo) for (const f of nuevas) cuerpo.append(filaTabla(columnas, f, claseFila))
    else if (nuevas.length > 0) {
      filas = nuevas
      pintar()
    }
    cursor = r.valor.siguienteCursor
    boton.hidden = cursor === null
    estado.textContent = `${nuevas.length} más${cursor === null ? '. No hay más.' : '.'}`
  })
  return h('div', null, contenedor, boton, estado)
}

/**
 * Diálogo de reinicio con confirmación (la simulación actual se cierra y se conserva; nada se borra).
 * @param {import('./comun.js').Contexto} ctx @param {any} simulacion
 */
function reinicio(ctx, simulacion) {
  const error = h('p', { class: 'error', role: 'alert' })
  const campo = h('input', { id: 'capital', name: 'capital', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: entero(CAPITAL_POR_DEFECTO), 'aria-describedby': 'capital-ayuda' })
  const confirmar = h('button', { type: 'submit', class: 'boton boton-peligro' }, 'Cerrar y empezar otra')
  const cancelar = h('button', { type: 'button', class: 'boton' }, 'Cancelar')
  const formulario = h('form', { class: 'formulario' },
    h('h3', { id: 'reinicio-titulo' }, 'Reiniciar la simulación'),
    h('p', null, `La simulación ${simulacion.id} se cerrará con su última valoración y se conservará todo su historial. `
      + `La nueva empieza con la estrategia ${ESTRATEGIA_ACTIVA} y el capital que indiques.`),
    h('label', { for: 'capital' }, 'Capital inicial (€)'),
    campo,
    h('p', { id: 'capital-ayuda', class: 'ayuda' }, 'Entre 100 € y 1.000.000 €.'),
    error,
    h('div', { class: 'acciones' }, cancelar, confirmar))
  const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'reinicio-titulo' }, formulario)
  cancelar.addEventListener('click', () => dialogo.close())
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    const v = validarCapital(campo.value)
    if (!v.ok) {
      error.textContent = v.error
      campo.focus()
      return
    }
    confirmar.disabled = true
    try {
      const r = await ctx.api.reiniciar(v.capital)
      dialogo.close()
      ctx.avisar(`Simulación ${r.simulacion.id} creada con ${euros(r.simulacion.capitalInicial)}. La anterior queda cerrada.`)
      ctx.navegar(hashDe('bot'))
    } catch (e) {
      if (ctx.exigirPin(e)) return
      error.textContent = mensajeError(e)
    } finally {
      confirmar.disabled = false
    }
  })
  const abrir = h('button', { type: 'button', class: 'boton boton-peligro' }, 'Reiniciar simulación…')
  abrir.addEventListener('click', () => {
    error.textContent = ''
    dialogo.showModal()
    campo.select()
  })
  return h('div', { class: 'reinicio' }, abrir, dialogo)
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBot(ctx) {
  const { ruta } = ctx
  const simulacion = paramEntero(ruta.params, 'simulacion')
  const simbolo = /^[A-Z0-9]{2,10}$/.test(ruta.params.simbolo ?? '') ? ruta.params.simbolo : null
  const filtro = paramOpcion(ruta.params, 'filtro', FILTROS_DECISION.map((f) => f.clave), 'todas')
  // Primero una sola petición: con un PIN caducado, 4 en paralelo gastarían 4 de los 5 intentos antes del bloqueo.
  const bot = await intentar(ctx.api.bot(simulacion))
  if (!bot.ok) {
    const sinSimulacion = /** @type {any} */ (bot.error)?.estado === 404 && simulacion === null
    const nodo = h('div', { class: 'vista' }, cabecera('Bot'),
      sinSimulacion ? aviso('Aún no hay simulación: se crea en la primera ejecución del cron de mercado (minuto 3 de cada hora).') : avisoDeError(bot.error))
    return { titulo: 'Bot', nodo }
  }
  const b = bot.valor
  const sim = b.simulacion
  const [sims, ops, decs] = await Promise.all([
    intentar(ctx.api.simulaciones()),
    intentar(ctx.api.operaciones({ simulacion: sim.id, simbolo })),
    intentar(ctx.api.decisiones({ simulacion: sim.id, simbolo })),
  ])
  const monedas = [...new Set([...Object.keys(b.hodl ?? {}), ...Object.keys(b.porMoneda), ...b.abiertas.map((/** @type {any} */ p) => p.simbolo)])]
  const comparacion = frenteAHodl(b.metricas.rentabilidad, b.metricas.rentabilidadHodl)

  const selectorSim = h('select', { id: 'simulacion' }, sims.ok
    ? opcionesSimulacion(sims.valor.items).map((o) => h('option', { value: o.valor, selected: o.valor === String(sim.id) }, o.texto))
    : h('option', { value: String(sim.id) }, `Simulación ${sim.id}`))
  selectorSim.addEventListener('change', () => ctx.navegar(conParams(ruta, { simulacion: selectorSim.value })))
  const selectorMoneda = h('select', { id: 'moneda' },
    h('option', { value: '' }, 'Todas'), monedas.map((m) => h('option', { value: m, selected: m === simbolo }, m)))
  selectorMoneda.addEventListener('change', () => ctx.navegar(conParams(ruta, { simbolo: selectorMoneda.value || null })))
  const selectorFiltro = h('select', { id: 'filtro' }, FILTROS_DECISION.map((f) => h('option', { value: f.clave, selected: f.clave === filtro }, f.texto)))
  selectorFiltro.addEventListener('change', () => ctx.navegar(conParams(ruta, { filtro: selectorFiltro.value === 'todas' ? null : selectorFiltro.value })))

  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': 'Curva de capital del bot frente a comprar y mantener' })
  const curva = curvaComparada(b.curva)
  const nodo = h('div', { class: 'vista vista-bot' },
    cabecera('Bot',
      h('div', { class: 'campo' }, h('label', { for: 'simulacion' }, 'Simulación'), selectorSim),
      h('p', { class: 'ayuda' }, `Estrategia ${sim.estrategiaVersion} · capital inicial ${euros(sim.capitalInicial)} · desde ${fechaHora(sim.creadaEn)}`
        + `${sim.activa ? '' : ` · cerrada el ${fechaHora(sim.cerradaEn)}`}`)),
    seccion('Resumen',
      h('p', { class: 'cifra-grande' }, euros(b.metricas.valorCartera)),
      h('p', null, `Rentabilidad ${porcentaje(b.metricas.rentabilidad, { signo: true })} · saldo ${euros(b.metricas.saldo)} · `
        + `realizado ${euros(b.metricas.beneficioRealizado, { signo: true })} · no realizado ${euros(b.metricas.beneficioNoRealizado, { signo: true })}`),
      h('p', { class: comparacion.clase }, comparacion.texto)),
    seccion('Curva de capital',
      curva.bot.length > 1 ? lienzo : h('p', { class: 'vacio' }, 'La curva aparece tras la segunda hora de la simulación.'),
      h('p', { class: 'leyenda' }, h('span', { class: 'l-bot' }, 'Bot'), h('span', { class: 'l-hodl' }, 'Comprar y mantener')),
      h('p', { class: 'ayuda' }, 'Horaria los últimos 30 días; antes, un punto por día.'),
      curva.bot.length > 1 ? notaAtribucion() : null),
    seccion('Métricas', definiciones(filasMetricas(b.metricas))),
    seccion('Por moneda', tabla({
      titulo: 'Métricas por moneda',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'operaciones', texto: 'Operaciones', numerica: true },
        { clave: 'ganadorasPerdedoras', texto: 'Gan. / perd.', numerica: true }, { clave: 'beneficio', texto: 'Realizado', numerica: true },
        { clave: 'medio', texto: 'Medio', numerica: true }, { clave: 'costes', texto: 'Costes', numerica: true }],
      filas: filasPorMoneda(b.porMoneda, monedas),
      vacio: 'Sin operaciones todavía.',
    })),
    seccion(`Posiciones abiertas (${b.abiertas.length})`, tabla({
      titulo: 'Posiciones abiertas',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'desde', texto: 'Desde' }, { clave: 'entrada', texto: 'Entrada', numerica: true },
        { clave: 'actual', texto: 'Actual', numerica: true }, { clave: 'stopLoss', texto: 'Stop-loss', numerica: true },
        { clave: 'takeProfit', texto: 'Take-profit', numerica: true }, { clave: 'valor', texto: 'Valor', numerica: true }, { clave: 'pnl', texto: 'No realizado', numerica: true }],
      filas: b.abiertas.map(filaPosicion),
      vacio: 'Ninguna posición abierta.',
    }), h('p', { class: 'ayuda' }, 'Stop-loss y take-profit se fijan al abrir y no se recalculan nunca.')),
    h('div', { class: 'filtros' }, h('div', { class: 'campo' }, h('label', { for: 'moneda' }, 'Moneda'), selectorMoneda)),
    seccion('Operaciones', ops.ok ? listaPaginada({
      titulo: 'Operaciones', columnas: COLUMNAS_OPERACIONES, pagina: ops.valor, aFila: filaOperacion, vacio: 'Sin operaciones.',
      cargar: (cursor) => ctx.api.operaciones({ simulacion: sim.id, simbolo, cursor }), claseFila: (f) => f.clase, exigirPin: ctx.exigirPin,
    }) : avisoDeError(ops.error)),
    seccion('Decisiones',
      h('div', { class: 'campo' }, h('label', { for: 'filtro' }, 'Mostrar'), selectorFiltro),
      decs.ok ? listaPaginada({
        titulo: 'Decisiones', columnas: COLUMNAS_DECISIONES, pagina: decs.valor, aFila: filaDecision, vacio: 'Ninguna decisión con este filtro en esta página.',
        filtrar: (items) => filtrarDecisiones(items, filtro), cargar: (cursor) => ctx.api.decisiones({ simulacion: sim.id, simbolo, cursor }),
        claseFila: (f) => (f.ejecutada ? 'ejecutada' : undefined), exigirPin: ctx.exigirPin,
      }) : avisoDeError(decs.error),
      h('p', { class: 'ayuda' }, 'Incluye MANTENER y las compras o ventas no ejecutadas, con su motivo.')),
    sim.activa ? seccion('Reinicio', reinicio(ctx, sim)) : null)
  return {
    titulo: 'Bot',
    nodo,
    montar: () => (curva.bot.length > 1 ? graficoCurva(lienzo, curva) : undefined),
  }
}

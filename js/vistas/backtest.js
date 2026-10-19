// @ts-check
// Backtest (spec §8 y §12): métricas de data/backtest-vN.json (una por estrategia) con la etiqueta
// «técnico + Fear & Greed», la versión, el periodo, la curva frente a comprar y mantener y una nota honesta.
import { ESTRATEGIAS, ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { lecturaBacktest, notaBacktest } from '../cartera.js'
import { aviso, definiciones, h, tabla } from '../dom.js'
import { graficoCurva } from '../graficos.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { cabecera, intentar, notaAtribucion, seccion } from './comun.js'

export const VERSIONES = Object.freeze(Object.keys(ESTRATEGIAS))

/**
 * data/backtest-vN.json, relativo a la página (funciona bajo /ORACLE/ en GitHub Pages).
 * @param {typeof fetch} fetch @param {string} version
 */
export async function cargarBacktest(fetch, version) {
  const respuesta = await fetch(`data/backtest-${version}.json`)
  if (!respuesta.ok) throw new Error(`data/backtest-${version}.json: HTTP ${respuesta.status}`)
  return respuesta.json()
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBacktest(ctx) {
  const version = paramOpcion(ctx.ruta.params, 'v', VERSIONES, ESTRATEGIA_ACTIVA)
  const cargados = await Promise.all(VERSIONES.map((v) => intentar(cargarBacktest(ctx.fetch, v))))
  const porVersion = Object.fromEntries(VERSIONES.map((v, i) => [v, cargados[i]]))
  const elegido = porVersion[version]
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Estrategia' }, VERSIONES.map((v) => h('a', {
    href: hashDe('backtest', { params: { v } }), class: 'pestana', 'aria-current': v === version ? 'page' : null,
  }, v === ESTRATEGIA_ACTIVA ? `${v} (activa)` : v)))
  const nota = notaBacktest(cargados.flatMap((c) => (c.ok ? [c.valor] : [])))
  if (!elegido.ok) {
    const nodo = h('div', { class: 'vista' }, cabecera('Backtest', pestanas),
      aviso(`No se pudo cargar el backtest de ${version}: ${elegido.error instanceof Error ? elegido.error.message : String(elegido.error)}`, 'error'))
    return { titulo: 'Backtest', nodo }
  }
  const l = lecturaBacktest(elegido.valor)
  const curva = curvaComparada(l.curva)
  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': `Curva de capital del backtest de ${l.version} frente a comprar y mantener` })
  const nodo = h('div', { class: 'vista vista-backtest' },
    cabecera('Backtest', pestanas,
      h('p', { class: 'etiqueta-variante' }, `Estrategia ${l.version} · ${l.variante}`),
      h('p', { class: 'ayuda' }, `Periodo ${l.periodo} · ${l.monedas} · capital ${l.capitalInicial} · decide ${l.cadencia} · generado el ${l.generado}`)),
    aviso(nota, 'alerta'),
    seccion('Resultado',
      h('p', { class: 'cifra-grande' }, l.metricas[0].valor),
      h('p', null, `Rentabilidad neta ${l.rentabilidad} con ${l.capitalInicial} de partida.`),
      h('p', { class: l.frenteHodl.clase }, l.frenteHodl.texto)),
    seccion('Curva de capital (diaria)', lienzo,
      h('p', { class: 'leyenda' }, h('span', { class: 'l-bot' }, `Estrategia ${l.version}`), h('span', { class: 'l-hodl' }, 'Comprar y mantener')),
      notaAtribucion()),
    seccion('Métricas', definiciones(l.metricas)),
    seccion('Por moneda', tabla({
      titulo: 'Métricas por moneda del backtest',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'operaciones', texto: 'Operaciones', numerica: true },
        { clave: 'ganadorasPerdedoras', texto: 'Gan. / perd.', numerica: true }, { clave: 'beneficio', texto: 'Realizado', numerica: true },
        { clave: 'medio', texto: 'Medio', numerica: true }, { clave: 'costes', texto: 'Costes', numerica: true }],
      filas: l.porMoneda,
    })),
    seccion('Cierres de posición', tabla({
      titulo: 'Cierres por motivo', columnas: [{ clave: 'motivo', texto: 'Motivo' }, { clave: 'cantidad', texto: 'Cierres', numerica: true }], filas: l.salidas,
    })),
    seccion('Decisiones', tabla({
      titulo: 'Decisiones del backtest por señal y motivo',
      columnas: [{ clave: 'veredicto', texto: 'Señal' }, { clave: 'motivo', texto: 'Decisión' }, { clave: 'cantidad', texto: 'Horas', numerica: true }],
      filas: l.decisiones,
    })),
    h('p', { class: 'ayuda' }, l.aviso,
      ' El backtest no usa noticias ni derivados: no hay histórico gratuito fiable, así que sus pesos se reparten entre técnico y Fear & Greed.'))
  return { titulo: 'Backtest', nodo, montar: () => graficoCurva(lienzo, curva) }
}

// @ts-check
// Backtest (spec §8 y §12): métricas de data/backtest-vN.json (una por estrategia) con la etiqueta
// «técnico + Fear & Greed», la versión, el periodo, la curva frente a comprar y mantener y una nota honesta.
// Pestaña «Laboratorio» (spec del laboratorio §7): ranking fuera de muestra, criterio punto por punto,
// resultados por año y por moneda y tramo reservado, de data/laboratorio.json.
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../../core/estrategias.js'
import { lecturaBacktest, notaBacktest } from '../cartera.js'
import { aviso, definiciones, h, tabla } from '../dom.js'
import { graficoCurva } from '../graficos.js'
import { NOMBRES_FAMILIA, cargarLaboratorio, lecturaLaboratorio } from '../laboratorio.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { cabecera, intentar, notaAtribucion, seccion } from './comun.js'

export const VERSIONES = Object.freeze(Object.keys(ESTRATEGIAS))
/** Valor de ?v= de la pestaña Laboratorio. */
export const LABORATORIO = 'laboratorio'

/** Texto de la pestaña de una versión: la principal y las demás en vivo, marcadas. @param {string} v */
export const textoPestana = (v) => (v === ESTRATEGIA_PRINCIPAL ? `${v} (principal)` : ESTRATEGIAS_EN_VIVO.includes(v) ? `${v} (en vivo)` : v)

/**
 * data/backtest-vN.json, relativo a la página (funciona bajo /ORACLE/ en GitHub Pages).
 * @param {typeof fetch} fetch @param {string} version
 */
export async function cargarBacktest(fetch, version) {
  const respuesta = await fetch(`data/backtest-${version}.json`)
  if (!respuesta.ok) throw new Error(`data/backtest-${version}.json: HTTP ${respuesta.status}`)
  return respuesta.json()
}

/**
 * Pestaña Laboratorio: sin data/laboratorio.json (404), «Laboratorio aún no ejecutado».
 * @param {import('./comun.js').Contexto} ctx @param {HTMLElement} pestanas
 * @returns {Promise<import('./comun.js').Pantalla>}
 */
async function vistaLaboratorio(ctx, pestanas) {
  const r = await intentar(cargarLaboratorio(ctx.fetch))
  if (!r.ok || r.valor === null) {
    const nodo = h('div', { class: 'vista' }, cabecera('Backtest', pestanas), r.ok
      ? aviso('Laboratorio aún no ejecutado: cuando exista data/laboratorio.json, aquí aparecerán el ranking y el criterio.')
      : aviso(`No se pudo cargar el laboratorio: ${r.error instanceof Error ? r.error.message : String(r.error)}`, 'error'))
    return { titulo: 'Backtest', nodo }
  }
  const l = lecturaLaboratorio(r.valor)
  /** Versión con la insignia «experimental» si se despliega sin cumplir el criterio. @param {{ version: string, experimental: boolean }} x */
  const conInsignia = (x) => (x.experimental ? h('span', null, `${x.version} `, insigniaExperimental()) : x.version)
  const nodo = h('div', { class: 'vista vista-laboratorio' },
    cabecera('Backtest', pestanas,
      h('p', { class: 'etiqueta-variante' }, 'Laboratorio de estrategias'),
      h('p', { class: 'ayuda' }, `Generado el ${l.generado} con datos hasta el ${l.datosHasta} · ${l.familias} familias · años de prueba ${l.tramos}`)),
    aviso(l.aviso, 'alerta'),
    l.criterio.length > 0
      ? seccion('Criterio de estrategia ganadora', h('p', null, 'Una familia es ganadora si cumple todos estos puntos, medidos fuera de muestra:'),
        h('ol', { class: 'criterio-lista' }, l.criterio.map((c) => h('li', null, c))))
      : null,
    seccion('Ranking fuera de muestra',
      tabla({
        titulo: 'Ranking del laboratorio',
        columnas: [{ clave: 'posicion', texto: '#', numerica: true }, { clave: 'familia', texto: 'Familia' }, { clave: 'version', texto: 'Versión' },
          { clave: 'rentabilidad', texto: 'Rentabilidad', numerica: true }, { clave: 'caida', texto: 'Caída máx.', numerica: true },
          { clave: 'rentabilidadHodl', texto: 'Comprar y mantener', numerica: true }, { clave: 'caidaHodl', texto: 'Su caída', numerica: true },
          { clave: 'textoCumple', texto: 'Criterio' }],
        filas: l.ranking.map((p) => ({ ...p, version: p.version ? conInsignia(p) : '—' })),
        vacio: 'El laboratorio no trae ranking.',
        claseFila: (p) => (p.cumple === true ? 'cumple-criterio' : undefined),
        apilable: true,
      }),
      l.conclusion ? h('p', { class: 'conclusion-laboratorio' }, l.conclusion) : null,
      h('p', { class: 'ayuda' }, `${l.ganadoras} de ${l.ranking.length} cumplen todos los puntos del criterio. Medido en años que no se usaron para elegir, con comisiones y deslizamiento.`)),
    seccion('Detalle por familia', l.ranking.map((p) => h('details', { class: 'familia-laboratorio' },
      h('summary', null, `${p.posicion}. ${p.familia}${p.version ? ` (${p.version})` : ''} · ${p.textoCumple}`,
        p.experimental ? ' ' : null, p.experimental ? insigniaExperimental() : null),
      p.config ? h('p', { class: 'ayuda' }, `Configuración: ${p.config}`) : null,
      h('ul', { class: 'criterio' }, p.puntos.map((x) => h('li', { class: x.cumple ? 'cumple' : 'no-cumple' }, `${x.marca} · ${x.texto}`))),
      tabla({
        titulo: `Por año: ${p.familia}`,
        columnas: [{ clave: 'ano', texto: 'Año' }, { clave: 'rentabilidad', texto: 'Estrategia', numerica: true }, { clave: 'hodl', texto: 'Comprar y mantener', numerica: true }],
        filas: p.porAno,
        vacio: 'Sin resultados por año.',
        apilable: true,
      }),
      tabla({
        titulo: `Por moneda: ${p.familia}`,
        columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'beneficio', texto: 'Beneficio realizado', numerica: true }, { clave: 'positivo', texto: '> 0' }],
        filas: p.porMoneda,
        vacio: 'Sin resultados por moneda.',
        apilable: true,
      })))),
    l.seleccion.length > 0
      ? seccion('Desplegadas en el bot', h('ul', { class: 'seleccion-laboratorio' }, l.seleccion.map((x) => h('li', null, x.texto,
        x.cumple === true ? h('span', { class: 'cumple' }, ' · ✓ cumple el criterio') : null,
        x.experimental ? ' ' : null, x.experimental ? insigniaExperimental() : null))),
      l.seleccion.some((x) => x.experimental)
        ? h('p', { class: 'ayuda' }, 'Experimental: no cumple el criterio; opera en el bot para comparar, no para fiarse de su consejo.')
        : null)
      : null,
    seccion('Tramo reservado',
      l.reservado.length > 0 ? definiciones(l.reservado) : null,
      tabla({
        titulo: 'Tramo reservado por estrategia',
        columnas: [{ clave: 'version', texto: 'Versión' }, { clave: 'rentabilidad', texto: 'Rentabilidad', numerica: true },
          { clave: 'caida', texto: 'Caída máx.', numerica: true }, { clave: 'operaciones', texto: 'Operaciones', numerica: true },
          { clave: 'rentabilidadHodl', texto: 'Comprar y mantener', numerica: true }, { clave: 'caidaHodl', texto: 'Su caída', numerica: true }],
        filas: l.reservadoPorVersion.map((x) => ({ ...x, version: conInsignia(x) })),
        vacio: l.reservado.length > 0 ? 'Sin resultados por estrategia.' : 'Sin datos del tramo reservado.',
        apilable: true,
      }),
      h('p', { class: 'ayuda' }, 'Se mide una sola vez, al final, y no se usa para elegir.')))
  return { titulo: 'Backtest', nodo }
}

/** Insignia de una estrategia desplegada sin cumplir el criterio del laboratorio (texto, no solo color). */
const insigniaExperimental = () => h('span', { class: 'insignia insignia-experimental' }, 'experimental')

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBacktest(ctx) {
  const version = paramOpcion(ctx.ruta.params, 'v', [...VERSIONES, LABORATORIO], ESTRATEGIA_PRINCIPAL)
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Estrategia' }, [...VERSIONES, LABORATORIO].map((v) => h('a', {
    href: hashDe('backtest', { params: { v } }), class: 'pestana', 'aria-current': v === version ? 'page' : null,
  }, v === LABORATORIO ? 'Laboratorio' : textoPestana(v))))
  if (version === LABORATORIO) return vistaLaboratorio(ctx, pestanas)
  const cargados = await Promise.all(VERSIONES.map((v) => intentar(cargarBacktest(ctx.fetch, v))))
  const porVersion = Object.fromEntries(VERSIONES.map((v, i) => [v, cargados[i]]))
  const elegido = porVersion[version]
  const nota = notaBacktest(cargados.flatMap((c) => (c.ok ? [c.valor] : [])))
  if (!elegido.ok) {
    const nodo = h('div', { class: 'vista' }, cabecera('Backtest', pestanas),
      aviso(`No se pudo cargar el backtest de ${version}: ${elegido.error instanceof Error ? elegido.error.message : String(elegido.error)}`, 'error'))
    return { titulo: 'Backtest', nodo }
  }
  const l = lecturaBacktest(elegido.valor)
  // Las estrategias del laboratorio (v3…) son de una familia y solo usan análisis técnico: ni pesos ni Fear & Greed.
  const familia = elegido.valor?.parametros?.estrategia?.familia
  const variante = typeof familia === 'string' ? `solo técnico · ${Object.hasOwn(NOMBRES_FAMILIA, familia) ? NOMBRES_FAMILIA[familia] : familia}` : l.variante
  const curva = curvaComparada(l.curva)
  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': `Curva de capital del backtest de ${l.version} frente a comprar y mantener` })
  const nodo = h('div', { class: 'vista vista-backtest' },
    cabecera('Backtest', pestanas,
      h('p', { class: 'etiqueta-variante' }, `Estrategia ${l.version} · ${variante}`),
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
    // Las del laboratorio llevan su propio texto (velas diarias); el resto, el aviso del JSON y la nota de los pesos.
    h('p', { class: 'ayuda' }, typeof familia === 'string'
      ? 'Simulación con datos históricos. Esta estrategia del laboratorio solo usa análisis técnico de las velas diarias: '
        + 'ni noticias, ni derivados, ni Fear & Greed. No es asesoramiento financiero ni garantía de beneficio.'
      : [l.aviso, ' El backtest no usa noticias ni derivados: no hay histórico gratuito fiable, así que sus pesos se reparten entre técnico y Fear & Greed.']))
  return { titulo: 'Backtest', nodo, montar: () => graficoCurva(lienzo, curva) }
}

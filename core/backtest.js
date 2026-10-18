// @ts-check
// Backtest hora a hora con el mismo motor que el Worker. Solo ve velas cerradas.
import { PARAMETROS_BOT, crearHodl, estadoInicial, pasoMoneda, valorCartera, valorHodl } from './bot.js'
import { PARAMETROS, VERSION, calcularSenal } from './estrategia-v1.js'
import { calcularMetricas, metricasPorMoneda } from './metricas.js'
import { HORA } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} SerieMoneda */

const MINUTO_CRON = 3 * 60_000
const DIA = 24 * HORA

/**
 * @param {{ series: Record<string, SerieMoneda>, fng: { t: number, valor: number }[],
 *   desde: number, hasta: number, capitalInicial?: number, ventana?: number }} entrada
 *   desde/hasta en ms; se evalúa cada hora en punto + 3 min, como el cron.
 */
export function ejecutarBacktest({ series, fng, desde, hasta, capitalInicial = 10_000, ventana = 500 }) {
  const monedas = Object.keys(series)
  /** @type {Record<string, Record<keyof SerieMoneda, number>>} */
  const punteros = Object.fromEntries(monedas.map((m) => [m, { '1h': 0, '4h': 0, '1d': 0, eur: 0 }]))
  let punteroFng = 0
  let estado = estadoInicial(capitalInicial)
  /** @type {Record<string, number>|null} */
  let hodl = null
  /** @type {{ t: number, valor: number, hodl: number|null }[]} */
  const curva = []
  /** @type {Omit<import('./bot.js').Evento, 'posicion'>[]} */
  const operaciones = []
  /** @type {Record<string, number>} */
  const decisiones = {}

  for (let h = Math.ceil(desde / HORA) * HORA; h + MINUTO_CRON <= hasta; h += HORA) {
    const ahora = h + MINUTO_CRON
    /** @type {Record<string, number>} */
    const precios = {}
    for (const m of monedas) {
      const p = punteros[m]
      for (const tf of /** @type {(keyof SerieMoneda)[]} */ (['1h', '4h', '1d', 'eur'])) {
        const velas = series[m][tf]
        while (p[tf] < velas.length && velas[p[tf]].fin <= ahora) p[tf]++
      }
      if (p.eur > 0) precios[m] = series[m].eur[p.eur - 1].cierre
    }
    while (punteroFng < fng.length && fng[punteroFng].t <= ahora) punteroFng++
    const valorFng = punteroFng > 0 ? fng[punteroFng - 1].valor : null

    if (hodl === null && Object.keys(precios).length === monedas.length) hodl = crearHodl(capitalInicial, precios)

    const valor = valorCartera(estado, precios)
    for (const m of monedas) {
      const p = punteros[m]
      /** @param {keyof SerieMoneda} tf @param {number} n */
      const ultimas = (tf, n) => series[m][tf].slice(Math.max(0, p[tf] - n), p[tf])
      const senal = calcularSenal({
        simbolo: m,
        ahora,
        velas: { '1h': ultimas('1h', ventana), '4h': ultimas('4h', ventana), '1d': ultimas('1d', ventana) },
        derivados: null,
        titulares: [],
        fng: valorFng,
      })
      const paso = pasoMoneda(estado, { simbolo: m, velasEur: ultimas('eur', 24), senal, ahora, valorCartera: valor })
      estado = paso.estado
      for (const { posicion: _, ...ev } of paso.eventos) operaciones.push(ev)
      const clave = `${paso.decision.veredicto}:${paso.decision.motivo}`
      decisiones[clave] = (decisiones[clave] ?? 0) + 1
    }
    curva.push({ t: ahora, valor: valorCartera(estado, precios), hodl: hodl ? valorHodl(hodl, precios) : null })
  }

  const preciosFinales = Object.fromEntries(monedas.map((m) => {
    const p = punteros[m]
    return [m, p.eur > 0 ? series[m].eur[p.eur - 1].cierre : NaN]
  }))
  const abiertas = Object.values(estado.posiciones).map((p) => ({
    unidades: p.unidades, coste: p.coste, precioActual: preciosFinales[p.simbolo],
  }))
  const opsMetricas = operaciones.map((o) => ({
    tipo: o.tipo, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnlNeto,
  }))
  return {
    version: VERSION,
    variante: 'tecnico+fng',
    parametros: { estrategia: PARAMETROS, bot: PARAMETROS_BOT },
    desde,
    hasta,
    capitalInicial,
    monedas,
    metricas: calcularMetricas({ capitalInicial, saldo: estado.saldo, abiertas, operaciones: opsMetricas, curva }),
    porMoneda: metricasPorMoneda(opsMetricas),
    decisiones,
    curvaDiaria: curva.filter((p, i) => i === curva.length - 1 || Math.floor(p.t / DIA) !== Math.floor((curva[i + 1]?.t ?? 0) / DIA)),
    operaciones,
  }
}

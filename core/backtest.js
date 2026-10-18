// @ts-check
// Backtest hora a hora con el mismo paso horario que el Worker (core/hora.js). Solo ve velas cerradas.
import { estadoInicial } from './bot.js'
import { ejecutarHora } from './hora.js'
import { calcularMetricas, metricasPorMoneda } from './metricas.js'
import { HORA, VENTANA } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} SerieMoneda */
/** @typedef {import('./hora.js').Estrategia} Estrategia */

const MINUTO_CRON = 3 * 60_000
const DIA = 24 * HORA

/**
 * @param {{ series: Record<string, SerieMoneda>, fng: { t: number, valor: number }[],
 *   desde: number, hasta: number, capitalInicial?: number, ventana?: number, estrategia: Estrategia }} entrada
 *   desde/hasta en ms; se evalúa cada hora en punto + 3 min, como el cron.
 *   estrategia: módulo de core/estrategias.js. ventana: velas cerradas por temporalidad (VENTANA, como en vivo).
 */
export function ejecutarBacktest({ series, fng, desde, hasta, capitalInicial = 10_000, ventana = VENTANA, estrategia }) {
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
    for (const m of monedas) {
      const p = punteros[m]
      for (const tf of /** @type {(keyof SerieMoneda)[]} */ (['1h', '4h', '1d', 'eur'])) {
        const velas = series[m][tf]
        while (p[tf] < velas.length && velas[p[tf]].fin <= ahora) p[tf]++
      }
    }
    while (punteroFng < fng.length && fng[punteroFng].t <= ahora) punteroFng++
    const valorFng = punteroFng > 0 ? fng[punteroFng - 1].valor : null

    const hora = ejecutarHora({
      estado,
      hodl,
      capitalInicial,
      ahora,
      monedas: monedas.map((m) => {
        const p = punteros[m]
        /** @param {keyof SerieMoneda} tf @param {number} n */
        const ultimas = (tf, n) => series[m][tf].slice(Math.max(0, p[tf] - n), p[tf])
        return {
          simbolo: m,
          velas: { '1h': ultimas('1h', ventana), '4h': ultimas('4h', ventana), '1d': ultimas('1d', ventana) },
          velasEur: ultimas('eur', 24),
          derivados: null,
        }
      }),
      titulares: [],
      fng: valorFng,
      estrategia,
    })
    estado = hora.estado
    hodl = hora.hodl
    for (const { posicion: _, ...ev } of hora.eventos) operaciones.push(ev)
    for (const d of hora.decisiones) {
      const clave = `${d.veredicto}:${d.motivo}`
      decisiones[clave] = (decisiones[clave] ?? 0) + 1
    }
    curva.push(hora.punto)
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
    version: estrategia.VERSION,
    variante: 'tecnico+fng',
    parametros: { estrategia: estrategia.PARAMETROS, bot: estrategia.PARAMETROS_BOT, ventana },
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

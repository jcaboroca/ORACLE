// @ts-check
// Paso horario compartido por el Worker y el backtest: mismas entradas → mismas decisiones.
import { crearHodl, pasoMoneda, valorCartera, valorHodl } from './bot.js'
import { calcularSenal } from './estrategia-v1.js'
import { cerradasHasta } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {import('./bot.js').Estado} Estado */
/** @typedef {import('./bot.js').Evento} Evento */
/** @typedef {import('./bot.js').Decision} Decision */
/** @typedef {import('./estrategia-v1.js').Derivados} Derivados */
/** @typedef {import('./estrategia-v1.js').Titular} Titular */
/**
 * @typedef {{ simbolo: string, velas: { '1h': Vela[], '4h': Vela[], '1d': Vela[] },
 *   velasEur: Vela[], derivados: Derivados|null }} EntradaMoneda
 */

/**
 * Una ejecución horaria completa:
 * 1. precio de cada moneda = cierre de su última vela EUR cerrada en `ahora`;
 * 2. si aún no hay HODL y todas las monedas tienen precio, se crea con el capital inicial;
 * 3. una sola foto del valor de la cartera, antes del bucle, dimensiona todas las compras;
 * 4. señal + paso del bot por moneda, en el orden recibido;
 * 5. punto de la curva con el estado final.
 * No muta sus entradas.
 * @param {{ estado: Estado, hodl: Record<string, number>|null, capitalInicial: number, ahora: number,
 *   monedas: EntradaMoneda[], titulares: Titular[], fng: number|null }} entrada
 */
export function ejecutarHora({ estado: estadoPrevio, hodl: hodlPrevio, capitalInicial, ahora, monedas, titulares, fng }) {
  /** @type {Record<string, number>} */
  const precios = {}
  for (const m of monedas) {
    const cerradas = cerradasHasta(m.velasEur, ahora)
    if (cerradas.length > 0) precios[m.simbolo] = cerradas[cerradas.length - 1].cierre
  }
  const hodl = hodlPrevio === null && Object.keys(precios).length === monedas.length
    ? crearHodl(capitalInicial, precios)
    : hodlPrevio && { ...hodlPrevio }

  const valor = valorCartera(estadoPrevio, precios)
  let estado = estadoPrevio
  /** @type {ReturnType<typeof calcularSenal>[]} */
  const senales = []
  /** @type {Decision[]} */
  const decisiones = []
  /** @type {Evento[]} */
  const eventos = []
  for (const m of monedas) {
    const senal = calcularSenal({ simbolo: m.simbolo, ahora, velas: m.velas, derivados: m.derivados, titulares, fng })
    const paso = pasoMoneda(estado, { simbolo: m.simbolo, velasEur: m.velasEur, senal, ahora, valorCartera: valor })
    estado = paso.estado
    senales.push(senal)
    decisiones.push(paso.decision)
    eventos.push(...paso.eventos)
  }
  if (estado === estadoPrevio) estado = structuredClone(estadoPrevio)
  return {
    estado,
    hodl,
    senales,
    decisiones,
    eventos,
    punto: { t: ahora, valor: valorCartera(estado, precios), hodl: hodl ? valorHodl(hodl, precios) : null },
  }
}

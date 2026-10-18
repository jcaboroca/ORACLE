// @ts-check
// Bot de paper trading: transición pura de estado. No toca red ni base de datos;
// el Worker y el backtest persisten los eventos que devuelve.
import { HORA, cerradasHasta } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/**
 * @typedef {{ simbolo: string, velaEntrada: number, precioEntrada: number,
 *   unidades: number, coste: number, stopLoss: number, takeProfit: number }} Posicion
 * coste: euros que salieron del saldo al abrir (comisión incluida).
 */
/**
 * @typedef {{ saldo: number, posiciones: Record<string, Posicion>,
 *   ultimaRevisada: Record<string, number>, enfriamientoHasta: Record<string, number> }} Estado
 */
/**
 * @typedef {{ tipo: 'compra'|'venta', simbolo: string, vela: number, precioBase: number,
 *   precio: number, unidades: number, importe: number, comision: number,
 *   deslizamiento: number, motivo: 'senal'|'stop_loss'|'take_profit', saldoTras: number,
 *   stopLoss?: number, takeProfit?: number, pnlNeto?: number, posicion: Posicion }} Evento
 * importe: en compras, euros invertidos (comisión incluida); en ventas, bruto antes de comisión.
 */
/**
 * @typedef {{ simbolo: string, vela: number, veredicto: string, puntuacion: number|null,
 *   indiceConfianza: number|null, accion: 'abrir'|'cerrar'|'ninguna', motivo: string,
 *   precio: number|null }} Decision
 */
/**
 * @typedef {{ veredicto: string, puntuacion: number|null, indiceConfianza: number|null,
 *   atrPct: number|null, fresca: boolean, motivo: string|null }} SenalBot
 */
/**
 * @typedef {{ comision: number, deslizamiento: number, confianzaMinima: number, fraccionPosicion: number,
 *   ordenMinima: number, multStopLoss: number, multTakeProfit: number, enfriamientoHoras: number }} ParametrosBot
 */

/** Parámetros por defecto (los de la estrategia v1). Cada estrategia publica los suyos. */
export const PARAMETROS_BOT = Object.freeze({
  comision: 0.001,
  deslizamiento: 0.0005,
  confianzaMinima: 0.6,
  fraccionPosicion: 0.2,
  ordenMinima: 10,
  multStopLoss: 1.5,
  multTakeProfit: 2.5,
  enfriamientoHoras: 4,
})

/** @param {number} capital @returns {Estado} */
export function estadoInicial(capital) {
  return { saldo: capital, posiciones: {}, ultimaRevisada: {}, enfriamientoHasta: {} }
}

/**
 * Saldo + posiciones valoradas. Si falta el precio de una moneda se usa el de entrada.
 * @param {Estado} estado
 * @param {Record<string, number>} precios
 */
export function valorCartera(estado, precios) {
  let valor = estado.saldo
  for (const p of Object.values(estado.posiciones)) valor += p.unidades * (precios[p.simbolo] ?? p.precioEntrada)
  return valor
}

/** Vela 1H que debe estar cerrada en `ahora`: la de la hora anterior. @param {number} ahora */
export function velaDeDecision(ahora) {
  return Math.floor(ahora / HORA) * HORA - HORA
}

/**
 * @param {Estado} estado (se modifica)
 * @param {Posicion} pos
 * @param {Vela} v
 * @param {number} base precio de salida antes de deslizamiento
 * @param {'senal'|'stop_loss'|'take_profit'} motivo
 * @param {ParametrosBot} p
 * @returns {Evento}
 */
function cerrar(estado, pos, v, base, motivo, p) {
  const precio = base * (1 - p.deslizamiento)
  const importe = pos.unidades * precio
  const comision = importe * p.comision
  estado.saldo += importe - comision
  delete estado.posiciones[pos.simbolo]
  if (motivo === 'stop_loss') estado.enfriamientoHasta[pos.simbolo] = v.inicio + p.enfriamientoHoras * HORA
  return {
    tipo: 'venta', simbolo: pos.simbolo, vela: v.inicio, precioBase: base, precio, unidades: pos.unidades,
    importe, comision, deslizamiento: pos.unidades * (base - precio), motivo, saldoTras: estado.saldo,
    pnlNeto: importe - comision - pos.coste, posicion: pos,
  }
}

/**
 * Stop y objetivo dentro de una vela. Si toca ambos, gana el stop (escenario conservador).
 * @param {Posicion} pos
 * @param {Vela} v
 * @returns {{ base: number, motivo: 'stop_loss'|'take_profit' }|null}
 */
export function salidaEnVela(pos, v) {
  if (v.apertura <= pos.stopLoss) return { base: v.apertura, motivo: 'stop_loss' }
  if (v.minimo <= pos.stopLoss) return { base: pos.stopLoss, motivo: 'stop_loss' }
  if (v.apertura >= pos.takeProfit) return { base: v.apertura, motivo: 'take_profit' }
  if (v.maximo >= pos.takeProfit) return { base: pos.takeProfit, motivo: 'take_profit' }
  return null
}

/**
 * Procesa una moneda en una ejecución horaria: primero stops, luego la señal.
 * @param {Estado} estadoPrevio
 * @param {{ simbolo: string, velasEur: Vela[], senal: SenalBot, ahora: number, valorCartera: number }} entrada
 *   velasEur: velas 1H EUR ordenadas; se descarta la que siga abierta en `ahora`.
 * @param {ParametrosBot} [parametros] los de la estrategia en uso
 * @returns {{ estado: Estado, eventos: Evento[], decision: Decision }}
 */
export function pasoMoneda(estadoPrevio, { simbolo, velasEur: todasEur, senal, ahora, valorCartera: valor }, parametros = PARAMETROS_BOT) {
  const p = parametros
  // La vela en curso no cuenta: si se revisara ahora, su cierre posterior nunca se comprobaría.
  const velasEur = cerradasHasta(todasEur, ahora)
  /** @type {Estado} */
  const estado = structuredClone(estadoPrevio)
  /** @type {Evento[]} */
  const eventos = []
  const vela = velaDeDecision(ahora)
  const revisada = estado.ultimaRevisada[simbolo] ?? -Infinity
  const nuevas = velasEur.filter((v) => v.inicio > revisada)

  let cerradaPorStop = false
  const abierta = estado.posiciones[simbolo]
  if (abierta) {
    for (const v of nuevas) {
      if (v.inicio <= abierta.velaEntrada) continue
      const salida = salidaEnVela(abierta, v)
      if (salida) {
        eventos.push(cerrar(estado, abierta, v, salida.base, salida.motivo, p))
        cerradaPorStop = true
        break
      }
    }
  }
  if (nuevas.length > 0) estado.ultimaRevisada[simbolo] = nuevas[nuevas.length - 1].inicio

  const ultima = velasEur[velasEur.length - 1]
  const fresca = senal.fresca && ultima !== undefined && ultima.inicio === vela
  const precio = fresca ? ultima.cierre : null
  /** @param {'abrir'|'cerrar'|'ninguna'} accion @param {string} motivo @returns {Decision} */
  const decidir = (accion, motivo) => ({
    simbolo, vela, veredicto: senal.veredicto, puntuacion: senal.puntuacion,
    indiceConfianza: senal.indiceConfianza, accion, motivo, precio,
  })

  if (senal.veredicto === 'SIN_DATOS') return { estado, eventos, decision: decidir('ninguna', 'sin_datos') }
  if (!fresca) return { estado, eventos, decision: decidir('ninguna', 'datos_desactualizados') }
  const posicion = estado.posiciones[simbolo]

  if (senal.veredicto === 'VENDER') {
    if (!posicion) return { estado, eventos, decision: decidir('ninguna', cerradaPorStop ? 'cerrada_por_stop' : 'sin_posicion') }
    eventos.push(cerrar(estado, posicion, ultima, ultima.cierre, 'senal', p))
    return { estado, eventos, decision: decidir('cerrar', 'cerrada') }
  }
  if (senal.veredicto !== 'COMPRAR') {
    return { estado, eventos, decision: decidir('ninguna', senal.motivo ?? 'mantener') }
  }
  if (posicion) return { estado, eventos, decision: decidir('ninguna', 'ya_en_posicion') }
  if (cerradaPorStop) return { estado, eventos, decision: decidir('ninguna', 'cerrada_por_stop') }
  if (vela < (estado.enfriamientoHasta[simbolo] ?? -Infinity)) return { estado, eventos, decision: decidir('ninguna', 'enfriamiento') }
  if ((senal.indiceConfianza ?? 0) < p.confianzaMinima) return { estado, eventos, decision: decidir('ninguna', 'confianza_baja') }
  const importe = Math.min(p.fraccionPosicion * valor, estado.saldo)
  if (importe < p.ordenMinima) return { estado, eventos, decision: decidir('ninguna', 'saldo_insuficiente') }

  const atrPct = /** @type {number} */ (senal.atrPct)
  const precioEntrada = ultima.cierre * (1 + p.deslizamiento)
  const comision = importe * p.comision
  const unidades = (importe - comision) / precioEntrada
  /** @type {Posicion} */
  const nueva = {
    simbolo, velaEntrada: ultima.inicio, precioEntrada, unidades, coste: importe,
    stopLoss: precioEntrada * (1 - p.multStopLoss * atrPct),
    takeProfit: precioEntrada * (1 + p.multTakeProfit * atrPct),
  }
  estado.saldo -= importe
  estado.posiciones[simbolo] = nueva
  eventos.push({
    tipo: 'compra', simbolo, vela: ultima.inicio, precioBase: ultima.cierre, precio: precioEntrada, unidades,
    importe, comision, deslizamiento: unidades * (precioEntrada - ultima.cierre), motivo: 'senal',
    saldoTras: estado.saldo, stopLoss: nueva.stopLoss, takeProfit: nueva.takeProfit, posicion: nueva,
  })
  return { estado, eventos, decision: decidir('abrir', 'abierta') }
}

/**
 * Comprar y mantener: capital a partes iguales entre las monedas, con costes.
 * @param {number} capital
 * @param {Record<string, number>} precios
 * @param {ParametrosBot} [parametros] solo se usan comision y deslizamiento
 * @returns {Record<string, number>} unidades por moneda
 */
export function crearHodl(capital, precios, parametros = PARAMETROS_BOT) {
  const p = parametros
  const monedas = Object.keys(precios)
  /** @type {Record<string, number>} */
  const unidades = {}
  for (const m of monedas) {
    const importe = capital / monedas.length
    unidades[m] = (importe * (1 - p.comision)) / (precios[m] * (1 + p.deslizamiento))
  }
  return unidades
}

/** @param {Record<string, number>} unidades @param {Record<string, number>} precios */
export function valorHodl(unidades, precios) {
  return Object.entries(unidades).reduce((s, [m, u]) => s + u * precios[m], 0)
}

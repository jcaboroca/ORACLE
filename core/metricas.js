// @ts-check
// Métricas de evaluación de una simulación (en vivo o backtest).

const SEMANA = 7 * 24 * 3_600_000

/**
 * Mayor caída relativa desde un máximo previo (0,25 = −25 %).
 * @param {number[]} valores
 */
export function drawdownMaximo(valores) {
  let maximo = -Infinity
  let peor = 0
  for (const v of valores) {
    if (v > maximo) maximo = v
    if (maximo > 0) peor = Math.max(peor, (maximo - v) / maximo)
  }
  return peor
}

/**
 * @typedef {{ tipo: 'compra'|'venta', simbolo: string, comision: number,
 *   deslizamiento: number, pnlNeto?: number }} OperacionMetrica
 * pnlNeto: obligatorio y finito en las ventas (importe − comisión − coste de la posición).
 */

/**
 * @param {OperacionMetrica[]} operaciones
 */
function resumenOperaciones(operaciones) {
  const ventas = operaciones.filter((o) => o.tipo === 'venta')
  const pnl = ventas.map((o) => {
    if (!Number.isFinite(o.pnlNeto)) throw new TypeError('venta sin pnlNeto finito: ' + o.simbolo)
    return /** @type {number} */ (o.pnlNeto)
  })
  const beneficioRealizado = pnl.reduce((s, x) => s + x, 0)
  return {
    operaciones: operaciones.length,
    cerradas: ventas.length,
    ganadoras: pnl.filter((x) => x > 0).length,
    perdedoras: pnl.filter((x) => x <= 0).length,
    beneficioRealizado,
    beneficioMedio: ventas.length ? beneficioRealizado / ventas.length : null,
    comisiones: operaciones.reduce((s, o) => s + o.comision, 0),
    deslizamiento: operaciones.reduce((s, o) => s + o.deslizamiento, 0),
  }
}

/**
 * @typedef {{ ultimoHodl: number|null, drawdownMaximo: number, drawdownMaximoHodl: number|null, duracion: number }} ResumenCurva
 * Lo único que las métricas necesitan de la curva de capital. El Worker lo guarda acumulado en cada punto
 * de `capital` (mismas operaciones, mismo orden: mismo resultado bit a bit) para no leer toda la curva.
 */

/**
 * @param {{ t: number, valor: number, hodl: number|null }[]} curva ordenada por t
 * @returns {ResumenCurva}
 */
export function resumirCurva(curva) {
  const hodls = curva.map((p) => p.hodl).filter((h) => h !== null)
  return {
    ultimoHodl: hodls.length ? /** @type {number} */ (hodls[hodls.length - 1]) : null,
    drawdownMaximo: drawdownMaximo(curva.map((p) => p.valor)),
    drawdownMaximoHodl: hodls.length ? drawdownMaximo(/** @type {number[]} */ (hodls)) : null,
    duracion: curva.length > 1 ? curva[curva.length - 1].t - curva[0].t : 0,
  }
}

/**
 * @param {{ capitalInicial: number, saldo: number,
 *   abiertas: { unidades: number, coste: number, precioActual: number }[],
 *   operaciones: OperacionMetrica[],
 *   curva?: { t: number, valor: number, hodl: number|null }[], resumenCurva?: ResumenCurva }} datos
 *   curva completa o, en su lugar, su resumen ya calculado (resumirCurva).
 */
export function calcularMetricas({ capitalInicial, saldo, abiertas, operaciones, curva = [], resumenCurva = resumirCurva(curva) }) {
  const valorAbiertas = abiertas.reduce((s, p) => s + p.unidades * p.precioActual, 0)
  const valorCartera = saldo + valorAbiertas
  const { ultimoHodl, duracion } = resumenCurva
  const resumen = resumenOperaciones(operaciones)
  return {
    valorCartera,
    saldo,
    ...resumen,
    beneficioNoRealizado: abiertas.reduce((s, p) => s + p.unidades * p.precioActual - p.coste, 0),
    rentabilidad: valorCartera / capitalInicial - 1,
    rentabilidadHodl: ultimoHodl === null ? null : ultimoHodl / capitalInicial - 1,
    drawdownMaximo: resumenCurva.drawdownMaximo,
    drawdownMaximoHodl: resumenCurva.drawdownMaximoHodl,
    operacionesPorSemana: duracion > 0 ? operaciones.length / (duracion / SEMANA) : null,
  }
}

/**
 * Resumen por moneda.
 * @param {OperacionMetrica[]} operaciones
 */
export function metricasPorMoneda(operaciones) {
  /** @type {Record<string, ReturnType<typeof resumenOperaciones>>} */
  const salida = {}
  for (const simbolo of new Set(operaciones.map((o) => o.simbolo))) {
    salida[simbolo] = resumenOperaciones(operaciones.filter((o) => o.simbolo === simbolo))
  }
  return salida
}

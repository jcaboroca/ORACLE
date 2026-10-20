// @ts-check
// Laboratorio de estrategias (spec del laboratorio §4): motor de validación por tramos, puro.
//
// Cada configuración se simula por tramos anuales independientes (capital nuevo en cada tramo) con
// exactamente la misma lógica que core/backtest.js (pasoMoneda de core/bot.js, mismas ventanas de velas
// cerradas, mismos precios y costes), pero sin recalcular lo que no cambia:
// - la señal solo importa en las horas de decisión (cadencia del bot); fuera de ellas el bot no hace
//   nada salvo revisar stops, así que se calcula una vez por hora de decisión y moneda, y se reutiliza
//   entre configuraciones que solo difieren en el bot (stops/TP);
// - las horas sin posiciones abiertas y fuera de la ventana de decisión no cambian nada (el valor de la
//   cartera es el saldo), así que se saltan.
// La paridad con ejecutarBacktest está probada en test/laboratorio.test.js.
import { PARAMETROS_BOT as BOT_V1, crearHodl, estadoInicial, pasoMoneda, valorCartera, valorHodl } from './bot.js'
import { claveSenal, familia as obtenerFamilia, todasLasConfiguraciones, vecinos } from './familias/index.js'
import { calcularMetricas, metricasPorMoneda } from './metricas.js'
import { HORA, VENTANA } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {import('./hora.js').Estrategia} Estrategia */
/** @typedef {import('./bot.js').SenalBot} SenalBot */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} SerieMoneda */
/** @typedef {ReturnType<typeof prepararDatos>} Datos */
/** @typedef {{ ano: number, desde: number, hasta: number, monedas: string[] }} Tramo */
/** @typedef {{ rentabilidad: number, drawdownMaximo: number }} Resultado */
/** @typedef {Resultado & { curva: number[] }} ResultadoConCurva */

const DIA = 24 * HORA
const MINUTO_CRON = 3 * 60_000

/** Años de prueba (anclados: el entrenamiento de cada año es todo lo anterior). */
export const ANOS_PRUEBA = Object.freeze([2020, 2021, 2022, 2023, 2024, 2025])
/** Tramo reservado: desde aquí hasta el final de los datos. Se mira una sola vez y no se usa para elegir. */
export const INICIO_RESERVADO = Date.UTC(2026, 0, 1)
/**
 * Velas 1D cerradas que una moneda necesita al empezar un tramo para entrar en él: el indicador más largo
 * de la rejilla (EMA/SMA 200 y las 200 velas mínimas de v1).
 */
export const HISTORIA_MINIMA = 200
/** Mínimo exigido por el criterio: «al menos 4 de los 6 años» y «al menos 4 de las 5 monedas». */
export const FRACCION_ANOS = 4 / 6
export const FRACCION_MONEDAS = 4 / 5
/** Caída máxima permitida frente a la de comprar y mantener. */
export const FACTOR_CAIDA = 0.6
/** Meseta: la mediana de los vecinos debe ser al menos esta fracción del cociente de la elegida. */
export const FACTOR_MESETA = 0.5

export const CRITERIO = Object.freeze([
  Object.freeze({ id: 'rentabilidad', texto: 'Rentabilidad neta encadenada fuera de muestra > 0' }),
  Object.freeze({ id: 'caida', texto: 'Caída máxima encadenada ≤ 0,6 × la de comprar y mantener en el mismo periodo' }),
  Object.freeze({ id: 'anos', texto: 'Rentabilidad > 0 en al menos 4 de los 6 años de prueba' }),
  Object.freeze({ id: 'monedas', texto: 'Beneficio realizado > 0 en al menos 4 de las 5 monedas' }),
  Object.freeze({ id: 'meseta', texto: 'Meseta: mediana del cociente rentabilidad/caída de las configuraciones vecinas ≥ 50 % del de la elegida (2020–2025)' }),
])

/** Señal que no decide nada: fuera de las horas de decisión solo se revisan stops. */
const SIN_SENAL = Object.freeze({ veredicto: 'SIN_DATOS', puntuacion: null, indiceConfianza: null, atrPct: null, fresca: false, motivo: null })

/**
 * Índices de las velas cerradas por hora, una sola vez para todo el laboratorio.
 * @param {{ series: Record<string, SerieMoneda>, fng: { t: number, valor: number }[], ventana?: number }} entrada
 *   series: USDT 1h/4h/1d por moneda y `eur`, la serie 1H con la que se ejecuta (en el laboratorio, la 1H USDT).
 */
export function prepararDatos({ series, fng, ventana = VENTANA }) {
  const monedas = Object.keys(series)
  const inicios = monedas.map((m) => series[m].eur[0]?.inicio).filter((t) => t !== undefined)
  const finales = monedas.map((m) => series[m].eur[series[m].eur.length - 1]?.fin).filter((t) => t !== undefined)
  const t0 = inicios.length ? Math.floor(Math.min(...inicios) / HORA) * HORA : 0
  const nHoras = finales.length ? Math.floor((Math.max(...finales) - t0) / HORA) + 2 : 1
  /** @type {Record<string, Int32Array>} nº de velas de ejecución cerradas a las hh:03 de cada hora */
  const cerradas = {}
  for (const m of monedas) {
    const velas = series[m].eur
    const n = new Int32Array(nHoras)
    let k = 0
    for (let i = 0; i < nHoras; i++) {
      const ahora = t0 + i * HORA + MINUTO_CRON
      while (k < velas.length && velas[k].fin <= ahora) k++
      n[i] = k
    }
    cerradas[m] = n
  }
  return { series, fng, ventana, monedas, t0, nHoras, cerradas }
}

/**
 * Nº de velas de ejecución de `m` cerradas en la hora `h` (a las hh:03).
 * @param {Datos} datos @param {string} m @param {number} h
 */
function cerradasEn(datos, m, h) {
  const i = (h - datos.t0) / HORA
  if (i < 0) return 0
  return datos.cerradas[m][Math.min(i, datos.nHoras - 1)]
}

/**
 * Señal de cada moneda en cada hora de decisión de [desde, hasta), con las mismas ventanas que el backtest.
 * @param {Datos} datos
 * @param {Estrategia} estrategia
 * @param {number} desde
 * @param {number} hasta
 */
export function precalcularSenales(datos, estrategia, desde, hasta) {
  const cadencia = (estrategia.PARAMETROS_BOT.cadenciaHoras ?? 1) * HORA
  const primera = Math.ceil(desde / cadencia) * cadencia
  const { series, fng, ventana } = datos
  /** @type {Record<string, SenalBot[]>} */
  const senales = {}
  for (const m of datos.monedas) {
    /** @type {SenalBot[]} */
    const lista = []
    const p = { '1h': 0, '4h': 0, '1d': 0 }
    let pf = 0
    for (let h = primera; h + MINUTO_CRON <= hasta; h += cadencia) {
      const ahora = h + MINUTO_CRON
      for (const tf of /** @type {('1h'|'4h'|'1d')[]} */ (['1h', '4h', '1d'])) {
        const velas = series[m][tf]
        while (p[tf] < velas.length && velas[p[tf]].fin <= ahora) p[tf]++
      }
      while (pf < fng.length && fng[pf].t <= ahora) pf++
      /** @param {'1h'|'4h'|'1d'} tf */
      const ultimas = (tf) => series[m][tf].slice(Math.max(0, p[tf] - ventana), p[tf])
      const s = estrategia.calcularSenal({
        simbolo: m, ahora, velas: { '1h': ultimas('1h'), '4h': ultimas('4h'), '1d': ultimas('1d') },
        derivados: null, titulares: [], fng: pf > 0 ? fng[pf - 1].valor : null,
      })
      lista.push({ veredicto: s.veredicto, puntuacion: s.puntuacion, indiceConfianza: s.indiceConfianza, atrPct: s.atrPct, fresca: s.fresca, motivo: s.motivo })
    }
    senales[m] = lista
  }
  return { cadencia, primera, senales }
}

/**
 * Simula una estrategia en [desde, hasta) con capital nuevo: mismo resultado que ejecutarBacktest con las
 * mismas monedas (sin la parte de comprar y mantener, que da simularHodl).
 * @param {Datos} datos
 * @param {{ estrategia: Estrategia, senales: ReturnType<typeof precalcularSenales>, monedas: string[],
 *   desde: number, hasta: number, capitalInicial?: number }} entrada
 */
export function simular(datos, { estrategia, senales, monedas, desde, hasta, capitalInicial = 10_000 }) {
  const p = estrategia.PARAMETROS_BOT
  const cadencia = (p.cadenciaHoras ?? 1) * HORA
  if (cadencia !== senales.cadencia) throw new RangeError('las señales precalculadas son de otra cadencia')
  const eur = Object.fromEntries(monedas.map((m) => [m, datos.series[m].eur]))
  let estado = estadoInicial(capitalInicial)
  /** @type {Omit<import('./bot.js').Evento, 'posicion'>[]} */
  const operaciones = []
  /** @type {number[]} valores de la curva horaria; se omiten las horas sin cambios (mismo valor que la anterior) */
  const curva = []
  let maximo = -Infinity
  let peor = 0
  let abiertas = 0
  const primera = Math.ceil(desde / HORA) * HORA
  let ultima = primera
  for (let h = primera; h + MINUTO_CRON <= hasta; h += HORA) {
    ultima = h
    const decide = h % cadencia === 0
    if (!decide && abiertas === 0 && h !== primera) continue
    const ahora = h + MINUTO_CRON
    /** @type {Record<string, number>} */
    const precios = {}
    for (const m of monedas) {
      const n = cerradasEn(datos, m, h)
      if (n > 0) precios[m] = eur[m][n - 1].cierre
    }
    const valor = valorCartera(estado, precios)
    const orden = decide ? (h - senales.primera) / cadencia : -1
    for (const m of monedas) {
      if (!decide && !estado.posiciones[m]) continue
      const n = cerradasEn(datos, m, h)
      const previas = cerradasEn(datos, m, h - HORA)
      // Lo que el backtest hora a hora habría dejado en ultimaRevisada al terminar la hora anterior.
      if (h !== primera && previas > 0) estado.ultimaRevisada[m] = eur[m][previas - 1].inicio
      let senal = SIN_SENAL
      if (decide) {
        senal = senales.senales[m]?.[orden]
        if (!senal) throw new RangeError(`sin señal precalculada para ${m} en ${new Date(h).toISOString()}`)
      }
      const paso = pasoMoneda(estado, { simbolo: m, velasEur: eur[m].slice(Math.max(0, n - 24), n), senal, ahora, valorCartera: valor }, p)
      estado = paso.estado
      for (const { posicion: _, ...ev } of paso.eventos) operaciones.push(ev)
    }
    abiertas = Object.keys(estado.posiciones).length
    const v = valorCartera(estado, precios)
    if (v > maximo) maximo = v
    if (maximo > 0) peor = Math.max(peor, (maximo - v) / maximo)
    curva.push(v)
  }
  const preciosFinales = Object.fromEntries(monedas.map((m) => {
    const n = cerradasEn(datos, m, ultima)
    return [m, n > 0 ? eur[m][n - 1].cierre : NaN]
  }))
  const opsMetricas = operaciones.map((o) => ({
    tipo: o.tipo, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnlNeto,
  }))
  const metricas = calcularMetricas({
    capitalInicial,
    saldo: estado.saldo,
    abiertas: Object.values(estado.posiciones).map((x) => ({ unidades: x.unidades, coste: x.coste, precioActual: preciosFinales[x.simbolo] })),
    operaciones: opsMetricas,
    resumenCurva: { ultimoHodl: null, drawdownMaximo: peor, drawdownMaximoHodl: null, duracion: ultima - primera },
  })
  return { metricas, porMoneda: metricasPorMoneda(opsMetricas), operaciones, curva }
}

/**
 * Comprar y mantener como en el backtest: a partes iguales entre `monedas` en la primera hora en que todas
 * tienen precio, con comisión y deslizamiento, valorado cada hora.
 * @param {Datos} datos
 * @param {{ monedas: string[], desde: number, hasta: number, capitalInicial?: number,
 *   parametros?: import('./bot.js').ParametrosBot }} entrada
 * @returns {ResultadoConCurva}
 */
export function simularHodl(datos, { monedas, desde, hasta, capitalInicial = 10_000, parametros = BOT_V1 }) {
  /** @type {Record<string, number>|null} */
  let hodl = null
  /** @type {number[]} */
  const curva = []
  let maximo = -Infinity
  let peor = 0
  for (let h = Math.ceil(desde / HORA) * HORA; h + MINUTO_CRON <= hasta; h += HORA) {
    /** @type {Record<string, number>} */
    const precios = {}
    for (const m of monedas) {
      const n = cerradasEn(datos, m, h)
      if (n > 0) precios[m] = datos.series[m].eur[n - 1].cierre
    }
    if (hodl === null && Object.keys(precios).length === monedas.length) hodl = crearHodl(capitalInicial, precios, parametros)
    if (hodl === null) continue
    const v = valorHodl(hodl, precios)
    if (v > maximo) maximo = v
    if (maximo > 0) peor = Math.max(peor, (maximo - v) / maximo)
    curva.push(v)
  }
  return { rentabilidad: curva.length ? curva[curva.length - 1] / capitalInicial - 1 : 0, drawdownMaximo: peor, curva }
}

/**
 * Encadena tramos con capital compuesto: rentabilidad Π(1 + r) − 1 y caída máxima sobre la curva unida
 * (cada tramo escalado al capital con que empieza).
 * @param {ResultadoConCurva[]} tramos
 * @param {number} [capitalInicial] capital de cada tramo suelto (sus curvas están en esa escala)
 * @returns {Resultado}
 */
export function encadenar(tramos, capitalInicial = 10_000) {
  let factor = 1
  let maximo = -Infinity
  let peor = 0
  for (const t of tramos) {
    const escala = factor / capitalInicial
    for (const valor of t.curva) {
      const v = valor * escala
      if (v > maximo) maximo = v
      if (maximo > 0) peor = Math.max(peor, (maximo - v) / maximo)
    }
    factor *= 1 + t.rentabilidad
  }
  return { rentabilidad: factor - 1, drawdownMaximo: peor }
}

/**
 * Rentabilidad / caída máxima. Sin caída: +∞ si gana, 0 si no se movió, −∞ si pierde.
 * @param {Resultado} r
 */
export function cociente({ rentabilidad, drawdownMaximo }) {
  if (drawdownMaximo > 0) return rentabilidad / drawdownMaximo
  return rentabilidad > 0 ? Infinity : rentabilidad < 0 ? -Infinity : 0
}

/**
 * Regla de selección en el entrenamiento: mayor rentabilidad/caída entre las de rentabilidad > 0; si no hay
 * ninguna, la de mayor rentabilidad. Empate: la primera de la rejilla.
 * @param {Resultado[]} candidatos
 * @returns {number} índice de la elegida
 */
export function elegir(candidatos) {
  if (candidatos.length === 0) throw new RangeError('sin candidatos')
  const positivos = candidatos.map((c, i) => i).filter((i) => candidatos[i].rentabilidad > 0)
  let mejor = -1
  if (positivos.length) {
    for (const i of positivos) if (mejor < 0 || cociente(candidatos[i]) > cociente(candidatos[mejor])) mejor = i
  } else {
    for (let i = 0; i < candidatos.length; i++) if (mejor < 0 || candidatos[i].rentabilidad > candidatos[mejor].rentabilidad) mejor = i
  }
  return mejor
}

/** @param {number[]} xs */
export function mediana(xs) {
  if (xs.length === 0) return null
  const o = [...xs].sort((a, b) => a - b)
  const k = Math.floor(o.length / 2)
  return o.length % 2 ? o[k] : (o[k - 1] + o[k]) / 2
}

/**
 * Punto 5 del criterio. Sin cociente positivo de la elegida no hay meseta que valga.
 * @param {number} elegida cociente de la configuración elegida
 * @param {number[]} deVecinos cocientes de sus vecinas a un paso
 */
export function meseta(elegida, deVecinos) {
  const m = mediana(deVecinos)
  return { cociente: elegida, mediana: m, cumple: elegida > 0 && m !== null && m >= FACTOR_MESETA * elegida }
}

/**
 * Criterio de «estrategia ganadora» (spec §4), punto por punto.
 * @param {{ oos: Resultado, hodl: Resultado, porAno: number[], porMoneda: Record<string, number>,
 *   meseta: { cumple: boolean } }} r porAno: rentabilidad de cada año de prueba; porMoneda: beneficio realizado
 */
export function evaluarCriterio({ oos, hodl, porAno, porMoneda, meseta: m }) {
  const monedas = Object.values(porMoneda)
  const cumplen = {
    rentabilidad: oos.rentabilidad > 0,
    caida: oos.drawdownMaximo <= FACTOR_CAIDA * hodl.drawdownMaximo,
    anos: porAno.filter((r) => r > 0).length >= Math.ceil(FRACCION_ANOS * porAno.length - 1e-9),
    monedas: monedas.filter((b) => b > 0).length >= Math.ceil(FRACCION_MONEDAS * monedas.length - 1e-9),
    meseta: m.cumple,
  }
  const puntos = CRITERIO.map((c) => ({ ...c, cumple: cumplen[/** @type {keyof typeof cumplen} */ (c.id)] }))
  return { puntos, cumple: puntos.every((p) => p.cumple) }
}

/**
 * Tramos anuales del laboratorio. Una moneda entra en un tramo si al empezarlo ya tiene HISTORIA_MINIMA
 * velas 1D cerradas. El primer tramo empieza cuando la primera moneda la alcanza; el reservado va de
 * `inicioReservado` al final de los datos (la última vela 1H común a todas las monedas).
 * @param {Datos} datos
 * @param {{ inicioReservado?: number, historiaMinima?: number }} [op]
 */
export function tramosDelLaboratorio(datos, { inicioReservado = INICIO_RESERVADO, historiaMinima = HISTORIA_MINIMA } = {}) {
  /** @type {Record<string, number>} instante en que la moneda tiene historia suficiente */
  const lista = {}
  for (const m of datos.monedas) lista[m] = datos.series[m]['1d'][historiaMinima - 1]?.fin ?? Infinity
  const inicio = Math.min(...Object.values(lista))
  if (!Number.isFinite(inicio)) throw new RangeError('ninguna moneda tiene historia suficiente')
  /** @param {number} desde */
  const disponibles = (desde) => datos.monedas.filter((m) => lista[m] <= desde)
  /** @type {Tramo[]} */
  const tramos = []
  for (let ano = new Date(inicio).getUTCFullYear(); Date.UTC(ano + 1, 0, 1) <= inicioReservado; ano++) {
    const desde = Math.max(Date.UTC(ano, 0, 1), Math.ceil(inicio / DIA) * DIA)
    tramos.push({ ano, desde, hasta: Date.UTC(ano + 1, 0, 1), monedas: disponibles(desde) })
  }
  const finDatos = Math.min(...datos.monedas.map((m) => datos.series[m].eur[datos.series[m].eur.length - 1]?.fin ?? -Infinity))
  /** @type {Tramo} */
  const reservado = { ano: new Date(inicioReservado).getUTCFullYear(), desde: inicioReservado, hasta: Math.floor(finDatos / HORA) * HORA, monedas: disponibles(inicioReservado) }
  return { tramos, reservado }
}

/** @param {number} x */
const finito = (x) => (Number.isFinite(x) ? x : null)
/** @param {ReturnType<typeof simular>} r */
const resumen = (r) => ({ rentabilidad: r.metricas.rentabilidad, drawdownMaximo: r.metricas.drawdownMaximo, operaciones: r.metricas.operaciones })

/**
 * El laboratorio completo (spec §4): todas las configuraciones en todos los tramos, validación anclada por
 * años de prueba, criterio, ranking, selección y, al final y una sola vez, el tramo reservado.
 * @param {{ series: Record<string, { '1h': Vela[], '4h': Vela[], '1d': Vela[] }>, fng: { t: number, valor: number }[],
 *   configs?: { familia: string, config: Record<string, unknown> }[], anosPrueba?: readonly number[],
 *   inicioReservado?: number, historiaMinima?: number, capitalInicial?: number, ventana?: number,
 *   alProgresar?: (mensaje: string) => void }} entrada
 *   series: velas USDT; la señal y la ejecución usan las mismas (la ejecución, la 1H).
 */
export function evaluarLaboratorio({
  series, fng, configs = todasLasConfiguraciones(), anosPrueba = ANOS_PRUEBA, inicioReservado = INICIO_RESERVADO,
  historiaMinima = HISTORIA_MINIMA, capitalInicial = 10_000, ventana = VENTANA, alProgresar = () => {},
}) {
  const datos = prepararDatos({
    series: Object.fromEntries(Object.entries(series).map(([m, s]) => [m, { ...s, eur: s['1h'] }])), fng, ventana,
  })
  const { tramos, reservado } = tramosDelLaboratorio(datos, { inicioReservado, historiaMinima })
  const indice = Object.fromEntries(tramos.map((t, i) => [t.ano, i]))
  for (const ano of anosPrueba) if (!(ano in indice)) throw new RangeError(`no hay tramo para el año de prueba ${ano}`)
  const hodl = tramos.map((t) => simularHodl(datos, { ...t, capitalInicial }))

  /** @type {Map<string, ReturnType<typeof precalcularSenales>>} */
  const cacheSenales = new Map()
  /** @param {string} nombre @param {Record<string, unknown>} config @param {string} version */
  const preparar = (nombre, config, version) => {
    const estrategia = obtenerFamilia(nombre).crear(config, version)
    const clave = claveSenal(nombre, config)
    let senales = cacheSenales.get(clave)
    if (!senales) {
      senales = precalcularSenales(datos, estrategia, tramos[0].desde, Math.max(reservado.hasta, tramos[tramos.length - 1].hasta))
      cacheSenales.set(clave, senales)
    }
    return { estrategia, senales }
  }

  const evaluadas = configs.map(({ familia: nombre, config }, i) => {
    const { estrategia, senales } = preparar(nombre, config, 'lab')
    const porTramo = tramos.map((t) => {
      const r = simular(datos, { estrategia, senales, monedas: t.monedas, desde: t.desde, hasta: t.hasta, capitalInicial })
      return { ...resumen(r), curva: r.curva, beneficioPorMoneda: Object.fromEntries(Object.entries(r.porMoneda).map(([m, x]) => [m, x.beneficioRealizado])) }
    })
    alProgresar(`${i + 1}/${configs.length} ${nombre} ${JSON.stringify(config)}`)
    return { familia: nombre, config, porTramo }
  })

  const iPrueba = anosPrueba.map((ano) => indice[ano])
  const hodlOos = encadenar(iPrueba.map((i) => hodl[i]), capitalInicial)
  const nombres = [...new Set(configs.map((c) => c.familia))]
  const familias = nombres.map((nombre) => {
    const filas = evaluadas.filter((e) => e.familia === nombre)
    /** @param {number[]} indices */
    const cadena = (indices) => filas.map((f) => encadenar(indices.map((i) => f.porTramo[i]), capitalInicial))
    const pliegues = anosPrueba.map((ano) => {
      const entrenamiento = cadena(tramos.map((t, i) => i).filter((i) => tramos[i].ano < ano))
      const k = elegir(entrenamiento)
      const prueba = filas[k].porTramo[indice[ano]]
      return { ano, k, config: filas[k].config, entrenamiento: entrenamiento[k], prueba, hodl: hodl[indice[ano]] }
    })
    const oos = encadenar(pliegues.map((p) => p.prueba), capitalInicial)
    /** @type {Record<string, number>} */
    const porMoneda = Object.fromEntries(datos.monedas.map((m) => [m, 0]))
    let factor = 1
    for (const p of pliegues) {
      for (const [m, b] of Object.entries(p.prueba.beneficioPorMoneda)) porMoneda[m] += b * factor
      factor *= 1 + p.prueba.rentabilidad
    }
    const final = elegir(cadena(tramos.map((t, i) => i)))
    const fueraDeMuestra = cadena(iPrueba)
    const configFinal = filas[final].config
    const deVecinos = vecinos(nombre, configFinal).map((v) => {
      const j = filas.findIndex((f) => JSON.stringify(f.config) === JSON.stringify(v))
      return j < 0 ? null : { config: v, cociente: cociente(fueraDeMuestra[j]) }
    }).filter((v) => v !== null)
    const mes = meseta(cociente(fueraDeMuestra[final]), deVecinos.map((v) => /** @type {{ cociente: number }} */ (v).cociente))
    const criterio = evaluarCriterio({ oos, hodl: hodlOos, porAno: pliegues.map((p) => p.prueba.rentabilidad), porMoneda, meseta: mes })
    return {
      familia: nombre,
      configFinal,
      oos: {
        rentabilidad: oos.rentabilidad,
        drawdownMaximo: oos.drawdownMaximo,
        cociente: finito(cociente(oos)),
        rentabilidadHodl: hodlOos.rentabilidad,
        drawdownMaximoHodl: hodlOos.drawdownMaximo,
        operaciones: pliegues.reduce((s, p) => s + p.prueba.operaciones, 0),
        porAno: pliegues.map((p) => ({ ano: p.ano, rentabilidad: p.prueba.rentabilidad, hodl: p.hodl.rentabilidad, drawdownMaximo: p.prueba.drawdownMaximo, drawdownMaximoHodl: p.hodl.drawdownMaximo })),
        porMoneda,
      },
      pliegues: pliegues.map((p) => ({
        ano: p.ano,
        config: p.config,
        entrenamiento: { rentabilidad: p.entrenamiento.rentabilidad, drawdownMaximo: p.entrenamiento.drawdownMaximo },
        prueba: { rentabilidad: p.prueba.rentabilidad, drawdownMaximo: p.prueba.drawdownMaximo, operaciones: p.prueba.operaciones },
      })),
      meseta: { ...mes, cociente: finito(mes.cociente), vecinos: deVecinos.map((v) => ({ ...v, cociente: finito(/** @type {{ cociente: number }} */ (v).cociente) })) },
      criterio,
      configuraciones: filas.map((f, j) => ({
        config: f.config,
        porAno: tramos.map((t, i) => ({ ano: t.ano, ...resumenSinCurva(f.porTramo[i]) })),
        oos: { rentabilidad: fueraDeMuestra[j].rentabilidad, drawdownMaximo: fueraDeMuestra[j].drawdownMaximo, cociente: finito(cociente(fueraDeMuestra[j])) },
      })),
    }
  })

  const ordenadas = [...familias].sort((a, b) => (b.oos.cociente ?? -Infinity) - (a.oos.cociente ?? -Infinity)
    || cocienteOrden(b) - cocienteOrden(a))
  const ganadoras = ordenadas.filter((f) => f.criterio.cumple)
  const elegidas = ganadoras.length > 0 ? ganadoras.slice(0, 3) : ordenadas.slice(0, 3)
  const seleccion = elegidas.map((f, i) => ({ version: `v${3 + i}`, familia: f.familia, config: f.configFinal, experimental: !f.criterio.cumple }))
  const ranking = ordenadas.map((f) => ({
    familia: f.familia,
    version: seleccion.find((s) => s.familia === f.familia)?.version ?? null,
    config: f.configFinal,
    oos: f.oos,
    criterio: f.criterio,
  }))

  // Tramo reservado: una sola vez, con las configuraciones ya elegidas.
  const hodlReservado = simularHodl(datos, { ...reservado, capitalInicial })
  /** @type {Record<string, { rentabilidad: number, drawdownMaximo: number, operaciones: number, rentabilidadHodl: number, drawdownMaximoHodl: number }>} */
  const porVersion = {}
  for (const s of seleccion) {
    const { estrategia, senales } = preparar(s.familia, s.config, s.version)
    const r = simular(datos, { estrategia, senales, monedas: reservado.monedas, desde: reservado.desde, hasta: reservado.hasta, capitalInicial })
    porVersion[s.version] = { ...resumen(r), rentabilidadHodl: hodlReservado.rentabilidad, drawdownMaximoHodl: hodlReservado.drawdownMaximo }
  }

  return {
    criterio: CRITERIO,
    tramos: tramos.map((t, i) => ({
      ...t, prueba: anosPrueba.includes(t.ano), hodl: { rentabilidad: hodl[i].rentabilidad, drawdownMaximo: hodl[i].drawdownMaximo },
    })),
    familias,
    ranking,
    seleccion,
    reservado: { desde: reservado.desde, hasta: reservado.hasta, monedas: reservado.monedas, porVersion },
  }
}

/** Desempate estable del ranking por rentabilidad fuera de muestra. @param {{ oos: { rentabilidad: number } }} f */
function cocienteOrden(f) {
  return f.oos.rentabilidad
}

/** @param {{ rentabilidad: number, drawdownMaximo: number, operaciones: number, beneficioPorMoneda: Record<string, number> }} t */
function resumenSinCurva({ rentabilidad, drawdownMaximo, operaciones, beneficioPorMoneda }) {
  return { rentabilidad, drawdownMaximo, operaciones, beneficioPorMoneda }
}

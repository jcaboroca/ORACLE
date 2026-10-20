// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ejecutarBacktest } from '../core/backtest.js'
import { familia } from '../core/familias/index.js'
import {
  CRITERIO, cociente, elegir, encadenar, evaluarCriterio, evaluarLaboratorio, mediana, meseta, precalcularSenales,
  prepararDatos, simular, simularHodl, tramosDelLaboratorio,
} from '../core/laboratorio.js'
import { HORA } from '../core/velas.js'

const DIA = 24 * HORA

/** PRNG determinista. @param {number} semilla */
function aleatorio(semilla) {
  let a = semilla >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * @param {import('../core/velas.js').Vela[]} horarias
 * @param {number} duracion
 */
function agregar(horarias, duracion) {
  /** @type {import('../core/velas.js').Vela[]} */
  const salida = []
  for (const v of horarias) {
    const inicio = Math.floor(v.inicio / duracion) * duracion
    const ultima = salida[salida.length - 1]
    if (ultima && ultima.inicio === inicio) {
      ultima.maximo = Math.max(ultima.maximo, v.maximo)
      ultima.minimo = Math.min(ultima.minimo, v.minimo)
      ultima.cierre = v.cierre
      ultima.volumen += v.volumen
    } else {
      salida.push({ ...v, inicio, fin: inicio + duracion })
    }
  }
  return salida
}

/**
 * Serie sintética: paseo aleatorio con tendencias que cambian cada ~3 semanas, huecos opcionales (velas 1H que
 * faltan, como en Binance) y velas 4H/1D agregadas de las 1H.
 * @param {{ inicio: number, horas: number, base: number, semilla: number, huecos?: number[] }} op
 */
function sintetica({ inicio, horas, base, semilla, huecos = [] }) {
  const azar = aleatorio(semilla)
  let precio = base
  let deriva = 0
  /** @type {import('../core/velas.js').Vela[]} */
  const h1 = []
  for (let i = 0; i < horas; i++) {
    if (i % 500 === 0) deriva = (azar() - 0.45) * 0.003
    const apertura = precio
    precio = Math.max(precio * Math.exp(deriva + (azar() - 0.5) * 0.025), base * 0.01)
    const maximo = Math.max(apertura, precio) * (1 + azar() * 0.01)
    const minimo = Math.min(apertura, precio) * (1 - azar() * 0.01)
    h1.push({ inicio: inicio + i * HORA, fin: inicio + (i + 1) * HORA, apertura, maximo, minimo, cierre: precio, volumen: 1 })
  }
  const conHuecos = h1.filter((v) => !huecos.includes(v.inicio))
  return { '1h': conHuecos, '4h': agregar(conHuecos, 4 * HORA), '1d': agregar(conHuecos, DIA) }
}

const INICIO = Date.UTC(2021, 0, 1)
const DESDE = INICIO + 230 * DIA
const HASTA = DESDE + 45 * DIA
const huecos = [DESDE + 5 * DIA - HORA, DESDE + 9 * DIA + 7 * HORA, DESDE + 20 * DIA + 13 * HORA]
const usdt = {
  BTC: sintetica({ inicio: INICIO, horas: 280 * 24, base: 30_000, semilla: 1, huecos }),
  ETH: sintetica({ inicio: INICIO + 3 * HORA, horas: 280 * 24 - 3, base: 2_000, semilla: 4 }),
}
const conEur = Object.fromEntries(Object.entries(usdt).map(([m, s]) => [m, { ...s, eur: s['1h'] }]))
const fng = Array.from({ length: 300 }, (_, i) => ({ t: INICIO + i * DIA, valor: (i * 37) % 100 }))

describe('laboratorio: paridad con ejecutarBacktest', () => {
  const datos = prepararDatos({ series: conEur, fng })
  const casos = [
    ['cruce', { rapida: 10, lenta: 50, stop: 2.5 }],
    ['cruce', { rapida: 20, lenta: 100, stop: null }],
    ['ruptura', { entrada: 20, salida: 10, stop: 2.5 }],
    ['momentum', { dias: 30, revision: 'semanal', stop: 2.5 }],
    ['momentum', { dias: 60, revision: 'diaria', stop: null }],
    ['caidas', { umbralRsi: 15, dias: 5, stop: 2.5 }],
    ['v1stops', { multStopLoss: 2.5, takeProfit: 4 }],
    ['v1stops', { multStopLoss: 3.5, takeProfit: null }],
  ]
  /** @type {string[]} */
  const motivos = []
  for (const [nombre, config] of casos) {
    test(`${nombre} ${JSON.stringify(config)}: mismas operaciones, métricas y comprar y mantener`, () => {
      const estrategia = familia(/** @type {string} */ (nombre)).crear(config, 'vx')
      const esperado = ejecutarBacktest({ series: conEur, fng, desde: DESDE, hasta: HASTA, estrategia })
      const senales = precalcularSenales(datos, estrategia, DESDE, HASTA)
      const r = simular(datos, { estrategia, senales, monedas: ['BTC', 'ETH'], desde: DESDE, hasta: HASTA })
      assert.deepEqual(r.operaciones, esperado.operaciones)
      const { rentabilidadHodl, drawdownMaximoHodl, ...metricas } = esperado.metricas
      assert.deepEqual({ ...r.metricas, rentabilidadHodl, drawdownMaximoHodl }, esperado.metricas)
      assert.deepEqual(r.porMoneda, esperado.porMoneda)
      assert.ok(metricas.operaciones > 0)
      const hodl = simularHodl(datos, { monedas: ['BTC', 'ETH'], desde: DESDE, hasta: HASTA })
      assert.equal(hodl.rentabilidad, rentabilidadHodl)
      assert.equal(hodl.drawdownMaximo, drawdownMaximoHodl)
      motivos.push(...r.operaciones.map((o) => o.motivo))
    })
  }
  test('los casos cubren cierres por señal, stop-loss y take-profit, y horas sin datos frescos', () => {
    assert.ok(motivos.includes('senal'))
    assert.ok(motivos.includes('stop_loss'))
    assert.ok(motivos.includes('take_profit'))
    const r = ejecutarBacktest({ series: conEur, fng, desde: DESDE, hasta: HASTA, estrategia: familia('cruce').crear({ rapida: 10, lenta: 50, stop: null }, 'vx') })
    assert.ok(Object.keys(r.decisiones).some((k) => k.endsWith(':datos_desactualizados')))
  })
  test('las señales solo se calculan en las horas de decisión (una por día y moneda)', () => {
    const s = precalcularSenales(datos, familia('cruce').crear({ rapida: 10, lenta: 50, stop: null }, 'vx'), DESDE, HASTA)
    assert.equal(s.cadencia, DIA)
    assert.equal(s.senales.BTC.length, 45)
  })
})

describe('laboratorio: piezas puras', () => {
  test('encadenar: capital compuesto y caída sobre la curva unida', () => {
    const a = { rentabilidad: 0.1, drawdownMaximo: 0, curva: [10_000, 11_000] }
    const b = { rentabilidad: -0.5, drawdownMaximo: 0.5, curva: [10_000, 5_000] }
    const c = { rentabilidad: 1, drawdownMaximo: 0, curva: [10_000, 20_000] }
    const r = encadenar([a, b, c])
    assert.ok(Math.abs(r.rentabilidad - (1.1 * 0.5 * 2 - 1)) < 1e-12)
    assert.equal(r.drawdownMaximo, 0.5)
    const d = { rentabilidad: -0.2, drawdownMaximo: 0.2, curva: [10_000, 8_000] }
    assert.ok(Math.abs(encadenar([d, d]).drawdownMaximo - 0.36) < 1e-12)
    assert.deepEqual(encadenar([]), { rentabilidad: 0, drawdownMaximo: 0 })
  })
  test('elegir: mayor rentabilidad/caída entre las positivas; si no hay, la de mayor rentabilidad', () => {
    assert.equal(elegir([{ rentabilidad: 0.5, drawdownMaximo: 0.5 }, { rentabilidad: 0.2, drawdownMaximo: 0.1 }, { rentabilidad: -1, drawdownMaximo: 0.01 }]), 1)
    assert.equal(elegir([{ rentabilidad: -0.5, drawdownMaximo: 0.5 }, { rentabilidad: -0.2, drawdownMaximo: 0.4 }]), 1)
    assert.equal(elegir([{ rentabilidad: 0.2, drawdownMaximo: 0.1 }, { rentabilidad: 0.4, drawdownMaximo: 0.2 }]), 0)
    assert.equal(cociente({ rentabilidad: 0.1, drawdownMaximo: 0 }), Infinity)
    assert.equal(cociente({ rentabilidad: 0, drawdownMaximo: 0 }), 0)
  })
  test('meseta: mediana de las vecinas ≥ 50 % de la elegida, y la elegida debe ser positiva', () => {
    assert.equal(mediana([3, 1, 2]), 2)
    assert.equal(mediana([4, 1, 2, 3]), 2.5)
    assert.equal(meseta(2, [0.5, 1, 3]).cumple, true)
    assert.equal(meseta(2, [0.5, 0.9, 3]).cumple, false)
    assert.equal(meseta(-1, [0, 0]).cumple, false)
    assert.equal(meseta(1, []).cumple, false)
  })
  test('criterio: los 5 puntos por separado', () => {
    const base = {
      oos: { rentabilidad: 0.5, drawdownMaximo: 0.3 },
      hodl: { rentabilidad: 2, drawdownMaximo: 0.5 },
      porAno: [0.1, 0.2, -0.1, 0.3, 0.1, -0.05],
      porMoneda: { BTC: 10, ETH: 5, SOL: -1, BNB: 2, XRP: 1 },
      meseta: { cumple: true },
    }
    const ok = evaluarCriterio(base)
    assert.equal(ok.cumple, true)
    assert.deepEqual(ok.puntos.map((p) => p.id), CRITERIO.map((c) => c.id))
    /** @param {object} cambio @param {string} id */
    const falla = (cambio, id) => {
      const r = evaluarCriterio({ ...base, ...cambio })
      assert.equal(r.cumple, false)
      assert.deepEqual(r.puntos.filter((p) => !p.cumple).map((p) => p.id), [id])
    }
    falla({ oos: { rentabilidad: -0.01, drawdownMaximo: 0.3 } }, 'rentabilidad')
    falla({ oos: { rentabilidad: 0.5, drawdownMaximo: 0.31 } }, 'caida')
    falla({ porAno: [0.1, 0.2, -0.1, 0.3, -0.1, -0.05] }, 'anos')
    falla({ porMoneda: { BTC: 10, ETH: 5, SOL: -1, BNB: 0, XRP: 1 } }, 'monedas')
    falla({ meseta: { cumple: false } }, 'meseta')
  })
})

describe('laboratorio: validación por tramos', () => {
  const inicio = Date.UTC(2018, 6, 1)
  const fin = Date.UTC(2021, 1, 1)
  const horas = (fin - inicio) / HORA
  const tardia = Date.UTC(2019, 2, 1)
  const series = {
    BTC: sintetica({ inicio, horas, base: 10_000, semilla: 7 }),
    SOL: sintetica({ inicio: tardia, horas: (fin - tardia) / HORA, base: 5, semilla: 8 }),
  }
  const fngLargo = Array.from({ length: 1000 }, (_, i) => ({ t: inicio + i * DIA, valor: (i * 13) % 100 }))
  const configs = [
    { familia: 'cruce', config: { rapida: 10, lenta: 50, stop: null } },
    { familia: 'cruce', config: { rapida: 10, lenta: 50, stop: 2.5 } },
    { familia: 'cruce', config: { rapida: 20, lenta: 50, stop: null } },
    { familia: 'momentum', config: { dias: 30, revision: 'diaria', stop: null } },
    { familia: 'momentum', config: { dias: 60, revision: 'diaria', stop: null } },
  ]
  const opciones = { configs, anosPrueba: [2020], inicioReservado: Date.UTC(2021, 0, 1) }
  const r = evaluarLaboratorio({ series, fng: fngLargo, ...opciones })

  test('tramos: empiezan cuando hay 200 velas 1D y cada moneda entra con su historia suficiente', () => {
    const datos = prepararDatos({ series: { BTC: { ...series.BTC, eur: series.BTC['1h'] }, SOL: { ...series.SOL, eur: series.SOL['1h'] } }, fng: fngLargo })
    const { tramos, reservado } = tramosDelLaboratorio(datos, { inicioReservado: Date.UTC(2021, 0, 1) })
    assert.deepEqual(tramos.map((t) => t.ano), [2019, 2020])
    assert.equal(tramos[0].desde, inicio + 200 * DIA)
    assert.deepEqual(tramos[0].monedas, ['BTC'])
    assert.deepEqual(tramos[1].monedas, ['BTC', 'SOL'])
    assert.equal(tramos[1].desde, Date.UTC(2020, 0, 1))
    assert.equal(tramos[1].hasta, Date.UTC(2021, 0, 1))
    assert.deepEqual(reservado, { ano: 2021, desde: Date.UTC(2021, 0, 1), hasta: fin, monedas: ['BTC', 'SOL'] })
    assert.deepEqual(r.tramos.map((t) => [t.ano, t.prueba]), [[2019, false], [2020, true]])
  })
  test('el entrenamiento nunca ve datos del año de prueba', () => {
    const corte = Date.UTC(2020, 0, 1) - HORA + 3 * 60_000
    /** @param {import('../core/velas.js').Vela[]} v */
    const alterar = (v) => v.map((x, i) => (x.fin > corte
      ? { ...x, apertura: x.apertura * (1 + 0.3 * Math.sin(i)), maximo: x.maximo * 1.5, minimo: x.minimo * 0.5, cierre: x.cierre * (1 + 0.3 * Math.cos(i)) }
      : x))
    const alteradas = Object.fromEntries(Object.entries(series).map(([m, s]) => [m, { '1h': alterar(s['1h']), '4h': alterar(s['4h']), '1d': alterar(s['1d']) }]))
    const fngAlterado = fngLargo.map((f) => (f.t > corte ? { ...f, valor: 100 - f.valor } : f))
    const r2 = evaluarLaboratorio({ series: alteradas, fng: fngAlterado, ...opciones })
    for (const [i, f] of r.familias.entries()) {
      const g = r2.familias[i]
      assert.deepEqual(g.pliegues[0].entrenamiento, f.pliegues[0].entrenamiento)
      assert.deepEqual(g.pliegues[0].config, f.pliegues[0].config)
      for (const [j, c] of f.configuraciones.entries()) assert.deepEqual(g.configuraciones[j].porAno[0], c.porAno[0])
    }
    assert.notDeepEqual(r2.familias.map((f) => f.pliegues[0].prueba), r.familias.map((f) => f.pliegues[0].prueba))
  })
  test('fuera de muestra: el año de prueba con la configuración elegida en su entrenamiento', () => {
    for (const f of r.familias) {
      const elegida = f.configuraciones.find((c) => JSON.stringify(c.config) === JSON.stringify(f.pliegues[0].config))
      const ano = /** @type {NonNullable<typeof elegida>} */ (elegida).porAno.find((a) => a.ano === 2020)
      assert.equal(f.pliegues[0].prueba.rentabilidad, ano?.rentabilidad)
      assert.equal(f.oos.rentabilidad, ano?.rentabilidad)
      assert.equal(f.oos.porAno[0].hodl, r.tramos[1].hodl.rentabilidad)
      assert.equal(f.oos.rentabilidadHodl, r.tramos[1].hodl.rentabilidad)
      assert.deepEqual(Object.keys(f.oos.porMoneda), ['BTC', 'SOL'])
      assert.equal(f.criterio.puntos.length, 5)
    }
  })
  test('ranking por rentabilidad/caída, selección de familias distintas y tramo reservado solo para las elegidas', () => {
    const cocientes = r.ranking.map((x) => x.oos.cociente ?? -Infinity)
    assert.deepEqual(cocientes, [...cocientes].sort((a, b) => b - a))
    assert.equal(new Set(r.seleccion.map((s) => s.familia)).size, r.seleccion.length)
    assert.deepEqual(r.seleccion.map((s) => s.version), ['v3', 'v4'].slice(0, r.seleccion.length))
    assert.deepEqual(Object.keys(r.reservado.porVersion), r.seleccion.map((s) => s.version))
    for (const s of r.seleccion) {
      assert.equal(s.experimental, !r.ranking.find((x) => x.familia === s.familia)?.criterio.cumple)
      assert.equal(r.ranking.find((x) => x.version === s.version)?.familia, s.familia)
    }
  })
})

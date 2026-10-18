// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ejecutarBacktest } from '../core/backtest.js'
import { HORA } from '../core/velas.js'
import { serie } from './ayudantes.js'

const DIA = 24 * HORA
const INICIO = 1000 * DIA

/** Serie de una moneda: sube 30 días, cae 30 días, con datos de calentamiento previos. @param {number} base */
function moneda(base) {
  /** @param {number} t */
  const precio = (t) => {
    const dias = (t - INICIO) / DIA
    const pico = dias < 30 ? dias : 60 - dias
    return base * (1 + 0.01 * pico) * (1 + 0.003 * Math.sin(t / HORA))
  }
  /** @param {number} dur @param {number} desde @param {number} hasta */
  const tramo = (dur, desde, hasta) => serie(Math.floor((hasta - desde) / dur), (i) => precio(desde + (i + 1) * dur), { duracion: dur, inicio: desde })
  const fin = INICIO + 60 * DIA
  return {
    '1h': tramo(HORA, INICIO - 25 * DIA, fin),
    '4h': tramo(4 * HORA, INICIO - 90 * DIA, fin),
    '1d': tramo(DIA, INICIO - 260 * DIA, fin),
    eur: tramo(HORA, INICIO - 2 * DIA, fin).map((v) => ({ ...v, apertura: v.apertura * 0.9, maximo: v.maximo * 0.9, minimo: v.minimo * 0.9, cierre: v.cierre * 0.9 })),
  }
}

const series = { BTC: moneda(100), ETH: moneda(10) }
const fng = Array.from({ length: 400 }, (_, i) => ({ t: INICIO - 300 * DIA + i * DIA, valor: 50 }))

describe('ejecutarBacktest', () => {
  const desde = INICIO
  const hasta = INICIO + 40 * DIA
  const r = ejecutarBacktest({ series, fng, desde, hasta })

  test('una evaluación por hora, en el minuto 3, con comprar y mantener desde el inicio', () => {
    assert.equal(Object.values(r.decisiones).reduce((s, n) => s + n, 0), 40 * 24 * 2)
    assert.equal(r.curvaDiaria[0].t % DIA, 23 * HORA + 3 * 60_000)
    assert.ok(r.curvaDiaria.every((p) => p.hodl !== null))
  })
  test('etiqueta variante y versión', () => {
    assert.equal(r.variante, 'tecnico+fng')
    assert.equal(r.version, 'v1')
  })
  test('opera y la contabilidad cuadra: valor = saldo + abiertas', () => {
    assert.ok(r.metricas.operaciones > 0)
    assert.ok(r.metricas.saldo >= 0)
    const ultima = r.curvaDiaria[r.curvaDiaria.length - 1]
    assert.ok(Math.abs(ultima.valor - r.metricas.valorCartera) < 1e-6)
  })
  test('sin información futura: los datos posteriores a "hasta" no cambian nada', () => {
    const corte = hasta
    /** @param {import('../core/velas.js').Vela[]} v */
    const truncar = (v) => v.filter((x) => x.fin <= corte)
    const truncadas = Object.fromEntries(Object.entries(series).map(([m, s]) => [m, {
      '1h': truncar(s['1h']), '4h': truncar(s['4h']), '1d': truncar(s['1d']), eur: truncar(s.eur),
    }]))
    const r2 = ejecutarBacktest({ series: truncadas, fng: fng.filter((f) => f.t <= corte), desde, hasta })
    assert.deepEqual(r2, r)
  })
})

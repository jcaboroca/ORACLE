// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { VARIANTE_POR_DEFECTO, avisoBacktest, ejecutarBacktest } from '../core/backtest.js'
import * as v1 from '../core/estrategia-v1.js'
import { estrategia } from '../core/estrategias.js'
import { HORA, VENTANA } from '../core/velas.js'
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
const fng = Array.from({ length: 400 }, (_, i) => ({ t: INICIO - 300 * DIA + i * DIA, valor: i % 2 === 0 ? 10 : 90 }))

describe('ejecutarBacktest', () => {
  const desde = INICIO
  const hasta = INICIO + 40 * DIA
  const r = ejecutarBacktest({ series, fng, desde, hasta, estrategia: v1 })

  test('una evaluación por hora, en el minuto 3, con comprar y mantener desde el inicio', () => {
    assert.equal(Object.values(r.decisiones).reduce((s, n) => s + n, 0), 40 * 24 * 2)
    assert.equal(r.curvaDiaria[0].t % DIA, 23 * HORA + 3 * 60_000)
    assert.ok(r.curvaDiaria.every((p) => p.hodl !== null))
  })
  test('etiqueta variante y versión', () => {
    assert.equal(r.variante, 'tecnico+fng')
    assert.equal(VARIANTE_POR_DEFECTO, 'tecnico+fng')
    assert.equal(r.version, 'v1')
  })
  test('la variante sale de la estrategia: VARIANTE_BACKTEST si la declara (v3–v5: solo técnico)', () => {
    const tecnica = { ...v1, VERSION: 'vtecnica', VARIANTE_BACKTEST: 'tecnico' }
    assert.equal(ejecutarBacktest({ series, fng, desde, hasta: desde + 2 * DIA, estrategia: tecnica }).variante, 'tecnico')
    for (const v of ['v3', 'v4', 'v5']) {
      const e = estrategia(v)
      assert.equal(ejecutarBacktest({ series, fng, desde, hasta: desde + 2 * DIA, estrategia: e }).variante, 'tecnico', v)
    }
  })
  test('aviso del JSON según la variante; una variante desconocida lanza RangeError', () => {
    assert.match(avisoBacktest('tecnico+fng'), /Variante técnico \+ Fear & Greed/)
    assert.match(avisoBacktest('tecnico'), /Variante solo técnico: .*sin noticias, derivados ni Fear & Greed/)
    for (const v of ['tecnico+fng', 'tecnico']) assert.match(avisoBacktest(v), /No es asesoramiento financiero ni garantía de beneficio\.$/)
    assert.throws(() => avisoBacktest('otra'), RangeError)
  })
  test('los parámetros publicados son los de la estrategia recibida', () => {
    assert.equal(r.parametros.estrategia, v1.PARAMETROS)
    assert.equal(r.parametros.bot, v1.PARAMETROS_BOT)
    const otra = { ...v1, VERSION: 'vprueba', PARAMETROS_BOT: Object.freeze({ ...v1.PARAMETROS_BOT, fraccionPosicion: 0.1 }) }
    const r2 = ejecutarBacktest({ series, fng, desde, hasta, estrategia: otra })
    assert.equal(r2.version, 'vprueba')
    assert.equal(r2.parametros.bot, otra.PARAMETROS_BOT)
    const compras = r2.operaciones.filter((o) => o.tipo === 'compra')
    assert.ok(compras.length > 0)
    assert.ok(compras[0].importe <= 0.1 * 10_000 + 1e-9)
  })
  test('por defecto la ventana es la del Worker en vivo (VENTANA = 299 velas cerradas: OKX sirve 300 con la abierta)', () => {
    assert.equal(VENTANA, 299)
    assert.equal(r.parametros.ventana, VENTANA)
    assert.equal(ejecutarBacktest({ series, fng, desde, hasta: desde + DIA, ventana: 300, estrategia: v1 }).parametros.ventana, 300)
  })
  test('opera y la contabilidad cuadra: valor = saldo + abiertas', () => {
    assert.ok(r.metricas.operaciones > 0)
    assert.ok(r.metricas.saldo >= 0)
    const ultima = r.curvaDiaria[r.curvaDiaria.length - 1]
    assert.ok(Math.abs(ultima.valor - r.metricas.valorCartera) < 1e-6)
  })
  test('sin información futura: alterar lo que aún no había cerrado en la última evaluación no cambia nada', () => {
    const corte = r.curvaDiaria[r.curvaDiaria.length - 1].t
    assert.equal(corte, hasta - HORA + 3 * 60_000)
    /** @param {import('../core/velas.js').Vela[]} v */
    const alterar = (v) => v.map((x) => (x.fin > corte
      ? { ...x, apertura: x.apertura * 3, maximo: x.maximo * 3, minimo: x.minimo * 3, cierre: x.cierre * 3 }
      : x))
    const alteradas = Object.fromEntries(Object.entries(series).map(([m, s]) => [m, {
      '1h': alterar(s['1h']), '4h': alterar(s['4h']), '1d': alterar(s['1d']), eur: alterar(s.eur),
    }]))
    const fngAlterado = fng.map((f) => (f.t > corte ? { ...f, valor: 100 - f.valor } : f))
    const r2 = ejecutarBacktest({ series: alteradas, fng: fngAlterado, desde, hasta, estrategia: v1 })
    assert.deepEqual(r2, r)
  })
})

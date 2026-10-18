// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { PARAMETROS, PARAMETROS_BOT, VERSION, aplicarRegimen, calcularSenal } from '../core/estrategia-v2.js'
import { HORA } from '../core/velas.js'
import { serie } from './ayudantes.js'

const DIA = 24 * HORA
const CIERRE = 600 * DIA
const AHORA = CIERRE + 3 * 60_000
/** @param {number} dur */
const sube = (dur) => serie(300, (i) => 100 * 1.004 ** i, { duracion: dur, inicio: CIERRE - 300 * dur })
/** 1D: caída larga y rebote fuerte reciente → tendencia 1D alcista con el cierre aún bajo la EMA200. */
const rebote = serie(300, (i) => (i < 240 ? 300 - i : 60 * 1.006 ** (i - 240)), { duracion: DIA, inicio: CIERRE - 300 * DIA })
/** @param {import('../core/velas.js').Vela[]} d1 */
const entrada = (d1) => ({
  simbolo: 'BTC', ahora: AHORA, velas: { '1h': sube(HORA), '4h': sube(4 * HORA), '1d': d1 }, derivados: null, titulares: [], fng: null,
})

describe('estrategia v2: parámetros', () => {
  test('versión y parámetros congelados; señal de v1 más filtro de régimen EMA200 1D', () => {
    assert.equal(VERSION, 'v2')
    assert.ok(Object.isFrozen(PARAMETROS))
    assert.deepEqual(PARAMETROS.regimen, { timeframe: '1d', periodoEma: 200 })
    for (const [k, valor] of Object.entries(v1.PARAMETROS)) assert.deepEqual(/** @type {Record<string, unknown>} */ (PARAMETROS)[k], valor)
  })
  test('bot: los de v1 con decisión solo al cierre diario (cada 24 h)', () => {
    assert.ok(Object.isFrozen(PARAMETROS_BOT))
    assert.deepEqual(PARAMETROS_BOT, { ...v1.PARAMETROS_BOT, cadenciaHoras: 24 })
  })
})

describe('aplicarRegimen', () => {
  /** @param {Partial<ReturnType<typeof v1.calcularSenal>>} s @param {number} precio @param {number} ema200 */
  const senal = (s, precio, ema200) => /** @type {ReturnType<typeof v1.calcularSenal>} */ (/** @type {unknown} */ ({
    version: 'v1', veredicto: 'COMPRAR', motivo: null, puntuacion: 0.4,
    detalle: { timeframes: { '1d': { precio, ema200 } } }, ...s,
  }))
  test('COMPRAR con el cierre 1D por encima de la EMA200 1D: sigue COMPRAR', () => {
    const r = aplicarRegimen(senal({}, 101, 100))
    assert.equal(r.veredicto, 'COMPRAR')
    assert.equal(r.motivo, null)
    assert.equal(r.version, 'v2')
    assert.deepEqual(r.detalle.regimen, { sobreEma200: true })
  })
  test('COMPRAR con el cierre 1D en o bajo la EMA200 1D: MANTENER con motivo filtro_regimen', () => {
    for (const precio of [100, 99]) {
      const r = aplicarRegimen(senal({}, precio, 100))
      assert.equal(r.veredicto, 'MANTENER')
      assert.equal(r.motivo, 'filtro_regimen')
      assert.equal(r.puntuacion, 0.4)
    }
  })
  test('VENDER y MANTENER no se filtran', () => {
    assert.equal(aplicarRegimen(senal({ veredicto: 'VENDER' }, 50, 100)).veredicto, 'VENDER')
    const m = aplicarRegimen(senal({ veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados' }, 50, 100))
    assert.equal(m.motivo, 'contradiccion_tecnico_derivados')
  })
  test('SIN_DATOS pasa tal cual, con la versión v2', () => {
    const r = aplicarRegimen(senal({ veredicto: 'SIN_DATOS', motivo: 'velas_insuficientes', detalle: { timeframes: { '1h': null, '4h': null, '1d': null }, derivados: {}, noticias: [], fng: null } }, 0, 0))
    assert.equal(r.veredicto, 'SIN_DATOS')
    assert.equal(r.motivo, 'velas_insuficientes')
    assert.equal(r.version, 'v2')
    assert.equal(r.detalle.regimen, null)
  })
})

describe('calcularSenal v2', () => {
  test('tendencia limpia por encima de la EMA200: misma señal que v1 salvo la versión', () => {
    const e = entrada(sube(DIA))
    const s1 = v1.calcularSenal(e)
    const s2 = calcularSenal(e)
    assert.equal(s1.veredicto, 'COMPRAR')
    const { version: _a, detalle: d2, ...resto2 } = s2
    const { version: _b, detalle: d1, ...resto1 } = s1
    assert.equal(s2.version, 'v2')
    assert.deepEqual(resto2, resto1)
    assert.deepEqual(d2, { ...d1, regimen: { sobreEma200: true } })
  })
  test('rebote bajo la EMA200 1D: v1 compra, v2 no (filtro_regimen)', () => {
    const e = entrada(rebote)
    assert.equal(v1.calcularSenal(e).veredicto, 'COMPRAR')
    const s = calcularSenal(e)
    assert.equal(s.veredicto, 'MANTENER')
    assert.equal(s.motivo, 'filtro_regimen')
  })
  test('sin información futura: añadir velas no cerradas no cambia la señal', () => {
    const e = entrada(rebote)
    const futura = serie(1, () => 1000, { duracion: DIA, inicio: CIERRE })
    const conFutura = { ...e, velas: { ...e.velas, '1d': [...rebote, ...futura] } }
    assert.deepEqual(calcularSenal(conFutura), calcularSenal(e))
  })
})

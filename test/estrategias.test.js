// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { PARAMETROS_BOT } from '../core/bot.js'
import * as v1 from '../core/estrategia-v1.js'
import * as v2 from '../core/estrategia-v2.js'
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_ACTIVA, ESTRATEGIA_PRINCIPAL, estrategia } from '../core/estrategias.js'
import { familia } from '../core/familias/index.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

describe('registro de estrategias', () => {
  test('cada estrategia expone VERSION, PARAMETROS, PARAMETROS_BOT y calcularSenal con su clave', () => {
    for (const [clave, e] of Object.entries(ESTRATEGIAS)) {
      assert.equal(e.VERSION, clave)
      assert.ok(Object.isFrozen(e.PARAMETROS))
      assert.ok(Object.isFrozen(e.PARAMETROS_BOT))
      assert.equal(typeof e.calcularSenal, 'function')
      /** @type {Record<string, unknown>} */
      const bot = e.PARAMETROS_BOT
      for (const k of Object.keys(PARAMETROS_BOT)) assert.equal(typeof bot[k], 'number', `${clave}.${k}`)
    }
  })
  test('v1 usa exactamente los parámetros de bot por defecto', () => {
    assert.equal(ESTRATEGIAS.v1, v1)
    assert.deepEqual(v1.PARAMETROS_BOT, PARAMETROS_BOT)
  })
  test('estrategia(version) devuelve el módulo; una versión desconocida lanza RangeError', () => {
    assert.equal(estrategia('v1'), v1)
    assert.throws(() => estrategia('v99'), RangeError)
    assert.throws(() => estrategia('toString'), RangeError)
  })
  test('la estrategia activa está registrada', () => {
    assert.ok(Object.hasOwn(ESTRATEGIAS, ESTRATEGIA_ACTIVA))
  })
  test('v2 está registrada (no superó a v1 en TEST, spec §6.6) y v1 sigue disponible', () => {
    assert.equal(estrategia('v2'), v2)
    assert.equal(estrategia('v1'), v1)
  })
})

describe('estrategias en vivo (spec del laboratorio §6)', () => {
  test('ESTRATEGIAS_EN_VIVO: congelada, no vacía, sin repetidas y registradas', () => {
    assert.ok(Object.isFrozen(ESTRATEGIAS_EN_VIVO))
    assert.ok(ESTRATEGIAS_EN_VIVO.length >= 1)
    assert.equal(new Set(ESTRATEGIAS_EN_VIVO).size, ESTRATEGIAS_EN_VIVO.length)
    for (const v of ESTRATEGIAS_EN_VIVO) assert.ok(Object.hasOwn(ESTRATEGIAS, v), v)
  })
  test('las 3 del laboratorio en vivo; la principal es la nº 1 y es la activa', () => {
    assert.deepEqual(ESTRATEGIAS_EN_VIVO, ['v3', 'v4', 'v5'])
    assert.equal(ESTRATEGIA_PRINCIPAL, 'v3')
    assert.ok(ESTRATEGIAS_EN_VIVO.includes(ESTRATEGIA_PRINCIPAL))
    assert.equal(ESTRATEGIA_ACTIVA, ESTRATEGIA_PRINCIPAL)
  })
  test('v3–v5 son exactamente la selección de data/laboratorio.json (familia, config y orden)', () => {
    /** @type {{ seleccion: { version: string, familia: string, config: object, experimental: boolean }[], ranking: { familia: string, version: string|null }[] }} */
    const lab = JSON.parse(readFileSync(new URL('../data/laboratorio.json', import.meta.url), 'utf8'))
    assert.deepEqual(lab.seleccion.map((s) => s.version), ESTRATEGIAS_EN_VIVO)
    assert.equal(lab.ranking[0].version, ESTRATEGIA_PRINCIPAL)
    for (const s of lab.seleccion) {
      const e = estrategia(s.version)
      assert.equal(e.VERSION, s.version)
      assert.deepEqual(e.PARAMETROS, { familia: s.familia, config: s.config })
      const deFamilia = familia(s.familia).crear(s.config, s.version)
      assert.deepEqual(e.PARAMETROS_BOT, deFamilia.PARAMETROS_BOT)
      const entrada = entradaDiaria(Array.from({ length: 260 }, (_, i) => 100 + 10 * Math.sin(i / 9) + i / 5))
      assert.deepEqual(e.calcularSenal(entrada), deFamilia.calcularSenal(entrada))
    }
  })
  test('v3–v5: contrato de estrategia con la forma de señal de v1', () => {
    for (const v of ['v3', 'v4', 'v5']) {
      const e = estrategia(v)
      assert.ok(Object.isFrozen(e.PARAMETROS) && Object.isFrozen(e.PARAMETROS_BOT))
      assert.equal(e.PARAMETROS_BOT.cadenciaHoras, 24)
      const s = e.calcularSenal(entradaDiaria(Array.from({ length: 260 }, (_, i) => 100 + i)))
      assert.deepEqual(Object.keys(s).sort(), CLAVES_SENAL)
      assert.equal(s.version, v)
      assert.ok(['COMPRAR', 'VENDER', 'MANTENER'].includes(s.veredicto))
    }
  })
})

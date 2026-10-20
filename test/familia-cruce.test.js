// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import * as v1 from '../core/estrategia-v1.js'
import { FAMILIA, crear } from '../core/familias/cruce.js'
import { atr, ema, ultimo } from '../core/indicadores.js'
import { HORA } from '../core/velas.js'
import { CLAVES_SENAL, entradaDiaria } from './ayudantes.js'

const DIA = 24 * HORA
const subida = Array.from({ length: 120 }, (_, i) => 100 + i)
const bajada = Array.from({ length: 120 }, (_, i) => 300 - i)

describe('familia F1: cruce de medias 1D', () => {
  const f = crear({ rapida: 10, lenta: 50, stop: null }, 'vx')

  test('contrato: VERSION recibida y PARAMETROS congelados con la familia y la config', () => {
    assert.equal(f.VERSION, 'vx')
    assert.equal(FAMILIA, 'cruce')
    assert.deepEqual(f.PARAMETROS, { familia: 'cruce', config: { rapida: 10, lenta: 50, stop: null } })
    assert.ok(Object.isFrozen(f.PARAMETROS) && Object.isFrozen(f.PARAMETROS.config))
    assert.ok(Object.isFrozen(f.PARAMETROS_BOT))
  })
  test('las claves de la señal son las de v1, también sin datos', () => {
    const vacia = v1.calcularSenal({ ...entradaDiaria([1]), velas: { '1h': [], '4h': [], '1d': [] } })
    assert.deepEqual(Object.keys(vacia).sort(), CLAVES_SENAL)
    assert.deepEqual(Object.keys(f.calcularSenal(entradaDiaria(subida))).sort(), CLAVES_SENAL)
    assert.deepEqual(Object.keys(f.calcularSenal(entradaDiaria(subida.slice(0, 20)))).sort(), CLAVES_SENAL)
  })
  test('EMA rápida > lenta → COMPRAR; < → VENDER; iguales → MANTENER', () => {
    const arriba = f.calcularSenal(entradaDiaria(subida))
    assert.equal(arriba.veredicto, 'COMPRAR')
    assert.equal(arriba.puntuacion, 1)
    assert.equal(arriba.indiceConfianza, 1)
    assert.equal(arriba.version, 'vx')
    assert.deepEqual(arriba.detalle, {
      familia: 'cruce',
      indicadores: { emaRapida: ultimo(ema(subida, 10)), emaLenta: ultimo(ema(subida, 50)) },
    })
    const abajo = f.calcularSenal(entradaDiaria(bajada))
    assert.equal(abajo.veredicto, 'VENDER')
    assert.equal(abajo.puntuacion, -1)
    const plana = f.calcularSenal(entradaDiaria(new Array(120).fill(100)))
    assert.equal(plana.veredicto, 'MANTENER')
    assert.equal(plana.puntuacion, 0)
    assert.equal(plana.indiceConfianza, null)
  })
  test('campos base: precio y vela de la última 1H cerrada, fresca y atrPct = ATR14 1D / cierre', () => {
    const entrada = entradaDiaria(subida)
    const s = f.calcularSenal(entrada)
    assert.equal(s.simbolo, 'BTC')
    assert.equal(s.calculadaEn, entrada.ahora)
    assert.equal(s.precio, 219)
    assert.equal(s.vela1h, Date.UTC(2021, 0, 4) - HORA)
    assert.equal(s.fresca, true)
    const diarias = entrada.velas['1d']
    assert.equal(s.atrPct, /** @type {number} */ (ultimo(atr(diarias, 14))) / 219)
    assert.deepEqual(s.componentes, { tecnico: 1, derivados: null, noticias: null, fng: null })
    assert.deepEqual(s.ausentes, ['derivados', 'noticias', 'fng'])
  })
  test('menos velas 1D cerradas que la EMA lenta: SIN_DATOS', () => {
    const s = f.calcularSenal(entradaDiaria(subida.slice(0, 49)))
    assert.equal(s.veredicto, 'SIN_DATOS')
    assert.equal(s.motivo, 'velas_insuficientes')
    assert.equal(s.puntuacion, null)
    assert.equal(s.atrPct, null)
    assert.equal(f.calcularSenal(entradaDiaria(subida.slice(0, 50))).veredicto, 'COMPRAR')
  })
  test('solo velas cerradas: la vela 1D en curso no cuenta', () => {
    const entrada = entradaDiaria(subida)
    const enCurso = { ...entrada.velas['1d'][0], inicio: Date.UTC(2021, 0, 4), fin: Date.UTC(2021, 0, 4) + DIA, cierre: 1 }
    const conEnCurso = { ...entrada, velas: { ...entrada.velas, '1d': [...entrada.velas['1d'], enCurso] } }
    assert.deepEqual(f.calcularSenal(conEnCurso), f.calcularSenal(entrada))
  })
  test('bot: v1 decidiendo cada 24 h y sin take-profit; sin stop o stop de emergencia × ATR14 1D', () => {
    assert.deepEqual(f.PARAMETROS_BOT, {
      ...v1.PARAMETROS_BOT, cadenciaHoras: 24, sinStopLoss: true, sinTakeProfit: true,
    })
    const conStop = crear({ rapida: 10, lenta: 50, stop: 2.5 }, 'vx')
    assert.deepEqual(conStop.PARAMETROS_BOT, {
      ...v1.PARAMETROS_BOT, cadenciaHoras: 24, multStopLoss: 2.5, sinStopLoss: false, sinTakeProfit: true,
    })
  })
  test('config inválida: RangeError', () => {
    assert.throws(() => crear({ rapida: 50, lenta: 10, stop: null }, 'vx'), RangeError)
    assert.throws(() => crear({ rapida: 0, lenta: 10, stop: null }, 'vx'), RangeError)
    assert.throws(() => crear({ rapida: 10, lenta: 50, stop: -1 }, 'vx'), RangeError)
  })
})

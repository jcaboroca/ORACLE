// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  PARAMETROS, VERSION, analizarTimeframe, calcularSenal, combinar, puntuarBollinger,
  puntuarDerivados, puntuarFng, puntuarMacd, puntuarNoticias, puntuarRsi, tendenciaDe,
} from '../core/estrategia-v1.js'
import { HORA } from '../core/velas.js'
import { serie } from './ayudantes.js'

describe('tendenciaDe (umbral ±2 %)', () => {
  test('por encima, por debajo y dentro', () => {
    assert.equal(tendenciaDe(0.021), 'alcista')
    assert.equal(tendenciaDe(-0.021), 'bajista')
    assert.equal(tendenciaDe(0.02), 'lateral')
    assert.equal(tendenciaDe(-0.02), 'lateral')
  })
})

describe('puntuarRsi según tendencia', () => {
  const casos = /** @type {const} */ ([
    ['alcista', 45, 1], ['alcista', 60, 0], ['alcista', 70, 0], ['alcista', 80, -0.3],
    ['bajista', 55, -1], ['bajista', 40, 0], ['bajista', 20, 0.3],
    ['lateral', 30, 1], ['lateral', 50, 0], ['lateral', 70, -1],
  ])
  for (const [tendencia, rsi, esperado] of casos) {
    test(`${tendencia} RSI ${rsi} → ${esperado}`, () => assert.equal(puntuarRsi(tendencia, rsi), esperado))
  }
})

describe('puntuarMacd', () => {
  test('cruce al alza +1, a la baja −1', () => {
    assert.equal(puntuarMacd(-0.1, 0.1), 1)
    assert.equal(puntuarMacd(0.1, -0.1), -1)
  })
  test('sin cruce: signo × 0,5', () => {
    assert.equal(puntuarMacd(0.1, 0.2), 0.5)
    assert.equal(puntuarMacd(-0.1, -0.2), -0.5)
  })
})

describe('puntuarBollinger', () => {
  test('solo cuenta en lateral', () => {
    assert.equal(puntuarBollinger('lateral', -0.1), 1)
    assert.equal(puntuarBollinger('lateral', 1.1), -1)
    assert.equal(puntuarBollinger('lateral', 0.5), 0)
    assert.equal(puntuarBollinger('alcista', -0.1), 0)
  })
})

describe('analizarTimeframe', () => {
  test('menos de 200 velas: null', () => {
    assert.equal(analizarTimeframe(serie(199, () => 100)), null)
  })
  test('subida sostenida: alcista y puntuación = suma ponderada de subs', () => {
    const r = /** @type {NonNullable<ReturnType<typeof analizarTimeframe>>} */ (analizarTimeframe(serie(300, (i) => 100 * 1.005 ** i)))
    assert.equal(r.tendencia, 'alcista')
    assert.equal(r.subs.tendencia, 1)
    assert.equal(r.subs.ema200, 1)
    assert.equal(r.subs.rsi, -0.3) // RSI 100 en tendencia alcista: sobreextendida, no −1
    assert.equal(r.subs.bollinger, 0)
    const p = PARAMETROS.pesosSub
    const esperada = p.tendencia * r.subs.tendencia + p.ema200 * r.subs.ema200 + p.rsi * r.subs.rsi
      + p.macd * r.subs.macd + p.bollinger * r.subs.bollinger
    assert.ok(Math.abs(r.puntuacion - esperada) < 1e-9)
  })
  test('bajada sostenida: bajista con puntuación negativa', () => {
    const r = /** @type {NonNullable<ReturnType<typeof analizarTimeframe>>} */ (analizarTimeframe(serie(300, (i) => 100 * 0.995 ** i)))
    assert.equal(r.tendencia, 'bajista')
    assert.ok(r.puntuacion < 0)
  })
})

describe('puntuarDerivados', () => {
  test('null: ausente', () => assert.equal(puntuarDerivados(null).puntuacion, null))
  test('funding muy alto: sobrecalentado → negativo', () => {
    const r = puntuarDerivados({ funding: 0.0006, ratioLongShort: null, oiCambio24h: null, precioCambio24h: null })
    assert.equal(r.puntuacion, -1)
  })
  test('media ponderada de los presentes', () => {
    // funding −0,04 % → +0,5 (peso 0,4); L/S 2,5 → −0,5 (peso 0,3) → (0,2 − 0,15) / 0,7
    const r = puntuarDerivados({ funding: -0.0004, ratioLongShort: 2.5, oiCambio24h: null, precioCambio24h: null })
    assert.ok(Math.abs(/** @type {number} */ (r.puntuacion) - 0.05 / 0.7) < 1e-9)
  })
  test('OI sube con el precio confirma (+0,5); con precio bajando resta', () => {
    assert.equal(puntuarDerivados({ funding: null, ratioLongShort: null, oiCambio24h: 0.05, precioCambio24h: 0.02 }).puntuacion, 0.5)
    assert.equal(puntuarDerivados({ funding: null, ratioLongShort: null, oiCambio24h: 0.05, precioCambio24h: -0.02 }).puntuacion, -0.5)
  })
  test('todos null: ausente', () => {
    assert.equal(puntuarDerivados({ funding: null, ratioLongShort: null, oiCambio24h: null, precioCambio24h: null }).puntuacion, null)
  })
})

describe('puntuarNoticias', () => {
  const ahora = 100 * HORA
  /** @param {string} id @param {number} edadH @param {string[]} monedas @param {number|null} p @param {'rss'|'reddit'} [origen] */
  const t = (id, edadH, monedas, p, origen = 'rss') => ({ id, origen, publicadoEn: ahora - edadH * HORA, monedas, puntuacion: p })
  test('menos de 3 titulares relevantes: ausente', () => {
    const r = puntuarNoticias([t('a', 1, ['BTC'], 1), t('b', 1, ['BTC'], 1), t('c', 1, ['ETH'], 1)], 'BTC', ahora)
    assert.equal(r.puntuacion, null)
  })
  test('ignora > 24 h, futuros, sin puntuar y de otras monedas', () => {
    const r = puntuarNoticias([
      t('a', 1, ['BTC'], 1), t('b', 2, ['BTC'], 1), t('c', 3, ['BTC'], 1),
      t('viejo', 25, ['BTC'], -1), t('futuro', -1, ['BTC'], -1), t('nulo', 1, ['BTC'], null), t('eth', 1, ['ETH'], -1),
    ], 'BTC', ahora)
    assert.deepEqual(r.usados, ['a', 'b', 'c'])
    assert.equal(r.puntuacion, 1)
  })
  test('pondera por antigüedad, mercado ×0,5 y reddit ×0,5', () => {
    const r = puntuarNoticias([t('a', 0, ['BTC'], 1), t('b', 0, ['MERCADO'], -1), t('c', 0, ['BTC'], -1, 'reddit')], 'BTC', ahora)
    // pesos 1, 0,5, 0,5 → (1 − 0,5 − 0,5) / 2 = 0
    assert.equal(r.puntuacion, 0)
  })
})

describe('puntuarFng', () => {
  test('solo extremos, a la contra', () => {
    assert.equal(puntuarFng(19), 0.5)
    assert.equal(puntuarFng(20), 0)
    assert.equal(puntuarFng(80), 0)
    assert.equal(puntuarFng(81), -0.5)
    assert.equal(puntuarFng(null), null)
  })
})

describe('combinar', () => {
  const base = { derivados: null, noticias: null, fng: null, alineacion: false }
  test('umbral exacto de compra y venta (solo técnico, renormalizado)', () => {
    assert.equal(combinar({ ...base, tecnico: 0.35 }).veredicto, 'COMPRAR')
    assert.equal(combinar({ ...base, tecnico: 0.349 }).veredicto, 'MANTENER')
    assert.equal(combinar({ ...base, tecnico: -0.35 }).veredicto, 'VENDER')
  })
  test('renormaliza pesos y lista ausentes', () => {
    const r = combinar({ ...base, tecnico: 0.5, fng: -0.5 })
    // (0,6·0,5 − 0,05·0,5) / 0,65
    assert.ok(Math.abs(r.puntuacion - 0.275 / 0.65) < 1e-9)
    assert.deepEqual(r.ausentes, ['derivados', 'noticias'])
  })
  test('contradicción en su umbral exacto fuerza MANTENER', () => {
    const r = combinar({ ...base, tecnico: 0.9, derivados: -0.5 })
    assert.equal(r.veredicto, 'MANTENER')
    assert.equal(r.motivo, 'contradiccion_tecnico_derivados')
  })
  test('por debajo del umbral de contradicción no se fuerza', () => {
    assert.equal(combinar({ ...base, tecnico: 0.9, derivados: -0.49 }).motivo, null)
    assert.equal(combinar({ ...base, tecnico: 0.29, derivados: -1 }).motivo, null)
  })
  test('índice de confianza: 0,4 + 0,5·|S| + 0,1 alineación, máx. 0,95', () => {
    assert.equal(combinar({ ...base, tecnico: 0.4 }).indiceConfianza, 0.6)
    assert.equal(combinar({ ...base, tecnico: 0.4, alineacion: true }).indiceConfianza, 0.7)
    assert.equal(combinar({ ...base, tecnico: 1, alineacion: true }).indiceConfianza, 0.95)
  })
})

describe('calcularSenal', () => {
  const ahora = 600 * HORA + 3 * 60_000
  // cada serie de 300 velas termina justo a las 600 h
  const subida = (/** @type {number} */ dur) => serie(300, (i) => 100 * 1.002 ** i, { duracion: dur, inicio: 600 * HORA - 300 * dur })
  const velas = { '1h': subida(HORA), '4h': subida(4 * HORA), '1d': subida(24 * HORA) }
  const entrada = { simbolo: 'BTC', ahora, velas, derivados: null, titulares: [], fng: null }

  test('versión, vela y precio de la última vela 1H cerrada', () => {
    const s = calcularSenal(entrada)
    assert.equal(s.version, VERSION)
    assert.equal(s.vela1h, 599 * HORA)
    assert.equal(s.fresca, true)
    assert.ok(/** @type {number} */ (s.componentes.tecnico) > 0)
    assert.ok(/** @type {number} */ (s.atrPct) > 0)
  })
  test('sin velas suficientes: SIN_DATOS', () => {
    const s = calcularSenal({ ...entrada, velas: { ...velas, '1d': velas['1d'].slice(0, 100) } })
    assert.equal(s.veredicto, 'SIN_DATOS')
    assert.equal(s.motivo, 'velas_insuficientes')
  })
  test('sin información futura: añadir velas no cerradas no cambia la señal', () => {
    const futuro = (/** @type {import('../core/velas.js').Vela[]} */ v) => [
      ...v, { ...v[v.length - 1], inicio: 1e15, fin: 1e15 + 1, cierre: 1e9, maximo: 1e9, minimo: 1, apertura: 1 },
    ]
    const conFuturo = { '1h': futuro(velas['1h']), '4h': futuro(velas['4h']), '1d': futuro(velas['1d']) }
    assert.deepEqual(calcularSenal({ ...entrada, velas: conFuturo }), calcularSenal(entrada))
  })
})

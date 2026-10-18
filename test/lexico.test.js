// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  ALIAS_MONEDAS, NEGATIVAS, POSITIVAS, analizarTitular, detectarMonedas, normalizarTexto, puntuarTitular,
} from '../core/lexico.js'

describe('normalizarTexto', () => {
  test('minúsculas, sin acentos, signos como espacios y rodeado de espacios', () => {
    assert.equal(normalizarTexto('¡Bitcoin marca MÁXIMO histórico!'), ' bitcoin marca maximo historico ')
    assert.equal(normalizarTexto('$BTC/ETH all-time high'), ' btc eth all time high ')
    assert.equal(normalizarTexto('   '), '  ')
  })
})

describe('detectarMonedas', () => {
  test('reconoce cada alias como palabra completa, en el orden BTC, ETH, SOL, BNB, XRP', () => {
    assert.deepEqual(detectarMonedas('XRP and Bitcoin rally'), ['BTC', 'XRP'])
    assert.deepEqual(detectarMonedas('Ether ETFs see inflows'), ['ETH'])
    assert.deepEqual(detectarMonedas('Ethereum gas fees fall'), ['ETH'])
    assert.deepEqual(detectarMonedas('Solana Ecosystem News - October 18-2026'), ['SOL'])
    assert.deepEqual(detectarMonedas('SOL breaks out'), ['SOL'])
    assert.deepEqual(detectarMonedas('Binance Coin hits record'), ['BNB'])
    assert.deepEqual(detectarMonedas('BNB Chain upgrade goes live'), ['BNB'])
    assert.deepEqual(detectarMonedas('Ripple wins appeal'), ['XRP'])
    assert.deepEqual(detectarMonedas("Bitcoin's Quantum Transition Won't Stop at Bitcoin"), ['BTC'])
    assert.deepEqual(detectarMonedas('$btc and $eth'), ['BTC', 'ETH'])
  })

  test('no confunde palabras que solo contienen el alias', () => {
    assert.deepEqual(detectarMonedas('Tether mints 1B USDT'), [])
    assert.deepEqual(detectarMonedas('Solar-powered mining farm opens'), [])
    assert.deepEqual(detectarMonedas('Binance lists a new token'), [])
  })

  test('todas las monedas tienen al menos un alias', () => {
    for (const alias of Object.values(ALIAS_MONEDAS)) assert.ok(alias.length > 0)
  })
})

describe('puntuarTitular', () => {
  test('un término vale ±0,5; dos del mismo signo ±1; uno de cada, 0', () => {
    assert.equal(puntuarTitular('Bitcoin rally continues'), 0.5)
    assert.equal(puntuarTitular('Ethereum hacked, funds stolen'), -1)
    assert.equal(puntuarTitular('XRP surges after SEC approval'), 1)
    assert.equal(puntuarTitular('BTC drops then rebound'), 0)
    assert.equal(puntuarTitular('Here’s what happened in crypto today'), 0)
  })

  test('titular real con dos términos negativos', () => {
    assert.equal(puntuarTitular('Cysic crypto bridge halted after unauthorized mint of 10M CYS'), -1)
  })

  test('tres positivos y uno negativo: (3 − 1) / 4', () => {
    assert.equal(puntuarTitular('Bitcoin surges, rally and breakout despite liquidations'), 0.5)
  })

  test('español sin acentos ni mayúsculas importantes', () => {
    assert.equal(puntuarTitular('Bitcoin se DESPLOMA tras el hackeo'), -1)
    assert.equal(puntuarTitular('Solana marca máximo histórico'), 0.5)
  })

  test('siempre en [-1, 1] aunque el titular contenga todos los términos', () => {
    assert.equal(puntuarTitular(POSITIVAS.join(' ')), 1)
    assert.equal(puntuarTitular(NEGATIVAS.join(' ')), -1)
    const mezcla = puntuarTitular([...POSITIVAS, ...NEGATIVAS].join(' '))
    assert.ok(mezcla >= -1 && mezcla <= 1)
  })
})

describe('analizarTitular', () => {
  test('con monedas reconocidas devuelve esas monedas', () => {
    assert.deepEqual(analizarTitular('Bitcoin and Ether rally'), { puntuacion: 0.5, monedas: ['BTC', 'ETH'] })
  })

  test('sin monedas reconocidas cuenta como MERCADO', () => {
    assert.deepEqual(analizarTitular('Crypto market crash wipes out longs'), { puntuacion: -0.5, monedas: ['MERCADO'] })
  })
})

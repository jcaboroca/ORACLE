// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { API_LOCAL, API_PRODUCCION, baseApi } from '../../config.js'
import {
  VACIO, claseSigno, entero, euros, fecha, fechaHora, hace, hora, leerImporte, numero, porcentaje, precio,
} from '../../js/formato.js'

const ESP = '\u00a0'
// 2026-10-18 22:07:08 UTC = 19/10/2026 00:07 en Madrid (horario de verano)
const T = 1792361228071

describe('formatos es-ES', () => {
  test('euros con 2 decimales, miles con punto desde 5 cifras y signo opcional', () => {
    assert.equal(euros(1234.5), `1234,50${ESP}€`)
    assert.equal(euros(72461.88), `72.461,88${ESP}€`)
    assert.equal(euros(-1851.0899), `-1851,09${ESP}€`)
    assert.equal(euros(58.02, { signo: true }), `+58,02${ESP}€`)
    assert.equal(euros(0, { signo: true }), `0,00${ESP}€`)
  })

  test('precio: 2 decimales desde 1 € y 4 por debajo', () => {
    assert.equal(precio(62943.42), `62.943,42${ESP}€`)
    assert.equal(precio(0.52341), `0,5234${ESP}€`)
  })

  test('porcentaje desde fracción, con signo y decimales', () => {
    assert.equal(porcentaje(0.05), `5,00${ESP}%`)
    assert.equal(porcentaje(-0.185108990116729, { signo: true }), `-18,51${ESP}%`)
    assert.equal(porcentaje(0.004356209264924971, { signo: true }), `+0,44${ESP}%`)
    assert.equal(porcentaje(0.422523733, { decimales: 0 }), `42${ESP}%`)
  })

  test('números y enteros', () => {
    assert.equal(numero(6.885324504823335, 1), '6,9')
    assert.equal(numero(0.045047465, 2, { signo: true }), '+0,05')
    assert.equal(numero(-0.35, 2, { signo: true }), '-0,35')
    assert.equal(entero(62621), '62.621')
    assert.equal(entero(718), '718')
  })

  test('dato ausente → raya, nunca 0', () => {
    for (const f of [euros, precio, porcentaje, numero, entero, fechaHora, fecha, hora]) {
      assert.equal(f(null), VACIO)
      assert.equal(f(undefined), VACIO)
    }
    assert.equal(euros(Number.NaN), VACIO)
    assert.equal(hace(null, T), VACIO)
  })

  test('fechas en hora de Madrid', () => {
    assert.equal(fechaHora(T), '19/10/2026, 00:07')
    assert.equal(fecha(1729285200000), '18/10/2024')
    assert.equal(hora(T), '00:07')
  })

  test('hace: minutos, horas y días', () => {
    assert.equal(hace(T - 30_000, T), 'ahora mismo')
    assert.equal(hace(T + 60_000, T), 'ahora mismo')
    assert.equal(hace(T - 5 * 60_000, T), 'hace 5 min')
    assert.equal(hace(T - 3 * 3_600_000 - 1, T), 'hace 3 h')
    assert.equal(hace(T - 24 * 3_600_000, T), 'hace 1 día')
    assert.equal(hace(T - 50 * 3_600_000, T), 'hace 2 días')
  })

  test('claseSigno', () => {
    assert.equal(claseSigno(0.1), 'sube')
    assert.equal(claseSigno(-2), 'baja')
    assert.equal(claseSigno(0), 'neutro')
    assert.equal(claseSigno(null), 'neutro')
  })

  test('leerImporte entiende el formato español y rechaza lo demás', () => {
    assert.equal(leerImporte('10.000'), 10000)
    assert.equal(leerImporte(' 10000 € '), 10000)
    assert.equal(leerImporte('2500,5'), 2500.5)
    assert.equal(leerImporte('1.000.000'), 1000000)
    for (const malo of ['', 'abc', '10.00', '1,000.5', '-5', '1e4']) assert.equal(leerImporte(malo), null, malo)
  })
})

describe('config', () => {
  test('en localhost usa el Worker local; fuera, el desplegado sin barra final', () => {
    assert.equal(baseApi({ hostname: 'localhost' }), API_LOCAL)
    assert.equal(baseApi({ hostname: '127.0.0.1' }), API_LOCAL)
    assert.equal(baseApi({ hostname: 'jcaboroca.github.io' }, 'https://oracle.x.workers.dev/'), 'https://oracle.x.workers.dev')
    assert.equal(baseApi({ hostname: 'jcaboroca.github.io' }, ''), '')
    assert.equal(baseApi({ hostname: 'jcaboroca.github.io' }), 'https://oracle.mundialisimo.workers.dev')
    assert.equal(API_PRODUCCION, 'https://oracle.mundialisimo.workers.dev')
  })
})

// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../../core/estrategias.js'
import {
  AVISO_FUTURO, cargarLaboratorio, filasReservado, lecturaLaboratorio, reservadoPorVersion, textoConfig, textoTramos,
} from '../../js/laboratorio.js'
import { LABORATORIO, VERSIONES, textoPestana } from '../../js/vistas/backtest.js'
import { leer } from './modulos.js'

const ESP = '\u00a0'
/** Datos INVENTADOS con la forma de data/laboratorio.json (marcados `sintetico: true`): solo para tests. */
const LAB = JSON.parse(readFileSync(new URL('./fixtures/laboratorio.json', import.meta.url), 'utf8'))
/** El mismo documento sin la marca, como lo escribiría scripts/laboratorio.mjs. */
const { sintetico: _, ...REAL } = LAB

describe('pestaña Laboratorio', () => {
  test('data/laboratorio.json relativo a la página; 404 = aún no ejecutado (null); otro error lanza', async () => {
    /** @type {string[]} */
    const pedidas = []
    /** @param {number} estado @param {unknown} [cuerpo] @returns {typeof fetch} */
    const responder = (estado, cuerpo = REAL) => async (url) => {
      pedidas.push(String(url))
      return new Response(estado === 200 ? JSON.stringify(cuerpo) : 'x', { status: estado })
    }
    assert.deepEqual(await cargarLaboratorio(responder(200)), REAL)
    assert.equal(await cargarLaboratorio(responder(404)), null)
    await assert.rejects(cargarLaboratorio(responder(500)), /^Error: data\/laboratorio\.json: HTTP 500$/)
    assert.deepEqual(pedidas, ['data/laboratorio.json', 'data/laboratorio.json', 'data/laboratorio.json'])
  })

  test('los datos sintéticos de los tests nunca se enseñan, aunque se copien a data/', async () => {
    assert.equal(LAB.sintetico, true)
    const fetch = /** @type {typeof globalThis.fetch} */ (async () => new Response(JSON.stringify(LAB)))
    await assert.rejects(cargarLaboratorio(fetch), /^Error: data\/laboratorio\.json: son datos sintéticos de prueba y no se muestran$/)
  })

  test('ranking, criterio punto por punto, años, monedas, selección y tramo reservado', () => {
    const l = lecturaLaboratorio(LAB)
    assert.match(l.generado, /^21\/10\/2026, 10:00$/)
    assert.equal(l.datosHasta, '21/10/2026')
    assert.equal(l.aviso, `Datos sintéticos de prueba con la forma de data/laboratorio.json. ${AVISO_FUTURO}`)
    assert.deepEqual(l.criterio, ['Rentabilidad encadenada > 0', 'Caída ≤ 0,6 × la de comprar y mantener'])
    assert.equal(l.tramos, '2020, 2021', 'solo los años de prueba')
    assert.equal(l.familias, 3)
    assert.equal(l.ganadoras, 1)
    const [primero, segundo, tercero] = l.ranking
    assert.deepEqual({ ...primero, puntos: undefined, porAno: undefined, porMoneda: undefined }, {
      posicion: 1, familia: 'F2 Ruptura de Donchian 1D', version: 'v3', experimental: false, operaciones: '42', config: 'entrada 55 · salida 20 · stop no',
      rentabilidad: `+123,45${ESP}%`, claseRentabilidad: 'sube', caida: `-25,00${ESP}%`, rentabilidadHodl: `+250,00${ESP}%`,
      caidaHodl: `-60,00${ESP}%`, cumple: true, textoCumple: 'Cumple', puntos: undefined, porAno: undefined, porMoneda: undefined,
    })
    assert.deepEqual(primero.puntos, [
      { texto: 'Rentabilidad encadenada > 0', cumple: true, marca: '✓ Cumple' },
      { texto: 'Caída ≤ 0,6 × la de comprar y mantener', cumple: true, marca: '✓ Cumple' },
    ])
    assert.deepEqual(primero.porAno, [
      { ano: '2020', rentabilidad: `+80,00${ESP}%`, hodl: `+150,00${ESP}%`, clase: 'sube' },
      { ano: '2021', rentabilidad: `-5,00${ESP}%`, hodl: `+90,00${ESP}%`, clase: 'baja' },
    ])
    assert.deepEqual(primero.porMoneda, [
      { simbolo: 'BTC', beneficio: `+1234,50${ESP}€`, positivo: 'Sí', clase: 'sube' },
      { simbolo: 'ETH', beneficio: `-10,00${ESP}€`, positivo: 'No', clase: 'baja' },
    ])
    assert.deepEqual([segundo.familia, segundo.version, segundo.experimental, segundo.config, segundo.caida, segundo.rentabilidadHodl, segundo.textoCumple],
      ['F1 Cruce de medias 1D', 'v4', true, 'rápida 20 · lenta 100 · stop 2,5', `0,00${ESP}%`, '—', 'No cumple'])
    assert.deepEqual([tercero.familia, tercero.version, tercero.experimental, tercero.config], ['inventada', '', false, 'a mano'])
    assert.equal(l.conclusion, 'Solo v3 (F2 Ruptura de Donchian 1D) cumple todos los puntos del criterio. '
      + 'v4 va al bot como experimental para completar las 2 en vivo: no lo cumple.')
    assert.deepEqual(l.seleccion, [
      { version: 'v3', texto: 'v3 · F2 Ruptura de Donchian 1D · entrada 55 · salida 20 · stop no', experimental: false, cumple: true },
      { version: 'v4', texto: 'v4 · F1 Cruce de medias 1D · rápida 20 · lenta 100 · stop 2,5', experimental: true, cumple: false },
    ])
    assert.deepEqual(l.reservado, [
      { etiqueta: 'Desde', valor: '01/01/2026' },
      { etiqueta: 'Hasta', valor: '21/10/2026' },
      { etiqueta: 'Monedas', valor: 'BTC, ETH' },
    ])
    assert.deepEqual(l.reservadoPorVersion, [
      { version: 'v3', experimental: false, rentabilidad: `+12,00${ESP}%`, clase: 'sube', caida: `-8,00${ESP}%`, operaciones: '14',
        rentabilidadHodl: `-10,00${ESP}%`, caidaHodl: `-30,00${ESP}%` },
      { version: 'v4', experimental: true, rentabilidad: `-2,00${ESP}%`, clase: 'baja', caida: `-5,00${ESP}%`, operaciones: '3',
        rentabilidadHodl: '—', caidaHodl: '—' },
    ])
  })

  test('el data/laboratorio.json real: criterio, años, ranking, selección con sus experimentales y tramo reservado', () => {
    const crudo = JSON.parse(leer('data/laboratorio.json'))
    const l = lecturaLaboratorio(crudo)
    assert.equal(l.aviso.split('Un resultado del pasado no garantiza el futuro').length - 1, 1, 'el aviso no se repite')
    assert.deepEqual(l.criterio, crudo.criterio.map((/** @type {any} */ c) => c.texto))
    assert.equal(l.tramos, crudo.tramos.filter((/** @type {any} */ t) => t.prueba).map((/** @type {any} */ t) => t.ano).join(', '))
    assert.notEqual(l.datosHasta, '—')
    assert.equal(l.ranking.length, crudo.ranking.length)
    for (const p of l.ranking) {
      assert.ok(!p.rentabilidad.includes('—') && !p.caida.includes('—') && p.config && !/^[a-z0-9]+$/.test(p.familia), p.familia)
      assert.equal(p.puntos.length, crudo.criterio.length, p.familia)
    }
    const ganadoras = crudo.ranking.filter((/** @type {any} */ r) => r.criterio.cumple)
    assert.equal(l.ganadoras, ganadoras.length)
    assert.deepEqual(l.seleccion.map((x) => x.version), ESTRATEGIAS_EN_VIVO)
    for (const x of l.seleccion) {
      assert.equal(x.experimental, x.cumple !== true, `${x.version}: experimental si y solo si no cumple`)
      assert.equal(l.ranking.find((p) => p.version === x.version)?.experimental, x.experimental, x.version)
    }
    for (const v of l.seleccion.filter((x) => x.experimental).map((x) => x.version)) assert.match(l.conclusion, new RegExp(`\\b${v}\\b`))
    assert.match(l.conclusion, ganadoras.length === 1 ? /^Solo v\d+ \(.+\) cumple todos los puntos del criterio\./ : /criterio/)
    assert.deepEqual(l.reservadoPorVersion.map((x) => x.version), ESTRATEGIAS_EN_VIVO)
    assert.ok(l.reservadoPorVersion.every((x) => x.rentabilidad !== '—' && x.operaciones !== '—'))
    assert.deepEqual(l.reservado.map((x) => x.etiqueta), ['Desde', 'Hasta', 'Monedas'])
  })

  test('defensiva: nada de lo que falte o venga con otro tipo rompe la lectura', () => {
    for (const raro of [null, 'texto', [], 42, { ranking: 'x', familias: 3, tramos: {}, seleccion: [null, 3], reservado: [] }]) {
      const l = lecturaLaboratorio(raro)
      assert.deepEqual([l.ranking, l.seleccion, l.reservado, l.familias, l.ganadoras, l.generado, l.tramos], [[], [], [], 0, 0, '—', '—'])
      assert.deepEqual([l.criterio, l.reservadoPorVersion, l.conclusion, l.datosHasta], [[], [], '', '—'])
      assert.equal(l.aviso, AVISO_FUTURO)
    }
    assert.deepEqual(lecturaLaboratorio({ criterio: [3, null, { texto: 'a' }, 'b', { id: 'c' }] }).criterio, ['a', 'b'])
    assert.deepEqual(lecturaLaboratorio({ criterio: 'Las 5 condiciones' }).criterio, ['Las 5 condiciones'])
    assert.deepEqual(lecturaLaboratorio({ seleccion: ['v3', { version: 'v4', experimental: 'sí' }, {}] }).seleccion, [
      { version: 'v3', texto: 'v3', experimental: false, cumple: null }, { version: 'v4', texto: 'v4', experimental: false, cumple: null },
    ])
    const l = lecturaLaboratorio({ ranking: [null, 7, { oos: 'x', criterio: { puntos: [3, { cumple: 'sí' }] } }, { oos: { porAno: [{ ano: {} }], porMoneda: [] } }] })
    assert.equal(l.ranking.length, 2)
    assert.deepEqual([l.ranking[0].familia, l.ranking[0].rentabilidad, l.ranking[0].textoCumple], ['Familia 1', '—', '—'])
    assert.deepEqual(l.ranking[0].puntos, [{ texto: '—', cumple: false, marca: '—' }])
    assert.deepEqual(l.ranking[1].porAno, [{ ano: '—', rentabilidad: '—', hodl: '—', clase: 'neutro' }])
    assert.deepEqual(l.ranking[1].porMoneda, [])
    assert.equal(lecturaLaboratorio({ aviso: `Ojo. ${AVISO_FUTURO}` }).aviso, `Ojo. ${AVISO_FUTURO}`, 'no repite el aviso')
  })

  test('textoConfig, textoTramos y filasReservado', () => {
    assert.equal(textoConfig({ l: 30, revision: 'semanal', tp: null, sl: true, x: {} }), 'l 30 · revisión semanal · tp no · sl sí')
    assert.equal(textoConfig({ multStopLoss: 2.5, takeProfit: null, umbralRsi: 5, dias: 10 }), 'stop-loss × ATR 2,5 · take-profit × ATR no · umbral RSI(2) 5 · días 10')
    assert.equal(textoConfig(7), '')
    assert.equal(textoTramos([2020, '2021', { ano: 2022 }, { prueba: { desde: 1 } }, null]), '2020, 2021, 2022')
    assert.equal(textoTramos([{ ano: 2019, prueba: false }, { ano: 2020, prueba: true }, { ano: 2021, prueba: true }]), '2020, 2021')
    assert.equal(textoTramos('2020'), '')
    assert.deepEqual(filasReservado({ hasta: 5, caida: 0.1, rentabilidadHodl: -0.2, operaciones: 7, notas: ['a', 3], porVersion: { v3: {} }, otro: { x: 1 } }), [
      { etiqueta: 'Hasta', valor: '5,00' }, { etiqueta: 'caida', valor: `-10,00${ESP}%` }, { etiqueta: 'rentabilidadHodl', valor: `-20,00${ESP}%` },
      { etiqueta: 'operaciones', valor: '7' }, { etiqueta: 'otro · x', valor: '1,00' },
    ])
    assert.deepEqual(reservadoPorVersion({ porVersion: { v9: { rentabilidad: 'x' }, v8: 3 } }), [
      { version: 'v9', experimental: false, rentabilidad: '—', clase: 'neutro', caida: '—', operaciones: '—', rentabilidadHodl: '—', caidaHodl: '—' },
    ])
    assert.deepEqual(reservadoPorVersion(null), [])
    assert.deepEqual(filasReservado('x'), [])
  })

  test('pestañas: una por estrategia registrada más «Laboratorio»; la principal y las de en vivo, marcadas', () => {
    assert.deepEqual(VERSIONES, Object.keys(ESTRATEGIAS))
    assert.equal(LABORATORIO, 'laboratorio')
    assert.equal(textoPestana(ESTRATEGIA_PRINCIPAL), `${ESTRATEGIA_PRINCIPAL} (principal)`)
    for (const v of VERSIONES) {
      if (v !== ESTRATEGIA_PRINCIPAL) assert.equal(textoPestana(v), ESTRATEGIAS_EN_VIVO.includes(v) ? `${v} (en vivo)` : v)
    }
    const fuente = leer('js/vistas/backtest.js')
    assert.match(fuente, /Laboratorio aún no ejecutado/)
    assert.match(fuente, /cargarLaboratorio\(ctx\.fetch\)/)
    assert.doesNotMatch(fuente, /ESTRATEGIA_ACTIVA/)
    assert.match(fuente, /parametros\?\.estrategia\?\.familia/, 'las estrategias del laboratorio se rotulan «solo técnico», sin pesos ni Fear & Greed')
    assert.match(fuente, /insignia insignia-experimental/)
  })

  test('ranking, años, monedas y reservado: todas las tablas del Laboratorio son apilables (tarjetas en el móvil)', () => {
    const fuente = leer('js/vistas/backtest.js')
    const laboratorio = fuente.slice(fuente.indexOf('async function vistaLaboratorio'), fuente.indexOf('export async function vistaBacktest'))
    assert.equal(laboratorio.split('tabla({').length - 1, 4)
    assert.equal(laboratorio.split('apilable: true').length - 1, 4)
  })
})

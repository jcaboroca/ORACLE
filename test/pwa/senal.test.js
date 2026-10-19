// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { crearApi } from '../../js/api.js'
import {
  COMPONENTES, MOTIVOS, VIEJA_MS, barrasComponentes, filaDecision, filasTimeframes, lecturaFng, lecturaTitular,
  orientativo, puntoArco, tarjetaMoneda, textoMotivo, textoMotor, urlSegura, veredicto,
} from '../../js/senal.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'

const ESP = '\u00a0'

/** Señal y resumen reales del Worker sobre el escenario de sus tests. */
async function datosReales() {
  const w = await workerSimulado()
  const api = crearApi({ base: BASE, fetch: w.fetch, pin: () => PIN })
  return { w, resumen: await api.resumen(), moneda: await api.moneda('BTC') }
}

describe('señal en la interfaz', () => {
  test('veredictos en español con clase de color, y uno desconocido sin romper', () => {
    assert.deepEqual(veredicto('COMPRAR'), { texto: 'Comprar', clase: 'comprar' })
    assert.deepEqual(veredicto('SIN_DATOS'), { texto: 'Sin datos', clase: 'sin-datos' })
    assert.deepEqual(veredicto('OTRO'), { texto: 'OTRO', clase: 'sin-datos' })
  })

  test('barras T/D/N/F de una señal real: ausentes marcados y pesos renormalizados', async () => {
    const { moneda } = await datosReales()
    assert.deepEqual(moneda.senal.ausentes, ['derivados', 'noticias'])
    const barras = barrasComponentes(moneda.senal)
    assert.deepEqual(barras.map((b) => b.letra), COMPONENTES.map((c) => c.letra))
    const [t, d, n, f] = barras
    assert.deepEqual([t.ausente, d.ausente, n.ausente, f.ausente], [false, true, true, false])
    assert.deepEqual([d.valor, d.texto, d.ancho, d.pesoEfectivo], [null, 'ausente', 0, 0])
    assert.equal(t.valor, 0.5)
    assert.equal(t.texto, '+0,50')
    assert.equal(t.sentido, 'positivo')
    assert.equal(f.sentido, 'neutro')
    assert.equal(t.peso, 0.6)
    assert.ok(Math.abs(t.pesoEfectivo - 0.6 / 0.65) < 1e-12)
    assert.ok(Math.abs(f.pesoEfectivo - 0.05 / 0.65) < 1e-12)
  })

  test('SIN_DATOS: sin técnico todo ausente y ningún peso efectivo', () => {
    const barras = barrasComponentes({
      version: 'v1', veredicto: 'SIN_DATOS', ausentes: ['tecnico'], componentes: { tecnico: null, derivados: null, noticias: null, fng: null },
    })
    assert.ok(barras.every((b) => b.ausente && b.pesoEfectivo === 0))
  })

  test('valores negativos y fuera de rango: barra recortada a 1', () => {
    const [t, d] = barrasComponentes({ version: 'v2', ausentes: [], componentes: { tecnico: -0.42, derivados: -1.2, noticias: 0.1, fng: 0.5 } })
    assert.deepEqual([t.sentido, t.ancho, t.texto], ['negativo', 0.42, '-0,42'])
    assert.equal(d.ancho, 1)
  })

  test('tarjeta del Panel con el resumen real, relativa a la hora del servidor', async () => {
    const { resumen } = await datosReales()
    const c = tarjetaMoneda(resumen.senales[0], resumen.ahora)
    assert.equal(c.simbolo, 'BTC')
    assert.equal(c.precio, `99,85${ESP}€`)
    assert.equal(c.cambio, `+4,91${ESP}%`)
    assert.equal(c.claseCambio, 'sube')
    assert.deepEqual([c.veredicto, c.claseVeredicto], ['Comprar', 'comprar'])
    assert.equal(c.confianza, `73${ESP}%`)
    assert.equal(c.puntuacion, '+0,46')
    assert.equal(c.frase, 'Señal de compra en BTC (puntuación 0,46, confianza 73 %, sin calibrar).')
    assert.equal(c.actualizada, 'hace 1 h')
    assert.equal(c.desactualizada, false)
  })

  test('tarjeta desactualizada si la señal no es fresca o tiene más de 2 h; precio ausente → raya', () => {
    const s = { simbolo: 'SOL', veredicto: 'SIN_DATOS', indiceConfianza: null, puntuacion: null, precioEur: null, cambio24h: null, fresca: true, calculadaEn: 0, frase: '' }
    assert.equal(tarjetaMoneda(s, VIEJA_MS).desactualizada, false)
    assert.equal(tarjetaMoneda(s, VIEJA_MS + 1).desactualizada, true)
    assert.equal(tarjetaMoneda({ ...s, fresca: false }, 0).desactualizada, true)
    const c = tarjetaMoneda(s, 0)
    assert.deepEqual([c.precio, c.cambio, c.confianza, c.frase], ['—', '—', '—', 'Sin explicación.'])
  })

  test('Fear & Greed: traducción, color, aviso de extremos y arco del medidor', async () => {
    const { resumen } = await datosReales()
    const f = /** @type {NonNullable<ReturnType<typeof lecturaFng>>} */ (lecturaFng(resumen.fng))
    assert.deepEqual([f.valor, f.texto, f.clase, f.cuenta], [53, 'Neutral', 'neutral', false])
    assert.equal(lecturaFng({ valor: 12, clasificacion: 'Extreme Fear', t: 0 })?.texto, 'Miedo extremo')
    assert.equal(lecturaFng({ valor: 12, clasificacion: 'Extreme Fear', t: 0 })?.cuenta, true)
    assert.equal(lecturaFng({ valor: 85, clasificacion: 'Extreme Greed', t: 0 })?.clase, 'codicia-extrema')
    assert.equal(lecturaFng(null), null)
    const cerca = (/** @type {{x: number, y: number}} */ p, /** @type {number} */ x, /** @type {number} */ y) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9
    assert.ok(cerca(puntoArco(0, 100, 100, 80), 20, 100))
    assert.ok(cerca(puntoArco(50, 100, 100, 80), 100, 20))
    assert.ok(cerca(puntoArco(100, 100, 100, 80), 180, 100))
    assert.ok(cerca(puntoArco(150, 100, 100, 80), 180, 100))
  })

  test('temporalidades y SL/TP orientativos de la señal real', async () => {
    const { moneda } = await datosReales()
    const filas = filasTimeframes(moneda.senal)
    assert.deepEqual(filas.map((f) => f.tf), ['1D', '4H', '1H'])
    assert.deepEqual([filas[2].tendencia, filas[2].rsi, filas[2].puntuacion, filas[2].ema200], ['alcista', '100,0', '+0,50', 'por encima'])
    assert.equal(filasTimeframes({ detalle: { timeframes: { '1h': null } } })[2].ausente, true)
    assert.deepEqual(orientativo(moneda.senal), { stopLoss: `96,65${ESP}€`, takeProfit: `105,20${ESP}€` })
    assert.equal(orientativo({ orientativo: null }), null)
  })

  test('historial de decisiones real: ejecutadas y no ejecutadas con motivo legible', async () => {
    const { moneda } = await datosReales()
    const [abrir, enfriamiento] = moneda.decisiones.map(filaDecision)
    assert.deepEqual([abrir.accion, abrir.ejecutada, abrir.motivo], ['Abrir', true, 'Abrió posición'])
    assert.deepEqual([enfriamiento.accion, enfriamiento.ejecutada, enfriamiento.motivo], ['Ninguna', false, 'Enfriamiento tras un stop-loss'])
    assert.match(abrir.cuando, /^\d\d\/\d\d\/\d{4}, \d\d:\d\d$/)
  })

  test('todo el vocabulario de decisiones.motivo tiene texto (spec §7.2)', () => {
    for (const m of ['abierta', 'cerrada', 'mantener', 'contradiccion_tecnico_derivados', 'filtro_regimen', 'sin_posicion',
      'ya_en_posicion', 'confianza_baja', 'saldo_insuficiente', 'datos_desactualizados', 'sin_datos', 'enfriamiento',
      'cerrada_por_stop', 'fuera_de_ventana']) {
      assert.ok(MOTIVOS[m], m)
    }
    assert.equal(textoMotivo('nuevo_motivo'), 'nuevo_motivo')
    assert.equal(textoMotivo(null), '—')
  })

  test('titulares: motor, origen, puntuación y solo enlaces http(s)', () => {
    const t = lecturaTitular({
      id: 'a', fuente: 'r/Bitcoin', origen: 'reddit', titulo: 'BTC sube', url: 'javascript:alert(1)', publicadoEn: 0,
      monedas: ['BTC'], puntuacion: -0.25, motor: 'lexico', usado: true,
    }, 3 * 3_600_000)
    assert.deepEqual([t.origen, t.url, t.puntuacion, t.clase, t.motor, t.usado, t.cuando, t.monedas],
      ['Reddit', null, '-0,25', 'baja', 'Léxico local', true, 'hace 3 h', 'BTC'])
    assert.equal(urlSegura('https://x.test/a'), 'https://x.test/a')
    assert.equal(textoMotor('cf'), 'Workers AI')
    assert.equal(textoMotor(null), 'Sin puntuar')
  })
})

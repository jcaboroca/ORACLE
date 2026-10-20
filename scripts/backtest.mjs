// @ts-check
// npm run backtest -- [--estrategia v1] [--desde AAAA-MM-DD] [--hasta AAAA-MM-DD] [--monedas BTC,ETH] [--capital 10000]
// Descarga histórico real de Binance y Fear & Greed (con caché local) y ejecuta core/backtest.js.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { ejecutarBacktest } from '../core/backtest.js'
import { ESTRATEGIA_ACTIVA, estrategia as obtenerEstrategia } from '../core/estrategias.js'
import { HORA } from '../core/velas.js'
import { DIA, RAIZ, descargarFng, descargarVelas } from './datos.mjs'

const { values } = parseArgs({
  options: {
    desde: { type: 'string' },
    hasta: { type: 'string' },
    monedas: { type: 'string', default: 'BTC,ETH,SOL,BNB,XRP' },
    capital: { type: 'string', default: '10000' },
    estrategia: { type: 'string', default: ESTRATEGIA_ACTIVA },
  },
})
const estrategia = obtenerEstrategia(values.estrategia)
const hasta = values.hasta ? Date.parse(`${values.hasta}T00:00:00Z`) : Math.floor(Date.now() / HORA) * HORA
const desde = values.desde ? Date.parse(`${values.desde}T00:00:00Z`) : hasta - 730 * DIA
const monedas = values.monedas.split(',').map((m) => m.trim().toUpperCase())
const capitalInicial = Number(values.capital)

console.log(`Backtest ${estrategia.VERSION} · ${new Date(desde).toISOString().slice(0, 10)} → ${new Date(hasta).toISOString().slice(0, 10)} · ${monedas.join(', ')}`)
/** @type {Record<string, import('../core/backtest.js').SerieMoneda>} */
const series = {}
for (const m of monedas) {
  process.stdout.write(`Descargando ${m}… `)
  series[m] = {
    '1h': await descargarVelas(`${m}USDT`, '1h', desde - 22 * DIA, hasta),
    '4h': await descargarVelas(`${m}USDT`, '4h', desde - 90 * DIA, hasta),
    '1d': await descargarVelas(`${m}USDT`, '1d', desde - 520 * DIA, hasta),
    eur: await descargarVelas(`${m}EUR`, '1h', desde - 2 * DIA, hasta),
  }
  console.log(`${series[m]['1h'].length} velas 1h`)
}
const fng = await descargarFng(hasta)

const inicioCalculo = Date.now()
const resultado = ejecutarBacktest({ series, fng, desde, hasta, capitalInicial, estrategia })
const salida = {
  generadoEn: new Date().toISOString(),
  aviso: 'Simulación con datos históricos. Variante técnico + Fear & Greed: sin noticias ni derivados (no hay histórico gratuito fiable). No es asesoramiento financiero ni garantía de beneficio.',
  ...resultado,
}
const destino = join(RAIZ, 'data', `backtest-${resultado.version}.json`)
await mkdir(dirname(destino), { recursive: true })
await writeFile(destino, `${JSON.stringify(salida, null, 1)}\n`)

const m = resultado.metricas
/** @param {number|null} x */
const pct = (x) => (x === null ? '—' : `${(x * 100).toFixed(2)} %`)
console.log(`\nCalculado en ${((Date.now() - inicioCalculo) / 1000).toFixed(1)} s → ${destino}`)
console.log(`Rentabilidad neta:     ${pct(m.rentabilidad)}  (comprar y mantener: ${pct(m.rentabilidadHodl)})`)
console.log(`Drawdown máximo:       ${pct(m.drawdownMaximo)}  (comprar y mantener: ${pct(m.drawdownMaximoHodl)})`)
console.log(`Operaciones:           ${m.operaciones} (${m.operacionesPorSemana?.toFixed(1)} por semana)`)
console.log(`Ganadoras/perdedoras:  ${m.ganadoras}/${m.perdedoras}  · beneficio medio ${m.beneficioMedio?.toFixed(2)} €`)
console.log(`Costes:                comisiones ${m.comisiones.toFixed(2)} € · deslizamiento ${m.deslizamiento.toFixed(2)} €`)

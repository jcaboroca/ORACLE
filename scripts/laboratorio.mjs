// @ts-check
// npm run laboratorio [-- --hasta AAAA-MM-DD]
// Descarga todo el histórico USDT 1H/4H/1D de Binance (desde que cotiza cada par) y Fear & Greed (desde
// 2018), con caché local, y ejecuta el laboratorio de estrategias (core/laboratorio.js, spec del
// laboratorio §4) → data/laboratorio.json.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { evaluarLaboratorio } from '../core/laboratorio.js'
import { HORA } from '../core/velas.js'
import { RAIZ, descargarFng, descargarHistorico } from './datos.mjs'

const MONEDAS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const INICIO_DESCARGA = Date.UTC(2017, 0, 1)

const { values } = parseArgs({ options: { hasta: { type: 'string' } } })
const hasta = values.hasta ? Date.parse(`${values.hasta}T00:00:00Z`) : Math.floor(Date.now() / HORA) * HORA
const inicio = Date.now()
/** @param {number} t */
const fecha = (t) => new Date(t).toISOString().slice(0, 10)
/** @param {number|null|undefined} x */
const pct = (x) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(1)} %`)

console.log(`Laboratorio · histórico hasta ${new Date(hasta).toISOString().slice(0, 16)}Z · ${MONEDAS.join(', ')}`)
/** @type {Record<string, { '1h': import('../core/velas.js').Vela[], '4h': import('../core/velas.js').Vela[], '1d': import('../core/velas.js').Vela[] }>} */
const series = {}
for (const m of MONEDAS) {
  process.stdout.write(`Descargando ${m}… `)
  series[m] = {
    '1h': await descargarHistorico(`${m}USDT`, '1h', INICIO_DESCARGA, hasta),
    '4h': await descargarHistorico(`${m}USDT`, '4h', INICIO_DESCARGA, hasta),
    '1d': await descargarHistorico(`${m}USDT`, '1d', INICIO_DESCARGA, hasta),
  }
  console.log(`${series[m]['1h'].length} velas 1h desde ${fecha(series[m]['1h'][0].inicio)}`)
}
const fng = await descargarFng(hasta)
console.log(`Fear & Greed: ${fng.length} días desde ${fecha(fng[0].t)}`)

const inicioCalculo = Date.now()
const resultado = evaluarLaboratorio({
  series,
  fng,
  alProgresar: (m) => console.log(`  ${((Date.now() - inicioCalculo) / 1000).toFixed(0).padStart(4)} s · ${m}`),
})
const segundos = (Date.now() - inicioCalculo) / 1000

const salida = {
  generadoEn: new Date().toISOString(),
  aviso: 'Resultados de una simulación con datos históricos (velas USDT de Binance, comisiones y deslizamiento incluidos). Solo análisis técnico: sin noticias ni derivados. Un resultado del pasado no garantiza el futuro; hay riesgo de sobreajuste aunque se valide fuera de muestra. No es asesoramiento financiero.',
  datosHasta: hasta,
  duracionSegundos: Math.round(segundos),
  ...resultado,
}
const destino = join(RAIZ, 'data', 'laboratorio.json')
await mkdir(dirname(destino), { recursive: true })
await writeFile(destino, `${JSON.stringify(salida, null, 1)}\n`)

console.log(`\nCalculado en ${segundos.toFixed(0)} s (total ${((Date.now() - inicio) / 1000).toFixed(0)} s) → ${destino}`)
console.log('\nTramos (comprar y mantener):')
for (const t of resultado.tramos) console.log(`  ${t.ano}${t.prueba ? '*' : ' '} ${fecha(t.desde)} → ${fecha(t.hasta)} ${t.monedas.join(',').padEnd(19)} ${pct(t.hodl.rentabilidad).padStart(9)} caída ${pct(t.hodl.drawdownMaximo)}`)
console.log('\nRanking fuera de muestra 2020–2025 (encadenado):')
for (const [i, r] of resultado.ranking.entries()) {
  const puntos = r.criterio.puntos.map((p) => (p.cumple ? '✓' : '✗')).join('')
  console.log(`  ${i + 1}. ${r.familia.padEnd(9)} ${pct(r.oos.rentabilidad).padStart(9)} caída ${pct(r.oos.drawdownMaximo).padStart(7)} · HODL ${pct(r.oos.rentabilidadHodl)} caída ${pct(r.oos.drawdownMaximoHodl)} · criterio ${puntos} ${r.criterio.cumple ? 'CUMPLE' : 'no cumple'} · final ${JSON.stringify(r.config)}`)
  console.log(`     por año: ${r.oos.porAno.map((a) => `${a.ano} ${pct(a.rentabilidad)} (HODL ${pct(a.hodl)})`).join(' · ')}`)
  console.log(`     por moneda (€): ${Object.entries(r.oos.porMoneda).map(([m, b]) => `${m} ${b.toFixed(0)}`).join(' · ')}`)
}
console.log('\nSelección:')
for (const s of resultado.seleccion) console.log(`  ${s.version}: ${s.familia} ${JSON.stringify(s.config)}${s.experimental ? ' (experimental)' : ''}`)
console.log(`\nTramo reservado ${fecha(resultado.reservado.desde)} → ${fecha(resultado.reservado.hasta)} (mirado una vez):`)
for (const [v, r] of Object.entries(resultado.reservado.porVersion)) {
  console.log(`  ${v}: ${pct(r.rentabilidad)} caída ${pct(r.drawdownMaximo)} · ${r.operaciones} operaciones · HODL ${pct(r.rentabilidadHodl)} caída ${pct(r.drawdownMaximoHodl)}`)
}

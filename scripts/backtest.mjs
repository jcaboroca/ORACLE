// @ts-check
// npm run backtest -- [--desde AAAA-MM-DD] [--hasta AAAA-MM-DD] [--monedas BTC,ETH] [--capital 10000]
// Descarga histórico real de Binance y Fear & Greed (con caché local) y ejecuta core/backtest.js.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { ejecutarBacktest } from '../core/backtest.js'
import { HORA, desdeBinance } from '../core/velas.js'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(RAIZ, 'scripts', '.cache')
const DIA = 24 * HORA
const BINANCE = 'https://data-api.binance.vision/api/v3/klines'

const { values } = parseArgs({
  options: {
    desde: { type: 'string' },
    hasta: { type: 'string' },
    monedas: { type: 'string', default: 'BTC,ETH,SOL,BNB,XRP' },
    capital: { type: 'string', default: '10000' },
  },
})
const hasta = values.hasta ? Date.parse(`${values.hasta}T00:00:00Z`) : Math.floor(Date.now() / HORA) * HORA
const desde = values.desde ? Date.parse(`${values.desde}T00:00:00Z`) : hasta - 730 * DIA
const monedas = values.monedas.split(',').map((m) => m.trim().toUpperCase())
const capitalInicial = Number(values.capital)

/**
 * @param {string} clave
 * @param {() => Promise<unknown>} obtener
 */
async function conCache(clave, obtener) {
  const ruta = join(CACHE, `${clave}.json`)
  try {
    return JSON.parse(await readFile(ruta, 'utf8'))
  } catch {
    const datos = await obtener()
    await mkdir(CACHE, { recursive: true })
    await writeFile(ruta, JSON.stringify(datos))
    return datos
  }
}

/**
 * @param {string} par p. ej. BTCUSDT
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} inicio
 * @param {number} fin
 */
async function descargarVelas(par, intervalo, inicio, fin) {
  /** @type {unknown[][]} */
  const filas = await conCache(`${par}-${intervalo}-${inicio}-${fin}`, async () => {
    /** @type {unknown[][]} */
    const todas = []
    let cursor = inicio
    while (cursor < fin) {
      const url = `${BINANCE}?symbol=${par}&interval=${intervalo}&startTime=${cursor}&endTime=${fin - 1}&limit=1000`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Binance ${res.status} en ${url}`)
      /** @type {unknown[][]} */
      const lote = await res.json()
      if (lote.length === 0) break
      todas.push(...lote)
      cursor = Number(lote[lote.length - 1][0]) + 1
      if (lote.length < 1000) break
    }
    return todas
  })
  return desdeBinance(filas)
}

async function descargarFng() {
  /** @type {{ data: { value: string, timestamp: string }[] }} */
  const json = await conCache(`fng-${Math.floor(hasta / DIA)}`, async () => {
    const res = await fetch('https://api.alternative.me/fng/?limit=0&format=json')
    if (!res.ok) throw new Error(`Fear & Greed ${res.status}`)
    return res.json()
  })
  return json.data.map((d) => ({ t: Number(d.timestamp) * 1000, valor: Number(d.value) })).sort((a, b) => a.t - b.t)
}

console.log(`Backtest v1 · ${new Date(desde).toISOString().slice(0, 10)} → ${new Date(hasta).toISOString().slice(0, 10)} · ${monedas.join(', ')}`)
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
const fng = await descargarFng()

const inicioCalculo = Date.now()
const resultado = ejecutarBacktest({ series, fng, desde, hasta, capitalInicial })
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

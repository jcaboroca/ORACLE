# ORACLE — Plan 1: núcleo y backtest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el núcleo puro y verificable de ORACLE (indicadores, estrategia v1, bot de paper trading, métricas) y un backtest con datos reales de Binance que use exactamente ese mismo motor.

**Architecture:** Módulos ES puros en `core/` sin red ni E/S: reciben datos y devuelven resultados, así los compartirán el Worker (plan 2), el backtest y los tests. `core/backtest.js` recorre el histórico hora a hora llamando a `calcularSenal` y `pasoMoneda`, viendo solo velas cerradas. `scripts/backtest.mjs` es el único que toca la red (Binance + alternative.me), con caché local.

**Tech Stack:** Node ≥ 22, JavaScript ES modules con `// @ts-check` y JSDoc, `node:test`, sin dependencias.

**Spec:** `docs/superpowers/specs/2026-10-18-oracle-design.md` (§3, §6, §7, §8, §14)

**Plan series:** 1) núcleo + backtest (este) · 2) Worker + D1 (fuentes, crons, idempotencia, API) · 3) PWA.

**Verified:** todo el código de este plan se ejecutó antes de escribirlo: 88 tests en verde y un backtest real de 2 años (5 monedas, ~16 s de cálculo).

## Global Constraints

- Node ≥ 22. Cero dependencias npm (`package.json` sin `dependencies`).
- ES modules (`"type": "module"`), `// @ts-check` en la primera línea de cada `.js`, sin punto y coma, comillas simples, identificadores y mensajes en español (estilo de Bajamar/SolarMonitor).
- `core/` no importa nada de red, `fetch`, `fs` ni D1.
- Nunca precios sintéticos en producción. Los generadores de velas existen solo en `test/ayudantes.js`.
- Solo velas cerradas: una vela cuenta en el instante `t` si `vela.fin <= t` (`fin` = inicio + duración).
- Cualquier cambio de un parámetro de `PARAMETROS` o `PARAMETROS_BOT` exige una `VERSION` nueva.
- Solo largos al contado; saldo nunca negativo; sin apalancamiento ni cortos.
- Aviso obligatorio en README y en el JSON del backtest: "Simulación… No es asesoramiento financiero ni garantía de beneficio".
- Commits con el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `package.json` | scripts `test` (`node --test "test/*.test.js"`) y `backtest` |
| `.gitignore` | caché del backtest y de wrangler |
| `README.md` | qué es, aviso, cómo probar y hacer backtest |
| `core/indicadores.js` | SMA, EMA, RSI y ATR de Wilder, MACD, Bollinger |
| `core/velas.js` | tipo `Vela`, conversión desde Binance, `cerradasHasta`, `esFresca` |
| `core/estrategia-v1.js` | parámetros v1, puntuaciones T/D/N/F, `combinar`, `calcularSenal` |
| `core/bot.js` | parámetros del bot, `pasoMoneda` (stops + señal), valoración, comprar y mantener |
| `core/metricas.js` | drawdown, `calcularMetricas`, `metricasPorMoneda` |
| `core/backtest.js` | `ejecutarBacktest` hora a hora sin información futura |
| `scripts/backtest.mjs` | descarga con caché + ejecuta + escribe `data/backtest-v1.json` |
| `test/ayudantes.js` | generadores de velas solo para tests |
| `test/*.test.js` | un archivo de test por módulo de `core/` |

Repo: `/Users/jcaboroca/White_Riggs/ORACLE` (ya existe, rama `main`, contiene la spec).

---

### Task 1: Proyecto base e indicadores

**Files:**
- Create: `package.json`, `.gitignore`, `README.md`
- Create: `core/indicadores.js`
- Test: `test/indicadores.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (`core/indicadores.js`), todas las series con la misma longitud que la entrada y `null` mientras no hay datos:
  - `sma(valores: number[], n: number): (number|null)[]`
  - `ema(valores: number[], n: number): (number|null)[]` — sembrada con la SMA de los n primeros, `k = 2/(n+1)`
  - `rsi(cierres: number[], n = 14): (number|null)[]` — Wilder; primer valor en el índice `n`; sin pérdidas → 100; plano → 50
  - `macd(cierres, rapida = 12, lenta = 26, senal = 9): { macd, senal, histograma }`
  - `bollinger(cierres, n = 20, k = 2): { media, superior, inferior, pctB }` — desviación poblacional; ancho 0 → `pctB = 0.5`
  - `atr(velas: {maximo, minimo, cierre}[], n = 14): (number|null)[]` — Wilder; primer valor en el índice `n`
  - `ultimo<T>(serie: T[]): T`

- [ ] **Step 1: Create project files**

`package.json`:

```json
{
  "name": "oracle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Asistente de trading crypto con bot de paper trading. Simulación: no es asesoramiento financiero.",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "test": "node --test \"test/*.test.js\"",
    "backtest": "node scripts/backtest.mjs"
  }
}
```

`.gitignore`:

```gitignore
.DS_Store
node_modules/
*.log
.vscode/

# Histórico descargado de Binance para el backtest: se regenera con npm run backtest
scripts/.cache/

# Caché local de wrangler y secrets de desarrollo
worker/.wrangler/
worker/.dev.vars
```

`README.md`:

```markdown
# ORACLE

Asistente de trading **solo crypto** (BTC, ETH, SOL, BNB, XRP): analiza gráficos, tendencias,
noticias, rumores y ánimo del mercado, aconseja COMPRAR / MANTENER / VENDER y ejecuta un bot
de **paper trading** con dinero virtual para medir si la estrategia gana o pierde frente a
comprar y mantener.

> **Simulación.** ORACLE no ejecuta órdenes reales, no es asesoramiento financiero y sus
> señales no son garantía de beneficio.

Diseño: [docs/superpowers/specs/2026-10-18-oracle-design.md](docs/superpowers/specs/2026-10-18-oracle-design.md)

## Requisitos

Node ≥ 22. Sin dependencias.

## Pruebas

```bash
npm test
```

```

- [ ] **Step 2: Write the failing test** — `test/indicadores.test.js`

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { atr, bollinger, ema, macd, rsi, sma, ultimo } from '../core/indicadores.js'

/** @param {number} a @param {number} b */
const cerca = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

describe('sma', () => {
  test('media móvil simple con null al principio', () => {
    assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4])
  })
})

describe('ema', () => {
  test('sembrada con la SMA y luego k = 2/(n+1)', () => {
    const r = ema([1, 2, 3, 4, 5], 3)
    assert.deepEqual(r.slice(0, 2), [null, null])
    cerca(/** @type {number} */ (r[2]), 2)
    cerca(/** @type {number} */ (r[3]), 3)
    cerca(/** @type {number} */ (r[4]), 4)
  })
  test('serie constante da la constante', () => {
    assert.ok(ema(new Array(50).fill(7), 20).slice(19).every((v) => v === 7))
  })
  test('serie más corta que n: todo null', () => {
    assert.deepEqual(ema([1, 2], 3), [null, null])
  })
})

describe('rsi (Wilder)', () => {
  test('solo subidas = 100', () => {
    const r = rsi(Array.from({ length: 30 }, (_, i) => i + 1), 14)
    assert.equal(r[13], null)
    assert.equal(r[14], 100)
    assert.equal(ultimo(r), 100)
  })
  test('solo bajadas = 0', () => {
    assert.equal(ultimo(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14)), 0)
  })
  test('plana = 50', () => {
    assert.equal(ultimo(rsi(new Array(30).fill(10), 14)), 50)
  })
  test('alternancia simétrica calculada a mano (n = 2)', () => {
    // cambios: +1, -1, +1 → semilla g=0.5 p=0.5 → RSI 50; luego g=(0.5+1)/2=0.75, p=0.25 → 75
    const r = rsi([10, 11, 10, 11], 2)
    assert.deepEqual(r.slice(0, 2), [null, null])
    cerca(/** @type {number} */ (r[2]), 50)
    cerca(/** @type {number} */ (r[3]), 75)
  })
})

describe('macd', () => {
  test('serie constante: macd, señal e histograma 0', () => {
    const { macd: m, senal, histograma } = macd(new Array(60).fill(100))
    assert.equal(m[24], null)
    assert.equal(m[25], 0)
    assert.equal(senal[32], null)
    assert.equal(senal[33], 0)
    assert.equal(ultimo(histograma), 0)
  })
  test('tendencia alcista: macd positivo', () => {
    const { macd: m } = macd(Array.from({ length: 60 }, (_, i) => 100 + i))
    assert.ok(/** @type {number} */ (ultimo(m)) > 0)
  })
})

describe('bollinger', () => {
  test('bandas y %B calculados a mano (n = 2, k = 1)', () => {
    // ventana [1,3]: media 2, desviación 1 → superior 3, inferior 1, %B del 3 = 1
    const b = bollinger([1, 3], 2, 1)
    assert.equal(b.media[1], 2)
    assert.equal(b.superior[1], 3)
    assert.equal(b.inferior[1], 1)
    assert.equal(b.pctB[1], 1)
  })
  test('ventana plana: %B = 0.5', () => {
    assert.equal(ultimo(bollinger(new Array(25).fill(5)).pctB), 0.5)
  })
})

describe('atr (Wilder)', () => {
  test('rango verdadero con huecos (n = 2)', () => {
    const velas = [
      { maximo: 10, minimo: 8, cierre: 9 },
      { maximo: 12, minimo: 9, cierre: 11 }, // TR 3
      { maximo: 11, minimo: 10, cierre: 10 }, // TR 1
      { maximo: 15, minimo: 14, cierre: 14 }, // TR max(1, 5, 4) = 5
    ]
    const r = atr(velas, 2)
    assert.deepEqual(r.slice(0, 2), [null, null])
    assert.equal(r[2], 2) // (3 + 1) / 2
    assert.equal(r[3], 3.5) // (2 * 1 + 5) / 2
  })
})
```

- [ ] **Step 3: Run it and verify it fails**

Run: `node --test test/indicadores.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/indicadores.js`.

- [ ] **Step 4: Implement** — `core/indicadores.js`

```js
// @ts-check
// Indicadores técnicos puros. Todas las series devuelven un array de la misma
// longitud que la entrada, con null donde aún no hay datos suficientes.

/** @typedef {(number|null)[]} Serie */

/**
 * @param {number[]} valores
 * @param {number} n
 * @returns {Serie}
 */
export function sma(valores, n) {
  /** @type {Serie} */
  const salida = new Array(valores.length).fill(null)
  let suma = 0
  for (let i = 0; i < valores.length; i++) {
    suma += valores[i]
    if (i >= n) suma -= valores[i - n]
    if (i >= n - 1) salida[i] = suma / n
  }
  return salida
}

/**
 * EMA sembrada con la SMA de los primeros n valores.
 * @param {number[]} valores
 * @param {number} n
 * @returns {Serie}
 */
export function ema(valores, n) {
  /** @type {Serie} */
  const salida = new Array(valores.length).fill(null)
  if (valores.length < n) return salida
  const k = 2 / (n + 1)
  let previo = 0
  for (let i = 0; i < n; i++) previo += valores[i]
  previo /= n
  salida[n - 1] = previo
  for (let i = n; i < valores.length; i++) {
    previo = valores[i] * k + previo * (1 - k)
    salida[i] = previo
  }
  return salida
}

/**
 * RSI de Wilder.
 * @param {number[]} cierres
 * @param {number} [n]
 * @returns {Serie}
 */
export function rsi(cierres, n = 14) {
  /** @type {Serie} */
  const salida = new Array(cierres.length).fill(null)
  if (cierres.length <= n) return salida
  let ganancia = 0
  let perdida = 0
  for (let i = 1; i <= n; i++) {
    const cambio = cierres[i] - cierres[i - 1]
    if (cambio > 0) ganancia += cambio
    else perdida -= cambio
  }
  ganancia /= n
  perdida /= n
  salida[n] = valorRsi(ganancia, perdida)
  for (let i = n + 1; i < cierres.length; i++) {
    const cambio = cierres[i] - cierres[i - 1]
    ganancia = (ganancia * (n - 1) + Math.max(cambio, 0)) / n
    perdida = (perdida * (n - 1) + Math.max(-cambio, 0)) / n
    salida[i] = valorRsi(ganancia, perdida)
  }
  return salida
}

/**
 * @param {number} ganancia
 * @param {number} perdida
 */
function valorRsi(ganancia, perdida) {
  if (perdida === 0) return ganancia === 0 ? 50 : 100
  return 100 - 100 / (1 + ganancia / perdida)
}

/**
 * @param {number[]} cierres
 * @param {number} [rapida]
 * @param {number} [lenta]
 * @param {number} [senal]
 * @returns {{ macd: Serie, senal: Serie, histograma: Serie }}
 */
export function macd(cierres, rapida = 12, lenta = 26, senal = 9) {
  const emaRapida = ema(cierres, rapida)
  const emaLenta = ema(cierres, lenta)
  /** @type {Serie} */
  const lineaMacd = cierres.map((_, i) => {
    const r = emaRapida[i]
    const l = emaLenta[i]
    return r === null || l === null ? null : r - l
  })
  const inicio = lineaMacd.findIndex((v) => v !== null)
  /** @type {Serie} */
  const lineaSenal = new Array(cierres.length).fill(null)
  if (inicio >= 0) {
    const tramo = /** @type {number[]} */ (lineaMacd.slice(inicio))
    const emaTramo = ema(tramo, senal)
    emaTramo.forEach((v, j) => { lineaSenal[inicio + j] = v })
  }
  /** @type {Serie} */
  const histograma = lineaMacd.map((m, i) => {
    const s = lineaSenal[i]
    return m === null || s === null ? null : m - s
  })
  return { macd: lineaMacd, senal: lineaSenal, histograma }
}

/**
 * Bandas de Bollinger con desviación típica poblacional.
 * @param {number[]} cierres
 * @param {number} [n]
 * @param {number} [k]
 * @returns {{ media: Serie, superior: Serie, inferior: Serie, pctB: Serie }}
 */
export function bollinger(cierres, n = 20, k = 2) {
  const media = sma(cierres, n)
  /** @type {Serie} */ const superior = new Array(cierres.length).fill(null)
  /** @type {Serie} */ const inferior = new Array(cierres.length).fill(null)
  /** @type {Serie} */ const pctB = new Array(cierres.length).fill(null)
  for (let i = n - 1; i < cierres.length; i++) {
    const m = /** @type {number} */ (media[i])
    let varianza = 0
    for (let j = i - n + 1; j <= i; j++) varianza += (cierres[j] - m) ** 2
    const desviacion = Math.sqrt(varianza / n)
    superior[i] = m + k * desviacion
    inferior[i] = m - k * desviacion
    const ancho = 2 * k * desviacion
    pctB[i] = ancho === 0 ? 0.5 : (cierres[i] - (m - k * desviacion)) / ancho
  }
  return { media, superior, inferior, pctB }
}

/**
 * ATR de Wilder.
 * @param {{ maximo: number, minimo: number, cierre: number }[]} velas
 * @param {number} [n]
 * @returns {Serie}
 */
export function atr(velas, n = 14) {
  /** @type {Serie} */
  const salida = new Array(velas.length).fill(null)
  if (velas.length <= n) return salida
  const rangos = velas.map((v, i) => {
    if (i === 0) return v.maximo - v.minimo
    const previo = velas[i - 1].cierre
    return Math.max(v.maximo - v.minimo, Math.abs(v.maximo - previo), Math.abs(v.minimo - previo))
  })
  let actual = 0
  for (let i = 1; i <= n; i++) actual += rangos[i]
  actual /= n
  salida[n] = actual
  for (let i = n + 1; i < velas.length; i++) {
    actual = (actual * (n - 1) + rangos[i]) / n
    salida[i] = actual
  }
  return salida
}

/**
 * @template T
 * @param {T[]} serie
 * @returns {T}
 */
export function ultimo(serie) {
  return serie[serie.length - 1]
}
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npm test`
Expected: PASS — 13 tests, 0 fail.

- [ ] **Commit**

```bash
git add package.json .gitignore README.md core/indicadores.js test/indicadores.test.js
git commit -m "feat(core): proyecto base e indicadores técnicos" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Velas

**Files:**
- Create: `core/velas.js`
- Test: `test/velas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (`core/velas.js`):
  - `HORA = 3_600_000`, `DURACION = { '1h', '4h', '1d' }` en ms
  - typedef `Vela = { inicio, fin, apertura, maximo, minimo, cierre, volumen }` — `fin` = instante exacto de cierre (`closeTime + 1` de Binance)
  - `desdeBinance(filas: unknown[][]): Vela[]`
  - `cerradasHasta(velas: Vela[], t: number): Vela[]` — recorta por el final las velas con `fin > t` (devuelve el mismo array si no hay que recortar)
  - `esFresca(velas1hCerradas: Vela[], ahora: number): boolean` — `ahora − ultima.fin < HORA`

- [ ] **Step 1: Write the failing test** — `test/velas.test.js`

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA, cerradasHasta, desdeBinance, esFresca } from '../core/velas.js'

/** @param {number} inicio */
const vela = (inicio) => ({ inicio, fin: inicio + HORA, apertura: 1, maximo: 1, minimo: 1, cierre: 1, volumen: 1 })

describe('desdeBinance', () => {
  test('convierte una fila real de klines', () => {
    const fila = [1792342800000, '72117.21', '72250.35', '72117.21', '72230.53', '0.92403', 1792346399999, '66716.48', 381, '0.37', '27079.19', '0']
    assert.deepEqual(desdeBinance([fila]), [{
      inicio: 1792342800000,
      fin: 1792346400000,
      apertura: 72117.21,
      maximo: 72250.35,
      minimo: 72117.21,
      cierre: 72230.53,
      volumen: 0.92403,
    }])
  })
})

describe('cerradasHasta', () => {
  const velas = [vela(0), vela(HORA), vela(2 * HORA)]
  test('descarta la vela en curso', () => {
    assert.deepEqual(cerradasHasta(velas, 2.5 * HORA).map((v) => v.inicio), [0, HORA])
  })
  test('una vela que cierra justo en t cuenta como cerrada', () => {
    assert.equal(cerradasHasta(velas, 3 * HORA).length, 3)
  })
  test('antes de cerrar la primera: ninguna', () => {
    assert.equal(cerradasHasta(velas, HORA - 1).length, 0)
  })
})

describe('esFresca', () => {
  test('cron al minuto 3: la última cerrada terminó hace 3 min', () => {
    assert.equal(esFresca([vela(0)], HORA + 3 * 60_000), true)
  })
  test('falta la vela de la hora anterior: desactualizada', () => {
    assert.equal(esFresca([vela(0)], 2 * HORA + 3 * 60_000), false)
  })
  test('sin velas: desactualizada', () => {
    assert.equal(esFresca([], HORA), false)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/velas.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/velas.js`.

- [ ] **Step 3: Implement** — `core/velas.js`

```js
// @ts-check

export const HORA = 3_600_000
export const DURACION = /** @type {const} */ ({ '1h': HORA, '4h': 4 * HORA, '1d': 24 * HORA })

/**
 * @typedef {{ inicio: number, fin: number, apertura: number, maximo: number,
 *   minimo: number, cierre: number, volumen: number }} Vela
 * `fin` es el instante exacto de cierre (inicio + duración), no el ms anterior.
 */

/**
 * Convierte filas de /api/v3/klines de Binance en velas.
 * @param {unknown[][]} filas
 * @returns {Vela[]}
 */
export function desdeBinance(filas) {
  return filas.map((f) => ({
    inicio: Number(f[0]),
    fin: Number(f[6]) + 1,
    apertura: Number(f[1]),
    maximo: Number(f[2]),
    minimo: Number(f[3]),
    cierre: Number(f[4]),
    volumen: Number(f[5]),
  }))
}

/**
 * Velas ya cerradas en el instante `t` (nunca información futura).
 * @param {Vela[]} velas
 * @param {number} t
 */
export function cerradasHasta(velas, t) {
  let n = velas.length
  while (n > 0 && velas[n - 1].fin > t) n--
  return n === velas.length ? velas : velas.slice(0, n)
}

/**
 * La última vela 1H cerrada es la de la hora inmediatamente anterior a `ahora`.
 * @param {Vela[]} velas1hCerradas
 * @param {number} ahora
 */
export function esFresca(velas1hCerradas, ahora) {
  const ultima = velas1hCerradas[velas1hCerradas.length - 1]
  return ultima !== undefined && ahora - ultima.fin < HORA
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test test/velas.test.js`
Expected: PASS — 7 tests in this file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Commit**

```bash
git add core/velas.js test/velas.test.js
git commit -m "feat(core): velas cerradas y frescura" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Estrategia v1 (motor de señales)

**Files:**
- Create: `core/estrategia-v1.js`
- Create: `test/ayudantes.js` (generadores de velas solo para tests)
- Test: `test/estrategia.test.js`

**Interfaces:**
- Consumes: `core/indicadores.js` (`atr, bollinger, ema, macd, rsi, ultimo`), `core/velas.js` (`HORA, cerradasHasta, esFresca`, typedef `Vela`).
- Produces (`core/estrategia-v1.js`):
  - `VERSION = 'v1'`, `PARAMETROS` (congelado; pesos, umbrales; ver código)
  - typedefs `Tendencia`, `Veredicto = 'COMPRAR'|'MANTENER'|'VENDER'|'SIN_DATOS'`, `Derivados = { funding, ratioLongShort, oiCambio24h, precioCambio24h }` (number|null cada uno; fracciones), `Titular = { id, origen: 'rss'|'reddit', publicadoEn, monedas: string[], puntuacion: number|null }`
  - `tendenciaDe(d)`, `puntuarRsi(tendencia, rsi)`, `puntuarMacd(histPrevio, hist)`, `puntuarBollinger(tendencia, pctB)`
  - `analizarTimeframe(velas: Vela[])` → `null` si < 200 velas; si no `{ tendencia, d, precio, ema20, ema50, ema200, rsi, macdHist, pctB, subs, puntuacion }`
  - `puntuarDerivados(der: Derivados|null) → { puntuacion: number|null, subs }`
  - `puntuarNoticias(titulares: Titular[], simbolo, ahora) → { puntuacion: number|null, usados: string[] }`
  - `puntuarFng(valor: number|null) → number|null`
  - `combinar({ tecnico, derivados, noticias, fng, alineacion }) → { veredicto, puntuacion, indiceConfianza, motivo: string|null, ausentes: string[] }`
  - `calcularSenal({ simbolo, ahora, velas: { '1h', '4h', '1d' }, derivados, titulares, fng })` → `{ version, simbolo, calculadaEn, vela1h, precio, fresca, veredicto, puntuacion, indiceConfianza, alineacion, atrPct, motivo, componentes: { tecnico, derivados, noticias, fng }, ausentes, detalle }`. Filtra internamente con `cerradasHasta(…, ahora)`.
- Produces (`test/ayudantes.js`): `serie(n, cierre: (i) => number, { duracion = HORA, inicio = 0, rango = 0.01 })`, `vela(inicio, { o, h, l, c })`.

Notas de diseño (spec §6): el RSI se interpreta según la tendencia y nunca suma por sí solo; la contradicción es `sign(T) ≠ sign(D) && |T| ≥ 0,3 && |D| ≥ 0,5`; `puntuacion` e `indiceConfianza` se redondean a 1e-9 para que los umbrales exactos (0,35) sean deterministas; el «índice de confianza» no es una probabilidad.

- [ ] **Step 0: Create test helpers** — `test/ayudantes.js`

```js
// @ts-check
// Generadores de datos de prueba. Solo para tests: ORACLE nunca inventa precios en producción.
import { HORA } from '../core/velas.js'

/**
 * Serie de velas a partir de una función de cierre.
 * @param {number} n
 * @param {(i: number) => number} cierre
 * @param {{ duracion?: number, inicio?: number, rango?: number }} [op]
 * @returns {import('../core/velas.js').Vela[]}
 */
export function serie(n, cierre, { duracion = HORA, inicio = 0, rango = 0.01 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const c = cierre(i)
    const apertura = i === 0 ? c : cierre(i - 1)
    return {
      inicio: inicio + i * duracion,
      fin: inicio + (i + 1) * duracion,
      apertura,
      maximo: Math.max(apertura, c) * (1 + rango),
      minimo: Math.min(apertura, c) * (1 - rango),
      cierre: c,
      volumen: 1,
    }
  })
}

/**
 * Vela suelta con OHLC explícitos.
 * @param {number} inicio
 * @param {{ o: number, h: number, l: number, c: number }} ohlc
 */
export function vela(inicio, { o, h, l, c }) {
  return { inicio, fin: inicio + HORA, apertura: o, maximo: h, minimo: l, cierre: c, volumen: 1 }
}
```

- [ ] **Step 1: Write the failing test** — `test/estrategia.test.js`

```js
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/estrategia.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/estrategia-v1.js` (create `test/ayudantes.js` first, see Step 0).

- [ ] **Step 3: Implement** — `core/estrategia-v1.js`

```js
// @ts-check
// Estrategia v1: puntuación determinista → COMPRAR / MANTENER / VENDER.
// Cualquier cambio de parámetros exige una VERSION nueva.
import { atr, bollinger, ema, macd, rsi, ultimo } from './indicadores.js'
import { HORA, cerradasHasta, esFresca } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {'alcista'|'bajista'|'lateral'} Tendencia */
/** @typedef {'COMPRAR'|'MANTENER'|'VENDER'|'SIN_DATOS'} Veredicto */
/**
 * @typedef {{ funding: number|null, ratioLongShort: number|null,
 *   oiCambio24h: number|null, precioCambio24h: number|null }} Derivados
 * funding en fracción por 8 h (0.0001 = 0,01 %); cambios en fracción (0.03 = 3 %).
 */
/**
 * @typedef {{ id: string, origen: 'rss'|'reddit', publicadoEn: number,
 *   monedas: string[], puntuacion: number|null }} Titular
 * monedas: símbolos afectados o ['MERCADO'].
 */

export const VERSION = 'v1'

export const PARAMETROS = Object.freeze({
  pesos: Object.freeze({ tecnico: 0.6, derivados: 0.2, noticias: 0.15, fng: 0.05 }),
  pesosTimeframe: Object.freeze({ '1d': 0.5, '4h': 0.3, '1h': 0.2 }),
  pesosSub: Object.freeze({ tendencia: 0.35, ema200: 0.15, rsi: 0.25, macd: 0.15, bollinger: 0.1 }),
  umbralTendencia: 0.02,
  umbralCompra: 0.35,
  umbralVenta: -0.35,
  contradiccion: Object.freeze({ tecnico: 0.3, derivados: 0.5 }),
  velasMinimas: 200,
  noticias: Object.freeze({ ventanaHoras: 24, tauHoras: 12, minimo: 3, factorMercado: 0.5, factorReddit: 0.5 }),
  fng: Object.freeze({ miedo: 20, codicia: 80, valor: 0.5 }),
})

/** @param {number} x @param {number} min @param {number} max */
const clamp = (x, min, max) => Math.min(max, Math.max(min, x))
/** @param {number} x */
const redondear = (x) => Math.round(x * 1e9) / 1e9

/** @param {number} d @returns {Tendencia} */
export function tendenciaDe(d) {
  if (d > PARAMETROS.umbralTendencia) return 'alcista'
  if (d < -PARAMETROS.umbralTendencia) return 'bajista'
  return 'lateral'
}

/** El RSI se lee según la tendencia: nunca suma por sí solo. @param {Tendencia} tendencia @param {number} valor */
export function puntuarRsi(tendencia, valor) {
  if (tendencia === 'alcista') return valor <= 45 ? 1 : valor >= 80 ? -0.3 : 0
  if (tendencia === 'bajista') return valor >= 55 ? -1 : valor <= 20 ? 0.3 : 0
  return valor <= 30 ? 1 : valor >= 70 ? -1 : 0
}

/** @param {number} previo histograma de la vela anterior @param {number} actual */
export function puntuarMacd(previo, actual) {
  if (previo <= 0 && actual > 0) return 1
  if (previo >= 0 && actual < 0) return -1
  return Math.sign(actual) * 0.5
}

/** @param {Tendencia} tendencia @param {number} pctB */
export function puntuarBollinger(tendencia, pctB) {
  if (tendencia !== 'lateral') return 0
  return pctB < 0 ? 1 : pctB > 1 ? -1 : 0
}

/**
 * @param {Vela[]} velas cerradas, de la más antigua a la más reciente
 */
export function analizarTimeframe(velas) {
  if (velas.length < PARAMETROS.velasMinimas) return null
  const cierres = velas.map((v) => v.cierre)
  const precio = ultimo(cierres)
  const ema20 = /** @type {number} */ (ultimo(ema(cierres, 20)))
  const ema50 = /** @type {number} */ (ultimo(ema(cierres, 50)))
  const ema200 = /** @type {number} */ (ultimo(ema(cierres, 200)))
  const valorRsi = /** @type {number} */ (ultimo(rsi(cierres, 14)))
  const { histograma } = macd(cierres)
  const hist = /** @type {number} */ (histograma[histograma.length - 1])
  const histPrevio = /** @type {number} */ (histograma[histograma.length - 2])
  const pctB = /** @type {number} */ (ultimo(bollinger(cierres, 20, 2).pctB))
  const d = (ema20 - ema50) / ema50
  const tendencia = tendenciaDe(d)
  const subs = {
    tendencia: clamp(d / PARAMETROS.umbralTendencia, -1, 1),
    ema200: precio > ema200 ? 1 : precio < ema200 ? -1 : 0,
    rsi: puntuarRsi(tendencia, valorRsi),
    macd: puntuarMacd(histPrevio, hist),
    bollinger: puntuarBollinger(tendencia, pctB),
  }
  const p = PARAMETROS.pesosSub
  const puntuacion = clamp(
    p.tendencia * subs.tendencia + p.ema200 * subs.ema200 + p.rsi * subs.rsi
      + p.macd * subs.macd + p.bollinger * subs.bollinger,
    -1, 1,
  )
  return { tendencia, d, precio, ema20, ema50, ema200, rsi: valorRsi, macdHist: hist, pctB, subs, puntuacion: redondear(puntuacion) }
}

/** @param {Derivados|null} der */
export function puntuarDerivados(der) {
  if (!der) return { puntuacion: null, subs: {} }
  /** @type {Record<string, number>} */
  const subs = {}
  const { funding, ratioLongShort, oiCambio24h, precioCambio24h } = der
  if (funding !== null) {
    subs.funding = funding > 0.0005 ? -1 : funding > 0.0003 ? -0.5 : funding < -0.0005 ? 1 : funding < -0.0003 ? 0.5 : 0
  }
  if (ratioLongShort !== null) {
    subs.longShort = ratioLongShort > 2 ? -0.5 : ratioLongShort < 0.7 ? 0.5 : 0
  }
  if (oiCambio24h !== null && precioCambio24h !== null) {
    subs.openInterest = oiCambio24h >= 0.03 && precioCambio24h >= 0.01 ? 0.5
      : oiCambio24h >= 0.03 && precioCambio24h <= -0.01 ? -0.5 : 0
  }
  /** @type {Record<string, number>} */
  const pesos = { funding: 0.4, longShort: 0.3, openInterest: 0.3 }
  const claves = Object.keys(subs)
  if (claves.length === 0) return { puntuacion: null, subs }
  const sumaPesos = claves.reduce((s, k) => s + pesos[k], 0)
  const puntuacion = claves.reduce((s, k) => s + pesos[k] * subs[k], 0) / sumaPesos
  return { puntuacion: redondear(puntuacion), subs }
}

/**
 * @param {Titular[]} titulares
 * @param {string} simbolo
 * @param {number} ahora
 */
export function puntuarNoticias(titulares, simbolo, ahora) {
  const p = PARAMETROS.noticias
  let suma = 0
  let sumaPesos = 0
  /** @type {string[]} */
  const usados = []
  for (const t of titulares) {
    if (t.puntuacion === null) continue
    const edadHoras = (ahora - t.publicadoEn) / HORA
    if (edadHoras < 0 || edadHoras > p.ventanaHoras) continue
    const propia = t.monedas.includes(simbolo)
    if (!propia && !t.monedas.includes('MERCADO')) continue
    let w = Math.exp(-edadHoras / p.tauHoras)
    if (!propia) w *= p.factorMercado
    if (t.origen === 'reddit') w *= p.factorReddit
    suma += w * t.puntuacion
    sumaPesos += w
    usados.push(t.id)
  }
  if (usados.length < p.minimo) return { puntuacion: null, usados }
  return { puntuacion: redondear(suma / sumaPesos), usados }
}

/** @param {number|null} valor índice Fear & Greed 0-100 */
export function puntuarFng(valor) {
  if (valor === null) return null
  const p = PARAMETROS.fng
  return valor < p.miedo ? p.valor : valor > p.codicia ? -p.valor : 0
}

/**
 * Combina componentes presentes (null = ausente) en un veredicto.
 * @param {{ tecnico: number, derivados: number|null, noticias: number|null,
 *   fng: number|null, alineacion: boolean }} c
 */
export function combinar(c) {
  /** @type {Record<string, number|null>} */
  const valores = { tecnico: c.tecnico, derivados: c.derivados, noticias: c.noticias, fng: c.fng }
  /** @type {Record<string, number>} */
  const pesos = PARAMETROS.pesos
  const presentes = Object.keys(valores).filter((k) => valores[k] !== null)
  const ausentes = Object.keys(valores).filter((k) => valores[k] === null)
  const sumaPesos = presentes.reduce((s, k) => s + pesos[k], 0)
  const puntuacion = redondear(presentes.reduce((s, k) => s + pesos[k] * /** @type {number} */ (valores[k]), 0) / sumaPesos)
  const indiceConfianza = redondear(Math.min(0.95, 0.4 + 0.5 * Math.abs(puntuacion) + (c.alineacion ? 0.1 : 0)))
  const { contradiccion } = PARAMETROS
  /** @type {Veredicto} */
  let veredicto = 'MANTENER'
  /** @type {string|null} */
  let motivo = null
  if (c.derivados !== null && Math.sign(c.tecnico) !== Math.sign(c.derivados)
    && Math.abs(c.tecnico) >= contradiccion.tecnico && Math.abs(c.derivados) >= contradiccion.derivados) {
    motivo = 'contradiccion_tecnico_derivados'
  } else if (puntuacion >= PARAMETROS.umbralCompra) {
    veredicto = 'COMPRAR'
  } else if (puntuacion <= PARAMETROS.umbralVenta) {
    veredicto = 'VENDER'
  }
  return { veredicto, puntuacion, indiceConfianza, motivo, ausentes }
}

/**
 * Señal completa de una moneda en el instante `ahora`. Solo usa velas cerradas.
 * @param {{ simbolo: string, ahora: number,
 *   velas: { '1h': Vela[], '4h': Vela[], '1d': Vela[] },
 *   derivados: Derivados|null, titulares: Titular[], fng: number|null }} entrada
 */
export function calcularSenal({ simbolo, ahora, velas, derivados, titulares, fng }) {
  const cerradas = {
    '1h': cerradasHasta(velas['1h'], ahora),
    '4h': cerradasHasta(velas['4h'], ahora),
    '1d': cerradasHasta(velas['1d'], ahora),
  }
  const timeframes = {
    '1h': analizarTimeframe(cerradas['1h']),
    '4h': analizarTimeframe(cerradas['4h']),
    '1d': analizarTimeframe(cerradas['1d']),
  }
  const ultima1h = cerradas['1h'][cerradas['1h'].length - 1]
  const base = {
    version: VERSION,
    simbolo,
    calculadaEn: ahora,
    vela1h: ultima1h ? ultima1h.inicio : null,
    precio: ultima1h ? ultima1h.cierre : null,
    fresca: esFresca(cerradas['1h'], ahora),
  }
  if (!timeframes['1h'] || !timeframes['4h'] || !timeframes['1d']) {
    return {
      ...base,
      veredicto: /** @type {Veredicto} */ ('SIN_DATOS'),
      puntuacion: null,
      indiceConfianza: null,
      alineacion: false,
      atrPct: null,
      motivo: 'velas_insuficientes',
      componentes: { tecnico: null, derivados: null, noticias: null, fng: null },
      ausentes: ['tecnico'],
      detalle: { timeframes, derivados: {}, noticias: [], fng },
    }
  }
  const tf = /** @type {Record<'1h'|'4h'|'1d', NonNullable<ReturnType<typeof analizarTimeframe>>>} */ (timeframes)
  const pt = PARAMETROS.pesosTimeframe
  const tecnico = redondear(pt['1d'] * tf['1d'].puntuacion + pt['4h'] * tf['4h'].puntuacion + pt['1h'] * tf['1h'].puntuacion)
  const tendencias = [tf['1h'].tendencia, tf['4h'].tendencia, tf['1d'].tendencia]
  const alineacion = tendencias.filter((t) => t === 'alcista').length >= 2
    || tendencias.filter((t) => t === 'bajista').length >= 2
  const atr4h = /** @type {number} */ (ultimo(atr(cerradas['4h'], 14)))
  const atrPct = atr4h / ultimo(cerradas['4h']).cierre
  const der = puntuarDerivados(derivados)
  const not = puntuarNoticias(titulares, simbolo, ahora)
  const valorFng = puntuarFng(fng)
  const resultado = combinar({ tecnico, derivados: der.puntuacion, noticias: not.puntuacion, fng: valorFng, alineacion })
  return {
    ...base,
    ...resultado,
    alineacion,
    atrPct,
    componentes: { tecnico, derivados: der.puntuacion, noticias: not.puntuacion, fng: valorFng },
    detalle: { timeframes, derivados: der.subs, noticias: not.usados, fng },
  }
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test test/estrategia.test.js`
Expected: PASS — 34 tests in this file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Commit**

```bash
git add core/estrategia-v1.js test/ayudantes.js test/estrategia.test.js
git commit -m "feat(core): estrategia v1 determinista" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Bot de paper trading

**Files:**
- Create: `core/bot.js`
- Test: `test/bot.test.js`

**Interfaces:**
- Consumes: `core/velas.js` (`HORA`, typedef `Vela`), `test/ayudantes.js` (`vela`).
- Produces (`core/bot.js`):
  - `PARAMETROS_BOT = { comision: 0.001, deslizamiento: 0.0005, confianzaMinima: 0.6, fraccionPosicion: 0.2, ordenMinima: 10, multStopLoss: 1.5, multTakeProfit: 2.5, enfriamientoHoras: 4 }`
  - typedefs `Posicion { simbolo, velaEntrada, precioEntrada, unidades, coste, stopLoss, takeProfit }`, `Estado { saldo, posiciones, ultimaRevisada, enfriamientoHasta }`, `Evento` (compra/venta con precioBase, precio, unidades, importe, comision, deslizamiento, motivo, saldoTras, pnlNeto?, stopLoss?, takeProfit?, posicion), `Decision { simbolo, vela, veredicto, puntuacion, indiceConfianza, accion: 'abrir'|'cerrar'|'ninguna', motivo, precio }`, `SenalBot { veredicto, puntuacion, indiceConfianza, atrPct, fresca, motivo }` (un subconjunto del resultado de `calcularSenal`)
  - `estadoInicial(capital): Estado`
  - `valorCartera(estado, precios: Record<string, number>): number`
  - `velaDeDecision(ahora): number` — inicio de la vela 1H de la hora anterior
  - `salidaEnVela(pos, vela) → { base, motivo: 'stop_loss'|'take_profit' } | null` — SL gana si toca ambos; hueco → apertura
  - `pasoMoneda(estado, { simbolo, velasEur, senal, ahora, valorCartera }) → { estado, eventos: Evento[], decision: Decision }` — no muta la entrada; primero stops sobre todas las velas EUR nuevas posteriores a `ultimaRevisada` y a la vela de entrada, luego la señal
  - `crearHodl(capital, precios) → Record<string, number>` (unidades), `valorHodl(unidades, precios)`
- Motivos de decisión: `abierta`, `cerrada`, `mantener` (o el `motivo` de la señal), `sin_posicion`, `ya_en_posicion`, `confianza_baja`, `saldo_insuficiente`, `datos_desactualizados`, `sin_datos`, `enfriamiento`, `cerrada_por_stop`. El Worker (plan 2) los guarda tal cual en `decisiones.motivo`.

- [ ] **Step 1: Write the failing test** — `test/bot.test.js`

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  PARAMETROS_BOT, crearHodl, estadoInicial, pasoMoneda, salidaEnVela, valorCartera, valorHodl, velaDeDecision,
} from '../core/bot.js'
import { HORA } from '../core/velas.js'
import { vela } from './ayudantes.js'

const T = 1000 * HORA // inicio de la vela de decisión
const AHORA = T + HORA + 3 * 60_000 // cron al minuto 3 de la hora siguiente
/** @param {number} c */
const plana = (c) => ({ o: c, h: c, l: c, c })
/** @param {Partial<import('../core/bot.js').SenalBot>} s */
const senal = (s = {}) => ({ veredicto: 'COMPRAR', puntuacion: 0.5, indiceConfianza: 0.7, atrPct: 0.02, fresca: true, motivo: null, ...s })
/** @param {number} a @param {number} b */
const cerca = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

/** Abre BTC a 100 € con 10.000 € de cartera y devuelve el estado. */
function conPosicion() {
  const r = pasoMoneda(estadoInicial(10_000), {
    simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
  })
  return r.estado
}

describe('velaDeDecision', () => {
  test('al minuto 3 de la hora H es la vela de H−1', () => {
    assert.equal(velaDeDecision(AHORA), T)
  })
})

describe('apertura', () => {
  test('20 % de la cartera, deslizamiento y comisión exactos, SL/TP sobre el precio real', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.accion, 'abrir')
    const [compra] = r.eventos
    assert.equal(compra.importe, 2000)
    cerca(compra.precio, 100.05)
    cerca(compra.comision, 2)
    cerca(compra.unidades, 1998 / 100.05)
    cerca(/** @type {number} */ (compra.stopLoss), 100.05 * (1 - 1.5 * 0.02))
    cerca(/** @type {number} */ (compra.takeProfit), 100.05 * (1 + 2.5 * 0.02))
    assert.equal(r.estado.saldo, 8000)
  })
  test('limitada al saldo y nunca negativo', () => {
    const e = { ...estadoInicial(500), saldo: 500 }
    const r = pasoMoneda(e, { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000 })
    assert.equal(r.eventos[0].importe, 500)
    assert.equal(r.estado.saldo, 0)
  })
  test('por debajo de la orden mínima: saldo_insuficiente', () => {
    const r = pasoMoneda(estadoInicial(9), { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 9 })
    assert.equal(r.decision.motivo, 'saldo_insuficiente')
    assert.equal(r.eventos.length, 0)
  })
  test('índice de confianza bajo: no abre', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ indiceConfianza: 0.59 }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'confianza_baja')
  })
  test('no promedia: COMPRAR con posición abierta no compra más', () => {
    const r = pasoMoneda(conPosicion(), {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal(), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'ya_en_posicion')
    assert.equal(r.eventos.length, 0)
  })
  test('datos desactualizados: no abre', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T - HORA, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'datos_desactualizados')
  })
  test('SIN_DATOS: no hace nada', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ veredicto: 'SIN_DATOS' }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'sin_datos')
  })
  test('no muta el estado de entrada', () => {
    const e = estadoInicial(10_000)
    pasoMoneda(e, { simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal(), ahora: AHORA, valorCartera: 10_000 })
    assert.deepEqual(e, estadoInicial(10_000))
  })
})

describe('venta por señal', () => {
  test('VENDER sin posición: registrada como no ejecutada', () => {
    const r = pasoMoneda(estadoInicial(10_000), {
      simbolo: 'BTC', velasEur: [vela(T, plana(100))], senal: senal({ veredicto: 'VENDER' }), ahora: AHORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.accion, 'ninguna')
    assert.equal(r.decision.motivo, 'sin_posicion')
  })
  test('VENDER con posición: vende todas las unidades con costes', () => {
    const e = conPosicion()
    const unidades = e.posiciones.BTC.unidades
    const r = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(101))], senal: senal({ veredicto: 'VENDER' }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    const [venta] = r.eventos
    assert.equal(venta.motivo, 'senal')
    assert.equal(venta.unidades, unidades)
    cerca(venta.precio, 101 * 0.9995)
    cerca(/** @type {number} */ (venta.pnlNeto), venta.importe - venta.comision - 2000)
    assert.equal(r.estado.posiciones.BTC, undefined)
  })
  test('MANTENER: no opera y conserva el motivo de la señal', () => {
    const r = pasoMoneda(conPosicion(), {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal({ veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados' }),
      ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.decision.motivo, 'contradiccion_tecnico_derivados')
    assert.equal(r.eventos.length, 0)
  })
})

describe('stops', () => {
  const pos = { simbolo: 'BTC', velaEntrada: 0, precioEntrada: 100, unidades: 1, coste: 100, stopLoss: 95, takeProfit: 110 }
  test('toca SL y TP en la misma vela: gana el SL', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 100, h: 111, l: 94, c: 100 })), { base: 95, motivo: 'stop_loss' })
  })
  test('hueco por debajo del SL: sale a la apertura', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 90, h: 91, l: 89, c: 90 })), { base: 90, motivo: 'stop_loss' })
  })
  test('hueco por encima del TP: sale a la apertura', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 112, h: 113, l: 111, c: 112 })), { base: 112, motivo: 'take_profit' })
  })
  test('toca solo el TP', () => {
    assert.deepEqual(salidaEnVela(pos, vela(HORA, { o: 100, h: 110, l: 99, c: 105 })), { base: 110, motivo: 'take_profit' })
  })
  test('ni uno ni otro', () => {
    assert.equal(salidaEnVela(pos, vela(HORA, { o: 100, h: 105, l: 96, c: 101 })), null)
  })

  test('recupera velas perdidas: el SL tocado hace 2 h se ejecuta en esa vela', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const velas = [
      vela(T, plana(100)), // vela de entrada: no se revisa
      vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 }),
      vela(T + 2 * HORA, plana(99)),
      vela(T + 3 * HORA, plana(99)),
    ]
    const r = pasoMoneda(e, { simbolo: 'BTC', velasEur: velas, senal: senal({ veredicto: 'MANTENER' }), ahora: AHORA + 3 * HORA, valorCartera: 10_000 })
    assert.equal(r.eventos.length, 1)
    assert.equal(r.eventos[0].motivo, 'stop_loss')
    assert.equal(r.eventos[0].vela, T + HORA)
    cerca(r.eventos[0].precio, sl * 0.9995)
    assert.equal(r.estado.ultimaRevisada.BTC, T + 3 * HORA)
  })
  test('tras un SL no reabre en la misma ejecución ni durante 4 h', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const r1 = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })], senal: senal(), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r1.decision.motivo, 'cerrada_por_stop')
    const r2 = pasoMoneda(r1.estado, {
      simbolo: 'BTC', velasEur: [vela(T + 4 * HORA, plana(99))], senal: senal(), ahora: AHORA + 4 * HORA, valorCartera: 10_000,
    })
    assert.equal(r2.decision.motivo, 'enfriamiento')
    const r3 = pasoMoneda(r2.estado, {
      simbolo: 'BTC', velasEur: [vela(T + 5 * HORA, plana(99))], senal: senal(), ahora: AHORA + 5 * HORA, valorCartera: 10_000,
    })
    assert.equal(r3.decision.accion, 'abrir')
  })
  test('SL y TP no cambian tras abrir aunque cambie el ATR', () => {
    const e = conPosicion()
    const { stopLoss, takeProfit } = e.posiciones.BTC
    const r = pasoMoneda(e, {
      simbolo: 'BTC', velasEur: [vela(T + HORA, plana(100))], senal: senal({ atrPct: 0.5 }), ahora: AHORA + HORA, valorCartera: 10_000,
    })
    assert.equal(r.estado.posiciones.BTC.stopLoss, stopLoss)
    assert.equal(r.estado.posiciones.BTC.takeProfit, takeProfit)
  })
  test('repetir la misma ejecución sobre el estado resultante no duplica operaciones', () => {
    const e = conPosicion()
    const sl = e.posiciones.BTC.stopLoss
    const entrada = {
      simbolo: 'BTC', velasEur: [vela(T + HORA, { o: 100, h: 100, l: sl - 1, c: 99 })], senal: senal({ veredicto: 'MANTENER' }),
      ahora: AHORA + HORA, valorCartera: 10_000,
    }
    const r1 = pasoMoneda(e, entrada)
    const r2 = pasoMoneda(r1.estado, entrada)
    assert.equal(r1.eventos.length, 1)
    assert.equal(r2.eventos.length, 0)
  })
})

describe('valoración y comprar y mantener', () => {
  test('valorCartera usa precios actuales y, si faltan, el de entrada', () => {
    const e = conPosicion()
    const u = e.posiciones.BTC.unidades
    cerca(valorCartera(e, { BTC: 110 }), 8000 + u * 110)
    cerca(valorCartera(e, {}), 8000 + u * e.posiciones.BTC.precioEntrada)
  })
  test('HODL reparte a partes iguales con costes', () => {
    const u = crearHodl(1000, { BTC: 100, ETH: 10 })
    const { comision, deslizamiento } = PARAMETROS_BOT
    cerca(u.BTC, (500 * (1 - comision)) / (100 * (1 + deslizamiento)))
    cerca(valorHodl(u, { BTC: 100, ETH: 10 }), 1000 * (1 - comision) / (1 + deslizamiento))
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/bot.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/bot.js`.

- [ ] **Step 3: Implement** — `core/bot.js`

```js
// @ts-check
// Bot de paper trading: transición pura de estado. No toca red ni base de datos;
// el Worker y el backtest persisten los eventos que devuelve.
import { HORA } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/**
 * @typedef {{ simbolo: string, velaEntrada: number, precioEntrada: number,
 *   unidades: number, coste: number, stopLoss: number, takeProfit: number }} Posicion
 * coste: euros que salieron del saldo al abrir (comisión incluida).
 */
/**
 * @typedef {{ saldo: number, posiciones: Record<string, Posicion>,
 *   ultimaRevisada: Record<string, number>, enfriamientoHasta: Record<string, number> }} Estado
 */
/**
 * @typedef {{ tipo: 'compra'|'venta', simbolo: string, vela: number, precioBase: number,
 *   precio: number, unidades: number, importe: number, comision: number,
 *   deslizamiento: number, motivo: 'senal'|'stop_loss'|'take_profit', saldoTras: number,
 *   stopLoss?: number, takeProfit?: number, pnlNeto?: number, posicion: Posicion }} Evento
 * importe: en compras, euros invertidos (comisión incluida); en ventas, bruto antes de comisión.
 */
/**
 * @typedef {{ simbolo: string, vela: number, veredicto: string, puntuacion: number|null,
 *   indiceConfianza: number|null, accion: 'abrir'|'cerrar'|'ninguna', motivo: string,
 *   precio: number|null }} Decision
 */
/**
 * @typedef {{ veredicto: string, puntuacion: number|null, indiceConfianza: number|null,
 *   atrPct: number|null, fresca: boolean, motivo: string|null }} SenalBot
 */

export const PARAMETROS_BOT = Object.freeze({
  comision: 0.001,
  deslizamiento: 0.0005,
  confianzaMinima: 0.6,
  fraccionPosicion: 0.2,
  ordenMinima: 10,
  multStopLoss: 1.5,
  multTakeProfit: 2.5,
  enfriamientoHoras: 4,
})

/** @param {number} capital @returns {Estado} */
export function estadoInicial(capital) {
  return { saldo: capital, posiciones: {}, ultimaRevisada: {}, enfriamientoHasta: {} }
}

/**
 * Saldo + posiciones valoradas. Si falta el precio de una moneda se usa el de entrada.
 * @param {Estado} estado
 * @param {Record<string, number>} precios
 */
export function valorCartera(estado, precios) {
  let valor = estado.saldo
  for (const p of Object.values(estado.posiciones)) valor += p.unidades * (precios[p.simbolo] ?? p.precioEntrada)
  return valor
}

/** Vela 1H que debe estar cerrada en `ahora`: la de la hora anterior. @param {number} ahora */
export function velaDeDecision(ahora) {
  return Math.floor(ahora / HORA) * HORA - HORA
}

/**
 * @param {Estado} estado (se modifica)
 * @param {Posicion} pos
 * @param {Vela} v
 * @param {number} base precio de salida antes de deslizamiento
 * @param {'senal'|'stop_loss'|'take_profit'} motivo
 * @returns {Evento}
 */
function cerrar(estado, pos, v, base, motivo) {
  const p = PARAMETROS_BOT
  const precio = base * (1 - p.deslizamiento)
  const importe = pos.unidades * precio
  const comision = importe * p.comision
  estado.saldo += importe - comision
  delete estado.posiciones[pos.simbolo]
  if (motivo === 'stop_loss') estado.enfriamientoHasta[pos.simbolo] = v.inicio + p.enfriamientoHoras * HORA
  return {
    tipo: 'venta', simbolo: pos.simbolo, vela: v.inicio, precioBase: base, precio, unidades: pos.unidades,
    importe, comision, deslizamiento: pos.unidades * (base - precio), motivo, saldoTras: estado.saldo,
    pnlNeto: importe - comision - pos.coste, posicion: pos,
  }
}

/**
 * Stop y objetivo dentro de una vela. Si toca ambos, gana el stop (escenario conservador).
 * @param {Posicion} pos
 * @param {Vela} v
 * @returns {{ base: number, motivo: 'stop_loss'|'take_profit' }|null}
 */
export function salidaEnVela(pos, v) {
  if (v.apertura <= pos.stopLoss) return { base: v.apertura, motivo: 'stop_loss' }
  if (v.minimo <= pos.stopLoss) return { base: pos.stopLoss, motivo: 'stop_loss' }
  if (v.apertura >= pos.takeProfit) return { base: v.apertura, motivo: 'take_profit' }
  if (v.maximo >= pos.takeProfit) return { base: pos.takeProfit, motivo: 'take_profit' }
  return null
}

/**
 * Procesa una moneda en una ejecución horaria: primero stops, luego la señal.
 * @param {Estado} estadoPrevio
 * @param {{ simbolo: string, velasEur: Vela[], senal: SenalBot, ahora: number, valorCartera: number }} entrada
 *   velasEur: velas 1H EUR cerradas en `ahora`, ordenadas.
 * @returns {{ estado: Estado, eventos: Evento[], decision: Decision }}
 */
export function pasoMoneda(estadoPrevio, { simbolo, velasEur, senal, ahora, valorCartera: valor }) {
  const p = PARAMETROS_BOT
  /** @type {Estado} */
  const estado = structuredClone(estadoPrevio)
  /** @type {Evento[]} */
  const eventos = []
  const vela = velaDeDecision(ahora)
  const revisada = estado.ultimaRevisada[simbolo] ?? -Infinity
  const nuevas = velasEur.filter((v) => v.inicio > revisada)

  let cerradaPorStop = false
  const abierta = estado.posiciones[simbolo]
  if (abierta) {
    for (const v of nuevas) {
      if (v.inicio <= abierta.velaEntrada) continue
      const salida = salidaEnVela(abierta, v)
      if (salida) {
        eventos.push(cerrar(estado, abierta, v, salida.base, salida.motivo))
        cerradaPorStop = true
        break
      }
    }
  }
  if (nuevas.length > 0) estado.ultimaRevisada[simbolo] = nuevas[nuevas.length - 1].inicio

  const ultima = velasEur[velasEur.length - 1]
  const fresca = senal.fresca && ultima !== undefined && ultima.inicio === vela
  const precio = fresca ? ultima.cierre : null
  /** @param {'abrir'|'cerrar'|'ninguna'} accion @param {string} motivo @returns {Decision} */
  const decidir = (accion, motivo) => ({
    simbolo, vela, veredicto: senal.veredicto, puntuacion: senal.puntuacion,
    indiceConfianza: senal.indiceConfianza, accion, motivo, precio,
  })

  if (senal.veredicto === 'SIN_DATOS') return { estado, eventos, decision: decidir('ninguna', 'sin_datos') }
  if (!fresca) return { estado, eventos, decision: decidir('ninguna', 'datos_desactualizados') }
  const posicion = estado.posiciones[simbolo]

  if (senal.veredicto === 'VENDER') {
    if (!posicion) return { estado, eventos, decision: decidir('ninguna', cerradaPorStop ? 'cerrada_por_stop' : 'sin_posicion') }
    eventos.push(cerrar(estado, posicion, ultima, ultima.cierre, 'senal'))
    return { estado, eventos, decision: decidir('cerrar', 'cerrada') }
  }
  if (senal.veredicto !== 'COMPRAR') {
    return { estado, eventos, decision: decidir('ninguna', senal.motivo ?? 'mantener') }
  }
  if (posicion) return { estado, eventos, decision: decidir('ninguna', 'ya_en_posicion') }
  if (cerradaPorStop) return { estado, eventos, decision: decidir('ninguna', 'cerrada_por_stop') }
  if (vela < (estado.enfriamientoHasta[simbolo] ?? -Infinity)) return { estado, eventos, decision: decidir('ninguna', 'enfriamiento') }
  if ((senal.indiceConfianza ?? 0) < p.confianzaMinima) return { estado, eventos, decision: decidir('ninguna', 'confianza_baja') }
  const importe = Math.min(p.fraccionPosicion * valor, estado.saldo)
  if (importe < p.ordenMinima) return { estado, eventos, decision: decidir('ninguna', 'saldo_insuficiente') }

  const atrPct = /** @type {number} */ (senal.atrPct)
  const precioEntrada = ultima.cierre * (1 + p.deslizamiento)
  const comision = importe * p.comision
  const unidades = (importe - comision) / precioEntrada
  /** @type {Posicion} */
  const nueva = {
    simbolo, velaEntrada: ultima.inicio, precioEntrada, unidades, coste: importe,
    stopLoss: precioEntrada * (1 - p.multStopLoss * atrPct),
    takeProfit: precioEntrada * (1 + p.multTakeProfit * atrPct),
  }
  estado.saldo -= importe
  estado.posiciones[simbolo] = nueva
  eventos.push({
    tipo: 'compra', simbolo, vela: ultima.inicio, precioBase: ultima.cierre, precio: precioEntrada, unidades,
    importe, comision, deslizamiento: unidades * (precioEntrada - ultima.cierre), motivo: 'senal',
    saldoTras: estado.saldo, stopLoss: nueva.stopLoss, takeProfit: nueva.takeProfit, posicion: nueva,
  })
  return { estado, eventos, decision: decidir('abrir', 'abierta') }
}

/**
 * Comprar y mantener: capital a partes iguales entre las monedas, con costes.
 * @param {number} capital
 * @param {Record<string, number>} precios
 * @returns {Record<string, number>} unidades por moneda
 */
export function crearHodl(capital, precios) {
  const p = PARAMETROS_BOT
  const monedas = Object.keys(precios)
  /** @type {Record<string, number>} */
  const unidades = {}
  for (const m of monedas) {
    const importe = capital / monedas.length
    unidades[m] = (importe * (1 - p.comision)) / (precios[m] * (1 + p.deslizamiento))
  }
  return unidades
}

/** @param {Record<string, number>} unidades @param {Record<string, number>} precios */
export function valorHodl(unidades, precios) {
  return Object.entries(unidades).reduce((s, [m, u]) => s + u * precios[m], 0)
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test test/bot.test.js`
Expected: PASS — 23 tests in this file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Commit**

```bash
git add core/bot.js test/bot.test.js
git commit -m "feat(core): bot de paper trading con stops conservadores" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Métricas

**Files:**
- Create: `core/metricas.js`
- Test: `test/metricas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (`core/metricas.js`):
  - `drawdownMaximo(valores: number[]): number` (0,25 = −25 %)
  - typedef `OperacionMetrica { tipo: 'compra'|'venta', simbolo, comision, deslizamiento, pnlNeto? }`
  - `calcularMetricas({ capitalInicial, saldo, abiertas: { unidades, coste, precioActual }[], operaciones: OperacionMetrica[], curva: { t, valor, hodl: number|null }[] })` → `{ valorCartera, saldo, operaciones, cerradas, ganadoras, perdedoras, beneficioRealizado, beneficioMedio, comisiones, deslizamiento, beneficioNoRealizado, rentabilidad, rentabilidadHodl, drawdownMaximo, drawdownMaximoHodl, operacionesPorSemana }`
  - `metricasPorMoneda(operaciones) → Record<simbolo, { operaciones, cerradas, ganadoras, perdedoras, beneficioRealizado, beneficioMedio, comisiones, deslizamiento }>`
- Una venta con `pnlNeto <= 0` cuenta como perdedora.

- [ ] **Step 1: Write the failing test** — `test/metricas.test.js`

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { calcularMetricas, drawdownMaximo, metricasPorMoneda } from '../core/metricas.js'

const DIA = 24 * 3_600_000

describe('drawdownMaximo', () => {
  test('mayor caída desde un máximo previo', () => {
    assert.equal(drawdownMaximo([100, 120, 90, 130, 117]), 0.25) // 120 → 90
  })
  test('siempre al alza: 0', () => {
    assert.equal(drawdownMaximo([1, 2, 3]), 0)
  })
  test('vacía: 0', () => {
    assert.equal(drawdownMaximo([]), 0)
  })
})

describe('calcularMetricas', () => {
  const operaciones = /** @type {import('../core/metricas.js').OperacionMetrica[]} */ ([
    { tipo: 'compra', simbolo: 'BTC', comision: 2, deslizamiento: 1 },
    { tipo: 'venta', simbolo: 'BTC', comision: 2, deslizamiento: 1, pnlNeto: 100 },
    { tipo: 'compra', simbolo: 'ETH', comision: 2, deslizamiento: 1 },
    { tipo: 'venta', simbolo: 'ETH', comision: 2, deslizamiento: 1, pnlNeto: -40 },
    { tipo: 'compra', simbolo: 'BTC', comision: 2, deslizamiento: 1 },
  ])
  const m = calcularMetricas({
    capitalInicial: 10_000,
    saldo: 8_060,
    abiertas: [{ unidades: 10, coste: 2_000, precioActual: 210 }],
    operaciones,
    curva: [
      { t: 0, valor: 10_000, hodl: 10_000 },
      { t: 7 * DIA, valor: 9_000, hodl: 11_000 },
      { t: 14 * DIA, valor: 10_160, hodl: 9_900 },
    ],
  })
  test('valor, rentabilidad y no realizado', () => {
    assert.equal(m.valorCartera, 10_160)
    assert.ok(Math.abs(m.rentabilidad - 0.016) < 1e-12)
    assert.equal(m.beneficioNoRealizado, 100)
  })
  test('ganadoras, perdedoras, beneficio medio y costes', () => {
    assert.equal(m.ganadoras, 1)
    assert.equal(m.perdedoras, 1)
    assert.equal(m.beneficioRealizado, 60)
    assert.equal(m.beneficioMedio, 30)
    assert.equal(m.comisiones, 10)
    assert.equal(m.deslizamiento, 5)
  })
  test('comprar y mantener, drawdown y frecuencia', () => {
    assert.ok(Math.abs(/** @type {number} */ (m.rentabilidadHodl) - -0.01) < 1e-12)
    assert.equal(m.drawdownMaximo, 0.1)
    assert.ok(Math.abs(/** @type {number} */ (m.drawdownMaximoHodl) - 0.1) < 1e-12)
    assert.equal(m.operacionesPorSemana, 2.5)
  })
  test('por moneda', () => {
    const p = metricasPorMoneda(operaciones)
    assert.equal(p.BTC.operaciones, 3)
    assert.equal(p.BTC.beneficioRealizado, 100)
    assert.equal(p.ETH.perdedoras, 1)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/metricas.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/metricas.js`.

- [ ] **Step 3: Implement** — `core/metricas.js`

```js
// @ts-check
// Métricas de evaluación de una simulación (en vivo o backtest).

const SEMANA = 7 * 24 * 3_600_000

/**
 * Mayor caída relativa desde un máximo previo (0,25 = −25 %).
 * @param {number[]} valores
 */
export function drawdownMaximo(valores) {
  let maximo = -Infinity
  let peor = 0
  for (const v of valores) {
    if (v > maximo) maximo = v
    if (maximo > 0) peor = Math.max(peor, (maximo - v) / maximo)
  }
  return peor
}

/**
 * @typedef {{ tipo: 'compra'|'venta', simbolo: string, comision: number,
 *   deslizamiento: number, pnlNeto?: number }} OperacionMetrica
 */

/**
 * @param {OperacionMetrica[]} operaciones
 */
function resumenOperaciones(operaciones) {
  const ventas = operaciones.filter((o) => o.tipo === 'venta')
  const pnl = ventas.map((o) => /** @type {number} */ (o.pnlNeto))
  const beneficioRealizado = pnl.reduce((s, x) => s + x, 0)
  return {
    operaciones: operaciones.length,
    cerradas: ventas.length,
    ganadoras: pnl.filter((x) => x > 0).length,
    perdedoras: pnl.filter((x) => x <= 0).length,
    beneficioRealizado,
    beneficioMedio: ventas.length ? beneficioRealizado / ventas.length : null,
    comisiones: operaciones.reduce((s, o) => s + o.comision, 0),
    deslizamiento: operaciones.reduce((s, o) => s + o.deslizamiento, 0),
  }
}

/**
 * @param {{ capitalInicial: number, saldo: number,
 *   abiertas: { unidades: number, coste: number, precioActual: number }[],
 *   operaciones: OperacionMetrica[],
 *   curva: { t: number, valor: number, hodl: number|null }[] }} datos
 */
export function calcularMetricas({ capitalInicial, saldo, abiertas, operaciones, curva }) {
  const valorAbiertas = abiertas.reduce((s, p) => s + p.unidades * p.precioActual, 0)
  const valorCartera = saldo + valorAbiertas
  const ultimoHodl = [...curva].reverse().find((p) => p.hodl !== null)?.hodl ?? null
  const hodls = curva.map((p) => p.hodl).filter((h) => h !== null)
  const duracion = curva.length > 1 ? curva[curva.length - 1].t - curva[0].t : 0
  const resumen = resumenOperaciones(operaciones)
  return {
    valorCartera,
    saldo,
    ...resumen,
    beneficioNoRealizado: abiertas.reduce((s, p) => s + p.unidades * p.precioActual - p.coste, 0),
    rentabilidad: valorCartera / capitalInicial - 1,
    rentabilidadHodl: ultimoHodl === null ? null : ultimoHodl / capitalInicial - 1,
    drawdownMaximo: drawdownMaximo(curva.map((p) => p.valor)),
    drawdownMaximoHodl: hodls.length ? drawdownMaximo(/** @type {number[]} */ (hodls)) : null,
    operacionesPorSemana: duracion > 0 ? operaciones.length / (duracion / SEMANA) : null,
  }
}

/**
 * Resumen por moneda.
 * @param {OperacionMetrica[]} operaciones
 */
export function metricasPorMoneda(operaciones) {
  /** @type {Record<string, ReturnType<typeof resumenOperaciones>>} */
  const salida = {}
  for (const simbolo of new Set(operaciones.map((o) => o.simbolo))) {
    salida[simbolo] = resumenOperaciones(operaciones.filter((o) => o.simbolo === simbolo))
  }
  return salida
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test test/metricas.test.js`
Expected: PASS — 7 tests in this file.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Commit**

```bash
git add core/metricas.js test/metricas.test.js
git commit -m "feat(core): métricas de evaluación" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 6: Motor de backtest

**Files:**
- Create: `core/backtest.js`
- Test: `test/backtest.test.js`

**Interfaces:**
- Consumes: `core/bot.js` (`PARAMETROS_BOT, crearHodl, estadoInicial, pasoMoneda, valorCartera, valorHodl`, typedef `Evento`), `core/estrategia-v1.js` (`PARAMETROS, VERSION, calcularSenal`), `core/metricas.js` (`calcularMetricas, metricasPorMoneda`), `core/velas.js` (`HORA`), `test/ayudantes.js` (`serie`).
- Produces (`core/backtest.js`):
  - typedef `SerieMoneda = { '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }` (1h/4h/1d en USDT para indicadores; `eur` = 1H EUR para ejecución)
  - `ejecutarBacktest({ series: Record<string, SerieMoneda>, fng: { t, valor }[], desde, hasta, capitalInicial = 10_000, ventana = 500 })` → `{ version, variante: 'tecnico+fng', parametros: { estrategia, bot }, desde, hasta, capitalInicial, monedas, metricas, porMoneda, decisiones: Record<'VEREDICTO:motivo', number>, curvaDiaria: { t, valor, hodl }[], operaciones }`
- Evalúa cada hora en punto + 3 min (igual que el cron), con ventanas de 500 velas (igual que en vivo), `derivados: null` y `titulares: []`. Comprar y mantener se crea en la primera hora con precio EUR de todas las monedas.

- [ ] **Step 1: Write the failing test** — `test/backtest.test.js`

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ejecutarBacktest } from '../core/backtest.js'
import { HORA } from '../core/velas.js'
import { serie } from './ayudantes.js'

const DIA = 24 * HORA
const INICIO = 1000 * DIA

/** Serie de una moneda: sube 30 días, cae 30 días, con datos de calentamiento previos. @param {number} base */
function moneda(base) {
  /** @param {number} t */
  const precio = (t) => {
    const dias = (t - INICIO) / DIA
    const pico = dias < 30 ? dias : 60 - dias
    return base * (1 + 0.01 * pico) * (1 + 0.003 * Math.sin(t / HORA))
  }
  /** @param {number} dur @param {number} desde @param {number} hasta */
  const tramo = (dur, desde, hasta) => serie(Math.floor((hasta - desde) / dur), (i) => precio(desde + (i + 1) * dur), { duracion: dur, inicio: desde })
  const fin = INICIO + 60 * DIA
  return {
    '1h': tramo(HORA, INICIO - 25 * DIA, fin),
    '4h': tramo(4 * HORA, INICIO - 90 * DIA, fin),
    '1d': tramo(DIA, INICIO - 260 * DIA, fin),
    eur: tramo(HORA, INICIO - 2 * DIA, fin).map((v) => ({ ...v, apertura: v.apertura * 0.9, maximo: v.maximo * 0.9, minimo: v.minimo * 0.9, cierre: v.cierre * 0.9 })),
  }
}

const series = { BTC: moneda(100), ETH: moneda(10) }
const fng = Array.from({ length: 400 }, (_, i) => ({ t: INICIO - 300 * DIA + i * DIA, valor: 50 }))

describe('ejecutarBacktest', () => {
  const desde = INICIO
  const hasta = INICIO + 40 * DIA
  const r = ejecutarBacktest({ series, fng, desde, hasta })

  test('una evaluación por hora, en el minuto 3, con comprar y mantener desde el inicio', () => {
    assert.equal(Object.values(r.decisiones).reduce((s, n) => s + n, 0), 40 * 24 * 2)
    assert.equal(r.curvaDiaria[0].t % DIA, 23 * HORA + 3 * 60_000)
    assert.ok(r.curvaDiaria.every((p) => p.hodl !== null))
  })
  test('etiqueta variante y versión', () => {
    assert.equal(r.variante, 'tecnico+fng')
    assert.equal(r.version, 'v1')
  })
  test('opera y la contabilidad cuadra: valor = saldo + abiertas', () => {
    assert.ok(r.metricas.operaciones > 0)
    assert.ok(r.metricas.saldo >= 0)
    const ultima = r.curvaDiaria[r.curvaDiaria.length - 1]
    assert.ok(Math.abs(ultima.valor - r.metricas.valorCartera) < 1e-6)
  })
  test('sin información futura: los datos posteriores a "hasta" no cambian nada', () => {
    const corte = hasta
    /** @param {import('../core/velas.js').Vela[]} v */
    const truncar = (v) => v.filter((x) => x.fin <= corte)
    const truncadas = Object.fromEntries(Object.entries(series).map(([m, s]) => [m, {
      '1h': truncar(s['1h']), '4h': truncar(s['4h']), '1d': truncar(s['1d']), eur: truncar(s.eur),
    }]))
    const r2 = ejecutarBacktest({ series: truncadas, fng: fng.filter((f) => f.t <= corte), desde, hasta })
    assert.deepEqual(r2, r)
  })
})
```

- [ ] **Step 2: Run it and verify it fails**

Run: `node --test test/backtest.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `core/backtest.js`.

- [ ] **Step 3: Implement** — `core/backtest.js`

```js
// @ts-check
// Backtest hora a hora con el mismo motor que el Worker. Solo ve velas cerradas.
import { PARAMETROS_BOT, crearHodl, estadoInicial, pasoMoneda, valorCartera, valorHodl } from './bot.js'
import { PARAMETROS, VERSION, calcularSenal } from './estrategia-v1.js'
import { calcularMetricas, metricasPorMoneda } from './metricas.js'
import { HORA } from './velas.js'

/** @typedef {import('./velas.js').Vela} Vela */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} SerieMoneda */

const MINUTO_CRON = 3 * 60_000
const DIA = 24 * HORA

/**
 * @param {{ series: Record<string, SerieMoneda>, fng: { t: number, valor: number }[],
 *   desde: number, hasta: number, capitalInicial?: number, ventana?: number }} entrada
 *   desde/hasta en ms; se evalúa cada hora en punto + 3 min, como el cron.
 */
export function ejecutarBacktest({ series, fng, desde, hasta, capitalInicial = 10_000, ventana = 500 }) {
  const monedas = Object.keys(series)
  /** @type {Record<string, Record<keyof SerieMoneda, number>>} */
  const punteros = Object.fromEntries(monedas.map((m) => [m, { '1h': 0, '4h': 0, '1d': 0, eur: 0 }]))
  let punteroFng = 0
  let estado = estadoInicial(capitalInicial)
  /** @type {Record<string, number>|null} */
  let hodl = null
  /** @type {{ t: number, valor: number, hodl: number|null }[]} */
  const curva = []
  /** @type {Omit<import('./bot.js').Evento, 'posicion'>[]} */
  const operaciones = []
  /** @type {Record<string, number>} */
  const decisiones = {}

  for (let h = Math.ceil(desde / HORA) * HORA; h + MINUTO_CRON <= hasta; h += HORA) {
    const ahora = h + MINUTO_CRON
    /** @type {Record<string, number>} */
    const precios = {}
    for (const m of monedas) {
      const p = punteros[m]
      for (const tf of /** @type {(keyof SerieMoneda)[]} */ (['1h', '4h', '1d', 'eur'])) {
        const velas = series[m][tf]
        while (p[tf] < velas.length && velas[p[tf]].fin <= ahora) p[tf]++
      }
      if (p.eur > 0) precios[m] = series[m].eur[p.eur - 1].cierre
    }
    while (punteroFng < fng.length && fng[punteroFng].t <= ahora) punteroFng++
    const valorFng = punteroFng > 0 ? fng[punteroFng - 1].valor : null

    if (hodl === null && Object.keys(precios).length === monedas.length) hodl = crearHodl(capitalInicial, precios)

    const valor = valorCartera(estado, precios)
    for (const m of monedas) {
      const p = punteros[m]
      /** @param {keyof SerieMoneda} tf @param {number} n */
      const ultimas = (tf, n) => series[m][tf].slice(Math.max(0, p[tf] - n), p[tf])
      const senal = calcularSenal({
        simbolo: m,
        ahora,
        velas: { '1h': ultimas('1h', ventana), '4h': ultimas('4h', ventana), '1d': ultimas('1d', ventana) },
        derivados: null,
        titulares: [],
        fng: valorFng,
      })
      const paso = pasoMoneda(estado, { simbolo: m, velasEur: ultimas('eur', 24), senal, ahora, valorCartera: valor })
      estado = paso.estado
      for (const { posicion: _, ...ev } of paso.eventos) operaciones.push(ev)
      const clave = `${paso.decision.veredicto}:${paso.decision.motivo}`
      decisiones[clave] = (decisiones[clave] ?? 0) + 1
    }
    curva.push({ t: ahora, valor: valorCartera(estado, precios), hodl: hodl ? valorHodl(hodl, precios) : null })
  }

  const preciosFinales = Object.fromEntries(monedas.map((m) => {
    const p = punteros[m]
    return [m, p.eur > 0 ? series[m].eur[p.eur - 1].cierre : NaN]
  }))
  const abiertas = Object.values(estado.posiciones).map((p) => ({
    unidades: p.unidades, coste: p.coste, precioActual: preciosFinales[p.simbolo],
  }))
  const opsMetricas = operaciones.map((o) => ({
    tipo: o.tipo, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnlNeto,
  }))
  return {
    version: VERSION,
    variante: 'tecnico+fng',
    parametros: { estrategia: PARAMETROS, bot: PARAMETROS_BOT },
    desde,
    hasta,
    capitalInicial,
    monedas,
    metricas: calcularMetricas({ capitalInicial, saldo: estado.saldo, abiertas, operaciones: opsMetricas, curva }),
    porMoneda: metricasPorMoneda(opsMetricas),
    decisiones,
    curvaDiaria: curva.filter((p, i) => i === curva.length - 1 || Math.floor(p.t / DIA) !== Math.floor((curva[i + 1]?.t ?? 0) / DIA)),
    operaciones,
  }
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `node --test test/backtest.test.js`
Expected: PASS — 4 tests in this file (≈1 s).

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: all tests pass, 0 fail.

- [ ] **Commit**

```bash
git add core/backtest.js test/backtest.test.js
git commit -m "feat(core): backtest hora a hora sin información futura" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 7: Script de backtest con datos reales

**Files:**
- Create: `scripts/backtest.mjs`
- Modify: `README.md` (añadir la sección Backtest al final)
- Create (generado): `data/backtest-v1.json`

**Interfaces:**
- Consumes: `core/backtest.js` (`ejecutarBacktest`, typedef `SerieMoneda`), `core/velas.js` (`HORA, desdeBinance`).
- Produces: `data/backtest-v1.json` = salida de `ejecutarBacktest` + `generadoEn` + `aviso`. La PWA (plan 3) lo leerá tal cual.
- Red: `https://data-api.binance.vision/api/v3/klines` (paginado de 1000 en 1000, `startTime`/`endTime`) y `https://api.alternative.me/fng/?limit=0&format=json`. Caché en `scripts/.cache/<par>-<intervalo>-<inicio>-<fin>.json` (ignorado por git).
- Calentamiento antes de `desde`: 1H −22 días, 4H −90 días, 1D −520 días (≥ 500 velas por timeframe), EUR −2 días.

Este script es E/S pura sobre un motor ya probado en la Task 6; su verificación es ejecutarlo de verdad.

- [ ] **Step 1: Write the script** — `scripts/backtest.mjs`

```js
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
```

- [ ] **Step 2: Append to README** — al final de `README.md`:

```markdown
## Backtest

```bash
npm run backtest                                   # últimos 2 años, 5 monedas
npm run backtest -- --desde 2025-01-01 --monedas BTC,ETH --capital 5000
```

Descarga histórico real de Binance (pares USDT para indicadores, EUR para ejecución) y de
Fear & Greed, lo cachea en `scripts/.cache/` y escribe `data/backtest-v1.json`.

El backtest evalúa la variante **técnico + Fear & Greed**: no hay histórico gratuito fiable de
titulares ni de derivados, así que esos componentes no participan (sus pesos se renormalizan).
```

- [ ] **Step 3: Quick run (smoke test, ~30 días, 1 moneda)**

Run: `npm run backtest -- --desde 2026-09-01 --monedas BTC`
Expected: imprime `Descargando BTC… N velas 1h`, luego las líneas de rentabilidad/drawdown/operaciones y escribe `data/backtest-v1.json`. Un segundo lanzamiento idéntico no vuelve a descargar (caché).

- [ ] **Step 4: Full run (2 años, 5 monedas)**

Run: `npm run backtest`
Expected: termina sin errores; cálculo ≈ 15–30 s más la descarga la primera vez. Referencia del 2026-10-18 (v1): rentabilidad −18,5 % frente a +20,5 % de comprar y mantener, drawdown 35,5 % frente a 64,5 %, 718 operaciones (6,9/semana), 138/221 ganadoras/perdedoras, ~2.000 € de costes. Los valores cambiarán según la fecha; lo que se verifica es que el script termina y que el JSON tiene `metricas`, `porMoneda`, `decisiones`, `curvaDiaria` y `operaciones`.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 88 tests, 0 fail.

- [ ] **Commit**

```bash
git add scripts/backtest.mjs README.md data/backtest-v1.json
git commit -m "feat: backtest con histórico real de Binance y Fear & Greed" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Hallazgo del backtest de verificación (para el plan de la estrategia v2, no para este)

Con v1, las 359 posiciones cerradas salieron todas por stop (221 SL, 138 TP) y **ninguna por señal VENDER**. Con SL 1,5×ATR y TP 2,5×ATR, el punto de equilibrio antes de costes es acertar un 37,5 %, y v1 acierta un 38 %: los costes (~20 % del capital en 2 años, por 6,9 operaciones/semana) deciden el resultado. Las palancas a estudiar con datos en v2 son la frecuencia, la distancia de los stops y el filtro de entrada. Se ajustarán con backtest, no a ojo, y se publicarán como `VERSION = 'v2'` sin tocar v1.

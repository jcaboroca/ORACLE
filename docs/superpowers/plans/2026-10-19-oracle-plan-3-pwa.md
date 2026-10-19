# ORACLE — Plan 3: PWA

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La interfaz de ORACLE como PWA instalable en el iPhone (icono de inicio incluido) y en Android: acceso con PIN, Panel, detalle de moneda con gráficos, Bot y Backtest (spec §12), servida por GitHub Pages en <https://jcaboroca.github.io/ORACLE/> y alimentada por la API del Worker del plan 2.

**Architecture:** PWA estática en la raíz del repositorio, sin build: `index.html` + `styles.css` + módulos ES en `js/`. Toda la lógica de la interfaz es pura y se prueba en Node (`js/formato.js`, `api.js`, `sesion.js`, `rutas.js`, `refresco.js`, `series.js`, `senal.js`, `cartera.js`); el DOM queda en capas finas (`js/dom.js`, `js/graficos.js`, `js/vistas/*.js`, `js/app.js`). El navegador importa directamente módulos ya probados del repositorio: `core/indicadores.js` (EMA/RSI del gráfico, los mismos de la señal), `core/estrategias.js` (pesos T/D/N/F y versiones) y `worker/src/fuentes/binance.js` (velas validadas). El cliente de la API se prueba **contra el Worker real** (`worker/src/api.js` sobre el D1 simulado y el escenario de sus tests), así que las formas que pinta la PWA son las del «Contrato de la API» por construcción. El service worker guarda solo la estructura de la app; los datos siempre van a la red.

**Tech Stack:** HTML, CSS y JavaScript (ES2023, módulos ES, `// @ts-check`), TradingView Lightweight Charts™ v5.2.1 (standalone, Apache-2.0) en `vendor/`, Service Worker y Web App Manifest, GitHub Pages. Node ≥ 22.13, `node:test`, cero dependencias npm.

**Spec:** `docs/superpowers/specs/2026-10-18-oracle-design.md` (§12 Interfaz; §6 y §6.5-6.6 para el desglose T/D/N/F, la renormalización y v2; §7.2 vocabulario de decisiones; §7.7 métricas; §8 backtest; §9 refresco y presupuesto; §11 API; §13 errores). Contrato de la API: sección «Contrato de la API» de `docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md`, confirmado contra `worker/src/api.js`.

**Plan series:** 1) núcleo + backtest (hecho) · 2) Worker + D1 (hecho) · **3) PWA (este)**.

**Prerrequisito:** `main` contiene el Worker del plan 2 y sus tests pasan:

```bash
npm test
```

Esperado: `ℹ tests 240`, `ℹ fail 0`.

**Verified:** todo el código de este plan se ejecutó antes de escribirlo. Un script reprodujo **este mismo documento** sobre una copia limpia de `main` @ `e18b080` (Node 24.6): aplicó cada bloque en orden, ejecutó cada `Run:` y comprobó su `Expected:` (cada test falla donde el plan lo dice —`ERR_MODULE_NOT_FOUND` o `ENOENT`— y pasa con el número de tests indicado; la descarga de `vendor/` da los SHA-256 indicados) e hizo los 10 commits sin dejar nada fuera; el resultado es idéntico, archivo a archivo, al código validado. Resultado final: `npm test` = 332 tests en verde (240 del núcleo y el Worker + 92 de la PWA), también con el `fetch` global sustituido por uno que solo deja pasar `127.0.0.1` (los únicos servidores que tocan los tests son los de desarrollo, en local). `tsc 5.6 --strict --checkJs` sobre `js/app.js` y todo su grafo: 0 errores. Además se recorrió la app publicada por la réplica en Chromium a 440 px de ancho con `npm run dev` + `npm run api-simulada`: acceso (PIN erróneo → «Quedan N intentos»), Panel, Moneda con velas reales de Binance (BTC/EUR y ETH/EUR, 1H/4H/1D), Bot (filtros, reinicio con 50 → error de límites y 5.000 → simulación 2), Backtest v1/v2, PIN caducado → acceso gastando un solo intento, service worker con solo las 34 entradas de la estructura y recarga sin conexión con la estructura y el aviso de red: ningún error en la consola. Esa prueba destapó dos fallos que los tests no veían y ya están corregidos aquí: una línea que empezaba por `(` (sin punto y coma se pegaba a la anterior) y las 4 peticiones en paralelo de la vista Bot que, con un PIN caducado, gastaban 4 de los 5 intentos.

## Global Constraints

- Node ≥ 22.13 (los tests de la PWA reutilizan el D1 simulado con `node:sqlite` del plan 2). Cero dependencias npm; la única librería es Lightweight Charts, copiada en `vendor/` y fijada por SHA-256.
- ES modules, `// @ts-check` en la primera línea de cada `.js` de `js/` y `config.js`, sin punto y coma, comillas simples, identificadores y textos en español. **Sin punto y coma, ninguna línea puede empezar por `(`, `[` o `` ` ``** (el test de vistas compila `js/app.js` con `node --check`; un `/** @type */ (x).y = …` al principio de línea se pega a la anterior).
- Rutas siempre relativas (`js/app.js`, `icons/…`, `data/…`): la app vive bajo `/ORACLE/` en GitHub Pages.
- Nunca precios inventados: si Binance no da el par en euros se usa el USDT **y se indica**; si no da ninguno, aviso en lugar del gráfico. `null` de la API → «—», nunca 0.
- El texto que viene de fuera (titulares, explicaciones) entra siempre como texto (`createElement`/`append`), nunca como HTML; los enlaces de titulares solo si son `http(s)`.
- Refresco: al abrir y cada 5 min **solo con la página visible** (Page Visibility API). Nada en segundo plano.
- El service worker guarda solo la estructura de la app (caché versionada `oracle-vN`); nunca la API, Binance ni `data/*.json`.
- Aviso fijo en el pie de todas las pantallas: «Simulación. No es asesoramiento financiero ni garantía de beneficio.» El índice de confianza siempre se muestra como «(sin calibrar)».
- Accesible: etiquetas en todos los controles, foco visible, títulos por sección, color nunca solo (veredicto con texto), `prefers-reduced-motion`, objetivos táctiles ≥ 44 px, `env(safe-area-inset-*)`.
- Commits con el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Decisiones de diseño (vinculantes para las tareas)

1. **El contrato se prueba con el Worker real.** `test/pwa/ayudantes.js` monta `worker/src/api.js` sobre el D1 simulado (`worker/test/d1.js`) con 6 horas del escenario de los tests del Worker (`worker/test/escenario.js`: BTC cierra por stop-loss, ETH por take-profit) y lo expone como `fetch`. Los tests del cliente, de la señal y de la cartera usan esas respuestas, no fixtures escritos a mano. Si el Worker cambia una forma, fallan.
2. **Hora del servidor.** «Hace 5 min» se calcula con `resumen.ahora` (Panel) y con el desfase servidor-dispositivo que `js/app.js` guarda en cada `resumen` (resto de vistas): un reloj del móvil desajustado no marca datos frescos como viejos.
3. **PIN.** Se comprueba con `GET /api/resumen` antes de guardarlo. 401 o 429 `bloqueado` en cualquier vista → se olvida el PIN y se vuelve al acceso con el mensaje del Worker («PIN incorrecto. Quedan N intentos.» o «bloqueado hasta las HH:MM»). La vista Bot pide primero `/api/bot` **sola** y luego el resto en paralelo: con un PIN caducado, 4 peticiones simultáneas gastarían 4 de los 5 intentos antes del bloqueo (lo destapó la prueba en navegador).
4. **«Analizar ahora».** `POST /api/analizar`; con 429 `demasiado_pronto` muestra «Vuelve a probar a las HH:MM» y deja el botón desactivado hasta `hasta` (como mucho 5 min). Tras analizar, se repinta el Panel; recuerda que analizar no opera.
5. **Velas del gráfico** (§9: del navegador a Binance): `velasDeMoneda` usa `descargarVelas` de `worker/src/fuentes/binance.js` (misma validación de filas que el Worker), 500 velas de `{SYM}EUR` y, si falla o viene vacío, `{SYM}USDT` marcado como respaldo. Se pinta también la vela en curso (es un gráfico, no una decisión) y se avisa. EMA20/50/200 y RSI14 con `core/indicadores.js`. Precios del eje en formato español.
6. **Barras T/D/N/F**: valor en [-1, 1], ausentes rayados con «Ausente», y el peso renormalizado que de verdad usó la señal (peso / Σ pesos presentes, §6.5), con los pesos de la estrategia de la señal (`ESTRATEGIAS[version].PARAMETROS.pesos`).
7. **Service worker**: red primero para los archivos de `ESTRUCTURA` (una versión nueva entra sin trucos) y, sin red, la copia guardada; lo demás no se intercepta. `ESTRUCTURA` incluye cada módulo que importa `js/app.js` (también los de `core/` y `worker/src/fuentes/binance.js`); un test recorre el grafo de imports y lo exige. Al cambiar un archivo de la estructura se sube `VERSION`.
8. **Refresco**: `js/refresco.js` (puro, con reloj inyectado) repinta Panel, Moneda o Bot cada 5 min si la página está visible, salvo con el diálogo de reinicio abierto o un control con el foco. Navegar reinicia la cuenta. El repintado conserva el desplazamiento pero no las páginas extra de «Cargar más» (limitación aceptada).
9. **Iconos**: `icons/icono.svg` es la fuente (bola de cristal turquesa con tres velas al alza y peana dorada sobre fondo `#0b0f17`). En este Mac no hay `rsvg-convert` ni `magick` (solo `sips` y `qlmanage`, que no rasterizan SVG de forma fiable), así que `scripts/iconos.mjs` lee ese subconjunto de SVG (`rect`, `circle`, `polygon`), lo rasteriza con 4×4 muestras por píxel y escribe PNG RGB **opacos** con `node:zlib`. Un test vuelve a rasterizar el SVG y exige que los PNG del repositorio sean idénticos píxel a píxel, y que el maskable quepa en el círculo seguro del 40 %.
10. **Lightweight Charts v5.2.1** (`standalone`, global `LightweightCharts`), fijada por SHA-256 en un test. Atribución que exige su licencia: `layout.attributionLogo: true` (logo con enlace a tradingview.com en cada gráfico) y, bajo cada gráfico, el texto del archivo NOTICE con enlace (`js/vistas/comun.js`). `LICENSE` y `NOTICE` se copian en `vendor/`.
11. **`config.js`**: `API_PRODUCCION = ''` hasta desplegar (la app avisa de que falta); en `localhost`/`127.0.0.1` usa `http://localhost:8787` (`wrangler dev` o la API simulada). El Worker ya permite por CORS `https://jcaboroca.github.io` y `http://localhost:8080` (var `ORIGENES`).
12. **Desarrollo local**: `scripts/servir.mjs` (estático en :8080, como el de Bajamar) y `scripts/api-simulada.mjs` (:8787): el Worker real sobre D1 en memoria con el escenario **sintético** de los tests, PIN `4815162342`. Solo para probar la interfaz; la PWA publicada nunca la usa. `.nojekyll` evita el procesado Jekyll de GitHub Pages.

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `package.json` | `npm test` también sobre `test/pwa/*.test.js`; scripts `iconos`, `dev`, `api-simulada` | 1, 7, 10 |
| `config.js` | `API_PRODUCCION`, `API_LOCAL`, `baseApi(location)` | 1 |
| `js/formato.js` | euros, precios, porcentajes, fechas en hora de Madrid, «hace…», `leerImporte` | 1 |
| `test/pwa/formato.test.js` | formatos y config | 1 |
| `test/pwa/ayudantes.js` | el Worker real como `fetch` (solo tests y API simulada) | 2 |
| `js/api.js` | `crearApi`, `ErrorApi`, `pideLogin`, `mensajeError` | 2 |
| `js/sesion.js` | PIN en `localStorage` (o en memoria) | 2 |
| `test/pwa/api.test.js` | cliente contra el Worker real; sesión | 2 |
| `js/rutas.js` | rutas por hash y parámetros | 3 |
| `js/refresco.js` | refresco cada 5 min solo visible | 3 |
| `test/pwa/rutas.test.js` | rutas y refresco con reloj simulado | 3 |
| `js/series.js` | velas EUR/USDT, EMA/RSI, curvas, formato del eje | 4 |
| `test/pwa/series.test.js` | con la respuesta real grabada de Binance | 4 |
| `js/senal.js` | veredicto, barras T/D/N/F, tarjeta, Fear & Greed, titulares, decisiones | 5 |
| `test/pwa/senal.test.js` | con señales reales del Worker | 5 |
| `js/cartera.js` | métricas §7.7, por moneda, frente a HODL, filtros, simulaciones, reinicio, backtest | 6 |
| `test/pwa/cartera.test.js` | con el bot real y `data/backtest-v1.json`/`v2.json` | 6 |
| `icons/icono.svg` | icono fuente | 7 |
| `scripts/iconos.mjs` | SVG → PNG sin dependencias | 7 |
| `icons/*.png` | `apple-touch-icon.png` 180, `icono-192.png`, `icono-512.png`, `icono-maskable-512.png` (generados) | 7 |
| `test/pwa/iconos.test.js` | PNG opacos, tamaños, idénticos al SVG, zona segura | 7 |
| `vendor/lightweight-charts*` | librería, `LICENSE` y `NOTICE` (descargados) | 8 |
| `js/dom.js` | `h`, `s`, `tabla`, `definiciones`, `aviso`, `insignia` | 8 |
| `js/graficos.js` | `graficoVelas`, `graficoCurva`, `ATRIBUCION` | 8 |
| `test/pwa/graficos.test.js` | vendor fijado y uso de la librería con un doble | 8 |
| `js/vistas/*.js` | `comun`, `login`, `panel`, `moneda`, `bot`, `backtest` | 9 |
| `js/app.js` | arranque, rutas, sesión, refresco, avisos, service worker | 9 |
| `index.html`, `styles.css` | estructura y tema oscuro primero para el móvil | 9 |
| `test/pwa/modulos.js` | grafo de imports de la app (solo tests) | 9 |
| `test/pwa/vistas.test.js` | módulos, atribución, «sin calibrar», sin HTML, pie | 9 |
| `manifest.webmanifest`, `sw.js`, `.nojekyll` | instalable y sin conexión | 10 |
| `scripts/servir.mjs`, `scripts/api-simulada.mjs` | desarrollo local | 10 |
| `test/pwa/estructura.test.js`, `test/pwa/servidores.test.js` | service worker, iPhone/Android, servidores | 10 |
| `README.md` | sección PWA | 10 |

---

### Task 1: Formatos es-ES y URL de la API

**Files:**
- Modify: `package.json`
- Create: `config.js`
- Create: `js/formato.js`
- Test: `test/pwa/formato.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `config.js`: `API_PRODUCCION: string` (`''` hasta desplegar), `API_LOCAL = 'http://localhost:8787'`, `baseApi(ubicacion: { hostname }, produccion = API_PRODUCCION): string` (sin barra final).
  - `js/formato.js`: `LOCALE = 'es-ES'`, `ZONA = 'Europe/Madrid'`, `VACIO = '—'`, `euros(n, { signo }?)`, `precio(n)` (2 decimales desde 1 €, 4 por debajo), `porcentaje(fraccion, { signo, decimales }?)`, `numero(n, decimales = 2, { signo }?)`, `entero(n)`, `fechaHora(ms)` (`'19/10/2026, 00:07'`), `fecha(ms)`, `hora(ms)`, `hace(ms, ahora)` (`'ahora mismo' | 'hace N min' | 'hace N h' | 'hace N días'`), `claseSigno(n): 'sube'|'baja'|'neutro'`, `leerImporte(texto): number|null`. Todas devuelven `'—'` con `null`/`undefined`/`NaN`.

- [ ] **Step 1: Include the PWA tests in `npm test`**

Replace the whole content of `package.json` with:

```json
{
  "name": "oracle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Asistente de trading crypto con bot de paper trading. Simulación: no es asesoramiento financiero.",
  "engines": {
    "node": ">=22.13"
  },
  "scripts": {
    "test": "node --disable-warning=ExperimentalWarning --test \"test/*.test.js\" \"test/pwa/*.test.js\" \"worker/test/*.test.js\"",
    "backtest": "node scripts/backtest.mjs"
  }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/pwa/formato.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { API_LOCAL, baseApi } from '../../config.js'
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
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test test/pwa/formato.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `config.js`.

- [ ] **Step 4: Write the implementation**

Create `config.js`:

```js
// @ts-check
// Dónde está la API del Worker. Es el único archivo que cambia al desplegar.

/**
 * URL del Worker desplegado, sin barra final (p. ej. 'https://oracle.midominio.workers.dev').
 * Vacía hasta el primer despliegue: el paso «PWA» de la checklist de despliegue la rellena.
 */
export const API_PRODUCCION = ''

/** `npx wrangler@4 dev` escucha aquí. */
export const API_LOCAL = 'http://localhost:8787'

/**
 * Base de la API según dónde se abra la PWA: en localhost, el Worker local; si no, el desplegado.
 * @param {{ hostname: string }} ubicacion
 * @param {string} [produccion]
 */
export function baseApi(ubicacion, produccion = API_PRODUCCION) {
  const local = ubicacion.hostname === 'localhost' || ubicacion.hostname === '127.0.0.1'
  return (local ? API_LOCAL : produccion).replace(/\/+$/, '')
}
```

Create `js/formato.js`:

```js
// @ts-check
// Formatos de la interfaz en español de España. null/undefined/NaN → '—' (dato ausente, nunca un 0 fingido).

export const LOCALE = 'es-ES'
export const ZONA = 'Europe/Madrid'
export const VACIO = '—'

const MINUTO = 60_000
const HORA = 60 * MINUTO
const DIA = 24 * HORA

/** @param {unknown} n @returns {n is number} */
const esNumero = (n) => typeof n === 'number' && Number.isFinite(n)

/** @type {Map<string, Intl.NumberFormat>} */
const numeros = new Map()
/** @param {Intl.NumberFormatOptions} opciones */
function formateador(opciones) {
  const clave = JSON.stringify(opciones)
  let f = numeros.get(clave)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, opciones)
    numeros.set(clave, f)
  }
  return f
}

/**
 * Importe en euros con 2 decimales: 1234.5 → '1234,50 €', 72461.88 → '72.461,88 €'.
 * @param {number|null|undefined} n
 * @param {{ signo?: boolean }} [op] signo: '+' en positivos (beneficios)
 */
export function euros(n, { signo = false } = {}) {
  if (!esNumero(n)) return VACIO
  return formateador({
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
    signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(n)
}

/**
 * Precio de una moneda en euros: 2 decimales desde 1 €, y 4 por debajo (XRP ≈ 0,5 €).
 * @param {number|null|undefined} n
 */
export function precio(n) {
  if (!esNumero(n)) return VACIO
  const decimales = Math.abs(n) >= 1 ? 2 : 4
  return formateador({
    style: 'currency', currency: 'EUR', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  }).format(n)
}

/**
 * Fracción como porcentaje: 0.05 → '5,00 %'. Con signo: -0.1851 → '-18,51 %', 0.0043 → '+0,43 %'.
 * @param {number|null|undefined} fraccion
 * @param {{ signo?: boolean, decimales?: number }} [op]
 */
export function porcentaje(fraccion, { signo = false, decimales = 2 } = {}) {
  if (!esNumero(fraccion)) return VACIO
  return formateador({
    style: 'percent', minimumFractionDigits: decimales, maximumFractionDigits: decimales,
    signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(fraccion)
}

/**
 * Número con decimales fijos: (6.885, 1) → '6,9'; con signo: 0.045 → '+0,05'.
 * @param {number|null|undefined} n
 * @param {number} [decimales]
 * @param {{ signo?: boolean }} [op]
 */
export function numero(n, decimales = 2, { signo = false } = {}) {
  if (!esNumero(n)) return VACIO
  return formateador({
    minimumFractionDigits: decimales, maximumFractionDigits: decimales, signDisplay: signo ? 'exceptZero' : 'auto',
  }).format(n)
}

/** Entero con separador de miles: 62621 → '62.621'. @param {number|null|undefined} n */
export const entero = (n) => (esNumero(n) ? formateador({ maximumFractionDigits: 0 }).format(n) : VACIO)

/** @type {Map<string, Intl.DateTimeFormat>} */
const fechas = new Map()
/** @param {Intl.DateTimeFormatOptions} opciones */
function formateadorFecha(opciones) {
  const clave = JSON.stringify(opciones)
  let f = fechas.get(clave)
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALE, { timeZone: ZONA, ...opciones })
    fechas.set(clave, f)
  }
  return f
}

/** '19/10/2026, 00:07' (hora de Madrid). @param {number|null|undefined} ms */
export const fechaHora = (ms) => (esNumero(ms)
  ? formateadorFecha({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(ms)
  : VACIO)

/** '18/10/2024'. @param {number|null|undefined} ms */
export const fecha = (ms) => (esNumero(ms)
  ? formateadorFecha({ day: '2-digit', month: '2-digit', year: 'numeric' }).format(ms)
  : VACIO)

/** '00:07'. @param {number|null|undefined} ms */
export const hora = (ms) => (esNumero(ms) ? formateadorFecha({ hour: '2-digit', minute: '2-digit' }).format(ms) : VACIO)

/**
 * Tiempo transcurrido en palabras: 'ahora mismo', 'hace 5 min', 'hace 3 h', 'hace 2 días'.
 * Un instante futuro (relojes desfasados) cuenta como 'ahora mismo'.
 * @param {number|null|undefined} ms
 * @param {number} ahora
 */
export function hace(ms, ahora) {
  if (!esNumero(ms)) return VACIO
  const pasado = ahora - ms
  if (pasado < MINUTO) return 'ahora mismo'
  if (pasado < HORA) return `hace ${Math.floor(pasado / MINUTO)} min`
  if (pasado < DIA) return `hace ${Math.floor(pasado / HORA)} h`
  const dias = Math.floor(pasado / DIA)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * Clase CSS por el signo de un valor: 'sube' | 'baja' | 'neutro'.
 * @param {number|null|undefined} n
 */
export const claseSigno = (n) => (!esNumero(n) || n === 0 ? 'neutro' : n > 0 ? 'sube' : 'baja')

/**
 * Lee un importe escrito a la española: '10.000' → 10000, '2500,5' → 2500.5, '10000 €' → 10000.
 * Devuelve null si no es un número.
 * @param {string} texto
 */
export function leerImporte(texto) {
  const limpio = texto.trim().replace(/[\s\u00a0€]/g, '')
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/.test(limpio)) return null
  return Number(limpio.replace(/\./g, '').replace(',', '.'))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/pwa/formato.test.js`
Expected: PASS — 10 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (250 tests: 240 previos + 10).

- [ ] **Step 6: Commit**

```bash
git add package.json config.js js/formato.js test/pwa/formato.test.js
git commit -m "feat(pwa): formatos es-ES y URL de la API en config.js" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Cliente de la API y PIN en el dispositivo

**Files:**
- Create: `test/pwa/ayudantes.js`
- Create: `js/api.js`
- Create: `js/sesion.js`
- Test: `test/pwa/api.test.js`

**Interfaces:**
- Consumes: `hora` (Task 1); para los tests, `atender` (`worker/src/api.js`), `ejecutarMercado`, `crearSimulacion`, `crearD1`, `crearEscenario`, `ahoraDe`, `fetchEscenario` (plan 2).
- Produces:
  - `test/pwa/ayudantes.js`: `PIN = '4815162342'`, `BASE`, `HORAS = 6`, `workerSimulado({ ahora?, ip? }): Promise<{ db, env, ahora, fetch, llamadas }>` (monedas BTC y ETH; `ORIGENES = 'http://localhost:8080'`).
  - `js/api.js`: `class ErrorApi extends Error { estado: number /* 0 = sin respuesta */, codigo: string, hasta: number|null }`; `crearApi({ base, fetch, pin: () => string|null })` con `resumen()`, `moneda(simbolo)`, `bot(simulacion?)`, `operaciones({ simulacion?, simbolo?, cursor? })`, `decisiones({ … })`, `simulaciones()`, `reiniciar(capitalInicial)` (`{ capital_inicial, confirmar: true }`), `analizar()`; todas devuelven el JSON del contrato o lanzan `ErrorApi` (`sin_configurar` sin URL, `red` sin conexión, o el `{ error, detalle, hasta }` del Worker); los parámetros vacíos no se envían. `pideLogin(e): boolean` (401 o `bloqueado`), `mensajeError(e): string`.
  - `js/sesion.js`: `CLAVE_PIN = 'oracle.pin'`, `crearSesion(almacen: Storage|null)` → `{ pin(), guardar(pin), olvidar() }`.

- [ ] **Step 1: Write the test helper (the real Worker as `fetch`)**

Create `test/pwa/ayudantes.js`:

```js
// @ts-check
// Ayudantes de los tests de la PWA: el Worker real (api.js sobre D1 simulado y el escenario sintético
// de sus tests) como fetch, para comprobar el «Contrato de la API» con respuestas de verdad. Solo tests.
import { atender } from '../../worker/src/api.js'
import { ejecutarMercado } from '../../worker/src/ejecuciones/mercado.js'
import { crearSimulacion } from '../../worker/src/repositorio.js'
import { crearD1 } from '../../worker/test/d1.js'
import { ahoraDe, crearEscenario, fetchEscenario } from '../../worker/test/escenario.js'

export const PIN = '4815162342'
export const BASE = 'https://oracle.test.workers.dev'
export const HORAS = 6

/**
 * Worker con `HORAS` horas del escenario ejecutadas (BTC cierra por stop, ETH por take-profit).
 * Devuelve un fetch que atiende la PWA con ese Worker en el instante `ahora`.
 * @param {{ ahora?: number, ip?: string }} [op]
 */
export async function workerSimulado({ ahora = ahoraDe(HORAS), ip = '10.0.0.1' } = {}) {
  const db = crearD1()
  const escenario = crearEscenario()
  const env = { DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: 'http://localhost:8080' }
  await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
  for (let k = 0; k < HORAS; k++) {
    await ejecutarMercado({ env, fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
  }
  /** @type {{ url: string, init: RequestInit|undefined }[]} */
  const llamadas = []
  /** @type {typeof fetch} */
  const fetch = async (entrada, init) => {
    const url = String(entrada)
    llamadas.push({ url, init })
    const cabeceras = new Headers(init?.headers)
    cabeceras.set('CF-Connecting-IP', ip)
    const peticion = new Request(url, { ...init, headers: cabeceras })
    return atender(peticion, { env, fetch: fetchEscenario(escenario, ahora), ahora })
  }
  return { db, env, ahora, fetch, llamadas }
}
```

- [ ] **Step 2: Write the failing test**

Create `test/pwa/api.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ErrorApi, crearApi, mensajeError, pideLogin } from '../../js/api.js'
import { CLAVE_PIN, crearSesion } from '../../js/sesion.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'

/** @param {Awaited<ReturnType<typeof workerSimulado>>} w @param {string|null} [pin] */
const clienteDe = (w, pin = PIN) => crearApi({ base: BASE, fetch: w.fetch, pin: () => pin })

describe('cliente de la API contra el Worker real', () => {
  test('resumen con PIN: forma del contrato', async () => {
    const w = await workerSimulado()
    const r = await clienteDe(w).resumen()
    assert.equal(r.ahora, w.ahora)
    assert.deepEqual(r.senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
    for (const s of r.senales) {
      for (const clave of ['veredicto', 'indiceConfianza', 'puntuacion', 'precioEur', 'cambio24h', 'fresca', 'calculadaEn', 'frase']) {
        assert.ok(clave in s, clave)
      }
    }
    assert.equal(r.bot.simulacionId, 1)
    assert.equal(typeof r.datosDesactualizados, 'boolean')
    assert.equal(w.llamadas[0].url, `${BASE}/api/resumen`)
    assert.equal(new Headers(w.llamadas[0].init?.headers).get('Authorization'), `Bearer ${PIN}`)
  })

  test('moneda, bot, simulaciones, operaciones y decisiones con filtros y cursor', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const m = await api.moneda('btc')
    assert.equal(m.simbolo, 'BTC')
    assert.ok(m.senal.componentes && Array.isArray(m.titulares) && Array.isArray(m.decisiones))
    const b = await api.bot()
    assert.equal(b.simulacion.activa, true)
    assert.ok(Array.isArray(b.curva) && b.metricas.valorCartera > 0)
    assert.equal((await api.simulaciones()).items.length, 1)
    const ops = await api.operaciones({ simulacion: 1, simbolo: 'BTC' })
    assert.ok(ops.items.length > 0 && ops.items.every((/** @type {any} */ o) => o.simbolo === 'BTC'))
    const dec = await api.decisiones({ cursor: 1_000_000 })
    assert.ok(dec.items.length > 0)
    const urls = w.llamadas.map((l) => l.url)
    assert.ok(urls.includes(`${BASE}/api/bot/operaciones?simulacion=1&simbolo=BTC`))
    assert.ok(urls.includes(`${BASE}/api/bot/decisiones?cursor=1000000`))
    assert.ok(urls.includes(`${BASE}/api/bot`), 'sin parámetros vacíos')
  })

  test('PIN incorrecto → ErrorApi 401 que pide login; al 5.º fallo, bloqueo con hasta', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w, '0000')
    /** @type {ErrorApi|null} */
    let error = null
    for (let i = 0; i < 5; i++) {
      try {
        await api.resumen()
      } catch (e) {
        error = /** @type {ErrorApi} */ (e)
        if (i < 4) {
          assert.equal(error.estado, 401)
          assert.equal(error.codigo, 'pin_incorrecto')
          assert.ok(pideLogin(error))
        }
      }
    }
    assert.ok(error instanceof ErrorApi)
    assert.equal(error.estado, 429)
    assert.equal(error.codigo, 'bloqueado')
    assert.equal(error.hasta, w.ahora + 15 * 60_000)
    assert.ok(pideLogin(error))
    assert.match(mensajeError(error), /^Demasiados intentos con PIN incorrecto\. Acceso bloqueado hasta las \d\d:\d\d\.$/)
  })

  test('sin PIN guardado manda la cabecera vacía y recibe 401', async () => {
    const w = await workerSimulado()
    await assert.rejects(clienteDe(w, null).resumen(), (e) => e instanceof ErrorApi && e.estado === 401)
  })

  test('reiniciar envía capital_inicial y confirmar: true; la anterior queda cerrada', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const r = await api.reiniciar(5000)
    assert.equal(r.simulacion.capitalInicial, 5000)
    assert.equal(r.simulacion.id, 2)
    assert.deepEqual(JSON.parse(String(w.llamadas[0].init?.body)), { capital_inicial: 5000, confirmar: true })
    const sims = (await api.simulaciones()).items
    assert.deepEqual(sims.map((/** @type {any} */ s) => [s.id, s.activa]), [[2, true], [1, false]])
    await assert.rejects(api.reiniciar(5), (e) => e instanceof ErrorApi && e.estado === 400 && e.codigo === 'peticion_invalida')
  })

  test('analizar dos veces → 429 demasiado_pronto con mensaje y hora', async () => {
    const w = await workerSimulado()
    const api = clienteDe(w)
    const r = await api.analizar()
    assert.equal(r.ejecucion.tipo, 'manual')
    await assert.rejects(api.analizar(), (e) => {
      assert.ok(e instanceof ErrorApi)
      assert.equal(e.codigo, 'demasiado_pronto')
      assert.equal(pideLogin(e), false)
      assert.match(mensajeError(e), /^Solo se puede analizar una vez cada 5 minutos\. Vuelve a probar a las \d\d:\d\d\.$/)
      return true
    })
  })

  test('moneda no seguida → 404 con el detalle del Worker', async () => {
    const w = await workerSimulado()
    await assert.rejects(clienteDe(w).moneda('DOGE'), (e) => e instanceof ErrorApi && e.estado === 404 && e.message === 'Moneda no seguida: DOGE')
  })
})

describe('cliente de la API sin servidor', () => {
  test('sin URL configurada no llama a la red', async () => {
    let llamadas = 0
    const api = crearApi({ base: '', fetch: async () => { llamadas++; return new Response('{}') }, pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.codigo === 'sin_configurar')
    assert.equal(llamadas, 0)
  })

  test('red caída → ErrorApi estado 0 con mensaje legible', async () => {
    const api = crearApi({ base: BASE, fetch: async () => { throw new TypeError('Failed to fetch') }, pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.estado === 0 && e.codigo === 'red')
  })

  test('error sin cuerpo JSON → ErrorApi con el estado HTTP', async () => {
    const api = crearApi({ base: BASE, fetch: async () => new Response('Bad gateway', { status: 502 }), pin: () => PIN })
    await assert.rejects(api.resumen(), (e) => e instanceof ErrorApi && e.estado === 502 && e.codigo === 'http' && !pideLogin(e))
  })

  test('mensajeError de errores que no son de la API', () => {
    assert.equal(mensajeError(new Error('x')), 'Error inesperado: x')
  })
})

describe('sesión', () => {
  /** @returns {import('../../js/sesion.js').Almacen & { datos: Map<string, string> }} */
  const almacen = () => {
    const datos = new Map()
    return {
      datos,
      getItem: (c) => datos.get(c) ?? null,
      setItem: (c, v) => { datos.set(c, v) },
      removeItem: (c) => { datos.delete(c) },
    }
  }

  test('guarda, lee y olvida el PIN en el almacén', () => {
    const a = almacen()
    const s = crearSesion(a)
    assert.equal(s.pin(), null)
    s.guardar('1234')
    assert.equal(a.datos.get(CLAVE_PIN), '1234')
    assert.equal(crearSesion(a).pin(), '1234')
    s.olvidar()
    assert.equal(s.pin(), null)
  })

  test('si el almacén falla, el PIN vive en memoria', () => {
    const roto = { getItem: () => { throw new Error('no') }, setItem: () => { throw new Error('no') }, removeItem: () => { throw new Error('no') } }
    const s = crearSesion(roto)
    s.guardar('9999')
    assert.equal(s.pin(), '9999')
    s.olvidar()
    assert.equal(s.pin(), null)
    assert.equal(crearSesion(null).pin(), null)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/api.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/api.js`.

- [ ] **Step 4: Write the implementation**

Create `js/api.js`:

```js
// @ts-check
// Cliente de la API del Worker («Contrato de la API» del plan 2). fetch inyectado: en los tests, el propio Worker.
import { hora } from './formato.js'

/** Error de la API con el cuerpo `{ error, detalle, hasta? }` del Worker. estado 0 = sin respuesta. */
export class ErrorApi extends Error {
  /** @param {number} estado @param {string} codigo @param {string} detalle @param {number|null} [hasta] */
  constructor(estado, codigo, detalle, hasta = null) {
    super(detalle)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
    this.hasta = hasta
  }
}

/** @typedef {Record<string, string|number|null|undefined>} Consulta */

/**
 * @param {{ base: string, fetch: typeof fetch, pin: () => string|null }} op
 */
export function crearApi({ base, fetch, pin }) {
  /**
   * @param {'GET'|'POST'} metodo
   * @param {string} ruta
   * @param {{ consulta?: Consulta, cuerpo?: unknown }} [op]
   * @returns {Promise<any>}
   */
  async function pedir(metodo, ruta, { consulta = {}, cuerpo } = {}) {
    if (!base) throw new ErrorApi(0, 'sin_configurar', 'Falta la URL del Worker en config.js (API_PRODUCCION).')
    const url = new URL(base + ruta)
    for (const [clave, valor] of Object.entries(consulta)) {
      if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(clave, String(valor))
    }
    /** @type {Record<string, string>} */
    const cabeceras = { Authorization: `Bearer ${pin() ?? ''}` }
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
    let respuesta
    try {
      respuesta = await fetch(url.href, {
        method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      })
    } catch {
      throw new ErrorApi(0, 'red', 'No se pudo contactar con el servidor. Comprueba la conexión.')
    }
    /** @type {any} */
    let datos = null
    try {
      datos = await respuesta.json()
    } catch {
      datos = null
    }
    if (!respuesta.ok) {
      throw new ErrorApi(respuesta.status, datos?.error ?? 'http', datos?.detalle ?? `Error ${respuesta.status} del servidor.`,
        typeof datos?.hasta === 'number' ? datos.hasta : null)
    }
    if (datos === null || typeof datos !== 'object') throw new ErrorApi(respuesta.status, 'respuesta_invalida', 'Respuesta no válida del servidor.')
    return datos
  }

  return {
    resumen: () => pedir('GET', '/api/resumen'),
    /** @param {string} simbolo */
    moneda: (simbolo) => pedir('GET', `/api/moneda/${encodeURIComponent(simbolo)}`),
    /** @param {number|null} [simulacion] sin valor: la activa */
    bot: (simulacion = null) => pedir('GET', '/api/bot', { consulta: { simulacion } }),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    operaciones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/operaciones', { consulta: { simulacion, simbolo, cursor } }),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    decisiones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/decisiones', { consulta: { simulacion, simbolo, cursor } }),
    simulaciones: () => pedir('GET', '/api/simulaciones'),
    /** @param {number} capitalInicial */
    reiniciar: (capitalInicial) => pedir('POST', '/api/bot/reiniciar', { cuerpo: { capital_inicial: capitalInicial, confirmar: true } }),
    analizar: () => pedir('POST', '/api/analizar'),
  }
}

/** @typedef {ReturnType<typeof crearApi>} Api */

/**
 * El error obliga a volver a pedir el PIN: incorrecto (401) o IP bloqueada (429 `bloqueado`).
 * @param {unknown} e
 */
export const pideLogin = (e) => e instanceof ErrorApi && (e.estado === 401 || e.codigo === 'bloqueado')

/**
 * Mensaje para la persona usuaria, en español.
 * @param {unknown} e
 */
export function mensajeError(e) {
  if (!(e instanceof ErrorApi)) return `Error inesperado: ${e instanceof Error ? e.message : String(e)}`
  if (e.codigo === 'bloqueado') {
    return `Demasiados intentos con PIN incorrecto. Acceso bloqueado${e.hasta ? ` hasta las ${hora(e.hasta)}` : ''}.`
  }
  if (e.codigo === 'demasiado_pronto') {
    return `Solo se puede analizar una vez cada 5 minutos.${e.hasta ? ` Vuelve a probar a las ${hora(e.hasta)}.` : ''}`
  }
  return e.message
}
```

Create `js/sesion.js`:

```js
// @ts-check
// El PIN se guarda una vez en el dispositivo (spec §12). Si localStorage no está disponible
// (modo privado), vive solo en memoria mientras la app siga abierta.

export const CLAVE_PIN = 'oracle.pin'

/** @typedef {{ getItem(clave: string): string|null, setItem(clave: string, valor: string): void, removeItem(clave: string): void }} Almacen */

/** @param {Almacen|null|undefined} almacen */
export function crearSesion(almacen) {
  /** @type {string|null} */
  let enMemoria = null
  return {
    /** @returns {string|null} */
    pin() {
      try {
        return almacen?.getItem(CLAVE_PIN) ?? enMemoria
      } catch {
        return enMemoria
      }
    },
    /** @param {string} pin */
    guardar(pin) {
      enMemoria = pin
      try {
        almacen?.setItem(CLAVE_PIN, pin)
      } catch {
        // sin almacenamiento persistente: queda en memoria
      }
    },
    olvidar() {
      enMemoria = null
      try {
        almacen?.removeItem(CLAVE_PIN)
      } catch {
        // nada que borrar
      }
    },
  }
}

/** @typedef {ReturnType<typeof crearSesion>} Sesion */
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/api.test.js`
Expected: PASS — 13 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (263 tests).

- [ ] **Step 6: Commit**

```bash
git add test/pwa/ayudantes.js js/api.js js/sesion.js test/pwa/api.test.js
git commit -m "feat(pwa): cliente de la API probado contra el Worker real y PIN en el dispositivo" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Rutas por hash y refresco solo con la página visible

**Files:**
- Create: `js/rutas.js`
- Create: `js/refresco.js`
- Test: `test/pwa/rutas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `js/rutas.js`: tipos `Vista = 'panel'|'moneda'|'bot'|'backtest'|'login'`, `Ruta = { vista, simbolo: string|null, params: Record<string,string> }`; `leerRuta(hash): Ruta` (lo desconocido → Panel; símbolo en mayúsculas), `hashDe(vista, { simbolo?, params? }): string`, `conParams(ruta, cambios): string` (null quita), `paramEntero(params, nombre): number|null`, `paramOpcion(params, nombre, opciones, porDefecto)`, `seccionDe(ruta)`.
  - `js/refresco.js`: `INTERVALO_MS = 5 min`, `crearRefresco({ accion, intervaloMs?, reloj: { ahora, setTimeout, clearTimeout } })` → `{ iniciar(), visibilidad(visible), reiniciarCuenta(), detener() }`. `iniciar` no ejecuta (la carga inicial es de la app); oculta no programa nada; al volver ejecuta si ya pasaron 5 min o espera lo que falta; no solapa una acción en curso; un error no para el ciclo.

- [ ] **Step 1: Write the failing test**

Create `test/pwa/rutas.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { INTERVALO_MS, crearRefresco } from '../../js/refresco.js'
import { conParams, hashDe, leerRuta, paramEntero, paramOpcion, seccionDe } from '../../js/rutas.js'

describe('rutas por hash', () => {
  test('vistas conocidas, símbolo en mayúsculas y parámetros', () => {
    assert.deepEqual(leerRuta(''), { vista: 'panel', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#/'), { vista: 'panel', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#/moneda/btc?tf=4h'), { vista: 'moneda', simbolo: 'BTC', params: { tf: '4h' } })
    assert.deepEqual(leerRuta('#/bot?simulacion=2&simbolo=ETH&filtro=hold'),
      { vista: 'bot', simbolo: null, params: { simulacion: '2', simbolo: 'ETH', filtro: 'hold' } })
    assert.deepEqual(leerRuta('#/backtest?v=v2'), { vista: 'backtest', simbolo: null, params: { v: 'v2' } })
    assert.deepEqual(leerRuta('#/login'), { vista: 'login', simbolo: null, params: {} })
    assert.deepEqual(leerRuta('#bot'), { vista: 'bot', simbolo: null, params: {} })
  })

  test('lo desconocido o mal formado va al Panel', () => {
    for (const h of ['#/nada', '#/moneda', '#/moneda/B', '#/moneda/BTC/extra', '#/moneda/<script>', '#/bot/3']) {
      assert.equal(leerRuta(h).vista, 'panel', h)
    }
  })

  test('hashDe y conParams son el inverso de leerRuta', () => {
    assert.equal(hashDe('panel'), '#/')
    assert.equal(hashDe('moneda', { simbolo: 'ETH', params: { tf: '1d' } }), '#/moneda/ETH?tf=1d')
    assert.equal(hashDe('bot', { params: { simulacion: 3, simbolo: null, filtro: '' } }), '#/bot?simulacion=3')
    const ruta = leerRuta('#/bot?simulacion=2&filtro=hold')
    assert.equal(conParams(ruta, { filtro: null, simbolo: 'BTC' }), '#/bot?simulacion=2&simbolo=BTC')
    assert.deepEqual(leerRuta(conParams(ruta, { simbolo: 'SOL' })).params, { simulacion: '2', filtro: 'hold', simbolo: 'SOL' })
  })

  test('parámetros validados', () => {
    assert.equal(paramEntero({ simulacion: '12' }, 'simulacion'), 12)
    for (const malo of ['0', '-1', 'x', '1.5', '']) assert.equal(paramEntero({ simulacion: malo }, 'simulacion'), null, malo)
    assert.equal(paramEntero({}, 'simulacion'), null)
    assert.equal(paramOpcion({ tf: '4h' }, 'tf', ['1h', '4h', '1d'], '1h'), '4h')
    assert.equal(paramOpcion({ tf: '15m' }, 'tf', ['1h', '4h', '1d'], '1h'), '1h')
    assert.equal(seccionDe(leerRuta('#/moneda/BTC')), 'panel')
    assert.equal(seccionDe(leerRuta('#/bot')), 'bot')
  })
})

/** Reloj simulado: el tiempo solo avanza con avanzar(ms). */
function relojFalso() {
  let t = 0
  /** @type {Map<number, { cuando: number, f: () => void }>} */
  const pendientes = new Map()
  let siguienteId = 1
  return {
    pendientes,
    ahora: () => t,
    /** @param {() => void} f @param {number} ms */
    setTimeout: (f, ms) => {
      const id = siguienteId++
      pendientes.set(id, { cuando: t + ms, f })
      return id
    },
    /** @param {unknown} id */
    clearTimeout: (id) => { pendientes.delete(/** @type {number} */ (id)) },
    /** @param {number} ms */
    async avanzar(ms) {
      const fin = t + ms
      for (;;) {
        const proximo = [...pendientes.entries()].sort((a, b) => a[1].cuando - b[1].cuando)[0]
        if (!proximo || proximo[1].cuando > fin) break
        pendientes.delete(proximo[0])
        t = proximo[1].cuando
        proximo[1].f()
        await new Promise((r) => setImmediate(r))
      }
      t = fin
      await new Promise((r) => setImmediate(r))
    },
  }
}

describe('refresco solo visible', () => {
  test('iniciar no carga (la carga inicial es de la app) y luego refresca cada 5 min', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(INTERVALO_MS - 1)
    assert.equal(n, 0)
    await reloj.avanzar(1)
    assert.equal(n, 1)
    await reloj.avanzar(2 * INTERVALO_MS)
    assert.equal(n, 3)
  })

  test('oculta no pide nada; al volver refresca si ya tocaba o espera lo que falta', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(60_000)
    r.visibilidad(false)
    assert.equal(reloj.pendientes.size, 0)
    await reloj.avanzar(60 * 60_000)
    assert.equal(n, 0, 'nada mientras está oculta')
    r.visibilidad(true)
    await reloj.avanzar(0)
    assert.equal(n, 1, 'al volver tras más de 5 min, refresca enseguida')
    await reloj.avanzar(60_000)
    r.visibilidad(false)
    r.visibilidad(true)
    await reloj.avanzar(0)
    assert.equal(n, 1, 'volver antes de 5 min no refresca')
    await reloj.avanzar(INTERVALO_MS - 60_000)
    assert.equal(n, 2, 'refresca cuando se cumplen los 5 min desde el último')
  })

  test('no solapa una acción lenta y sobrevive a errores', async () => {
    const reloj = relojFalso()
    let n = 0
    /** @type {() => void} */
    let terminar = () => {}
    const r = crearRefresco({
      accion: () => {
        n++
        if (n === 1) return new Promise((resolver) => { terminar = resolver })
        throw new Error('red caída')
      },
      reloj,
    })
    r.iniciar()
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 1)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 1, 'la primera sigue en curso: no se lanza otra')
    terminar()
    await reloj.avanzar(0)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 2)
    await reloj.avanzar(INTERVALO_MS)
    assert.equal(n, 3, 'un error no para el ciclo')
  })

  test('reiniciarCuenta aplaza el siguiente y detener lo para todo', async () => {
    const reloj = relojFalso()
    let n = 0
    const r = crearRefresco({ accion: () => { n++ }, reloj })
    r.iniciar()
    await reloj.avanzar(4 * 60_000)
    r.reiniciarCuenta()
    await reloj.avanzar(2 * 60_000)
    assert.equal(n, 0)
    await reloj.avanzar(3 * 60_000)
    assert.equal(n, 1)
    r.detener()
    r.visibilidad(true)
    await reloj.avanzar(10 * INTERVALO_MS)
    assert.equal(n, 1)
    assert.equal(reloj.pendientes.size, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pwa/rutas.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/refresco.js`.

- [ ] **Step 3: Write the implementation**

Create `js/rutas.js`:

```js
// @ts-check
// Rutas por hash (#/…), para que GitHub Pages sirva siempre index.html bajo /ORACLE/.
//   #/                      Panel
//   #/moneda/BTC?tf=4h      Detalle de moneda (tf: 1h | 4h | 1d)
//   #/bot?simulacion=2&simbolo=ETH&filtro=hold
//   #/backtest?v=v2
//   #/login

/** @typedef {'panel'|'moneda'|'bot'|'backtest'|'login'} Vista */
/** @typedef {{ vista: Vista, simbolo: string|null, params: Record<string, string> }} Ruta */

const SIMBOLO = /^[A-Za-z0-9]{2,10}$/
/** @type {Vista[]} */
const SIMPLES = ['bot', 'backtest', 'login']

/**
 * '#/moneda/btc?tf=4h' → { vista: 'moneda', simbolo: 'BTC', params: { tf: '4h' } }. Lo desconocido → Panel.
 * @param {string} hash
 * @returns {Ruta}
 */
export function leerRuta(hash) {
  const texto = hash.replace(/^#\/?/, '')
  const corte = texto.indexOf('?')
  const camino = corte === -1 ? texto : texto.slice(0, corte)
  const params = Object.fromEntries(new URLSearchParams(corte === -1 ? '' : texto.slice(corte + 1)))
  const partes = camino.split('/').filter(Boolean)
  if (partes.length === 2 && partes[0] === 'moneda' && SIMBOLO.test(partes[1])) {
    return { vista: 'moneda', simbolo: partes[1].toUpperCase(), params }
  }
  const vista = /** @type {Vista} */ (partes[0])
  if (partes.length === 1 && SIMPLES.includes(vista)) return { vista, simbolo: null, params }
  return { vista: 'panel', simbolo: null, params: {} }
}

/**
 * Hash de una ruta. Los parámetros vacíos o null no se escriben.
 * @param {Vista} vista
 * @param {{ simbolo?: string|null, params?: Record<string, string|number|null|undefined> }} [op]
 */
export function hashDe(vista, { simbolo = null, params = {} } = {}) {
  const camino = vista === 'panel' ? '' : vista === 'moneda' ? `moneda/${simbolo}` : vista
  const consulta = new URLSearchParams()
  for (const [clave, valor] of Object.entries(params)) {
    if (valor !== null && valor !== undefined && valor !== '') consulta.set(clave, String(valor))
  }
  const q = consulta.toString()
  return `#/${camino}${q ? `?${q}` : ''}`
}

/**
 * La misma ruta con algunos parámetros cambiados (null los quita).
 * @param {Ruta} ruta
 * @param {Record<string, string|number|null>} cambios
 */
export const conParams = (ruta, cambios) => hashDe(ruta.vista, { simbolo: ruta.simbolo, params: { ...ruta.params, ...cambios } })

/**
 * Entero positivo de un parámetro, o null.
 * @param {Record<string, string>} params @param {string} nombre
 */
export function paramEntero(params, nombre) {
  const v = params[nombre]
  return v !== undefined && /^\d{1,15}$/.test(v) && Number(v) > 0 ? Number(v) : null
}

/**
 * Valor de un parámetro si está entre las opciones; si no, el valor por defecto.
 * @template {string} T
 * @param {Record<string, string>} params @param {string} nombre @param {readonly T[]} opciones @param {T} porDefecto
 * @returns {T}
 */
export function paramOpcion(params, nombre, opciones, porDefecto) {
  const v = /** @type {T} */ (params[nombre])
  return opciones.includes(v) ? v : porDefecto
}

/** Sección de la barra de navegación marcada: el detalle de moneda cuelga del Panel. @param {Ruta} ruta */
export const seccionDe = (ruta) => (ruta.vista === 'moneda' ? 'panel' : ruta.vista)
```

Create `js/refresco.js`:

```js
// @ts-check
// Refresco de datos cada 5 min, solo mientras la página está visible (Page Visibility API); la carga al
// abrir la hace la app. Oculta no hace ninguna petición; al volver, refresca enseguida si ya tocaba.
// Nada en segundo plano (spec §9).

export const INTERVALO_MS = 5 * 60_000

/**
 * @typedef {{ ahora: () => number, setTimeout: (f: () => void, ms: number) => unknown,
 *   clearTimeout: (id: unknown) => void }} Reloj
 */

/**
 * @param {{ accion: () => unknown, intervaloMs?: number, reloj: Reloj }} op
 *   accion: lo que refresca (puede ser asíncrona; si sigue en curso, no se solapa otra)
 */
export function crearRefresco({ accion, intervaloMs = INTERVALO_MS, reloj }) {
  /** @type {unknown} */
  let temporizador = null
  let ultima = -Infinity
  let enCurso = false
  let visible = true
  let activo = false

  function cancelar() {
    if (temporizador !== null) reloj.clearTimeout(temporizador)
    temporizador = null
  }

  /** @param {number} ms */
  function programar(ms) {
    cancelar()
    temporizador = reloj.setTimeout(() => {
      temporizador = null
      ejecutar()
    }, ms)
  }

  function ejecutar() {
    ultima = reloj.ahora()
    if (activo && visible) programar(intervaloMs)
    if (enCurso) return
    enCurso = true
    Promise.resolve()
      .then(accion)
      .catch(() => {})
      .finally(() => { enCurso = false })
  }

  return {
    /** Arranca el ciclo justo después de la carga inicial: el primer refresco, dentro de un intervalo. */
    iniciar() {
      activo = true
      ultima = reloj.ahora()
      if (visible) programar(intervaloMs)
    },
    /** @param {boolean} esVisible document.visibilityState === 'visible' */
    visibilidad(esVisible) {
      visible = esVisible
      if (!activo) return
      if (!esVisible) return cancelar()
      const falta = ultima + intervaloMs - reloj.ahora()
      if (falta <= 0) ejecutar()
      else programar(falta)
    },
    /** Tras una carga fuera del ciclo (navegar, «Analizar ahora»): el siguiente, dentro de un intervalo completo. */
    reiniciarCuenta() {
      ultima = reloj.ahora()
      if (activo && visible) programar(intervaloMs)
    },
    detener() {
      activo = false
      cancelar()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pwa/rutas.test.js`
Expected: PASS — 8 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (271 tests).

- [ ] **Step 5: Commit**

```bash
git add js/rutas.js js/refresco.js test/pwa/rutas.test.js
git commit -m "feat(pwa): rutas por hash y refresco cada 5 min solo con la página visible" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Velas de Binance e indicadores para los gráficos

**Files:**
- Create: `js/series.js`
- Test: `test/pwa/series.test.js`

**Interfaces:**
- Consumes: `ema`, `rsi` (`core/indicadores.js`), `descargarVelas(fetch, par, intervalo, limite)` (valida y convierte las filas en una pasada) y `BINANCE` (`worker/src/fuentes/binance.js`), `ZONA` (Task 1); en tests, `serie` (`test/ayudantes.js`), `simularFetch`, `aFilasBinance` (`worker/test/ayudantes.js`) y el fixture real `test/fixtures/binance-klines-BTCEUR-1h.json`.
- Produces (`js/series.js`): `TEMPORALIDADES = ['1h','4h','1d']`, `ETIQUETA_TEMPORALIDAD`, `VELAS_GRAFICO = 500` (`limit` propio del gráfico: el Worker pide 501 para la señal), `velasDeMoneda({ simbolo, temporalidad, fetch }): Promise<{ par, divisa: 'EUR'|'USDT', respaldo: boolean, velas: Vela[] }>` (lanza si fallan los dos pares), `aSegundos(ms)`, `formatoNumero(decimales)` y `formatoPrecio(velas)` (`{ type: 'custom', minMove, formatter }` en es-ES), `datosVelas(velas)`, `linea(velas, serie)`, `indicadoresDe(velas): { ema20, ema50, ema200, rsi }` (puntos `{ time, value }` sin los `null` iniciales), `curvaComparada(puntos): { bot, hodl }` (tiempos únicos crecientes, HODL `null` sin punto), `etiquetaTick(segundos, tipo)` (eje en hora de Madrid).

- [ ] **Step 1: Write the failing test**

Create `test/pwa/series.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ema, rsi } from '../../core/indicadores.js'
import { BINANCE } from '../../worker/src/fuentes/binance.js'
import { aFilasBinance, simularFetch } from '../../worker/test/ayudantes.js'
import { curvaComparada, datosVelas, etiquetaTick, formatoNumero, formatoPrecio, indicadoresDe, linea, velasDeMoneda } from '../../js/series.js'
import { serie } from '../ayudantes.js'

const KLINES_BTCEUR = JSON.parse(readFileSync(new URL('../fixtures/binance-klines-BTCEUR-1h.json', import.meta.url), 'utf8'))

describe('velas de Binance desde el navegador', () => {
  test('pide el par en euros a data-api.binance.vision (respuesta real grabada)', async () => {
    const fetch = simularFetch(() => ({ cuerpo: KLINES_BTCEUR }))
    const r = await velasDeMoneda({ simbolo: 'BTC', temporalidad: '4h', fetch })
    assert.equal(fetch.llamadas[0].url, `${BINANCE}?symbol=BTCEUR&interval=4h&limit=500`)
    assert.deepEqual([r.par, r.divisa, r.respaldo], ['BTCEUR', 'EUR', false])
    assert.equal(r.velas.length, 3)
    assert.deepEqual(r.velas[0], {
      inicio: 1792350000000, fin: 1792353600000, apertura: 72227.92, maximo: 72256.2, minimo: 71897.67, cierre: 71989.84, volumen: 1.98418,
    })
  })

  test('sin par en euros (error o lista vacía) usa USDT y lo marca como respaldo', async () => {
    const velas = serie(30, (i) => 100 + i)
    for (const eur of [{ estado: 400, cuerpo: { code: -1121, msg: 'Invalid symbol.' } }, { cuerpo: [] }]) {
      const fetch = simularFetch((url) => (url.includes('symbol=XYZEUR') ? eur : { cuerpo: aFilasBinance(velas) }))
      const r = await velasDeMoneda({ simbolo: 'XYZ', temporalidad: '1h', fetch })
      assert.deepEqual([r.par, r.divisa, r.respaldo, r.velas.length], ['XYZUSDT', 'USDT', true, 30])
      assert.equal(fetch.llamadas.length, 2)
    }
  })

  test('si fallan los dos pares lanza en vez de inventar precios', async () => {
    const fetch = simularFetch((url) => (url.includes('EUR') ? { error: new TypeError('Failed to fetch') } : { cuerpo: [[1, 'x']] }))
    await assert.rejects(velasDeMoneda({ simbolo: 'BTC', temporalidad: '1d', fetch }),
      /^Error: Binance no devolvió velas de BTC \(BTCEUR: Failed to fetch; BTCUSDT: klines: fila mal formada\)\.$/)
  })
})

describe('series para lightweight-charts', () => {
  const velas = serie(260, (i) => 100 + 10 * Math.sin(i / 9) + i / 10)

  test('velas en segundos UTC con OHLC', () => {
    const d = datosVelas(velas)
    assert.equal(d.length, 260)
    assert.deepEqual(d[1], { time: 3600, open: velas[0].cierre, high: velas[1].maximo, low: velas[1].minimo, close: velas[1].cierre })
  })

  test('eje de precios a la española: 2 decimales desde 1 €, 4 por debajo', () => {
    const f = formatoPrecio(serie(3, () => 72857.05))
    assert.deepEqual([f.type, f.minMove, f.formatter(72857.05)], ['custom', 0.01, '72.857,05'])
    const g = formatoPrecio(serie(3, () => 0.52))
    assert.deepEqual([g.minMove, g.formatter(0.523456)], [0.0001, '0,5235'])
    assert.equal(formatoNumero(0).formatter(10085.4), '10.085')
  })

  test('EMA20/50/200 y RSI14 iguales a los de core, sin los null iniciales', () => {
    const cierres = velas.map((v) => v.cierre)
    const ind = indicadoresDe(velas)
    assert.equal(ind.ema20.length, 260 - 19)
    assert.equal(ind.ema50.length, 260 - 49)
    assert.equal(ind.ema200.length, 260 - 199)
    assert.equal(ind.rsi.length, 260 - 14)
    assert.deepEqual(ind.ema200[0], { time: 199 * 3600, value: ema(cierres, 200)[199] })
    assert.equal(ind.rsi.at(-1)?.value, rsi(cierres, 14)[259])
    assert.deepEqual(linea(velas.slice(0, 3), [null, 1, null]), [{ time: 3600, value: 1 }])
  })

  test('con menos de 200 velas la EMA200 queda vacía (no se finge)', () => {
    assert.deepEqual(indicadoresDe(velas.slice(0, 150)).ema200, [])
  })

  test('curva del bot y de comprar y mantener: tiempos únicos crecientes y HODL ausente sin punto', () => {
    const c = curvaComparada([
      { t: 7_200_000, valor: 10_010, hodl: 9_990 },
      { t: 3_600_000, valor: 10_000, hodl: null },
      { t: 7_200_500, valor: 10_020, hodl: 9_980 },
    ])
    assert.deepEqual(c.bot, [{ time: 3600, value: 10_000 }, { time: 7200, value: 10_020 }])
    assert.deepEqual(c.hodl, [{ time: 7200, value: 9_980 }])
  })

  test('etiquetas del eje en hora de Madrid', () => {
    const t = 1792361228 // 19/10/2026 00:07 en Madrid, 18/10 22:07 UTC
    assert.equal(etiquetaTick(t, 0), '2026')
    assert.match(etiquetaTick(t, 1), /^oct\.?$/)
    assert.equal(etiquetaTick(t, 2), '19')
    assert.equal(etiquetaTick(t, 3), '00:07')
    assert.equal(etiquetaTick(t, 4), '00:07:08')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pwa/series.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/series.js`.

- [ ] **Step 3: Write the implementation**

Create `js/series.js`:

```js
// @ts-check
// Datos para los gráficos (lightweight-charts): velas de Binance pedidas por el navegador, EMA20/50/200 y
// RSI14 con los mismos indicadores de core/, y curvas de capital. Tiempos en segundos UTC (los de la librería).
import { ema, rsi } from '../core/indicadores.js'
import { descargarVelas } from '../worker/src/fuentes/binance.js'
import { ZONA } from './formato.js'

/** @typedef {import('../core/velas.js').Vela} Vela */
/** @typedef {'1h'|'4h'|'1d'} Temporalidad */
/** @typedef {{ time: number, value: number }} PuntoLinea */

/** @type {readonly Temporalidad[]} */
export const TEMPORALIDADES = Object.freeze(['1h', '4h', '1d'])
export const ETIQUETA_TEMPORALIDAD = Object.freeze({ '1h': '1H', '4h': '4H', '1d': '1D' })
/** Velas por gráfico (la última puede estar en curso): de sobra para la EMA200 y ~3 semanas en 1H. */
export const VELAS_GRAFICO = 500

/**
 * Velas del par en euros; si Binance no lo tiene o falla, las del par USDT (respaldo, se indica en la interfaz).
 * Nunca inventa precios: si fallan los dos, lanza.
 * @param {{ simbolo: string, temporalidad: Temporalidad, fetch: typeof fetch }} op
 * @returns {Promise<{ par: string, divisa: 'EUR'|'USDT', respaldo: boolean, velas: Vela[] }>}
 */
export async function velasDeMoneda({ simbolo, temporalidad, fetch }) {
  /** @type {string[]} */
  const errores = []
  for (const divisa of /** @type {const} */ (['EUR', 'USDT'])) {
    const par = `${simbolo}${divisa}`
    try {
      const velas = await descargarVelas(fetch, par, temporalidad, VELAS_GRAFICO)
      if (velas.length > 0) return { par, divisa, respaldo: divisa !== 'EUR', velas }
      errores.push(`${par}: sin velas`)
    } catch (e) {
      errores.push(`${par}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  throw new Error(`Binance no devolvió velas de ${simbolo} (${errores.join('; ')}).`)
}

/** @param {number} ms */
export const aSegundos = (ms) => Math.floor(ms / 1000)

/**
 * Formato de precio de una serie a la española: 2 decimales desde 1, 4 por debajo (como `precio` de formato.js).
 * @param {number} decimales
 */
export function formatoNumero(decimales) {
  const f = new Intl.NumberFormat('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })
  return { type: /** @type {'custom'} */ ('custom'), minMove: 10 ** -decimales, formatter: (/** @type {number} */ x) => f.format(x) }
}

/** @param {Vela[]} velas */
export const formatoPrecio = (velas) => formatoNumero(Math.abs(velas.length > 0 ? velas[velas.length - 1].cierre : 1) >= 1 ? 2 : 4)

/** @param {Vela[]} velas */
export const datosVelas = (velas) => velas.map((v) => ({
  time: aSegundos(v.inicio), open: v.apertura, high: v.maximo, low: v.minimo, close: v.cierre,
}))

/**
 * Serie de un indicador alineada con las velas, sin los huecos iniciales (null).
 * @param {Vela[]} velas
 * @param {(number|null)[]} serie
 * @returns {PuntoLinea[]}
 */
export function linea(velas, serie) {
  /** @type {PuntoLinea[]} */
  const puntos = []
  serie.forEach((valor, i) => {
    if (valor !== null) puntos.push({ time: aSegundos(velas[i].inicio), value: valor })
  })
  return puntos
}

/**
 * EMA20/50/200 y RSI14 de Wilder sobre los cierres (las de la señal, spec §6.1).
 * @param {Vela[]} velas
 */
export function indicadoresDe(velas) {
  const cierres = velas.map((v) => v.cierre)
  return {
    ema20: linea(velas, ema(cierres, 20)),
    ema50: linea(velas, ema(cierres, 50)),
    ema200: linea(velas, ema(cierres, 200)),
    rsi: linea(velas, rsi(cierres, 14)),
  }
}

/**
 * Curva del bot y de comprar y mantener. Tiempos estrictamente crecientes (si se repite un segundo,
 * gana el último punto) y HODL ausente (null) sin punto.
 * @param {{ t: number, valor: number, hodl: number|null }[]} puntos
 */
export function curvaComparada(puntos) {
  /** @type {Map<number, { valor: number, hodl: number|null }>} */
  const porTiempo = new Map()
  for (const p of puntos) porTiempo.set(aSegundos(p.t), { valor: p.valor, hodl: p.hodl })
  const tiempos = [...porTiempo.keys()].sort((a, b) => a - b)
  /** @type {PuntoLinea[]} */ const bot = []
  /** @type {PuntoLinea[]} */ const hodl = []
  for (const time of tiempos) {
    const p = /** @type {{ valor: number, hodl: number|null }} */ (porTiempo.get(time))
    bot.push({ time, value: p.valor })
    if (p.hodl !== null && Number.isFinite(p.hodl)) hodl.push({ time, value: p.hodl })
  }
  return { bot, hodl }
}

/** @type {Record<number, Intl.DateTimeFormat>} */
const TICKS = {
  0: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, year: 'numeric' }),
  1: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, month: 'short' }),
  2: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, day: 'numeric' }),
  3: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' }),
  4: new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
}

/**
 * Etiqueta del eje de tiempo en hora de Madrid (la librería pinta UTC por defecto).
 * tipo = TickMarkType de lightweight-charts: 0 año, 1 mes, 2 día, 3 hora, 4 hora con segundos.
 * @param {number} segundos
 * @param {number} tipo
 */
export const etiquetaTick = (segundos, tipo) => (TICKS[tipo] ?? TICKS[3]).format(segundos * 1000)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/pwa/series.test.js`
Expected: PASS — 9 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (280 tests).

- [ ] **Step 5: Commit**

```bash
git add js/series.js test/pwa/series.test.js
git commit -m "feat(pwa): velas de Binance (EUR con respaldo USDT) e indicadores de core para los gráficos" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: Lectura de la señal

**Files:**
- Create: `js/senal.js`
- Test: `test/pwa/senal.test.js`

**Interfaces:**
- Consumes: `ESTRATEGIAS` (`core/estrategias.js`: pesos por versión y umbrales de Fear & Greed), formatos (Task 1); en tests, `crearApi` (Task 2) y `workerSimulado` (Task 2).
- Produces (`js/senal.js`): `VIEJA_MS = 2 h`, `VEREDICTOS`, `veredicto(v): { texto, clase }`, `COMPONENTES` (T, D, N, F), `barrasComponentes(senal): { clave, letra, nombre, peso, pesoEfectivo, valor: number|null, ausente, texto, ancho: 0-1, sentido: 'positivo'|'negativo'|'neutro' }[]`, `tarjetaMoneda(senalResumen, ahoraServidor)`, `puntoArco(valor, cx, cy, r)`, `lecturaFng(fng): null | { valor, texto, clase, fecha, cuenta, nota }`, `MOTIVOS` + `textoMotivo(motivo)` (todo el vocabulario de §7.2, motivos de la señal y de salida), `textoMotor(motor)`, `filasTimeframes(senal)`, `orientativo(senal)`, `urlSegura(url)`, `lecturaTitular(titular, ahora)`, `filaDecision(decision)`.

- [ ] **Step 1: Write the failing test**

Create `test/pwa/senal.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/senal.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/senal.js`.

- [ ] **Step 3: Write the implementation**

Create `js/senal.js`:

```js
// @ts-check
// Lectura de la señal para la interfaz: veredicto, barras T/D/N/F (spec §6), Fear & Greed, titulares e historial.
// Funciones puras: reciben las formas del «Contrato de la API» y devuelven textos ya formateados.
import { ESTRATEGIAS } from '../core/estrategias.js'
import { claseSigno, fechaHora, hace, numero, porcentaje, precio } from './formato.js'

/** Más de 2 h sin recalcular = desactualizada (como `datosDesactualizados` del Worker). */
export const VIEJA_MS = 2 * 3_600_000

/** @type {Record<string, { texto: string, clase: string }>} */
export const VEREDICTOS = Object.freeze({
  COMPRAR: { texto: 'Comprar', clase: 'comprar' },
  MANTENER: { texto: 'Mantener', clase: 'mantener' },
  VENDER: { texto: 'Vender', clase: 'vender' },
  SIN_DATOS: { texto: 'Sin datos', clase: 'sin-datos' },
})

/** @param {string} v */
export const veredicto = (v) => VEREDICTOS[v] ?? { texto: v, clase: 'sin-datos' }

/** Componentes de la puntuación en el orden de la spec (§6.1-6.4). */
export const COMPONENTES = Object.freeze([
  { clave: 'tecnico', letra: 'T', nombre: 'Técnico' },
  { clave: 'derivados', letra: 'D', nombre: 'Derivados' },
  { clave: 'noticias', letra: 'N', nombre: 'Noticias y rumores' },
  { clave: 'fng', letra: 'F', nombre: 'Fear & Greed' },
])

/** @param {string|undefined} version @returns {Record<string, number>} */
function pesosDe(version) {
  const e = version && Object.hasOwn(ESTRATEGIAS, version) ? ESTRATEGIAS[/** @type {keyof typeof ESTRATEGIAS} */ (version)] : ESTRATEGIAS.v1
  return e.PARAMETROS.pesos
}

/**
 * Barras T/D/N/F: valor en [-1, 1], ausentes marcados y peso renormalizado sobre los presentes (§6.5).
 * @param {any} senal SenalCompleta
 */
export function barrasComponentes(senal) {
  const pesos = pesosDe(senal?.version)
  const ausentes = new Set(Array.isArray(senal?.ausentes) ? senal.ausentes : [])
  const filas = COMPONENTES.map((c) => {
    const bruto = senal?.componentes?.[c.clave]
    const ausente = ausentes.has(c.clave) || typeof bruto !== 'number'
    const valor = ausente ? null : /** @type {number} */ (bruto)
    return {
      ...c, valor, ausente, peso: pesos[c.clave],
      texto: ausente ? 'ausente' : numero(valor, 2, { signo: true }),
      ancho: valor === null ? 0 : Math.min(1, Math.abs(valor)),
      sentido: valor === null || valor === 0 ? 'neutro' : valor > 0 ? 'positivo' : 'negativo',
    }
  })
  const sumaPresentes = filas.filter((f) => !f.ausente).reduce((s, f) => s + f.peso, 0)
  return filas.map((f) => ({ ...f, pesoEfectivo: f.ausente || sumaPresentes === 0 ? 0 : f.peso / sumaPresentes }))
}

/**
 * Tarjeta del Panel a partir de una SenalResumen.
 * @param {any} s SenalResumen
 * @param {number} ahora instante del servidor (`resumen.ahora`), no el reloj del móvil
 */
export function tarjetaMoneda(s, ahora) {
  const v = veredicto(s.veredicto)
  return {
    simbolo: s.simbolo,
    precio: precio(s.precioEur),
    cambio: porcentaje(s.cambio24h, { signo: true }),
    claseCambio: claseSigno(s.cambio24h),
    veredicto: v.texto,
    claseVeredicto: v.clase,
    confianza: porcentaje(s.indiceConfianza, { decimales: 0 }),
    puntuacion: numero(s.puntuacion, 2, { signo: true }),
    frase: s.frase || 'Sin explicación.',
    actualizada: hace(s.calculadaEn, ahora),
    desactualizada: !s.fresca || ahora - s.calculadaEn > VIEJA_MS,
    version: s.estrategiaVersion,
  }
}

/** @type {Record<string, string>} */
const FNG_ES = {
  'Extreme Fear': 'Miedo extremo', Fear: 'Miedo', Neutral: 'Neutral', Greed: 'Codicia', 'Extreme Greed': 'Codicia extrema',
}

/**
 * Punto del arco del medidor (semicírculo de izquierda, 0, a derecha, 100).
 * @param {number} valor 0-100
 * @param {number} cx @param {number} cy @param {number} r
 */
export function puntoArco(valor, cx, cy, r) {
  const angulo = Math.PI * (1 - Math.min(100, Math.max(0, valor)) / 100)
  return { x: cx + r * Math.cos(angulo), y: cy - r * Math.sin(angulo) }
}

/**
 * Medidor de Fear & Greed. null si no hay dato.
 * @param {{ valor: number, clasificacion: string, t: number }|null} fng
 */
export function lecturaFng(fng) {
  if (!fng || typeof fng.valor !== 'number') return null
  const v = fng.valor
  const clase = v < 25 ? 'miedo-extremo' : v < 45 ? 'miedo' : v <= 55 ? 'neutral' : v <= 75 ? 'codicia' : 'codicia-extrema'
  const P = ESTRATEGIAS.v1.PARAMETROS.fng
  return {
    valor: v,
    texto: FNG_ES[fng.clasificacion] ?? fng.clasificacion,
    clase,
    fecha: fechaHora(fng.t),
    cuenta: v < P.miedo || v > P.codicia,
    nota: `Solo cuenta en la señal en extremos (menos de ${P.miedo} o más de ${P.codicia}), a la contra.`,
  }
}

/** @type {Record<string, string>} */
export const MOTIVOS = Object.freeze({
  abierta: 'Abrió posición',
  cerrada: 'Cerró la posición por señal',
  mantener: 'Mantener',
  sin_posicion: 'Vender sin posición abierta',
  ya_en_posicion: 'Ya había posición',
  confianza_baja: 'Confianza por debajo del mínimo',
  saldo_insuficiente: 'Saldo insuficiente',
  datos_desactualizados: 'Datos desactualizados',
  sin_datos: 'Sin datos de velas',
  enfriamiento: 'Enfriamiento tras un stop-loss',
  cerrada_por_stop: 'Cerrada por stop en esta hora',
  fuera_de_ventana: 'Fuera de la ventana de decisión (v2 decide a las 00:00 UTC)',
  contradiccion_tecnico_derivados: 'Técnico y derivados se contradicen',
  filtro_regimen: 'Filtro de régimen: cierre diario bajo la EMA200',
  velas_insuficientes: 'Velas insuficientes',
  senal: 'Señal',
  stop_loss: 'Stop-loss',
  take_profit: 'Take-profit',
})

/** @param {string|null|undefined} motivo */
export const textoMotivo = (motivo) => (motivo ? MOTIVOS[motivo] ?? motivo : '—')

/** @type {Record<string, string>} */
const MOTORES = { cf: 'Workers AI', groq: 'Groq', gemini: 'Gemini', lexico: 'Léxico local', plantilla: 'Plantilla' }

/** @param {string|null|undefined} motor */
export const textoMotor = (motor) => (motor ? MOTORES[motor] ?? motor : 'Sin puntuar')

/**
 * Indicadores por temporalidad (1D, 4H, 1H); null en la API → fila ausente.
 * @param {any} senal SenalCompleta
 */
export function filasTimeframes(senal) {
  return /** @type {const} */ (['1d', '4h', '1h']).map((tf) => {
    const t = senal?.detalle?.timeframes?.[tf]
    const etiqueta = tf.toUpperCase()
    if (!t) return { tf: etiqueta, ausente: true, tendencia: '—', rsi: '—', puntuacion: '—', ema200: '—', clase: 'neutro' }
    return {
      tf: etiqueta, ausente: false, tendencia: t.tendencia, rsi: numero(t.rsi, 1),
      puntuacion: numero(t.puntuacion, 2, { signo: true }), clase: claseSigno(t.puntuacion),
      ema200: t.precio > t.ema200 ? 'por encima' : 'por debajo',
    }
  })
}

/**
 * SL/TP orientativos en € si se abriera ahora (no son los de ninguna posición).
 * @param {any} senal
 */
export const orientativo = (senal) => (senal?.orientativo
  ? { stopLoss: precio(senal.orientativo.stopLoss), takeProfit: precio(senal.orientativo.takeProfit) }
  : null)

/** Solo enlaces http(s): un titular nunca puede inyectar javascript:. @param {string|null|undefined} url */
export const urlSegura = (url) => (typeof url === 'string' && /^https?:\/\//i.test(url) ? url : null)

/**
 * @param {any} t Titular
 * @param {number} ahora
 */
export const lecturaTitular = (t, ahora) => ({
  titulo: t.titulo,
  url: urlSegura(t.url),
  fuente: t.fuente,
  origen: t.origen === 'reddit' ? 'Reddit' : 'RSS',
  cuando: hace(t.publicadoEn, ahora),
  puntuacion: numero(t.puntuacion, 2, { signo: true }),
  clase: claseSigno(t.puntuacion),
  motor: textoMotor(t.motor),
  usado: t.usado === true,
  monedas: Array.isArray(t.monedas) ? t.monedas.join(', ') : '',
})

/** @param {any} d Decision */
export function filaDecision(d) {
  const v = veredicto(d.veredicto)
  return {
    id: d.id,
    simbolo: d.simbolo,
    cuando: fechaHora(d.vela1h),
    veredicto: v.texto,
    claseVeredicto: v.clase,
    puntuacion: numero(d.puntuacion, 2, { signo: true }),
    confianza: porcentaje(d.indiceConfianza, { decimales: 0 }),
    accion: d.accion === 'abrir' ? 'Abrir' : d.accion === 'cerrar' ? 'Cerrar' : 'Ninguna',
    ejecutada: d.accion === 'abrir' || d.accion === 'cerrar',
    motivo: textoMotivo(d.motivo),
    precio: precio(d.precio),
    version: d.estrategiaVersion,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/senal.test.js`
Expected: PASS — 11 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (291 tests).

- [ ] **Step 5: Commit**

```bash
git add js/senal.js test/pwa/senal.test.js
git commit -m "feat(pwa): lectura de la señal: veredicto, T/D/N/F con ausentes, Fear & Greed y titulares" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Lectura del bot y del backtest

**Files:**
- Create: `js/cartera.js`
- Test: `test/pwa/cartera.test.js`

**Interfaces:**
- Consumes: formatos (Task 1), `textoMotivo`, `veredicto` (Task 5); en tests, `CAPITAL_MINIMO`/`CAPITAL_MAXIMO` de `worker/src/api.js`, `ESTRATEGIAS`, `data/backtest-v1.json` y `data/backtest-v2.json`.
- Produces (`js/cartera.js`): `CAPITAL_MINIMO = 100`, `CAPITAL_MAXIMO = 1_000_000`, `CAPITAL_POR_DEFECTO = 10_000`, `filasMetricas(metricas): { etiqueta, valor, clase?, ayuda? }[]` (las 14 de §7.7; drawdown negativo y nunca «-0,00 %»), `filasPorMoneda(porMoneda, orden?)`, `frenteAHodl(r, rHodl): { texto, clase, bate: boolean|null }`, `filaPosicion(p)`, `filaOperacion(o)`, `FILTROS_DECISION` (`todas | ejecutadas | no_ejecutadas | hold`), `filtrarDecisiones(items, filtro)`, `opcionesSimulacion(simulaciones)`, `validarCapital(texto): { ok: true, capital } | { ok: false, error }`, `filasDecisionesBacktest(decisiones)`, `salidasBacktest(operaciones)`, `lecturaBacktest(json)`, `notaBacktest(jsons): string`.

- [ ] **Step 1: Write the failing test**

Create `test/pwa/cartera.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ESTRATEGIAS } from '../../core/estrategias.js'
import { CAPITAL_MAXIMO as MAX_WORKER, CAPITAL_MINIMO as MIN_WORKER } from '../../worker/src/api.js'
import { crearApi } from '../../js/api.js'
import {
  CAPITAL_MAXIMO, CAPITAL_MINIMO, FILTROS_DECISION, filaOperacion, filaPosicion, filasDecisionesBacktest, filasMetricas,
  filasPorMoneda, filtrarDecisiones, frenteAHodl, lecturaBacktest, notaBacktest, opcionesSimulacion, salidasBacktest, validarCapital,
} from '../../js/cartera.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'

const ESP = '\u00a0'
/** @param {string} v */
const backtest = (v) => JSON.parse(readFileSync(new URL(`../../data/backtest-${v}.json`, import.meta.url), 'utf8'))

async function botReal() {
  const w = await workerSimulado()
  const api = crearApi({ base: BASE, fetch: w.fetch, pin: () => PIN })
  return { api, bot: await api.bot() }
}

describe('bot en la interfaz', () => {
  test('las 14 métricas de §7.7 con etiqueta, a partir del bot real', async () => {
    const { bot } = await botReal()
    const filas = filasMetricas(bot.metricas)
    assert.deepEqual(filas.map((f) => f.etiqueta), [
      'Valor de cartera', 'Saldo disponible', 'Beneficio realizado', 'Beneficio no realizado', 'Rentabilidad neta',
      'Comprar y mantener', 'Drawdown máximo', 'Drawdown de comprar y mantener', 'Operaciones (compras + ventas)',
      'Ganadoras / perdedoras', 'Beneficio medio por operación cerrada', 'Comisiones', 'Deslizamiento', 'Frecuencia',
    ])
    const valor = (/** @type {string} */ e) => filas.find((f) => f.etiqueta === e)?.valor
    assert.equal(valor('Valor de cartera'), `10.030,73${ESP}€`)
    assert.equal(valor('Beneficio realizado'), `+32,74${ESP}€`)
    assert.equal(valor('Rentabilidad neta'), `+0,31${ESP}%`)
    assert.equal(valor('Drawdown máximo'), `-0,62${ESP}%`)
    assert.equal(valor('Ganadoras / perdedoras'), '1 / 1')
    assert.equal(valor('Frecuencia'), '201,6 por semana')
  })

  test('por moneda en el orden pedido, con costes = comisiones + deslizamiento', async () => {
    const { bot } = await botReal()
    const filas = filasPorMoneda(bot.porMoneda, ['ETH', 'BTC'])
    assert.deepEqual(filas.map((f) => f.simbolo), ['ETH', 'BTC'])
    assert.deepEqual([filas[1].ganadorasPerdedoras, filas[1].beneficio, filas[1].clase], ['0 / 1', `-69,10${ESP}€`, 'baja'])
    assert.equal(filas[0].costes, `9,16${ESP}€`)
    assert.deepEqual(filasPorMoneda({}), [])
  })

  test('posiciones abiertas con SL/TP fijos y operaciones con motivo', async () => {
    const { api, bot } = await botReal()
    const p = filaPosicion(bot.abiertas[0])
    assert.deepEqual([p.simbolo, p.stopLoss, p.takeProfit, p.clase], ['ETH', `9,65${ESP}€`, `10,50${ESP}€`, 'sube'])
    assert.equal(p.pnl, `+1,00${ESP}€ (+0,05${ESP}%)`)
    const ops = (await api.operaciones()).items.map(filaOperacion)
    const venta = ops.find((o) => o.lado === 'Venta' && o.simbolo === 'BTC')
    assert.deepEqual([venta?.motivo, venta?.clase], ['Stop-loss', 'baja'])
    assert.equal(ops.find((o) => o.lado === 'Compra')?.pnl, '')
  })

  test('frente a comprar y mantener, en puntos', () => {
    assert.deepEqual(frenteAHodl(-0.185108990116729, 0.19968549372488598),
      { texto: `38,48 puntos por debajo de comprar y mantener (+19,97${ESP}%).`, clase: 'baja', bate: false })
    assert.equal(frenteAHodl(0.1, 0.05).bate, true)
    assert.equal(frenteAHodl(0.1, null).bate, null)
  })

  test('filtro de decisiones: ejecutadas, no ejecutadas (compra/venta) y HOLD', () => {
    const d = [
      { id: 1, veredicto: 'COMPRAR', accion: 'abrir' },
      { id: 2, veredicto: 'COMPRAR', accion: 'ninguna' },
      { id: 3, veredicto: 'MANTENER', accion: 'ninguna' },
      { id: 4, veredicto: 'VENDER', accion: 'ninguna' },
      { id: 5, veredicto: 'VENDER', accion: 'cerrar' },
      { id: 6, veredicto: 'SIN_DATOS', accion: 'ninguna' },
    ]
    const ids = (/** @type {string} */ f) => filtrarDecisiones(d, f).map((x) => x.id)
    assert.deepEqual(FILTROS_DECISION.map((f) => f.clave), ['todas', 'ejecutadas', 'no_ejecutadas', 'hold'])
    assert.deepEqual(ids('todas'), [1, 2, 3, 4, 5, 6])
    assert.deepEqual(ids('ejecutadas'), [1, 5])
    assert.deepEqual(ids('no_ejecutadas'), [2, 4])
    assert.deepEqual(ids('hold'), [3])
    assert.deepEqual(ids('raro'), [1, 2, 3, 4, 5, 6])
  })

  test('selector de simulaciones tras un reinicio', async () => {
    const { api } = await botReal()
    await api.reiniciar(2500)
    const opciones = opcionesSimulacion((await api.simulaciones()).items)
    assert.deepEqual(opciones.map((o) => o.valor), ['2', '1'])
    assert.match(opciones[0].texto, new RegExp(`^Simulación 2 · v1 · 2500,00${ESP}€ · activa desde \\d\\d/\\d\\d/\\d{4}$`))
    assert.match(opciones[1].texto, /^Simulación 1 · v1 · 10\.000,00\s€ · cerrada el \d\d\/\d\d\/\d{4}$/)
  })

  test('validarCapital: formato español y los mismos límites que el Worker', () => {
    assert.deepEqual([CAPITAL_MINIMO, CAPITAL_MAXIMO], [MIN_WORKER, MAX_WORKER])
    assert.deepEqual(validarCapital('10.000'), { ok: true, capital: 10_000 })
    assert.deepEqual(validarCapital('100'), { ok: true, capital: 100 })
    assert.equal(validarCapital('99,99').ok, false)
    assert.equal(validarCapital('1.000.001').ok, false)
    assert.deepEqual(validarCapital('mucho'), { ok: false, error: 'Escribe un importe en euros, por ejemplo 10.000.' })
  })
})

describe('backtest en la interfaz', () => {
  test('hay un data/backtest-vN.json por estrategia registrada', () => {
    for (const v of Object.keys(ESTRATEGIAS)) assert.equal(backtest(v).version, v)
  })

  test('lectura de data/backtest-v1.json: etiqueta, periodo, métricas y curva', () => {
    const b = backtest('v1')
    const l = lecturaBacktest(b)
    assert.equal(l.version, 'v1')
    assert.equal(l.variante, 'técnico + Fear & Greed')
    assert.equal(l.periodo, '18/10/2024 – 18/10/2026')
    assert.equal(l.capitalInicial, `10.000,00${ESP}€`)
    assert.equal(l.cadencia, 'cada hora')
    assert.equal(l.metricas.find((f) => f.etiqueta === 'Rentabilidad neta')?.valor, `-18,51${ESP}%`)
    assert.equal(l.metricas.find((f) => f.etiqueta === 'Comprar y mantener')?.valor, `+19,97${ESP}%`)
    assert.equal(l.rentabilidad, `-18,51${ESP}%`)
    assert.equal(l.frenteHodl.bate, false)
    assert.equal(filasMetricas({ ...b.metricas, drawdownMaximo: 0 }).find((f) => f.etiqueta === 'Drawdown máximo')?.valor, `0,00${ESP}%`)
    assert.deepEqual(l.porMoneda.map((f) => f.simbolo), ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'])
    assert.equal(l.curva.length, b.curvaDiaria.length)
    assert.match(l.aviso, /No es asesoramiento financiero ni garantía de beneficio/)
    assert.equal(lecturaBacktest(backtest('v2')).cadencia, 'una vez al día (00:00 UTC)')
  })

  test('recuentos de decisiones y de cierres por motivo', () => {
    const b = backtest('v1')
    const filas = filasDecisionesBacktest(b.decisiones)
    assert.deepEqual(filas[0], { veredicto: 'Mantener', claseVeredicto: 'mantener', motivo: 'Mantener', n: 62621, cantidad: '62.621' })
    assert.equal(filas.reduce((s, f) => s + f.n, 0), Object.values(b.decisiones).reduce((s, n) => s + n, 0))
    const salidas = salidasBacktest(b.operaciones)
    assert.deepEqual(salidas.map((s) => s.motivo).sort(), ['Stop-loss', 'Take-profit'], 'v1 no cierra ninguna por VENDER (spec §6.6)')
    assert.equal(salidas.reduce((s, x) => s + Number(x.cantidad.replace('.', '')), 0), b.metricas.cerradas)
  })

  test('nota honesta: ninguna estrategia bate a comprar y mantener', () => {
    assert.equal(notaBacktest([backtest('v1'), backtest('v2')]),
      'Ninguna de las estrategias (v1 y v2) bate a comprar y mantener en este periodo. Un backtest no garantiza resultados futuros.')
    assert.equal(notaBacktest([backtest('v2')]),
      'La estrategia v2 no bate a comprar y mantener en este periodo. Un backtest no garantiza resultados futuros.')
    assert.match(notaBacktest([{ version: 'v9', metricas: { rentabilidad: 0.5, rentabilidadHodl: 0.1 } }]), /^Alguna estrategia supera/)
    assert.equal(notaBacktest([]), 'Un backtest no garantiza resultados futuros.')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/cartera.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/cartera.js`.

- [ ] **Step 3: Write the implementation**

Create `js/cartera.js`:

```js
// @ts-check
// Lectura de la cartera del bot y del backtest para la interfaz: métricas de §7.7, posiciones, operaciones,
// filtros de decisiones, simulaciones y reinicio. Funciones puras sobre las formas del «Contrato de la API»
// y de data/backtest-vN.json.
import { claseSigno, entero, euros, fecha, fechaHora, leerImporte, numero, porcentaje, precio } from './formato.js'
import { textoMotivo, veredicto } from './senal.js'

/** Límites de `POST /api/bot/reiniciar` (CAPITAL_MINIMO y CAPITAL_MAXIMO de worker/src/api.js). */
export const CAPITAL_MINIMO = 100
export const CAPITAL_MAXIMO = 1_000_000
export const CAPITAL_POR_DEFECTO = 10_000

/** @typedef {{ etiqueta: string, valor: string, clase?: string, ayuda?: string }} Fila */

/** El drawdown llega positivo (0,25 = caída del 25 %) y se enseña negativo; sin caída, 0 (nunca '-0,00 %'). @param {number|null|undefined} d */
const caida = (d) => (typeof d === 'number' && d > 0 ? -d : d)

/**
 * Las métricas de §7.7 en filas etiquetadas.
 * @param {any} m Metricas (API) o `metricas` de data/backtest-vN.json (misma forma)
 * @returns {Fila[]}
 */
export function filasMetricas(m) {
  return [
    { etiqueta: 'Valor de cartera', valor: euros(m.valorCartera) },
    { etiqueta: 'Saldo disponible', valor: euros(m.saldo) },
    { etiqueta: 'Beneficio realizado', valor: euros(m.beneficioRealizado, { signo: true }), clase: claseSigno(m.beneficioRealizado) },
    { etiqueta: 'Beneficio no realizado', valor: euros(m.beneficioNoRealizado, { signo: true }), clase: claseSigno(m.beneficioNoRealizado) },
    { etiqueta: 'Rentabilidad neta', valor: porcentaje(m.rentabilidad, { signo: true }), clase: claseSigno(m.rentabilidad), ayuda: 'Después de comisiones y deslizamiento.' },
    { etiqueta: 'Comprar y mantener', valor: porcentaje(m.rentabilidadHodl, { signo: true }), clase: claseSigno(m.rentabilidadHodl), ayuda: 'El capital inicial repartido a partes iguales entre las monedas el primer día.' },
    { etiqueta: 'Drawdown máximo', valor: porcentaje(caida(m.drawdownMaximo)), ayuda: 'Mayor caída desde un máximo de la curva horaria.' },
    { etiqueta: 'Drawdown de comprar y mantener', valor: porcentaje(caida(m.drawdownMaximoHodl)) },
    { etiqueta: 'Operaciones (compras + ventas)', valor: entero(m.operaciones) },
    { etiqueta: 'Ganadoras / perdedoras', valor: `${entero(m.ganadoras)} / ${entero(m.perdedoras)}`, ayuda: `${entero(m.cerradas)} posiciones cerradas.` },
    { etiqueta: 'Beneficio medio por operación cerrada', valor: euros(m.beneficioMedio, { signo: true }), clase: claseSigno(m.beneficioMedio) },
    { etiqueta: 'Comisiones', valor: euros(m.comisiones) },
    { etiqueta: 'Deslizamiento', valor: euros(m.deslizamiento) },
    { etiqueta: 'Frecuencia', valor: m.operacionesPorSemana === null || m.operacionesPorSemana === undefined ? '—' : `${numero(m.operacionesPorSemana, 1)} por semana` },
  ]
}

/**
 * Métricas por moneda, en el orden dado (las que no operaron, al final y en orden alfabético).
 * @param {Record<string, any>} porMoneda ResumenOperaciones por símbolo
 * @param {string[]} [orden]
 */
export function filasPorMoneda(porMoneda, orden = []) {
  const simbolos = Object.keys(porMoneda ?? {}).sort((a, b) => {
    const ia = orden.indexOf(a)
    const ib = orden.indexOf(b)
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib) || a.localeCompare(b)
  })
  return simbolos.map((simbolo) => {
    const r = porMoneda[simbolo]
    return {
      simbolo,
      operaciones: entero(r.operaciones),
      ganadorasPerdedoras: `${entero(r.ganadoras)} / ${entero(r.perdedoras)}`,
      beneficio: euros(r.beneficioRealizado, { signo: true }),
      clase: claseSigno(r.beneficioRealizado),
      medio: euros(r.beneficioMedio, { signo: true }),
      costes: euros(r.comisiones + r.deslizamiento),
    }
  })
}

/**
 * Comparación honesta con comprar y mantener, en puntos porcentuales.
 * @param {number|null|undefined} rentabilidad @param {number|null|undefined} rentabilidadHodl fracciones
 */
export function frenteAHodl(rentabilidad, rentabilidadHodl) {
  if (typeof rentabilidad !== 'number' || typeof rentabilidadHodl !== 'number') {
    return { texto: 'Comprar y mantener aún sin valorar.', clase: 'neutro', bate: null }
  }
  const diferencia = rentabilidad - rentabilidadHodl
  const puntos = numero(Math.abs(diferencia) * 100, 2)
  const bate = diferencia > 0
  const texto = diferencia === 0
    ? 'Igual que comprar y mantener.'
    : `${puntos} puntos ${bate ? 'por encima' : 'por debajo'} de comprar y mantener (${porcentaje(rentabilidadHodl, { signo: true })}).`
  return { texto, clase: claseSigno(diferencia), bate }
}

/** @param {any} p Posicion */
export const filaPosicion = (p) => ({
  simbolo: p.simbolo,
  desde: fechaHora(p.velaEntrada),
  entrada: precio(p.precioEntrada),
  actual: precio(p.precioActual),
  unidades: numero(p.unidades, 6),
  coste: euros(p.coste),
  valor: euros(p.valorActual),
  stopLoss: precio(p.stopLoss),
  takeProfit: precio(p.takeProfit),
  pnl: `${euros(p.pnlNoRealizado, { signo: true })} (${porcentaje(p.pnlNoRealizadoPct, { signo: true })})`,
  clase: claseSigno(p.pnlNoRealizado),
})

/** @param {any} o Operacion de la API */
export const filaOperacion = (o) => ({
  id: o.id,
  cuando: fechaHora(o.vela1h),
  simbolo: o.simbolo,
  lado: o.lado === 'compra' ? 'Compra' : 'Venta',
  precio: precio(o.precio),
  unidades: numero(o.unidades, 6),
  importe: euros(o.importe),
  costes: euros(o.comision + o.deslizamiento),
  motivo: textoMotivo(o.motivo),
  pnl: o.pnlNeto === null || o.pnlNeto === undefined ? '' : euros(o.pnlNeto, { signo: true }),
  clase: claseSigno(o.pnlNeto),
})

/** Filtros del historial de decisiones (spec §12: incluye HOLD y no ejecutadas). */
export const FILTROS_DECISION = Object.freeze([
  { clave: 'todas', texto: 'Todas' },
  { clave: 'ejecutadas', texto: 'Ejecutadas' },
  { clave: 'no_ejecutadas', texto: 'Compra o venta no ejecutada' },
  { clave: 'hold', texto: 'Mantener (HOLD)' },
])

/**
 * @param {any[]} decisiones
 * @param {string} filtro clave de FILTROS_DECISION (otra → todas)
 */
export function filtrarDecisiones(decisiones, filtro) {
  const ejecutada = (/** @type {any} */ d) => d.accion === 'abrir' || d.accion === 'cerrar'
  if (filtro === 'ejecutadas') return decisiones.filter(ejecutada)
  if (filtro === 'no_ejecutadas') return decisiones.filter((d) => !ejecutada(d) && (d.veredicto === 'COMPRAR' || d.veredicto === 'VENDER'))
  if (filtro === 'hold') return decisiones.filter((d) => d.veredicto === 'MANTENER')
  return decisiones
}

/**
 * Opciones del selector de simulación (la API las da por id descendente).
 * @param {any[]} simulaciones
 */
export const opcionesSimulacion = (simulaciones) => simulaciones.map((s) => ({
  valor: String(s.id),
  texto: `Simulación ${s.id} · ${s.estrategiaVersion} · ${euros(s.capitalInicial)} · ${s.activa ? `activa desde ${fecha(s.creadaEn)}` : `cerrada el ${fecha(s.cerradaEn)}`}`,
}))

/**
 * Capital del reinicio escrito a la española, dentro de los límites del Worker.
 * @param {string} texto
 * @returns {{ ok: true, capital: number } | { ok: false, error: string }}
 */
export function validarCapital(texto) {
  const capital = leerImporte(texto)
  if (capital === null) return { ok: false, error: 'Escribe un importe en euros, por ejemplo 10.000.' }
  if (capital < CAPITAL_MINIMO || capital > CAPITAL_MAXIMO) {
    return { ok: false, error: `El capital debe estar entre ${euros(CAPITAL_MINIMO)} y ${euros(CAPITAL_MAXIMO)}.` }
  }
  return { ok: true, capital }
}

/** @type {Record<string, string>} */
const VARIANTES = { 'tecnico+fng': 'técnico + Fear & Greed' }

/**
 * Recuento de decisiones del backtest ('COMPRAR:abierta' → n) en filas, de más a menos frecuente.
 * @param {Record<string, number>} decisiones
 */
export const filasDecisionesBacktest = (decisiones) => Object.entries(decisiones ?? {})
  .map(([clave, n]) => {
    const [v, motivo] = clave.split(':')
    return { veredicto: veredicto(v).texto, claseVeredicto: veredicto(v).clase, motivo: textoMotivo(motivo), n, cantidad: entero(n) }
  })
  .sort((a, b) => b.n - a.n)

/**
 * Cierres de posición del backtest por motivo (señal, stop-loss, take-profit).
 * @param {{ tipo: string, motivo: string }[]} operaciones
 */
export function salidasBacktest(operaciones) {
  /** @type {Record<string, number>} */
  const n = {}
  for (const o of operaciones ?? []) if (o.tipo === 'venta') n[o.motivo] = (n[o.motivo] ?? 0) + 1
  return Object.entries(n).sort((a, b) => b[1] - a[1]).map(([motivo, cantidad]) => ({ motivo: textoMotivo(motivo), cantidad: entero(cantidad) }))
}

/**
 * Todo lo que enseña la pestaña Backtest de un data/backtest-vN.json.
 * @param {any} b
 */
export function lecturaBacktest(b) {
  return {
    version: b.version,
    variante: VARIANTES[b.variante] ?? b.variante,
    periodo: `${fecha(b.desde)} – ${fecha(b.hasta)}`,
    capitalInicial: euros(b.capitalInicial),
    monedas: (b.monedas ?? []).join(', '),
    cadencia: (b.parametros?.bot?.cadenciaHoras ?? 1) === 24 ? 'una vez al día (00:00 UTC)' : 'cada hora',
    metricas: filasMetricas(b.metricas),
    rentabilidad: porcentaje(b.metricas?.rentabilidad, { signo: true }),
    frenteHodl: frenteAHodl(b.metricas?.rentabilidad, b.metricas?.rentabilidadHodl),
    porMoneda: filasPorMoneda(b.porMoneda, b.monedas),
    decisiones: filasDecisionesBacktest(b.decisiones),
    salidas: salidasBacktest(b.operaciones),
    curva: b.curvaDiaria ?? [],
    aviso: b.aviso ?? '',
    generado: fechaHora(Date.parse(b.generadoEn)),
  }
}

/**
 * Nota honesta sobre todos los backtests cargados: si ninguno bate a comprar y mantener, se dice.
 * @param {any[]} backtests data/backtest-vN.json cargados
 */
export function notaBacktest(backtests) {
  const validos = backtests.filter((b) => typeof b?.metricas?.rentabilidad === 'number' && typeof b?.metricas?.rentabilidadHodl === 'number')
  const futuro = 'Un backtest no garantiza resultados futuros.'
  if (validos.length === 0) return futuro
  const versiones = validos.map((b) => b.version).join(' y ')
  if (validos.every((b) => b.metricas.rentabilidad <= b.metricas.rentabilidadHodl)) {
    return `${validos.length > 1 ? `Ninguna de las estrategias (${versiones})` : `La estrategia ${versiones} no`} bate a comprar y mantener en este periodo. ${futuro}`
  }
  return `Alguna estrategia supera a comprar y mantener en este periodo, pero sin noticias ni derivados y con costes aproximados. ${futuro}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/cartera.test.js`
Expected: PASS — 11 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (302 tests).

- [ ] **Step 5: Commit**

```bash
git add js/cartera.js test/pwa/cartera.test.js
git commit -m "feat(pwa): métricas del bot y del backtest, filtros de decisiones y reinicio validado" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Icono de ORACLE para el iPhone y Android

**Files:**
- Modify: `package.json` (script `iconos`)
- Create: `icons/icono.svg`
- Create: `scripts/iconos.mjs`
- Create (generados): `icons/apple-touch-icon.png`, `icons/icono-192.png`, `icons/icono-512.png`, `icons/icono-maskable-512.png`
- Test: `test/pwa/iconos.test.js`

**Interfaces:**
- Consumes: nada (solo `node:zlib`).
- Produces (`scripts/iconos.mjs`): `SALIDAS` (`apple-touch-icon.png` 180, `icono-192.png`, `icono-512.png`, `icono-maskable-512.png` con `escala: 0.75`), `leerSvg(texto): { lado, formas }` (solo `rect`, `circle`, `polygon` con `fill="#rrggbb"`; otro elemento → error), `rasterizar(dibujo, lado, { escala?, muestras? }): Uint8Array` (RGB), `codificarPng(rgb, ancho, alto): Buffer` (8 bits, tipo de color 2: sin alfa), `leerPng(buffer)`, `generar()`. `node scripts/iconos.mjs` escribe los cuatro PNG.

- [ ] **Step 1: Write the failing test**

Create `test/pwa/iconos.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { SALIDAS, codificarPng, leerPng, leerSvg, rasterizar } from '../../scripts/iconos.mjs'

const SVG = readFileSync(new URL('../../icons/icono.svg', import.meta.url), 'utf8')
/** @param {string} archivo */
const png = (archivo) => readFileSync(new URL(`../../icons/${archivo}`, import.meta.url))

describe('iconos', () => {
  test('icono.svg: cuadrado, con fondo opaco que lo cubre entero', () => {
    const d = leerSvg(SVG)
    assert.equal(d.lado, 512)
    assert.deepEqual(d.formas[0], { tipo: 'rect', x: 0, y: 0, ancho: 512, alto: 512, color: [0x0b, 0x0f, 0x17] })
    assert.ok(d.formas.length > 5)
  })

  test('el lector de SVG rechaza lo que no sabe pintar', () => {
    const svg = (/** @type {string} */ cuerpo) => `<svg viewBox="0 0 10 10">${cuerpo}</svg>`
    assert.throws(() => leerSvg(svg('<path d="M0 0L5 5Z" fill="#ffffff"/>')), /elemento no admitido en icono\.svg: <path>/)
    assert.throws(() => leerSvg(svg('<rect x="0" y="0" width="1" height="1" fill="red"/>')), /color no admitido: red/)
    assert.throws(() => leerSvg('<svg viewBox="0 0 10 20"><rect/></svg>'), /cuadrado/)
  })

  test('PNG RGB opaco: codificar y leer devuelven los mismos píxeles', () => {
    const rgb = Uint8Array.from({ length: 3 * 3 * 3 }, (_, i) => (i * 29) % 256)
    const leido = leerPng(codificarPng(rgb, 3, 3))
    assert.deepEqual([leido.ancho, leido.alto, leido.profundidad, leido.tipoColor], [3, 3, 8, 2])
    assert.deepEqual(leido.rgb, rgb)
  })

  test('el rasterizador suaviza los bordes y respeta el orden de pintado', () => {
    const d = leerSvg('<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="#000000"/><rect x="0" y="0" width="2" height="4" fill="#ffffff"/><circle cx="3" cy="3" r="0.2" fill="#ff0000"/></svg>')
    const rgb = rasterizar(d, 4)
    assert.deepEqual([...rgb.subarray(0, 3)], [255, 255, 255])
    assert.deepEqual([...rgb.subarray(3 * 3, 3 * 3 + 3)], [0, 0, 0])
    const borde = rasterizar(leerSvg('<svg viewBox="0 0 4 4"><rect x="0" y="0" width="4" height="4" fill="#000000"/><rect x="0" y="0" width="1" height="4" fill="#ffffff"/></svg>'), 2)
    assert.deepEqual([...borde.subarray(0, 3)], [128, 128, 128], 'medio píxel blanco → gris')
    assert.deepEqual([...borde.subarray(3, 6)], [0, 0, 0])
  })

  for (const { archivo, lado, escala } of SALIDAS) {
    test(`icons/${archivo}: ${lado}×${lado}, RGB opaco y generado desde icono.svg`, () => {
      const p = leerPng(png(archivo))
      assert.deepEqual([p.ancho, p.alto, p.profundidad, p.tipoColor], [lado, lado, 8, 2])
      assert.ok(Buffer.from(p.rgb).equals(Buffer.from(rasterizar(leerSvg(SVG), lado, { escala }))),
        'el PNG no coincide con icono.svg: ejecuta node scripts/iconos.mjs')
    })
  }

  test('el icono maskable deja todo el dibujo dentro de la zona segura (círculo de radio 40 %)', () => {
    const { ancho, rgb } = leerPng(png('icono-maskable-512.png'))
    const radio = 0.4 * ancho
    let fuera = 0
    for (let y = 0; y < ancho; y++) {
      for (let x = 0; x < ancho; x++) {
        const i = (y * ancho + x) * 3
        const esFondo = rgb[i] === 0x0b && rgb[i + 1] === 0x0f && rgb[i + 2] === 0x17
        if (!esFondo && Math.hypot(x + 0.5 - ancho / 2, y + 0.5 - ancho / 2) > radio) fuera++
      }
    }
    assert.equal(fuera, 0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pwa/iconos.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `scripts/iconos.mjs`.

- [ ] **Step 3: Draw the icon and write the generator**

Create `icons/icono.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <title>ORACLE</title>
  <!-- Fondo opaco (iOS no admite transparencia en el icono de inicio) -->
  <rect x="0" y="0" width="512" height="512" fill="#0b0f17"/>
  <!-- Bola de cristal: aro turquesa y cristal oscuro -->
  <circle cx="256" cy="232" r="168" fill="#2dd4bf"/>
  <circle cx="256" cy="232" r="148" fill="#10232e"/>
  <!-- Reflejo -->
  <circle cx="190" cy="150" r="20" fill="#9ff3e6"/>
  <!-- Tres velas al alza dentro de la bola -->
  <rect x="196" y="236" width="8" height="104" fill="#2dd4bf"/>
  <rect x="180" y="254" width="40" height="70" fill="#2dd4bf"/>
  <rect x="252" y="196" width="8" height="124" fill="#2dd4bf"/>
  <rect x="236" y="214" width="40" height="88" fill="#2dd4bf"/>
  <rect x="308" y="140" width="8" height="150" fill="#f2c14e"/>
  <rect x="292" y="160" width="40" height="112" fill="#f2c14e"/>
  <!-- Peana dorada -->
  <polygon points="168,392 344,392 384,452 128,452" fill="#f2c14e"/>
  <rect x="112" y="452" width="288" height="24" fill="#f2c14e"/>
</svg>
```

Create `scripts/iconos.mjs`:

```js
// @ts-check
// Genera los PNG de icons/ a partir de icons/icono.svg, sin dependencias: un rasterizador mínimo
// (rect, circle y polygon con relleno de color #rrggbb, 4×4 muestras por píxel) y un codificador PNG
// RGB opaco con node:zlib. Reproducible: mismo SVG → mismos píxeles en cualquier máquina.
//
//   node scripts/iconos.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

const RAIZ = new URL('../', import.meta.url)

/** escala < 1 encoge el dibujo hacia el centro (zona segura de los iconos maskable: círculo de radio 40 %). */
export const SALIDAS = Object.freeze([
  { archivo: 'apple-touch-icon.png', lado: 180, escala: 1 },
  { archivo: 'icono-192.png', lado: 192, escala: 1 },
  { archivo: 'icono-512.png', lado: 512, escala: 1 },
  { archivo: 'icono-maskable-512.png', lado: 512, escala: 0.75 },
])

/**
 * @typedef {[number, number, number]} Rgb
 * @typedef {{ tipo: 'rect', x: number, y: number, ancho: number, alto: number, color: Rgb }
 *   | { tipo: 'circle', cx: number, cy: number, r: number, color: Rgb }
 *   | { tipo: 'polygon', puntos: [number, number][], color: Rgb }} Forma
 */

/** @param {string} hex '#rrggbb' @returns {Rgb} */
function color(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!m) throw new Error(`color no admitido: ${hex}`)
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}

/**
 * Lee el subconjunto de SVG que usa icono.svg. Cualquier otro elemento gráfico es un error (mejor que ignorarlo).
 * @param {string} texto
 * @returns {{ lado: number, formas: Forma[] }}
 */
export function leerSvg(texto) {
  const caja = /viewBox="0 0 (\d+) (\d+)"/.exec(texto)
  if (!caja || caja[1] !== caja[2]) throw new Error('icono.svg debe tener viewBox="0 0 N N" cuadrado')
  const sinComentarios = texto.replace(/<!--[\s\S]*?-->/g, '')
  /** @type {Forma[]} */
  const formas = []
  for (const [, etiqueta, atributos] of sinComentarios.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
    if (['svg', 'title'].includes(etiqueta)) continue
    const a = Object.fromEntries([...atributos.matchAll(/([a-z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]))
    const n = (/** @type {string} */ k) => {
      const v = Number(a[k])
      if (!Number.isFinite(v)) throw new Error(`${etiqueta}: falta ${k}`)
      return v
    }
    const c = color(a.fill ?? '')
    if (etiqueta === 'rect') formas.push({ tipo: 'rect', x: n('x'), y: n('y'), ancho: n('width'), alto: n('height'), color: c })
    else if (etiqueta === 'circle') formas.push({ tipo: 'circle', cx: n('cx'), cy: n('cy'), r: n('r'), color: c })
    else if (etiqueta === 'polygon') {
      const valores = (a.points ?? '').trim().split(/[\s,]+/).map(Number)
      if (valores.length < 6 || valores.length % 2 || valores.some((v) => !Number.isFinite(v))) throw new Error('polygon: points no válido')
      /** @type {[number, number][]} */
      const puntos = []
      for (let i = 0; i < valores.length; i += 2) puntos.push([valores[i], valores[i + 1]])
      formas.push({ tipo: 'polygon', puntos, color: c })
    } else throw new Error(`elemento no admitido en icono.svg: <${etiqueta}>`)
  }
  if (formas.length === 0) throw new Error('icono.svg sin formas')
  return { lado: Number(caja[1]), formas }
}

/** @param {Forma} f @param {number} x @param {number} y */
function dentro(f, x, y) {
  if (f.tipo === 'rect') return x >= f.x && x < f.x + f.ancho && y >= f.y && y < f.y + f.alto
  if (f.tipo === 'circle') return (x - f.cx) ** 2 + (y - f.cy) ** 2 <= f.r ** 2
  let impar = false
  const p = f.puntos
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i]
    const [xj, yj] = p[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) impar = !impar
  }
  return impar
}

/**
 * Pinta el dibujo en un cuadrado de `lado` píxeles, RGB sin alfa. Fuera de todo, el color de la primera forma (el fondo).
 * @param {{ lado: number, formas: Forma[] }} dibujo
 * @param {number} lado
 * @param {{ escala?: number, muestras?: number }} [op]
 */
export function rasterizar(dibujo, lado, { escala = 1, muestras = 4 } = {}) {
  const rgb = new Uint8Array(lado * lado * 3)
  const unidad = dibujo.lado / lado
  const centro = dibujo.lado / 2
  const fondo = dibujo.formas[0].color
  const total = muestras * muestras
  for (let py = 0; py < lado; py++) {
    for (let px = 0; px < lado; px++) {
      let r = 0
      let g = 0
      let b = 0
      for (let sy = 0; sy < muestras; sy++) {
        for (let sx = 0; sx < muestras; sx++) {
          const x = centro + ((px + (sx + 0.5) / muestras) * unidad - centro) / escala
          const y = centro + ((py + (sy + 0.5) / muestras) * unidad - centro) / escala
          let c = fondo
          for (const f of dibujo.formas) if (dentro(f, x, y)) c = f.color
          r += c[0]
          g += c[1]
          b += c[2]
        }
      }
      const i = (py * lado + px) * 3
      rgb[i] = Math.round(r / total)
      rgb[i + 1] = Math.round(g / total)
      rgb[i + 2] = Math.round(b / total)
    }
  }
  return rgb
}

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

/** @param {Buffer} datos */
function crc32(datos) {
  let c = 0xffffffff
  for (const byte of datos) c = TABLA_CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** @param {string} tipo @param {Buffer} datos */
function trozo(tipo, datos) {
  const longitud = Buffer.alloc(4)
  longitud.writeUInt32BE(datos.length)
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'ascii'), datos])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(cuerpo))
  return Buffer.concat([longitud, cuerpo, crc])
}

const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * PNG de 8 bits, tipo de color 2 (RGB, opaco), sin filtro por fila.
 * @param {Uint8Array} rgb @param {number} ancho @param {number} alto
 */
export function codificarPng(rgb, ancho, alto) {
  const cabecera = Buffer.alloc(13)
  cabecera.writeUInt32BE(ancho, 0)
  cabecera.writeUInt32BE(alto, 4)
  cabecera.set([8, 2, 0, 0, 0], 8)
  const filas = Buffer.alloc(alto * (1 + ancho * 3))
  for (let y = 0; y < alto; y++) {
    filas[y * (1 + ancho * 3)] = 0
    filas.set(rgb.subarray(y * ancho * 3, (y + 1) * ancho * 3), y * (1 + ancho * 3) + 1)
  }
  return Buffer.concat([FIRMA, trozo('IHDR', cabecera), trozo('IDAT', deflateSync(filas, { level: 9 })), trozo('IEND', Buffer.alloc(0))])
}

/**
 * Lee un PNG escrito por codificarPng (8 bits, RGB, filtro 0). Para los tests.
 * @param {Buffer} png
 */
export function leerPng(png) {
  if (!png.subarray(0, 8).equals(FIRMA)) throw new Error('no es un PNG')
  let i = 8
  /** @type {Buffer[]} */
  const idat = []
  let ancho = 0
  let alto = 0
  let profundidad = 0
  let tipoColor = 0
  while (i < png.length) {
    const longitud = png.readUInt32BE(i)
    const tipo = png.toString('ascii', i + 4, i + 8)
    const datos = png.subarray(i + 8, i + 8 + longitud)
    if (crc32(png.subarray(i + 4, i + 8 + longitud)) !== png.readUInt32BE(i + 8 + longitud)) throw new Error(`CRC incorrecto en ${tipo}`)
    if (tipo === 'IHDR') {
      ancho = datos.readUInt32BE(0)
      alto = datos.readUInt32BE(4)
      profundidad = datos[8]
      tipoColor = datos[9]
    } else if (tipo === 'IDAT') idat.push(datos)
    i += 12 + longitud
  }
  const filas = inflateSync(Buffer.concat(idat))
  const rgb = new Uint8Array(ancho * alto * 3)
  for (let y = 0; y < alto; y++) {
    if (filas[y * (1 + ancho * 3)] !== 0) throw new Error('filtro de fila no admitido')
    rgb.set(filas.subarray(y * (1 + ancho * 3) + 1, (y + 1) * (1 + ancho * 3)), y * ancho * 3)
  }
  return { ancho, alto, profundidad, tipoColor, rgb }
}

/** Escribe los PNG de SALIDAS en icons/. */
export function generar() {
  const dibujo = leerSvg(readFileSync(new URL('icons/icono.svg', RAIZ), 'utf8'))
  for (const { archivo, lado, escala } of SALIDAS) {
    writeFileSync(new URL(`icons/${archivo}`, RAIZ), codificarPng(rasterizar(dibujo, lado, { escala }), lado, lado))
    console.log(`icons/${archivo} ${lado}×${lado}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) generar()
```

Replace the whole content of `package.json` with:

```json
{
  "name": "oracle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Asistente de trading crypto con bot de paper trading. Simulación: no es asesoramiento financiero.",
  "engines": {
    "node": ">=22.13"
  },
  "scripts": {
    "test": "node --disable-warning=ExperimentalWarning --test \"test/*.test.js\" \"test/pwa/*.test.js\" \"worker/test/*.test.js\"",
    "backtest": "node scripts/backtest.mjs",
    "iconos": "node scripts/iconos.mjs"
  }
}
```

- [ ] **Step 4: Generate the PNGs**

Run: `npm run iconos`
Expected: imprime `icons/apple-touch-icon.png 180×180`, `icons/icono-192.png 192×192`, `icons/icono-512.png 512×512` y `icons/icono-maskable-512.png 512×512` (≈ 1 s).

Ábrelos para mirarlos (`open icons/icono-512.png icons/apple-touch-icon.png` en macOS): bola de cristal turquesa con tres velas al alza (dos turquesa y una dorada) sobre una peana dorada, fondo casi negro, legible a 180 px.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/pwa/iconos.test.js`
Expected: PASS — 9 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (311 tests).

- [ ] **Step 6: Commit**

```bash
git add package.json icons/icono.svg scripts/iconos.mjs icons/apple-touch-icon.png icons/icono-192.png icons/icono-512.png icons/icono-maskable-512.png test/pwa/iconos.test.js
git commit -m "feat(pwa): icono de ORACLE y PNG reproducibles para iPhone y Android" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Lightweight Charts, DOM seguro y gráficos

**Files:**
- Create (descargados): `vendor/lightweight-charts.standalone.production.js`, `vendor/lightweight-charts-LICENSE.txt`, `vendor/lightweight-charts-NOTICE.txt`
- Create: `js/dom.js`
- Create: `js/graficos.js`
- Test: `test/pwa/graficos.test.js`

**Interfaces:**
- Consumes: `fechaHora` (Task 1), `datosVelas`, `etiquetaTick`, `formatoNumero`, `formatoPrecio`, `indicadoresDe`, `curvaComparada` (Task 4); global `LightweightCharts` (v5: `createChart`, `addSeries(definición, opciones, panel?)`, `CandlestickSeries`, `LineSeries`, `panes()[i].setHeight`, `createPriceLine`, `timeScale().setVisibleLogicalRange/fitContent`, `remove`).
- Produces:
  - `js/dom.js` (navegador): `h(etiqueta, atributos?, ...hijos)` (atributos `on*` → eventos; `null`/`false` se omiten; texto siempre como texto), `s(...)` (SVG), `tabla({ titulo, columnas, filas, vacio?, claseFila? })`, `filaTabla(columnas, fila, claseFila?)`, `definiciones(filas)`, `aviso(texto, tipo?, ...extra)`, `insignia(texto, clase)`.
  - `js/graficos.js`: `ATRIBUCION = { producto, copyright, url }` (= `NOTICE`), `COLORES`, `graficoVelas(contenedor, { velas, indicadores }): () => void` (velas + EMA20/50/200, panel 1 con RSI y guías 30/70 de 110 px, últimas 120 velas visibles), `graficoCurva(contenedor, { bot, hodl }): () => void`. Devuelven la limpieza (`remove`). Sin la librería lanzan `Error('No se pudo cargar la librería de gráficos.')`.

- [ ] **Step 1: Write the failing test**

Create `test/pwa/graficos.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, test } from 'node:test'
import { ATRIBUCION, COLORES, graficoCurva, graficoVelas } from '../../js/graficos.js'
import { curvaComparada, etiquetaTick, indicadoresDe } from '../../js/series.js'
import { serie } from '../ayudantes.js'

/** @param {string} ruta */
const leer = (ruta) => readFileSync(new URL(`../../${ruta}`, import.meta.url))

describe('librería de gráficos (vendor)', () => {
  test('TradingView Lightweight Charts v5.2.1 sin modificar, con su licencia y su NOTICE', () => {
    const js = leer('vendor/lightweight-charts.standalone.production.js')
    assert.equal(createHash('sha256').update(js).digest('hex'), 'e21cc5caa0226ef30bd8549c50b9ef926615f2a4ee6b4e486353477a55f598cf')
    assert.match(js.toString('utf8', 0, 200), /TradingView Lightweight Charts™ v5\.2\.1/)
    assert.match(leer('vendor/lightweight-charts-LICENSE.txt').toString(), /Apache License\s+Version 2\.0/)
    assert.equal(leer('vendor/lightweight-charts-NOTICE.txt').toString(), `${ATRIBUCION.producto}\n${ATRIBUCION.copyright} ${ATRIBUCION.url}\n`)
  })
})

/** Doble de la API de Lightweight Charts v5 que anota lo que se le pide. */
function libreriaFalsa() {
  const registro = {
    /** @type {any} */ opciones: null,
    /** @type {{ def: string, op: any, panel: number|undefined, datos: any[] }[]} */ series: [],
    /** @type {number[]} */ guias: [],
    /** @type {number[]} */ alturas: [],
    /** @type {any} */ rango: null,
    ajustado: false,
    eliminado: false,
  }
  const panel = { setHeight: (/** @type {number} */ alto) => { registro.alturas.push(alto) } }
  const grafico = {
    /** @param {string} def @param {any} op @param {number} [indicePanel] */
    addSeries(def, op, indicePanel) {
      const s = { def, op, panel: indicePanel, datos: /** @type {any[]} */ ([]) }
      registro.series.push(s)
      return {
        setData: (/** @type {any[]} */ d) => { s.datos = d },
        createPriceLine: (/** @type {{ price: number }} */ o) => { registro.guias.push(o.price) },
      }
    },
    panes: () => [{ setHeight: () => {} }, panel],
    timeScale: () => ({
      setVisibleLogicalRange: (/** @type {any} */ r) => { registro.rango = r },
      fitContent: () => { registro.ajustado = true },
    }),
    remove: () => { registro.eliminado = true },
  }
  const L = {
    CandlestickSeries: 'velas',
    LineSeries: 'linea',
    createChart: (/** @type {unknown} */ _contenedor, /** @type {any} */ op) => {
      registro.opciones = op
      return grafico
    },
  }
  return { L, registro }
}

describe('gráficos', () => {
  afterEach(() => { delete (/** @type {any} */ (globalThis)).LightweightCharts })

  test('sin la librería, error legible (la vista lo muestra en lugar del gráfico)', () => {
    assert.throws(() => graficoVelas(/** @type {any} */ ({}), { velas: [], indicadores: indicadoresDe([]) }), /^Error: No se pudo cargar la librería de gráficos\.$/)
  })

  test('velas con EMA20/50/200 y panel de RSI con guías 30 y 70, en español y con el logo de TradingView', () => {
    const { L, registro } = libreriaFalsa()
    Object.assign(globalThis, { LightweightCharts: L })
    const velas = serie(300, (i) => 72000 + i)
    const limpiar = graficoVelas(/** @type {any} */ ({}), { velas, indicadores: indicadoresDe(velas) })
    assert.equal(registro.opciones.layout.attributionLogo, true)
    assert.equal(registro.opciones.localization.locale, 'es-ES')
    assert.equal(registro.opciones.timeScale.tickMarkFormatter, etiquetaTick)
    assert.equal(registro.opciones.autoSize, true)
    assert.deepEqual(registro.series.map((s) => [s.def, s.panel ?? 0]), [['velas', 0], ['linea', 0], ['linea', 0], ['linea', 0], ['linea', 1]])
    assert.equal(registro.series[0].datos.length, 300)
    assert.equal(registro.series[0].op.priceFormat.formatter(72857.05), '72.857,05')
    assert.deepEqual(registro.series.slice(1, 4).map((s) => s.op.color), [COLORES.ema20, COLORES.ema50, COLORES.ema200])
    assert.equal(registro.series[3].datos.length, 300 - 199)
    assert.deepEqual(registro.guias, [30, 70])
    assert.deepEqual(registro.alturas, [110])
    assert.deepEqual(registro.rango, { from: 180, to: 302 })
    limpiar()
    assert.equal(registro.eliminado, true)
  })

  test('curva: comprar y mantener y bot en euros sin decimales, encuadrada entera', () => {
    const { L, registro } = libreriaFalsa()
    Object.assign(globalThis, { LightweightCharts: L })
    const curva = curvaComparada([{ t: 0, valor: 10_000, hodl: 10_000 }, { t: 3_600_000, valor: 10_050, hodl: 9_990 }])
    graficoCurva(/** @type {any} */ ({}), curva)
    assert.deepEqual(registro.series.map((s) => s.op.title), ['Comprar y mantener', 'Bot'])
    assert.deepEqual(registro.series[1].datos, curva.bot)
    assert.equal(registro.series[0].op.priceFormat.formatter(10085.4), '10.085')
    assert.equal(registro.ajustado, true)
  })

  test('el logo de TradingView no se desactiva en ningún gráfico', () => {
    assert.match(leer('js/graficos.js').toString(), /attributionLogo: true/)
    assert.doesNotMatch(leer('js/graficos.js').toString(), /attributionLogo: false/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/pwa/graficos.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/graficos.js`.

- [ ] **Step 3: Download Lightweight Charts 5.2.1 with its LICENSE and NOTICE (needs network)**

El paquete de npm no trae `NOTICE`; se toma del repositorio oficial en la etiqueta `v5.2.1`.

Run: `curl -fsSL --create-dirs -o vendor/lightweight-charts.standalone.production.js https://unpkg.com/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js && curl -fsSL -o vendor/lightweight-charts-LICENSE.txt https://unpkg.com/lightweight-charts@5.2.1/LICENSE && curl -fsSL -o vendor/lightweight-charts-NOTICE.txt https://raw.githubusercontent.com/tradingview/lightweight-charts/v5.2.1/NOTICE`
Expected: sin salida, código 0.

Run: `shasum -a 256 vendor/lightweight-charts.standalone.production.js vendor/lightweight-charts-LICENSE.txt vendor/lightweight-charts-NOTICE.txt`
Expected: `e21cc5caa0226ef30bd8549c50b9ef926615f2a4ee6b4e486353477a55f598cf`, `70c9d5382506dd184465425c08a99ad9bd6d9ac1313c252968ba0b585e5ef823` y `f76c6afab94884448f0426e30d6e9d555ca7247894cd3484e477d2f87513036e` (197.922, 11.347 y 97 bytes). Si el primero no coincide, para: no es el archivo publicado.

- [ ] **Step 4: Write the implementation**

Create `js/dom.js`:

```js
// @ts-check
// Construcción de nodos con createElement: el texto siempre entra como texto, nunca como HTML (titulares y
// explicaciones vienen de fuera).

/** @typedef {Node|string|number|null|undefined|false|any[]} Hijo listas anidadas permitidas */
/** @typedef {Record<string, unknown>} Atributos */

/** @param {Element} el @param {Atributos|null|undefined} atributos */
function aplicar(el, atributos) {
  for (const [clave, valor] of Object.entries(atributos ?? {})) {
    if (valor === null || valor === undefined || valor === false) continue
    if (clave.startsWith('on') && typeof valor === 'function') el.addEventListener(clave.slice(2), /** @type {EventListener} */ (valor))
    else el.setAttribute(clave, valor === true ? '' : String(valor))
  }
}

/** @param {Element} el @param {Hijo[]} hijos */
function anadir(el, hijos) {
  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue
    el.append(hijo instanceof Node ? hijo : String(hijo))
  }
}

/**
 * h('p', { class: 'nota', onclick: f }, 'texto', otroNodo)
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} etiqueta @param {Atributos|null} [atributos] @param {...Hijo} hijos
 * @returns {HTMLElementTagNameMap[K]}
 */
export function h(etiqueta, atributos, ...hijos) {
  const el = document.createElement(etiqueta)
  aplicar(el, atributos)
  anadir(el, hijos)
  return el
}

/**
 * Elemento SVG (medidor de Fear & Greed).
 * @param {string} etiqueta @param {Atributos|null} [atributos] @param {...Hijo} hijos
 */
export function s(etiqueta, atributos, ...hijos) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', etiqueta)
  aplicar(el, atributos)
  anadir(el, hijos)
  return el
}

/**
 * Tabla accesible con título, cabeceras de columna y mensaje si no hay filas.
 * @param {{ titulo: string, columnas: { clave: string, texto: string, numerica?: boolean }[],
 *   filas: Record<string, unknown>[], vacio?: string, claseFila?: (f: any) => string|undefined }} op
 */
export function tabla({ titulo, columnas, filas, vacio = 'Sin datos.', claseFila }) {
  if (filas.length === 0) return h('p', { class: 'vacio' }, vacio)
  const cuerpo = h('tbody', null, filas.map((f) => filaTabla(columnas, f, claseFila)))
  return h('div', { class: 'tabla-desplazable', tabindex: 0, role: 'region', 'aria-label': titulo },
    h('table', null,
      h('caption', { class: 'solo-lectores' }, titulo),
      h('thead', null, h('tr', null, columnas.map((c) => h('th', { scope: 'col', class: c.numerica ? 'num' : null }, c.texto)))),
      cuerpo))
}

/**
 * @param {{ clave: string, numerica?: boolean }[]} columnas @param {Record<string, unknown>} f
 * @param {(f: any) => string|undefined} [claseFila]
 */
export const filaTabla = (columnas, f, claseFila) => h('tr', { class: claseFila?.(f) ?? null },
  columnas.map((c) => h('td', { class: c.numerica ? 'num' : null }, /** @type {Hijo} */ (f[c.clave]))))

/**
 * Lista de pares etiqueta → valor (métricas).
 * @param {{ etiqueta: string, valor: string, clase?: string, ayuda?: string }[]} filas
 */
export const definiciones = (filas) => h('dl', { class: 'metricas' }, filas.map((f) => h('div', { class: 'metrica' },
  h('dt', null, f.etiqueta),
  h('dd', { class: f.clase ?? null }, f.valor),
  f.ayuda ? h('dd', { class: 'ayuda' }, f.ayuda) : null)))

/**
 * Aviso visible (error o información). Nunca se deja la pantalla en blanco.
 * @param {string} texto @param {'error'|'info'|'alerta'} [tipo] @param {...Hijo} extra
 */
export const aviso = (texto, tipo = 'info', ...extra) => h('div', { class: `aviso aviso-${tipo}`, role: tipo === 'error' ? 'alert' : 'status' },
  h('p', null, texto), extra)

/** Insignia del veredicto: texto + color (el color nunca va solo). @param {string} texto @param {string} clase */
export const insignia = (texto, clase) => h('span', { class: `insignia veredicto-${clase}` }, texto)
```

Create `js/graficos.js`:

```js
// @ts-check
// Gráficos con TradingView Lightweight Charts v5 (vendor/, global LightweightCharts). Solo dibuja:
// los datos llegan ya preparados por series.js.
import { fechaHora } from './formato.js'
import { datosVelas, etiquetaTick, formatoNumero, formatoPrecio } from './series.js'

/** Aviso de atribución del archivo NOTICE de la librería (Apache-2.0) y enlace exigido por su licencia. */
export const ATRIBUCION = Object.freeze({
  producto: 'TradingView Lightweight Charts™',
  copyright: 'Copyright (с) 2025 TradingView, Inc.',
  url: 'https://www.tradingview.com/',
})

export const COLORES = Object.freeze({
  fondo: '#0b0f17', texto: '#c9d1d9', rejilla: '#1b2433', sube: '#2dd4bf', baja: '#f87171',
  ema20: '#f2c14e', ema50: '#60a5fa', ema200: '#c084fc', rsi: '#e5e7eb', guia: '#6b7280', bot: '#2dd4bf', hodl: '#f2c14e',
})

/** @returns {any} */
function libreria() {
  const L = /** @type {any} */ (globalThis).LightweightCharts
  if (!L) throw new Error('No se pudo cargar la librería de gráficos.')
  return L
}

function opcionesBase() {
  return {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: COLORES.fondo }, textColor: COLORES.texto,
      fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', attributionLogo: true,
    },
    grid: { vertLines: { color: COLORES.rejilla }, horzLines: { color: COLORES.rejilla } },
    localization: { locale: 'es-ES', timeFormatter: (/** @type {number} */ t) => fechaHora(t * 1000) },
    timeScale: { timeVisible: true, secondsVisible: false, borderVisible: false, tickMarkFormatter: etiquetaTick },
    rightPriceScale: { borderVisible: false },
    crosshair: { mode: 0 },
  }
}

const LINEA = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }

/**
 * Velas con EMA20/50/200 y, debajo, un panel de RSI14 con guías en 30 y 70.
 * @param {HTMLElement} contenedor
 * @param {{ velas: import('../core/velas.js').Vela[], indicadores: ReturnType<typeof import('./series.js').indicadoresDe> }} datos
 * @returns {() => void} limpieza
 */
export function graficoVelas(contenedor, { velas, indicadores }) {
  const L = libreria()
  const grafico = L.createChart(contenedor, opcionesBase())
  const velasSerie = grafico.addSeries(L.CandlestickSeries, {
    upColor: COLORES.sube, downColor: COLORES.baja, borderVisible: false,
    wickUpColor: COLORES.sube, wickDownColor: COLORES.baja, priceFormat: formatoPrecio(velas),
  })
  velasSerie.setData(datosVelas(velas))
  for (const clave of /** @type {const} */ (['ema20', 'ema50', 'ema200'])) {
    grafico.addSeries(L.LineSeries, { ...LINEA, color: COLORES[clave] }).setData(indicadores[clave])
  }
  const rsi = grafico.addSeries(L.LineSeries, { ...LINEA, color: COLORES.rsi, lastValueVisible: true, priceFormat: formatoNumero(0) }, 1)
  rsi.setData(indicadores.rsi)
  for (const precio of [30, 70]) rsi.createPriceLine({ price: precio, color: COLORES.guia, lineWidth: 1, lineStyle: 2, axisLabelVisible: false })
  grafico.panes()[1]?.setHeight(110)
  const n = velas.length
  grafico.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 120), to: n + 2 })
  return () => grafico.remove()
}

/**
 * Curva del bot frente a comprar y mantener.
 * @param {HTMLElement} contenedor
 * @param {ReturnType<typeof import('./series.js').curvaComparada>} curva
 * @returns {() => void} limpieza
 */
export function graficoCurva(contenedor, curva) {
  const L = libreria()
  const grafico = L.createChart(contenedor, opcionesBase())
  const euros = formatoNumero(0)
  grafico.addSeries(L.LineSeries, { lineWidth: 2, color: COLORES.hodl, priceLineVisible: false, priceFormat: euros, title: 'Comprar y mantener' }).setData(curva.hodl)
  grafico.addSeries(L.LineSeries, { lineWidth: 2, color: COLORES.bot, priceLineVisible: false, priceFormat: euros, title: 'Bot' }).setData(curva.bot)
  grafico.timeScale().fitContent()
  return () => grafico.remove()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/pwa/graficos.test.js`
Expected: PASS — 5 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (316 tests).

- [ ] **Step 6: Commit**

```bash
git add vendor/lightweight-charts.standalone.production.js vendor/lightweight-charts-LICENSE.txt vendor/lightweight-charts-NOTICE.txt js/dom.js js/graficos.js test/pwa/graficos.test.js
git commit -m "feat(pwa): Lightweight Charts 5.2.1 con atribución, DOM seguro y gráficos" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: Vistas, arranque y estilos

**Files:**
- Create: `js/vistas/comun.js`, `js/vistas/login.js`, `js/vistas/panel.js`, `js/vistas/moneda.js`, `js/vistas/bot.js`, `js/vistas/backtest.js`
- Create: `js/app.js`
- Create: `index.html`, `styles.css`
- Create: `test/pwa/modulos.js`
- Test: `test/pwa/vistas.test.js`

**Interfaces:**
- Consumes: todo lo anterior; `ESTRATEGIAS`, `ESTRATEGIA_ACTIVA` (`core/estrategias.js`).
- Produces:
  - `js/vistas/comun.js`: tipos `Contexto = { api, ruta, fetch, ahora(), navegar(hash), avisar(texto, tipo?), entrar(pin), mensajeLogin, refrescar(), exigirPin(e): boolean }` y `Pantalla = { titulo, nodo, montar?(): void | (() => void) }`; `cabecera(texto, ...extra)` (h2 enfocable), `seccion(titulo, ...hijos)`, `avisoDeError(e)` (propaga los que piden PIN), `intentar(promesa): Promise<{ ok: true, valor } | { ok: false, error }>`, `notaAtribucion()`.
  - Vistas, todas `(ctx: Contexto) => Promise<Pantalla>`: `vistaLogin`, `vistaPanel`, `vistaMoneda`, `vistaBot`, `vistaBacktest`; además `VERSIONES` y `cargarBacktest(fetch, version)` (`data/backtest-vN.json`, relativo) en `js/vistas/backtest.js`.
  - `js/app.js`: sin exportaciones; pinta la ruta (gana la última navegación), limpia los gráficos de la pantalla anterior, enfoca el h2, refresca cada 5 min con la página visible y registra `sw.js`.
  - `test/pwa/modulos.js` (tests): `RAIZ`, `leer(ruta)`, `importsDe(fuente)`, `modulosDeLaApp()`.

Lo que enseña cada pantalla (spec §12):

| Pantalla | Contenido |
|---|---|
| Acceso (`#/login`) | campo PIN con etiqueta, «Entrar», mensaje del Worker (intentos que quedan o bloqueo hasta HH:MM) |
| Panel (`#/`) | último análisis («hace…», cron o manual, fuentes caídas en `<details>`), aviso de datos desactualizados, tarjeta por moneda (precio €, 24 h, veredicto con texto y color, «Índice de confianza (sin calibrar)», puntuación, frase, «Señal hace…» y chip «desactualizada»), «Analizar ahora» (429 → hora y botón desactivado), medidor de Fear & Greed, resumen del bot frente a comprar y mantener |
| Moneda (`#/moneda/BTC?tf=4h`) | veredicto, precio, 24 h, confianza (sin calibrar), S, motivo, frescura, SL/TP orientativos; pestañas 1H/4H/1D; velas + EMA20/50/200 + RSI con par usado (EUR o respaldo USDT) y atribución; barras T/D/N/F con ausentes y pesos renormalizados; técnico por temporalidad; explicación y motor; titulares (fuente, origen, hace, puntuación, motor, «usado en N»); historial de decisiones de la moneda |
| Bot (`#/bot?simulacion=&simbolo=&filtro=`) | selector de simulación (con versión y estado), valor de cartera, rentabilidad, realizado y no realizado, frente a comprar y mantener; curva bot vs HODL; 14 métricas de §7.7; por moneda; posiciones abiertas con SL/TP fijos; operaciones y decisiones paginadas («Cargar más») con filtro de moneda y de tipo (todas, ejecutadas, no ejecutadas, HOLD); reinicio con `<dialog>` de confirmación y capital validado (solo en la activa) |
| Backtest (`#/backtest?v=v2`) | pestañas por estrategia (la activa marcada), etiqueta «Estrategia vN · técnico + Fear & Greed», periodo, monedas, capital, cadencia; nota honesta (ninguna bate a comprar y mantener); resultado frente a HODL; curva diaria; métricas, por moneda, cierres por motivo y decisiones por motivo; aviso del JSON |

- [ ] **Step 1: Write the test helper and the failing test**

Create `test/pwa/modulos.js`:

```js
// @ts-check
// Grafo de módulos de la PWA para los tests: lo que el navegador descarga a partir de js/app.js. Solo tests.
import { readFileSync } from 'node:fs'

export const RAIZ = new URL('../../', import.meta.url)

/** Contenido de un archivo del repositorio. @param {string} ruta relativa a la raíz */
export const leer = (ruta) => readFileSync(new URL(ruta, RAIZ), 'utf8')

/** Imports estáticos de un módulo (no los `import('…')` de los comentarios JSDoc). @param {string} fuente */
export const importsDe = (fuente) => [...fuente.matchAll(/^import\s[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1])

/** Todos los módulos que carga el navegador a partir de js/app.js, como rutas relativas a la raíz, ordenados. */
export function modulosDeLaApp() {
  const vistos = new Set()
  const pendientes = ['js/app.js']
  while (pendientes.length > 0) {
    const ruta = /** @type {string} */ (pendientes.pop())
    if (vistos.has(ruta)) continue
    vistos.add(ruta)
    for (const destino of importsDe(leer(ruta))) {
      pendientes.push(new URL(destino, new URL(ruta, 'https://x/')).pathname.slice(1))
    }
  }
  return [...vistos].sort()
}
```

Create `test/pwa/vistas.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { describe, test } from 'node:test'
import { ESTRATEGIAS } from '../../core/estrategias.js'
import { VERSIONES, cargarBacktest } from '../../js/vistas/backtest.js'
import { RAIZ, leer, modulosDeLaApp } from './modulos.js'

describe('vistas', () => {
  test('el backtest se pide relativo a la página (vale bajo /ORACLE/) para cada estrategia registrada', async () => {
    assert.deepEqual(VERSIONES, Object.keys(ESTRATEGIAS))
    /** @type {string[]} */
    const pedidas = []
    /** @type {typeof fetch} */
    const fetch = async (url) => {
      pedidas.push(String(url))
      return String(url).endsWith('v9.json') ? new Response('No existe', { status: 404 }) : new Response(leer(String(url)))
    }
    const b = await cargarBacktest(fetch, 'v2')
    assert.equal(b.version, 'v2')
    await assert.rejects(cargarBacktest(fetch, 'v9'), /^Error: data\/backtest-v9\.json: HTTP 404$/)
    assert.deepEqual(pedidas, ['data/backtest-v2.json', 'data/backtest-v9.json'])
  })

  test('todos los módulos cargan en Node sin tocar el DOM al importarse; app.js y sus vistas compilan', async () => {
    const modulos = modulosDeLaApp()
    for (const m of ['js/vistas/login.js', 'js/vistas/panel.js', 'js/vistas/moneda.js', 'js/vistas/bot.js', 'js/vistas/backtest.js']) {
      assert.ok(modulos.includes(m), m)
    }
    for (const m of modulos.filter((x) => x !== 'js/app.js')) await import(new URL(m, RAIZ).href)
    execFileSync(process.execPath, ['--check', new URL('js/app.js', RAIZ).pathname])
  })

  test('// @ts-check en cada módulo de js/ y en config.js', () => {
    for (const m of modulosDeLaApp().filter((x) => x.startsWith('js/') || x === 'config.js')) {
      assert.ok(leer(m).startsWith('// @ts-check\n'), m)
    }
  })

  test('la atribución de TradingView (NOTICE y enlace) va bajo cada gráfico', () => {
    assert.match(leer('js/vistas/comun.js'), /ATRIBUCION\.url[\s\S]*ATRIBUCION\.producto[\s\S]*ATRIBUCION\.copyright/)
    for (const vista of ['moneda', 'bot', 'backtest']) {
      const fuente = leer(`js/vistas/${vista}.js`)
      assert.match(fuente, /notaAtribucion\(\)/, vista)
      assert.match(fuente, /grafico(Velas|Curva)\(/, vista)
    }
  })

  test('índice de confianza siempre «sin calibrar» y el texto nunca entra como HTML', () => {
    for (const vista of ['panel', 'moneda']) assert.match(leer(`js/vistas/${vista}.js`), /Índice de confianza \(sin calibrar\)/, vista)
    for (const m of modulosDeLaApp()) assert.doesNotMatch(leer(m), /innerHTML|insertAdjacentHTML|outerHTML/, m)
  })

  test('index.html: español, pie fijo con el aviso obligatorio y la app como módulo', () => {
    const html = leer('index.html')
    assert.ok(html.includes('<html lang="es">'))
    assert.match(html, /<footer class="pie">Simulación\. No es asesoramiento financiero ni garantía de beneficio\.<\/footer>/)
    assert.match(leer('styles.css'), /\.pie \{\s*position: fixed;/)
    assert.ok(html.includes('<script src="vendor/lightweight-charts.standalone.production.js" defer></script>'))
    assert.ok(html.includes('<script type="module" src="js/app.js"></script>'))
    assert.match(leer('styles.css'), /@media \(prefers-reduced-motion: reduce\)/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/vistas.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/vistas/backtest.js`.

- [ ] **Step 3: Write the shared pieces and the access view**

Create `js/vistas/comun.js`:

```js
// @ts-check
// Piezas comunes de las vistas.
import { mensajeError, pideLogin } from '../api.js'
import { aviso, h } from '../dom.js'
import { ATRIBUCION } from '../graficos.js'

/**
 * @typedef {{
 *   api: import('../api.js').Api,
 *   ruta: import('../rutas.js').Ruta,
 *   fetch: typeof fetch,
 *   ahora: () => number,
 *   navegar: (hash: string) => void,
 *   avisar: (texto: string, tipo?: 'info'|'error') => void,
 *   entrar: (pin: string) => Promise<void>,
 *   mensajeLogin: string|null,
 *   refrescar: () => void,
 *   exigirPin: (e: unknown) => boolean,
 * }} Contexto
 * exigirPin: si el error pide PIN (401 o bloqueo), vuelve al acceso y devuelve true. Para errores en eventos.
 * @typedef {{ titulo: string, nodo: HTMLElement, montar?: () => (void | (() => void)) }} Pantalla
 */

let secuencia = 0

/** Cabecera de la vista; el h2 recibe el foco al navegar. @param {string} texto @param {...import('../dom.js').Hijo} extra */
export const cabecera = (texto, ...extra) => h('header', { class: 'vista-cabecera' }, h('h2', { tabindex: -1 }, texto), extra)

/** Sección con título enlazado para lectores de pantalla. @param {string} titulo @param {...import('../dom.js').Hijo} hijos */
export function seccion(titulo, ...hijos) {
  const id = `seccion-${++secuencia}`
  return h('section', { class: 'bloque', 'aria-labelledby': id }, h('h3', { id }, titulo), hijos)
}

/**
 * Error de una parte de la vista: si exige PIN se propaga (la app vuelve al acceso); si no, aviso en su sitio.
 * @param {unknown} e
 */
export function avisoDeError(e) {
  if (pideLogin(e)) throw e
  return aviso(mensajeError(e), 'error')
}

/**
 * Promesa → { ok, valor } o { ok: false, error } para cargar partes independientes sin que una tumbe a las demás.
 * @template T
 * @param {Promise<T>} promesa
 * @returns {Promise<{ ok: true, valor: T } | { ok: false, error: unknown }>}
 */
export const intentar = (promesa) => promesa.then((valor) => ({ ok: /** @type {const} */ (true), valor }), (error) => ({ ok: /** @type {const} */ (false), error }))

/** Nota de atribución bajo cada gráfico (licencia Apache-2.0 de la librería, archivo NOTICE). */
export const notaAtribucion = () => h('p', { class: 'atribucion' },
  'Gráficos: ', h('a', { href: ATRIBUCION.url, target: '_blank', rel: 'noopener' }, ATRIBUCION.producto), ` ${ATRIBUCION.copyright}`)
```

Create `js/vistas/login.js`:

```js
// @ts-check
// Acceso con PIN (spec §12): se pide una vez y queda guardado en el dispositivo.
import { mensajeError } from '../api.js'
import { aviso, h } from '../dom.js'
import { cabecera } from './comun.js'

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaLogin(ctx) {
  const mensaje = h('div', { class: 'login-mensaje', 'aria-live': 'assertive' },
    ctx.mensajeLogin ? aviso(ctx.mensajeLogin, 'error') : null)
  const campo = h('input', {
    id: 'pin', name: 'pin', type: 'password', autocomplete: 'current-password', required: true, enterkeyhint: 'go',
    'aria-describedby': 'pin-ayuda',
  })
  const boton = h('button', { type: 'submit', class: 'boton boton-principal' }, 'Entrar')
  const formulario = h('form', { class: 'login', novalidate: true },
    h('label', { for: 'pin' }, 'PIN'),
    campo,
    h('p', { id: 'pin-ayuda', class: 'ayuda' }, 'El PIN del Worker (secret ORACLE_PIN). Se guarda solo en este dispositivo.'),
    boton,
    mensaje)
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    const pin = campo.value.trim()
    if (!pin) {
      mensaje.replaceChildren(aviso('Escribe el PIN.', 'error'))
      campo.focus()
      return
    }
    boton.disabled = true
    boton.textContent = 'Comprobando…'
    try {
      await ctx.entrar(pin)
    } catch (e) {
      mensaje.replaceChildren(aviso(mensajeError(e), 'error'))
      campo.select()
      campo.focus()
    } finally {
      boton.disabled = false
      boton.textContent = 'Entrar'
    }
  })
  const nodo = h('div', { class: 'vista vista-login' },
    cabecera('Acceso'),
    h('p', null, 'ORACLE analiza BTC, ETH, SOL, BNB y XRP cada hora y simula un bot de paper trading con dinero virtual.'),
    formulario)
  return { titulo: 'Acceso', nodo, montar: () => { campo.focus() } }
}
```

- [ ] **Step 4: Write the Panel**

Create `js/vistas/panel.js`:

```js
// @ts-check
// Panel (spec §12): Fear & Greed, una tarjeta por moneda, último análisis, frescura y «Analizar ahora».
import { ErrorApi, mensajeError } from '../api.js'
import { aviso, h, insignia, s } from '../dom.js'
import { euros, fechaHora, hace, porcentaje } from '../formato.js'
import { hashDe } from '../rutas.js'
import { frenteAHodl } from '../cartera.js'
import { lecturaFng, puntoArco, tarjetaMoneda } from '../senal.js'
import { avisoDeError, cabecera, seccion } from './comun.js'

const ESPERA_ANALIZAR_MS = 5 * 60_000

/** Medidor semicircular de Fear & Greed. @param {NonNullable<ReturnType<typeof lecturaFng>>} f */
function medidor(f) {
  const [cx, cy, r] = [100, 100, 80]
  const izq = puntoArco(0, cx, cy, r)
  const der = puntoArco(100, cx, cy, r)
  const valor = puntoArco(f.valor, cx, cy, r)
  const aguja = puntoArco(f.valor, cx, cy, r - 14)
  return s('svg', { viewBox: '0 0 200 112', class: 'medidor', 'aria-hidden': 'true', focusable: 'false' },
    s('path', { d: `M ${izq.x} ${izq.y} A ${r} ${r} 0 0 1 ${der.x} ${der.y}`, class: 'medidor-pista' }),
    s('path', { d: `M ${izq.x} ${izq.y} A ${r} ${r} 0 0 1 ${valor.x} ${valor.y}`, class: `medidor-valor fng-${f.clase}` }),
    s('line', { x1: cx, y1: cy, x2: aguja.x, y2: aguja.y, class: 'medidor-aguja' }),
    s('circle', { cx, cy, r: 5, class: 'medidor-eje' }))
}

/** @param {any} fng */
function bloqueFng(fng) {
  const f = lecturaFng(fng)
  if (!f) return seccion('Fear & Greed', h('p', { class: 'vacio' }, 'Sin dato de Fear & Greed (alternative.me no respondió).'))
  return seccion('Fear & Greed',
    h('div', { class: 'fng' },
      medidor(f),
      h('p', { class: 'fng-valor' }, h('strong', { class: `fng-${f.clase}` }, String(f.valor)), ` / 100 · ${f.texto}`)),
    h('p', { class: 'ayuda' }, `${f.nota} Dato del ${f.fecha}.`))
}

/** @param {any} senal @param {number} ahora */
function tarjeta(senal, ahora) {
  const c = tarjetaMoneda(senal, ahora)
  return h('li', null, h('a', { class: `tarjeta borde-${c.claseVeredicto}`, href: hashDe('moneda', { simbolo: c.simbolo }) },
    h('div', { class: 'tarjeta-fila' },
      h('span', { class: 'tarjeta-simbolo' }, c.simbolo),
      insignia(c.veredicto, c.claseVeredicto)),
    h('div', { class: 'tarjeta-fila' },
      h('span', { class: 'tarjeta-precio' }, c.precio),
      h('span', { class: `cambio ${c.claseCambio}` }, h('span', { class: 'solo-lectores' }, 'Variación en 24 horas: '), c.cambio, ' 24 h')),
    h('p', { class: 'tarjeta-confianza' }, `Índice de confianza (sin calibrar): ${c.confianza} · Puntuación ${c.puntuacion}`),
    h('p', { class: 'tarjeta-frase' }, c.frase),
    h('p', { class: 'tarjeta-pie' }, `Señal ${c.actualizada}`, c.desactualizada ? h('span', { class: 'chip chip-alerta' }, 'desactualizada') : null)))
}

/** @param {any} bot */
function bloqueBot(bot) {
  if (!bot) return seccion('Bot', h('p', { class: 'vacio' }, 'Aún no hay simulación: se crea en la primera ejecución del cron de mercado.'))
  const comparacion = frenteAHodl(bot.rentabilidad, bot.rentabilidadHodl)
  return seccion('Bot',
    h('a', { class: 'tarjeta', href: hashDe('bot') },
      h('div', { class: 'tarjeta-fila' },
        h('span', null, `Simulación ${bot.simulacionId} · ${bot.estrategiaVersion}`),
        h('span', { class: 'tarjeta-precio' }, euros(bot.valorCartera))),
      h('p', null, `Rentabilidad ${porcentaje(bot.rentabilidad, { signo: true })} · ${bot.posicionesAbiertas} posiciones abiertas · saldo ${euros(bot.saldo)}`),
      h('p', { class: comparacion.clase }, comparacion.texto)))
}

/** @param {any} r resumen */
function bloqueEjecucion(r) {
  const e = r.ultimaEjecucion
  /** @type {HTMLElement[]} */
  const partes = [
    h('p', null, e
      ? `Último análisis: ${hace(e.inicio, r.ahora)} (${fechaHora(e.inicio)}, ${e.tipo === 'manual' ? 'manual' : 'cron'})${e.ok === false ? ' — falló' : e.ok === null ? ' — en curso' : ''}.`
      : 'Aún no se ha ejecutado ningún análisis.'),
  ]
  if (e && e.fallos.length > 0) {
    partes.push(h('details', null, h('summary', null, `${e.fallos.length} fuentes no respondieron`), h('ul', null, e.fallos.map((/** @type {string} */ f) => h('li', null, f)))))
  }
  if (r.datosDesactualizados) {
    partes.unshift(aviso('Datos desactualizados: alguna señal no tiene velas frescas o el último análisis tiene más de 2 horas.', 'alerta'))
  }
  return h('div', { class: 'ejecucion' }, partes)
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaPanel(ctx) {
  /** @type {any} */
  let r
  try {
    r = await ctx.api.resumen()
  } catch (e) {
    return { titulo: 'Panel', nodo: h('div', { class: 'vista' }, cabecera('Panel'), avisoDeError(e)) }
  }
  const estado = h('p', { class: 'analizar-estado', 'aria-live': 'polite' })
  const boton = h('button', { type: 'button', class: 'boton boton-principal' }, 'Analizar ahora')
  boton.addEventListener('click', async () => {
    boton.disabled = true
    boton.textContent = 'Analizando…'
    estado.textContent = ''
    try {
      await ctx.api.analizar()
      ctx.avisar('Señales recalculadas. Analizar no opera: el bot solo decide en el cron de cada hora.')
      ctx.refrescar()
    } catch (e) {
      if (ctx.exigirPin(e)) return
      estado.textContent = mensajeError(e)
      if (e instanceof ErrorApi && e.codigo === 'demasiado_pronto' && e.hasta) {
        const espera = Math.min(ESPERA_ANALIZAR_MS, Math.max(0, e.hasta - ctx.ahora()))
        boton.textContent = 'Analizar ahora'
        setTimeout(() => { boton.disabled = false }, espera)
        return
      }
      boton.disabled = false
      boton.textContent = 'Analizar ahora'
    }
  })
  const senales = r.senales.length > 0
    ? h('ul', { class: 'tarjetas' }, r.senales.map((/** @type {any} */ x) => tarjeta(x, r.ahora)))
    : h('p', { class: 'vacio' }, 'Aún no hay señales: el primer análisis llega con el cron de mercado (minuto 3 de cada hora).')
  const nodo = h('div', { class: 'vista vista-panel' },
    cabecera('Panel', bloqueEjecucion(r)),
    seccion('Monedas', senales, h('div', { class: 'analizar' }, boton, estado),
      h('p', { class: 'ayuda' }, 'Analizar ahora recalcula las señales (como mucho una vez cada 5 minutos). Nunca abre ni cierra posiciones.')),
    bloqueFng(r.fng),
    bloqueBot(r.bot))
  return { titulo: 'Panel', nodo }
}
```

- [ ] **Step 5: Write the coin detail**

Create `js/vistas/moneda.js`:

```js
// @ts-check
// Detalle de moneda (spec §12): velas 1H/4H/1D de Binance con EMA20/50/200 y RSI, barras T/D/N/F con los
// ausentes marcados, explicación, titulares con puntuación y motor, historial de señales y SL/TP orientativos.
import { aviso, h, insignia, tabla } from '../dom.js'
import { claseSigno, hace, numero, porcentaje, precio } from '../formato.js'
import { graficoVelas } from '../graficos.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { ETIQUETA_TEMPORALIDAD, TEMPORALIDADES, indicadoresDe, velasDeMoneda } from '../series.js'
import {
  VIEJA_MS, barrasComponentes, filaDecision, filasTimeframes, lecturaTitular, orientativo, textoMotivo, textoMotor, veredicto,
} from '../senal.js'
import { avisoDeError, cabecera, intentar, notaAtribucion, seccion } from './comun.js'

/** @param {ReturnType<typeof barrasComponentes>[number]} b */
function barra(b) {
  const titulo = `${b.letra} · ${b.nombre}`
  const peso = b.ausente
    ? `peso ${porcentaje(b.peso, { decimales: 0 })}, no cuenta`
    : `peso ${porcentaje(b.peso, { decimales: 0 })} → ${porcentaje(b.pesoEfectivo, { decimales: 0 })}`
  return h('li', { class: `componente ${b.ausente ? 'ausente' : ''}` },
    h('div', { class: 'componente-cabecera' }, h('span', { class: 'componente-nombre' }, titulo), h('span', { class: 'componente-peso' }, peso)),
    h('div', { class: 'componente-pista', role: 'img', 'aria-label': b.ausente ? `${b.nombre}: ausente` : `${b.nombre}: ${b.texto} sobre 1` },
      b.ausente ? null : h('span', { class: `componente-barra ${b.sentido}`, style: `--ancho: ${(b.ancho * 50).toFixed(2)}%` })),
    h('span', { class: `componente-valor ${b.sentido}` }, b.ausente ? 'Ausente' : b.texto))
}

/** @param {any} senal SenalCompleta o null @param {number} ahora */
function bloqueSenal(senal, ahora) {
  if (!senal) return aviso('Aún no hay señal para esta moneda: llega con el cron de mercado.', 'info')
  const v = veredicto(senal.veredicto)
  const vieja = !senal.fresca || ahora - senal.calculadaEn > VIEJA_MS
  const sltp = orientativo(senal)
  return h('div', { class: 'senal' },
    h('div', { class: 'senal-cabecera' },
      insignia(v.texto, v.clase),
      h('span', { class: 'tarjeta-precio' }, precio(senal.precioEur)),
      h('span', { class: `cambio ${claseSigno(senal.cambio24h)}` }, `${porcentaje(senal.cambio24h, { signo: true })} 24 h`)),
    h('p', null, `Índice de confianza (sin calibrar): ${porcentaje(senal.indiceConfianza, { decimales: 0 })} · Puntuación S ${numero(senal.puntuacion, 2, { signo: true })}`
      + `${senal.alineacion ? ' · temporalidades alineadas' : ''} · estrategia ${senal.version}`),
    senal.motivo ? h('p', null, `Motivo: ${textoMotivo(senal.motivo)}.`) : null,
    h('p', { class: 'ayuda' }, `Calculada ${hace(senal.calculadaEn, ahora)}.`, vieja ? h('span', { class: 'chip chip-alerta' }, 'desactualizada') : null),
    sltp ? h('p', null, `Si se abriera ahora (orientativo): stop-loss ${sltp.stopLoss} · take-profit ${sltp.takeProfit}.`) : null)
}

/**
 * Contenedor del gráfico + función que lo dibuja al montar.
 * @param {import('./comun.js').Contexto} ctx @param {string} simbolo @param {'1h'|'4h'|'1d'} tf
 */
function bloqueGrafico(ctx, simbolo, tf) {
  const lienzo = h('div', { class: 'grafico grafico-velas', role: 'group', 'aria-label': `Velas ${ETIQUETA_TEMPORALIDAD[tf]} de ${simbolo} con EMA20, EMA50, EMA200 y RSI` })
  const par = h('p', { class: 'ayuda par' }, 'Cargando velas de Binance…')
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Temporalidad' }, TEMPORALIDADES.map((t) => h('a', {
    href: hashDe('moneda', { simbolo, params: { tf: t } }), class: 'pestana', 'aria-current': t === tf ? 'page' : null,
  }, ETIQUETA_TEMPORALIDAD[t])))
  const leyenda = h('p', { class: 'leyenda' },
    h('span', { class: 'l-ema20' }, 'EMA20'), h('span', { class: 'l-ema50' }, 'EMA50'), h('span', { class: 'l-ema200' }, 'EMA200'),
    h('span', { class: 'l-rsi' }, 'RSI 14 (guías 30 y 70)'))
  const nodo = seccion('Gráfico', pestanas, par, lienzo, leyenda, notaAtribucion())
  const montar = async () => {
    const r = await intentar(velasDeMoneda({ simbolo, temporalidad: tf, fetch: ctx.fetch }))
    if (!r.ok) {
      lienzo.replaceWith(aviso(`No se pudieron cargar las velas: ${r.error instanceof Error ? r.error.message : String(r.error)}`, 'error'))
      par.remove()
      return () => {}
    }
    par.textContent = r.valor.respaldo
      ? `Par ${simbolo}/USDT: Binance no tiene el par en euros, precios en dólares USDT.`
      : `Par ${simbolo}/EUR · ${r.valor.velas.length} velas de data-api.binance.vision (la última puede estar abierta).`
    return graficoVelas(lienzo, { velas: r.valor.velas, indicadores: indicadoresDe(r.valor.velas) })
  }
  return { nodo, montar }
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaMoneda(ctx) {
  const simbolo = /** @type {string} */ (ctx.ruta.simbolo)
  const tf = paramOpcion(ctx.ruta.params, 'tf', TEMPORALIDADES, '1h')
  const grafico = bloqueGrafico(ctx, simbolo, tf)
  const volver = h('a', { href: hashDe('panel'), class: 'volver' }, '← Panel')
  /** @type {any} */
  let m
  try {
    m = await ctx.api.moneda(simbolo)
  } catch (e) {
    const nodo = h('div', { class: 'vista' }, volver, cabecera(simbolo), avisoDeError(e), grafico.nodo)
    return { titulo: simbolo, nodo, montar: () => crearLimpieza(grafico.montar()) }
  }
  const ahora = ctx.ahora()
  const senal = m.senal
  const titulares = m.titulares.map((/** @type {any} */ t) => lecturaTitular(t, ahora))
  const nodo = h('div', { class: 'vista vista-moneda' },
    volver,
    cabecera(simbolo, bloqueSenal(senal, ahora)),
    grafico.nodo,
    senal ? seccion('Desglose de la puntuación',
      h('ul', { class: 'componentes' }, barrasComponentes(senal).map(barra)),
      h('p', { class: 'ayuda' }, 'Cada componente va de −1 a +1. Los ausentes no cuentan y su peso se reparte entre los presentes (§6.5). El Fear & Greed solo puntúa en extremos.'),
      tabla({
        titulo: 'Técnico por temporalidad',
        columnas: [{ clave: 'tf', texto: 'Temporalidad' }, { clave: 'tendencia', texto: 'Tendencia' }, { clave: 'rsi', texto: 'RSI', numerica: true },
          { clave: 'ema200', texto: 'Precio vs EMA200' }, { clave: 'puntuacion', texto: 'Puntuación', numerica: true }],
        filas: filasTimeframes(senal),
      })) : null,
    senal ? seccion('Explicación', h('p', { class: 'explicacion' }, senal.explicacion || 'Sin explicación.'),
      h('p', { class: 'ayuda' }, `Redactada por: ${textoMotor(senal.motorExplicacion)}.`)) : null,
    seccion(`Titulares (24 h, ${titulares.length})`, titulares.length === 0
      ? h('p', { class: 'vacio' }, 'Sin titulares de esta moneda ni del mercado en las 24 h previas a la señal.')
      : h('ul', { class: 'titulares' }, titulares.map((/** @type {ReturnType<typeof lecturaTitular>} */ t) => h('li', { class: 'titular' },
        t.url ? h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, t.titulo) : h('span', null, t.titulo),
        h('p', { class: 'ayuda' },
          `${t.fuente} (${t.origen}) · ${t.cuando} · `, h('span', { class: t.clase }, `puntuación ${t.puntuacion}`), ` · ${t.motor}`,
          t.usado ? h('span', { class: 'chip' }, 'usado en N') : null))))),
    seccion('Historial de señales del bot', tabla({
      titulo: `Últimas decisiones de ${simbolo}`,
      columnas: [{ clave: 'cuando', texto: 'Vela' }, { clave: 'veredicto', texto: 'Señal' }, { clave: 'puntuacion', texto: 'S', numerica: true },
        { clave: 'confianza', texto: 'Confianza', numerica: true }, { clave: 'motivo', texto: 'Decisión' }],
      filas: m.decisiones.map(filaDecision),
      claseFila: (f) => (f.ejecutada ? 'ejecutada' : undefined),
      vacio: 'Sin decisiones en la simulación activa.',
    })))
  return { titulo: simbolo, nodo, montar: () => crearLimpieza(grafico.montar()) }
}

/**
 * El gráfico se dibuja de forma asíncrona; la limpieza espera a que exista.
 * @param {Promise<() => void>} promesa
 */
function crearLimpieza(promesa) {
  let limpiar = () => {}
  let cancelado = false
  promesa.then((f) => {
    if (cancelado) f()
    else limpiar = f
  }, () => {})
  return () => {
    cancelado = true
    limpiar()
  }
}
```

- [ ] **Step 6: Write the Bot view**

Create `js/vistas/bot.js`:

```js
// @ts-check
// Bot (spec §12): valor de cartera frente a comprar y mantener, curva de capital, métricas de §7.7 (también por
// moneda), posiciones abiertas con SL/TP fijos, operaciones, decisiones con filtro, selector de simulación y reinicio.
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { mensajeError } from '../api.js'
import {
  CAPITAL_POR_DEFECTO, FILTROS_DECISION, filaOperacion, filaPosicion, filasMetricas, filasPorMoneda, filtrarDecisiones,
  frenteAHodl, opcionesSimulacion, validarCapital,
} from '../cartera.js'
import { aviso, definiciones, filaTabla, h, tabla } from '../dom.js'
import { entero, euros, fechaHora, porcentaje } from '../formato.js'
import { graficoCurva } from '../graficos.js'
import { conParams, hashDe, paramEntero, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { filaDecision } from '../senal.js'
import { avisoDeError, cabecera, intentar, notaAtribucion, seccion } from './comun.js'

const COLUMNAS_OPERACIONES = [
  { clave: 'cuando', texto: 'Vela' }, { clave: 'simbolo', texto: 'Moneda' }, { clave: 'lado', texto: 'Lado' },
  { clave: 'precio', texto: 'Precio', numerica: true }, { clave: 'importe', texto: 'Importe', numerica: true },
  { clave: 'costes', texto: 'Costes', numerica: true }, { clave: 'motivo', texto: 'Motivo' }, { clave: 'pnl', texto: 'Resultado', numerica: true },
]
const COLUMNAS_DECISIONES = [
  { clave: 'cuando', texto: 'Vela' }, { clave: 'simbolo', texto: 'Moneda' }, { clave: 'veredicto', texto: 'Señal' },
  { clave: 'confianza', texto: 'Confianza', numerica: true }, { clave: 'accion', texto: 'Acción' }, { clave: 'motivo', texto: 'Motivo' },
]

/**
 * Tabla con «Cargar más» (cursor de la API: 50 por página, recientes primero).
 * @param {{ titulo: string, columnas: { clave: string, texto: string, numerica?: boolean }[], pagina: { items: any[], siguienteCursor: number|null },
 *   cargar: (cursor: number) => Promise<{ items: any[], siguienteCursor: number|null }>, aFila: (x: any) => Record<string, unknown>,
 *   filtrar?: (items: any[]) => any[], vacio: string, claseFila?: (f: any) => string|undefined, exigirPin: (e: unknown) => boolean }} op
 */
function listaPaginada({ titulo, columnas, pagina, cargar, aFila, filtrar = (x) => x, vacio, claseFila, exigirPin }) {
  const contenedor = h('div', { class: 'paginada' })
  const estado = h('p', { class: 'ayuda', 'aria-live': 'polite' })
  /** @type {Record<string, unknown>[]} */
  let filas = filtrar(pagina.items).map(aFila)
  let cursor = pagina.siguienteCursor
  const pintar = () => contenedor.replaceChildren(tabla({ titulo, columnas, filas, vacio, claseFila }))
  pintar()
  const boton = h('button', { type: 'button', class: 'boton' }, 'Cargar más')
  boton.hidden = cursor === null
  boton.addEventListener('click', async () => {
    if (cursor === null) return
    boton.disabled = true
    const r = await intentar(cargar(cursor))
    boton.disabled = false
    if (!r.ok) {
      if (exigirPin(r.error)) return
      estado.textContent = mensajeError(r.error)
      return
    }
    const nuevas = filtrar(r.valor.items).map(aFila)
    const cuerpo = contenedor.querySelector('tbody')
    if (cuerpo) for (const f of nuevas) cuerpo.append(filaTabla(columnas, f, claseFila))
    else if (nuevas.length > 0) {
      filas = nuevas
      pintar()
    }
    cursor = r.valor.siguienteCursor
    boton.hidden = cursor === null
    estado.textContent = `${nuevas.length} más${cursor === null ? '. No hay más.' : '.'}`
  })
  return h('div', null, contenedor, boton, estado)
}

/**
 * Diálogo de reinicio con confirmación (la simulación actual se cierra y se conserva; nada se borra).
 * @param {import('./comun.js').Contexto} ctx @param {any} simulacion
 */
function reinicio(ctx, simulacion) {
  const error = h('p', { class: 'error', role: 'alert' })
  const campo = h('input', { id: 'capital', name: 'capital', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: entero(CAPITAL_POR_DEFECTO), 'aria-describedby': 'capital-ayuda' })
  const confirmar = h('button', { type: 'submit', class: 'boton boton-peligro' }, 'Cerrar y empezar otra')
  const cancelar = h('button', { type: 'button', class: 'boton' }, 'Cancelar')
  const formulario = h('form', { class: 'formulario' },
    h('h3', { id: 'reinicio-titulo' }, 'Reiniciar la simulación'),
    h('p', null, `La simulación ${simulacion.id} se cerrará con su última valoración y se conservará todo su historial. `
      + `La nueva empieza con la estrategia ${ESTRATEGIA_ACTIVA} y el capital que indiques.`),
    h('label', { for: 'capital' }, 'Capital inicial (€)'),
    campo,
    h('p', { id: 'capital-ayuda', class: 'ayuda' }, 'Entre 100 € y 1.000.000 €.'),
    error,
    h('div', { class: 'acciones' }, cancelar, confirmar))
  const dialogo = h('dialog', { class: 'dialogo', 'aria-labelledby': 'reinicio-titulo' }, formulario)
  cancelar.addEventListener('click', () => dialogo.close())
  formulario.addEventListener('submit', async (evento) => {
    evento.preventDefault()
    const v = validarCapital(campo.value)
    if (!v.ok) {
      error.textContent = v.error
      campo.focus()
      return
    }
    confirmar.disabled = true
    try {
      const r = await ctx.api.reiniciar(v.capital)
      dialogo.close()
      ctx.avisar(`Simulación ${r.simulacion.id} creada con ${euros(r.simulacion.capitalInicial)}. La anterior queda cerrada.`)
      ctx.navegar(hashDe('bot'))
    } catch (e) {
      if (ctx.exigirPin(e)) return
      error.textContent = mensajeError(e)
    } finally {
      confirmar.disabled = false
    }
  })
  const abrir = h('button', { type: 'button', class: 'boton boton-peligro' }, 'Reiniciar simulación…')
  abrir.addEventListener('click', () => {
    error.textContent = ''
    dialogo.showModal()
    campo.select()
  })
  return h('div', { class: 'reinicio' }, abrir, dialogo)
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBot(ctx) {
  const { ruta } = ctx
  const simulacion = paramEntero(ruta.params, 'simulacion')
  const simbolo = /^[A-Z0-9]{2,10}$/.test(ruta.params.simbolo ?? '') ? ruta.params.simbolo : null
  const filtro = paramOpcion(ruta.params, 'filtro', FILTROS_DECISION.map((f) => f.clave), 'todas')
  // Primero una sola petición: con un PIN caducado, 4 en paralelo gastarían 4 de los 5 intentos antes del bloqueo.
  const bot = await intentar(ctx.api.bot(simulacion))
  if (!bot.ok) {
    const sinSimulacion = /** @type {any} */ (bot.error)?.estado === 404 && simulacion === null
    const nodo = h('div', { class: 'vista' }, cabecera('Bot'),
      sinSimulacion ? aviso('Aún no hay simulación: se crea en la primera ejecución del cron de mercado (minuto 3 de cada hora).') : avisoDeError(bot.error))
    return { titulo: 'Bot', nodo }
  }
  const b = bot.valor
  const sim = b.simulacion
  const [sims, ops, decs] = await Promise.all([
    intentar(ctx.api.simulaciones()),
    intentar(ctx.api.operaciones({ simulacion: sim.id, simbolo })),
    intentar(ctx.api.decisiones({ simulacion: sim.id, simbolo })),
  ])
  const monedas = [...new Set([...Object.keys(b.hodl ?? {}), ...Object.keys(b.porMoneda), ...b.abiertas.map((/** @type {any} */ p) => p.simbolo)])]
  const comparacion = frenteAHodl(b.metricas.rentabilidad, b.metricas.rentabilidadHodl)

  const selectorSim = h('select', { id: 'simulacion' }, sims.ok
    ? opcionesSimulacion(sims.valor.items).map((o) => h('option', { value: o.valor, selected: o.valor === String(sim.id) }, o.texto))
    : h('option', { value: String(sim.id) }, `Simulación ${sim.id}`))
  selectorSim.addEventListener('change', () => ctx.navegar(conParams(ruta, { simulacion: selectorSim.value })))
  const selectorMoneda = h('select', { id: 'moneda' },
    h('option', { value: '' }, 'Todas'), monedas.map((m) => h('option', { value: m, selected: m === simbolo }, m)))
  selectorMoneda.addEventListener('change', () => ctx.navegar(conParams(ruta, { simbolo: selectorMoneda.value || null })))
  const selectorFiltro = h('select', { id: 'filtro' }, FILTROS_DECISION.map((f) => h('option', { value: f.clave, selected: f.clave === filtro }, f.texto)))
  selectorFiltro.addEventListener('change', () => ctx.navegar(conParams(ruta, { filtro: selectorFiltro.value === 'todas' ? null : selectorFiltro.value })))

  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': 'Curva de capital del bot frente a comprar y mantener' })
  const curva = curvaComparada(b.curva)
  const nodo = h('div', { class: 'vista vista-bot' },
    cabecera('Bot',
      h('div', { class: 'campo' }, h('label', { for: 'simulacion' }, 'Simulación'), selectorSim),
      h('p', { class: 'ayuda' }, `Estrategia ${sim.estrategiaVersion} · capital inicial ${euros(sim.capitalInicial)} · desde ${fechaHora(sim.creadaEn)}`
        + `${sim.activa ? '' : ` · cerrada el ${fechaHora(sim.cerradaEn)}`}`)),
    seccion('Resumen',
      h('p', { class: 'cifra-grande' }, euros(b.metricas.valorCartera)),
      h('p', null, `Rentabilidad ${porcentaje(b.metricas.rentabilidad, { signo: true })} · saldo ${euros(b.metricas.saldo)} · `
        + `realizado ${euros(b.metricas.beneficioRealizado, { signo: true })} · no realizado ${euros(b.metricas.beneficioNoRealizado, { signo: true })}`),
      h('p', { class: comparacion.clase }, comparacion.texto)),
    seccion('Curva de capital',
      curva.bot.length > 1 ? lienzo : h('p', { class: 'vacio' }, 'La curva aparece tras la segunda hora de la simulación.'),
      h('p', { class: 'leyenda' }, h('span', { class: 'l-bot' }, 'Bot'), h('span', { class: 'l-hodl' }, 'Comprar y mantener')),
      h('p', { class: 'ayuda' }, 'Horaria los últimos 30 días; antes, un punto por día.'),
      curva.bot.length > 1 ? notaAtribucion() : null),
    seccion('Métricas', definiciones(filasMetricas(b.metricas))),
    seccion('Por moneda', tabla({
      titulo: 'Métricas por moneda',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'operaciones', texto: 'Operaciones', numerica: true },
        { clave: 'ganadorasPerdedoras', texto: 'Gan. / perd.', numerica: true }, { clave: 'beneficio', texto: 'Realizado', numerica: true },
        { clave: 'medio', texto: 'Medio', numerica: true }, { clave: 'costes', texto: 'Costes', numerica: true }],
      filas: filasPorMoneda(b.porMoneda, monedas),
      vacio: 'Sin operaciones todavía.',
    })),
    seccion(`Posiciones abiertas (${b.abiertas.length})`, tabla({
      titulo: 'Posiciones abiertas',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'desde', texto: 'Desde' }, { clave: 'entrada', texto: 'Entrada', numerica: true },
        { clave: 'actual', texto: 'Actual', numerica: true }, { clave: 'stopLoss', texto: 'Stop-loss', numerica: true },
        { clave: 'takeProfit', texto: 'Take-profit', numerica: true }, { clave: 'valor', texto: 'Valor', numerica: true }, { clave: 'pnl', texto: 'No realizado', numerica: true }],
      filas: b.abiertas.map(filaPosicion),
      vacio: 'Ninguna posición abierta.',
    }), h('p', { class: 'ayuda' }, 'Stop-loss y take-profit se fijan al abrir y no se recalculan nunca.')),
    h('div', { class: 'filtros' }, h('div', { class: 'campo' }, h('label', { for: 'moneda' }, 'Moneda'), selectorMoneda)),
    seccion('Operaciones', ops.ok ? listaPaginada({
      titulo: 'Operaciones', columnas: COLUMNAS_OPERACIONES, pagina: ops.valor, aFila: filaOperacion, vacio: 'Sin operaciones.',
      cargar: (cursor) => ctx.api.operaciones({ simulacion: sim.id, simbolo, cursor }), claseFila: (f) => f.clase, exigirPin: ctx.exigirPin,
    }) : avisoDeError(ops.error)),
    seccion('Decisiones',
      h('div', { class: 'campo' }, h('label', { for: 'filtro' }, 'Mostrar'), selectorFiltro),
      decs.ok ? listaPaginada({
        titulo: 'Decisiones', columnas: COLUMNAS_DECISIONES, pagina: decs.valor, aFila: filaDecision, vacio: 'Ninguna decisión con este filtro en esta página.',
        filtrar: (items) => filtrarDecisiones(items, filtro), cargar: (cursor) => ctx.api.decisiones({ simulacion: sim.id, simbolo, cursor }),
        claseFila: (f) => (f.ejecutada ? 'ejecutada' : undefined), exigirPin: ctx.exigirPin,
      }) : avisoDeError(decs.error),
      h('p', { class: 'ayuda' }, 'Incluye MANTENER y las compras o ventas no ejecutadas, con su motivo.')),
    sim.activa ? seccion('Reinicio', reinicio(ctx, sim)) : null)
  return {
    titulo: 'Bot',
    nodo,
    montar: () => (curva.bot.length > 1 ? graficoCurva(lienzo, curva) : undefined),
  }
}
```

- [ ] **Step 7: Write the Backtest view**

Create `js/vistas/backtest.js`:

```js
// @ts-check
// Backtest (spec §8 y §12): métricas de data/backtest-vN.json (una por estrategia) con la etiqueta
// «técnico + Fear & Greed», la versión, el periodo, la curva frente a comprar y mantener y una nota honesta.
import { ESTRATEGIAS, ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { lecturaBacktest, notaBacktest } from '../cartera.js'
import { aviso, definiciones, h, tabla } from '../dom.js'
import { graficoCurva } from '../graficos.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { cabecera, intentar, notaAtribucion, seccion } from './comun.js'

export const VERSIONES = Object.freeze(Object.keys(ESTRATEGIAS))

/**
 * data/backtest-vN.json, relativo a la página (funciona bajo /ORACLE/ en GitHub Pages).
 * @param {typeof fetch} fetch @param {string} version
 */
export async function cargarBacktest(fetch, version) {
  const respuesta = await fetch(`data/backtest-${version}.json`)
  if (!respuesta.ok) throw new Error(`data/backtest-${version}.json: HTTP ${respuesta.status}`)
  return respuesta.json()
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBacktest(ctx) {
  const version = paramOpcion(ctx.ruta.params, 'v', VERSIONES, ESTRATEGIA_ACTIVA)
  const cargados = await Promise.all(VERSIONES.map((v) => intentar(cargarBacktest(ctx.fetch, v))))
  const porVersion = Object.fromEntries(VERSIONES.map((v, i) => [v, cargados[i]]))
  const elegido = porVersion[version]
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Estrategia' }, VERSIONES.map((v) => h('a', {
    href: hashDe('backtest', { params: { v } }), class: 'pestana', 'aria-current': v === version ? 'page' : null,
  }, v === ESTRATEGIA_ACTIVA ? `${v} (activa)` : v)))
  const nota = notaBacktest(cargados.flatMap((c) => (c.ok ? [c.valor] : [])))
  if (!elegido.ok) {
    const nodo = h('div', { class: 'vista' }, cabecera('Backtest', pestanas),
      aviso(`No se pudo cargar el backtest de ${version}: ${elegido.error instanceof Error ? elegido.error.message : String(elegido.error)}`, 'error'))
    return { titulo: 'Backtest', nodo }
  }
  const l = lecturaBacktest(elegido.valor)
  const curva = curvaComparada(l.curva)
  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': `Curva de capital del backtest de ${l.version} frente a comprar y mantener` })
  const nodo = h('div', { class: 'vista vista-backtest' },
    cabecera('Backtest', pestanas,
      h('p', { class: 'etiqueta-variante' }, `Estrategia ${l.version} · ${l.variante}`),
      h('p', { class: 'ayuda' }, `Periodo ${l.periodo} · ${l.monedas} · capital ${l.capitalInicial} · decide ${l.cadencia} · generado el ${l.generado}`)),
    aviso(nota, 'alerta'),
    seccion('Resultado',
      h('p', { class: 'cifra-grande' }, l.metricas[0].valor),
      h('p', null, `Rentabilidad neta ${l.rentabilidad} con ${l.capitalInicial} de partida.`),
      h('p', { class: l.frenteHodl.clase }, l.frenteHodl.texto)),
    seccion('Curva de capital (diaria)', lienzo,
      h('p', { class: 'leyenda' }, h('span', { class: 'l-bot' }, `Estrategia ${l.version}`), h('span', { class: 'l-hodl' }, 'Comprar y mantener')),
      notaAtribucion()),
    seccion('Métricas', definiciones(l.metricas)),
    seccion('Por moneda', tabla({
      titulo: 'Métricas por moneda del backtest',
      columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'operaciones', texto: 'Operaciones', numerica: true },
        { clave: 'ganadorasPerdedoras', texto: 'Gan. / perd.', numerica: true }, { clave: 'beneficio', texto: 'Realizado', numerica: true },
        { clave: 'medio', texto: 'Medio', numerica: true }, { clave: 'costes', texto: 'Costes', numerica: true }],
      filas: l.porMoneda,
    })),
    seccion('Cierres de posición', tabla({
      titulo: 'Cierres por motivo', columnas: [{ clave: 'motivo', texto: 'Motivo' }, { clave: 'cantidad', texto: 'Cierres', numerica: true }], filas: l.salidas,
    })),
    seccion('Decisiones', tabla({
      titulo: 'Decisiones del backtest por señal y motivo',
      columnas: [{ clave: 'veredicto', texto: 'Señal' }, { clave: 'motivo', texto: 'Decisión' }, { clave: 'cantidad', texto: 'Horas', numerica: true }],
      filas: l.decisiones,
    })),
    h('p', { class: 'ayuda' }, l.aviso,
      ' El backtest no usa noticias ni derivados: no hay histórico gratuito fiable, así que sus pesos se reparten entre técnico y Fear & Greed.'))
  return { titulo: 'Backtest', nodo, montar: () => graficoCurva(lienzo, curva) }
}
```

- [ ] **Step 8: Write the app entry, the page and the styles**

Create `js/app.js`:

```js
// @ts-check
// Arranque de la PWA: sesión con PIN, rutas por hash, refresco cada 5 min solo con la página visible,
// avisos y service worker. Las vistas construyen su DOM; aquí solo se orquesta.
import { baseApi } from '../config.js'
import { crearApi, mensajeError, pideLogin } from './api.js'
import { aviso, h } from './dom.js'
import { crearRefresco } from './refresco.js'
import { hashDe, leerRuta, seccionDe } from './rutas.js'
import { crearSesion } from './sesion.js'
import { vistaBacktest } from './vistas/backtest.js'
import { vistaBot } from './vistas/bot.js'
import { vistaLogin } from './vistas/login.js'
import { vistaMoneda } from './vistas/moneda.js'
import { vistaPanel } from './vistas/panel.js'

/** @typedef {import('./vistas/comun.js').Contexto} Contexto */

const VISTAS = { login: vistaLogin, panel: vistaPanel, moneda: vistaMoneda, bot: vistaBot, backtest: vistaBacktest }
/** Vistas con datos vivos: se refrescan cada 5 min (el backtest es estático y el acceso no tiene datos). */
const REFRESCABLES = new Set(['panel', 'moneda', 'bot'])

const principal = /** @type {HTMLElement} */ (document.getElementById('principal'))
const estado = /** @type {HTMLElement} */ (document.getElementById('estado'))
const salir = /** @type {HTMLButtonElement} */ (document.getElementById('salir'))
const navegacion = /** @type {HTMLElement} */ (document.querySelector('.navegacion'))

/** @type {typeof fetch} */
const fetchNavegador = (entrada, init) => fetch(entrada, init)

/** @returns {Storage|null} */
function almacenLocal() {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const sesion = crearSesion(almacenLocal())
const base = baseApi(location)
const apiBase = crearApi({ base, fetch: fetchNavegador, pin: () => sesion.pin() })
/** Desfase entre el reloj del servidor y el del dispositivo («hace 5 min» con la hora del Worker). */
let desfase = 0
const api = {
  ...apiBase,
  async resumen() {
    const r = await apiBase.resumen()
    desfase = r.ahora - Date.now()
    return r
  },
}

let turno = 0
/** @type {(() => void)[]} */
let limpiezas = []
/** @type {string|null} */
let mensajeLogin = null
/** @type {ReturnType<typeof setTimeout>|undefined} */
let temporizadorAviso

/** @param {string} texto @param {'info'|'error'} [tipo] */
function avisar(texto, tipo = 'info') {
  estado.replaceChildren(aviso(texto, tipo))
  clearTimeout(temporizadorAviso)
  temporizadorAviso = setTimeout(() => estado.replaceChildren(), 8000)
}

/** @param {string} hash */
function navegar(hash) {
  if (location.hash === hash) pintar()
  else location.hash = hash
}

/** @param {unknown} e */
function exigirPin(e) {
  if (!pideLogin(e)) return false
  sesion.olvidar()
  mensajeLogin = mensajeError(e)
  navegar(hashDe('login'))
  return true
}

/** @param {string} pin */
async function entrar(pin) {
  await crearApi({ base, fetch: fetchNavegador, pin: () => pin }).resumen()
  sesion.guardar(pin)
  mensajeLogin = null
  navegar(hashDe('panel'))
}

/** @param {import('./rutas.js').Ruta} ruta */
function marcarNavegacion(ruta) {
  const seccion = seccionDe(ruta)
  for (const enlace of navegacion.querySelectorAll('a')) {
    if (enlace.getAttribute('data-seccion') === seccion) enlace.setAttribute('aria-current', 'page')
    else enlace.removeAttribute('aria-current')
  }
  const conPin = sesion.pin() !== null
  navegacion.hidden = !conPin
  salir.hidden = !conPin
}

/**
 * Pinta la ruta actual. Si llega otra navegación mientras carga, gana la última.
 * @param {{ refresco?: boolean }} [op] refresco: conserva el desplazamiento y no mueve el foco
 */
async function pintar({ refresco = false } = {}) {
  const ruta = leerRuta(location.hash)
  if (!sesion.pin() && ruta.vista !== 'login') {
    location.replace(hashDe('login'))
    return
  }
  const mio = ++turno
  marcarNavegacion(ruta)
  principal.setAttribute('aria-busy', 'true')
  /** @type {Contexto} */
  const ctx = {
    api, ruta, fetch: fetchNavegador, ahora: () => Date.now() + desfase, navegar, avisar, entrar, mensajeLogin,
    refrescar: () => pintar({ refresco: true }), exigirPin,
  }
  /** @type {import('./vistas/comun.js').Pantalla} */
  let pantalla
  try {
    pantalla = await VISTAS[ruta.vista](ctx)
  } catch (e) {
    if (mio === turno && exigirPin(e)) return
    pantalla = { titulo: 'Error', nodo: h('div', { class: 'vista' }, aviso(mensajeError(e), 'error')) }
  }
  if (mio !== turno) return
  for (const limpiar of limpiezas.splice(0)) limpiar()
  const y = window.scrollY
  principal.replaceChildren(pantalla.nodo)
  principal.removeAttribute('aria-busy')
  document.title = `${pantalla.titulo} · ORACLE`
  const limpiar = pantalla.montar?.()
  if (typeof limpiar === 'function') limpiezas.push(limpiar)
  if (refresco) {
    window.scrollTo(0, y)
  } else {
    window.scrollTo(0, 0)
    if (!principal.contains(document.activeElement)) /** @type {HTMLElement|null} */ (principal.querySelector('h2'))?.focus()
  }
}

const refresco = crearRefresco({
  reloj: { ahora: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (id) => clearTimeout(/** @type {number} */ (id)) },
  accion: () => {
    const ruta = leerRuta(location.hash)
    // Un diálogo abierto (reinicio) o un control con el foco no se pisan con un refresco.
    const ocupado = document.querySelector('dialog[open]') || document.activeElement?.matches('input, select, textarea')
    if (!REFRESCABLES.has(ruta.vista) || !sesion.pin() || ocupado) return
    return pintar({ refresco: true })
  },
})

window.addEventListener('hashchange', () => {
  pintar()
  refresco.reiniciarCuenta()
})
document.addEventListener('visibilitychange', () => refresco.visibilidad(document.visibilityState === 'visible'))
salir.addEventListener('click', () => {
  sesion.olvidar()
  mensajeLogin = null
  navegar(hashDe('login'))
})

if (!base) avisar('Falta la URL del Worker en config.js (API_PRODUCCION): la app no puede pedir datos.', 'error')
pintar()
refresco.iniciar()
refresco.visibilidad(document.visibilityState === 'visible')

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // Sin service worker la app funciona igual, solo que no se instala sin conexión.
  })
}
```

Create `index.html`:

```html
<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0f17">
<meta name="description" content="ORACLE: señales de BTC, ETH, SOL, BNB y XRP y un bot de paper trading con dinero virtual. Simulación.">
<title>ORACLE</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/icono.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="ORACLE">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="stylesheet" href="styles.css">
<script src="vendor/lightweight-charts.standalone.production.js" defer></script>
<script type="module" src="js/app.js"></script>
</head>
<body>
<a class="saltar" href="#principal">Saltar al contenido</a>
<header class="cabecera">
  <p class="marca"><img src="icons/icono.svg" alt="" width="28" height="28"><span class="marca-texto">ORACLE</span></p>
  <nav class="navegacion" aria-label="Secciones" hidden>
    <a href="#/" data-seccion="panel">Panel</a>
    <a href="#/bot" data-seccion="bot">Bot</a>
    <a href="#/backtest" data-seccion="backtest">Backtest</a>
  </nav>
  <button type="button" id="salir" class="boton boton-discreto" hidden>Salir</button>
</header>
<main id="principal" tabindex="-1">
  <noscript><p class="aviso aviso-error">ORACLE necesita JavaScript.</p></noscript>
</main>
<div id="estado" class="estado" aria-live="polite"></div>
<footer class="pie">Simulación. No es asesoramiento financiero ni garantía de beneficio.</footer>
</body>
</html>
```

Create `styles.css`:

```css
/* ORACLE · tema oscuro, primero el móvil. Contraste AA sobre #0b0f17. */
:root {
  --fondo: #0b0f17;
  --panel: #121a26;
  --panel-2: #182233;
  --borde: #253246;
  --texto: #e6edf3;
  --suave: #9fb0c3;
  --acento: #2dd4bf;
  --oro: #f2c14e;
  --sube: #34d399;
  --baja: #f87171;
  --alerta: #fbbf24;
  --comprar: #34d399;
  --vender: #f87171;
  --mantener: #93c5fd;
  --sin-datos: #9ca3af;
  --radio: 12px;
  --pie: 3rem;
  color-scheme: dark;
}

* { box-sizing: border-box; }

html { -webkit-text-size-adjust: 100%; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--fondo);
  color: var(--texto);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) calc(var(--pie) + env(safe-area-inset-bottom)) env(safe-area-inset-left);
}

a { color: var(--acento); }
a:hover { color: #5eead4; }

:focus-visible { outline: 3px solid var(--oro); outline-offset: 2px; border-radius: 4px; }

.solo-lectores {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

.saltar { position: absolute; left: -999px; top: 0; background: var(--oro); color: #000; padding: .5rem 1rem; z-index: 10; }
.saltar:focus { left: .5rem; top: calc(.5rem + env(safe-area-inset-top)); }

/* Cabecera y navegación */
.cabecera {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: .5rem;
  padding: .5rem 1rem; background: rgba(11, 15, 23, .94);
  border-bottom: 1px solid var(--borde);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
}
.marca { margin: 0; font-weight: 700; letter-spacing: .08em; display: flex; align-items: center; gap: .5rem; }
.navegacion { display: flex; gap: .25rem; margin-left: auto; }
.navegacion[hidden] { display: none; }
.navegacion a {
  color: var(--suave); text-decoration: none; padding: .45rem .65rem; border-radius: 999px; min-height: 44px;
  display: inline-flex; align-items: center;
}
.navegacion a[aria-current="page"] { color: var(--fondo); background: var(--acento); font-weight: 600; }

main { max-width: 960px; margin: 0 auto; padding: 1rem; outline: none; }
main[aria-busy="true"] { opacity: .7; }

.vista-cabecera h2 { margin: .25rem 0 .5rem; font-size: 1.6rem; }
.vista-cabecera h2:focus { outline: none; }
h3 { font-size: 1.1rem; margin: 0 0 .75rem; }

.bloque {
  background: var(--panel); border: 1px solid var(--borde); border-radius: var(--radio);
  padding: 1rem; margin: 1rem 0;
}

.ayuda { color: var(--suave); font-size: .9rem; margin: .4rem 0; }
.vacio { color: var(--suave); font-style: italic; }
.sube { color: var(--sube); }
.baja { color: var(--baja); }
.neutro { color: var(--texto); }

/* Botones y formularios */
.boton {
  font: inherit; min-height: 44px; padding: .55rem 1rem; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--borde); background: var(--panel-2); color: var(--texto);
}
.boton:disabled { opacity: .55; cursor: not-allowed; }
.boton-principal { background: var(--acento); border-color: var(--acento); color: #04201c; font-weight: 700; }
.boton-peligro { background: #3b1518; border-color: var(--baja); color: #fecaca; }
.boton-discreto { background: transparent; padding: .4rem .7rem; }
input, select {
  font: inherit; color: var(--texto); background: var(--fondo); border: 1px solid var(--borde);
  border-radius: 10px; padding: .55rem .75rem; min-height: 44px; width: 100%;
}
label { display: block; font-weight: 600; margin: .75rem 0 .35rem; }
.campo { margin: .5rem 0; max-width: 32rem; }
.filtros { display: flex; flex-wrap: wrap; gap: 1rem; }
.error { color: var(--baja); min-height: 1.5em; }

.login { max-width: 22rem; }
.login .boton { width: 100%; margin-top: 1rem; }

/* Avisos */
.aviso { border-radius: var(--radio); padding: .75rem 1rem; margin: .75rem 0; border: 1px solid var(--borde); background: var(--panel-2); }
.aviso p { margin: 0; }
.aviso-error { border-color: var(--baja); background: #2a1215; }
.aviso-alerta { border-color: var(--alerta); background: #2a2110; }
.estado { position: fixed; left: 1rem; right: 1rem; bottom: calc(var(--pie) + .5rem + env(safe-area-inset-bottom)); z-index: 6; max-width: 40rem; margin: 0 auto; }

.chip { display: inline-block; margin-left: .5rem; padding: 0 .5rem; border-radius: 999px; font-size: .8rem; border: 1px solid var(--borde); color: var(--suave); }
.chip-alerta { border-color: var(--alerta); color: var(--alerta); }

/* Veredictos: siempre texto + color */
.insignia { display: inline-block; padding: .15rem .65rem; border-radius: 999px; font-weight: 700; font-size: .9rem; border: 1px solid currentColor; }
.veredicto-comprar { color: var(--comprar); }
.veredicto-vender { color: var(--vender); }
.veredicto-mantener { color: var(--mantener); }
.veredicto-sin-datos { color: var(--sin-datos); }

/* Panel */
.tarjetas { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.tarjeta {
  display: block; text-decoration: none; color: var(--texto); background: var(--panel-2);
  border: 1px solid var(--borde); border-left-width: 5px; border-radius: var(--radio); padding: .85rem 1rem;
}
.tarjeta:hover { color: var(--texto); border-color: var(--acento); }
.borde-comprar { border-left-color: var(--comprar); }
.borde-vender { border-left-color: var(--vender); }
.borde-mantener { border-left-color: var(--mantener); }
.borde-sin-datos { border-left-color: var(--sin-datos); }
.tarjeta-fila { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; flex-wrap: wrap; }
.tarjeta-simbolo { font-size: 1.25rem; font-weight: 800; letter-spacing: .04em; }
.tarjeta-precio { font-size: 1.15rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.tarjeta p { margin: .35rem 0 0; }
.tarjeta-confianza, .tarjeta-pie { color: var(--suave); font-size: .9rem; }
.cambio { font-variant-numeric: tabular-nums; }
.analizar { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; margin-top: 1rem; }
.analizar-estado { margin: 0; color: var(--alerta); }

.fng { display: flex; flex-direction: column; align-items: center; }
.medidor { width: min(260px, 100%); height: auto; }
.medidor-pista { fill: none; stroke: var(--borde); stroke-width: 14; stroke-linecap: round; }
.medidor-valor { fill: none; stroke-width: 14; stroke-linecap: round; stroke: currentColor; }
.medidor-aguja { stroke: var(--texto); stroke-width: 3; stroke-linecap: round; }
.medidor-eje { fill: var(--texto); }
.fng-valor { font-size: 1.1rem; margin: .25rem 0; }
.fng-valor strong { font-size: 1.6rem; }
.fng-miedo-extremo { color: #f87171; }
.fng-miedo { color: #fb923c; }
.fng-neutral { color: #e5e7eb; }
.fng-codicia { color: #a3e635; }
.fng-codicia-extrema { color: #34d399; }

/* Moneda */
.volver { display: inline-block; margin-bottom: .25rem; min-height: 44px; line-height: 44px; }
.senal-cabecera { display: flex; flex-wrap: wrap; align-items: center; gap: .75rem; }
.senal p { margin: .4rem 0; }
.pestanas { display: flex; gap: .25rem; margin-bottom: .5rem; flex-wrap: wrap; }
.pestana {
  padding: .4rem .9rem; border-radius: 999px; border: 1px solid var(--borde); color: var(--suave);
  text-decoration: none; min-height: 44px; display: inline-flex; align-items: center;
}
.pestana[aria-current="page"] { background: var(--acento); border-color: var(--acento); color: #04201c; font-weight: 700; }
.grafico { width: 100%; height: 420px; border-radius: 8px; overflow: hidden; }
.grafico-curva { height: 300px; }
.leyenda { display: flex; flex-wrap: wrap; gap: .25rem 1rem; font-size: .85rem; color: var(--suave); }
.leyenda span::before { content: ""; display: inline-block; width: 1rem; height: 3px; margin-right: .35rem; vertical-align: middle; background: currentColor; }
.l-ema20 { color: #f2c14e; }
.l-ema50 { color: #60a5fa; }
.l-ema200 { color: #c084fc; }
.l-rsi { color: #e5e7eb; }
.l-bot { color: #2dd4bf; }
.l-hodl { color: #f2c14e; }
.atribucion { font-size: .8rem; color: var(--suave); margin: .5rem 0 0; }

.componentes { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.componente { display: grid; grid-template-columns: 1fr auto; gap: .25rem .75rem; align-items: center; }
.componente-cabecera { grid-column: 1 / -1; display: flex; justify-content: space-between; gap: .5rem; flex-wrap: wrap; }
.componente-nombre { font-weight: 600; }
.componente-peso { color: var(--suave); font-size: .85rem; }
.componente-pista { position: relative; height: 14px; border-radius: 7px; background: var(--panel-2); border: 1px solid var(--borde); }
.componente-pista::after { content: ""; position: absolute; left: 50%; top: -3px; bottom: -3px; width: 2px; background: var(--suave); }
.componente-barra { position: absolute; top: 0; bottom: 0; width: var(--ancho); border-radius: 7px; }
.componente-barra.positivo { left: 50%; background: var(--sube); }
.componente-barra.negativo { right: 50%; background: var(--baja); }
.componente-barra.neutro { left: 50%; background: var(--suave); }
.componente-valor { font-variant-numeric: tabular-nums; min-width: 4.5rem; text-align: right; }
.componente-valor.positivo { color: var(--sube); }
.componente-valor.negativo { color: var(--baja); }
.componente.ausente .componente-pista {
  background: repeating-linear-gradient(135deg, var(--panel-2) 0 6px, var(--borde) 6px 12px);
}
.componente.ausente .componente-valor { color: var(--suave); font-style: italic; }
.explicacion { white-space: pre-line; }
.titulares { list-style: none; margin: 0; padding: 0; display: grid; gap: .75rem; }
.titular a, .titular > span { font-weight: 600; }

/* Tablas y métricas */
.tabla-desplazable { overflow-x: auto; -webkit-overflow-scrolling: touch; }
table { border-collapse: collapse; width: 100%; font-size: .9rem; }
th, td { padding: .45rem .5rem; border-bottom: 1px solid var(--borde); text-align: left; white-space: nowrap; }
th { color: var(--suave); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.ejecutada td:first-child { box-shadow: inset 3px 0 0 var(--acento); }
.metricas { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: .5rem; margin: 0; }
.metrica { background: var(--panel-2); border-radius: 10px; padding: .6rem .8rem; }
.metrica dt { color: var(--suave); font-size: .85rem; }
.metrica dd { margin: 0; font-size: 1.1rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.metrica dd.ayuda { font-size: .8rem; font-weight: 400; }
.cifra-grande { font-size: 2rem; font-weight: 800; margin: 0; font-variant-numeric: tabular-nums; }
.etiqueta-variante { display: inline-block; margin: .25rem 0; padding: .15rem .65rem; border-radius: 999px; border: 1px solid var(--oro); color: var(--oro); }
.paginada { margin-bottom: .5rem; }

/* Diálogo de reinicio */
.dialogo {
  background: var(--panel); color: var(--texto); border: 1px solid var(--borde); border-radius: var(--radio);
  padding: 1.25rem; width: min(30rem, calc(100vw - 2rem));
}
.dialogo::backdrop { background: rgba(0, 0, 0, .65); }
.acciones { display: flex; gap: .75rem; justify-content: flex-end; flex-wrap: wrap; margin-top: 1rem; }

/* Pie fijo con el aviso obligatorio */
.pie {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 5;
  min-height: var(--pie); padding: .6rem 1rem calc(.6rem + env(safe-area-inset-bottom));
  background: #1d1606; border-top: 1px solid var(--oro); color: #fde68a;
  font-size: .85rem; text-align: center;
}

@media (max-width: 420px) {
  .marca-texto { display: none; }
}

@media (min-width: 640px) {
  .tarjetas { grid-template-columns: repeat(2, 1fr); }
  .fng { flex-direction: row; gap: 1.5rem; }
}

@media (min-width: 960px) {
  .tarjetas { grid-template-columns: repeat(3, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; }
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/vistas.test.js`
Expected: PASS — 6 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (322 tests).

- [ ] **Step 10: Commit**

```bash
git add js/vistas/comun.js js/vistas/login.js js/vistas/panel.js js/vistas/moneda.js js/vistas/bot.js js/vistas/backtest.js js/app.js index.html styles.css test/pwa/modulos.js test/pwa/vistas.test.js
git commit -m "feat(pwa): vistas de acceso, panel, moneda, bot y backtest" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Instalable, sin conexión y servidores de desarrollo

**Files:**
- Modify: `package.json` (scripts `dev` y `api-simulada`)
- Create: `manifest.webmanifest`, `sw.js`, `.nojekyll`
- Create: `scripts/servir.mjs`, `scripts/api-simulada.mjs`
- Modify: `README.md` (sección PWA al final)
- Test: `test/pwa/estructura.test.js`, `test/pwa/servidores.test.js`

**Interfaces:**
- Consumes: `leerPng` (Task 7), `RAIZ`, `leer`, `modulosDeLaApp` (Task 9), `PIN`, `workerSimulado` (Task 2).
- Produces:
  - `sw.js` (script clásico de service worker): `VERSION = 'oracle-v1'`, `ESTRUCTURA` (portada, HTML, CSS, manifest, `config.js`, cada módulo de `js/`, `core/` y `worker/src/fuentes/binance.js` que carga la app, la librería y los iconos); `install` guarda la estructura y `skipWaiting`; `activate` borra las `oracle-*` anteriores y `clients.claim`; `fetch` solo intercepta `GET` de la estructura (sin `?` ni `#`): red primero con `cache: 'no-store'` y copia guardada sin red.
  - `manifest.webmanifest`: `name`, `short_name: 'ORACLE'`, `start_url: './'`, `scope: './'`, `display: 'standalone'`, `lang: 'es'`, colores `#0b0f17`, iconos SVG + PNG 192/512 (`any`) + 512 `maskable`.
  - `scripts/servir.mjs`: `RAIZ`, `PUERTO = 8080`, `TIPOS`, `crearServidor({ raiz? })` (estático, `no-store`, 404/403/400); `node scripts/servir.mjs` escucha en `PUERTO` (o la var `PUERTO`).
  - `scripts/api-simulada.mjs`: `PUERTO = 8787`, `crearApiSimulada(): Promise<Server>` (el Worker real con `workerSimulado()`).

- [ ] **Step 1: Write the failing tests**

Create `test/pwa/estructura.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import vm from 'node:vm'
import { leerPng } from '../../scripts/iconos.mjs'
import { RAIZ, leer, modulosDeLaApp } from './modulos.js'

const AMBITO = 'https://jcaboroca.github.io/ORACLE/'

/**
 * Carga sw.js en un entorno mínimo de service worker con caché y red simuladas.
 * @param {{ red?: (url: string) => Response|Promise<Response> }} [op]
 */
function cargarSw({ red = (url) => new Response(`red:${url}`) } = {}) {
  /** @type {Record<string, (e: any) => void>} */
  const manejadores = {}
  /** @type {Map<string, Map<string, Response>>} */
  const almacenes = new Map()
  const llamadasRed = /** @type {string[]} */ ([])
  const almacen = (/** @type {string} */ nombre) => {
    if (!almacenes.has(nombre)) almacenes.set(nombre, new Map())
    const mapa = /** @type {Map<string, Response>} */ (almacenes.get(nombre))
    return {
      mapa,
      async addAll(/** @type {Request[]} */ peticiones) { for (const p of peticiones) mapa.set(p.url, new Response(`guardado:${p.url}`)) },
      async put(/** @type {string} */ clave, /** @type {Response} */ r) { mapa.set(String(clave), r) },
      async match(/** @type {string} */ clave) { return mapa.get(String(clave))?.clone() },
    }
  }
  class RequestRelativa extends Request {
    /** @param {string} url @param {RequestInit} [init] */
    constructor(url, init) { super(new URL(url, AMBITO), init) }
  }
  const self = {
    registration: { scope: AMBITO },
    location: new URL('sw.js', AMBITO),
    skipWaiting: async () => { self.saltado = true },
    saltado: false,
    clients: { claim: async () => {} },
    addEventListener: (/** @type {string} */ tipo, /** @type {(e: any) => void} */ f) => { manejadores[tipo] = f },
  }
  const caches = {
    open: async (/** @type {string} */ n) => almacen(n),
    keys: async () => [...almacenes.keys()],
    delete: async (/** @type {string} */ n) => almacenes.delete(n),
  }
  const fetch = async (/** @type {string} */ url) => {
    llamadasRed.push(String(url))
    return red(String(url))
  }
  vm.runInNewContext(leer('sw.js'), { self, caches, fetch, Request: RequestRelativa, Response, URL, Promise, Set, Map })
  /** @param {string} tipo @param {Record<string, unknown>} [extra] */
  async function disparar(tipo, extra = {}) {
    /** @type {Promise<unknown>[]} */
    const esperas = []
    /** @type {Promise<Response>|null} */
    let respuesta = null
    manejadores[tipo]({
      ...extra,
      waitUntil: (/** @type {Promise<unknown>} */ p) => esperas.push(p),
      respondWith: (/** @type {Promise<Response>} */ p) => { respuesta = p },
    })
    const r = respuesta ? await respuesta : null
    await Promise.all(esperas)
    return r
  }
  return { self, almacenes, almacen, llamadasRed, disparar }
}

/** @param {string} url @param {string} [metodo] */
const peticion = (url, metodo = 'GET') => ({ request: new Request(url, { method: metodo }) })

describe('service worker: solo la estructura de la app', () => {
  test('al instalar guarda toda la estructura en una caché versionada', async () => {
    const sw = cargarSw()
    await sw.disparar('install')
    const [nombre] = sw.almacenes.keys()
    assert.match(nombre, /^oracle-v\d+$/)
    const guardadas = [...(/** @type {Map<string, Response>} */ (sw.almacenes.get(nombre))).keys()]
    assert.ok(guardadas.includes(AMBITO))
    assert.ok(guardadas.includes(`${AMBITO}vendor/lightweight-charts.standalone.production.js`))
    assert.ok(guardadas.every((u) => u.startsWith(AMBITO)), 'todo bajo /ORACLE/')
    assert.equal(sw.self.saltado, true)
  })

  test('cada archivo de la estructura existe y están todos los módulos que carga js/app.js', async () => {
    const sw = cargarSw()
    await sw.disparar('install')
    const rutas = [...(/** @type {Map<string, Response>} */ ([...sw.almacenes.values()][0])).keys()].map((u) => u.slice(AMBITO.length))
    for (const ruta of rutas) if (ruta !== '') assert.ok(existsSync(new URL(ruta, RAIZ)), `falta ${ruta}`)
    const modulos = modulosDeLaApp()
    assert.ok(modulos.includes('config.js') && modulos.includes('core/indicadores.js') && modulos.includes('worker/src/fuentes/binance.js'))
    for (const m of modulos) assert.ok(rutas.includes(m), `${m} no está en la estructura de sw.js`)
    for (const m of readdirSync(new URL('js/vistas/', RAIZ))) assert.ok(rutas.includes(`js/vistas/${m}`), m)
  })

  test('la API del Worker, Binance, data/*.json y los POST no pasan por el service worker', async () => {
    const sw = cargarSw()
    for (const url of [
      'https://oracle.x.workers.dev/api/resumen',
      'https://data-api.binance.vision/api/v3/klines?symbol=BTCEUR&interval=1h&limit=500',
      `${AMBITO}data/backtest-v1.json`,
    ]) {
      assert.equal(await sw.disparar('fetch', peticion(url)), null, url)
    }
    assert.equal(await sw.disparar('fetch', peticion(`${AMBITO}js/app.js`, 'POST')), null)
    assert.deepEqual(sw.llamadasRed, [])
  })

  test('estructura: red primero (y se guarda); sin red, la copia guardada', async () => {
    let conRed = true
    const sw = cargarSw({ red: (url) => (conRed ? new Response(`nuevo:${url}`) : Promise.reject(new TypeError('sin red'))) })
    await sw.disparar('install')
    const online = await sw.disparar('fetch', peticion(`${AMBITO}js/app.js?v=2#x`))
    assert.equal(await online?.text(), `nuevo:${AMBITO}js/app.js`)
    conRed = false
    const offline = await sw.disparar('fetch', peticion(`${AMBITO}js/app.js`))
    assert.equal(await offline?.text(), `nuevo:${AMBITO}js/app.js`)
    const portada = await sw.disparar('fetch', peticion(AMBITO))
    assert.equal(await portada?.text(), `guardado:${AMBITO}`)
  })

  test('al activar borra las versiones anteriores de ORACLE y no toca otras cachés', async () => {
    const sw = cargarSw()
    sw.almacen('oracle-v0')
    sw.almacen('otra-app')
    await sw.disparar('install')
    await sw.disparar('activate')
    const nombres = [...sw.almacenes.keys()]
    assert.ok(!nombres.includes('oracle-v0'))
    assert.ok(nombres.includes('otra-app'))
    assert.equal(nombres.filter((n) => n.startsWith('oracle-')).length, 1)
  })
})

describe('instalable en el iPhone y en Android', () => {
  const html = leer('index.html')

  test('index.html: icono de inicio, modo app, título, barra de estado, tema y zona segura', () => {
    for (const fragmento of [
      '<html lang="es">',
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
      '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
      '<meta name="apple-mobile-web-app-capable" content="yes">',
      '<meta name="apple-mobile-web-app-title" content="ORACLE">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
      '<meta name="theme-color" content="#0b0f17">',
      '<link rel="manifest" href="manifest.webmanifest">',
      '<script type="module" src="js/app.js"></script>',
    ]) assert.ok(html.includes(fragmento), fragmento)
    assert.match(leer('styles.css'), /env\(safe-area-inset-bottom\)/)
  })

  test('rutas relativas: funciona bajo /ORACLE/ en GitHub Pages', () => {
    for (const [, url] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(!url.startsWith('/') && !url.startsWith('http'), url)
      if (!url.startsWith('#')) assert.ok(existsSync(new URL(url, RAIZ)), `falta ${url}`)
    }
  })

  test('manifest: standalone, ámbito relativo, colores e iconos any + maskable que existen', () => {
    const m = JSON.parse(leer('manifest.webmanifest'))
    assert.deepEqual([m.short_name, m.start_url, m.scope, m.display, m.lang], ['ORACLE', './', './', 'standalone', 'es'])
    assert.deepEqual([m.background_color, m.theme_color], ['#0b0f17', '#0b0f17'])
    const maskable = m.icons.filter((/** @type {any} */ i) => i.purpose === 'maskable')
    assert.equal(maskable.length, 1)
    for (const icono of m.icons) {
      assert.ok(existsSync(new URL(icono.src, RAIZ)), icono.src)
      if (icono.type === 'image/png') {
        const p = leerPng(readFileSync(new URL(icono.src, RAIZ)))
        assert.equal(`${p.ancho}x${p.alto}`, icono.sizes)
      }
    }
    assert.deepEqual(m.icons.filter((/** @type {any} */ i) => i.type === 'image/png').map((/** @type {any} */ i) => i.sizes).sort(), ['192x192', '512x512', '512x512'])
  })
})
```

Create `test/pwa/servidores.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { describe, test } from 'node:test'
import { crearApiSimulada } from '../../scripts/api-simulada.mjs'
import { crearServidor } from '../../scripts/servir.mjs'
import { PIN } from './ayudantes.js'

/**
 * Arranca un servidor en un puerto libre, ejecuta `f` y lo cierra.
 * @param {import('node:http').Server} servidor
 * @param {(base: string) => Promise<void>} f
 */
async function con(servidor, f) {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', () => r(undefined)))
  const { port } = /** @type {import('node:net').AddressInfo} */ (servidor.address())
  try {
    await f(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((r) => servidor.close(() => r(undefined)))
  }
}

/** GET con la ruta tal cual (sin normalizar /../, como haría un atacante); devuelve el código HTTP. @param {string} base @param {string} ruta */
const crudo = (base, ruta) => new Promise((resolver, rechazar) => {
  const u = new URL(base)
  request({ host: u.hostname, port: u.port, path: ruta }, (r) => {
    r.resume()
    r.on('end', () => resolver(r.statusCode))
  }).on('error', rechazar).end()
})

describe('servidor estático de desarrollo', () => {
  test('sirve la app con su tipo MIME, sin caché, y nada fuera de la raíz', async () => {
    await con(crearServidor(), async (base) => {
      const portada = await fetch(`${base}/`)
      assert.equal(portada.status, 200)
      assert.equal(portada.headers.get('content-type'), 'text/html; charset=utf-8')
      assert.equal(portada.headers.get('cache-control'), 'no-store')
      assert.match(await portada.text(), /<title>ORACLE<\/title>/)
      const tipos = {
        '/js/app.js': 'text/javascript; charset=utf-8',
        '/manifest.webmanifest': 'application/manifest+json; charset=utf-8',
        '/icons/apple-touch-icon.png': 'image/png',
        '/data/backtest-v1.json': 'application/json; charset=utf-8',
      }
      for (const [ruta, tipo] of Object.entries(tipos)) {
        const r = await fetch(base + ruta)
        assert.equal(r.status, 200, ruta)
        assert.equal(r.headers.get('content-type'), tipo, ruta)
        await r.arrayBuffer()
      }
      assert.equal((await fetch(`${base}/no-existe.js`)).status, 404)
      // Las rutas que intentan salir de la raíz quedan dentro de ella (y no existen): nunca se sirve /etc/passwd.
      for (const ruta of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/..%2F..%2F..%2Fetc%2Fpasswd']) {
        assert.equal(await crudo(base, ruta), 404, ruta)
      }
      assert.equal(await crudo(base, '/%E0%A4%A'), 400)
    })
  })
})

describe('API simulada de desarrollo', () => {
  test('es el Worker real: salud pública, PIN obligatorio y CORS para localhost:8080', async () => {
    await con(await crearApiSimulada(), async (base) => {
      assert.equal((await fetch(`${base}/api/salud`)).status, 200)
      assert.equal((await fetch(`${base}/api/resumen`)).status, 401)
      const r = await fetch(`${base}/api/resumen`, { headers: { Authorization: `Bearer ${PIN}`, Origin: 'http://localhost:8080' } })
      assert.equal(r.status, 200)
      assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8080')
      assert.deepEqual((await r.json()).senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
      const reinicio = await fetch(`${base}/api/bot/reiniciar`, {
        method: 'POST', headers: { Authorization: `Bearer ${PIN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ capital_inicial: 2000, confirmar: true }),
      })
      assert.equal(reinicio.status, 201)
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/estructura.test.js`
Expected: FAIL — `ENOENT` para `sw.js`.

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/servidores.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `scripts/api-simulada.mjs`.

- [ ] **Step 3: Write the manifest, the service worker and `.nojekyll`**

Create `manifest.webmanifest`:

```json
{
  "name": "ORACLE — señales crypto y paper trading",
  "short_name": "ORACLE",
  "description": "Señales de BTC, ETH, SOL, BNB y XRP y un bot de paper trading con dinero virtual. Simulación: no es asesoramiento financiero.",
  "lang": "es",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0b0f17",
  "theme_color": "#0b0f17",
  "icons": [
    { "src": "icons/icono.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "icons/icono-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icono-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/icono-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

Create `sw.js`:

```js
// ORACLE · service worker. Guarda SOLO la estructura de la app (HTML, CSS, JS, iconos y la librería de
// gráficos) para abrir sin conexión. Nunca guarda datos: ni la API del Worker, ni Binance, ni data/*.json.
// Estrategia: red primero (una versión nueva entra sin trucos) y, sin red, la copia guardada.
// Al cambiar cualquier archivo de ESTRUCTURA, sube VERSION.

const VERSION = 'oracle-v1'
const ESTRUCTURA = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './config.js',
  './js/app.js',
  './js/api.js',
  './js/cartera.js',
  './js/dom.js',
  './js/formato.js',
  './js/graficos.js',
  './js/refresco.js',
  './js/rutas.js',
  './js/senal.js',
  './js/series.js',
  './js/sesion.js',
  './js/vistas/backtest.js',
  './js/vistas/bot.js',
  './js/vistas/comun.js',
  './js/vistas/login.js',
  './js/vistas/moneda.js',
  './js/vistas/panel.js',
  './core/estrategia-v1.js',
  './core/estrategia-v2.js',
  './core/estrategias.js',
  './core/indicadores.js',
  './core/velas.js',
  './worker/src/fuentes/binance.js',
  './vendor/lightweight-charts.standalone.production.js',
  './icons/icono.svg',
  './icons/apple-touch-icon.png',
  './icons/icono-192.png',
  './icons/icono-512.png',
  './icons/icono-maskable-512.png',
]

const enEstructura = new Set(ESTRUCTURA.map((ruta) => new URL(ruta, self.registration.scope).href))

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(ESTRUCTURA.map((ruta) => new Request(ruta, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys()
      .then((nombres) => Promise.all(nombres.filter((n) => n.startsWith('oracle-') && n !== VERSION).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (evento) => {
  const peticion = evento.request
  if (peticion.method !== 'GET') return
  const url = new URL(peticion.url)
  url.hash = ''
  url.search = ''
  const clave = url.href
  // Lo que no es estructura (API, Binance, data/*.json…) va directo a la red, sin pasar por la caché.
  if (!enEstructura.has(clave)) return
  evento.respondWith(
    fetch(clave, { cache: 'no-store' })
      .then((respuesta) => {
        if (respuesta.ok) {
          const copia = respuesta.clone()
          evento.waitUntil(caches.open(VERSION).then((cache) => cache.put(clave, copia)))
        }
        return respuesta
      })
      .catch(() => caches.open(VERSION).then((cache) => cache.match(clave)).then((guardada) => guardada || Response.error())),
  )
})
```

Create `.nojekyll` (vacío: GitHub Pages sirve los archivos tal cual, sin Jekyll):

```text
```

- [ ] **Step 4: Write the development servers**

Create `scripts/servir.mjs`:

```js
// @ts-check
// Servidor estático mínimo para probar la PWA en local (los módulos ES no funcionan desde file://).
// No es para producción: la PWA se publica en GitHub Pages.
//
//   node scripts/servir.mjs            → http://localhost:8080 (PUERTO=… para cambiarlo)
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RAIZ = resolve(fileURLToPath(new URL('..', import.meta.url)))
export const PUERTO = 8080

/** @type {Record<string, string>} */
export const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
}

/** @param {{ raiz?: string }} [op] */
export function crearServidor({ raiz = RAIZ } = {}) {
  return createServer(async (peticion, respuesta) => {
    const url = new URL(peticion.url ?? '/', 'http://localhost')
    let ruta
    try {
      ruta = decodeURIComponent(url.pathname)
    } catch {
      respuesta.writeHead(400).end('Ruta mal formada')
      return
    }
    if (ruta.endsWith('/')) ruta += 'index.html'
    const destino = join(raiz, normalize(ruta))
    // Sin esto, /../../.ssh/id_rsa saldría del directorio servido.
    if (!destino.startsWith(raiz + sep)) {
      respuesta.writeHead(403).end('Fuera del directorio servido')
      return
    }
    try {
      const info = await stat(destino)
      if (!info.isFile()) throw new Error('no es un archivo')
      respuesta.writeHead(200, { 'Content-Type': TIPOS[extname(destino)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      createReadStream(destino).pipe(respuesta)
    } catch {
      respuesta.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('No existe')
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.PUERTO ?? PUERTO)
  crearServidor().listen(puerto, () => console.log(`ORACLE en http://localhost:${puerto}`))
}
```

Create `scripts/api-simulada.mjs`:

```js
// @ts-check
// API simulada para probar la PWA sin desplegar ni usar wrangler: el Worker real (worker/src/api.js) sobre
// D1 en memoria (node:sqlite) con 6 horas del escenario SINTÉTICO de los tests (BTC y ETH, precios inventados).
// Solo desarrollo: nunca se publica ni la usa la PWA desplegada.
//
//   node scripts/api-simulada.mjs      → http://localhost:8787, PIN 4815162342 (PUERTO=… para cambiarlo)
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { PIN, workerSimulado } from '../test/pwa/ayudantes.js'

export const PUERTO = 8787

/** @param {import('node:http').IncomingMessage} peticion */
async function cuerpoDe(peticion) {
  /** @type {Buffer[]} */
  const trozos = []
  for await (const trozo of peticion) trozos.push(trozo)
  return trozos.length > 0 ? Buffer.concat(trozos) : undefined
}

/** Servidor HTTP que atiende con el Worker simulado. */
export async function crearApiSimulada() {
  const w = await workerSimulado()
  return createServer(async (peticion, respuesta) => {
    const cabeceras = new Headers()
    for (const [clave, valor] of Object.entries(peticion.headers)) if (typeof valor === 'string') cabeceras.set(clave, valor)
    const r = await w.fetch(`https://oracle.simulado${peticion.url}`, {
      method: peticion.method, headers: cabeceras, body: peticion.method === 'GET' || peticion.method === 'HEAD' ? undefined : await cuerpoDe(peticion),
    })
    respuesta.writeHead(r.status, Object.fromEntries(r.headers))
    respuesta.end(Buffer.from(await r.arrayBuffer()))
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const puerto = Number(process.env.PUERTO ?? PUERTO)
  const servidor = await crearApiSimulada()
  servidor.listen(puerto, () => console.log(`API simulada (datos sintéticos de los tests) en http://localhost:${puerto} · PIN ${PIN}`))
}
```

Replace the whole content of `package.json` with:

```json
{
  "name": "oracle",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Asistente de trading crypto con bot de paper trading. Simulación: no es asesoramiento financiero.",
  "engines": {
    "node": ">=22.13"
  },
  "scripts": {
    "test": "node --disable-warning=ExperimentalWarning --test \"test/*.test.js\" \"test/pwa/*.test.js\" \"worker/test/*.test.js\"",
    "backtest": "node scripts/backtest.mjs",
    "dev": "node scripts/servir.mjs",
    "api-simulada": "node --disable-warning=ExperimentalWarning scripts/api-simulada.mjs",
    "iconos": "node scripts/iconos.mjs"
  }
}
```

- [ ] **Step 5: Document the PWA**

Append to the end of `README.md` (tras una línea en blanco):

````markdown
## PWA

La interfaz es una PWA estática (HTML, CSS y módulos ES, sin build) en la raíz del repositorio, publicada
con GitHub Pages en <https://jcaboroca.github.io/ORACLE/>. Se instala en el iPhone desde Safari
(Compartir → Añadir a pantalla de inicio) y en Android desde el menú del navegador.

- Pantallas: acceso con PIN (se guarda en el dispositivo), Panel (Fear & Greed, una tarjeta por moneda,
  frescura y «Analizar ahora»), detalle de moneda (velas 1H/4H/1D de Binance pedidas desde el navegador
  con EMA20/50/200 y RSI, desglose T/D/N/F, titulares e historial), Bot (cartera frente a comprar y
  mantener, curva, métricas, posiciones, operaciones, decisiones, simulaciones y reinicio) y Backtest
  (`data/backtest-vN.json`, variante técnico + Fear & Greed).
- Refresca al abrir y cada 5 minutos solo mientras está visible. El service worker guarda únicamente la
  estructura de la app; los datos (API, Binance, backtest) van siempre a la red.
- `config.js` tiene la URL del Worker (`API_PRODUCCION`); en `localhost` usa `http://localhost:8787`.
- Gráficos con [TradingView Lightweight Charts™](https://www.tradingview.com/) v5.2.1 (Apache-2.0,
  `vendor/`). Iconos generados desde `icons/icono.svg` con `npm run iconos`.

```bash
npm run dev            # http://localhost:8080
npm run api-simulada   # otra terminal: el Worker real con datos sintéticos de los tests en :8787, PIN 4815162342
```

Para probar contra el Worker de verdad en local, en lugar de la API simulada usa `npx wrangler@4 dev`
desde `worker/` (ver la checklist del plan 2).
````

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/estructura.test.js test/pwa/servidores.test.js`
Expected: PASS — 10 tests, 0 fail.

Run: `npm test`
Expected: 0 fail (332 tests: 240 del núcleo y el Worker + 92 de la PWA).

- [ ] **Step 7: Commit**

```bash
git add package.json manifest.webmanifest sw.js .nojekyll scripts/servir.mjs scripts/api-simulada.mjs README.md test/pwa/estructura.test.js test/pwa/servidores.test.js
git commit -m "feat(pwa): manifest, service worker de solo estructura, servidores de desarrollo y README" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 11: Verificación en el navegador (manual, sin commit)

**Files:** ninguno.

- [ ] **Step 1: Run the whole suite once more**

Run: `npm test`
Expected: 0 fail (332 tests).

- [ ] **Step 2: Start the app and the simulated API (two terminals)**

```bash
npm run dev            # terminal 1 → «ORACLE en http://localhost:8080»
npm run api-simulada   # terminal 2 → «API simulada (datos sintéticos de los tests) en http://localhost:8787 · PIN 4815162342»
```

Para probar contra el Worker de verdad, en lugar de la terminal 2 usa `npx wrangler@4 dev` desde `worker/` con `ORACLE_PIN` en `worker/.dev.vars` (checklist del plan 2) y lanza un cron de mercado con `curl "http://localhost:8787/__scheduled?cron=3+*+*+*+*"`.

- [ ] **Step 3: Walk through every screen at phone width (≈ 390-440 px; DevTools → modo dispositivo)**

Abre <http://localhost:8080> y comprueba, sin errores en la consola:

1. Sin PIN redirige a `#/login`. PIN `0000` → «PIN incorrecto. Quedan 4 intentos.»; PIN `4815162342` → Panel. La barra muestra Panel/Bot/Backtest y «Salir».
2. Panel: «Último análisis: hace … (cron)», `<details>` «6 fuentes no respondieron» (los derivados de BTC y ETH responden 451 en el escenario), tarjetas BTC y ETH con «Comprar», precio en €, «+4,91 % 24 h», «Índice de confianza (sin calibrar): 73 %», frase; medidor de Fear & Greed «53 / 100 · Neutral»; bloque del bot. «Analizar ahora» → aviso «Señales recalculadas…»; pulsarlo otra vez → «Solo se puede analizar una vez cada 5 minutos. Vuelve a probar a las HH:MM.» y botón desactivado.
3. Moneda (toca BTC): velas reales de Binance (`Par BTC/EUR · 500 velas…`) con EMA20 (dorada), EMA50 (azul), EMA200 (violeta), panel de RSI con guías 30/70, eje de precios «72.857,05», logo de TradingView y la nota «Gráficos: TradingView Lightweight Charts™ Copyright (с) 2025 TradingView, Inc.»; pestañas 1H/4H/1D; barras T (+0,50, peso 60 % → 92 %), D y N «Ausente» rayadas, F (0,00); tabla por temporalidad; explicación «Redactada por: Plantilla»; historial. (Los precios de la señal son los sintéticos del escenario y las velas las reales: es lo esperado con la API simulada.)
4. Bot: selector «Simulación 1 · v1 · 10.000,00 € · activa desde …», curva bot vs comprar y mantener, 14 métricas, por moneda (BTC −69,10 €, ETH +101,84 €), 2 posiciones con SL/TP, 6 operaciones (venta de BTC «Stop-loss», de ETH «Take-profit»), decisiones con el filtro «Mantener (HOLD)» en la URL. «Reiniciar simulación…» → diálogo; `50` → error de límites; `5.000` → «Simulación 2 creada con 5000,00 €…» y el selector muestra la 1 como cerrada.
5. Backtest: «v1 (activa)» y «v2», etiqueta «Estrategia v1 · técnico + Fear & Greed», periodo 18/10/2024 – 18/10/2026, nota «Ninguna de las estrategias (v1 y v2) bate a comprar y mantener…», curva diaria, métricas y tablas.
6. «Salir» olvida el PIN. Con el PIN guardado mal (`localStorage.setItem('oracle.pin', '1')` en la consola y recargar en `#/bot`) vuelve al acceso con «PIN incorrecto…» gastando **un** intento.
7. DevTools → Application: manifest sin errores e iconos visibles; service worker activo con la caché `oracle-v1` que contiene solo la estructura (ni `/api/` ni `data/`). Con «Offline» y recarga, la app abre (sin datos, con avisos, nunca en blanco).
8. Con la pestaña oculta más de 5 minutos no hay peticiones en Network; al volver, refresca una vez.

## Checklist de publicación (fuera de este plan; lo hace el usuario)

1. Desplegar el Worker (checklist del plan 2) y copiar su URL `https://oracle.<subdominio>.workers.dev` en `API_PRODUCCION` de `config.js`; subir `VERSION` de `sw.js` (`oracle-v2`) para que la copia sin conexión también se renueve. Commit y push.
2. Comprobar que la var `ORIGENES` del Worker incluye `https://jcaboroca.github.io` (ya está en `worker/wrangler.toml`).
3. Activar GitHub Pages desde `main`, carpeta raíz (Settings → Pages → Deploy from a branch → `main` / `/ (root)`), o `gh api -X POST repos/jcaboroca/ORACLE/pages -f "source[branch]=main" -f "source[path]=/"`. GitHub Pages gratuito exige repositorio público.
4. Abrir <https://jcaboroca.github.io/ORACLE/> en Safari del iPhone → Compartir → «Añadir a pantalla de inicio»: aparece el icono de ORACLE y se abre a pantalla completa con la barra de estado translúcida. En Android, Chrome ofrece «Instalar app».
5. Entrar con el PIN (`ORACLE_PIN`) y repasar las pantallas de la Task 11 con datos reales.

## Cobertura de la spec

| Spec | Dónde |
|---|---|
| §3 PWA sin build en GitHub Pages, `js/`, `vendor/`, `scripts/servir.mjs` | Tasks 1-10; decisiones 11-12 |
| §6/§6.5 desglose T/D/N/F, ausentes y renormalización; índice «sin calibrar» | Task 5 (`barrasComponentes`), Task 9 (Moneda, Panel); decisión 6 |
| §6.6 v2 (`filtro_regimen`, `fuera_de_ventana`, cadencia diaria) | Task 5 (`MOTIVOS`), Task 6 (`lecturaBacktest`), Task 9 (Backtest) |
| §7.2 vocabulario de decisiones, HOLD y no ejecutadas | Tasks 5 y 6 (`textoMotivo`, `filtrarDecisiones`), Task 9 (Bot) |
| §7.6 simulaciones, reinicio con confirmación, nada se borra | Tasks 2, 6, 9 |
| §7.7 métricas por simulación y por moneda | Task 6 (`filasMetricas`, `filasPorMoneda`), Task 9 |
| §8 backtest «técnico + Fear & Greed», versión y periodo | Task 6, Task 9; nota honesta (`notaBacktest`) |
| §9 refresco solo visible cada 5 min; velas del navegador a Binance; sin bucles | Tasks 3, 4, 9; decisión 8 |
| §11 API con PIN, bloqueo, 429 de analizar | Task 2 (contra el Worker real); decisiones 1, 3, 4 |
| §12 acceso, Panel, Moneda, Bot, Backtest, pie fijo, español, móvil, instalable, service worker solo de estructura | Tasks 7-10; Task 11 |
| §13 «la PWA muestra lo que tenga y un aviso, nunca una pantalla en blanco» | `avisoDeError`/`intentar` (Task 9), red caída y sin configurar (Task 2), sin velas (Task 4), SW sin red (Task 10) |
| §14 pruebas sin red | `npm test` no usa la red (la API es el Worker sobre D1 en memoria; Binance es un fixture grabado). Solo el paso de descarga de `vendor/` (Task 8) necesita red |

Desviaciones y añadidos, justificados arriba: imports del navegador desde `core/` y `worker/src/fuentes/binance.js` (decisiones 5-7), `scripts/api-simulada.mjs` (12), `.nojekyll` (12), petición única antes de las paralelas en Bot (3), iconos rasterizados en Node sin herramientas externas (9), y «Cargar más» se pierde al refrescar (8).

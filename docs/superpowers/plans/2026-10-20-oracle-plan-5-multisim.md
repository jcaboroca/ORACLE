# ORACLE — Plan 5: Bot en vivo con 3 estrategias

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el bot opere en vivo con varias estrategias a la vez —una simulación activa con 10.000 € virtuales por cada versión de `ESTRATEGIAS_EN_VIVO`— y que la PWA las compare: el Panel dice qué estrategia da el consejo, el Bot abre con una gráfica de capital de todas frente a comprar y mantener y una tabla de métricas lado a lado (con el detalle de cada simulación como hoy), y el Backtest tiene la pestaña «Laboratorio» que lee `data/laboratorio.json`. Todo funciona **antes** de que llegue el plan 4 (con `['v1']`) y sin tocar nada más cuando el plan 4 ponga `['v3','v4','v5']`.

**Architecture:** `core/estrategias.js` exporta `ESTRATEGIAS_EN_VIVO` y `ESTRATEGIA_PRINCIPAL`; el Worker los lee a través de `worker/src/vivo.js` (`VIVO`, validado e **inyectable**: `ejecutarMercado({ vivo })` y `atender(peticion, { vivo })`), así los tests prueban 1 y 3 estrategias con v1, v2 y una tercera de prueba («v1b», solo en `worker/test/vivo.js`) sin depender de la lista de producción. La migración `0006` cambia el índice único de «una simulación activa» a «una activa por estrategia». El cron descarga los datos una sola vez, sincroniza las simulaciones en un lote (cierra las de estrategias que salen de la lista —quedan en el historial—, crea las que faltan), ejecuta `core/hora.js` por simulación con su propia estrategia y persiste con los mismos lotes atómicos por moneda; `senales_actuales` y las explicaciones del LLM son solo de la principal. La API añade `GET /api/bot/comparativa` y marca la principal; la PWA añade funciones puras probadas en Node (`curvasComparativa`, `filasComparativa`, `textoConsejo`, `lecturaLaboratorio`) y capas finas de DOM. Las tablas anchas nuevas son **apilables**: tarjetas por debajo de 680 px y, por encima, cabeceras que parten línea y desplazamiento horizontal con sombra en el borde.

**Tech Stack:** JavaScript (ES2023, módulos ES, `// @ts-check`), Cloudflare Workers + D1 (simulado en los tests con `node:sqlite`), PWA estática sin build, TradingView Lightweight Charts™ v5.2.1 ya en `vendor/`. Node ≥ 22.13, `node:test`, cero dependencias npm.

**Spec:** `docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md` §6 (bot con 3 estrategias), §7 (PWA) y §8 (pruebas de la parte en vivo). Spec principal `docs/superpowers/specs/2026-10-18-oracle-design.md` §5 (crons), §9 (presupuesto), §10 (esquema D1), §11 (API) y §12 (PWA). Contrato anterior: «Contrato de la API» de `docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md`; aquí solo sus cambios.

**Plan series:** 1) núcleo + backtest (hecho) · 2) Worker + D1 (hecho) · 3) PWA (hecho) · 4) laboratorio de estrategias (en paralelo) · **5) bot en vivo con 3 estrategias (este)**.

**Prerrequisito:** `main` con los planes 1-3 y `npm test` en verde (393 tests en la base `0d5341d`; más si el plan 4 ya añadió los suyos).

**Verified:** todo el código de este plan se ejecutó antes de escribirlo, sobre una copia limpia de la base. `plan5/replay.py` reprodujo **este mismo documento** sobre `git archive HEAD`: aplicó cada bloque en orden, ejecutó cada `Run:` y comprobó su `Expected:` (cada test falla donde el plan dice y pasa con el número indicado) e hizo los 7 commits; resultado: 0 errores, réplica idéntica archivo a archivo al código validado y `npm test` = 441 tests en verde sobre la base `0d5341d` (393 + 48). La misma réplica sobre `main` @ `c557ee6` (con los primeros commits del plan 4 ya dentro) también da 0 errores (480 tests). Además se recorrió la PWA con `npm run dev` + `npm run api-simulada` (3 estrategias de prueba) en Chromium a 390, 680, 681, 760 y 1024 px: Panel con «Consejo de la estrategia…», Bot con la comparativa (3 curvas + comprar y mantener) y el detalle, Backtest → Laboratorio sin archivo («Laboratorio aún no ejecutado») y con un archivo de prueba; ninguna tabla nueva desborda (`scrollWidth = clientWidth` en todos los anchos; tarjetas en el móvil) y ningún error en la consola.

## Global Constraints

- Estilo del repositorio: `// @ts-check` en cada módulo, ES modules, sin punto y coma, comillas simples, identificadores en español, cero dependencias npm, `npm test` = `node --test` de `test/`, `test/pwa/` y `worker/test/`. Comentarios solo donde aclaran.
- **Concurrencia con el plan 4.** El plan 4 se escribe y ejecuta en paralelo: crea `core/estrategia-v3.js`, `-v4.js`, `-v5.js`, `core/familias/*`, `data/laboratorio.json`, `data/backtest-v3…v5.json` y fija `ESTRATEGIAS_EN_VIVO = ['v3','v4','v5']` y `ESTRATEGIA_PRINCIPAL = 'v3'` en `core/estrategias.js`. Este plan:
  - **añade** al final de `core/estrategias.js`, `js/cartera.js`, `js/series.js`, `js/graficos.js`, `styles.css` y `README.md` (no reescribe lo que haya);
  - **reemplaza enteros** `worker/src/repositorio.js`, `worker/src/ejecuciones/mercado.js`, `worker/src/api.js`, `worker/test/mercado.test.js`, `worker/test/api.test.js`, `worker/test/repositorio.test.js`, `test/pwa/ayudantes.js`, `scripts/api-simulada.mjs`, `js/api.js`, `js/dom.js`, `js/vistas/bot.js`, `js/vistas/panel.js`, `js/vistas/backtest.js` y `sw.js`. Antes de reemplazar uno, `git diff 0d5341d -- <archivo>`: si no está vacío (lo cambió el plan 4 u otro), vuelve a aplicar esos cambios sobre el contenido de este plan. Para `sw.js` hay instrucciones concretas en la Task 6.
  - **Nunca** depende de la lista de producción en los tests: todo test del Worker o de la PWA que ejecuta el cron o la API inyecta `vivo` (`vivoDePrueba([...])` de `worker/test/vivo.js`). El único que usa `VIVO` real es `worker/test/index.test.js` (solo comprueba que el cron acaba bien) y los tests de `worker/test/migracion-vivo.test.js` y `test/estrategias-en-vivo.test.js` que validan la lista, sea cual sea.
- Datos sintéticos **nunca** en producción: el escenario, la estrategia «v1b» y el laboratorio de prueba viven en `test/` y `worker/test/` (y `npm run api-simulada`, solo en `127.0.0.1`). `test/pwa/produccion.test.js` comprueba que ni la PWA ni el Worker los alcanzan y que `data/` no tiene nada marcado `sintetico: true`; `cargarLaboratorio` se niega a enseñar un archivo con esa marca.
- PWA: como mucho 2 peticiones a la API en vuelo (el limitador de `js/api.js` ya lo garantiza; la vista Bot pide primero **una** petición sola para no gastar intentos de PIN), nunca `innerHTML` (todo texto entra con `h()`), rutas relativas (`data/laboratorio.json`), y al cambiar archivos de estructura se sube `VERSION` en `sw.js`.
- Unidades del contrato: importes en €, porcentajes como fracción (`drawdownMaximo` positivo), instantes en ms UTC.
- Presupuesto (spec §9 y laboratorio §6): sin subpeticiones externas nuevas (los datos se descargan una vez por cron); llamadas a D1 por cron de mercado = 10 + simulaciones × monedas (+ 1 por simulación la primera hora): 15-16 con 1 estrategia y 25-28 con 3 y 5 monedas (el plan gratuito admite 50). La CPU se mide tras desplegar (Task 8).
- Wrangler siempre desde `/Users/jcaboroca/White_Riggs/ORACLE/worker` y con `npx wrangler@4`; **nunca** desde el directorio personal.
- Cada commit lleva el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## File Structure

```
core/
  estrategias.js                 MOD (añade)  ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL (si el plan 4 no los puso ya)
worker/
  migrations/0006_multisim.sql   NEW          una simulación activa por estrategia
  src/vivo.js                    NEW          VIVO (lista validada e inyectable), crearVivo, etiquetaDe
  src/repositorio.js             MOD (entero) simulacionActiva(db, version), simulacionesActivas, sincronizarSimulaciones,
                                              reiniciarSimulaciones, cargarEstados, sentenciaCapital/guardarCapitales,
                                              datosComparativa; crearSimulacion solo cierra la de su estrategia
  src/ejecuciones/mercado.js     MOD (entero) operar() de todas las simulaciones; ejecutarMercado({ vivo })
  src/api.js                     MOD (entero) GET /api/bot/comparativa, principal/etiqueta, estrategiaPrincipal, reinicio de todas
  test/vivo.js                   NEW          vivoDePrueba(versiones, principal) y la estrategia de prueba v1b
  test/migracion-vivo.test.js    NEW          migración 0006 y vivo.js
  test/multisim.test.js          NEW          repositorio y cron con 3 estrategias
  test/api-multisim.test.js      NEW          API con 3 estrategias y contrato de la comparativa
  test/mercado.test.js           MOD (entero) inyecta vivo; presupuesto de D1 exacto (16)
  test/api.test.js               MOD (entero) inyecta vivo; contrato nuevo de resumen, bot y reinicio; comparativa en EXPLAIN
  test/repositorio.test.js       MOD (entero) crearSimulacion por estrategia
js/
  api.js                         MOD (entero) api.comparativa()
  series.js                      MOD (añade)  curvasComparativa
  graficos.js                    MOD (añade)  COLORES_ESTRATEGIAS, graficoComparativa
  cartera.js                     MOD (añade)  filasComparativa, textoConsejo
  dom.js                         MOD (entero) tabla({ apilable }) y data-etiqueta en cada celda
  laboratorio.js                 NEW          cargarLaboratorio, lecturaLaboratorio (defensiva), textoConfig, textoTramos, filasReservado
  vistas/bot.js                  MOD (entero) comparativa + detalle; reinicio de todas
  vistas/panel.js                MOD (entero) «Consejo de la estrategia …»
  vistas/backtest.js             MOD (entero) pestaña Laboratorio; pestañas «(principal)» / «(en vivo)»
styles.css                       MOD (añade)  tablas apilables, leyenda de la comparativa, laboratorio
sw.js                            MOD (entero) + js/laboratorio.js, VERSION + 1
scripts/api-simulada.mjs         MOD (entero) 3 estrategias de prueba para ver la comparativa en local
test/
  estrategias-en-vivo.test.js    NEW
  pwa/ayudantes.js               MOD (entero) workerSimulado({ vivo })
  pwa/multisim.test.js           NEW          cliente, curvas, filas, gráfico, consejo, reinicio, limitador, vistas
  pwa/tablas.test.js             NEW          tablas apilables (DOM mínimo) y su CSS
  pwa/laboratorio.test.js        NEW          lector defensivo y pestaña Laboratorio
  pwa/produccion.test.js         NEW          sin datos sintéticos en producción
  pwa/fixtures/laboratorio.json  NEW          laboratorio INVENTADO, marcado "sintetico": true (solo tests)
README.md                        MOD (añade)  sección «Bot con varias estrategias en vivo»
```

## Contrato de la API (cambios sobre el del plan 2)

Todo lo que no se menciona aquí sigue igual que en el «Contrato de la API» del plan 2. «Principal» = `ESTRATEGIA_PRINCIPAL`; «en vivo» = `ESTRATEGIAS_EN_VIVO`.

**Simulacion** (en `GET /api/simulaciones`, `GET /api/bot` y `POST /api/bot/reiniciar`) gana `etiqueta` y `principal`:

```ts
type Simulacion = {
  id: number, creadaEn: number, cerradaEn: number|null, activa: boolean,
  estrategiaVersion: string,
  etiqueta: string,        // ETIQUETA del módulo de la estrategia si la exporta; si no (o si ya no existe), la versión
  principal: boolean,      // activa y de la estrategia principal
  capitalInicial: number, saldo: number,
}
```

- `GET /api/simulaciones` → `{ items: Simulacion[] }` por id descendente: todas, activas (una por estrategia en vivo) y cerradas.
- `GET /api/bot` sin `?simulacion=` → la simulación **activa de la principal** (404 `no_encontrado` «No hay simulación activa» si aún no existe). Con `?simulacion=` → cualquiera, como hoy. Igual en `GET /api/bot/operaciones` y `GET /api/bot/decisiones`.
- `GET /api/moneda/:sym` → `decisiones` de la simulación activa de la principal.
- `GET /api/resumen` → añade `estrategiaPrincipal` justo después de `ahora`; `senales` son las de la principal y `bot`, el resumen de su simulación:

```ts
{ ahora, estrategiaPrincipal: { version: string, etiqueta: string, enVivo: number /* cuántas en vivo */ },
  senales, fng, bot, ultimaEjecucion, ultimaNoticias, datosDesactualizados }
```

- `POST /api/bot/reiniciar` `{ capital_inicial, confirmar: true }` → cierra **todas** las simulaciones activas (se conservan) y abre una por estrategia en vivo, todas con ese capital y el mismo instante (la comparativa empieza igualada). 201:

```ts
{ simulacion: Simulacion /* la nueva de la principal */, simulaciones: Simulacion[] /* todas las nuevas, en el orden de ESTRATEGIAS_EN_VIVO */ }
```

- **Nuevo** `GET /api/bot/comparativa` (con PIN) → 200, también sin simulaciones activas (listas vacías):

```ts
{
  ahora: number,                         // ms
  simulaciones: {                        // las activas, en el orden de ESTRATEGIAS_EN_VIVO
    id: number,
    estrategiaVersion: string,
    etiqueta: string,
    principal: boolean,
    capitalInicial: number,              // €
    valorCartera: number,                // € del último punto de capital (el saldo si aún no hay puntos)
    rentabilidad: number,                // fracción: valorCartera / capitalInicial − 1
    drawdownMaximo: number,              // fracción ≥ 0, acumulada hasta el último punto (0 sin puntos)
    operaciones: number,                 // compras + ventas
    curva: { t: number, valor: number }[] // ms y €: horaria los últimos 30 días y un punto por día antes; ≤ 1000 puntos si pasaran de 2000
  }[],
  hodl: { t: number, valor: number }[],  // comprar y mantener de la simulación principal, mismo submuestreo (solo puntos con HODL)
  resumenHodl: { valor: number, rentabilidad: number, drawdownMaximo: number } | null,  // € y fracciones; null sin HODL
}
```

  Lecturas acotadas (comprobado con `EXPLAIN QUERY PLAN`): por simulación, el último punto de `capital`, `COUNT(*)` por el índice `operaciones(simulacion_id)` y las mismas dos lecturas de la curva que `GET /api/bot`; todo en una llamada a D1.

- `POST /api/analizar` no cambia (señales de la principal; nunca opera ni crea simulaciones).
- `ejecuciones.detalle_json` del cron de mercado: `simulacionId` = la de la principal, y se añaden `estrategiaPrincipal` y `simulaciones: [{ id, version, operaciones, repetidas }]`. `operaciones` es la suma y `repetidas`, la unión. Con más de una simulación, los fallos llevan la versión: `"bot v2 ETH: …"`, `"capital v2: sin precio EUR de …"`.
- Esquema D1 (spec §10): `CREATE UNIQUE INDEX una_activa_por_estrategia ON simulaciones(estrategia_version) WHERE activa = 1` sustituye a `una_activa`.

---

### Task 1: Estrategias en vivo en el núcleo

**Files:**
- Create: `test/estrategias-en-vivo.test.js`
- Modify (append): `core/estrategias.js`

**Interfaces:**
- `export const ESTRATEGIAS_EN_VIVO: readonly string[]` — congelada, no vacía, sin repetidas, solo versiones registradas. Aquí `['v1']`; el plan 4 la cambia.
- `export const ESTRATEGIA_PRINCIPAL: string` — una de `ESTRATEGIAS_EN_VIVO`. Aquí `'v1'`.

- [ ] **Step 1: Write the failing test**

Create `test/estrategias-en-vivo.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../core/estrategias.js'

describe('estrategias en vivo', () => {
  test('lista congelada, no vacía, sin repetidas y solo con estrategias registradas', () => {
    assert.ok(Object.isFrozen(ESTRATEGIAS_EN_VIVO))
    assert.ok(ESTRATEGIAS_EN_VIVO.length >= 1)
    assert.equal(new Set(ESTRATEGIAS_EN_VIVO).size, ESTRATEGIAS_EN_VIVO.length)
    for (const v of ESTRATEGIAS_EN_VIVO) assert.ok(Object.hasOwn(ESTRATEGIAS, v), v)
  })

  test('la principal es una de las de en vivo', () => {
    assert.equal(typeof ESTRATEGIA_PRINCIPAL, 'string')
    assert.ok(ESTRATEGIAS_EN_VIVO.includes(ESTRATEGIA_PRINCIPAL))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/estrategias-en-vivo.test.js`
Expected: FAIL — `does not provide an export named 'ESTRATEGIAS_EN_VIVO'`

- [ ] **Step 3: Write the implementation**

Solo si `grep -q ESTRATEGIAS_EN_VIVO core/estrategias.js` **falla** (el plan 4 aún no los ha definido); si ya existen, no toques el archivo y pasa al Step 4.

Append to the end of `core/estrategias.js`:

```js

/**
 * Estrategias que operan en vivo en el bot, cada una con su simulación activa (spec del laboratorio §6). El
 * laboratorio (plan 4) la sustituye por las 3 elegidas; mientras tanto, solo v1.
 */
export const ESTRATEGIAS_EN_VIVO = Object.freeze(['v1'])

/** La que da el consejo del Panel (senales_actuales) y las explicaciones del LLM. Siempre una de las de en vivo. */
export const ESTRATEGIA_PRINCIPAL = 'v1'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/estrategias-en-vivo.test.js`
Expected: PASS — 2 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +2 tests (395 sobre la base `0d5341d`)

- [ ] **Step 5: Commit**

```bash
git add core/estrategias.js test/estrategias-en-vivo.test.js
git commit -m "feat(núcleo): estrategias en vivo y estrategia principal" -m "ESTRATEGIAS_EN_VIVO = [v1] y ESTRATEGIA_PRINCIPAL = v1 hasta que el laboratorio elija las suyas." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Migración 0006 y estrategias en vivo del Worker

**Files:**
- Create: `worker/migrations/0006_multisim.sql`, `worker/src/vivo.js`, `worker/test/vivo.js`, `worker/test/migracion-vivo.test.js`

**Interfaces:**
- `typedef Vivo = { versiones: readonly string[], principal: string, estrategia: (version: string) => Estrategia }`
- `crearVivo(vivo: Vivo): Vivo` — valida (no vacía, sin repetidas, todas existen, principal incluida) y congela; lanza `RangeError`.
- `VIVO: Vivo` — la de `core/estrategias.js`.
- `etiquetaDe(vivo: Vivo, version: string): string` — `ETIQUETA` del módulo o la versión.
- Solo tests: `vivoDePrueba(versiones: string[], principal = versiones[0]): Vivo` y `v1b` (señal de v1 con `version: 'v1b'`, `ETIQUETA: 'v1 al 10 %'` y `fraccionPosicion: 0.1`).

Comprobado antes: `ls worker/migrations` acaba en `0005_cache_mercado.sql`, así que la siguiente es `0006`. SQLite (y D1) no altera índices: se borra `una_activa` y se crea el nuevo.

- [ ] **Step 1: Write the test helper and the failing test**

Create `worker/test/vivo.js`:

```js
// @ts-check
// Estrategias en vivo de prueba (solo tests): v1 y v2 reales más «v1b», la señal de v1 con otra versión, otra
// etiqueta y posiciones del 10 % en lugar del 20 %. Así se prueban 3 simulaciones antes de que existan v3–v5.
import * as v1 from '../../core/estrategia-v1.js'
import { estrategia } from '../../core/estrategias.js'
import { crearVivo } from '../src/vivo.js'

/** @type {import('../../core/hora.js').Estrategia & { ETIQUETA: string }} */
export const v1b = Object.freeze({
  VERSION: 'v1b',
  ETIQUETA: 'v1 al 10 %',
  PARAMETROS: v1.PARAMETROS,
  PARAMETROS_BOT: Object.freeze({ ...v1.PARAMETROS_BOT, fraccionPosicion: 0.1 }),
  calcularSenal: (entrada) => ({ ...v1.calcularSenal(entrada), version: 'v1b' }),
})

/**
 * @param {string[]} versiones p. ej. ['v1', 'v2', 'v1b']
 * @param {string} [principal] por defecto, la primera
 */
export const vivoDePrueba = (versiones, principal = versiones[0]) => crearVivo({
  versiones, principal, estrategia: (v) => (v === 'v1b' ? v1b : estrategia(v)),
})
```

Create `worker/test/migracion-vivo.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, test } from 'node:test'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { VIVO, crearVivo, etiquetaDe } from '../src/vivo.js'
import { crearD1 } from './d1.js'
import { vivoDePrueba } from './vivo.js'

const MIGRACIONES = new URL('../migrations/', import.meta.url)
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')

describe('migración 0006: una simulación activa por estrategia', () => {
  /** @param {ReturnType<typeof crearD1>} db @param {string} version */
  const insertar = (db, version) => db.prepare(
    'INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (0, ?, 10000, 10000)',
  ).bind(version).run()

  test('dos activas de la misma estrategia fallan; de estrategias distintas conviven; las cerradas no cuentan', async () => {
    const db = crearD1()
    await insertar(db, 'v1')
    await insertar(db, 'v2')
    await insertar(db, 'v1b')
    await assert.rejects(insertar(db, 'v1'), /UNIQUE/)
    await db.prepare("UPDATE simulaciones SET activa = 0 WHERE estrategia_version = 'v1'").run()
    await insertar(db, 'v1')
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM simulaciones WHERE activa = 1').first('n'), 3)
  })

  test('sobre la base de producción (0001-0005 con la v1 activa y su historia): la conserva intacta y admite las nuevas', () => {
    const sqlite = new DatabaseSync(':memory:')
    const archivos = readdirSync(MIGRACIONES).filter((a) => a.endsWith('.sql')).sort()
    assert.equal(archivos.at(-1), '0006_multisim.sql', 'la última migración')
    for (const a of archivos.slice(0, -1)) sqlite.exec(readFileSync(new URL(a, MIGRACIONES), 'utf8'))
    sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (5, 'v1', 10000, 7000)")
    sqlite.exec(`INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
      VALUES (1, 'BTC', 0, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`)
    sqlite.exec(readFileSync(new URL('0006_multisim.sql', MIGRACIONES), 'utf8'))
    const indices = sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'simulaciones'").all().map((f) => f.name)
    assert.deepEqual(indices, ['una_activa_por_estrategia'])
    assert.deepEqual({ ...sqlite.prepare('SELECT id, activa, saldo, cerrada_en FROM simulaciones').get() }, { id: 1, activa: 1, saldo: 7000, cerrada_en: null })
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM decisiones').get()?.n, 1)
    sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (9, 'v3', 10000, 10000)")
    assert.throws(() => sqlite.exec("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (9, 'v1', 1, 1)"), /UNIQUE/)
  })
})

describe('estrategias en vivo (worker/src/vivo.js)', () => {
  test('VIVO sale de core/estrategias.js: la principal está en la lista y todas existen', () => {
    assert.ok(VIVO.versiones.length >= 1)
    assert.ok(VIVO.versiones.includes(VIVO.principal))
    for (const v of VIVO.versiones) assert.equal(VIVO.estrategia(v).VERSION, v)
  })

  test('crearVivo rechaza listas vacías, repetidas, versiones desconocidas y una principal fuera de la lista', () => {
    const estrategia = (/** @type {string} */ v) => {
      if (v !== 'v1' && v !== 'v2') throw new RangeError(`Estrategia desconocida: ${v}`)
      return v === 'v1' ? v1 : v2
    }
    assert.throws(() => crearVivo({ versiones: [], principal: 'v1', estrategia }), /No hay estrategias en vivo/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v1'], principal: 'v1', estrategia }), /repetidas/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v9'], principal: 'v1', estrategia }), /desconocida: v9/)
    assert.throws(() => crearVivo({ versiones: ['v1', 'v2'], principal: 'v3', estrategia }), /principal v3 no está en vivo/)
    const vivo = crearVivo({ versiones: ['v2', 'v1'], principal: 'v1', estrategia })
    assert.deepEqual(vivo.versiones, ['v2', 'v1'])
    assert.ok(Object.isFrozen(vivo) && Object.isFrozen(vivo.versiones))
  })

  test('etiquetaDe: ETIQUETA del módulo si la tiene; si no, o si la versión ya no existe, la versión', () => {
    assert.equal(etiquetaDe(TRES, 'v1b'), 'v1 al 10 %')
    assert.equal(etiquetaDe(TRES, 'v1'), 'v1')
    assert.equal(etiquetaDe(TRES, 'v0'), 'v0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/migracion-vivo.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/vivo.js`

- [ ] **Step 3: Write the implementation**

Create `worker/migrations/0006_multisim.sql`:

```sql
-- ORACLE · Bot con varias estrategias en vivo (spec del laboratorio §6): una simulación activa POR ESTRATEGIA,
-- en lugar de una sola en total. Las simulaciones existentes no cambian: la v1 activa sigue activa hasta que el
-- cron de mercado la cierre porque su estrategia ya no está en ESTRATEGIAS_EN_VIVO (queda en el historial).
DROP INDEX una_activa;
CREATE UNIQUE INDEX una_activa_por_estrategia ON simulaciones(estrategia_version) WHERE activa = 1;
```

Create `worker/src/vivo.js`:

```js
// @ts-check
// Estrategias en vivo del bot (spec del laboratorio §6): una simulación activa por cada una de
// ESTRATEGIAS_EN_VIVO; la principal da el consejo del Panel y es la única con explicaciones del LLM.
// Inyectable en ejecutarMercado y en la API (tests con otras listas).
import { ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL, estrategia } from '../../core/estrategias.js'

/** @typedef {import('../../core/hora.js').Estrategia} Estrategia */
/**
 * @typedef {{ versiones: readonly string[], principal: string, estrategia: (version: string) => Estrategia }} Vivo
 * versiones: en el orden en que se ejecutan y se muestran; estrategia: módulo de cada versión (lanza si no existe).
 */

/**
 * Valida y congela una configuración: al menos una versión, sin repetidas, todas registradas y la principal entre ellas.
 * @param {Vivo} vivo
 * @returns {Vivo}
 */
export function crearVivo({ versiones, principal, estrategia: obtener }) {
  if (versiones.length === 0) throw new RangeError('No hay estrategias en vivo')
  if (new Set(versiones).size !== versiones.length) throw new RangeError(`Estrategias en vivo repetidas: ${versiones.join(', ')}`)
  for (const v of versiones) obtener(v)
  if (!versiones.includes(principal)) throw new RangeError(`La estrategia principal ${principal} no está en vivo`)
  return Object.freeze({ versiones: Object.freeze([...versiones]), principal, estrategia: obtener })
}

/** La configuración de producción: core/estrategias.js. */
export const VIVO = crearVivo({ versiones: ESTRATEGIAS_EN_VIVO, principal: ESTRATEGIA_PRINCIPAL, estrategia })

/**
 * Nombre para la interfaz: `ETIQUETA` del módulo si la exporta; si no (o si la versión ya no existe), la versión.
 * @param {Vivo} vivo @param {string} version
 */
export function etiquetaDe(vivo, version) {
  try {
    const modulo = /** @type {{ ETIQUETA?: unknown }} */ (vivo.estrategia(version))
    return typeof modulo.ETIQUETA === 'string' && modulo.ETIQUETA !== '' ? modulo.ETIQUETA : version
  } catch {
    return version
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/migracion-vivo.test.js`
Expected: PASS — 5 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +5 tests (400 sobre la base `0d5341d`). `worker/test/d1.test.js` «solo una simulación activa» sigue pasando: inserta dos v1.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0006_multisim.sql worker/src/vivo.js worker/test/vivo.js worker/test/migracion-vivo.test.js
git commit -m "feat(worker): migración 0006 (una simulación activa por estrategia) y estrategias en vivo inyectables" -m "VIVO valida ESTRATEGIAS_EN_VIVO y ESTRATEGIA_PRINCIPAL; los tests usan vivoDePrueba con v1, v2 y v1b." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Repositorio, cron y API con varias simulaciones

**Files:**
- Create: `worker/test/multisim.test.js`, `worker/test/api-multisim.test.js`
- Modify (entero): `worker/test/mercado.test.js`, `worker/test/api.test.js`, `worker/test/repositorio.test.js`, `test/pwa/ayudantes.js`, `worker/src/repositorio.js`, `worker/src/ejecuciones/mercado.js`, `worker/src/api.js`

**Interfaces:**
- `repo.simulacionActiva(db, version: string): Promise<FilaSimulacion|null>` (antes sin versión).
- `repo.simulacionesActivas(db): Promise<FilaSimulacion[]>` — por id.
- `repo.crearSimulacion(db, { capitalInicial, version, ahora })` — ahora solo cierra la activa **de su estrategia**.
- `repo.reiniciarSimulaciones(db, { capitalInicial, versiones, ahora }): Promise<FilaSimulacion[]>` — cierra todas, abre una por versión (1 llamada).
- `repo.sincronizarSimulaciones(db, { versiones, capitalInicial, ahora }): Promise<FilaSimulacion[]>` — 1 llamada; en el orden de `versiones`; sin cambios no escribe ninguna fila; `RangeError` con lista vacía.
- `repo.cargarEstados(db, ids: number[], parametrosDe: (version) => ParametrosBot): Promise<{ sim, estado, hodl }[]>` — 1 llamada.
- `repo.sentenciaCapital(db, punto)`, `repo.guardarCapital(db, punto)`, `repo.guardarCapitales(db, puntos)` (1 llamada; ninguna sin puntos). `typedef PuntoCapital = { simulacionId, vela, valorCartera, saldo, valorHodl }`.
- `repo.datosComparativa(db, ids, horariaMs): Promise<{ ultimo, operaciones, curva }[]>` — 1 llamada.
- `operar(db, { sims, estrategiaDe, entradas, titulares, fng, ahora }): Promise<{ simulaciones: { id, version, senales, operaciones, repetidas }[], fallos }>`
- `ejecutarMercado({ env, fetch, ahora, manual?, idEjecucion?, esperar?, vivo = VIVO })` → añade `simulaciones: { id, version, operaciones, repetidas }[]` al resultado.
- `atender(peticion, { env, fetch, ahora, esperar?, vivo? })`; `aSimulacion(fila, vivo)`.
- Solo tests: `workerSimulado({ ahora?, ip?, vivo = vivoDePrueba(['v1']) })`.

Por qué una sola tarea: el cambio de `simulacionActiva(db)` → `simulacionActiva(db, version)` rompe a la vez el cron y la API; las tres piezas cambian juntas para que cada commit quede en verde.

- [ ] **Step 1: Write the failing tests**

Create `worker/test/multisim.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial, velaDeDecision } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { ejecutarHora } from '../../core/hora.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import {
  cargarEstado, cargarEstados, crearSimulacion, guardarCapital, guardarCapitales, obtenerSimulacion, reiniciarSimulaciones,
  senalesActuales, simulacionActiva, simulacionesActivas, sincronizarSimulaciones,
} from '../src/repositorio.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, entradasBacktest, fetchEscenario, sinEspera } from './escenario.js'
import { v1b, vivoDePrueba } from './vivo.js'

const V1 = vivoDePrueba(['v1'])
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')
/** Módulo de cada versión de prueba. */
const MODULOS = /** @type {Record<string, import('../../core/hora.js').Estrategia>} */ ({ v1, v2, v1b })

/** @param {ReturnType<typeof crearD1>|any} db @param {string} [monedas] */
const entorno = (db, monedas = 'BTC,ETH') => ({ DB: db, MONEDAS: monedas })

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

/** @param {ReturnType<typeof crearD1>} db @param {string} tabla */
const contar = (db, tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).first('n')

describe('repositorio con varias simulaciones', () => {
  test('sincronizarSimulaciones crea las que faltan, en el orden de la lista, y repetida no escribe nada', async () => {
    const db = crearD1()
    const sims = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1'], capitalInicial: 10_000, ahora: 100 })
    assert.deepEqual(sims.map((s) => [s.estrategia_version, s.capital_inicial, s.saldo, s.creada_en, s.activa]), [['v2', 10_000, 10_000, 100, 1], ['v1', 10_000, 10_000, 100, 1]])
    const cambios = db.sqlite.prepare('SELECT total_changes() AS n').get()?.n
    const otra = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1'], capitalInicial: 5, ahora: 200 })
    assert.deepEqual(otra, sims)
    assert.equal(db.sqlite.prepare('SELECT total_changes() AS n').get()?.n, cambios, 'ninguna fila escrita')
    await assert.rejects(sincronizarSimulaciones(db, { versiones: [], capitalInicial: 1, ahora: 1 }), RangeError)
  })

  test('sincronizarSimulaciones cierra las de estrategias que salen de la lista (sin borrar nada) y crea las nuevas', async () => {
    const db = crearD1()
    const v1Sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })
    await db.prepare('UPDATE simulaciones SET saldo = 8000 WHERE id = ?').bind(v1Sim.id).run()
    const sims = await sincronizarSimulaciones(db, { versiones: ['v2', 'v1b'], capitalInicial: 10_000, ahora: 500 })
    assert.deepEqual(sims.map((s) => s.estrategia_version), ['v2', 'v1b'])
    assert.deepEqual(await obtenerSimulacion(db, v1Sim.id), { ...v1Sim, saldo: 8000, activa: 0, cerrada_en: 500 })
    assert.equal(await simulacionActiva(db, 'v1'), null)
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.estrategia_version), ['v2', 'v1b'])
  })

  test('crearSimulacion solo cierra la activa de su misma estrategia; reiniciarSimulaciones las cierra todas y abre una por versión', async () => {
    const db = crearD1()
    const a = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })
    const b = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v2', ahora: 2 })
    const c = await crearSimulacion(db, { capitalInicial: 3_000, version: 'v1', ahora: 3 })
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.id), [b.id, c.id])
    assert.equal((await obtenerSimulacion(db, a.id))?.cerrada_en, 3)
    const nuevas = await reiniciarSimulaciones(db, { capitalInicial: 5_000, versiones: ['v1b', 'v1', 'v2'], ahora: 9 })
    assert.deepEqual(nuevas.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v1b', 5_000, 9], ['v1', 5_000, 9], ['v2', 5_000, 9]])
    assert.deepEqual((await simulacionesActivas(db)).map((s) => s.id), nuevas.map((s) => s.id))
    assert.deepEqual((await filas(db, 'SELECT cerrada_en FROM simulaciones WHERE activa = 0 ORDER BY id')).map((f) => f.cerrada_en), [3, 9, 9])
  })

  test('cargarEstados = obtenerSimulacion + cargarEstado de cada una, en una sola llamada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    for (let k = 0; k < 3; k++) {
      await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
    }
    const ids = (await simulacionesActivas(db)).map((s) => s.id).reverse()
    const antes = db.llamadas
    const juntos = await cargarEstados(db, ids, (v) => MODULOS[v].PARAMETROS_BOT)
    assert.equal(db.llamadas - antes, 1)
    for (const [i, id] of ids.entries()) {
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, id))
      assert.deepEqual(juntos[i], { sim, ...(await cargarEstado(db, sim, MODULOS[sim.estrategia_version].PARAMETROS_BOT)) })
    }
    assert.deepEqual(await cargarEstados(db, [], () => v1.PARAMETROS_BOT), [])
    await assert.rejects(cargarEstados(db, [99], () => v1.PARAMETROS_BOT), /No existe la simulación 99/)
  })

  test('guardarCapitales: los puntos de varias simulaciones en un lote, iguales que con guardarCapital', async () => {
    const a = crearD1()
    const b = crearD1()
    for (const db of [a, b]) for (const v of ['v1', 'v2']) await crearSimulacion(db, { capitalInicial: 10_000, version: v, ahora: 0 })
    const puntos = [
      { simulacionId: 1, vela: 0, valorCartera: 10_000, saldo: 10_000, valorHodl: null },
      { simulacionId: 2, vela: 0, valorCartera: 9_000, saldo: 9_000, valorHodl: 9_500 },
    ]
    const antes = a.llamadas
    await guardarCapitales(a, puntos)
    assert.equal(a.llamadas - antes, 1)
    for (const p of puntos) await guardarCapital(b, p)
    const leer = (/** @type {ReturnType<typeof crearD1>} */ db) => filas(db, 'SELECT * FROM capital ORDER BY simulacion_id')
    assert.deepEqual(await leer(a), await leer(b))
    const llamadas = a.llamadas
    await guardarCapitales(a, [])
    assert.equal(a.llamadas, llamadas, 'sin puntos no llama a D1')
  })
})

describe('ejecutarMercado con varias estrategias en vivo', () => {
  test('3 estrategias: una simulación por cada una, cada una idéntica a core/hora.js con su estrategia; la principal da las señales', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    /** @type {Record<string, { estado: import('../../core/bot.js').Estado, hodl: Record<string, number>|null }>} */
    const memoria = Object.fromEntries(['v1', 'v2', 'v1b'].map((v) => [v, { estado: estadoInicial(10_000), hodl: null }]))
    for (let k = 0; k < 4; k++) {
      const ahora = ahoraDe(k)
      const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      assert.equal(r.ejecucion.ok, true)
      assert.deepEqual(r.repetidas, [])
      const sims = await simulacionesActivas(db)
      assert.deepEqual(sims.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v1', 10_000, ahoraDe(0)], ['v2', 10_000, ahoraDe(0)], ['v1b', 10_000, ahoraDe(0)]])
      assert.deepEqual(r.simulaciones.map((s) => [s.id, s.version]), sims.map((s) => [s.id, s.estrategia_version]))
      for (const sim of sims) {
        const est = MODULOS[sim.estrategia_version]
        const m = memoria[sim.estrategia_version]
        const hora = ejecutarHora({ ...m, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: est })
        memoria[sim.estrategia_version] = { estado: hora.estado, hodl: hora.hodl }
        const desdeD1 = await cargarEstado(db, sim, est.PARAMETROS_BOT)
        assert.deepEqual(desdeD1, { estado: hora.estado, hodl: hora.hodl }, `${sim.estrategia_version} en la hora ${k}`)
        const capital = await db.prepare('SELECT valor_cartera, valor_hodl FROM capital WHERE simulacion_id = ? AND vela_1h = ?').bind(sim.id, velaDeDecision(ahora)).first()
        assert.deepEqual(capital, { valor_cartera: hora.punto.valor, valor_hodl: hora.punto.hodl }, `capital de ${sim.estrategia_version} en la hora ${k}`)
        const versiones = await filas(db, 'SELECT DISTINCT json_extract(desglose_json, \'$.version\') AS v, estrategia_version FROM decisiones WHERE simulacion_id = ?', sim.id)
        assert.deepEqual(versiones, [{ v: sim.estrategia_version, estrategia_version: sim.estrategia_version }])
      }
      assert.ok(r.senales.every((s) => s.version === 'v2'), 'las señales devueltas son las de la principal')
      const guardadas = await senalesActuales(db)
      assert.deepEqual(Object.values(guardadas).map((s) => s.version), ['v2', 'v2'])
      const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones ORDER BY id DESC').first('detalle_json'))
      assert.equal(detalle.estrategiaPrincipal, 'v2')
      assert.equal(detalle.simulacionId, sims[1].id)
      assert.deepEqual(detalle.simulaciones.map((/** @type {any} */ s) => s.version), ['v1', 'v2', 'v1b'])
      assert.equal(detalle.operaciones, detalle.simulaciones.reduce((/** @type {number} */ n, /** @type {any} */ s) => n + s.operaciones, 0))
    }
    // Estrategias distintas, resultados distintos: v1b compra la mitad que v1 y v2 solo decide al cierre diario.
    const unidades = await filas(db, "SELECT simulacion_id, unidades FROM operaciones WHERE simbolo = 'BTC' AND lado = 'compra' ORDER BY id LIMIT 3")
    assert.equal(unidades.length, 3)
    const porSim = Object.fromEntries(unidades.map((u) => [u.simulacion_id, u.unidades]))
    assert.ok(Math.abs(porSim[3] / porSim[1] - 0.5) < 0.01, 'v1b invierte el 10 % y v1 el 20 %')
  })

  test('al cambiar la lista, la v1 activa se cierra con su historia intacta y las nuevas empiezan con 10.000 €', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    for (let k = 0; k < 2; k++) {
      await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
    }
    const vieja = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await simulacionActiva(db, 'v1'))
    const historia = await Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map((t) => filas(db, `SELECT * FROM ${t} WHERE simulacion_id = ?`, vieja.id)))
    const nuevo = vivoDePrueba(['v2', 'v1b'])
    const r = await ejecutarMercado({ vivo: nuevo, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(2)), ahora: ahoraDe(2) })
    assert.equal(r.ejecucion.ok, true)
    assert.deepEqual(await obtenerSimulacion(db, vieja.id), { ...vieja, activa: 0, cerrada_en: ahoraDe(2) })
    assert.deepEqual(await Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map((t) => filas(db, `SELECT * FROM ${t} WHERE simulacion_id = ?`, vieja.id))), historia,
      'la cerrada no opera más y conserva todo')
    const activas = await simulacionesActivas(db)
    assert.deepEqual(activas.map((s) => [s.estrategia_version, s.capital_inicial, s.creada_en]), [['v2', 10_000, ahoraDe(2)], ['v1b', 10_000, ahoraDe(2)]])
    for (const s of activas) {
      assert.deepEqual((await filas(db, 'SELECT vela_1h FROM decisiones WHERE simulacion_id = ? GROUP BY vela_1h', s.id)).map((d) => d.vela_1h), [velaDeDecision(ahoraDe(2))])
    }
    assert.equal(await contar(db, 'simulaciones'), 3)
  })

  test('repetir la misma hora con 3 simulaciones no duplica nada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    const foto = async () => [...await Promise.all(['simulaciones', 'decisiones', 'operaciones', 'posiciones', 'capital', 'progreso'].map((t) => contar(db, t))),
      ...(await filas(db, 'SELECT saldo FROM simulaciones ORDER BY id')).map((f) => f.saldo)]
    const antes = await foto()
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora + 60_000), ahora: ahora + 60_000 })
    assert.deepEqual(r.repetidas, ['BTC', 'ETH'])
    assert.deepEqual(r.simulaciones.map((s) => s.repetidas), [['BTC', 'ETH'], ['BTC', 'ETH'], ['BTC', 'ETH']])
    assert.equal(r.operaciones, 0)
    assert.deepEqual(await foto(), antes)
  })

  test('si falla el lote de una moneda de una simulación, las otras simulaciones siguen y el fallo dice cuál', async () => {
    const base = crearD1()
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO decisiones') && s.valores[0] === 2 && s.valores[1] === 'ETH')) {
          throw new Error('D1_ERROR: simulado')
        }
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    assert.deepEqual(r.ejecucion.fallos.filter((f) => f.startsWith('bot')), ['bot v2 ETH: D1_ERROR: simulado'])
    const decisiones = await filas(base, 'SELECT simulacion_id, simbolo FROM decisiones ORDER BY simulacion_id, simbolo')
    assert.deepEqual(decisiones.map((d) => `${d.simulacion_id}:${d.simbolo}`), ['1:BTC', '1:ETH', '2:BTC', '3:BTC', '3:ETH'])
    assert.equal(await contar(base, 'capital'), 3)
  })

  test('presupuesto con 3 estrategias y 5 monedas: 28 llamadas a D1 la primera hora y 25 después; las subpeticiones no cambian', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    const fetch = fetchEscenario(escenario, ahoraDe(0))
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env, fetch, ahora: ahoraDe(0) })
    assert.equal(fetch.llamadas.length, 38, 'las mismas que con una estrategia: los datos se descargan una vez')
    assert.equal(db.llamadas, 28, '10 + 3 simulaciones × 5 monedas + 3 HODL')
    const antes = db.llamadas
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env, fetch: fetchEscenario(escenario, ahoraDe(1)), ahora: ahoraDe(1) })
    assert.equal(r.ejecucion.ok, true)
    assert.equal(db.llamadas - antes, 25)
  })

  test('el LLM explica solo las señales de la principal: las mismas llamadas con 1 que con 3 estrategias', async () => {
    /** @param {import('../src/vivo.js').Vivo} vivo */
    const llamadasLlm = async (vivo) => {
      const db = crearD1()
      let n = 0
      const AI = { run: async () => { n++; throw new Error('sin cuota') } }
      const ahora = ahoraDe(0)
      const r = await ejecutarMercado({ vivo, esperar: sinEspera, env: { ...entorno(db), AI, LLM_MODELO_CF: '@cf/x' }, fetch: fetchEscenario(crearEscenario(), ahora), ahora })
      assert.ok(Object.values(await senalesActuales(db)).every((s) => s.motorExplicacion === 'plantilla'))
      assert.equal(r.senales.length, 2)
      return n
    }
    const una = await llamadasLlm(V1)
    assert.ok(una > 0)
    assert.equal(await llamadasLlm(TRES), una)
  })

  test('manual con 3 estrategias: señales de la principal, sin crear ni tocar simulaciones', async () => {
    const db = crearD1()
    const sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.equal(r.ejecucion.ok, true)
    assert.ok(r.senales.every((s) => s.version === 'v2'))
    assert.deepEqual(await simulacionesActivas(db), [sim])
    for (const t of ['decisiones', 'operaciones', 'capital']) assert.equal(await contar(db, t), 0, t)
  })
})
```

Create `worker/test/api-multisim.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resumirCurva } from '../../core/metricas.js'
import { atender, submuestrearCurva } from '../src/api.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from './escenario.js'
import { vivoDePrueba } from './vivo.js'

const PIN = '4815162342'
/** v1, v2 y v1b en vivo; la principal, v2. */
const TRES = vivoDePrueba(['v1', 'v2', 'v1b'], 'v2')

/** @param {ReturnType<typeof crearD1>} db */
const entorno = (db) => ({ DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: 'https://jcaboroca.github.io' })

/**
 * @param {ReturnType<typeof crearD1>} db @param {string} ruta
 * @param {{ metodo?: string, cuerpo?: unknown, ahora?: number, vivo?: import('../src/vivo.js').Vivo }} [op]
 */
async function pedir(db, ruta, { metodo = 'GET', cuerpo, ahora = ahoraDe(6), vivo = TRES } = {}) {
  const peticion = new Request(`https://oracle.workers.dev${ruta}`, {
    method: metodo, headers: { Authorization: `Bearer ${PIN}`, 'CF-Connecting-IP': '1.2.3.4' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const res = await atender(peticion, { env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, esperar: sinEspera, vivo })
  return { estado: res.status, cuerpo: await res.json() }
}

/** 6 horas del escenario con las 3 estrategias en vivo. */
async function conTres() {
  const db = crearD1()
  const escenario = crearEscenario()
  for (let k = 0; k < 6; k++) {
    await ejecutarMercado({ vivo: TRES, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
  }
  return db
}

/** Curva completa de una simulación desde D1. @param {ReturnType<typeof crearD1>} db @param {number} id */
async function curvaDe(db, id) {
  const { results } = await db.prepare('SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital WHERE simulacion_id = ? ORDER BY vela_1h').bind(id).all()
  return results.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
}

describe('API con varias estrategias en vivo', () => {
  test('GET /api/bot/comparativa: contrato exacto, en el orden de la lista, curvas en € y ms y HODL de la principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/bot/comparativa')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['ahora', 'simulaciones', 'hodl', 'resumenHodl'])
    assert.equal(r.cuerpo.ahora, ahoraDe(6))
    const sims = r.cuerpo.simulaciones
    assert.deepEqual(sims.map((/** @type {any} */ s) => [s.id, s.estrategiaVersion, s.etiqueta, s.principal]), [
      [1, 'v1', 'v1', false], [2, 'v2', 'v2', true], [3, 'v1b', 'v1 al 10 %', false],
    ])
    for (const s of sims) {
      assert.deepEqual(Object.keys(s), [
        'id', 'estrategiaVersion', 'etiqueta', 'principal', 'capitalInicial', 'valorCartera', 'rentabilidad', 'drawdownMaximo', 'operaciones', 'curva',
      ])
      const completa = await curvaDe(db, s.id)
      assert.equal(s.capitalInicial, 10_000)
      assert.equal(s.valorCartera, completa.at(-1)?.valor)
      assert.equal(s.rentabilidad, s.valorCartera / 10_000 - 1)
      assert.equal(s.drawdownMaximo, resumirCurva(completa).drawdownMaximo)
      assert.equal(s.operaciones, await db.prepare('SELECT COUNT(*) AS n FROM operaciones WHERE simulacion_id = ?').bind(s.id).first('n'))
      assert.deepEqual(s.curva, submuestrearCurva(completa).map((p) => ({ t: p.t, valor: p.valor })))
    }
    assert.ok(sims[0].operaciones > 0 && sims[2].operaciones > 0)
    assert.notEqual(sims[0].valorCartera, sims[2].valorCartera, 'estrategias distintas, carteras distintas')
    const principal = await curvaDe(db, 2)
    assert.deepEqual(r.cuerpo.hodl, principal.filter((p) => p.hodl !== null).map((p) => ({ t: p.t, valor: p.hodl })))
    assert.ok(r.cuerpo.hodl.length > 1)
    const resumen = resumirCurva(principal)
    assert.deepEqual(r.cuerpo.resumenHodl, {
      valor: resumen.ultimoHodl, rentabilidad: /** @type {number} */ (resumen.ultimoHodl) / 10_000 - 1, drawdownMaximo: resumen.drawdownMaximoHodl,
    })
  })

  test('GET /api/bot/comparativa sin simulaciones activas (antes del primer cron): listas vacías', async () => {
    const r = await pedir(crearD1(), '/api/bot/comparativa')
    assert.equal(r.estado, 200)
    assert.deepEqual(r.cuerpo, { ahora: ahoraDe(6), simulaciones: [], hodl: [], resumenHodl: null })
  })

  test('GET /api/simulaciones marca activas, estrategia, etiqueta y principal; GET /api/bot sin parámetro = la principal', async () => {
    const db = await conTres()
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.estrategiaVersion, s.etiqueta, s.principal]), [
      [3, true, 'v1b', 'v1 al 10 %', false], [2, true, 'v2', 'v2', true], [1, true, 'v1', 'v1', false],
    ])
    assert.equal((await pedir(db, '/api/bot')).cuerpo.simulacion.id, 2)
    const otra = await pedir(db, '/api/bot?simulacion=3')
    assert.deepEqual([otra.cuerpo.simulacion.estrategiaVersion, otra.cuerpo.simulacion.principal], ['v1b', false])
    const ops = await pedir(db, '/api/bot/operaciones?simulacion=1')
    assert.ok(ops.cuerpo.items.length > 0 && ops.cuerpo.items.every((/** @type {any} */ o) => o.estrategiaVersion === 'v1'))
    const decs = await pedir(db, '/api/bot/decisiones')
    assert.ok(decs.cuerpo.items.every((/** @type {any} */ d) => d.estrategiaVersion === 'v2'), 'sin parámetro, las de la principal')
  })

  test('GET /api/resumen y /api/moneda: consejo, bot y decisiones de la estrategia principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 60_000 })
    assert.deepEqual(r.cuerpo.estrategiaPrincipal, { version: 'v2', etiqueta: 'v2', enVivo: 3 })
    assert.ok(r.cuerpo.senales.every((/** @type {any} */ s) => s.estrategiaVersion === 'v2'))
    assert.deepEqual([r.cuerpo.bot.simulacionId, r.cuerpo.bot.estrategiaVersion], [2, 'v2'])
    const m = await pedir(db, '/api/moneda/BTC')
    assert.equal(m.cuerpo.senal.version, 'v2')
    assert.equal(m.cuerpo.decisiones.length, 6)
    assert.ok(m.cuerpo.decisiones.every((/** @type {any} */ d) => d.estrategiaVersion === 'v2'))
  })

  test('POST /api/bot/reiniciar con 3 estrategias: cierra las 3 y abre 3 con el mismo capital; simulacion = la nueva principal', async () => {
    const db = await conTres()
    const r = await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000, confirmar: true }, ahora: 777 })
    assert.equal(r.estado, 201)
    assert.deepEqual(r.cuerpo.simulaciones.map((/** @type {any} */ s) => [s.id, s.estrategiaVersion, s.capitalInicial, s.creadaEn, s.principal]), [
      [4, 'v1', 5000, 777, false], [5, 'v2', 5000, 777, true], [6, 'v1b', 5000, 777, false],
    ])
    assert.deepEqual(r.cuerpo.simulacion, r.cuerpo.simulaciones[1])
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.cerradaEn]), [
      [6, true, null], [5, true, null], [4, true, null], [3, false, 777], [2, false, 777], [1, false, 777],
    ])
    const comparativa = await pedir(db, '/api/bot/comparativa')
    assert.deepEqual(comparativa.cuerpo.simulaciones.map((/** @type {any} */ s) => [s.id, s.valorCartera, s.operaciones, s.curva]), [
      [4, 5000, 0, []], [5, 5000, 0, []], [6, 5000, 0, []],
    ])
  })
})
```

Los tests existentes inyectan `vivo` (así no dependen de la lista de producción, que el plan 4 cambia) y recogen el contrato nuevo:

Replace the whole content of `worker/test/mercado.test.js` with:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial, velaDeDecision } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { ejecutarBacktest } from '../../core/backtest.js'
import { ejecutarHora } from '../../core/hora.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { cargarEstado, crearSimulacion, obtenerSimulacion, senalesActuales } from '../src/repositorio.js'
import { cuerposConsumidos } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { CIERRE, ahoraDe, crearEscenario, entradasBacktest, fetchEscenario, servidasEn, sinEspera } from './escenario.js'
import { vivoDePrueba } from './vivo.js'

/** Una sola estrategia en vivo, v1: los tests no dependen de la lista de producción (core/estrategias.js). */
const V1 = vivoDePrueba(['v1'])

/** @param {ReturnType<typeof crearD1>|any} db @param {string} [monedas] */
const entorno = (db, monedas = 'BTC,ETH') => ({ DB: db, MONEDAS: monedas })

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

/** Saldo = capital − compras + (ventas − comisiones): el libro cuadra con la tabla de operaciones. @param {ReturnType<typeof crearD1>} db */
async function comprobarLibro(db) {
  const sim = await db.prepare('SELECT * FROM simulaciones WHERE activa = 1').first()
  const ops = await filas(db, 'SELECT * FROM operaciones WHERE simulacion_id = ? ORDER BY id', sim.id)
  const libro = ops.reduce((s, o) => (o.lado === 'compra' ? s - o.importe : s + o.importe - o.comision), sim.capital_inicial)
  assert.ok(Math.abs(libro - sim.saldo) < 1e-9, `libro ${libro} ≠ saldo ${sim.saldo}`)
  if (ops.length > 0) assert.equal(ops[ops.length - 1].saldo_tras, sim.saldo)
  const abiertas = await filas(db, "SELECT simbolo FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta'", sim.id)
  const compradas = ops.filter((o) => o.lado === 'compra').length - ops.filter((o) => o.lado === 'venta').length
  assert.equal(abiertas.length, compradas)
}

describe('ejecutarMercado (cron)', () => {
  test('primera ejecución: crea la simulación activa con 10.000 € y la estrategia en vivo, y lo guarda todo', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    const sim = await db.prepare('SELECT * FROM simulaciones').first()
    assert.equal(sim.estrategia_version, 'v1')
    assert.equal(sim.capital_inicial, 10_000)
    assert.equal(sim.activa, 1)
    assert.notEqual(sim.hodl_json, null)
    assert.equal((await filas(db, 'SELECT * FROM decisiones')).length, 2)
    assert.deepEqual((await filas(db, 'SELECT vela_1h FROM capital')).map((c) => c.vela_1h), [velaDeDecision(ahora)])
    const senales = await senalesActuales(db)
    assert.deepEqual(Object.keys(senales).sort(), ['BTC', 'ETH'])
    const btc = senales.BTC
    assert.equal(btc.precioEur, servidasEn(escenario.BTC.eur, ahora).at(-2)?.cierre, 'cierre EUR de la última vela cerrada')
    assert.equal(btc.motorExplicacion, 'plantilla')
    assert.equal(typeof btc.explicacion, 'string')
    assert.equal(typeof btc.cambio24h, 'number')
    const ejecucion = await db.prepare('SELECT * FROM ejecuciones').first()
    assert.equal(ejecucion.tipo, 'mercado')
    const detalle = JSON.parse(ejecucion.detalle_json)
    assert.deepEqual(detalle.fng, { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.equal(detalle.fallos.filter((/** @type {string} */ f) => f.startsWith('derivados')).length, 6, 'funding, long/short y OI de 2 monedas')
    await comprobarLibro(db)
  })

  test('hora a hora da exactamente lo mismo que core/hora.js con las ventanas del backtest (VENTANA = 299 velas cerradas)', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    let estado = estadoInicial(10_000)
    /** @type {Record<string, number>|null} */
    let hodl = null
    for (let k = 0; k < 8; k++) {
      const ahora = ahoraDe(k)
      const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      assert.deepEqual(r.repetidas, [])
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: v1,
      })
      estado = memoria.estado
      hodl = memoria.hodl
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, 1))
      const desdeD1 = await cargarEstado(db, sim, v1.PARAMETROS_BOT)
      assert.deepEqual(desdeD1.estado, memoria.estado, `estado en la hora ${k}`)
      assert.deepEqual(desdeD1.hodl, memoria.hodl, `HODL en la hora ${k}`)
      const capital = await db.prepare('SELECT * FROM capital WHERE vela_1h = ?').bind(velaDeDecision(ahora)).first()
      assert.equal(capital.valor_cartera, memoria.punto.valor, `capital en la hora ${k}`)
      assert.equal(capital.valor_hodl, memoria.punto.hodl)
      const decisiones = await filas(db, 'SELECT simbolo, motivo, desglose_json FROM decisiones WHERE vela_1h = ? ORDER BY id', velaDeDecision(ahora))
      assert.deepEqual(decisiones.map((d) => ({ simbolo: d.simbolo, motivo: d.motivo })), memoria.decisiones.map((d) => ({ simbolo: d.simbolo, motivo: d.motivo })))
      // La señal completa (indicadores incluidos) coincide bit a bit: misma ventana de velas que el backtest.
      assert.deepEqual(decisiones.map((d) => JSON.parse(d.desglose_json)), JSON.parse(JSON.stringify(memoria.senales)), `señales en la hora ${k}`)
    }
    const motivos = await filas(db, 'SELECT simbolo, lado, motivo FROM operaciones ORDER BY id')
    assert.deepEqual(motivos.map((o) => `${o.simbolo}:${o.lado}:${o.motivo}`), [
      'BTC:compra:senal', 'ETH:compra:senal', 'BTC:venta:stop_loss', 'ETH:venta:take_profit', 'ETH:compra:senal', 'BTC:compra:senal',
    ])
    await comprobarLibro(db)
    // El backtest real sobre las mismas series da las mismas operaciones y el mismo saldo, bit a bit.
    const bt = ejecutarBacktest({ series: escenario, fng: [{ t: 0, valor: 53 }], desde: CIERRE, hasta: ahoraDe(7), estrategia: v1 })
    const ops = await filas(db, 'SELECT * FROM operaciones ORDER BY id')
    assert.deepEqual(ops.map((o) => ({
      tipo: o.lado, simbolo: o.simbolo, vela: o.vela_1h, precio: o.precio, unidades: o.unidades, importe: o.importe,
      comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo, pnlNeto: o.pnl_neto ?? undefined,
    })), bt.operaciones.map((o) => ({
      tipo: o.tipo, simbolo: o.simbolo, vela: o.vela, precio: o.precio, unidades: o.unidades, importe: o.importe,
      comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo, pnlNeto: o.pnlNeto,
    })))
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), bt.metricas.saldo)
  })

  test('cada simulación usa su propia estrategia: una v2 decide solo al cierre diario y revisa stops cada hora', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v2', ahora: 0 })
    let estado = estadoInicial(10_000)
    /** @type {Record<string, number>|null} */
    let hodl = null
    for (let k = 0; k < 3; k++) {
      const ahora = ahoraDe(k)
      await ejecutarMercado({ vivo: vivoDePrueba(['v2']), esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasBacktest(escenario, ahora), titulares: [], fng: 53, estrategia: v2,
      })
      estado = memoria.estado
      hodl = memoria.hodl
      const sim = /** @type {import('../src/repositorio.js').FilaSimulacion} */ (await obtenerSimulacion(db, 1))
      assert.deepEqual((await cargarEstado(db, sim, v2.PARAMETROS_BOT)).estado, memoria.estado, `estado en la hora ${k}`)
    }
    const d = await filas(db, "SELECT vela_1h, motivo FROM decisiones WHERE simbolo = 'BTC' ORDER BY vela_1h")
    assert.deepEqual(d.map((x) => x.motivo), ['abierta', 'fuera_de_ventana', 'fuera_de_ventana'])
    const ops = await filas(db, "SELECT lado, motivo, estrategia_version FROM operaciones WHERE simbolo = 'BTC' ORDER BY id")
    assert.deepEqual(ops, [
      { lado: 'compra', motivo: 'senal', estrategia_version: 'v2' },
      { lado: 'venta', motivo: 'stop_loss', estrategia_version: 'v2' },
    ])
    assert.equal(JSON.parse((await db.prepare("SELECT desglose_json FROM decisiones WHERE simbolo = 'BTC'").first('desglose_json'))).version, 'v2')
  })

  test('repetir la misma hora (doble cron o reintento) no duplica nada', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    const contar = async () => Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map(
      (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'),
    ))
    const antes = [...await contar(), await db.prepare('SELECT saldo FROM simulaciones').first('saldo')]
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora + 60_000), ahora: ahora + 60_000 })
    assert.deepEqual(r.repetidas, ['BTC', 'ETH'])
    assert.deepEqual([...await contar(), await db.prepare('SELECT saldo FROM simulaciones').first('saldo')], antes)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM ejecuciones').first('n'), 2)
  })

  test('si falla el lote de una moneda, el resto entra, el libro cuadra y la moneda se recupera después', async () => {
    const base = crearD1()
    const escenario = crearEscenario()
    // D1 que rechaza el lote de ETH, como un error transitorio de D1.
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO decisiones') && s.valores[1] === 'ETH')) {
          throw new Error('D1_ERROR: simulado')
        }
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.ok(r.ejecucion.fallos.includes('bot ETH: D1_ERROR: simulado'))
    assert.deepEqual((await filas(base, "SELECT simbolo FROM posiciones WHERE estado = 'abierta'")).map((p) => p.simbolo), ['BTC'])
    assert.deepEqual((await filas(base, 'SELECT simbolo FROM progreso')).map((p) => p.simbolo), ['BTC'])
    const sim = await base.prepare('SELECT * FROM simulaciones').first()
    const btc = await base.prepare('SELECT * FROM posiciones').first()
    const capital = await base.prepare('SELECT * FROM capital').first()
    const precioBtc = servidasEn(escenario.BTC.eur, ahora).at(-2)?.cierre ?? NaN
    assert.ok(Math.abs(capital.valor_cartera - (sim.saldo + btc.unidades * precioBtc)) < 1e-9)
    await comprobarLibro(base)

    const despues = ahoraDe(1)
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(base), fetch: fetchEscenario(escenario, despues), ahora: despues })
    const eth = await filas(base, "SELECT motivo FROM decisiones WHERE simbolo = 'ETH'")
    assert.deepEqual(eth.map((d) => d.motivo), ['abierta'])
    await comprobarLibro(base)
  })

  test('una moneda sin velas: SIN_DATOS registrado, las demás siguen y el capital se guarda', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(escenario, ahora, { caidas: ['SOL-USDT', 'SOL-EUR'] })
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db, 'BTC,ETH,SOL'), fetch, ahora })
    assert.ok(r.ejecucion.fallos.includes('velas SOL-USDT 1h: HTTP 500'))
    assert.ok(r.ejecucion.fallos.includes('velas SOL-EUR 1h: HTTP 500'))
    const sol = await db.prepare("SELECT veredicto, motivo, accion FROM decisiones WHERE simbolo = 'SOL'").first()
    assert.deepEqual(sol, { veredicto: 'SIN_DATOS', motivo: 'sin_datos', accion: 'ninguna' })
    assert.equal((await filas(db, 'SELECT * FROM decisiones')).length, 3)
    const capital = await db.prepare('SELECT * FROM capital').first()
    assert.equal(capital.valor_hodl, null, 'sin precio de SOL no hay comprar y mantener todavía')
    assert.equal((await db.prepare('SELECT hodl_json FROM simulaciones').first('hodl_json')), null)
  })

  test('la contradicción técnico/derivados llega a decisiones.motivo como texto libre', async () => {
    const db = crearD1()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    // Técnico claramente alcista y funding de +0,06 % por 8 h (derivados −1): v1 manda MANTENER.
    const funding = { 'BTC-USDT-SWAP': '0.0006' }
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora, { funding }), ahora })
    const btc = await db.prepare("SELECT veredicto, motivo, accion FROM decisiones WHERE simbolo = 'BTC'").first()
    assert.deepEqual(btc, { veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados', accion: 'ninguna' })
    const eth = await db.prepare("SELECT motivo FROM decisiones WHERE simbolo = 'ETH'").first('motivo')
    assert.equal(eth, 'abierta', 'ETH no tiene funding en la respuesta: derivados ausentes')
  })

  test('presupuesto §9 con 5 monedas y la caché vacía: 38 subpeticiones externas, todas las de mercado a OKX, y 16 llamadas a D1', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(crearEscenario(), ahora)
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env, fetch, ahora })
    assert.equal(fetch.llamadas.length, 20 + 15 + 1 + 2)
    assert.equal(fetch.llamadas.filter((l) => l.url.startsWith('https://www.okx.com/')).length, 20 + 15)
    assert.ok(fetch.llamadas.every((l) => !l.url.includes('binance')), 'Binance no responde desde Cloudflare')
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('-USDT&bar=') && l.url.endsWith('&limit=300')).length, 15)
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('-EUR&bar=1H&limit=48')).length, 5)
    const okx = fetch.llamadas.map((l) => l.url).filter((u) => u.startsWith('https://www.okx.com/'))
    assert.ok(okx.slice(0, 20).every((u) => u.includes('/market/candles')), 'primero las velas (imprescindibles), luego los derivados')
    assert.ok(cuerposConsumidos(fetch), 'ningún cuerpo de respuesta queda sin leer o cancelar')
    assert.equal(db.llamadas, 16, '10 + 1 simulación × 5 monedas + 1 HODL')
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
    assert.equal(detalle.subpeticiones, 38)
    assert.deepEqual(detalle.velasBybit, [])
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM cache_velas').first('n'), 20)
  })

  test('con la caché: una hora normal pide solo 1H USDT y EUR con limit=3 (23 subpeticiones); al cerrar la 4H, también la 4H', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    const funding = Object.fromEntries(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].map((s) => [`${s}-USDT-SWAP`, '0.0001']))
    /** @param {number} k */
    const hora = async (k) => {
      const fetch = fetchEscenario(escenario, ahoraDe(k), { funding })
      const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env, fetch, ahora: ahoraDe(k) })
      assert.deepEqual(r.ejecucion.fallos.filter((f) => f.startsWith('velas')), [])
      return fetch.llamadas.map((l) => l.url)
    }
    assert.equal((await hora(0)).length, 38)
    const h1 = await hora(1)
    const velas1 = h1.filter((u) => u.includes('/market/candles'))
    assert.equal(velas1.length, 10)
    assert.ok(velas1.every((u) => u.endsWith('&bar=1H&limit=3')), velas1.join(' '))
    assert.equal(h1.filter((u) => u.includes('funding-rate')).length, 0, 'el funding sigue en la caché')
    assert.equal(h1.length, 10 + 10 + 1 + 2)
    const velas4 = (await hora(4)).filter((u) => u.includes('/market/candles'))
    assert.equal(velas4.filter((u) => u.endsWith('&bar=4H&limit=3')).length, 5)
    assert.equal(velas4.length, 15)
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones ORDER BY id DESC').first('detalle_json'))
    assert.equal(detalle.subpeticiones, 15 + 10 + 1 + 2)
  })

  test('OKX limitando las velas USDT de BTC: Bybit las sirve, BTC no queda SIN_DATOS y la fuente queda anotada (sin entrar en la caché)', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(escenario, ahora, { limitado: (url) => url.includes('candles?instId=BTC-USDT') })
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch, ahora })
    assert.deepEqual(r.senales.map((s) => s.veredicto), ['COMPRAR', 'COMPRAR'])
    const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
    assert.deepEqual(detalle.velasBybit, ['BTC-USDT 1h', 'BTC-USDT 4h', 'BTC-USDT 1d'])
    assert.ok(detalle.fallos.includes('velas BTC-USDT 1h: HTTP 429 (código 50011)'))
    const bybit = fetch.llamadas.filter((l) => l.url.startsWith('https://api.bybit.com/'))
    assert.equal(bybit.length, 3)
    assert.ok(bybit.every((l) => l.url.endsWith('&limit=300')))
    const claves = await filas(db, 'SELECT instrumento, intervalo FROM cache_velas ORDER BY instrumento, intervalo')
    assert.deepEqual(claves.map((c) => `${c.instrumento} ${c.intervalo}`), ['BTC-EUR 1h', 'ETH-EUR 1h', 'ETH-USDT 1d', 'ETH-USDT 1h', 'ETH-USDT 4h'])
    // Igual que con OKX: la misma señal que una ejecución sin límite.
    const normal = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(crearD1()), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.deepEqual(r.senales[0].componentes, normal.senales[0].componentes)
  })

  test('funding en caché: se pide como mucho cada 8 h; si entonces falla, vale el guardado (< 24 h) y se anota', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const funding = { 'BTC-USDT-SWAP': '0.0006' }
    for (let k = 0; k <= 8; k++) {
      const fetch = fetchEscenario(escenario, ahoraDe(k), { funding: k < 8 ? funding : null })
      const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch, ahora: ahoraDe(k) })
      const pedidas = fetch.llamadas.filter((l) => l.url.includes('/public/funding-rate')).map((l) => new URL(l.url).searchParams.get('instId'))
      // ETH nunca tiene funding en este escenario: se reintenta cada hora.
      assert.deepEqual(pedidas, k === 0 || k === 8 ? ['BTC-USDT-SWAP', 'ETH-USDT-SWAP'] : ['ETH-USDT-SWAP'], `hora ${k}`)
      const motivo = await db.prepare("SELECT motivo FROM decisiones WHERE simbolo = 'BTC' AND vela_1h = ?").bind(velaDeDecision(ahoraDe(k))).first('motivo')
      assert.equal(motivo, 'contradiccion_tecnico_derivados', `hora ${k}: el funding guardado sigue contando`)
      if (k === 8) assert.ok(r.ejecucion.fallos.includes('derivados funding BTC: HTTP 503'))
    }
    assert.equal(await db.prepare("SELECT actualizado_en FROM cache_funding WHERE simbolo = 'BTC'").first('actualizado_en'), ahoraDe(0))
  })

  test('si no se puede escribir la caché, la ejecución sigue ok y lo anota', async () => {
    const base = crearD1()
    const db = {
      prepare: (/** @type {string} */ sql) => base.prepare(sql),
      batch: async (/** @type {any[]} */ sentencias) => {
        if (sentencias.some((s) => s.sql.includes('INSERT INTO cache_velas'))) throw new Error('D1_ERROR: simulado')
        return base.batch(sentencias)
      },
    }
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    assert.ok(r.ejecucion.fallos.includes('caché: D1_ERROR: simulado'))
    assert.deepEqual(r.senales.map((s) => s.veredicto), ['COMPRAR', 'COMPRAR'])
  })

  test('OKX limitando (429/50011) en todo y Bybit caído: reintentos y respaldo llenan el hueco hasta 49 subpeticiones (≤ 50), SIN_DATOS y ejecución ok', async () => {
    for (const [claves, llm, reintentos, bybit] of /** @type {const} */ ([[true, 2, 6, 5], [false, 0, 7, 6]])) {
      const db = crearD1()
      const ahora = ahoraDe(0)
      const fetch = fetchEscenario(crearEscenario(), ahora, { limitado: true, bybitCaido: true })
      const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), ...(claves ? { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' } : {}) }
      const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env, fetch, ahora })
      assert.equal(r.ejecucion.ok, true)
      // 35 a OKX + reintentos + Bybit + F&G + LLM externos configurados + 1 de margen = 50.
      assert.equal(fetch.llamadas.length, 20 + 15 + reintentos + bybit + 1 + llm)
      assert.equal(fetch.llamadas.length, 49)
      assert.equal(fetch.llamadas.filter((l) => l.url.startsWith('https://api.bybit.com/')).length, bybit)
      assert.ok(r.senales.every((s) => s.veredicto === 'SIN_DATOS'))
      const detalle = JSON.parse(await db.prepare('SELECT detalle_json FROM ejecuciones').first('detalle_json'))
      assert.equal(detalle.reintentosOkx, reintentos)
      assert.equal(detalle.subpeticiones, 49)
    }
  })
})

describe('ejecutarMercado (manual: POST /api/analizar)', () => {
  test('refresca las señales sin crear simulaciones ni operar', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.equal(r.ejecucion.tipo, 'manual')
    assert.equal(r.senales.length, 2)
    for (const t of ['simulaciones', 'decisiones', 'operaciones', 'posiciones', 'capital', 'progreso']) {
      assert.equal(await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'), 0, t)
    }
    assert.deepEqual(Object.keys(await senalesActuales(db)).sort(), ['BTC', 'ETH'])
  })

  test('con una simulación activa tampoco toca su saldo, decisiones ni posiciones', async () => {
    const db = crearD1()
    const sim = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.ok(r.senales.every((s) => s.veredicto === 'COMPRAR'), 'la señal es de compra y aun así no se abre nada')
    assert.deepEqual(await obtenerSimulacion(db, sim.id), sim)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM decisiones').first('n'), 0)
    assert.equal(r.senales[0].orientativo?.stopLoss < r.senales[0].precioEur, true)
  })
})
```

Replace the whole content of `worker/test/api.test.js` with:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { velaDeDecision } from '../../core/bot.js'
import { calcularMetricas } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import {
  CURVA_MAXIMA, ESPERA_ANALIZAR_MS, TAMANO_PAGINA, atender, limitarCurva, primeraFrase, submuestrearCurva,
} from '../src/api.js'
import { BLOQUEO_MS, MAX_FALLOS_GLOBAL, REINTENTAR_EN_S, VENTANA_GLOBAL_MS, VUELO_MS, compararSeguro } from '../src/auth.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearSimulacion, guardarCapital, guardarPuntuaciones, insertarTitulares } from '../src/repositorio.js'
import { simularFetch } from './ayudantes.js'
import { Sentencia, crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from './escenario.js'
import { vivoDePrueba } from './vivo.js'

/** Una sola estrategia en vivo, v1: los tests no dependen de la lista de producción (core/estrategias.js). */
const V1 = vivoDePrueba(['v1'])

const PIN = '4815162342'
const ORIGEN = 'https://jcaboroca.github.io'

/** @param {ReturnType<typeof crearD1>} db */
const entorno = (db) => ({
  DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: `${ORIGEN},http://localhost:8080`,
})

/**
 * Llama a la API como lo haría la PWA.
 * @param {ReturnType<typeof crearD1>} db
 * @param {string} ruta
 * @param {{ metodo?: string, pin?: string|null, origen?: string, ip?: string, cuerpo?: unknown, ahora?: number,
 *   fetch?: typeof fetch, vivo?: import('../src/vivo.js').Vivo }} [op]
 */
async function pedir(db, ruta, { metodo = 'GET', pin = PIN, origen = ORIGEN, ip = '1.2.3.4', cuerpo, ahora = ahoraDe(6), fetch, vivo = V1 } = {}) {
  /** @type {Record<string, string>} */
  const cabeceras = { Origin: origen, 'CF-Connecting-IP': ip }
  if (pin !== null) cabeceras.Authorization = `Bearer ${pin}`
  const peticion = new Request(`https://oracle.workers.dev${ruta}`, {
    method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const res = await atender(peticion, {
    env: entorno(db), fetch: fetch ?? fetchEscenario(crearEscenario(), ahora), ahora, esperar: sinEspera, vivo,
  })
  const texto = await res.text()
  return { estado: res.status, cabeceras: res.headers, cuerpo: texto ? JSON.parse(texto) : null }
}

/** Base con 6 horas del escenario ejecutadas (simulación v1) y titulares de prueba. */
async function conDatos() {
  const db = crearD1()
  const escenario = crearEscenario()
  await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
  for (let k = 0; k < 6; k++) {
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
  }
  const t = ahoraDe(5)
  await insertarTitulares(db, [
    { id: 't1', fuente: 'CoinDesk', origen: 'rss', titulo: 'Bitcoin rally', url: 'https://x.test/1', publicadoEn: t - HORA },
    { id: 't2', fuente: 'r/Bitcoin', origen: 'reddit', titulo: 'Market crash', url: null, publicadoEn: t - 2 * HORA },
    { id: 't3', fuente: 'Decrypt', origen: 'rss', titulo: 'Ether news', url: null, publicadoEn: t - 3 * HORA },
  ])
  await guardarPuntuaciones(db, {
    t1: { puntuacion: 0.5, monedas: ['BTC'], motor: 'cf' },
    t2: { puntuacion: -0.5, monedas: ['MERCADO'], motor: 'lexico' },
    t3: { puntuacion: 0, monedas: ['ETH'], motor: 'groq' },
  })
  return db
}

describe('PIN, bloqueo y CORS', () => {
  test('compararSeguro: igual solo si son idénticos, sin importar la longitud', async () => {
    assert.equal(await compararSeguro(PIN, PIN), true)
    assert.equal(await compararSeguro(PIN, `${PIN}0`), false)
    assert.equal(await compararSeguro('', PIN), false)
  })

  test('sin PIN o con PIN incorrecto → 401 y los intentos que quedan; con PIN correcto → 200', async () => {
    const db = crearD1()
    const sin = await pedir(db, '/api/simulaciones', { pin: null })
    assert.equal(sin.estado, 401)
    assert.deepEqual(sin.cuerpo, { error: 'pin_incorrecto', detalle: 'PIN incorrecto. Quedan 4 intentos.' })
    const mal = await pedir(db, '/api/simulaciones', { pin: '0000' })
    assert.equal(mal.cuerpo.detalle, 'PIN incorrecto. Quedan 3 intentos.')
    const bien = await pedir(db, '/api/simulaciones')
    assert.equal(bien.estado, 200)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM intentos_pin').first('n'), 0, 'acertar borra los fallos')
  })

  test('5 fallos desde una IP → bloqueo de 15 min, incluso con el PIN correcto; otras IPs no se ven afectadas', async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    for (let i = 0; i < 4; i++) assert.equal((await pedir(db, '/api/resumen', { pin: 'x', ahora })).estado, 401)
    const quinto = await pedir(db, '/api/resumen', { pin: 'x', ahora })
    assert.equal(quinto.estado, 429)
    assert.deepEqual(quinto.cuerpo, {
      error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta: ahora + BLOQUEO_MS,
    })
    assert.equal((await pedir(db, '/api/resumen', { ahora: ahora + BLOQUEO_MS - 1 })).estado, 429)
    assert.equal((await pedir(db, '/api/resumen', { ip: '5.6.7.8', ahora })).estado, 200)
    assert.equal((await pedir(db, '/api/resumen', { ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('ráfaga en paralelo desde una IP: como mucho 5 PIN comparados; el resto, 429 sin comparar (ni el correcto)', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // 20 a la vez; la 11.ª lleva el PIN correcto: llega con 5 intentos ya en vuelo y no debe ni compararse.
    const pines = Array.from({ length: 20 }, (_, i) => (i === 10 ? PIN : `00${i}`))
    const r = await Promise.all(pines.map((pin) => pedir(db, '/api/simulaciones', { pin, ahora })))
    // Los 5 primeros reservan y se comparan a la vez: el orden en que terminan (SHA-256 asíncrono) varía.
    const comparados = r.slice(0, 5)
    assert.deepEqual(comparados.filter((x) => x.estado === 401).map((x) => x.cuerpo.detalle).sort(), [
      'PIN incorrecto. Quedan 1 intentos.', 'PIN incorrecto. Quedan 2 intentos.', 'PIN incorrecto. Quedan 3 intentos.',
      'PIN incorrecto. Quedan 4 intentos.',
    ])
    assert.equal(r.filter((x) => x.estado === 401).length, 4, '4 fallos con 401 y el 5.º ya bloquea')
    assert.deepEqual(comparados.filter((x) => x.estado === 429).map((x) => x.cuerpo), [{
      error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta: ahora + BLOQUEO_MS,
    }])
    assert.ok(r.slice(5).every((x) => x.estado === 429 && x.cuerpo.error === 'ocupado'), 'el resto, sin comparar: reintento corto')
    assert.equal(r[10].estado, 429, 'el PIN correcto llegó con la IP ya agotada')
    const fila = await db.prepare('SELECT fallos, en_vuelo FROM intentos_pin').first()
    assert.deepEqual({ ...fila }, { fallos: 5, en_vuelo: 0 }, 'solo se compararon 5 PIN')
    const despues = await pedir(db, '/api/simulaciones', { ahora: ahora + 60_000 })
    assert.equal(despues.estado, 429)
    assert.equal(despues.cuerpo.error, 'bloqueado', 'ahora sí, el bloqueo de 15 min')
    assert.equal((await pedir(db, '/api/simulaciones', { ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('6 peticiones a la vez con el PIN correcto desde una IP: 200 o reintento corto, nunca el bloqueo', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    const r = await Promise.all(Array.from({ length: 6 }, () => pedir(db, '/api/simulaciones', { ahora })))
    assert.ok(r.every((x) => x.estado === 200 || x.cuerpo.error === 'ocupado'), JSON.stringify(r.map((x) => x.cuerpo.error ?? x.estado)))
    assert.ok(r.filter((x) => x.estado === 200).length >= 5)
    const ocupado = r.find((x) => x.estado === 429)
    if (ocupado) {
      assert.deepEqual(ocupado.cuerpo, {
        error: 'ocupado', detalle: 'Hay otros intentos de PIN en curso. Vuelve a probar en unos segundos.', reintentar_en: REINTENTAR_EN_S,
      })
    }
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM intentos_pin').first('n'), 0, 'los aciertos no dejan rastro')
    const siguiente = await Promise.all(Array.from({ length: 6 }, () => pedir(db, '/api/simulaciones', { ahora: ahora + 2_000 })))
    assert.ok(siguiente.every((x) => x.estado === 200 || x.cuerpo.error === 'ocupado'))
  })

  test(`una reserva que nunca se libera (invocación caída) caduca a los ${VUELO_MS / 1000} s`, async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    await db.prepare('INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta, en_vuelo, vuelo_hasta) VALUES (?, 0, NULL, 5, ?)')
      .bind('1.2.3.4', ahora + VUELO_MS).run()
    assert.equal((await pedir(db, '/api/simulaciones', { ahora })).cuerpo.error, 'ocupado')
    assert.equal((await pedir(db, '/api/simulaciones', { ahora: ahora + VUELO_MS })).estado, 200)
  })

  test('caducado el bloqueo, la IP vuelve a tener 5 intentos', async () => {
    const db = crearD1()
    const ahora = ahoraDe(6)
    for (let i = 0; i < 5; i++) await pedir(db, '/api/resumen', { pin: 'x', ahora })
    const despues = await pedir(db, '/api/resumen', { pin: 'x', ahora: ahora + BLOQUEO_MS })
    assert.equal(despues.estado, 401)
    assert.equal(despues.cuerpo.detalle, 'PIN incorrecto. Quedan 4 intentos.')
  })

  test(`tope global: más de ${MAX_FALLOS_GLOBAL} fallos en 15 min entre todas las IPs → 429 para todos durante 15 min`, async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // Una IP distinta por intento (rotación de IPs contra un PIN de 4 cifras), todos a la vez.
    const r = await Promise.all(Array.from({ length: 60 }, (_, i) => pedir(db, '/api/simulaciones', { pin: 'x', ip: `10.0.0.${i}`, ahora })))
    assert.equal(await db.prepare('SELECT fallos FROM pin_global').first('fallos'), MAX_FALLOS_GLOBAL, `solo ${MAX_FALLOS_GLOBAL} se comparan`)
    const comparados = r.filter((x) => x.estado === 401 || x.cuerpo.error === 'bloqueado')
    assert.equal(comparados.length, MAX_FALLOS_GLOBAL)
    assert.ok(comparados.filter((x) => x.estado === 429).every((x) => x.cuerpo.hasta === ahora + BLOQUEO_MS && /en total/.test(x.cuerpo.detalle)))
    const resto = r.filter((x) => x.cuerpo.error === 'ocupado')
    assert.equal(resto.length, 60 - MAX_FALLOS_GLOBAL, 'los que llegaron con 50 en vuelo: reintento corto, sin comparar')
    const dueno = await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora: ahora + 60_000 })
    assert.equal(dueno.estado, 429, 'ni con el PIN correcto desde otra IP')
    assert.match(dueno.cuerpo.detalle, /en total/)
    assert.equal((await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora: ahora + BLOQUEO_MS })).estado, 200)
  })

  test('el tope global solo cuenta fallos: aciertos y peticiones de una IP ya bloqueada no lo consumen', async () => {
    const db = crearD1({ latencia: true })
    const ahora = ahoraDe(6)
    // 16 rondas de 5 peticiones a la vez (lo que hace la PWA al abrirse): 80 aciertos en la misma ventana.
    for (let ronda = 0; ronda < 16; ronda++) {
      const aciertos = await Promise.all(Array.from({ length: 5 }, () => pedir(db, '/api/simulaciones', { ahora })))
      assert.ok(aciertos.every((x) => x.estado === 200))
    }
    // Una sola IP insistiendo: se bloquea ella, no el resto.
    const ip = await Promise.all(Array.from({ length: 80 }, () => pedir(db, '/api/simulaciones', { pin: 'x', ip: '6.6.6.6', ahora })))
    assert.equal(ip.filter((x) => x.estado === 401).length, 4)
    assert.equal((await pedir(db, '/api/simulaciones', { ip: '9.9.9.9', ahora })).estado, 200)
    const fallosGlobales = await db.prepare('SELECT fallos FROM pin_global').first('fallos')
    assert.equal(fallosGlobales, 5, 'los 5 PIN comparados de esa IP')
    assert.equal(VENTANA_GLOBAL_MS, 15 * 60_000)
  })

  test('sin el secret ORACLE_PIN nadie entra', async () => {
    const db = crearD1()
    const res = await atender(new Request('https://o.dev/api/resumen', { headers: { Authorization: 'Bearer ' } }), {
      env: { DB: db }, fetch: simularFetch(() => ({})), ahora: 0,
    })
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' })
  })

  test('CORS solo para los orígenes de ORIGENES; OPTIONS responde 204 sin PIN', async () => {
    const db = crearD1()
    const permitido = await pedir(db, '/api/simulaciones', { origen: 'http://localhost:8080' })
    assert.equal(permitido.cabeceras.get('Access-Control-Allow-Origin'), 'http://localhost:8080')
    const ajeno = await pedir(db, '/api/simulaciones', { origen: 'https://evil.example' })
    assert.equal(ajeno.cabeceras.get('Access-Control-Allow-Origin'), null)
    const previa = await pedir(db, '/api/bot', { metodo: 'OPTIONS', pin: null })
    assert.equal(previa.estado, 204)
    assert.equal(previa.cabeceras.get('Access-Control-Allow-Headers'), 'Authorization, Content-Type')
    assert.equal(permitido.cabeceras.get('Cache-Control'), 'no-store')
  })

  test('ruta inexistente → 404; método equivocado → 405; ambos en JSON', async () => {
    const db = crearD1()
    const inexistente = await pedir(db, '/api/ordenes')
    assert.equal(inexistente.estado, 404)
    assert.deepEqual(inexistente.cuerpo, { error: 'no_encontrado', detalle: 'No existe /api/ordenes' })
    const r = await pedir(db, '/api/analizar')
    assert.equal(r.estado, 405)
    assert.equal(r.cuerpo.error, 'metodo_no_permitido')
  })
})

describe('GET /api/salud (pública)', () => {
  test('503 sin ejecuciones; 200 con una de mercado correcta de hace ≤ 2 h; 503 si es más vieja', async () => {
    const db = crearD1()
    assert.deepEqual((await pedir(db, '/api/salud', { pin: null })).cuerpo, { ok: false, ultimaEjecucion: null })
    const ahora = ahoraDe(0)
    await ejecutarMercado({ vivo: V1, esperar: sinEspera, env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
    const r = await pedir(db, '/api/salud', { pin: null, ahora: ahora + HORA })
    assert.equal(r.estado, 200)
    assert.equal(r.cuerpo.ok, true)
    assert.deepEqual(Object.keys(r.cuerpo.ultimaEjecucion), ['id', 'tipo', 'inicio', 'fin', 'ok', 'fallos'])
    assert.equal(r.cuerpo.ultimaEjecucion.tipo, 'mercado')
    assert.equal((await pedir(db, '/api/salud', { pin: null, ahora: ahora + 3 * HORA })).estado, 503)
  })
})

describe('rutas con PIN', () => {
  test('GET /api/resumen: señales en el orden de MONEDAS, F&G, bot y frescura', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 60_000 })
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), [
      'ahora', 'estrategiaPrincipal', 'senales', 'fng', 'bot', 'ultimaEjecucion', 'ultimaNoticias', 'datosDesactualizados',
    ])
    assert.deepEqual(r.cuerpo.estrategiaPrincipal, { version: 'v1', etiqueta: 'v1', enVivo: 1 })
    assert.deepEqual(r.cuerpo.senales.map((/** @type {any} */ s) => s.simbolo), ['BTC', 'ETH'])
    assert.deepEqual(Object.keys(r.cuerpo.senales[0]), [
      'simbolo', 'veredicto', 'indiceConfianza', 'puntuacion', 'precioEur', 'cambio24h', 'fresca', 'calculadaEn', 'vela1h',
      'frase', 'motorExplicacion', 'estrategiaVersion',
    ])
    assert.match(r.cuerpo.senales[0].frase, /^Señal de compra en BTC/)
    assert.deepEqual(r.cuerpo.fng, { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.deepEqual(Object.keys(r.cuerpo.bot), [
      'simulacionId', 'estrategiaVersion', 'capitalInicial', 'saldo', 'valorCartera', 'valorHodl', 'rentabilidad',
      'rentabilidadHodl', 'posicionesAbiertas', 'actualizadoEn',
    ])
    assert.equal(r.cuerpo.bot.posicionesAbiertas, 2)
    assert.equal(r.cuerpo.bot.actualizadoEn, velaDeDecision(ahoraDe(5)))
    assert.equal(r.cuerpo.ultimaEjecucion.tipo, 'mercado')
    assert.equal(r.cuerpo.ultimaNoticias, null)
    assert.equal(r.cuerpo.datosDesactualizados, false)
    const tarde = await pedir(db, '/api/resumen', { ahora: ahoraDe(5) + 3 * HORA })
    assert.equal(tarde.cuerpo.datosDesactualizados, true)
  })

  test('GET /api/moneda/:sym: señal completa, titulares de la moneda o del mercado y últimas decisiones', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/moneda/btc')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['simbolo', 'senal', 'titulares', 'decisiones'])
    assert.equal(r.cuerpo.simbolo, 'BTC')
    const s = r.cuerpo.senal
    for (const k of ['version', 'veredicto', 'componentes', 'ausentes', 'detalle', 'precioEur', 'cambio24h', 'explicacion', 'motorExplicacion', 'orientativo']) {
      assert.ok(k in s, k)
    }
    assert.deepEqual(r.cuerpo.titulares.map((/** @type {any} */ t) => t.id), ['t1', 't2'])
    assert.deepEqual(r.cuerpo.titulares[0], {
      id: 't1', fuente: 'CoinDesk', origen: 'rss', titulo: 'Bitcoin rally', url: 'https://x.test/1', publicadoEn: ahoraDe(5) - HORA,
      monedas: ['BTC'], puntuacion: 0.5, motor: 'cf', usado: false,
    })
    assert.equal(r.cuerpo.decisiones.length, 6)
    assert.deepEqual(Object.keys(r.cuerpo.decisiones[0]), [
      'id', 'simbolo', 'vela1h', 'veredicto', 'indiceConfianza', 'puntuacion', 'accion', 'motivo', 'precio', 'estrategiaVersion', 'creadaEn',
    ])
    assert.equal(r.cuerpo.decisiones[0].vela1h, velaDeDecision(ahoraDe(5)), 'la más reciente primero')
    assert.equal((await pedir(db, '/api/moneda/DOGE')).estado, 404)
  })

  test('GET /api/bot: métricas, posiciones con precio actual, curva y HODL', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/bot')
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['simulacion', 'metricas', 'porMoneda', 'abiertas', 'curva', 'hodl'])
    assert.deepEqual(r.cuerpo.simulacion, {
      id: 1, creadaEn: 0, cerradaEn: null, activa: true, estrategiaVersion: 'v1', etiqueta: 'v1', principal: true, capitalInicial: 10_000,
      saldo: r.cuerpo.simulacion.saldo,
    })
    const m = r.cuerpo.metricas
    assert.equal(m.operaciones, 6)
    assert.equal(m.cerradas, 2)
    assert.equal(m.ganadoras + m.perdedoras, 2)
    assert.ok(Math.abs(m.valorCartera - r.cuerpo.curva.at(-1).valor) < 1e-9, 'valor = último punto de capital')
    assert.deepEqual(Object.keys(r.cuerpo.porMoneda).sort(), ['BTC', 'ETH'])
    assert.deepEqual(r.cuerpo.abiertas.map((/** @type {any} */ p) => p.simbolo), ['ETH', 'BTC'])
    assert.deepEqual(Object.keys(r.cuerpo.abiertas[0]), [
      'id', 'simbolo', 'velaEntrada', 'precioEntrada', 'unidades', 'coste', 'stopLoss', 'takeProfit', 'precioActual',
      'valorActual', 'pnlNoRealizado', 'pnlNoRealizadoPct',
    ])
    assert.equal(r.cuerpo.curva.length, 6)
    assert.deepEqual(Object.keys(r.cuerpo.curva[0]), ['t', 'valor', 'saldo', 'hodl'])
    assert.deepEqual(Object.keys(r.cuerpo.hodl), ['BTC', 'ETH'])
    assert.equal((await pedir(db, '/api/bot?simulacion=99')).estado, 404)
    assert.deepEqual((await pedir(db, '/api/bot?simulacion=abc')).cuerpo, {
      error: 'peticion_invalida', detalle: 'simulacion debe ser un entero positivo',
    })
  })

  test('paginación de decisiones y operaciones por id descendente, con filtro de símbolo', async () => {
    const db = await conDatos()
    const insertar = db.prepare(
      `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
       VALUES (1, 'XRP', ?, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`,
    )
    for (let i = 0; i < 55; i++) await insertar.bind(i * HORA).run()
    const p1 = await pedir(db, '/api/bot/decisiones?simbolo=XRP')
    assert.equal(p1.cuerpo.items.length, TAMANO_PAGINA)
    assert.equal(p1.cuerpo.siguienteCursor, p1.cuerpo.items.at(-1).id)
    const p2 = await pedir(db, `/api/bot/decisiones?simbolo=XRP&cursor=${p1.cuerpo.siguienteCursor}`)
    assert.equal(p2.cuerpo.items.length, 5)
    assert.equal(p2.cuerpo.siguienteCursor, null)
    const todas = await pedir(db, '/api/bot/decisiones')
    assert.ok(todas.cuerpo.items.every((/** @type {any} */ d, /** @type {number} */ i, /** @type {any[]} */ a) => i === 0 || a[i - 1].id > d.id))
    const ops = await pedir(db, '/api/bot/operaciones?simbolo=BTC')
    assert.deepEqual(ops.cuerpo.items.map((/** @type {any} */ o) => `${o.lado}:${o.motivo}`), ['compra:senal', 'venta:stop_loss', 'compra:senal'])
    assert.deepEqual(Object.keys(ops.cuerpo.items[0]), [
      'id', 'posicionId', 'simbolo', 'lado', 'vela1h', 'precio', 'unidades', 'importe', 'comision', 'deslizamiento', 'motivo',
      'saldoTras', 'pnlNeto', 'estrategiaVersion', 'creadaEn',
    ])
    assert.equal(ops.cuerpo.items[1].pnlNeto < 0, true, 'el stop-loss cierra con pérdida')
    assert.equal((await pedir(db, '/api/bot/operaciones?simbolo=b%27')).estado, 400)
  })

  test('POST /api/bot/reiniciar exige confirmar y un capital válido; cierra la activa y abre otra por estrategia en vivo', async () => {
    const db = await conDatos()
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000 } })).estado, 400)
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 50, confirmar: true } })).estado, 400)
    const r = await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000, confirmar: true }, ahora: 777 })
    assert.equal(r.estado, 201)
    const nueva = { id: 2, creadaEn: 777, cerradaEn: null, activa: true, estrategiaVersion: 'v1', etiqueta: 'v1', principal: true, capitalInicial: 5000, saldo: 5000 }
    assert.deepEqual(r.cuerpo, { simulacion: nueva, simulaciones: [nueva] })
    const lista = await pedir(db, '/api/simulaciones')
    assert.deepEqual(lista.cuerpo.items.map((/** @type {any} */ s) => [s.id, s.activa, s.cerradaEn]), [[2, true, null], [1, false, 777]])
    assert.equal((await pedir(db, '/api/bot?simulacion=1')).cuerpo.metricas.operaciones, 6, 'la cerrada conserva su historia')
  })

  test('POST /api/analizar refresca las señales sin operar; 429 si no han pasado 5 minutos', async () => {
    const db = await conDatos()
    const contar = () => db.prepare('SELECT (SELECT COUNT(*) FROM decisiones) + (SELECT COUNT(*) FROM operaciones) AS n').first('n')
    const antes = await contar()
    const ahora = ahoraDe(5) + 20 * 60_000
    const r = await pedir(db, '/api/analizar', { metodo: 'POST', ahora })
    assert.equal(r.estado, 200)
    assert.deepEqual(Object.keys(r.cuerpo), ['senales', 'ejecucion'])
    assert.equal(r.cuerpo.ejecucion.tipo, 'manual')
    assert.equal(r.cuerpo.senales.length, 2)
    assert.equal(await contar(), antes)
    const pronto = await pedir(db, '/api/analizar', { metodo: 'POST', ahora: ahora + 60_000 })
    assert.equal(pronto.estado, 429)
    assert.deepEqual(pronto.cuerpo, {
      error: 'demasiado_pronto', detalle: 'Solo se puede analizar una vez cada 5 minutos.', hasta: ahora + ESPERA_ANALIZAR_MS,
    })
    assert.equal((await pedir(db, '/api/analizar', { metodo: 'POST', ahora: ahora + ESPERA_ANALIZAR_MS })).estado, 200)
  })

  test('POST /api/analizar en paralelo: solo uno analiza; el resto, 429 sin descargar nada', async () => {
    const db = await conDatos()
    db.latencia = true
    const ahora = ahoraDe(5) + 20 * 60_000
    const fetch = fetchEscenario(crearEscenario(), ahora)
    const respuestas = await Promise.all(Array.from({ length: 5 }, () => pedir(db, '/api/analizar', { metodo: 'POST', ahora, fetch })))
    assert.deepEqual(respuestas.map((r) => r.estado).sort(), [200, 429, 429, 429, 429])
    for (const r of respuestas.filter((x) => x.estado === 429)) assert.equal(r.cuerpo.hasta, ahora + ESPERA_ANALIZAR_MS)
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM ejecuciones WHERE tipo = 'manual'").first('n'), 1)
    // Las velas ya están al día en la caché (conDatos); el long/short se pide en cada análisis, una vez por moneda.
    assert.equal(fetch.llamadas.filter((l) => l.url.includes('long-short')).length, 2, 'un solo análisis descargó datos')
  })
})

/**
 * Ejecuta `fn` anotando cada sentencia SQL que llega al D1 simulado y cuántas filas devuelve.
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<{ sql: string, valores: any[], filas: number }[]>}
 */
async function espiarSql(fn) {
  const original = Sentencia.prototype.ejecutar
  /** @type {{ sql: string, valores: any[], filas: number }[]} */
  const vistas = []
  Sentencia.prototype.ejecutar = function () {
    const r = original.call(this)
    vistas.push({ sql: this.sql, valores: this.valores, filas: r.results.length })
    return r
  }
  try {
    await fn()
  } finally {
    Sentencia.prototype.ejecutar = original
  }
  return vistas
}

describe('lecturas de D1 acotadas', () => {
  test('ninguna ruta recorre una tabla entera ni ordena con un B-tree temporal (EXPLAIN QUERY PLAN)', async () => {
    const db = await conDatos()
    const ahora = ahoraDe(5) + 20 * 60_000
    const vistas = await espiarSql(async () => {
      for (const ruta of [
        '/api/salud', '/api/resumen', '/api/moneda/BTC', '/api/bot', '/api/bot?simulacion=1', '/api/bot/operaciones',
        '/api/bot/operaciones?simbolo=BTC', '/api/bot/operaciones?cursor=3', '/api/bot/decisiones',
        '/api/bot/decisiones?simbolo=ETH&cursor=9', '/api/simulaciones', '/api/bot/comparativa',
      ]) assert.equal((await pedir(db, ruta, { ahora })).estado, 200, ruta)
      assert.equal((await pedir(db, '/api/analizar', { metodo: 'POST', ahora })).estado, 200)
      assert.equal((await pedir(db, '/api/resumen', { pin: 'x', ahora })).estado, 401)
    })
    // Tablas pequeñas por diseño: una fila por simulación o por moneda seguida.
    const pequenas = new Set(['simulaciones', 'senales_actuales'])
    /** @type {string[]} */
    const problemas = []
    for (const { sql, valores } of vistas) {
      const plan = db.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...valores).map((f) => String(f.detail))
      // Recorrer una CTE (p. ej. la lista de días de la curva) o una fila constante no lee ninguna tabla.
      const ctes = new Set(['CONSTANT', ...[...sql.matchAll(/(\w+)(?:\(\w+\))?\s+AS\s+\(/g)].map((m) => m[1])])
      for (const paso of plan) {
        const scan = /^SCAN (\w+)/.exec(paso)
        if (/TEMP B-TREE/.test(paso) || (scan && !pequenas.has(scan[1]) && !ctes.has(scan[1]))) {
          problemas.push(`${paso} ← ${sql.replace(/\s+/g, ' ').slice(0, 120)}`)
        }
      }
    }
    assert.deepEqual(problemas, [])
  })

  test('GET /api/bot con meses de historia: filas leídas acotadas y métricas idénticas a las de la curva completa', async () => {
    const db = await conDatos()
    // 100 días más de puntos horarios (un paseo determinista), HODL incluido.
    const ultima = await db.prepare('SELECT MAX(vela_1h) AS t FROM capital').first('t')
    /** @type {{ t: number, valor: number, saldo: number, hodl: number|null }[]} */
    const extra = []
    let valor = 10_000
    for (let i = 1; i <= 100 * 24; i++) {
      valor *= 1 + Math.sin(i * 1.7) * 0.01
      extra.push({ t: ultima + i * HORA, valor, saldo: valor / 2, hodl: valor * 0.9 })
    }
    for (const p of extra) {
      await guardarCapital(db, { simulacionId: 1, vela: p.t, valorCartera: p.valor, saldo: p.saldo, valorHodl: p.hodl })
    }
    const curvaCompleta = (await db.prepare('SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital ORDER BY vela_1h').all())
      .results.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
    /** @type {any} */
    let r
    const vistas = await espiarSql(async () => { r = await pedir(db, '/api/bot') })
    assert.equal(r.estado, 200)
    const filasLeidas = vistas.reduce((s, v) => s + v.filas, 0)
    assert.ok(filasLeidas < 30 * 24 + 100 + 50, `${filasLeidas} filas devueltas por D1 para ${curvaCompleta.length} puntos de capital`)
    assert.deepEqual(r.cuerpo.curva, submuestrearCurva(curvaCompleta), 'misma curva que antes: horaria 30 días y diaria antes')
    // Métricas: las de la curva completa, bit a bit (la PWA no nota la diferencia).
    const sim = await db.prepare('SELECT * FROM simulaciones WHERE id = 1').first()
    const ops = (await db.prepare('SELECT lado, simbolo, comision, deslizamiento, pnl_neto FROM operaciones ORDER BY id').all()).results
    const esperadas = calcularMetricas({
      capitalInicial: sim.capital_inicial, saldo: sim.saldo,
      abiertas: r.cuerpo.abiertas.map((/** @type {any} */ p) => ({ unidades: p.unidades, coste: p.coste, precioActual: p.precioActual })),
      operaciones: ops.map((o) => ({ tipo: o.lado, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnl_neto ?? undefined })),
      curva: curvaCompleta,
    })
    assert.deepEqual(r.cuerpo.metricas, JSON.parse(JSON.stringify(esperadas)))
    assert.ok(r.cuerpo.metricas.drawdownMaximo > 0)
  })

  test('GET /api/bot: precio actual de cada posición = precio de su última decisión con precio', async () => {
    const db = await conDatos()
    const r = await pedir(db, '/api/bot')
    for (const p of r.cuerpo.abiertas) {
      const precio = await db.prepare(
        'SELECT precio FROM decisiones WHERE simbolo = ? AND precio IS NOT NULL ORDER BY vela_1h DESC LIMIT 1',
      ).bind(p.simbolo).first('precio')
      assert.equal(p.precioActual, precio, p.simbolo)
    }
  })
})

describe('utilidades de la API', () => {
  test('primeraFrase corta en el primer . ! ? seguido de espacio, sin partir decimales', () => {
    assert.equal(primeraFrase('Sube 1.5 puntos. Luego baja.'), 'Sube 1.5 puntos.')
    assert.equal(primeraFrase('Sin punto final'), 'Sin punto final')
    assert.equal(primeraFrase(''), '')
  })

  test('submuestrearCurva: horaria los últimos 30 días y diaria antes', () => {
    const dia = 24 * HORA
    const puntos = Array.from({ length: 40 * 24 }, (_, i) => ({ t: i * HORA, valor: i, saldo: i, hodl: null }))
    const r = submuestrearCurva(puntos)
    const corte = puntos.at(-1)?.t - 30 * dia
    assert.equal(r.filter((p) => p.t >= corte).length, puntos.filter((p) => p.t >= corte).length)
    const antiguos = r.filter((p) => p.t < corte)
    assert.ok(antiguos.every((p) => (p.t + HORA) % dia === 0), 'último punto de cada día')
    assert.equal(antiguos.length, 9)
    assert.deepEqual(submuestrearCurva([]), [])
  })

  test('limitarCurva: con más de 2000 puntos deja como mucho CURVA_MAXIMA, con el primero y el último', () => {
    const puntos = (/** @type {number} */ n) => Array.from({ length: n }, (_, i) => ({ t: i * HORA, valor: i, saldo: i, hodl: null }))
    assert.equal(CURVA_MAXIMA, 1000)
    const corta = puntos(2000)
    assert.equal(limitarCurva(corta), corta, 'hasta 2000 puntos no se toca')
    for (const n of [2001, 2500, 35_000]) {
      const r = limitarCurva(puntos(n))
      assert.ok(r.length <= CURVA_MAXIMA && r.length >= CURVA_MAXIMA - 1, `${n} → ${r.length}`)
      assert.equal(r[0].t, 0)
      assert.equal(r.at(-1)?.t, (n - 1) * HORA)
      assert.ok(r.every((p, i) => i === 0 || p.t > r[i - 1].t), 'orden creciente y sin repetidos')
    }
  })
})
```

Replace the whole content of `worker/test/repositorio.test.js` with:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import { ejecutarHora } from '../../core/hora.js'
import { resumirCurva } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import {
  cargarEstado, crearSimulacion, guardarCapital, guardarHodl, guardarPasoMoneda, listarSimulaciones,
  obtenerSimulacion, simulacionActiva,
} from '../src/repositorio.js'
import { crearD1 } from './d1.js'
import { CIERRE, ahoraDe, crearEscenario, entradasEn } from './escenario.js'

/** @param {ReturnType<typeof crearD1>} db */
const nuevaSimulacion = (db) => crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 1 })

/**
 * Ejecuta las horas 0..n−1 del escenario en memoria y persiste cada una como lo hará el Worker.
 * Devuelve el estado en memoria y el reconstruido desde D1 tras cada hora.
 * @param {ReturnType<typeof crearD1>} db
 * @param {number} n
 */
async function recorrer(db, n) {
  const escenario = crearEscenario()
  let sim = await nuevaSimulacion(db)
  let estado = estadoInicial(10_000)
  /** @type {Record<string, number>|null} */
  let hodl = null
  const horas = []
  for (let k = 0; k < n; k++) {
    const ahora = ahoraDe(k)
    const r = ejecutarHora({
      estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasEn(escenario, ahora), titulares: [], fng: null, estrategia: v1,
    })
    if (hodl === null && r.hodl) await guardarHodl(db, sim.id, r.hodl)
    for (let i = 0; i < r.decisiones.length; i++) {
      const decision = r.decisiones[i]
      await guardarPasoMoneda(db, {
        simulacionId: sim.id, version: 'v1', decision, senal: r.senales[i],
        eventos: r.eventos.filter((e) => e.simbolo === decision.simbolo),
        ultimaRevisada: r.estado.ultimaRevisada[decision.simbolo], ahora,
      })
    }
    estado = r.estado
    hodl = r.hodl
    sim = /** @type {NonNullable<typeof sim>} */ (await obtenerSimulacion(db, sim.id))
    horas.push({ r, desdeD1: await cargarEstado(db, sim, v1.PARAMETROS_BOT) })
  }
  return { sim, horas }
}

/** @param {ReturnType<typeof crearD1>} db @param {string} sql @param {...any} valores */
const filas = async (db, sql, ...valores) => (await db.prepare(sql).bind(...valores).all()).results

describe('simulaciones', () => {
  test('crear cierra la activa anterior de su estrategia (sin borrar nada) y abre otra con su versión y capital', async () => {
    const db = crearD1()
    const a = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 100 })
    assert.equal(a.activa, 1)
    assert.equal(a.saldo, 10_000)
    assert.equal(a.hodl_json, null)
    const b = await crearSimulacion(db, { capitalInicial: 5_000, version: 'v1', ahora: 200 })
    assert.deepEqual(await simulacionActiva(db, 'v1'), b)
    assert.equal(await simulacionActiva(db, 'v2'), null)
    assert.deepEqual(await obtenerSimulacion(db, a.id), { ...a, activa: 0, cerrada_en: 200 })
    assert.deepEqual((await listarSimulaciones(db)).map((s) => s.id), [b.id, a.id])
    assert.equal(await obtenerSimulacion(db, 99), null)
  })

  test('el HODL se guarda solo la primera vez', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    await guardarHodl(db, sim.id, { BTC: 1 })
    await guardarHodl(db, sim.id, { BTC: 2 })
    assert.equal((await obtenerSimulacion(db, sim.id))?.hodl_json, '{"BTC":1}')
  })
})

describe('estado del bot ↔ D1', () => {
  test('simulación nueva: mismo estado que estadoInicial y sin HODL; sin progreso = nunca revisada', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    assert.deepEqual(await cargarEstado(db, sim, v1.PARAMETROS_BOT), { estado: estadoInicial(10_000), hodl: null })
  })

  test('tras cada hora del escenario, el estado reconstruido desde D1 es idéntico al de memoria', async () => {
    const db = crearD1()
    const { horas } = await recorrer(db, 8)
    for (const [k, { r, desdeD1 }] of horas.entries()) {
      assert.deepEqual(desdeD1.estado, r.estado, `hora ${k}`)
      assert.deepEqual(desdeD1.hodl, r.hodl, `hora ${k}`)
      // valorCartera suma en el orden de las claves: el orden de apertura también debe coincidir
      assert.deepEqual(Object.keys(desdeD1.estado.posiciones), Object.keys(r.estado.posiciones), `orden en la hora ${k}`)
    }
    const motivos = horas.flatMap(({ r }) => r.eventos.map((e) => `${e.simbolo}:${e.tipo}:${e.motivo}`))
    assert.deepEqual(motivos, [
      'BTC:compra:senal', 'ETH:compra:senal', 'BTC:venta:stop_loss', 'ETH:venta:take_profit',
      'ETH:compra:senal', 'BTC:compra:senal',
    ])
    assert.deepEqual(horas[7].desdeD1.estado.enfriamientoHasta, { BTC: CIERRE + 4 * HORA }, 'solo el stop-loss enfría')
  })

  test('decisiones: una por moneda y hora, con desglose y motivos del bot', async () => {
    const db = crearD1()
    await recorrer(db, 6)
    const d = await filas(db, "SELECT vela_1h, motivo, accion, precio, desglose_json FROM decisiones WHERE simbolo = 'BTC' ORDER BY vela_1h")
    assert.deepEqual(d.map((x) => x.motivo), ['abierta', 'cerrada_por_stop', 'enfriamiento', 'enfriamiento', 'enfriamiento', 'abierta'])
    assert.deepEqual(d.map((x) => x.vela_1h), [0, 1, 2, 3, 4, 5].map((k) => CIERRE + (k - 1) * HORA))
    assert.equal(JSON.parse(d[0].desglose_json).veredicto, 'COMPRAR')
    assert.ok(d.every((x) => typeof x.precio === 'number'))
  })

  test('operaciones y posiciones: coste, pnl_neto en ventas y saldo_tras igual al saldo real', async () => {
    const db = crearD1()
    const { sim, horas } = await recorrer(db, 8)
    const ops = await filas(db, 'SELECT * FROM operaciones ORDER BY id')
    assert.ok(ops.filter((o) => o.lado === 'compra').every((o) => o.pnl_neto === null))
    const ventas = ops.filter((o) => o.lado === 'venta')
    assert.deepEqual(ventas.map((o) => o.motivo), ['stop_loss', 'take_profit'])
    const eventosVenta = horas.flatMap(({ r }) => r.eventos.filter((e) => e.tipo === 'venta'))
    assert.deepEqual(ventas.map((o) => o.pnl_neto), eventosVenta.map((e) => e.pnlNeto))
    assert.deepEqual(ops.map((o) => o.saldo_tras), horas.flatMap(({ r }) => r.eventos.map((e) => e.saldoTras)))
    const cerradas = await filas(db, "SELECT * FROM posiciones WHERE estado = 'cerrada' ORDER BY id")
    assert.deepEqual(cerradas.map((p) => p.motivo_salida), ['stop_loss', 'take_profit'])
    assert.deepEqual(cerradas.map((p) => p.pnl_neto), eventosVenta.map((e) => e.pnlNeto))
    assert.deepEqual(cerradas.map((p) => p.coste), eventosVenta.map((e) => e.posicion.coste))
    const libro = ops.reduce((s, o) => (o.lado === 'compra' ? s - o.importe : s + o.importe - o.comision), 10_000)
    assert.ok(Math.abs(libro - sim.saldo) < 1e-9)
  })
})

describe('atomicidad e idempotencia', () => {
  /** Primera hora del escenario lista para persistir. */
  async function primeraHora() {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    const ahora = ahoraDe(0)
    const r = ejecutarHora({
      estado: estadoInicial(10_000), hodl: null, capitalInicial: 10_000, ahora,
      monedas: entradasEn(crearEscenario(), ahora), titulares: [], fng: null, estrategia: v1,
    })
    /** @param {number} i */
    const paso = (i) => ({
      simulacionId: sim.id, version: 'v1', decision: r.decisiones[i], senal: r.senales[i],
      eventos: r.eventos.filter((e) => e.simbolo === r.decisiones[i].simbolo),
      ultimaRevisada: r.estado.ultimaRevisada[r.decisiones[i].simbolo], ahora,
    })
    return { db, sim, paso }
  }

  /** @param {ReturnType<typeof crearD1>} db */
  const recuento = async (db) => ({
    saldo: await db.prepare('SELECT saldo FROM simulaciones').first('saldo'),
    decisiones: await db.prepare('SELECT COUNT(*) AS n FROM decisiones').first('n'),
    operaciones: await db.prepare('SELECT COUNT(*) AS n FROM operaciones').first('n'),
    posiciones: await db.prepare('SELECT COUNT(*) AS n FROM posiciones').first('n'),
    progreso: await db.prepare('SELECT COUNT(*) AS n FROM progreso').first('n'),
  })

  test('repetir el lote de una moneda en la misma vela no cambia nada (UNIQUE de la decisión)', async () => {
    const { db, paso } = await primeraHora()
    await guardarPasoMoneda(db, paso(0))
    const antes = await recuento(db)
    assert.equal(antes.operaciones, 1)
    await assert.rejects(guardarPasoMoneda(db, paso(0)), /UNIQUE constraint failed: decisiones/)
    assert.deepEqual(await recuento(db), antes)
  })

  test('una compra que no cabe en el saldo real revierte el lote entero (CHECK saldo >= 0)', async () => {
    const { db, paso } = await primeraHora()
    await db.prepare('UPDATE simulaciones SET saldo = 5').run()
    await assert.rejects(guardarPasoMoneda(db, paso(0)), /CHECK constraint failed/)
    assert.deepEqual(await recuento(db), { saldo: 5, decisiones: 0, operaciones: 0, posiciones: 0, progreso: 0 })
  })

  test('una venta sin posición abierta en D1 revierte el lote (posicion_id NOT NULL)', async () => {
    const { db, paso } = await primeraHora()
    const p = paso(0)
    const compra = p.eventos[0]
    const venta = { ...compra, tipo: /** @type {const} */ ('venta'), pnlNeto: 0 }
    await assert.rejects(guardarPasoMoneda(db, { ...p, eventos: [venta] }), /NOT NULL constraint failed: operaciones.posicion_id/)
    assert.equal((await recuento(db)).decisiones, 0)
  })

  test('un evento de otra moneda en el lote es un error de programación', async () => {
    const { db, paso } = await primeraHora()
    const p = paso(0)
    await assert.rejects(guardarPasoMoneda(db, { ...p, eventos: paso(1).eventos }), RangeError)
  })

  test('capital: un punto por vela; el segundo intento se ignora', async () => {
    const { db, sim } = await primeraHora()
    await guardarCapital(db, { simulacionId: sim.id, vela: CIERRE, valorCartera: 10_000, saldo: 10_000, valorHodl: null })
    await guardarCapital(db, { simulacionId: sim.id, vela: CIERRE, valorCartera: 1, saldo: 1, valorHodl: 1 })
    assert.deepEqual(await filas(db, 'SELECT simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl FROM capital'), [
      { simulacion_id: sim.id, vela_1h: CIERRE, valor_cartera: 10_000, saldo: 10_000, valor_hodl: null },
    ])
  })

  test('capital: cada punto guarda el resumen de la curva hasta él, idéntico a core/metricas.js (bit a bit)', async () => {
    const db = crearD1()
    const sim = await nuevaSimulacion(db)
    // Enteros incluidos (10.000, 12.000, 9.000): la división no puede ser entera.
    const valores = [10_000, 12_000, 9_000, 9_500.123, 13_000, 12_999.5, 7_000.25, 7_100, 13_500, 1_000.75]
    const hodls = [null, null, 10_000, 9_000, null, 11_000.5, 8_000, 8_000, 12_000, 5_000.125]
    /** @type {{ t: number, valor: number, hodl: number|null }[]} */
    const curva = []
    for (let k = 0; k < valores.length; k++) {
      const p = { t: CIERRE + k * HORA, valor: valores[k], hodl: hodls[k] }
      curva.push(p)
      await guardarCapital(db, { simulacionId: sim.id, vela: p.t, valorCartera: p.valor, saldo: 1, valorHodl: p.hodl })
      const fila = await db.prepare('SELECT drawdown, drawdown_hodl, ultimo_hodl FROM capital WHERE vela_1h = ?').bind(p.t).first()
      const r = resumirCurva(curva)
      assert.deepEqual(
        { drawdownMaximo: fila.drawdown, drawdownMaximoHodl: fila.drawdown_hodl, ultimoHodl: fila.ultimo_hodl },
        { drawdownMaximo: r.drawdownMaximo, drawdownMaximoHodl: r.drawdownMaximoHodl, ultimoHodl: r.ultimoHodl },
        `punto ${k}`,
      )
    }
    assert.ok(resumirCurva(curva).drawdownMaximo > 0.9)
  })
})
```

Replace the whole content of `test/pwa/ayudantes.js` with:

```js
// @ts-check
// Ayudantes de los tests de la PWA: el Worker real (api.js sobre D1 simulado y el escenario sintético
// de sus tests) como fetch, para comprobar el «Contrato de la API» con respuestas de verdad. Solo tests.
import { atender } from '../../worker/src/api.js'
import { ejecutarMercado } from '../../worker/src/ejecuciones/mercado.js'
import { crearSimulacion } from '../../worker/src/repositorio.js'
import { crearD1 } from '../../worker/test/d1.js'
import { ahoraDe, crearEscenario, fetchEscenario, sinEspera } from '../../worker/test/escenario.js'
import { vivoDePrueba } from '../../worker/test/vivo.js'

export const PIN = '4815162342'
export const BASE = 'https://oracle.test.workers.dev'
export const HORAS = 6

/**
 * Worker con `HORAS` horas del escenario ejecutadas (BTC cierra por stop, ETH por take-profit).
 * Devuelve un fetch que atiende la PWA con ese Worker en el instante `ahora`.
 * vivo: estrategias en vivo (por defecto solo v1, sin depender de la lista de producción).
 * @param {{ ahora?: number, ip?: string, vivo?: import('../../worker/src/vivo.js').Vivo }} [op]
 */
export async function workerSimulado({ ahora = ahoraDe(HORAS), ip = '10.0.0.1', vivo = vivoDePrueba(['v1']) } = {}) {
  const db = crearD1()
  const escenario = crearEscenario()
  const env = { DB: db, ORACLE_PIN: PIN, MONEDAS: 'BTC,ETH', ORIGENES: 'http://localhost:8080' }
  await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
  for (let k = 0; k < HORAS; k++) {
    await ejecutarMercado({ env, fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k), esperar: sinEspera, vivo })
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
    return atender(peticion, { env, fetch: fetchEscenario(escenario, ahora), ahora, esperar: sinEspera, vivo })
  }
  return { db, env, ahora, fetch, llamadas }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/multisim.test.js worker/test/api-multisim.test.js`
Expected: FAIL — `does not provide an export named 'cargarEstados'`

- [ ] **Step 3: Write the implementation**

Replace the whole content of `worker/src/repositorio.js` with:

```js
// @ts-check
// Todas las consultas D1 de ORACLE. Ninguna otra parte del Worker escribe SQL.
import { HORA } from '../../core/velas.js'

/** @typedef {import('../../core/bot.js').Estado} Estado */
/** @typedef {import('../../core/bot.js').Evento} Evento */
/** @typedef {import('../../core/bot.js').Decision} Decision */
/** @typedef {import('../../core/bot.js').ParametrosBot} ParametrosBot */
/** @typedef {import('../../core/hora.js').Senal} Senal */
/**
 * @typedef {{ prepare: (sql: string) => any, batch: (sentencias: any[]) => Promise<any[]> }} D1
 * Subconjunto de D1Database que usa ORACLE.
 */
/**
 * @typedef {{ id: number, creada_en: number, cerrada_en: number|null, activa: number,
 *   estrategia_version: string, capital_inicial: number, saldo: number, hodl_json: string|null }} FilaSimulacion
 */

// ── Simulaciones ─────────────────────────────────────────────────────────────
// Una simulación activa por estrategia (migración 0006: índice único parcial sobre estrategia_version).

/** @param {number} n */
const marcas = (n) => Array.from({ length: n }, () => '?').join(', ')

/** Simulación activa de una estrategia. @param {D1} db @param {string} version @returns {Promise<FilaSimulacion|null>} */
export function simulacionActiva(db, version) {
  return db.prepare('SELECT * FROM simulaciones WHERE activa = 1 AND estrategia_version = ?').bind(version).first()
}

/** Todas las simulaciones activas, por id. @param {D1} db @returns {Promise<FilaSimulacion[]>} */
export async function simulacionesActivas(db) {
  return (await db.prepare('SELECT * FROM simulaciones WHERE activa = 1 ORDER BY id').all()).results
}

/** @param {D1} db @param {number} id @returns {Promise<FilaSimulacion|null>} */
export function obtenerSimulacion(db, id) {
  return db.prepare('SELECT * FROM simulaciones WHERE id = ?').bind(id).first()
}

/** @param {D1} db @returns {Promise<FilaSimulacion[]>} */
export async function listarSimulaciones(db) {
  return (await db.prepare('SELECT * FROM simulaciones ORDER BY id DESC').all()).results
}

/**
 * Cierra la simulación activa de la misma estrategia (si hay) y abre otra, en un solo lote. Las de otras
 * estrategias no se tocan. Nada se borra.
 * @param {D1} db
 * @param {{ capitalInicial: number, version: string, ahora: number }} datos
 * @returns {Promise<FilaSimulacion>}
 */
export async function crearSimulacion(db, { capitalInicial, version, ahora }) {
  const [, insercion] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1 AND estrategia_version = ?').bind(ahora, version),
    db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, version, capitalInicial, capitalInicial),
  ])
  return insercion.results[0]
}

/**
 * Reinicio del bot: cierra TODAS las simulaciones activas y abre una por cada versión, todas con el mismo
 * capital y el mismo instante (la comparativa empieza igualada). Un solo lote. Devuelve las nuevas en el orden
 * de `versiones`.
 * @param {D1} db
 * @param {{ capitalInicial: number, versiones: readonly string[], ahora: number }} datos
 * @returns {Promise<FilaSimulacion[]>}
 */
export async function reiniciarSimulaciones(db, { capitalInicial, versiones, ahora }) {
  const [, ...inserciones] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1').bind(ahora),
    ...versiones.map((v) => db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, v, capitalInicial, capitalInicial)),
  ])
  return inserciones.map((r) => r.results[0])
}

/**
 * Deja exactamente una simulación activa por cada versión de `versiones`, en un solo lote (1 llamada):
 * 1. cierra (activa = 0, cerrada_en) las activas cuya estrategia ya no está en la lista: quedan en el historial;
 * 2. crea con `capitalInicial` las que falten;
 * 3. devuelve las activas en el orden de `versiones`.
 * Si nada cambia, no escribe ninguna fila. Dos ejecuciones a la vez no pueden crear dos de la misma estrategia:
 * el índice único parcial revierte el lote de la segunda.
 * @param {D1} db
 * @param {{ versiones: readonly string[], capitalInicial: number, ahora: number }} datos
 * @returns {Promise<FilaSimulacion[]>}
 */
export async function sincronizarSimulaciones(db, { versiones, capitalInicial, ahora }) {
  if (versiones.length === 0) throw new RangeError('No hay estrategias en vivo')
  const resultados = await db.batch([
    db.prepare(`UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1 AND estrategia_version NOT IN (${marcas(versiones.length)})`)
      .bind(ahora, ...versiones),
    ...versiones.map((v) => db.prepare(
      `INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo)
       SELECT ?, 1, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM simulaciones WHERE activa = 1 AND estrategia_version = ?)`,
    ).bind(ahora, v, capitalInicial, capitalInicial, v)),
    db.prepare('SELECT * FROM simulaciones WHERE activa = 1 ORDER BY id'),
  ])
  /** @type {FilaSimulacion[]} */
  const activas = resultados[resultados.length - 1].results
  return versiones.map((v) => {
    const sim = activas.find((s) => s.estrategia_version === v)
    if (!sim) throw new Error(`No quedó activa la simulación de ${v}`)
    return sim
  })
}

/**
 * Guarda las unidades de comprar y mantener solo la primera vez (nunca las cambia después).
 * @param {D1} db @param {number} simulacionId @param {Record<string, number>} hodl
 */
export function guardarHodl(db, simulacionId, hodl) {
  return db.prepare('UPDATE simulaciones SET hodl_json = ? WHERE id = ? AND hodl_json IS NULL')
    .bind(JSON.stringify(hodl), simulacionId).run()
}

// ── Estado del bot (spec §10, «Reconstrucción del estado del bot») ──────────

/**
 * Las 3 lecturas del estado de una simulación (posiciones abiertas, progreso y último stop por moneda).
 * @param {D1} db @param {number} id
 */
const lecturasEstado = (db, id) => [
  // ORDER BY id = orden de apertura, el mismo orden de claves que en memoria: valorCartera suma en ese
  // orden y así el resultado es idéntico al del backtest hasta el último bit.
  db.prepare("SELECT * FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta' ORDER BY id").bind(id),
  db.prepare('SELECT simbolo, ultima_vela_revisada FROM progreso WHERE simulacion_id = ?').bind(id),
  db.prepare(
    `SELECT simbolo, MAX(vela_salida) AS vela FROM posiciones
     WHERE simulacion_id = ? AND estado = 'cerrada' AND motivo_salida = 'stop_loss' GROUP BY simbolo`,
  ).bind(id),
]

/**
 * @param {FilaSimulacion} simulacion
 * @param {{ results: any[] }[]} lecturas resultados de lecturasEstado, en su orden
 * @param {ParametrosBot} parametrosBot
 * @returns {{ estado: Estado, hodl: Record<string, number>|null }}
 */
function estadoDesde(simulacion, [abiertas, progreso, stops], parametrosBot) {
  /** @type {Estado} */
  const estado = { saldo: simulacion.saldo, posiciones: {}, ultimaRevisada: {}, enfriamientoHasta: {} }
  for (const p of abiertas.results) {
    estado.posiciones[p.simbolo] = {
      simbolo: p.simbolo, velaEntrada: p.vela_entrada, precioEntrada: p.precio_entrada, unidades: p.unidades,
      coste: p.coste, stopLoss: p.stop_loss, takeProfit: p.take_profit,
    }
  }
  for (const p of progreso.results) estado.ultimaRevisada[p.simbolo] = p.ultima_vela_revisada
  for (const s of stops.results) estado.enfriamientoHasta[s.simbolo] = s.vela + parametrosBot.enfriamientoHoras * HORA
  return { estado, hodl: simulacion.hodl_json === null ? null : JSON.parse(simulacion.hodl_json) }
}

/**
 * Estado de core/bot.js reconstruido sin pérdida desde D1, con una sola llamada (lote de 3 lecturas).
 * Sin fila de progreso = moneda nunca revisada (la clave no existe → −∞ en el bot).
 * @param {D1} db
 * @param {FilaSimulacion} simulacion
 * @param {ParametrosBot} parametrosBot de la estrategia de la simulación (enfriamientoHoras)
 * @returns {Promise<{ estado: Estado, hodl: Record<string, number>|null }>}
 */
export async function cargarEstado(db, simulacion, parametrosBot) {
  return estadoDesde(simulacion, await db.batch(lecturasEstado(db, simulacion.id)), parametrosBot)
}

/**
 * Fila y estado de varias simulaciones en UNA llamada (lote de 1 + 3 × n lecturas), en el orden de `ids`.
 * Igual que obtenerSimulacion + cargarEstado de cada una.
 * @param {D1} db
 * @param {number[]} ids
 * @param {(version: string) => ParametrosBot} parametrosDe parámetros de bot de cada estrategia
 * @returns {Promise<{ sim: FilaSimulacion, estado: Estado, hodl: Record<string, number>|null }[]>}
 */
export async function cargarEstados(db, ids, parametrosDe) {
  if (ids.length === 0) return []
  const [filas, ...lecturas] = await db.batch([
    db.prepare(`SELECT * FROM simulaciones WHERE id IN (${marcas(ids.length)})`).bind(...ids),
    ...ids.flatMap((id) => lecturasEstado(db, id)),
  ])
  return ids.map((id, i) => {
    /** @type {FilaSimulacion|undefined} */
    const sim = filas.results.find((f) => f.id === id)
    if (!sim) throw new RangeError(`No existe la simulación ${id}`)
    return { sim, ...estadoDesde(sim, lecturas.slice(3 * i, 3 * i + 3), parametrosDe(sim.estrategia_version)) }
  })
}

/**
 * Sentencias de una moneda en una hora, para UN db.batch() (spec §7.5):
 * 1. INSERT de la decisión, sin OR IGNORE: si ya existe (reintento), todo el lote se revierte.
 * 2. Por evento: el saldo se mueve con un delta (no con un valor absoluto), así cada lote que entra
 *    es coherente por sí solo aunque el de otra moneda falle; `saldo_tras` se lee del saldo real.
 *    Venta: saldo += importe − comisión; operación; posición cerrada con su pnl_neto.
 *    Compra: saldo −= importe; posición abierta; operación. CHECK (saldo >= 0) revierte si no alcanza.
 * 3. progreso de la moneda.
 * @param {D1} db
 * @param {{ simulacionId: number, version: string, decision: Decision, senal: Senal, eventos: Evento[],
 *   ultimaRevisada: number|undefined, ahora: number }} paso
 */
export function sentenciasPasoMoneda(db, { simulacionId, version, decision, senal, eventos, ultimaRevisada, ahora }) {
  const s = decision.simbolo
  const posicionAbierta = "(SELECT id FROM posiciones WHERE simulacion_id = ? AND simbolo = ? AND estado = 'abierta')"
  const saldoActual = '(SELECT saldo FROM simulaciones WHERE id = ?)'
  const insertarOperacion = `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades,
      importe, comision, deslizamiento, motivo, saldo_tras, pnl_neto, estrategia_version, creada_en)
    VALUES (?, ${posicionAbierta}, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${saldoActual}, ?, ?, ?)`
  /** @param {Evento} e */
  const operacion = (e) => db.prepare(insertarOperacion).bind(
    simulacionId, simulacionId, s, s, e.tipo, e.vela, e.precio, e.unidades, e.importe, e.comision, e.deslizamiento,
    e.motivo, simulacionId, e.pnlNeto ?? null, version, ahora,
  )
  const sentencias = [
    db.prepare(
      `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, indice_confianza, puntuacion, accion, motivo,
         precio, desglose_json, estrategia_version, creada_en)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      simulacionId, s, decision.vela, decision.veredicto, decision.indiceConfianza, decision.puntuacion, decision.accion,
      decision.motivo, decision.precio, JSON.stringify(senal), version, ahora,
    ),
  ]
  for (const e of eventos) {
    if (e.simbolo !== s) throw new RangeError(`evento de ${e.simbolo} en el lote de ${s}`)
    if (e.tipo === 'venta') {
      sentencias.push(
        db.prepare('UPDATE simulaciones SET saldo = saldo + ? WHERE id = ?').bind(e.importe - e.comision, simulacionId),
        operacion(e),
        db.prepare(
          `UPDATE posiciones SET estado = 'cerrada', vela_salida = ?, precio_salida = ?, motivo_salida = ?, pnl_neto = ?
           WHERE simulacion_id = ? AND simbolo = ? AND estado = 'abierta'`,
        ).bind(e.vela, e.precio, e.motivo, e.pnlNeto ?? null, simulacionId, s),
      )
    } else {
      const p = e.posicion
      sentencias.push(
        db.prepare('UPDATE simulaciones SET saldo = saldo - ? WHERE id = ?').bind(e.importe, simulacionId),
        db.prepare(
          `INSERT INTO posiciones (simulacion_id, simbolo, estado, vela_entrada, precio_entrada, unidades, coste, stop_loss, take_profit)
           VALUES (?, ?, 'abierta', ?, ?, ?, ?, ?, ?)`,
        ).bind(simulacionId, s, p.velaEntrada, p.precioEntrada, p.unidades, p.coste, p.stopLoss, p.takeProfit),
        operacion(e),
      )
    }
  }
  if (ultimaRevisada !== undefined) {
    sentencias.push(db.prepare(
      `INSERT INTO progreso (simulacion_id, simbolo, ultima_vela_revisada) VALUES (?, ?, ?)
       ON CONFLICT (simulacion_id, simbolo) DO UPDATE SET ultima_vela_revisada = excluded.ultima_vela_revisada`,
    ).bind(simulacionId, s, ultimaRevisada))
  }
  return sentencias
}

/**
 * Persiste el paso de una moneda de forma atómica (1 llamada a D1).
 * @param {D1} db
 * @param {Parameters<typeof sentenciasPasoMoneda>[1]} paso
 */
export async function guardarPasoMoneda(db, paso) {
  await db.batch(sentenciasPasoMoneda(db, paso))
}

/**
 * Punto horario de la curva de capital; si ya existe, se conserva el primero. Guarda además el resumen
 * acumulado de la curva hasta este punto (máximos, drawdowns y último HODL) a partir del punto anterior,
 * con las mismas operaciones y en el mismo orden que drawdownMaximo de core/metricas.js: el resultado es
 * idéntico al de recorrer la curva entera. Los puntos llegan en orden de vela (uno por ejecución de mercado).
 * Devuelve la sentencia sin ejecutar (guardarCapital la ejecuta; guardarCapitales las agrupa en un lote).
 * @param {D1} db
 * @param {PuntoCapital} punto
 */
export function sentenciaCapital(db, { simulacionId, vela, valorCartera, saldo, valorHodl }) {
  // Valor y HODL como REAL: un entero enlazado haría división entera en (máximo − valor) / máximo.
  return db.prepare(
    `INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl,
       maximo, drawdown, maximo_hodl, drawdown_hodl, ultimo_hodl)
     SELECT s, t, v, ?, h,
       mx, MAX(COALESCE(dd, 0), CASE WHEN mx > 0 THEN (mx - v) / mx ELSE 0 END),
       mh, CASE WHEN mh IS NULL THEN NULL WHEN h IS NULL THEN ddh
         ELSE MAX(COALESCE(ddh, 0), CASE WHEN mh > 0 THEN (mh - h) / mh ELSE 0 END) END,
       COALESCE(h, uh)
     FROM (
       SELECT s, t, v, h, MAX(COALESCE(p.maximo, v), v) AS mx,
         CASE WHEN h IS NULL THEN p.maximo_hodl ELSE MAX(COALESCE(p.maximo_hodl, h), h) END AS mh,
         p.drawdown AS dd, p.drawdown_hodl AS ddh, p.ultimo_hodl AS uh
       FROM (SELECT ? AS s, ? AS t, CAST(? AS REAL) AS v, CAST(? AS REAL) AS h)
       LEFT JOIN (SELECT maximo, drawdown, maximo_hodl, drawdown_hodl, ultimo_hodl FROM capital
         WHERE simulacion_id = ? AND vela_1h < ? ORDER BY vela_1h DESC LIMIT 1) p ON 1
     )`,
  ).bind(saldo, simulacionId, vela, valorCartera, valorHodl, simulacionId, vela)
}

/**
 * @typedef {{ simulacionId: number, vela: number, valorCartera: number, saldo: number, valorHodl: number|null }} PuntoCapital
 */

/** Un punto de capital (1 llamada). @param {D1} db @param {PuntoCapital} punto */
export function guardarCapital(db, punto) {
  return sentenciaCapital(db, punto).run()
}

/** Los puntos de capital de varias simulaciones en un lote (1 llamada; nada si no hay). @param {D1} db @param {PuntoCapital[]} puntos */
export async function guardarCapitales(db, puntos) {
  if (puntos.length > 0) await db.batch(puntos.map((p) => sentenciaCapital(db, p)))
}

// ── Ejecuciones ──────────────────────────────────────────────────────────────

/**
 * @typedef {{ id: number, tipo: 'noticias'|'mercado'|'manual', inicio: number, fin: number|null,
 *   ok: boolean|null, fallos: string[] }} Ejecucion
 */

/** @param {D1} db @param {'noticias'|'mercado'|'manual'} tipo @param {number} inicio @returns {Promise<number>} */
export function iniciarEjecucion(db, tipo, inicio) {
  return db.prepare('INSERT INTO ejecuciones (tipo, inicio) VALUES (?, ?) RETURNING id').bind(tipo, inicio).first('id')
}

/**
 * Reserva el análisis manual de forma atómica: inserta la ejecución 'manual' solo si no hay otra que haya
 * empezado en los últimos `esperaMs` (una sola sentencia: dos peticiones a la vez no pueden pasar las dos).
 * @param {D1} db @param {number} inicio @param {number} esperaMs
 * @returns {Promise<number|null>} id de la ejecución, o null si es demasiado pronto
 */
export function reservarManual(db, inicio, esperaMs) {
  return db.prepare(
    `INSERT INTO ejecuciones (tipo, inicio) SELECT 'manual', ?
     WHERE NOT EXISTS (SELECT 1 FROM ejecuciones WHERE tipo = 'manual' AND inicio > ?) RETURNING id`,
  ).bind(inicio, inicio - esperaMs).first('id')
}

/**
 * @param {D1} db @param {number} id
 * @param {{ fin: number, ok: boolean, detalle: { fallos: string[] } & Record<string, unknown> }} cierre
 */
export function finalizarEjecucion(db, id, { fin, ok, detalle }) {
  return db.prepare('UPDATE ejecuciones SET fin = ?, ok = ?, detalle_json = ? WHERE id = ?')
    .bind(fin, ok ? 1 : 0, JSON.stringify(detalle), id).run()
}

/** @param {any} fila @returns {Ejecucion} */
export function filaAEjecucion(fila) {
  const detalle = fila.detalle_json ? JSON.parse(fila.detalle_json) : {}
  return {
    id: fila.id, tipo: fila.tipo, inicio: fila.inicio, fin: fila.fin,
    ok: fila.ok === null ? null : fila.ok === 1, fallos: Array.isArray(detalle.fallos) ? detalle.fallos : [],
  }
}

/** La más reciente (inicio, id) de varias filas de ejecuciones. @param {any[]} filas */
const masReciente = (filas) => filas.reduce(
  (a, f) => (f && (!a || f.inicio > a.inicio || (f.inicio === a.inicio && f.id > a.id)) ? f : a), null,
)

/**
 * Ejecución más reciente de alguno de los tipos dados: una búsqueda con LIMIT 1 por tipo sobre
 * ejecuciones(tipo, inicio), en una sola llamada. Nunca ordena la tabla.
 * @param {D1} db @param {('noticias'|'mercado'|'manual')[]} tipos
 * @returns {Promise<Ejecucion|null>}
 */
export async function ultimaEjecucion(db, tipos) {
  const resultados = await db.batch(tipos.map((t) => db.prepare(
    'SELECT * FROM ejecuciones WHERE tipo = ? ORDER BY inicio DESC, id DESC LIMIT 1',
  ).bind(t)))
  const fila = masReciente(resultados.map((r) => r.results[0]))
  return fila ? filaAEjecucion(fila) : null
}

// ── Titulares ────────────────────────────────────────────────────────────────

/** @typedef {import('./fuentes/rss.js').TitularCrudo & { id: string }} TitularNuevo */

/**
 * Inserta en 1 sentencia (json_each) solo los titulares cuyo id no existe. Devuelve cuántos entraron.
 * @param {D1} db @param {TitularNuevo[]} titulares
 */
export async function insertarTitulares(db, titulares) {
  if (titulares.length === 0) return 0
  const r = await db.prepare(
    `INSERT OR IGNORE INTO titulares (id, fuente, origen, titulo, url, publicado_en)
     SELECT json_extract(value, '$.id'), json_extract(value, '$.fuente'), json_extract(value, '$.origen'),
            json_extract(value, '$.titulo'), json_extract(value, '$.url'), json_extract(value, '$.publicadoEn')
     FROM json_each(?)`,
  ).bind(JSON.stringify(titulares)).run()
  return r.meta.changes
}

/**
 * Titulares sin puntuar publicados desde `desde`, los más recientes primero.
 * @param {D1} db @param {number} desde @param {number} limite
 * @returns {Promise<{ id: string, titulo: string }[]>}
 */
export async function titularesSinPuntuar(db, desde, limite) {
  return (await db.prepare(
    'SELECT id, titulo FROM titulares WHERE puntuacion IS NULL AND publicado_en >= ? ORDER BY publicado_en DESC LIMIT ?',
  ).bind(desde, limite).all()).results
}

/**
 * Guarda puntuación, monedas y motor de cada titular en 1 sentencia (UPDATE … FROM json_each).
 * @param {D1} db @param {Record<string, { puntuacion: number, monedas: string[], motor: string }>} resultados
 */
export async function guardarPuntuaciones(db, resultados) {
  const lista = Object.entries(resultados).map(([id, r]) => ({ id, ...r }))
  if (lista.length === 0) return
  await db.prepare(
    `UPDATE titulares SET puntuacion = json_extract(j.value, '$.puntuacion'),
       monedas_json = json_extract(j.value, '$.monedas'), motor = json_extract(j.value, '$.motor')
     FROM json_each(?) AS j WHERE titulares.id = json_extract(j.value, '$.id')`,
  ).bind(JSON.stringify(lista)).run()
}

/**
 * Titulares puntuados de (desde, hasta] para la estrategia.
 * @param {D1} db @param {number} desde @param {number} hasta
 * @returns {Promise<import('../../core/estrategia-v1.js').Titular[]>}
 */
export async function titularesParaEstrategia(db, desde, hasta) {
  const { results } = await db.prepare(
    `SELECT id, origen, publicado_en, monedas_json, puntuacion FROM titulares
     WHERE publicado_en > ? AND publicado_en <= ? AND puntuacion IS NOT NULL ORDER BY publicado_en`,
  ).bind(desde, hasta).all()
  return results.map((t) => ({
    id: t.id, origen: t.origen, publicadoEn: t.publicado_en, monedas: JSON.parse(t.monedas_json ?? '[]'), puntuacion: t.puntuacion,
  }))
}

/**
 * Purga (spec §10): titulares > 7 días, ejecuciones > 30 días y bloqueos de PIN caducados. 1 llamada.
 * @param {D1} db @param {number} ahora
 */
export async function purgar(db, ahora) {
  const dia = 24 * HORA
  await db.batch([
    db.prepare('DELETE FROM titulares WHERE publicado_en < ?').bind(ahora - 7 * dia),
    db.prepare('DELETE FROM ejecuciones WHERE inicio < ?').bind(ahora - 30 * dia),
    db.prepare('DELETE FROM intentos_pin WHERE bloqueado_hasta IS NOT NULL AND bloqueado_hasta < ?').bind(ahora),
  ])
}

// ── Caché de mercado (spec §4 y §9) ──────────────────────────────────────────

/**
 * Velas y funding guardados de las monedas configuradas, en una llamada (lote de 2 lecturas por clave primaria).
 * @param {D1} db
 * @param {string[]} monedas
 * @returns {Promise<{ velas: Record<string, string>, funding: Record<string, { valor: number, actualizadoEn: number }> }>}
 *   velas: 'BTC-USDT 1h' → velas_json
 */
export async function leerCacheMercado(db, monedas) {
  const instrumentos = monedas.flatMap((s) => [`${s}-USDT`, `${s}-EUR`])
  const [velas, funding] = await db.batch([
    db.prepare(`SELECT instrumento, intervalo, velas_json FROM cache_velas WHERE instrumento IN (${marcas(instrumentos.length)})`)
      .bind(...instrumentos),
    db.prepare(`SELECT simbolo, valor, actualizado_en FROM cache_funding WHERE simbolo IN (${marcas(monedas.length)})`).bind(...monedas),
  ])
  return {
    velas: Object.fromEntries(velas.results.map((f) => [`${f.instrumento} ${f.intervalo}`, f.velas_json])),
    funding: Object.fromEntries(funding.results.map((f) => [f.simbolo, { valor: f.valor, actualizadoEn: f.actualizado_en }])),
  }
}

/**
 * Reescribe las series y el funding que han cambiado, en un lote (nada si no hay cambios).
 * @param {D1} db
 * @param {{ velas: { instrumento: string, intervalo: string, json: string }[], funding: Record<string, number>, ahora: number }} datos
 */
export async function guardarCacheMercado(db, { velas, funding, ahora }) {
  const sentencias = [
    ...velas.map((v) => db.prepare(
      `INSERT INTO cache_velas (instrumento, intervalo, velas_json, actualizado_en) VALUES (?, ?, ?, ?)
       ON CONFLICT (instrumento, intervalo) DO UPDATE SET velas_json = excluded.velas_json, actualizado_en = excluded.actualizado_en`,
    ).bind(v.instrumento, v.intervalo, v.json, ahora)),
    ...Object.entries(funding).map(([simbolo, valor]) => db.prepare(
      `INSERT INTO cache_funding (simbolo, valor, actualizado_en) VALUES (?, ?, ?)
       ON CONFLICT (simbolo) DO UPDATE SET valor = excluded.valor, actualizado_en = excluded.actualizado_en`,
    ).bind(simbolo, valor, ahora)),
  ]
  if (sentencias.length > 0) await db.batch(sentencias)
}

// ── Señales actuales ─────────────────────────────────────────────────────────

/**
 * Sustituye la señal vigente de cada moneda (1 llamada).
 * @param {D1} db
 * @param {{ simbolo: string, calculadaEn: number, vela1h: number, senal: object }[]} senales
 */
export async function guardarSenales(db, senales) {
  if (senales.length === 0) return
  await db.batch(senales.map((s) => db.prepare(
    `INSERT INTO senales_actuales (simbolo, calculada_en, vela_1h, senal_json) VALUES (?, ?, ?, ?)
     ON CONFLICT (simbolo) DO UPDATE SET calculada_en = excluded.calculada_en, vela_1h = excluded.vela_1h,
       senal_json = excluded.senal_json`,
  ).bind(s.simbolo, s.calculadaEn, s.vela1h, JSON.stringify(s.senal))))
}

/** @param {D1} db @returns {Promise<Record<string, any>>} señal guardada por símbolo */
export async function senalesActuales(db) {
  const { results } = await db.prepare('SELECT simbolo, senal_json FROM senales_actuales').all()
  return Object.fromEntries(results.map((f) => [f.simbolo, JSON.parse(f.senal_json)]))
}

// ── Lecturas de la API ───────────────────────────────────────────────────────

/**
 * Último Fear & Greed guardado por una ejecución de mercado o manual (una búsqueda por tipo, 1 llamada).
 * @param {D1} db
 */
export async function ultimoFng(db) {
  const resultados = await db.batch(['mercado', 'manual'].map((t) => db.prepare(
    `SELECT id, inicio, detalle_json FROM ejecuciones WHERE tipo = ? AND json_extract(detalle_json, '$.fng') IS NOT NULL
     ORDER BY inicio DESC, id DESC LIMIT 1`,
  ).bind(t)))
  const fila = masReciente(resultados.map((r) => r.results[0]))
  return fila ? /** @type {import('./fuentes/fng.js').Fng} */ (JSON.parse(fila.detalle_json).fng) : null
}

/**
 * Último punto de capital y número de posiciones abiertas (1 llamada).
 * @param {D1} db @param {number} simulacionId
 */
export async function resumenBot(db, simulacionId) {
  const [capital, abiertas] = await db.batch([
    db.prepare('SELECT * FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1').bind(simulacionId),
    db.prepare("SELECT COUNT(*) AS n FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta'").bind(simulacionId),
  ])
  return { capital: capital.results[0] ?? null, abiertas: /** @type {number} */ (abiertas.results[0].n) }
}

/**
 * Las 2 lecturas de la curva para la interfaz (definición de referencia: submuestrearCurva de api.js):
 * todos los puntos de los últimos `horariaMs` y, antes, el último punto de cada día UTC, con una búsqueda por día.
 * Juntar sus resultados con unirCurva.
 * @param {D1} db @param {number} simulacionId @param {number} horariaMs
 */
function lecturasCurva(db, simulacionId, horariaMs) {
  const dia = 24 * HORA
  return [
    db.prepare(
      `SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital
       WHERE simulacion_id = ? AND vela_1h >= (SELECT vela_1h FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1) - ?
       ORDER BY vela_1h`,
    ).bind(simulacionId, simulacionId, horariaMs),
    db.prepare(
      `WITH RECURSIVE
         limites AS (
           SELECT s, d,
             (SELECT vela_1h FROM capital WHERE simulacion_id = s ORDER BY vela_1h LIMIT 1) AS primera,
             (SELECT vela_1h FROM capital WHERE simulacion_id = s ORDER BY vela_1h DESC LIMIT 1) - ? AS corte
           -- Enteros explícitos: un número enlazado puede llegar como REAL y primera / d no truncaría.
           FROM (SELECT ? AS s, CAST(? AS INTEGER) AS d)
         ),
         dias(fin) AS (
           SELECT (primera / d + 1) * d FROM limites WHERE primera IS NOT NULL
           UNION ALL SELECT fin + d FROM dias, limites WHERE fin < corte
         )
       SELECT c.vela_1h, c.valor_cartera, c.saldo, c.valor_hodl FROM dias, limites l JOIN capital c
         ON c.simulacion_id = l.s AND c.vela_1h = (SELECT vela_1h FROM capital
           WHERE simulacion_id = l.s AND vela_1h >= dias.fin - l.d AND vela_1h < dias.fin ORDER BY vela_1h DESC LIMIT 1)
       WHERE c.vela_1h < l.corte`,
    ).bind(horariaMs, simulacionId, dia),
  ]
}

/** Curva diaria (ordenada) seguida de la horaria. @param {{ results: any[] }} horaria @param {{ results: any[] }} diaria */
const unirCurva = (horaria, diaria) => [...diaria.results.sort((a, b) => a.vela_1h - b.vela_1h), ...horaria.results]

/**
 * Todo lo que necesita GET /api/bot (1 llamada), con lecturas acotadas:
 * - posiciones abiertas, cada una con `precio_actual` = precio de la última decisión con precio de su
 *   moneda (búsqueda por el índice único de decisiones, no un recorrido de la historia);
 * - operaciones (crecen con la actividad del bot, no con las horas);
 * - el último punto de capital, con el resumen acumulado de la curva (core/metricas.js `ResumenCurva`);
 * - la curva para la interfaz (lecturasCurva).
 * @param {D1} db @param {number} simulacionId @param {number} horariaMs
 */
export async function datosBot(db, simulacionId, horariaMs) {
  const [abiertas, operaciones, ultimo, horaria, diaria] = await db.batch([
    db.prepare(
      `SELECT p.*, (SELECT d.precio FROM decisiones d WHERE d.simulacion_id = p.simulacion_id AND d.simbolo = p.simbolo
         AND d.precio IS NOT NULL ORDER BY d.vela_1h DESC LIMIT 1) AS precio_actual
       FROM posiciones p WHERE p.simulacion_id = ? AND p.estado = 'abierta' ORDER BY p.id`,
    ).bind(simulacionId),
    db.prepare('SELECT lado, simbolo, comision, deslizamiento, pnl_neto FROM operaciones WHERE simulacion_id = ? ORDER BY id')
      .bind(simulacionId),
    db.prepare(
      `SELECT vela_1h, drawdown, drawdown_hodl, ultimo_hodl,
         (SELECT vela_1h FROM capital WHERE simulacion_id = ? ORDER BY vela_1h LIMIT 1) AS primera
       FROM capital WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1`,
    ).bind(simulacionId, simulacionId),
    ...lecturasCurva(db, simulacionId, horariaMs),
  ])
  const u = ultimo.results[0]
  /** @type {import('../../core/metricas.js').ResumenCurva} */
  const resumenCurva = u
    ? { ultimoHodl: u.ultimo_hodl, drawdownMaximo: u.drawdown, drawdownMaximoHodl: u.drawdown_hodl, duracion: u.vela_1h - u.primera }
    : { ultimoHodl: null, drawdownMaximo: 0, drawdownMaximoHodl: null, duracion: 0 }
  return {
    abiertas: abiertas.results,
    operaciones: operaciones.results,
    resumenCurva,
    curva: unirCurva(horaria, diaria),
  }
}

/**
 * Lo que necesita GET /api/bot/comparativa de cada simulación, en 1 llamada (lote de 4 lecturas acotadas por
 * simulación), en el orden de `ids`: el último punto de capital (valor, drawdown acumulado y los del HODL),
 * el número de operaciones (índice operaciones(simulacion_id)) y la curva para la interfaz (lecturasCurva).
 * @param {D1} db @param {number[]} ids @param {number} horariaMs
 * @returns {Promise<{ ultimo: any|null, operaciones: number, curva: any[] }[]>}
 */
export async function datosComparativa(db, ids, horariaMs) {
  if (ids.length === 0) return []
  const resultados = await db.batch(ids.flatMap((id) => [
    db.prepare(
      `SELECT vela_1h, valor_cartera, valor_hodl, drawdown, drawdown_hodl, ultimo_hodl FROM capital
       WHERE simulacion_id = ? ORDER BY vela_1h DESC LIMIT 1`,
    ).bind(id),
    db.prepare('SELECT COUNT(*) AS n FROM operaciones WHERE simulacion_id = ?').bind(id),
    ...lecturasCurva(db, id, horariaMs),
  ]))
  return ids.map((_, i) => {
    const [ultimo, operaciones, horaria, diaria] = resultados.slice(4 * i, 4 * i + 4)
    return { ultimo: ultimo.results[0] ?? null, operaciones: /** @type {number} */ (operaciones.results[0].n), curva: unirCurva(horaria, diaria) }
  })
}

/**
 * Titulares de una moneda o de MERCADO en (desde, hasta], los más recientes primero.
 * @param {D1} db @param {string} simbolo @param {number} desde @param {number} hasta @param {number} limite
 */
export async function titularesDeMoneda(db, simbolo, desde, hasta, limite) {
  return (await db.prepare(
    `SELECT * FROM titulares WHERE publicado_en > ? AND publicado_en <= ?
       AND (monedas_json LIKE ? OR monedas_json LIKE '%"MERCADO"%') ORDER BY publicado_en DESC LIMIT ?`,
  ).bind(desde, hasta, `%"${simbolo}"%`, limite).all()).results
}

/**
 * Página de una tabla por id descendente. Pide limite + 1 filas para saber si hay más.
 * @param {D1} db @param {'decisiones'|'operaciones'} tabla
 * @param {{ simulacionId: number, simbolo: string|null, cursor: number|null, limite: number }} filtro
 * @returns {Promise<{ filas: any[], siguienteCursor: number|null }>}
 */
export async function pagina(db, tabla, { simulacionId, simbolo, cursor, limite }) {
  // Solo los filtros presentes, para que el plan use el índice que ya viene ordenado por id.
  const condiciones = ['simulacion_id = ?']
  /** @type {(number|string)[]} */
  const valores = [simulacionId]
  if (simbolo !== null) condiciones.push('simbolo = ?') && valores.push(simbolo)
  if (cursor !== null) condiciones.push('id < ?') && valores.push(cursor)
  const { results } = await db.prepare(
    `SELECT * FROM ${tabla} WHERE ${condiciones.join(' AND ')} ORDER BY id DESC LIMIT ?`,
  ).bind(...valores, limite + 1).all()
  const filas = results.slice(0, limite)
  return { filas, siguienteCursor: results.length > limite ? filas[filas.length - 1].id : null }
}
```

Replace the whole content of `worker/src/ejecuciones/mercado.js` with:

```js
// @ts-check
// Cron `3 * * * *` (mercado y bot) y POST /api/analizar (solo señales; nunca opera). Spec §5 y §7.
// Datos de mercado de OKX (desde Cloudflare Binance responde 403), con caché en D1 (fuentes/velas.js) y Bybit
// como respaldo de las velas USDT. Subpeticiones externas con 5 monedas (spec §9):
//   velas: 10 por hora (1H USDT y EUR, limit=3), +5 al cerrar cada 4H, +5 al cerrar el día; 20 sin caché;
//   derivados: 10 rubik + los funding que toque refrescar (5 cada 8 h);
//   1 Fear & Greed + hasta 2 LLM (Groq y Gemini, solo con clave; Workers AI va por binding).
// Fijas: 21-38. Lo que sobra hasta 50, con 1 de margen, es el presupuesto de reintentos de OKX, series enteras
// por un hueco de la caché y respaldo de Bybit (este con reserva propia): como mucho 49.
// Llamadas a D1 con n estrategias en vivo y m monedas: 10 + n × m (un lote atómico por moneda y simulación; 2 de
// la caché; 1 que sincroniza las simulaciones; 2 que cargan el estado de todas, antes y después de operar; 1 con
// el capital de todas) + n la primera hora (HODL). Con 5 monedas: 15-16 con 1 estrategia y 25-28 con 3
// (el plan gratuito admite 50 consultas a D1 por invocación).
import { valorCartera, valorHodl, velaDeDecision } from '../../../core/bot.js'
import { ejecutarHora } from '../../../core/hora.js'
import { HORA } from '../../../core/velas.js'
import { CAPITAL_POR_DEFECTO, leerMonedas } from '../config.js'
import { completarDerivados, descargarDerivados, fundingAPedir } from '../fuentes/derivados.js'
import { descargarFng } from '../fuentes/fng.js'
import { explicarSenales, proveedores } from '../fuentes/llm.js'
import { cambio24h, crearCliente, crearPresupuesto, ultimoCierre } from '../fuentes/okx.js'
import { descargarSeries, planificarVelas, serializar } from '../fuentes/velas.js'
import * as repo from '../repositorio.js'
import { VIVO } from '../vivo.js'

/** @typedef {import('../../../core/hora.js').EntradaMoneda} EntradaMoneda */
/** @typedef {import('../../../core/hora.js').Estrategia} Estrategia */
/** @typedef {import('../../../core/hora.js').Senal} Senal */
/** @typedef {import('../fuentes/fng.js').Fng} Fng */

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/** Subpeticiones externas por invocación en el plan gratuito. */
export const SUBPETICIONES = 50

/**
 * Velas (caché + OKX, con Bybit de respaldo), derivados y Fear & Greed. Primero las velas (imprescindibles) y
 * Fear & Greed en paralelo; después, para las USDT que fallen, Bybit; los derivados (opcionales), al final.
 * Nada de esto lanza: lo que falla se anota. Lee la caché al empezar y la reescribe al acabar (2 llamadas a D1).
 * @param {{ db: import('../repositorio.js').D1, fetch: typeof fetch, monedas: string[], ahora: number,
 *   esperar?: (ms: number) => Promise<void>, llmExternos?: number }} entrada
 *   esperar: pausas del límite de ritmo (inyectable en los tests); llmExternos: Groq/Gemini configurados.
 * @returns {Promise<{ entradas: EntradaMoneda[], fng: Fng|null, fallos: string[], reintentosOkx: number,
 *   limitadasOkx: string[], velasBybit: string[] }>}
 */
export async function recogerDatos({ db, fetch, monedas, ahora, esperar, llmExternos = 0 }) {
  /** @type {string[]} */
  const fallos = []
  const cache = await repo.leerCacheMercado(db, monedas).catch((e) => {
    fallos.push(`caché: ${mensaje(e)}`)
    return { velas: {}, funding: {} }
  })
  const pedidos = planificarVelas(monedas, cache.velas, ahora)
  const velasAPedir = pedidos.filter((p) => p.limite > 0)
  const fijas = velasAPedir.length + fundingAPedir(monedas, cache.funding, ahora).length + 2 * monedas.length + 1 + llmExternos
  const presupuesto = crearPresupuesto(SUBPETICIONES - fijas - 1)
  // La mitad del hueco, como mucho, queda para Bybit: si OKX limita, más reintentos a OKX no suelen servir.
  presupuesto.reserva = Math.min(velasAPedir.filter((p) => !p.eur).length, Math.floor(presupuesto.disponibles / 2))
  const okx = crearCliente(fetch, { esperar, presupuesto })
  const fngPromesa = descargarFng(fetch).then((valor) => ({ valor, fallo: null }), (e) => ({ valor: null, fallo: `fng: ${mensaje(e)}` }))
  const velas = await descargarSeries({ okx, fetch, pedidos, ahora, presupuesto })
  presupuesto.reserva = 0
  const derivados = await descargarDerivados(okx, monedas, { funding: cache.funding, ahora })
  const fng = await fngPromesa
  fallos.push(...velas.fallos, ...derivados.fallos, ...(fng.fallo ? [fng.fallo] : []))
  try {
    await repo.guardarCacheMercado(db, {
      velas: velas.guardar.map((g) => ({ instrumento: g.instrumento, intervalo: g.intervalo, json: serializar(g.velas) })),
      funding: derivados.fundingNuevo,
      ahora,
    })
  } catch (e) {
    fallos.push(`caché: ${mensaje(e)}`)
  }
  const entradas = monedas.map((simbolo) => {
    const m = velas.monedas[simbolo]
    return {
      simbolo,
      velas: m.velas,
      velasEur: m.velasEur,
      derivados: completarDerivados(derivados.base[simbolo], cambio24h(m.velas['1h'], ahora)),
    }
  })
  return { entradas, fng: fng.valor, fallos, reintentosOkx: okx.reintentos, limitadasOkx: okx.limitadas, velasBybit: velas.bybit }
}

/**
 * Señal lista para senales_actuales y la API: precio en €, cambio 24 h, explicación y SL/TP orientativos.
 * @param {Senal} senal
 * @param {EntradaMoneda} entrada
 * @param {number} ahora
 * @param {{ texto: string, motor: string }} explicacion
 * @param {import('../../../core/bot.js').ParametrosBot} parametrosBot
 */
export function enriquecerSenal(senal, entrada, ahora, explicacion, parametrosBot) {
  const precioEur = ultimoCierre(entrada.velasEur, ahora)
  const orientativo = precioEur !== null && typeof senal.atrPct === 'number'
    ? {
      stopLoss: precioEur * (1 - parametrosBot.multStopLoss * senal.atrPct),
      takeProfit: precioEur * (1 + parametrosBot.multTakeProfit * senal.atrPct),
    }
    : null
  return {
    ...senal, precioEur, cambio24h: cambio24h(entrada.velasEur, ahora),
    explicacion: explicacion.texto, motorExplicacion: explicacion.motor, orientativo,
  }
}

/**
 * Paso horario del bot de cada simulación activa y persistencia: un lote atómico por moneda y simulación, después
 * un lote con el punto de capital de todas. Cada simulación usa su propia estrategia y su propio estado.
 * Si el lote de una moneda falla, las demás siguen: el saldo se mueve por deltas, así que lo que ya
 * entró es coherente y la moneda fallida se reintenta sola la hora siguiente (su progreso no avanzó).
 * Llamadas a D1: 3 + simulaciones × monedas (+ 1 por simulación la primera hora, al fijar el HODL).
 * @param {import('../repositorio.js').D1} db
 * @param {{ sims: import('../repositorio.js').FilaSimulacion[], estrategiaDe: (version: string) => Estrategia,
 *   entradas: EntradaMoneda[], titulares: import('../../../core/estrategia-v1.js').Titular[], fng: Fng|null, ahora: number }} datos
 * @returns {Promise<{ simulaciones: { id: number, version: string, senales: Senal[], operaciones: number, repetidas: string[] }[],
 *   fallos: string[] }>}
 *   fallos: con más de una simulación, cada uno lleva la versión delante («bot v2 ETH: …»).
 */
export async function operar(db, { sims, estrategiaDe, entradas, titulares, fng, ahora }) {
  /** @type {string[]} */
  const fallos = []
  const ids = sims.map((s) => s.id)
  /** @param {string} version */
  const parametrosDe = (version) => estrategiaDe(version).PARAMETROS_BOT
  /** @param {import('../repositorio.js').FilaSimulacion} sim */
  const prefijo = (sim) => (sims.length > 1 ? `${sim.estrategia_version} ` : '')
  const simulaciones = []
  for (const { sim, estado, hodl } of await repo.cargarEstados(db, ids, parametrosDe)) {
    const est = estrategiaDe(sim.estrategia_version)
    /** @type {string[]} */
    const repetidas = []
    let operaciones = 0
    const hora = ejecutarHora({
      estado, hodl, capitalInicial: sim.capital_inicial, ahora, monedas: entradas, titulares, fng: fng?.valor ?? null, estrategia: est,
    })
    if (hodl === null && hora.hodl !== null) await repo.guardarHodl(db, sim.id, hora.hodl)
    for (const [i, decision] of hora.decisiones.entries()) {
      const eventos = hora.eventos.filter((e) => e.simbolo === decision.simbolo)
      try {
        await repo.guardarPasoMoneda(db, {
          simulacionId: sim.id, version: sim.estrategia_version, decision, senal: hora.senales[i], eventos,
          ultimaRevisada: hora.estado.ultimaRevisada[decision.simbolo], ahora,
        })
        operaciones += eventos.length
      } catch (e) {
        if (/UNIQUE constraint failed: decisiones/.test(mensaje(e))) repetidas.push(decision.simbolo)
        else fallos.push(`bot ${prefijo(sim)}${decision.simbolo}: ${mensaje(e)}`)
      }
    }
    simulaciones.push({ id: sim.id, version: sim.estrategia_version, senales: hora.senales, operaciones, repetidas, hodl: hora.hodl })
  }

  /** @type {Record<string, number>} */
  const precios = {}
  for (const e of entradas) {
    const p = ultimoCierre(e.velasEur, ahora)
    if (p !== null) precios[e.simbolo] = p
  }
  /** @type {import('../repositorio.js').PuntoCapital[]} */
  const puntos = []
  for (const [i, { sim, estado: final }] of (await repo.cargarEstados(db, ids, parametrosDe)).entries()) {
    const sinPrecio = Object.keys(final.posiciones).filter((s) => !(s in precios))
    if (sinPrecio.length > 0) {
      fallos.push(`capital${sims.length > 1 ? ` ${sim.estrategia_version}` : ''}: sin precio EUR de ${sinPrecio.join(', ')}`)
      continue
    }
    const hodlFinal = simulaciones[i].hodl
    puntos.push({
      simulacionId: sim.id,
      vela: velaDeDecision(ahora),
      valorCartera: valorCartera(final, precios),
      saldo: final.saldo,
      valorHodl: hodlFinal && Object.keys(hodlFinal).every((s) => s in precios) ? valorHodl(hodlFinal, precios) : null,
    })
  }
  await repo.guardarCapitales(db, puntos)
  return { simulaciones: simulaciones.map(({ hodl: _, ...s }) => s), fallos }
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof globalThis.fetch, ahora: number, manual?: boolean, idEjecucion?: number, esperar?: (ms: number) => Promise<void>,
 *   vivo?: import('../vivo.js').Vivo }} deps
 *   manual: true para POST /api/analizar (refresca señales con la estrategia principal; nunca crea simulaciones ni opera).
 *   idEjecucion: fila de ejecuciones ya reservada (repo.reservarManual); si no viene, se crea.
 *   esperar: pausas del límite de ritmo de OKX (por defecto, setTimeout).
 *   vivo: estrategias en vivo (por defecto, las de core/estrategias.js).
 */
export async function ejecutarMercado({ env, fetch: fetchExterno, ahora, manual = false, idEjecucion, esperar, vivo = VIVO }) {
  const db = env.DB
  let subpeticiones = 0
  /** @type {typeof globalThis.fetch} */
  const fetch = (entrada, init) => {
    subpeticiones++
    return init === undefined ? fetchExterno(entrada) : fetchExterno(entrada, init)
  }
  const tipo = manual ? 'manual' : 'mercado'
  const id = idEjecucion ?? await repo.iniciarEjecucion(db, tipo, ahora)
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  let repetidas = []
  /** @type {{ id: number, version: string, operaciones: number, repetidas: string[] }[]} */
  let resumenSims = []
  try {
    const monedas = leerMonedas(env.MONEDAS)
    const sims = manual ? [] : await repo.sincronizarSimulaciones(db, { versiones: vivo.versiones, capitalInicial: CAPITAL_POR_DEFECTO, ahora })
    const principal = vivo.estrategia(vivo.principal)
    const llmExternos = proveedores(env, fetch).filter((p) => p.motor !== 'cf').length
    const datos = await recogerDatos({ db, fetch, monedas, ahora, esperar, llmExternos })
    fallos.push(...datos.fallos)
    const titulares = await repo.titularesParaEstrategia(db, ahora - 24 * HORA, ahora)
    /** @type {Senal[]} */
    let senales
    let operaciones = 0
    if (manual) {
      senales = datos.entradas.map((e) => principal.calcularSenal({
        simbolo: e.simbolo, ahora, velas: e.velas, derivados: e.derivados, titulares, fng: datos.fng?.valor ?? null,
      }))
    } else {
      const r = await operar(db, { sims, estrategiaDe: vivo.estrategia, entradas: datos.entradas, titulares, fng: datos.fng, ahora })
      fallos.push(...r.fallos)
      resumenSims = r.simulaciones.map(({ senales: _, ...s }) => s)
      senales = /** @type {NonNullable<typeof r.simulaciones[number]>} */ (r.simulaciones.find((s) => s.version === vivo.principal)).senales
      repetidas = [...new Set(r.simulaciones.flatMap((s) => s.repetidas))]
      operaciones = r.simulaciones.reduce((n, s) => n + s.operaciones, 0)
    }
    // El LLM va después del bot (si tarda o falla, las operaciones ya están guardadas) y solo para la principal.
    const { textos, fallos: fallosLlm } = await explicarSenales({ env, fetch, senales })
    fallos.push(...fallosLlm)
    const enriquecidas = senales.map((s, i) => enriquecerSenal(s, datos.entradas[i], ahora, textos[s.simbolo], principal.PARAMETROS_BOT))
    await repo.guardarSenales(db, enriquecidas.map((s) => ({
      simbolo: s.simbolo, calculadaEn: ahora, vela1h: s.vela1h ?? velaDeDecision(ahora), senal: s,
    })))
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, {
      fin,
      ok: true,
      detalle: {
        fallos, repetidas, operaciones, simulacionId: sims.find((s) => s.estrategia_version === vivo.principal)?.id ?? null,
        simulaciones: resumenSims, estrategiaPrincipal: vivo.principal, fng: datos.fng, reintentosOkx: datos.reintentosOkx,
        limitadasOkx: datos.limitadasOkx, velasBybit: datos.velasBybit, subpeticiones,
      },
    })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: true, fallos }, senales: enriquecidas, repetidas, operaciones, simulaciones: resumenSims }
  } catch (e) {
    const error = mensaje(e)
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, { fin, ok: false, detalle: { fallos, repetidas, error } })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: false, fallos }, senales: [], repetidas, operaciones: 0, simulaciones: resumenSims, error }
  }
}
```

Replace the whole content of `worker/src/api.js` with:

```js
// @ts-check
// API JSON del Worker (spec §11). Contrato exacto de cada respuesta: sección «Contrato de la API» del plan 2,
// con los cambios del plan 5 (varias estrategias en vivo y GET /api/bot/comparativa).
// Precios e importes en €, porcentajes como fracción (0,05 = 5 %), instantes en ms desde epoch (UTC).
// No existe ninguna ruta que envíe órdenes a un exchange.
import { calcularMetricas, metricasPorMoneda } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import { cabecerasCors, leerOrigenes, verificarPin } from './auth.js'
import { leerMonedas } from './config.js'
import { ejecutarMercado } from './ejecuciones/mercado.js'
import * as repo from './repositorio.js'
import { VIVO, etiquetaDe } from './vivo.js'

export const TAMANO_PAGINA = 50
export const DECISIONES_MONEDA = 48
export const TITULARES_MONEDA = 50
export const ESPERA_ANALIZAR_MS = 5 * 60_000
export const MARGEN_SALUD_MS = 2 * HORA
export const DATOS_VIEJOS_MS = 2 * HORA
export const CURVA_HORARIA_MS = 30 * 24 * HORA
/** Más puntos que esto (tras submuestrear) se reducen a CURVA_MAXIMA. */
export const CURVA_UMBRAL = 2000
export const CURVA_MAXIMA = 1000
export const CAPITAL_MINIMO = 100
export const CAPITAL_MAXIMO = 1_000_000

/** Error con código HTTP y cuerpo `{ error, detalle, ...extra }`. */
export class ErrorApi extends Error {
  /** @param {number} estado @param {string} codigo @param {string} detalle @param {Record<string, unknown>} [extra] */
  constructor(estado, codigo, detalle, extra = {}) {
    super(detalle)
    this.estado = estado
    this.codigo = codigo
    this.extra = extra
  }
}

/**
 * @typedef {{ env: { DB: repo.D1, ORACLE_PIN?: string, MONEDAS?: string, ORIGENES?: string } & import('./fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number, esperar?: (ms: number) => Promise<void>, vivo?: import('./vivo.js').Vivo }} Deps
 *   vivo: estrategias en vivo (por defecto, las de core/estrategias.js; los tests inyectan otras).
 * @typedef {Deps & { url: URL, peticion: Request, params: string[], vivo: import('./vivo.js').Vivo }} Contexto
 * @typedef {{ estado?: number, cuerpo: unknown }} Respuesta
 */

// ── Conversión de filas a JSON de la API ────────────────────────────────────

/**
 * principal: activa y de la estrategia principal (la del consejo del Panel); etiqueta: nombre de la estrategia.
 * @param {repo.FilaSimulacion} s @param {import('./vivo.js').Vivo} vivo
 */
export const aSimulacion = (s, vivo) => ({
  id: s.id, creadaEn: s.creada_en, cerradaEn: s.cerrada_en, activa: s.activa === 1,
  estrategiaVersion: s.estrategia_version, etiqueta: etiquetaDe(vivo, s.estrategia_version),
  principal: s.activa === 1 && s.estrategia_version === vivo.principal, capitalInicial: s.capital_inicial, saldo: s.saldo,
})

/** Primera frase de un texto (hasta . ! o ? seguido de espacio o fin). @param {string} texto */
export function primeraFrase(texto) {
  const m = /^[\s\S]*?[.!?](?=\s|$)/.exec(texto.trim())
  return m ? m[0] : texto.trim()
}

/** @param {any} s señal guardada en senales_actuales */
export const aSenalResumen = (s) => ({
  simbolo: s.simbolo, veredicto: s.veredicto, indiceConfianza: s.indiceConfianza, puntuacion: s.puntuacion,
  precioEur: s.precioEur, cambio24h: s.cambio24h, fresca: s.fresca, calculadaEn: s.calculadaEn, vela1h: s.vela1h,
  frase: primeraFrase(s.explicacion ?? ''), motorExplicacion: s.motorExplicacion, estrategiaVersion: s.version,
})

/** @param {any} d */
export const aDecision = (d) => ({
  id: d.id, simbolo: d.simbolo, vela1h: d.vela_1h, veredicto: d.veredicto, indiceConfianza: d.indice_confianza,
  puntuacion: d.puntuacion, accion: d.accion, motivo: d.motivo, precio: d.precio,
  estrategiaVersion: d.estrategia_version, creadaEn: d.creada_en,
})

/** @param {any} o */
export const aOperacion = (o) => ({
  id: o.id, posicionId: o.posicion_id, simbolo: o.simbolo, lado: o.lado, vela1h: o.vela_1h, precio: o.precio,
  unidades: o.unidades, importe: o.importe, comision: o.comision, deslizamiento: o.deslizamiento, motivo: o.motivo,
  saldoTras: o.saldo_tras, pnlNeto: o.pnl_neto, estrategiaVersion: o.estrategia_version, creadaEn: o.creada_en,
})

/** @param {any} p @param {number} precioActual */
export function aPosicion(p, precioActual) {
  const valorActual = p.unidades * precioActual
  return {
    id: p.id, simbolo: p.simbolo, velaEntrada: p.vela_entrada, precioEntrada: p.precio_entrada, unidades: p.unidades,
    coste: p.coste, stopLoss: p.stop_loss, takeProfit: p.take_profit, precioActual, valorActual,
    pnlNoRealizado: valorActual - p.coste, pnlNoRealizadoPct: valorActual / p.coste - 1,
  }
}

/** @param {any} t @param {Set<string>} usados */
export const aTitular = (t, usados) => ({
  id: t.id, fuente: t.fuente, origen: t.origen, titulo: t.titulo, url: t.url, publicadoEn: t.publicado_en,
  monedas: t.monedas_json ? JSON.parse(t.monedas_json) : [], puntuacion: t.puntuacion, motor: t.motor, usado: usados.has(t.id),
})

/**
 * Curva para la interfaz: horaria los últimos 30 días y, antes, el último punto de cada día UTC.
 * GET /api/bot la obtiene ya así de D1 (repo.datosBot); esta es la definición de referencia.
 * @param {{ t: number, valor: number, saldo: number, hodl: number|null }[]} puntos ordenados por t
 */
export function submuestrearCurva(puntos) {
  if (puntos.length === 0) return []
  const corte = puntos[puntos.length - 1].t - CURVA_HORARIA_MS
  const dia = 24 * HORA
  return puntos.filter((p, i) => p.t >= corte || Math.floor(p.t / dia) !== Math.floor(puntos[i + 1].t / dia))
}

/**
 * Con más de CURVA_UMBRAL puntos (años de historia), se queda con CURVA_MAXIMA repartidos por igual,
 * siempre con el primero y el último. Con menos, devuelve la misma lista.
 * @template T
 * @param {T[]} puntos
 * @returns {T[]}
 */
export function limitarCurva(puntos) {
  if (puntos.length <= CURVA_UMBRAL) return puntos
  const paso = (puntos.length - 1) / (CURVA_MAXIMA - 1)
  return Array.from({ length: CURVA_MAXIMA }, (_, i) => puntos[Math.round(i * paso)])
}

// ── Parámetros ──────────────────────────────────────────────────────────────

/** @param {URL} url @param {string} nombre @returns {number|null} */
function entero(url, nombre) {
  const valor = url.searchParams.get(nombre)
  if (valor === null || valor === '') return null
  if (!/^\d+$/.test(valor) || Number(valor) < 1 || !Number.isSafeInteger(Number(valor))) {
    throw new ErrorApi(400, 'peticion_invalida', `${nombre} debe ser un entero positivo`)
  }
  return Number(valor)
}

/** @param {URL} url */
function simboloOpcional(url) {
  const s = url.searchParams.get('simbolo')
  if (s === null || s === '') return null
  if (!/^[A-Z0-9]{2,10}$/.test(s)) throw new ErrorApi(400, 'peticion_invalida', 'simbolo no válido')
  return s
}

/**
 * Simulación de ?simulacion= o, si no viene, la activa de la estrategia principal.
 * @param {repo.D1} db @param {URL} url @param {import('./vivo.js').Vivo} vivo
 */
async function simulacionPedida(db, url, vivo) {
  const id = entero(url, 'simulacion')
  const sim = id === null ? await repo.simulacionActiva(db, vivo.principal) : await repo.obtenerSimulacion(db, id)
  if (!sim) throw new ErrorApi(404, 'no_encontrado', id === null ? 'No hay simulación activa' : `No existe la simulación ${id}`)
  return sim
}

/** @param {Request} peticion */
async function cuerpoJson(peticion) {
  try {
    return await peticion.json()
  } catch {
    throw new ErrorApi(400, 'peticion_invalida', 'El cuerpo debe ser JSON')
  }
}

// ── Rutas ───────────────────────────────────────────────────────────────────

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function salud({ env, ahora }) {
  const ultima = await repo.ultimaEjecucion(env.DB, ['mercado'])
  const ok = ultima !== null && ultima.ok === true && ahora - ultima.inicio <= MARGEN_SALUD_MS
  return { estado: ok ? 200 : 503, cuerpo: { ok, ultimaEjecucion: ultima } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function resumen({ env, ahora, vivo }) {
  const db = env.DB
  const [guardadas, fng, sim, ultimaEjecucion, ultimaNoticias] = await Promise.all([
    repo.senalesActuales(db), repo.ultimoFng(db), repo.simulacionActiva(db, vivo.principal),
    repo.ultimaEjecucion(db, ['mercado', 'manual']), repo.ultimaEjecucion(db, ['noticias']),
  ])
  const senales = leerMonedas(env.MONEDAS).filter((m) => guardadas[m]).map((m) => aSenalResumen(guardadas[m]))
  let bot = null
  if (sim) {
    const { capital, abiertas } = await repo.resumenBot(db, sim.id)
    const valorCartera = capital ? capital.valor_cartera : sim.saldo
    const valorHodl = capital ? capital.valor_hodl : null
    bot = {
      simulacionId: sim.id, estrategiaVersion: sim.estrategia_version, capitalInicial: sim.capital_inicial,
      saldo: sim.saldo, valorCartera, valorHodl,
      rentabilidad: valorCartera / sim.capital_inicial - 1,
      rentabilidadHodl: valorHodl === null ? null : valorHodl / sim.capital_inicial - 1,
      posicionesAbiertas: abiertas, actualizadoEn: capital ? capital.vela_1h : null,
    }
  }
  const datosDesactualizados = senales.length === 0
    || senales.some((s) => !s.fresca || ahora - s.calculadaEn > DATOS_VIEJOS_MS)
  const estrategiaPrincipal = {
    version: vivo.principal, etiqueta: etiquetaDe(vivo, vivo.principal), enVivo: vivo.versiones.length,
  }
  return { cuerpo: { ahora, estrategiaPrincipal, senales, fng, bot, ultimaEjecucion, ultimaNoticias, datosDesactualizados } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function moneda({ env, ahora, params, vivo }) {
  const db = env.DB
  const simbolo = params[0].toUpperCase()
  if (!leerMonedas(env.MONEDAS).includes(simbolo)) throw new ErrorApi(404, 'no_encontrado', `Moneda no seguida: ${simbolo}`)
  const [guardadas, sim] = await Promise.all([repo.senalesActuales(db), repo.simulacionActiva(db, vivo.principal)])
  const senal = guardadas[simbolo] ?? null
  const hasta = senal?.calculadaEn ?? ahora
  const usados = new Set(Array.isArray(senal?.detalle?.noticias) ? senal.detalle.noticias : [])
  const [titulares, decisiones] = await Promise.all([
    repo.titularesDeMoneda(db, simbolo, hasta - 24 * HORA, hasta, TITULARES_MONEDA),
    sim ? repo.pagina(db, 'decisiones', { simulacionId: sim.id, simbolo, cursor: null, limite: DECISIONES_MONEDA }) : null,
  ])
  return {
    cuerpo: {
      simbolo, senal, titulares: titulares.map((t) => aTitular(t, usados)),
      decisiones: decisiones ? decisiones.filas.map(aDecision) : [],
    },
  }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function bot({ env, url, vivo }) {
  const sim = await simulacionPedida(env.DB, url, vivo)
  const d = await repo.datosBot(env.DB, sim.id, CURVA_HORARIA_MS)
  const abiertas = d.abiertas.map((p) => aPosicion(p, p.precio_actual ?? p.precio_entrada))
  const operaciones = d.operaciones.map((o) => ({
    tipo: o.lado, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnl_neto ?? undefined,
  }))
  const curva = d.curva.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
  const metricas = calcularMetricas({
    capitalInicial: sim.capital_inicial, saldo: sim.saldo,
    abiertas: abiertas.map((p) => ({ unidades: p.unidades, coste: p.coste, precioActual: p.precioActual })),
    operaciones, resumenCurva: d.resumenCurva,
  })
  return {
    cuerpo: {
      simulacion: aSimulacion(sim, vivo), metricas, porMoneda: metricasPorMoneda(operaciones), abiertas,
      curva: limitarCurva(curva), hodl: sim.hodl_json ? JSON.parse(sim.hodl_json) : null,
    },
  }
}

/** @param {'decisiones'|'operaciones'} tabla */
const paginada = (tabla) => /** @param {Contexto} c @returns {Promise<Respuesta>} */ async ({ env, url, vivo }) => {
  const sim = await simulacionPedida(env.DB, url, vivo)
  const { filas, siguienteCursor } = await repo.pagina(env.DB, tabla, {
    simulacionId: sim.id, simbolo: simboloOpcional(url), cursor: entero(url, 'cursor'), limite: TAMANO_PAGINA,
  })
  return { cuerpo: { items: filas.map(tabla === 'decisiones' ? aDecision : aOperacion), siguienteCursor } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function simulaciones({ env, vivo }) {
  return { cuerpo: { items: (await repo.listarSimulaciones(env.DB)).map((s) => aSimulacion(s, vivo)) } }
}

/**
 * Comparativa de las simulaciones activas, en el orden de las estrategias en vivo: valor, rentabilidad, caída
 * máxima, operaciones y curva (submuestreada como la de GET /api/bot) de cada una, más la curva de comprar y
 * mantener de la principal (todas empiezan con el mismo capital en el mismo instante). Sin simulaciones activas
 * (antes del primer cron), listas vacías.
 * @param {Contexto} c @returns {Promise<Respuesta>}
 */
async function comparativa({ env, ahora, vivo }) {
  const activas = await repo.simulacionesActivas(env.DB)
  const sims = vivo.versiones.flatMap((v) => activas.filter((s) => s.estrategia_version === v))
  const datos = await repo.datosComparativa(env.DB, sims.map((s) => s.id), CURVA_HORARIA_MS)
  const simulaciones = sims.map((sim, i) => {
    const { ultimo, operaciones, curva } = datos[i]
    const valorCartera = ultimo ? ultimo.valor_cartera : sim.saldo
    return {
      id: sim.id, estrategiaVersion: sim.estrategia_version, etiqueta: etiquetaDe(vivo, sim.estrategia_version),
      principal: sim.estrategia_version === vivo.principal, capitalInicial: sim.capital_inicial, valorCartera,
      rentabilidad: valorCartera / sim.capital_inicial - 1, drawdownMaximo: ultimo ? ultimo.drawdown : 0, operaciones,
      curva: limitarCurva(curva.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera }))),
    }
  })
  const i = sims.findIndex((s) => s.estrategia_version === vivo.principal)
  const base = i === -1 ? null : { sim: sims[i], ...datos[i] }
  const ultimoHodl = base?.ultimo?.ultimo_hodl ?? null
  const hodl = base ? limitarCurva(base.curva.filter((c) => c.valor_hodl !== null).map((c) => ({ t: c.vela_1h, valor: c.valor_hodl }))) : []
  const resumenHodl = base && ultimoHodl !== null
    ? { valor: ultimoHodl, rentabilidad: ultimoHodl / base.sim.capital_inicial - 1, drawdownMaximo: base.ultimo.drawdown_hodl }
    : null
  return { cuerpo: { ahora, simulaciones, hodl, resumenHodl } }
}

/**
 * Reinicia el bot: cierra todas las simulaciones activas (se conservan) y abre una por cada estrategia en vivo,
 * todas con el capital pedido. `simulacion` es la nueva de la principal; `simulaciones`, todas las nuevas.
 * @param {Contexto} c @returns {Promise<Respuesta>}
 */
async function reiniciar({ env, ahora, peticion, vivo }) {
  const cuerpo = await cuerpoJson(peticion)
  if (cuerpo?.confirmar !== true) throw new ErrorApi(400, 'peticion_invalida', 'Falta confirmar: true')
  const capital = cuerpo.capital_inicial
  if (typeof capital !== 'number' || !Number.isFinite(capital) || capital < CAPITAL_MINIMO || capital > CAPITAL_MAXIMO) {
    throw new ErrorApi(400, 'peticion_invalida', `capital_inicial debe ser un número entre ${CAPITAL_MINIMO} y ${CAPITAL_MAXIMO}`)
  }
  const nuevas = await repo.reiniciarSimulaciones(env.DB, { capitalInicial: capital, versiones: vivo.versiones, ahora })
  const principal = /** @type {repo.FilaSimulacion} */ (nuevas.find((s) => s.estrategia_version === vivo.principal))
  return { estado: 201, cuerpo: { simulacion: aSimulacion(principal, vivo), simulaciones: nuevas.map((s) => aSimulacion(s, vivo)) } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function analizar({ env, fetch, ahora, esperar, vivo }) {
  const id = await repo.reservarManual(env.DB, ahora, ESPERA_ANALIZAR_MS)
  if (id === null) {
    const previa = await repo.ultimaEjecucion(env.DB, ['manual'])
    throw new ErrorApi(429, 'demasiado_pronto', 'Solo se puede analizar una vez cada 5 minutos.', {
      hasta: (previa?.inicio ?? ahora) + ESPERA_ANALIZAR_MS,
    })
  }
  const r = await ejecutarMercado({ env, fetch, ahora, manual: true, idEjecucion: id, esperar, vivo })
  if (!r.ejecucion.ok) throw new ErrorApi(502, 'analisis_fallido', r.error ?? 'El análisis falló')
  return { cuerpo: { senales: r.senales.map(aSenalResumen), ejecucion: r.ejecucion } }
}

/** @type {{ metodo: string, patron: RegExp, publica?: boolean, manejar: (c: Contexto) => Promise<Respuesta> }[]} */
const RUTAS = [
  { metodo: 'GET', patron: /^\/api\/salud$/, publica: true, manejar: salud },
  { metodo: 'GET', patron: /^\/api\/resumen$/, manejar: resumen },
  { metodo: 'GET', patron: /^\/api\/moneda\/([A-Za-z0-9]{2,10})$/, manejar: moneda },
  { metodo: 'GET', patron: /^\/api\/bot$/, manejar: bot },
  { metodo: 'GET', patron: /^\/api\/bot\/comparativa$/, manejar: comparativa },
  { metodo: 'GET', patron: /^\/api\/bot\/operaciones$/, manejar: paginada('operaciones') },
  { metodo: 'GET', patron: /^\/api\/bot\/decisiones$/, manejar: paginada('decisiones') },
  { metodo: 'GET', patron: /^\/api\/simulaciones$/, manejar: simulaciones },
  { metodo: 'POST', patron: /^\/api\/bot\/reiniciar$/, manejar: reiniciar },
  { metodo: 'POST', patron: /^\/api\/analizar$/, manejar: analizar },
]

/**
 * Atiende una petición HTTP. Nunca lanza: cualquier error se devuelve como JSON `{ error, detalle }`.
 * @param {Request} peticion
 * @param {Deps} deps
 * @returns {Promise<Response>}
 */
export async function atender(peticion, deps) {
  const cors = cabecerasCors(peticion.headers.get('Origin'), leerOrigenes(deps.env.ORIGENES))
  /** @param {unknown} cuerpo @param {number} [estado] */
  const responder = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
  if (peticion.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(peticion.url)
  const candidatas = RUTAS.filter((r) => r.patron.test(url.pathname))
  if (candidatas.length === 0) return responder({ error: 'no_encontrado', detalle: `No existe ${url.pathname}` }, 404)
  const ruta = candidatas.find((r) => r.metodo === peticion.method)
  if (!ruta) return responder({ error: 'metodo_no_permitido', detalle: `${peticion.method} no se admite en ${url.pathname}` }, 405)
  try {
    if (!ruta.publica) {
      const pin = await verificarPin(deps.env.DB, peticion, deps.env.ORACLE_PIN, deps.ahora)
      if (!pin.ok) return responder(pin.cuerpo, pin.estado)
    }
    const params = /** @type {RegExpExecArray} */ (ruta.patron.exec(url.pathname)).slice(1)
    const r = await ruta.manejar({ ...deps, vivo: deps.vivo ?? VIVO, url, peticion, params })
    return responder(r.cuerpo, r.estado ?? 200)
  } catch (e) {
    if (e instanceof ErrorApi) return responder({ error: e.codigo, detalle: e.message, ...e.extra }, e.estado)
    return responder({ error: 'interno', detalle: e instanceof Error ? e.message : String(e) }, 500)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/multisim.test.js worker/test/api-multisim.test.js`
Expected: PASS — 17 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +17 tests (417 sobre la base `0d5341d`; los de `mercado`, `api` y `repositorio` cambian pero no suman)

- [ ] **Step 5: Commit**

```bash
git add worker/src/repositorio.js worker/src/ejecuciones/mercado.js worker/src/api.js worker/test/multisim.test.js worker/test/api-multisim.test.js worker/test/mercado.test.js worker/test/api.test.js worker/test/repositorio.test.js test/pwa/ayudantes.js
git commit -m "feat(worker): una simulación por estrategia en vivo y GET /api/bot/comparativa" -m "El cron descarga una vez, sincroniza las simulaciones y opera cada una con su estrategia; señales y LLM de la principal." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: PWA — cliente de la comparativa y funciones puras

**Files:**
- Create: `test/pwa/multisim.test.js`
- Modify (entero): `js/api.js`, `scripts/api-simulada.mjs`
- Modify (append): `js/series.js`, `js/graficos.js`, `js/cartera.js`

**Interfaces:**
- `api.comparativa(): Promise<Comparativa>` → `GET /api/bot/comparativa`.
- `curvasComparativa(c): { estrategias: { etiqueta: string, puntos: PuntoLinea[] }[], hodl: PuntoLinea[] }` — segundos estrictamente crecientes, sin puntos no numéricos.
- `COLORES_ESTRATEGIAS: readonly string[]`; `graficoComparativa(contenedor, curvas): () => void` — comprar y mantener discontinua (`lineStyle: 2`) y una línea por estrategia.
- `filasComparativa(c): { id: number|null, estrategia, valor, rentabilidad, caida, operaciones, clase, principal }[]` — la principal con «(principal)», comprar y mantener al final con `id: null`.
- `textoConsejo(estrategiaPrincipal): string` — `''` si no viene (Worker anterior).

- [ ] **Step 1: Write the failing test**

Create `test/pwa/multisim.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { afterEach, describe, test } from 'node:test'
import { MAX_EN_VUELO, crearApi } from '../../js/api.js'
import { filasComparativa, textoConsejo } from '../../js/cartera.js'
import { COLORES, COLORES_ESTRATEGIAS, graficoComparativa } from '../../js/graficos.js'
import { curvasComparativa } from '../../js/series.js'
import { vivoDePrueba } from '../../worker/test/vivo.js'
import { BASE, PIN, workerSimulado } from './ayudantes.js'
import { leer } from './modulos.js'

const ESP = '\u00a0'

/** Worker con 3 estrategias de prueba en vivo (la principal, v2) y su cliente. */
async function conTres() {
  const w = await workerSimulado({ vivo: vivoDePrueba(['v1', 'v2', 'v1b'], 'v2') })
  return { w, api: crearApi({ base: BASE, fetch: w.fetch, pin: () => PIN }) }
}

describe('comparativa de estrategias en la interfaz', () => {
  afterEach(() => { delete (/** @type {any} */ (globalThis)).LightweightCharts })

  test('api.comparativa() contra el Worker real: ruta y forma del contrato', async () => {
    const { w, api } = await conTres()
    const c = await api.comparativa()
    assert.equal(w.llamadas[0].url, `${BASE}/api/bot/comparativa`)
    assert.deepEqual(Object.keys(c), ['ahora', 'simulaciones', 'hodl', 'resumenHodl'])
    assert.deepEqual(c.simulaciones.map((/** @type {any} */ s) => [s.estrategiaVersion, s.etiqueta, s.principal]), [
      ['v1', 'v1', false], ['v2', 'v2', true], ['v1b', 'v1 al 10 %', false],
    ])
    assert.ok(c.simulaciones.every((/** @type {any} */ s) => s.curva.length === 6 && s.curva.every((/** @type {any} */ p) => Object.keys(p).join() === 't,valor')))
    assert.equal(c.hodl.length, 6)
  })

  test('curvasComparativa: una línea por estrategia y comprar y mantener, en segundos crecientes y sin repetidos', async () => {
    const { api } = await conTres()
    const c = await api.comparativa()
    const curvas = curvasComparativa(c)
    assert.deepEqual(curvas.estrategias.map((e) => e.etiqueta), ['v1', 'v2', 'v1 al 10 %'])
    for (const [i, e] of curvas.estrategias.entries()) {
      assert.deepEqual(e.puntos, c.simulaciones[i].curva.map((/** @type {any} */ p) => ({ time: p.t / 1000, value: p.valor })))
    }
    assert.deepEqual(curvas.hodl.map((p) => p.value), c.hodl.map((/** @type {any} */ p) => p.valor))
    const raro = curvasComparativa({
      simulaciones: [{ estrategiaVersion: 'v9', curva: [{ t: 2000, valor: 2 }, { t: 1000, valor: 1 }, { t: 2500, valor: 3 }, { t: 3000, valor: Number.NaN }] }],
    })
    assert.deepEqual(raro, { estrategias: [{ etiqueta: 'v9', puntos: [{ time: 1, value: 1 }, { time: 2, value: 3 }] }], hodl: [] })
    assert.deepEqual(curvasComparativa({}), { estrategias: [], hodl: [] })
  })

  test('filasComparativa: una fila por estrategia (la principal marcada) y comprar y mantener al final', async () => {
    const { api } = await conTres()
    const c = await api.comparativa()
    const filas = filasComparativa(c)
    assert.deepEqual(filas.map((f) => [f.id, f.estrategia, f.principal]), [
      [1, 'v1', false], [2, 'v2 (principal)', true], [3, 'v1b · v1 al 10 %', false], [null, 'Comprar y mantener', false],
    ])
    assert.match(filas[0].valor, new RegExp(`^\\d{1,2}\\.\\d{3},\\d\\d${ESP}€$`))
    assert.match(filas[0].rentabilidad, new RegExp(`^[+-]?\\d+,\\d\\d${ESP}%$`))
    assert.equal(filas[0].operaciones, String(c.simulaciones[0].operaciones))
    assert.equal(filas[3].operaciones, '—')
    assert.deepEqual(filasComparativa({
      simulaciones: [{ id: 7, estrategiaVersion: 'v3', etiqueta: 'v3', principal: true, valorCartera: 10_000, rentabilidad: 0, drawdownMaximo: 0.1234, operaciones: 0 }],
      resumenHodl: null,
    }), [{
      id: 7, estrategia: 'v3 (principal)', valor: `10.000,00${ESP}€`, rentabilidad: `0,00${ESP}%`, caida: `-12,34${ESP}%`, operaciones: '0', clase: 'neutro', principal: true,
    }])
    assert.deepEqual(filasComparativa(null), [])
  })

  test('graficoComparativa: comprar y mantener discontinua y una línea por estrategia con su color, en euros, encuadrado', () => {
    /** @type {{ op: any, datos: any[] }[]} */
    const series = []
    let ajustado = false
    let eliminado = false
    const grafico = {
      addSeries: (/** @type {string} */ _def, /** @type {any} */ op) => {
        const s = { op, datos: /** @type {any[]} */ ([]) }
        series.push(s)
        return { setData: (/** @type {any[]} */ d) => { s.datos = d } }
      },
      timeScale: () => ({ fitContent: () => { ajustado = true } }),
      remove: () => { eliminado = true },
    }
    Object.assign(globalThis, { LightweightCharts: { LineSeries: 'linea', createChart: () => grafico } })
    const curvas = {
      estrategias: ['v3', 'v4', 'v5'].map((etiqueta, i) => ({ etiqueta, puntos: [{ time: 1, value: 10_000 }, { time: 2, value: 10_000 + i }] })),
      hodl: [{ time: 1, value: 10_000 }, { time: 2, value: 9_000 }],
    }
    const limpiar = graficoComparativa(/** @type {any} */ ({}), curvas)
    assert.deepEqual(series.map((s) => s.op.title), ['Comprar y mantener', 'v3', 'v4', 'v5'])
    assert.deepEqual(series.map((s) => s.op.color), [COLORES.hodl, ...COLORES_ESTRATEGIAS.slice(0, 3)])
    assert.equal(series[0].op.lineStyle, 2)
    assert.deepEqual(series[2].datos, curvas.estrategias[1].puntos)
    assert.equal(series[1].op.priceFormat.formatter(10085.4), '10.085')
    assert.equal(ajustado, true)
    limpiar()
    assert.equal(eliminado, true)
  })

  test('textoConsejo: el Panel dice qué estrategia da el consejo', async () => {
    const { api } = await conTres()
    const r = await api.resumen()
    assert.deepEqual(r.estrategiaPrincipal, { version: 'v2', etiqueta: 'v2', enVivo: 3 })
    assert.equal(textoConsejo(r.estrategiaPrincipal), 'Consejo de la estrategia v2, la principal de las 3 en vivo.')
    assert.equal(textoConsejo({ version: 'v3', etiqueta: 'Ruptura 55/20', enVivo: 1 }), 'Consejo de la estrategia v3 (Ruptura 55/20).')
    assert.equal(textoConsejo(undefined), '')
  })

  test('reiniciar con 3 estrategias: 3 nuevas con el mismo capital; simulacion es la nueva principal', async () => {
    const { api } = await conTres()
    const r = await api.reiniciar(5000)
    assert.deepEqual(r.simulaciones.map((/** @type {any} */ s) => [s.estrategiaVersion, s.capitalInicial, s.activa]), [
      ['v1', 5000, true], ['v2', 5000, true], ['v1b', 5000, true],
    ])
    assert.equal(r.simulacion.estrategiaVersion, 'v2')
    const sims = (await api.simulaciones()).items
    assert.equal(sims.filter((/** @type {any} */ s) => s.activa).length, 3)
    assert.equal(sims.filter((/** @type {any} */ s) => !s.activa).length, 3)
  })

  test(`la vista Bot (comparativa, bot y 3 a la vez) refrescada varias veces: nunca más de ${MAX_EN_VUELO} en vuelo`, async () => {
    let enVuelo = 0
    let maximo = 0
    /** @type {string[]} */
    const rutas = []
    const api = crearApi({
      base: BASE, pin: () => PIN,
      fetch: async (url) => {
        rutas.push(new URL(String(url)).pathname)
        enVuelo++
        maximo = Math.max(maximo, enVuelo)
        await new Promise((r) => setTimeout(r, 2))
        enVuelo--
        return new Response('{"ok":true}')
      },
    })
    for (let i = 0; i < 3; i++) {
      await api.comparativa()
      await api.bot()
      await Promise.all([api.simulaciones(), api.operaciones({ simulacion: 1 }), api.decisiones({ simulacion: 1 })])
    }
    assert.equal(rutas.length, 15)
    assert.equal(rutas[0], '/api/bot/comparativa')
    assert.equal(maximo, MAX_EN_VUELO)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/multisim.test.js`
Expected: FAIL — `does not provide an export named 'COLORES_ESTRATEGIAS'`

- [ ] **Step 3: Write the implementation**

Replace the whole content of `js/api.js` with:

```js
// @ts-check
// Cliente de la API del Worker («Contrato de la API» del plan 2). fetch inyectado: en los tests, el propio Worker.
import { hora } from './formato.js'

/** Error de la API con el cuerpo `{ error, detalle, hasta?, reintentar_en? }` del Worker. estado 0 = sin respuesta. */
export class ErrorApi extends Error {
  /** @param {number} estado @param {string} codigo @param {string} detalle @param {number|null} [hasta] */
  constructor(estado, codigo, detalle, hasta = null) {
    super(detalle)
    this.name = 'ErrorApi'
    this.estado = estado
    this.codigo = codigo
    this.hasta = hasta
    /** @type {number|null} ms que pide esperar el Worker antes de reintentar (429 `ocupado`) */
    this.reintentarEn = null
  }
}

/** @typedef {Record<string, string|number|null|undefined>} Consulta */

/** Peticiones a la vez como mucho: el Worker reserva un intento de PIN por cada petición en vuelo (5 por IP). */
export const MAX_EN_VUELO = 2
/** Reintentos automáticos ante 429 `ocupado` (otros intentos de PIN en vuelo; no es un bloqueo). */
export const MAX_REINTENTOS_OCUPADO = 3
/** Espera por defecto antes de reintentar si el Worker no dice `reintentar_en`. */
export const REINTENTO_MS = 2000
/** Plazo de cada petición; /api/analizar tarda 25-35 s (descarga y analiza las 5 monedas). */
export const PLAZO_MS = 20_000
export const PLAZO_ANALIZAR_MS = 60_000

/** @param {number} ms */
const esperarMs = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Semáforo FIFO: como mucho `max` tareas a la vez. `ocupadas()` cuenta los huecos en uso.
 * @param {number} max
 */
export function crearLimitador(max) {
  let activas = 0
  /** @type {(() => void)[]} */
  const cola = []
  // El hueco pasa directamente a la siguiente en cola (el contador no cambia); solo se libera si nadie espera.
  const soltar = () => {
    const siguiente = cola.shift()
    if (siguiente) siguiente()
    else activas--
  }
  /**
   * @template T
   * @param {() => Promise<T>} tarea
   * @returns {Promise<T>}
   */
  async function limitar(tarea) {
    if (activas >= max) await new Promise((r) => cola.push(() => r(undefined)))
    else activas++
    try {
      return await tarea()
    } finally {
      soltar()
    }
  }
  return Object.assign(limitar, { ocupadas: () => activas })
}

/**
 * @param {{ base: string, fetch: typeof fetch, pin: () => string|null, esperar?: (ms: number) => Promise<void>,
 *   maxEnVuelo?: number, plazoMs?: number, plazoAnalizarMs?: number }} op
 */
export function crearApi({
  base, fetch, pin, esperar = esperarMs, maxEnVuelo = MAX_EN_VUELO, plazoMs = PLAZO_MS, plazoAnalizarMs = PLAZO_ANALIZAR_MS,
}) {
  const limitar = crearLimitador(maxEnVuelo)

  /**
   * @param {'GET'|'POST'} metodo
   * @param {string} ruta
   * @param {{ consulta?: Consulta, cuerpo?: unknown, plazo?: number }} [op]
   * @returns {Promise<any>}
   */
  async function pedir(metodo, ruta, { consulta = {}, cuerpo, plazo = plazoMs } = {}) {
    if (!base) throw new ErrorApi(0, 'sin_configurar', 'Falta la URL del Worker en config.js (API_PRODUCCION).')
    const url = new URL(base + ruta)
    for (const [clave, valor] of Object.entries(consulta)) {
      if (valor !== null && valor !== undefined && valor !== '') url.searchParams.set(clave, String(valor))
    }
    for (let intento = 0; ; intento++) {
      try {
        return await limitar(() => unaVez(metodo, url, cuerpo, plazo))
      } catch (e) {
        if (!(e instanceof ErrorApi) || e.codigo !== 'ocupado' || intento >= MAX_REINTENTOS_OCUPADO) throw e
        await esperar(e.reintentarEn ?? REINTENTO_MS)
      }
    }
  }

  /**
   * Una petición con su plazo, ya dentro del limitador.
   * @param {'GET'|'POST'} metodo @param {URL} url @param {unknown} cuerpo @param {number} plazo
   * @returns {Promise<any>}
   */
  async function unaVez(metodo, url, cuerpo, plazo) {
    // Sin PIN (sesión cerrada mientras esperaba turno) no se llama: el Worker contaría un intento fallido.
    const clave = pin()
    if (!clave) throw new ErrorApi(401, 'sin_sesion', 'Introduce el PIN para continuar.')
    /** @type {Record<string, string>} */
    const cabeceras = { Authorization: `Bearer ${clave}` }
    if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json'
    const control = new AbortController()
    let agotado = false
    const temporizador = setTimeout(() => {
      agotado = true
      control.abort()
    }, plazo)
    let respuesta
    /** @type {any} */
    let datos = null
    try {
      try {
        respuesta = await fetch(url.href, {
          method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo), signal: control.signal,
        })
      } catch {
        if (agotado) throw new ErrorApi(0, 'tiempo', `El servidor no respondió en ${Math.round(plazo / 1000)} s. Vuelve a probar.`)
        throw new ErrorApi(0, 'red', 'No se pudo contactar con el servidor. Comprueba la conexión.')
      }
      try {
        datos = await respuesta.json()
      } catch {
        if (agotado) throw new ErrorApi(0, 'tiempo', `El servidor no respondió en ${Math.round(plazo / 1000)} s. Vuelve a probar.`)
        datos = null
      }
    } finally {
      clearTimeout(temporizador)
    }
    if (!respuesta.ok) {
      const error = new ErrorApi(respuesta.status, datos?.error ?? 'http', datos?.detalle ?? `Error ${respuesta.status} del servidor.`,
        typeof datos?.hasta === 'number' ? datos.hasta : null)
      if (typeof datos?.reintentar_en === 'number') error.reintentarEn = Math.min(Math.max(datos.reintentar_en, 0.5), 10) * 1000
      throw error
    }
    if (datos === null || typeof datos !== 'object') throw new ErrorApi(respuesta.status, 'respuesta_invalida', 'Respuesta no válida del servidor.')
    return datos
  }

  return {
    resumen: () => pedir('GET', '/api/resumen'),
    /** @param {string} simbolo */
    moneda: (simbolo) => pedir('GET', `/api/moneda/${encodeURIComponent(simbolo)}`),
    /** @param {number|null} [simulacion] sin valor: la activa de la estrategia principal */
    bot: (simulacion = null) => pedir('GET', '/api/bot', { consulta: { simulacion } }),
    /** Simulaciones activas lado a lado: métricas, curvas y comprar y mantener (una por estrategia en vivo). */
    comparativa: () => pedir('GET', '/api/bot/comparativa'),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    operaciones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/operaciones', { consulta: { simulacion, simbolo, cursor } }),
    /** @param {{ simulacion?: number|null, simbolo?: string|null, cursor?: number|null }} [op] */
    decisiones: ({ simulacion = null, simbolo = null, cursor = null } = {}) =>
      pedir('GET', '/api/bot/decisiones', { consulta: { simulacion, simbolo, cursor } }),
    simulaciones: () => pedir('GET', '/api/simulaciones'),
    /** Cierra todas las simulaciones activas y abre una por estrategia en vivo. @param {number} capitalInicial */
    reiniciar: (capitalInicial) => pedir('POST', '/api/bot/reiniciar', { cuerpo: { capital_inicial: capitalInicial, confirmar: true } }),
    analizar: () => pedir('POST', '/api/analizar', { plazo: plazoAnalizarMs }),
  }
}

/** @typedef {ReturnType<typeof crearApi>} Api */

/**
 * El error obliga a volver a pedir el PIN: incorrecto o sin sesión (401).
 * @param {unknown} e
 */
export const pideLogin = (e) => e instanceof ErrorApi && e.estado === 401

/**
 * Acceso bloqueado (429 `bloqueado`, por IP o global). No dice que el PIN guardado sea malo: se conserva.
 * @param {unknown} e
 */
export const esBloqueo = (e) => e instanceof ErrorApi && e.codigo === 'bloqueado'

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
    return `Solo se puede analizar una vez cada 5 minutos.${e.hasta ? ` Espera hasta las ${hora(e.hasta)}.` : ''}`
  }
  return e.message
}
```

Append to the end of `js/series.js`:

```js

/**
 * Puntos { t (ms), valor } → línea del gráfico en segundos estrictamente crecientes (si se repite un segundo,
 * gana el último punto). Descarta puntos sin número.
 * @param {{ t: number, valor: number }[]} puntos
 * @returns {PuntoLinea[]}
 */
function lineaDeCurva(puntos) {
  /** @type {Map<number, number>} */
  const porTiempo = new Map()
  for (const p of puntos) if (Number.isFinite(p?.t) && Number.isFinite(p?.valor)) porTiempo.set(aSegundos(p.t), p.valor)
  return [...porTiempo.keys()].sort((a, b) => a - b).map((time) => ({ time, value: /** @type {number} */ (porTiempo.get(time)) }))
}

/**
 * Curvas de GET /api/bot/comparativa para el gráfico: una línea por simulación (en el orden de la API) y la de
 * comprar y mantener.
 * @param {{ simulaciones?: { estrategiaVersion: string, etiqueta?: string, curva?: { t: number, valor: number }[] }[],
 *   hodl?: { t: number, valor: number }[] }} c
 * @returns {{ estrategias: { etiqueta: string, puntos: PuntoLinea[] }[], hodl: PuntoLinea[] }}
 */
export function curvasComparativa(c) {
  return {
    estrategias: (c.simulaciones ?? []).map((s) => ({ etiqueta: s.etiqueta || s.estrategiaVersion, puntos: lineaDeCurva(s.curva ?? []) })),
    hodl: lineaDeCurva(c.hodl ?? []),
  }
}
```

Append to the end of `js/graficos.js`:

```js

/** Colores de las estrategias de la comparativa, en orden (comprar y mantener usa COLORES.hodl, discontinua). */
export const COLORES_ESTRATEGIAS = Object.freeze(['#2dd4bf', '#60a5fa', '#c084fc', '#f472b6'])

/**
 * Curvas de capital de las estrategias en vivo y la de comprar y mantener, en el mismo gráfico.
 * @param {HTMLElement} contenedor
 * @param {ReturnType<typeof import('./series.js').curvasComparativa>} curvas
 * @returns {() => void} limpieza
 */
export function graficoComparativa(contenedor, curvas) {
  const L = libreria()
  const grafico = L.createChart(contenedor, opcionesBase())
  const euros = formatoNumero(0)
  if (curvas.hodl.length > 0) {
    grafico.addSeries(L.LineSeries, {
      lineWidth: 2, lineStyle: 2, color: COLORES.hodl, priceLineVisible: false, priceFormat: euros, title: 'Comprar y mantener',
    }).setData(curvas.hodl)
  }
  curvas.estrategias.forEach((e, i) => {
    grafico.addSeries(L.LineSeries, {
      lineWidth: 2, color: COLORES_ESTRATEGIAS[i % COLORES_ESTRATEGIAS.length], priceLineVisible: false, priceFormat: euros, title: e.etiqueta,
    }).setData(e.puntos)
  })
  grafico.timeScale().fitContent()
  return () => grafico.remove()
}
```

Append to the end of `js/cartera.js`:

```js

/**
 * Filas de la tabla de la comparativa (GET /api/bot/comparativa): una por simulación activa, en el orden de la API,
 * y al final comprar y mantener. `id` (null en comprar y mantener) sirve para enlazar el detalle.
 * @param {any} c
 * @returns {{ id: number|null, estrategia: string, valor: string, rentabilidad: string, caida: string, operaciones: string,
 *   clase: string, principal: boolean }[]}
 */
export function filasComparativa(c) {
  const filas = (Array.isArray(c?.simulaciones) ? c.simulaciones : []).map((/** @type {any} */ s) => ({
    id: s.id,
    estrategia: `${s.etiqueta && s.etiqueta !== s.estrategiaVersion ? `${s.estrategiaVersion} · ${s.etiqueta}` : s.estrategiaVersion}`
      + `${s.principal ? ' (principal)' : ''}`,
    valor: euros(s.valorCartera),
    rentabilidad: porcentaje(s.rentabilidad, { signo: true }),
    caida: porcentaje(caida(s.drawdownMaximo)),
    operaciones: entero(s.operaciones),
    clase: claseSigno(s.rentabilidad),
    principal: s.principal === true,
  }))
  const hodl = c?.resumenHodl
  if (hodl) {
    filas.push({
      id: null, estrategia: 'Comprar y mantener', valor: euros(hodl.valor), rentabilidad: porcentaje(hodl.rentabilidad, { signo: true }),
      caida: porcentaje(caida(hodl.drawdownMaximo)), operaciones: '—', clase: claseSigno(hodl.rentabilidad), principal: false,
    })
  }
  return filas
}

/**
 * Qué estrategia da el consejo del Panel (`estrategiaPrincipal` de GET /api/resumen). '' si no viene (Worker anterior).
 * @param {any} principal { version, etiqueta, enVivo }
 */
export function textoConsejo(principal) {
  if (typeof principal?.version !== 'string' || principal.version === '') return ''
  const nombre = principal.etiqueta && principal.etiqueta !== principal.version ? `${principal.version} (${principal.etiqueta})` : principal.version
  const enVivo = typeof principal.enVivo === 'number' && principal.enVivo > 1 ? `, la principal de las ${principal.enVivo} en vivo` : ''
  return `Consejo de la estrategia ${nombre}${enVivo}.`
}
```

`npm run api-simulada` (solo desarrollo, `127.0.0.1`) arranca con las 3 estrategias de prueba para ver la comparativa en local:

Replace the whole content of `scripts/api-simulada.mjs` with:

```js
// @ts-check
// API simulada para probar la PWA sin desplegar ni usar wrangler: el Worker real (worker/src/api.js) sobre
// D1 en memoria (node:sqlite) con 6 horas del escenario SINTÉTICO de los tests (BTC y ETH, precios inventados)
// y 3 estrategias de prueba en vivo (v1, v2 y v1b; la principal, v1) para ver la comparativa del Bot.
// Solo desarrollo: nunca se publica ni la usa la PWA desplegada.
//
//   node scripts/api-simulada.mjs      → http://localhost:8787, PIN 4815162342 (PUERTO=… para cambiarlo)
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { PIN, workerSimulado } from '../test/pwa/ayudantes.js'
import { vivoDePrueba } from '../worker/test/vivo.js'

export const PUERTO = 8787
/** Solo en local: nunca expone la API simulada a la red. */
export const ANFITRION = '127.0.0.1'

/** @param {import('node:http').IncomingMessage} peticion */
async function cuerpoDe(peticion) {
  /** @type {Buffer[]} */
  const trozos = []
  for await (const trozo of peticion) trozos.push(trozo)
  return trozos.length > 0 ? Buffer.concat(trozos) : undefined
}

/** Servidor HTTP que atiende con el Worker simulado. */
export async function crearApiSimulada() {
  const w = await workerSimulado({ vivo: vivoDePrueba(['v1', 'v2', 'v1b'], 'v1') })
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
  servidor.listen(puerto, ANFITRION, () => console.log(`API simulada (datos sintéticos de los tests) en http://localhost:${puerto} · PIN ${PIN}`))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/multisim.test.js`
Expected: PASS — 7 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +7 tests (424 sobre la base `0d5341d`)

- [ ] **Step 5: Commit**

```bash
git add js/api.js js/series.js js/graficos.js js/cartera.js scripts/api-simulada.mjs test/pwa/multisim.test.js
git commit -m "feat(pwa): cliente de la comparativa, curvas, filas, gráfico y consejo" -m "Funciones puras probadas contra el Worker real con 3 estrategias de prueba." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: PWA — Bot con la comparativa, Panel con la estrategia y tablas apilables

**Files:**
- Create: `test/pwa/tablas.test.js`
- Modify (append): `test/pwa/multisim.test.js`, `styles.css`
- Modify (entero): `js/dom.js`, `js/vistas/bot.js`, `js/vistas/panel.js`

**Interfaces:**
- `tabla({ titulo, columnas, filas, vacio?, claseFila?, apilable? = false })` — `apilable`: clase `tabla-apilable` y roles ARIA explícitos (`table`/`rowgroup`/`row`/`columnheader`/`cell`); todas las celdas llevan `data-etiqueta` = texto de su columna.
- `filaTabla(columnas, f, claseFila?, apilable? = false)`.
- Vista Bot: `comparativa()` primero y sola (PIN), después `bot(simulacion)` y luego simulaciones, operaciones y decisiones a la vez (limitador: 2 en vuelo). Sección «Comparativa de estrategias» (gráfico si alguna curva tiene ≥ 2 puntos, leyenda, atribución, tabla apilable con «Ver detalle» → `?simulacion=id`) y «Detalle de una simulación» con el selector de siempre. Reinicio = todas las estrategias.
- Panel: `textoConsejo(r.estrategiaPrincipal)` encima de las tarjetas; el resumen del bot dice «(principal)».

Tablas anchas: en el móvil (≤ 680 px) cada fila apilable es una tarjeta con la cabecera delante de cada valor; por encima, cabeceras y celdas parten línea y, si aun así no caben, el contenedor (ya desplazable) muestra una sombra del color de acento en el borde por el que quedan columnas (capas `background-attachment: local/scroll`, sin JS). La sombra vale también para las tablas que ya existían.

- [ ] **Step 1: Write the failing tests**

Create `test/pwa/tablas.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { tabla } from '../../js/dom.js'
import { leer } from './modulos.js'

/** DOM mínimo para h(): elementos con atributos e hijos (texto o elementos). Solo para este test. */
class Elemento {
  /** @param {string} etiqueta */
  constructor(etiqueta) {
    this.etiqueta = etiqueta
    /** @type {Record<string, string>} */
    this.atributos = {}
    /** @type {(Elemento|string)[]} */
    this.hijos = []
  }

  /** @param {string} k @param {string} v */
  setAttribute(k, v) { this.atributos[k] = v }

  addEventListener() {}

  /** @param {...(Elemento|string)} hijos */
  append(...hijos) { this.hijos.push(...hijos) }

  /** @param {string} etiqueta @returns {Elemento[]} */
  todos(etiqueta) {
    const propios = this.hijos.filter((x) => x instanceof Elemento)
    return [...propios.filter((x) => x.etiqueta === etiqueta), ...propios.flatMap((x) => x.todos(etiqueta))]
  }

  /** @returns {string} */
  get texto() { return this.hijos.map((x) => (typeof x === 'string' ? x : x.texto)).join('') }
}

const COLUMNAS = [{ clave: 'a', texto: 'Estrategia' }, { clave: 'b', texto: 'Comprar y mantener', numerica: true }, { clave: 'c', texto: 'Criterio' }]
const FILAS = [{ a: 'v3', b: '+1,00 %', c: 'Cumple' }, { a: 'v4', b: '-2,00 %', c: 'No cumple' }]

describe('tablas anchas en el móvil', () => {
  before(() => Object.assign(globalThis, { Node: Elemento, document: { createElement: (/** @type {string} */ e) => new Elemento(e) } }))
  after(() => {
    delete (/** @type {any} */ (globalThis)).Node
    delete (/** @type {any} */ (globalThis)).document
  })

  test('apilable: contenedor desplazable con su clase, roles ARIA explícitos y la cabecera en cada celda', () => {
    const t = /** @type {any} */ (tabla({ titulo: 'Ranking', columnas: COLUMNAS, filas: FILAS, apilable: true }))
    assert.equal(t.atributos.class, 'tabla-desplazable tabla-apilable')
    assert.deepEqual([t.atributos.role, t.atributos['aria-label'], t.atributos.tabindex], ['region', 'Ranking', '0'])
    assert.equal(t.todos('table')[0].atributos.role, 'table')
    assert.deepEqual(t.todos('th').map((/** @type {Elemento} */ th) => [th.texto, th.atributos.role]), COLUMNAS.map((c) => [c.texto, 'columnheader']))
    const celdas = t.todos('td')
    assert.equal(celdas.length, 6)
    assert.deepEqual(celdas.map((/** @type {Elemento} */ td) => td.atributos['data-etiqueta']), [...COLUMNAS, ...COLUMNAS].map((c) => c.texto))
    assert.ok(celdas.every((/** @type {Elemento} */ td) => td.atributos.role === 'cell'))
    assert.ok(t.todos('tr').every((/** @type {Elemento} */ tr) => tr.atributos.role === 'row'))
  })

  test('sin apilable: la tabla de siempre (desplazable, sin roles añadidos) y las celdas también llevan su cabecera', () => {
    const t = /** @type {any} */ (tabla({ titulo: 'Operaciones', columnas: COLUMNAS, filas: FILAS }))
    assert.equal(t.atributos.class, 'tabla-desplazable')
    assert.equal(t.todos('table')[0].atributos.role, undefined)
    assert.deepEqual(t.todos('td').slice(0, 3).map((/** @type {Elemento} */ td) => [td.atributos['data-etiqueta'], td.atributos.role]),
      COLUMNAS.map((c) => [c.texto, undefined]))
  })

  test('CSS: por debajo de 680 px las apilables son tarjetas con la cabecera delante; encima, sombra de desplazamiento', () => {
    const css = leer('styles.css')
    const movil = /@media \(max-width: 680px\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    assert.match(movil, /\.tabla-apilable thead \{[^}]*position: absolute;/)
    assert.match(movil, /\.tabla-apilable tr \{[^}]*border-radius/)
    assert.match(movil, /\.tabla-apilable td::before \{ content: attr\(data-etiqueta\);/)
    assert.match(movil, /white-space: normal;/)
    assert.match(css, /\.tabla-desplazable \{\s*background:[\s\S]*?no-repeat local,[\s\S]*?no-repeat scroll;/)
  })

  test('la tabla de la comparativa lado a lado del Bot es apilable', () => {
    const fuente = leer('js/vistas/bot.js')
    const comparativa = fuente.slice(fuente.indexOf('function bloqueComparativa'), fuente.indexOf('export async function vistaBot'))
    assert.equal(comparativa.split('tabla({').length - 1, 1)
    assert.equal(comparativa.split('apilable: true').length - 1, 1)
  })
})
```

Append to the end of `test/pwa/multisim.test.js`:

```js

describe('vistas con varias estrategias', () => {
  test('vistas: el Bot pide primero la comparativa sola, pinta su gráfico con atribución; el Panel nombra la estrategia', () => {
    const bot = leer('js/vistas/bot.js')
    const comparativa = bot.indexOf('ctx.api.comparativa()')
    assert.ok(comparativa > 0 && comparativa < bot.indexOf('ctx.api.bot(simulacion)'), 'la comparativa va primero, sola')
    assert.match(bot, /graficoComparativa\(lienzo, curvas\)/)
    assert.match(bot, /hayCurva \? notaAtribucion\(\) : null/)
    assert.doesNotMatch(bot, /ESTRATEGIA_ACTIVA/)
    assert.match(leer('js/vistas/panel.js'), /textoConsejo\(r\.estrategiaPrincipal\)/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/tablas.test.js test/pwa/multisim.test.js`
Expected: FAIL — 5 de 12: la clase de la tabla apilable (se esperaba `tabla-desplazable tabla-apilable`), el CSS de 680 px, la tabla de la comparativa del Bot y la vista Bot, que aún no pide la comparativa (`la comparativa va primero, sola`)

- [ ] **Step 3: Write the implementation**

Replace the whole content of `js/dom.js` with:

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
 * Tabla accesible con título, cabeceras de columna y mensaje si no hay filas. Siempre va en un contenedor con
 * desplazamiento horizontal (con sombra en el borde mientras quedan columnas por ver). `apilable`: por debajo de
 * 680 px cada fila se pinta como una tarjeta con la cabecera de cada celda delante (data-etiqueta); los roles ARIA
 * explícitos conservan la tabla para los lectores de pantalla aunque el CSS cambie su `display`.
 * @param {{ titulo: string, columnas: { clave: string, texto: string, numerica?: boolean }[],
 *   filas: Record<string, unknown>[], vacio?: string, claseFila?: (f: any) => string|undefined, apilable?: boolean }} op
 */
export function tabla({ titulo, columnas, filas, vacio = 'Sin datos.', claseFila, apilable = false }) {
  if (filas.length === 0) return h('p', { class: 'vacio' }, vacio)
  const rol = (/** @type {string} */ r) => (apilable ? r : null)
  const cuerpo = h('tbody', { role: rol('rowgroup') }, filas.map((f) => filaTabla(columnas, f, claseFila, apilable)))
  return h('div', { class: apilable ? 'tabla-desplazable tabla-apilable' : 'tabla-desplazable', tabindex: 0, role: 'region', 'aria-label': titulo },
    h('table', { role: rol('table') },
      h('caption', { class: 'solo-lectores' }, titulo),
      h('thead', { role: rol('rowgroup') }, h('tr', { role: rol('row') },
        columnas.map((c) => h('th', { scope: 'col', class: c.numerica ? 'num' : null, role: rol('columnheader') }, c.texto)))),
      cuerpo))
}

/**
 * Fila de `tabla`. Cada celda lleva su cabecera en data-etiqueta (las tarjetas de una tabla apilable la enseñan).
 * @param {{ clave: string, texto?: string, numerica?: boolean }[]} columnas @param {Record<string, unknown>} f
 * @param {(f: any) => string|undefined} [claseFila]
 * @param {boolean} [apilable] añade los roles ARIA de fila y celda
 */
export const filaTabla = (columnas, f, claseFila, apilable = false) => h('tr', { class: claseFila?.(f) ?? null, role: apilable ? 'row' : null },
  columnas.map((c) => h('td', { class: c.numerica ? 'num' : null, 'data-etiqueta': c.texto ?? null, role: apilable ? 'cell' : null },
    /** @type {Hijo} */ (f[c.clave]))))

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

Replace the whole content of `js/vistas/bot.js` with:

```js
// @ts-check
// Bot (spec §12 y spec del laboratorio §7): comparativa de las simulaciones activas (una por estrategia en vivo:
// curvas de capital frente a comprar y mantener y métricas lado a lado) y, debajo, el detalle de una simulación:
// valor de cartera, curva, métricas de §7.7 (también por moneda), posiciones abiertas con SL/TP fijos,
// operaciones, decisiones con filtro, selector de simulación y reinicio.
import { mensajeError } from '../api.js'
import {
  CAPITAL_POR_DEFECTO, FILTROS_DECISION, filaOperacion, filaPosicion, filasComparativa, filasMetricas, filasPorMoneda,
  filtrarDecisiones, frenteAHodl, opcionesSimulacion, validarCapital,
} from '../cartera.js'
import { aviso, definiciones, filaTabla, h, tabla } from '../dom.js'
import { entero, euros, fechaHora, porcentaje } from '../formato.js'
import { graficoComparativa, graficoCurva } from '../graficos.js'
import { conParams, hashDe, paramEntero, paramOpcion } from '../rutas.js'
import { curvaComparada, curvasComparativa } from '../series.js'
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
 * Diálogo de reinicio con confirmación: se cierran todas las simulaciones activas (se conservan; nada se borra)
 * y empieza una por cada estrategia en vivo, todas con el mismo capital.
 * @param {import('./comun.js').Contexto} ctx @param {string[]} estrategias etiquetas de las activas (puede ir vacía)
 */
function reinicio(ctx, estrategias) {
  const error = h('p', { class: 'error', role: 'alert' })
  const campo = h('input', { id: 'capital', name: 'capital', type: 'text', inputmode: 'decimal', autocomplete: 'off', value: entero(CAPITAL_POR_DEFECTO), 'aria-describedby': 'capital-ayuda' })
  const confirmar = h('button', { type: 'submit', class: 'boton boton-peligro' }, 'Cerrar y empezar otra')
  const cancelar = h('button', { type: 'button', class: 'boton' }, 'Cancelar')
  const formulario = h('form', { class: 'formulario' },
    h('h3', { id: 'reinicio-titulo' }, 'Reiniciar el bot'),
    h('p', null, `${estrategias.length > 1 ? `Las ${estrategias.length} simulaciones activas (${estrategias.join(', ')}) se cerrarán`
      : 'La simulación activa se cerrará'} con su última valoración y se conservará todo su historial. `
      + 'Empezará una nueva por cada estrategia en vivo, todas a la vez y con el capital que indiques.'),
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
      const nuevas = Array.isArray(r.simulaciones) ? r.simulaciones.length : 1
      dialogo.close()
      ctx.avisar(`${nuevas > 1 ? `${nuevas} simulaciones creadas` : `Simulación ${r.simulacion.id} creada`} con `
        + `${euros(r.simulacion.capitalInicial)}${nuevas > 1 ? ' cada una' : ''}. Las anteriores quedan cerradas.`)
      ctx.navegar(hashDe('bot'))
    } catch (e) {
      if (ctx.exigirPin(e)) return
      error.textContent = mensajeError(e)
    } finally {
      confirmar.disabled = false
    }
  })
  const abrir = h('button', { type: 'button', class: 'boton boton-peligro' }, 'Reiniciar el bot…')
  abrir.addEventListener('click', () => {
    error.textContent = ''
    dialogo.showModal()
    campo.select()
  })
  return h('div', { class: 'reinicio' }, abrir, dialogo)
}

/**
 * Comparativa de las simulaciones activas: gráfico con una curva por estrategia más comprar y mantener, y tabla
 * de métricas con un enlace al detalle de cada una.
 * @param {import('./comun.js').Contexto} ctx
 * @param {any} c respuesta de GET /api/bot/comparativa
 * @param {number|null} viendo simulación del detalle
 * @returns {{ nodo: HTMLElement, montar?: () => () => void }}
 */
function bloqueComparativa(ctx, c, viendo) {
  if (c.simulaciones.length === 0) {
    return { nodo: seccion('Comparativa de estrategias', h('p', { class: 'vacio' }, 'Aún no hay simulaciones activas: se crean en la primera ejecución del cron de mercado (minuto 3 de cada hora).')) }
  }
  const curvas = curvasComparativa(c)
  const hayCurva = curvas.estrategias.some((e) => e.puntos.length > 1)
  const lienzo = h('div', { class: 'grafico grafico-curva', role: 'group', 'aria-label': 'Curvas de capital de las estrategias en vivo frente a comprar y mantener' })
  const filas = filasComparativa(c).map((f) => ({
    ...f,
    detalle: f.id === null ? '—' : f.id === viendo ? 'En pantalla'
      : h('a', { href: conParams(ctx.ruta, { simulacion: f.id, simbolo: null }) }, 'Ver detalle'),
  }))
  const nodo = seccion('Comparativa de estrategias',
    hayCurva ? lienzo : h('p', { class: 'vacio' }, 'Las curvas aparecen tras la segunda hora de las simulaciones.'),
    h('p', { class: 'leyenda' }, curvas.estrategias.map((e, i) => h('span', { class: `l-est-${i % 4}` }, e.etiqueta)),
      h('span', { class: 'l-hodl l-hodl-discontinua' }, 'Comprar y mantener')),
    hayCurva ? notaAtribucion() : null,
    tabla({
      titulo: 'Métricas de las estrategias en vivo',
      columnas: [{ clave: 'estrategia', texto: 'Estrategia' }, { clave: 'valor', texto: 'Valor', numerica: true },
        { clave: 'rentabilidad', texto: 'Rentabilidad', numerica: true }, { clave: 'caida', texto: 'Caída máx.', numerica: true },
        { clave: 'operaciones', texto: 'Operaciones', numerica: true }, { clave: 'detalle', texto: 'Detalle' }],
      filas,
      claseFila: (f) => (f.principal ? 'principal' : undefined),
      apilable: true,
    }),
    h('p', { class: 'ayuda' }, 'Todas empezaron a la vez con el mismo capital. La principal es la que da el consejo del Panel. '
      + 'Caída máx. = drawdown máximo. Horaria los últimos 30 días; antes, un punto por día.'))
  return { nodo, montar: hayCurva ? () => graficoComparativa(lienzo, curvas) : undefined }
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBot(ctx) {
  const { ruta } = ctx
  const simulacion = paramEntero(ruta.params, 'simulacion')
  const simbolo = /^[A-Z0-9]{2,10}$/.test(ruta.params.simbolo ?? '') ? ruta.params.simbolo : null
  const filtro = paramOpcion(ruta.params, 'filtro', FILTROS_DECISION.map((f) => f.clave), 'todas')
  // Primero una sola petición: con un PIN caducado, 4 en paralelo gastarían 4 de los 5 intentos antes del bloqueo.
  // avisoDeError propaga los errores de PIN y bloqueo; cualquier otro (p. ej. un Worker sin la ruta) se muestra.
  const comp = await intentar(ctx.api.comparativa())
  const comparativa = comp.ok
    ? bloqueComparativa(ctx, comp.valor, simulacion ?? comp.valor.simulaciones.find((/** @type {any} */ s) => s.principal)?.id ?? null)
    : { nodo: seccion('Comparativa de estrategias', avisoDeError(comp.error)) }
  const etiquetas = comp.ok ? comp.valor.simulaciones.map((/** @type {any} */ s) => s.etiqueta || s.estrategiaVersion) : []
  const bot = await intentar(ctx.api.bot(simulacion))
  if (!bot.ok) {
    const sinSimulacion = /** @type {any} */ (bot.error)?.estado === 404 && simulacion === null
    const nodo = h('div', { class: 'vista' }, cabecera('Bot'),
      sinSimulacion ? aviso('Aún no hay simulación: se crea en la primera ejecución del cron de mercado (minuto 3 de cada hora).') : avisoDeError(bot.error),
      comp.ok && comp.valor.simulaciones.length > 0 ? comparativa.nodo : null)
    return { titulo: 'Bot', nodo, montar: comparativa.montar }
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
    cabecera('Bot', h('p', { class: 'ayuda' }, 'Una simulación por cada estrategia en vivo, todas con dinero virtual.')),
    comparativa.nodo,
    seccion('Detalle de una simulación',
      h('div', { class: 'campo' }, h('label', { for: 'simulacion' }, 'Simulación'), selectorSim),
      h('p', { class: 'ayuda' }, `Estrategia ${sim.estrategiaVersion}${sim.etiqueta && sim.etiqueta !== sim.estrategiaVersion ? ` (${sim.etiqueta})` : ''}`
        + `${sim.principal ? ' · principal' : ''} · capital inicial ${euros(sim.capitalInicial)} · desde ${fechaHora(sim.creadaEn)}`
        + `${sim.activa ? '' : ` · cerrada el ${fechaHora(sim.cerradaEn)}`}`),
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
    sim.activa ? seccion('Reinicio', reinicio(ctx, etiquetas)) : null)
  return {
    titulo: 'Bot',
    nodo,
    montar: () => {
      const limpiezas = [comparativa.montar?.(), curva.bot.length > 1 ? graficoCurva(lienzo, curva) : undefined]
      return () => { for (const limpiar of limpiezas) limpiar?.() }
    },
  }
}
```

Replace the whole content of `js/vistas/panel.js` with:

```js
// @ts-check
// Panel (spec §12): Fear & Greed, una tarjeta por moneda (consejo de la estrategia principal, que se nombra),
// último análisis, frescura y «Analizar ahora».
import { ErrorApi, mensajeError } from '../api.js'
import { aviso, h, insignia, s } from '../dom.js'
import { euros, fechaHora, hace, hora, porcentaje } from '../formato.js'
import { hashDe } from '../rutas.js'
import { frenteAHodl, textoConsejo } from '../cartera.js'
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
        h('span', null, `Simulación ${bot.simulacionId} · ${bot.estrategiaVersion} (principal)`),
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
    estado.textContent = 'Descargando datos y analizando las monedas: suele tardar entre 25 y 35 segundos.'
    const inicio = Date.now()
    const contar = () => {
      boton.textContent = `Analizando… ${Math.round((Date.now() - inicio) / 1000)} s`
    }
    contar()
    const reloj = setInterval(contar, 1000)
    try {
      await ctx.api.analizar()
      estado.textContent = ''
      ctx.avisar('Señales recalculadas. Analizar no opera: el bot solo decide en el cron de cada hora.')
      ctx.refrescar()
    } catch (e) {
      if (ctx.exigirPin(e)) return
      estado.textContent = e instanceof ErrorApi && e.codigo === 'tiempo'
        ? 'El análisis no respondió en 60 segundos. Puede seguir en curso en el servidor: el Panel lo mostrará al refrescar.'
        : mensajeError(e)
      if (e instanceof ErrorApi && e.codigo === 'demasiado_pronto' && e.hasta) {
        const espera = Math.min(ESPERA_ANALIZAR_MS, Math.max(0, e.hasta - ctx.ahora()))
        boton.textContent = `Espera hasta las ${hora(e.hasta)}`
        setTimeout(() => {
          boton.disabled = false
          boton.textContent = 'Analizar ahora'
        }, espera)
        return
      }
      boton.disabled = false
      boton.textContent = 'Analizar ahora'
    } finally {
      clearInterval(reloj)
    }
  })
  const senales = r.senales.length > 0
    ? h('ul', { class: 'tarjetas' }, r.senales.map((/** @type {any} */ x) => tarjeta(x, r.ahora)))
    : h('p', { class: 'vacio' }, 'Aún no hay señales: el primer análisis llega con el cron de mercado (minuto 3 de cada hora).')
  const consejo = textoConsejo(r.estrategiaPrincipal)
  const nodo = h('div', { class: 'vista vista-panel' },
    cabecera('Panel', bloqueEjecucion(r)),
    seccion('Monedas', consejo ? h('p', { class: 'consejo-de' }, consejo) : null, senales, h('div', { class: 'analizar' }, boton, estado),
      h('p', { class: 'ayuda' }, 'Analizar ahora recalcula las señales (como mucho una vez cada 5 minutos). Nunca abre ni cierra posiciones.')),
    bloqueFng(r.fng),
    bloqueBot(r.bot))
  return { titulo: 'Panel', nodo }
}
```

Append to the end of `styles.css`:

```css

/* Tablas anchas (comparativa del Bot y Laboratorio). Por encima de 680 px, cabeceras y celdas de las apilables
   parten línea y, si aun así no caben, la tabla se desplaza en horizontal con una sombra en el borde mientras quedan
   columnas por ver (las capas «local» la tapan al llegar al final). Por debajo (móviles), cada fila de una tabla
   apilable es una tarjeta con la cabecera delante de cada valor. */
.tabla-desplazable {
  background:
    linear-gradient(to right, var(--panel) 30%, transparent) left center / 2.5rem 100% no-repeat local,
    linear-gradient(to left, var(--panel) 30%, transparent) right center / 2.5rem 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%, rgba(45, 212, 191, .35), transparent) left center / .9rem 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%, rgba(45, 212, 191, .35), transparent) right center / .9rem 100% no-repeat scroll;
}
.tabla-apilable th, .tabla-apilable td { white-space: normal; }
.tabla-apilable th { vertical-align: bottom; }
@media (max-width: 680px) {
  .tabla-apilable { overflow-x: visible; background: none; }
  .tabla-apilable table, .tabla-apilable tbody, .tabla-apilable tr, .tabla-apilable td { display: block; width: 100%; }
  .tabla-apilable thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .tabla-apilable tr { background: var(--panel-2); border: 1px solid var(--borde); border-radius: 10px; padding: .35rem .75rem; margin: 0 0 .6rem; }
  .tabla-apilable td {
    display: flex; justify-content: space-between; gap: 1rem; align-items: baseline; text-align: right;
    white-space: normal; overflow-wrap: anywhere; border-bottom: 1px solid var(--borde); padding: .4rem 0;
  }
  .tabla-apilable td:last-child { border-bottom: 0; }
  .tabla-apilable td::before { content: attr(data-etiqueta); color: var(--suave); font-weight: 600; text-align: left; flex: 0 0 auto; }
  .tabla-apilable td:empty::after { content: "—"; }
  .tabla-apilable tr.principal td:first-child { box-shadow: none; }
}

/* Comparativa de estrategias en vivo (Bot) */
.l-est-0 { color: #2dd4bf; }
.l-est-1 { color: #60a5fa; }
.l-est-2 { color: #c084fc; }
.l-est-3 { color: #f472b6; }
.leyenda .l-hodl-discontinua::before { background: none; border-top: 3px dashed currentColor; height: 0; }
tr.principal td:first-child { font-weight: 700; }
.consejo-de { margin: 0 0 .75rem; color: var(--suave); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/tablas.test.js test/pwa/multisim.test.js`
Expected: PASS — 12 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +5 tests (429 sobre la base `0d5341d`)

- [ ] **Step 5: Check it in a browser (manual)**

`npm run dev` y, en otra terminal, `npm run api-simulada`; abre `http://localhost:8080`, PIN `4815162342`. A 390 px de ancho: Bot → gráfica con 3 curvas y comprar y mantener discontinua, tabla en tarjetas, «Ver detalle» abre cada simulación; Panel → «Consejo de la estrategia v1, la principal de las 3 en vivo.». A 760 y 1024 px la tabla cabe sin desplazarse. Consola sin errores. Para los servidores con Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add js/dom.js js/vistas/bot.js js/vistas/panel.js styles.css test/pwa/tablas.test.js test/pwa/multisim.test.js
git commit -m "feat(pwa): comparativa de estrategias en el Bot, consejo con su estrategia y tablas apilables" -m "En el móvil las tablas anchas son tarjetas; encima de 680 px, sombra de desplazamiento." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: PWA — pestaña Laboratorio y nada sintético en producción

**Files:**
- Create: `test/pwa/fixtures/laboratorio.json`, `test/pwa/laboratorio.test.js`, `test/pwa/produccion.test.js`, `js/laboratorio.js`
- Modify (entero): `js/vistas/backtest.js`, `sw.js`
- Modify (append): `styles.css`

**Interfaces:**
- `RUTA_LABORATORIO = 'data/laboratorio.json'`, `AVISO_FUTURO`.
- `cargarLaboratorio(fetch): Promise<unknown|null>` — `null` con 404; lanza con otro HTTP o con `sintetico: true`.
- `lecturaLaboratorio(lab: unknown)` → `{ generado, aviso, criterio, tramos, familias, ranking, ganadoras, seleccion, reservado }`; cada puesto: `{ posicion, familia, version, config, rentabilidad, claseRentabilidad, caida, rentabilidadHodl, caidaHodl, cumple, textoCumple, puntos: { texto, cumple, marca }[], porAno: { ano, rentabilidad, hodl, clase }[], porMoneda: { simbolo, beneficio, positivo, clase }[] }`.
- `textoConfig(config)`, `textoTramos(tramos)`, `filasReservado(reservado)`.
- `LABORATORIO = 'laboratorio'` (valor de `?v=`), `textoPestana(version)`.

Forma que se espera de `data/laboratorio.json` (la escribe el plan 4; el lector no se fía de ella: lo que falte o venga con otro tipo sale como «—» o no se pinta):

```
{ generadoEn, aviso, criterio, tramos, familias: [...],
  ranking: [{ familia, version?, config, oos: { rentabilidad, drawdownMaximo, rentabilidadHodl, drawdownMaximoHodl,
                                                porAno: [{ ano, rentabilidad, hodl }], porMoneda: { SYM: beneficio } },
              criterio: { puntos: [{ id, texto, cumple }], cumple } }],
  seleccion: [...], reservado: {...} }
```

El fixture de los tests es **inventado** y va marcado `"sintetico": true`: `cargarLaboratorio` lo rechaza aunque se copie a `data/`, y `test/pwa/produccion.test.js` impide que `data/` tenga algo así.

**`sw.js` y el plan 4:** si `git diff 0d5341d -- sw.js` no está vacío (el plan 4 añadió sus módulos de `core/` o subió `VERSION`), no pegues el bloque de abajo: añade solo la línea `'./js/laboratorio.js',` detrás de `'./js/graficos.js',` y sube en 1 el número de `VERSION` que haya. `test/pwa/estructura.test.js` falla si falta algún módulo que cargue la app.

- [ ] **Step 1: Write the failing tests**

Create `test/pwa/fixtures/laboratorio.json`:

```json
{
  "sintetico": true,
  "generadoEn": "2026-10-21T08:00:00.000Z",
  "aviso": "Datos sintéticos de prueba con la forma de data/laboratorio.json.",
  "criterio": "Las 5 condiciones fuera de muestra (spec del laboratorio §4).",
  "tramos": [{ "entrenamiento": "2017-2019", "prueba": 2020 }, { "entrenamiento": "2017-2020", "prueba": 2021 }],
  "familias": [{ "id": "F1" }, { "id": "F2" }, { "id": "F3" }],
  "ranking": [
    {
      "familia": "F2 Ruptura (Donchian)",
      "version": "v3",
      "config": { "entrada": 55, "salida": 20, "stop": null },
      "oos": {
        "rentabilidad": 1.2345,
        "drawdownMaximo": 0.25,
        "rentabilidadHodl": 2.5,
        "drawdownMaximoHodl": 0.6,
        "porAno": [{ "ano": 2020, "rentabilidad": 0.8, "hodl": 1.5 }, { "ano": 2021, "rentabilidad": -0.05, "hodl": 0.9 }],
        "porMoneda": { "BTC": 1234.5, "ETH": -10 }
      },
      "criterio": {
        "puntos": [{ "id": 1, "texto": "Rentabilidad encadenada > 0", "cumple": true }, { "id": 2, "texto": "Caída ≤ 0,6 × la de comprar y mantener", "cumple": false }],
        "cumple": false
      }
    },
    {
      "familia": "F1 Cruce de medias 1D",
      "config": "rápida 20 · lenta 100",
      "oos": { "rentabilidad": 0.5, "drawdownMaximo": 0, "porAno": [], "porMoneda": {} },
      "criterio": { "puntos": [], "cumple": true }
    }
  ],
  "seleccion": [{ "version": "v3", "familia": "F2 Ruptura (Donchian)", "config": { "entrada": 55 } }, "v4"],
  "reservado": {
    "desde": 1767225600000,
    "experimental": true,
    "v3": { "rentabilidad": 0.12, "drawdownMaximo": 0.08, "operaciones": 14 },
    "notas": ["se ignora"]
  }
}
```

Create `test/pwa/laboratorio.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../../core/estrategias.js'
import { AVISO_FUTURO, cargarLaboratorio, filasReservado, lecturaLaboratorio, textoConfig, textoTramos } from '../../js/laboratorio.js'
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
    assert.equal(l.aviso, `Datos sintéticos de prueba con la forma de data/laboratorio.json. ${AVISO_FUTURO}`)
    assert.equal(l.criterio, 'Las 5 condiciones fuera de muestra (spec del laboratorio §4).')
    assert.equal(l.tramos, '2020, 2021')
    assert.equal(l.familias, 3)
    assert.equal(l.ganadoras, 1)
    const [primero, segundo] = l.ranking
    assert.deepEqual({ ...primero, puntos: undefined, porAno: undefined, porMoneda: undefined }, {
      posicion: 1, familia: 'F2 Ruptura (Donchian)', version: 'v3', config: 'entrada 55 · salida 20 · stop no',
      rentabilidad: `+123,45${ESP}%`, claseRentabilidad: 'sube', caida: `-25,00${ESP}%`, rentabilidadHodl: `+250,00${ESP}%`,
      caidaHodl: `-60,00${ESP}%`, cumple: false, textoCumple: 'No cumple', puntos: undefined, porAno: undefined, porMoneda: undefined,
    })
    assert.deepEqual(primero.puntos, [
      { texto: 'Rentabilidad encadenada > 0', cumple: true, marca: '✓ Cumple' },
      { texto: 'Caída ≤ 0,6 × la de comprar y mantener', cumple: false, marca: '✗ No cumple' },
    ])
    assert.deepEqual(primero.porAno, [
      { ano: '2020', rentabilidad: `+80,00${ESP}%`, hodl: `+150,00${ESP}%`, clase: 'sube' },
      { ano: '2021', rentabilidad: `-5,00${ESP}%`, hodl: `+90,00${ESP}%`, clase: 'baja' },
    ])
    assert.deepEqual(primero.porMoneda, [
      { simbolo: 'BTC', beneficio: '+1234,50', positivo: 'Sí', clase: 'sube' },
      { simbolo: 'ETH', beneficio: '-10,00', positivo: 'No', clase: 'baja' },
    ])
    assert.deepEqual([segundo.familia, segundo.version, segundo.config, segundo.caida, segundo.rentabilidadHodl, segundo.textoCumple],
      ['F1 Cruce de medias 1D', '', 'rápida 20 · lenta 100', `0,00${ESP}%`, '—', 'Cumple'])
    assert.deepEqual(l.seleccion, ['v3 · F2 Ruptura (Donchian) · entrada 55', 'v4'])
    assert.deepEqual(l.reservado, [
      { etiqueta: 'desde', valor: '01/01/2026' },
      { etiqueta: 'experimental', valor: 'sí' },
      { etiqueta: 'v3 · rentabilidad', valor: `+12,00${ESP}%` },
      { etiqueta: 'v3 · drawdownMaximo', valor: `-8,00${ESP}%` },
      { etiqueta: 'v3 · operaciones', valor: '14,00' },
    ])
  })

  test('defensiva: nada de lo que falte o venga con otro tipo rompe la lectura', () => {
    for (const raro of [null, 'texto', [], 42, { ranking: 'x', familias: 3, tramos: {}, seleccion: [null, 3], reservado: [] }]) {
      const l = lecturaLaboratorio(raro)
      assert.deepEqual([l.ranking, l.seleccion, l.reservado, l.familias, l.ganadoras, l.generado, l.tramos], [[], [], [], 0, 0, '—', '—'])
      assert.equal(l.aviso, AVISO_FUTURO)
    }
    const l = lecturaLaboratorio({ ranking: [null, 7, { oos: 'x', criterio: { puntos: [3, { cumple: 'sí' }] } }, { oos: { porAno: [{ ano: {} }], porMoneda: [] } }] })
    assert.equal(l.ranking.length, 2)
    assert.deepEqual([l.ranking[0].familia, l.ranking[0].rentabilidad, l.ranking[0].textoCumple], ['Familia 1', '—', '—'])
    assert.deepEqual(l.ranking[0].puntos, [{ texto: '—', cumple: false, marca: '—' }])
    assert.deepEqual(l.ranking[1].porAno, [{ ano: '—', rentabilidad: '—', hodl: '—', clase: 'neutro' }])
    assert.deepEqual(l.ranking[1].porMoneda, [])
    assert.equal(lecturaLaboratorio({ aviso: `Ojo. ${AVISO_FUTURO}` }).aviso, `Ojo. ${AVISO_FUTURO}`, 'no repite el aviso')
  })

  test('textoConfig, textoTramos y filasReservado', () => {
    assert.equal(textoConfig({ l: 30, revision: 'semanal', tp: null, sl: true, x: {} }), 'l 30 · revision semanal · tp no · sl sí')
    assert.equal(textoConfig(7), '')
    assert.equal(textoTramos([2020, '2021', { ano: 2022 }, { prueba: { desde: 1 } }, null]), '2020, 2021, 2022')
    assert.equal(textoTramos('2020'), '')
    assert.deepEqual(filasReservado({ hasta: 5, caida: 0.1, rentabilidadHodl: -0.2 }), [
      { etiqueta: 'hasta', valor: '5,00' }, { etiqueta: 'caida', valor: `-10,00${ESP}%` }, { etiqueta: 'rentabilidadHodl', valor: `-20,00${ESP}%` },
    ])
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
  })

  test('ranking, años y monedas: todas las tablas del Laboratorio son apilables (tarjetas en el móvil)', () => {
    const fuente = leer('js/vistas/backtest.js')
    const laboratorio = fuente.slice(fuente.indexOf('async function vistaLaboratorio'), fuente.indexOf('export async function vistaBacktest'))
    assert.equal(laboratorio.split('tabla({').length - 1, 3)
    assert.equal(laboratorio.split('apilable: true').length - 1, 3)
  })
})
```

Create `test/pwa/produccion.test.js`:

```js
// @ts-check
// Los datos inventados (escenario sintético, estrategias de prueba como v1b y el laboratorio de los tests) viven solo
// en test/, worker/test/ y scripts/ de desarrollo: ni la PWA publicada ni el Worker desplegado pueden cargarlos.
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { describe, test } from 'node:test'
import { RAIZ, importsDe, leer, modulosDeLaApp } from './modulos.js'

/** Módulos que alcanza worker/src/index.js (lo que empaqueta wrangler), como rutas relativas a la raíz. */
function modulosDelWorker() {
  const vistos = new Set()
  const pendientes = ['worker/src/index.js']
  while (pendientes.length > 0) {
    const ruta = /** @type {string} */ (pendientes.pop())
    if (vistos.has(ruta)) continue
    vistos.add(ruta)
    for (const destino of importsDe(leer(ruta))) pendientes.push(new URL(destino, new URL(ruta, 'https://x/')).pathname.slice(1))
  }
  return [...vistos].sort()
}

/** Ningún módulo de producción sale de estas carpetas. @param {string} m */
const deProduccion = (m) => m === 'config.js' || /^(js|core|worker\/src)\//.test(m)

describe('sin datos sintéticos en producción', () => {
  test('la PWA solo carga módulos de js/, core/ y config.js: nada de test/ ni de worker/test/', () => {
    const fuera = modulosDeLaApp().filter((m) => !deProduccion(m) || m.startsWith('worker/'))
    assert.deepEqual(fuera, [])
  })

  test('el Worker desplegado solo carga worker/src/ y core/: ni el escenario sintético ni las estrategias de prueba', () => {
    const modulos = modulosDelWorker()
    assert.ok(modulos.includes('worker/src/vivo.js') && modulos.includes('core/estrategias.js'))
    assert.deepEqual(modulos.filter((m) => !deProduccion(m) || m.startsWith('js/')), [])
    for (const m of modulos) assert.doesNotMatch(leer(m), /\bv1b\b|vivoDePrueba|crearEscenario/, m)
  })

  test('data/ solo tiene resultados generados por los scripts, ninguno marcado como sintético', () => {
    const archivos = readdirSync(new URL('data/', RAIZ))
    for (const a of archivos) {
      assert.match(a, /^(backtest-v\d+|laboratorio)\.json$/, a)
      assert.notEqual(JSON.parse(leer(`data/${a}`)).sintetico, true, a)
    }
  })

  test('el service worker no guarda datos ni nada de test/', () => {
    const estructura = /const ESTRUCTURA = \[([\s\S]*?)\]/.exec(leer('sw.js'))?.[1] ?? ''
    assert.ok(estructura.includes("'./js/laboratorio.js'"))
    assert.doesNotMatch(estructura, /data\/|test\//)
  })

  test('la API simulada (datos sintéticos) es solo de desarrollo: localhost y fuera del grafo de la app', () => {
    assert.match(leer('scripts/api-simulada.mjs'), /export const ANFITRION = '127\.0\.0\.1'/)
    assert.match(leer('config.js'), /local \? API_LOCAL : produccion/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/laboratorio.test.js test/pwa/produccion.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `js/laboratorio.js`

- [ ] **Step 3: Write the implementation**

Create `js/laboratorio.js`:

```js
// @ts-check
// Pestaña «Laboratorio» del Backtest (spec del laboratorio §7): lectura defensiva de data/laboratorio.json, que
// genera scripts/laboratorio.mjs. Funciones puras: cualquier campo ausente o con otro tipo se enseña como «—» o se
// omite, nunca rompe la vista.
import { claseSigno, fecha, fechaHora, numero, porcentaje, VACIO } from './formato.js'

export const RUTA_LABORATORIO = 'data/laboratorio.json'
export const AVISO_FUTURO = 'Un resultado del pasado no garantiza el futuro.'

/**
 * data/laboratorio.json relativo a la página (vale bajo /ORACLE/). null si aún no existe (404). Un archivo marcado
 * `sintetico: true` (los datos inventados de los tests) nunca se enseña: lanza, aunque alguien lo copie a data/.
 * @param {typeof fetch} fetch
 * @returns {Promise<unknown|null>}
 */
export async function cargarLaboratorio(fetch) {
  const respuesta = await fetch(RUTA_LABORATORIO)
  if (respuesta.status === 404) return null
  if (!respuesta.ok) throw new Error(`${RUTA_LABORATORIO}: HTTP ${respuesta.status}`)
  const datos = await respuesta.json()
  if (datos?.sintetico === true) throw new Error(`${RUTA_LABORATORIO}: son datos sintéticos de prueba y no se muestran`)
  return datos
}

/** @param {unknown} x @returns {x is Record<string, any>} */
const esObjeto = (x) => typeof x === 'object' && x !== null && !Array.isArray(x)
/** @param {unknown} x @returns {any[]} */
const lista = (x) => (Array.isArray(x) ? x : [])
/** @param {unknown} x */
const texto = (x) => (typeof x === 'string' ? x : '')
/** @param {unknown} x @returns {number|null} */
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null)
/** Número o texto como texto; cualquier otra cosa, ''. @param {unknown} x */
const escalar = (x) => (typeof x === 'string' || (typeof x === 'number' && Number.isFinite(x)) ? String(x) : '')
/** Caída positiva (0,25 = −25 %) enseñada en negativo; sin caída, 0. @param {number|null} d */
const caida = (d) => (d !== null && d > 0 ? -d : d)

/**
 * Configuración de una familia ({ rapida: 20, lenta: 100 } → 'rapida 20 · lenta 100'). null = 'no' (p. ej. sin stop).
 * @param {unknown} config
 */
export function textoConfig(config) {
  if (typeof config === 'string') return config
  if (!esObjeto(config)) return ''
  return Object.entries(config)
    .map(([clave, valor]) => {
      if (valor === null) return `${clave} no`
      if (typeof valor === 'boolean') return `${clave} ${valor ? 'sí' : 'no'}`
      const v = escalar(valor)
      return v === '' ? '' : `${clave} ${v}`
    })
    .filter(Boolean)
    .join(' · ')
}

/** Años de prueba: [2020, 2021] o [{ prueba: 2020 }, …] → '2020, 2021'. @param {unknown} tramos */
export function textoTramos(tramos) {
  return lista(tramos)
    .map((t) => (esObjeto(t) ? escalar(t.prueba ?? t.ano ?? t.anio ?? t.año) : escalar(t)))
    .filter(Boolean)
    .join(', ')
}

/** @param {unknown} criterio texto o { texto | descripcion } */
const textoCriterio = (criterio) => (typeof criterio === 'string' ? criterio : esObjeto(criterio) ? texto(criterio.texto) || texto(criterio.descripcion) : '')

/** @param {unknown} s 'v3' o { version, familia, config } */
const textoSeleccion = (s) => (typeof s === 'string' ? s : esObjeto(s)
  ? [texto(s.version), texto(s.familia), textoConfig(s.config)].filter(Boolean).join(' · ')
  : '')

/**
 * Un valor del tramo reservado según su clave: rentabilidades y caídas en %, fechas en ms como fecha.
 * @param {string} clave @param {unknown} valor
 */
function valorReservado(clave, valor) {
  if (typeof valor === 'boolean') return valor ? 'sí' : 'no'
  if (typeof valor === 'string') return valor
  const n = num(valor)
  if (n === null) return VACIO
  if (/drawdown|caida|caída/i.test(clave)) return porcentaje(caida(n))
  if (/rentabilidad|hodl/i.test(clave)) return porcentaje(n, { signo: true })
  if (/desde|hasta|inicio|fin/i.test(clave) && n > 1e11) return fecha(n)
  return numero(n, 2)
}

/**
 * Tramo reservado como filas etiqueta → valor: los valores sueltos y, un nivel por debajo, los de cada objeto
 * ('v3 · rentabilidad'). Las listas no se enseñan.
 * @param {unknown} reservado
 * @returns {{ etiqueta: string, valor: string }[]}
 */
export function filasReservado(reservado) {
  if (!esObjeto(reservado)) return []
  return Object.entries(reservado).flatMap(([clave, valor]) => {
    if (esObjeto(valor)) {
      return Object.entries(valor)
        .filter(([, v]) => !esObjeto(v) && !Array.isArray(v) && v !== null && v !== undefined)
        .map(([k, v]) => ({ etiqueta: `${clave} · ${k}`, valor: valorReservado(k, v) }))
    }
    if (Array.isArray(valor) || valor === null || valor === undefined) return []
    return [{ etiqueta: clave, valor: valorReservado(clave, valor) }]
  })
}

/**
 * Un puesto del ranking listo para pintar.
 * @param {Record<string, any>} r
 * @param {number} i posición (0 = primero)
 */
function lecturaPuesto(r, i) {
  const oos = esObjeto(r.oos) ? r.oos : {}
  const criterio = esObjeto(r.criterio) ? r.criterio : {}
  const rentabilidad = num(oos.rentabilidad)
  const cumple = typeof criterio.cumple === 'boolean' ? criterio.cumple : null
  return {
    posicion: i + 1,
    familia: texto(r.familia) || `Familia ${i + 1}`,
    version: texto(r.version),
    config: textoConfig(r.config),
    rentabilidad: porcentaje(rentabilidad, { signo: true }),
    claseRentabilidad: claseSigno(rentabilidad),
    caida: porcentaje(caida(num(oos.drawdownMaximo))),
    rentabilidadHodl: porcentaje(num(oos.rentabilidadHodl), { signo: true }),
    caidaHodl: porcentaje(caida(num(oos.drawdownMaximoHodl))),
    cumple,
    textoCumple: cumple === true ? 'Cumple' : cumple === false ? 'No cumple' : VACIO,
    puntos: lista(criterio.puntos).filter(esObjeto).map((p) => ({
      texto: texto(p.texto) || escalar(p.id) || VACIO,
      cumple: p.cumple === true,
      marca: p.cumple === true ? '✓ Cumple' : p.cumple === false ? '✗ No cumple' : VACIO,
    })),
    porAno: lista(oos.porAno).filter(esObjeto).map((a) => ({
      ano: escalar(a.ano ?? a.anio ?? a.año) || VACIO,
      rentabilidad: porcentaje(num(a.rentabilidad), { signo: true }),
      hodl: porcentaje(num(a.hodl), { signo: true }),
      clase: claseSigno(num(a.rentabilidad)),
    })),
    porMoneda: Object.entries(esObjeto(oos.porMoneda) ? oos.porMoneda : {}).map(([simbolo, b]) => ({
      simbolo,
      beneficio: numero(num(b), 2, { signo: true }),
      positivo: num(b) === null ? VACIO : /** @type {number} */ (num(b)) > 0 ? 'Sí' : 'No',
      clase: claseSigno(num(b)),
    })),
  }
}

/**
 * Todo lo que enseña la pestaña Laboratorio a partir de data/laboratorio.json, sin fiarse de su forma.
 * @param {unknown} lab
 */
export function lecturaLaboratorio(lab) {
  const l = esObjeto(lab) ? lab : {}
  const ranking = lista(l.ranking).filter(esObjeto).map(lecturaPuesto)
  const aviso = texto(l.aviso)
  const generado = typeof l.generadoEn === 'string' ? Date.parse(l.generadoEn) : Number.NaN
  return {
    generado: Number.isNaN(generado) ? VACIO : fechaHora(generado),
    aviso: aviso.includes(AVISO_FUTURO) ? aviso : `${aviso}${aviso ? ' ' : ''}${AVISO_FUTURO}`,
    criterio: textoCriterio(l.criterio),
    tramos: textoTramos(l.tramos) || VACIO,
    familias: lista(l.familias).length,
    ranking,
    ganadoras: ranking.filter((r) => r.cumple === true).length,
    seleccion: lista(l.seleccion).map(textoSeleccion).filter(Boolean),
    reservado: filasReservado(l.reservado),
  }
}
```

Replace the whole content of `js/vistas/backtest.js` with:

```js
// @ts-check
// Backtest (spec §8 y §12): métricas de data/backtest-vN.json (una por estrategia) con la etiqueta
// «técnico + Fear & Greed», la versión, el periodo, la curva frente a comprar y mantener y una nota honesta.
// Pestaña «Laboratorio» (spec del laboratorio §7): ranking fuera de muestra, criterio punto por punto,
// resultados por año y por moneda y tramo reservado, de data/laboratorio.json.
import { ESTRATEGIAS, ESTRATEGIAS_EN_VIVO, ESTRATEGIA_PRINCIPAL } from '../../core/estrategias.js'
import { lecturaBacktest, notaBacktest } from '../cartera.js'
import { aviso, definiciones, h, tabla } from '../dom.js'
import { graficoCurva } from '../graficos.js'
import { cargarLaboratorio, lecturaLaboratorio } from '../laboratorio.js'
import { hashDe, paramOpcion } from '../rutas.js'
import { curvaComparada } from '../series.js'
import { cabecera, intentar, notaAtribucion, seccion } from './comun.js'

export const VERSIONES = Object.freeze(Object.keys(ESTRATEGIAS))
/** Valor de ?v= de la pestaña Laboratorio. */
export const LABORATORIO = 'laboratorio'

/** Texto de la pestaña de una versión: la principal y las demás en vivo, marcadas. @param {string} v */
export const textoPestana = (v) => (v === ESTRATEGIA_PRINCIPAL ? `${v} (principal)` : ESTRATEGIAS_EN_VIVO.includes(v) ? `${v} (en vivo)` : v)

/**
 * data/backtest-vN.json, relativo a la página (funciona bajo /ORACLE/ en GitHub Pages).
 * @param {typeof fetch} fetch @param {string} version
 */
export async function cargarBacktest(fetch, version) {
  const respuesta = await fetch(`data/backtest-${version}.json`)
  if (!respuesta.ok) throw new Error(`data/backtest-${version}.json: HTTP ${respuesta.status}`)
  return respuesta.json()
}

/**
 * Pestaña Laboratorio: sin data/laboratorio.json (404), «Laboratorio aún no ejecutado».
 * @param {import('./comun.js').Contexto} ctx @param {HTMLElement} pestanas
 * @returns {Promise<import('./comun.js').Pantalla>}
 */
async function vistaLaboratorio(ctx, pestanas) {
  const r = await intentar(cargarLaboratorio(ctx.fetch))
  if (!r.ok || r.valor === null) {
    const nodo = h('div', { class: 'vista' }, cabecera('Backtest', pestanas), r.ok
      ? aviso('Laboratorio aún no ejecutado: cuando exista data/laboratorio.json, aquí aparecerán el ranking y el criterio.')
      : aviso(`No se pudo cargar el laboratorio: ${r.error instanceof Error ? r.error.message : String(r.error)}`, 'error'))
    return { titulo: 'Backtest', nodo }
  }
  const l = lecturaLaboratorio(r.valor)
  const nodo = h('div', { class: 'vista vista-laboratorio' },
    cabecera('Backtest', pestanas,
      h('p', { class: 'etiqueta-variante' }, 'Laboratorio de estrategias'),
      h('p', { class: 'ayuda' }, `Generado el ${l.generado} · ${l.familias} familias · años de prueba ${l.tramos}`)),
    aviso(l.aviso, 'alerta'),
    l.criterio ? seccion('Criterio de estrategia ganadora', h('p', null, l.criterio)) : null,
    seccion('Ranking fuera de muestra',
      tabla({
        titulo: 'Ranking del laboratorio',
        columnas: [{ clave: 'posicion', texto: '#', numerica: true }, { clave: 'familia', texto: 'Familia' }, { clave: 'version', texto: 'Versión' },
          { clave: 'rentabilidad', texto: 'Rentabilidad', numerica: true }, { clave: 'caida', texto: 'Caída máx.', numerica: true },
          { clave: 'rentabilidadHodl', texto: 'Comprar y mantener', numerica: true }, { clave: 'caidaHodl', texto: 'Su caída', numerica: true },
          { clave: 'textoCumple', texto: 'Criterio' }],
        filas: l.ranking,
        vacio: 'El laboratorio no trae ranking.',
        apilable: true,
      }),
      h('p', { class: 'ayuda' }, `${l.ganadoras} de ${l.ranking.length} cumplen todos los puntos del criterio. Medido en años que no se usaron para elegir, con comisiones y deslizamiento.`)),
    seccion('Detalle por familia', l.ranking.map((p) => h('details', { class: 'familia-laboratorio' },
      h('summary', null, `${p.posicion}. ${p.familia}${p.version ? ` (${p.version})` : ''} · ${p.textoCumple}`),
      p.config ? h('p', { class: 'ayuda' }, `Configuración: ${p.config}`) : null,
      h('ul', { class: 'criterio' }, p.puntos.map((x) => h('li', { class: x.cumple ? 'cumple' : 'no-cumple' }, `${x.marca} · ${x.texto}`))),
      tabla({
        titulo: `Por año: ${p.familia}`,
        columnas: [{ clave: 'ano', texto: 'Año' }, { clave: 'rentabilidad', texto: 'Estrategia', numerica: true }, { clave: 'hodl', texto: 'Comprar y mantener', numerica: true }],
        filas: p.porAno,
        vacio: 'Sin resultados por año.',
        apilable: true,
      }),
      tabla({
        titulo: `Por moneda: ${p.familia}`,
        columnas: [{ clave: 'simbolo', texto: 'Moneda' }, { clave: 'beneficio', texto: 'Beneficio realizado', numerica: true }, { clave: 'positivo', texto: '> 0' }],
        filas: p.porMoneda,
        vacio: 'Sin resultados por moneda.',
        apilable: true,
      })))),
    l.seleccion.length > 0 ? seccion('Desplegadas en el bot', h('ul', null, l.seleccion.map((s) => h('li', null, s)))) : null,
    seccion('Tramo reservado',
      l.reservado.length > 0 ? definiciones(l.reservado) : h('p', { class: 'vacio' }, 'Sin datos del tramo reservado.'),
      h('p', { class: 'ayuda' }, 'Se mide una sola vez, al final, y no se usa para elegir.')))
  return { titulo: 'Backtest', nodo }
}

/** @param {import('./comun.js').Contexto} ctx @returns {Promise<import('./comun.js').Pantalla>} */
export async function vistaBacktest(ctx) {
  const version = paramOpcion(ctx.ruta.params, 'v', [...VERSIONES, LABORATORIO], ESTRATEGIA_PRINCIPAL)
  const pestanas = h('nav', { class: 'pestanas', 'aria-label': 'Estrategia' }, [...VERSIONES, LABORATORIO].map((v) => h('a', {
    href: hashDe('backtest', { params: { v } }), class: 'pestana', 'aria-current': v === version ? 'page' : null,
  }, v === LABORATORIO ? 'Laboratorio' : textoPestana(v))))
  if (version === LABORATORIO) return vistaLaboratorio(ctx, pestanas)
  const cargados = await Promise.all(VERSIONES.map((v) => intentar(cargarBacktest(ctx.fetch, v))))
  const porVersion = Object.fromEntries(VERSIONES.map((v, i) => [v, cargados[i]]))
  const elegido = porVersion[version]
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

Replace the whole content of `sw.js` with:

```js
// ORACLE · service worker. Guarda SOLO la estructura de la app (HTML, CSS, JS, iconos y la librería de
// gráficos) para abrir sin conexión. Nunca guarda datos: ni la API del Worker, ni Binance/OKX, ni data/*.json.
// Estrategia: red primero (una versión nueva entra sin trucos) y, sin red, la copia guardada.
// Al cambiar cualquier archivo de ESTRUCTURA, sube VERSION.

const VERSION = 'oracle-v3'
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
  './js/laboratorio.js',
  './js/refresco.js',
  './js/rutas.js',
  './js/senal.js',
  './js/series.js',
  './js/sesion.js',
  './js/velas.js',
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
  // Lo que no es estructura (API, Binance, OKX, data/*.json…) va directo a la red, sin pasar por la caché.
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

Append to the end of `styles.css`:

```css

/* Pestaña Laboratorio (Backtest) */
.criterio { list-style: none; margin: .5rem 0; padding: 0; display: grid; gap: .25rem; }
.criterio .cumple { color: var(--sube); }
.criterio .no-cumple { color: var(--baja); }
.familia-laboratorio { margin: .75rem 0; }
.familia-laboratorio summary { cursor: pointer; min-height: 44px; display: flex; align-items: center; font-weight: 600; }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --disable-warning=ExperimentalWarning --test test/pwa/laboratorio.test.js test/pwa/produccion.test.js`
Expected: PASS — 12 tests, 0 fail
Run: `npm test`
Expected: PASS — 0 fail, +12 tests (441 sobre la base `0d5341d`)

- [ ] **Step 5: Check it in a browser (manual)**

Con `npm run dev` + `npm run api-simulada`: Backtest → «Laboratorio» sin `data/laboratorio.json` → «Laboratorio aún no ejecutado…». Si el plan 4 ya generó el suyo, se ven el ranking (tarjetas a 390 px), el detalle por familia, «Desplegadas en el bot» y el tramo reservado, con el aviso «Un resultado del pasado no garantiza el futuro.». No copies el fixture a `data/`: se rechaza a propósito.

- [ ] **Step 6: Commit**

```bash
git add js/laboratorio.js js/vistas/backtest.js sw.js styles.css test/pwa/fixtures/laboratorio.json test/pwa/laboratorio.test.js test/pwa/produccion.test.js
git commit -m "feat(pwa): pestaña Laboratorio en el Backtest y guardas contra datos sintéticos en producción" -m "Lector defensivo de data/laboratorio.json; sin archivo, Laboratorio aún no ejecutado. SW con js/laboratorio.js y versión nueva." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Documentación

**Files:**
- Modify (append): `README.md`

- [ ] **Step 1: Document it**

Append to the end of `README.md`:

```markdown

## Bot con varias estrategias en vivo

Spec: [docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md](docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md) §6-§8.

- `core/estrategias.js` exporta `ESTRATEGIAS_EN_VIVO` (las que operan, cada una con su simulación activa) y
  `ESTRATEGIA_PRINCIPAL` (la que da el consejo del Panel y la única con explicaciones del LLM).
- Migración `0006_multisim.sql`: una simulación activa **por estrategia** (índice único parcial sobre
  `estrategia_version`). Se aplica con `npx wrangler@4 d1 migrations apply oracle --remote` desde `worker/`
  **antes** de desplegar el código.
- Cron de mercado: descarga los datos una vez, cierra las simulaciones activas de estrategias que ya no están en
  la lista (quedan en el historial), crea con 10.000 € las que falten y ejecuta `core/hora.js` por simulación,
  con su estrategia y sus lotes atómicos por moneda. `POST /api/analizar` sigue sin operar.
- API: `GET /api/bot/comparativa` (curvas y métricas de las simulaciones activas y comprar y mantener),
  `GET /api/simulaciones` con `etiqueta` y `principal`, `GET /api/resumen` con `estrategiaPrincipal`,
  `GET /api/bot` sin `?simulacion=` = la de la principal y `POST /api/bot/reiniciar`, que reinicia todas a la vez.
  Contrato en [docs/superpowers/plans/2026-10-20-oracle-plan-5-multisim.md](docs/superpowers/plans/2026-10-20-oracle-plan-5-multisim.md).
- PWA: el Panel dice qué estrategia aconseja; el Bot abre con la comparativa (gráfico con una curva por
  estrategia y comprar y mantener, y tabla lado a lado) y debajo el detalle de cada simulación; el Backtest
  tiene la pestaña «Laboratorio» (`data/laboratorio.json`; sin ese archivo, «Laboratorio aún no ejecutado»).
```

- [ ] **Step 2: Verify**

Run: `npm test`
Expected: PASS — 0 fail, +0 tests (441 sobre la base `0d5341d`)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: bot con varias estrategias en vivo" -m "Migración 0006, comparativa, estrategia principal y pestaña Laboratorio." -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Checklist de despliegue y verificación en producción (la ejecuta el controlador)

Nada de código. Orden obligatorio: **migración antes que el código** (el código nuevo crea varias activas; con el índice viejo `una_activa` el lote de sincronización fallaría). Todo `wrangler` desde `worker/`, nunca desde el directorio personal.

- [ ] **Step 1: Estado de partida**

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE && git status --short && git log --oneline -8 && npm test
```

Expected: árbol limpio, los commits de este plan (y los del plan 4 si ya está), 0 fail. Comprueba qué lista irá a producción:

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE && node -e "import('./core/estrategias.js').then((m) => console.log(m.ESTRATEGIAS_EN_VIVO, m.ESTRATEGIA_PRINCIPAL))"
```

Expected: `[ 'v1' ] v1` sin el plan 4; `[ 'v3', 'v4', 'v5' ] v3` con él.

- [ ] **Step 2: Marca de restauración de D1 y migración 0006**

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 whoami && npx wrangler@4 d1 time-travel info oracle
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 migrations list oracle --remote
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 migrations apply oracle --remote
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 execute oracle --remote --command "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'simulaciones'"
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 execute oracle --remote --command "SELECT id, estrategia_version, activa, cerrada_en, capital_inicial, saldo FROM simulaciones ORDER BY id"
```

Expected: anota el *bookmark* de time-travel (restauración si algo sale mal); `list` muestra solo `0006_multisim.sql` pendiente; `apply` la aplica sin error; el índice es `una_activa_por_estrategia`; la simulación v1 sigue activa con su saldo.

- [ ] **Step 3: Desplegar el Worker**

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 deploy
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && curl -s https://oracle.mundialisimo.workers.dev/api/salud
```

Expected: despliegue con los 2 crons (`1 * * * *`, `3 * * * *`) y el binding `DB`; `/api/salud` responde (200 si el último cron de mercado fue bien hace ≤ 2 h).

- [ ] **Step 4: Publicar la PWA (GitHub Pages)**

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE && git push origin main
```

Expected: Pages publica en 1-2 min; `curl -s https://jcaboroca.github.io/ORACLE/sw.js | grep VERSION` muestra la versión nueva y `curl -s -o /dev/null -w "%{http_code}" https://jcaboroca.github.io/ORACLE/js/laboratorio.js` = 200.

- [ ] **Step 5: Verificación tras el siguiente cron de mercado (minuto 3)**

Con el PIN en una variable que no quede en el historial: `read -s ORACLE_PIN && export ORACLE_PIN`.

```bash
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 execute oracle --remote --command "SELECT id, estrategia_version, activa, creada_en, cerrada_en, capital_inicial FROM simulaciones ORDER BY id"
cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 d1 execute oracle --remote --command "SELECT id, tipo, ok, json_extract(detalle_json, '$.simulaciones') AS sims, json_extract(detalle_json, '$.estrategiaPrincipal') AS principal, json_extract(detalle_json, '$.subpeticiones') AS sub FROM ejecuciones WHERE tipo = 'mercado' ORDER BY inicio DESC LIMIT 2"
curl -s -H "Authorization: Bearer $ORACLE_PIN" https://oracle.mundialisimo.workers.dev/api/simulaciones
curl -s -H "Authorization: Bearer $ORACLE_PIN" https://oracle.mundialisimo.workers.dev/api/bot/comparativa | node -e "let s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>{const c=JSON.parse(s);console.log(c.simulaciones.map((x)=>[x.id,x.estrategiaVersion,x.principal,x.valorCartera,x.operaciones,x.curva.length]),c.hodl.length,c.resumenHodl)})"
curl -s -H "Authorization: Bearer $ORACLE_PIN" https://oracle.mundialisimo.workers.dev/api/resumen | node -e "let s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>{const r=JSON.parse(s);console.log(r.estrategiaPrincipal,r.senales.map((x)=>x.estrategiaVersion),r.bot&&r.bot.estrategiaVersion)})"
```

Expected **con el plan 4** (`['v3','v4','v5']`): la simulación v1 queda `activa = 0` con `cerrada_en` = la hora de ese cron y su historia intacta; hay exactamente 3 activas (v3, v4, v5) con `capital_inicial = 10000` y la misma `creada_en`; la ejecución de mercado es `ok = 1` con `sims` de 3 elementos, `principal = "v3"` y las **mismas** subpeticiones que antes (21 típicas); `comparativa` lista v3 (principal), v4 y v5 en ese orden (curvas de 1 punto la primera hora); `resumen` → `{ version: 'v3', …, enVivo: 3 }` y señales v3. **Sin el plan 4**: una sola activa (la v1 de siempre), comparativa con un elemento y `enVivo: 1`. En la hora siguiente las curvas tienen 2 puntos y ninguna fila de `decisiones` está repetida.

- [ ] **Step 6: CPU por ejecución (spec del laboratorio §6, «se medirá y se informará»)**

En el panel de Cloudflare: Workers & Pages → `oracle` → Observability/Logs, filtra las invocaciones `scheduled` del minuto 3 de las 2-3 últimas horas y anota la CPU (antes: ~41 ms con 1 estrategia, spec §9) y el resultado. Informa la cifra con 3 estrategias. Si alguna ejecución acaba con «exceeded CPU», se informa antes de proponer nada (spec §9).

- [ ] **Step 7: PWA en el móvil**

Abre <https://jcaboroca.github.io/ORACLE/> (recarga una vez para que entre el service worker nuevo): Panel → «Consejo de la estrategia v3 (…), la principal de las 3 en vivo.»; Bot → comparativa con 3 curvas + comprar y mantener (desde la segunda hora) y la tabla en tarjetas, «Ver detalle» de cada una, detalle como antes; Backtest → pestañas «v3 (principal)», «v4 (en vivo)», «v5 (en vivo)» y «Laboratorio» con el ranking (o «Laboratorio aún no ejecutado» si `data/laboratorio.json` no se publicó). Ninguna tabla desborda en horizontal.

- [ ] **Step 8: Marcha atrás (solo si el cron de mercado falla)**

`cd /Users/jcaboroca/White_Riggs/ORACLE/worker && npx wrangler@4 rollback` vuelve al código anterior (que tolera la migración 0006 mientras haya una sola activa). Si ya hay varias activas y hay que volver al esquema anterior, restaura D1 al *bookmark* del Step 2 con `npx wrangler@4 d1 time-travel restore oracle --bookmark=<bookmark>` (se pierden las horas posteriores) y avisa.

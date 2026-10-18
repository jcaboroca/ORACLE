# ORACLE — Plan 2: Worker + D1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poner ORACLE a funcionar 24/7 en un Cloudflare Worker con D1: dos crons (noticias; mercado + bot), el bot de paper trading persistido sin pérdida e idempotente, y una API JSON protegida por PIN contra la que se escribirá la PWA (plan 3).

**Architecture:** El Worker es una capa fina de E/S alrededor de `core/` (puro, ya hecho en el plan 1 y en el contrato de estrategias): `fuentes/` descarga y valida (Binance, derivados, Fear & Greed, RSS, Reddit, LLM), `repositorio.js` concentra todo el SQL de D1, `ejecuciones/` orquesta los dos crons y `api.js` sirve el JSON. El cron de mercado llama una vez por hora a `ejecutarHora` de `core/hora.js` con la estrategia de la simulación (`estrategia(simulacion.estrategia_version)`), igual que el backtest, y persiste cada moneda en un único `db.batch()` atómico. Todo el código de producción recibe `env`, `fetch` y `ahora` como parámetros, así que los tests corren sin red ni Cloudflare: D1 se simula con `node:sqlite` aplicando las mismas migraciones y `fetch` con respuestas reales grabadas.

**Tech Stack:** Cloudflare Workers (módulos ES, sin `nodejs_compat`), D1, Workers AI, Wrangler 4 (solo para desplegar). Node ≥ 22.13, `node:test` y `node:sqlite` para los tests, cero dependencias npm.

**Spec:** `docs/superpowers/specs/2026-10-18-oracle-design.md` (§3, §4, §5, §7, §9, §10 incl. «Reconstrucción del estado del bot», §11, §12, §13, §14). Contrato de estrategias: `core/estrategias.js` + `ejecutarHora({ …, estrategia })`, ya en `main` (commits `077fe55` y `3c89f98`).

**Plan series:** 1) núcleo + backtest (hecho) · **2) Worker + D1 (este)** · 3) PWA (se escribirá a partir de la sección «Contrato de la API» de este plan).

**Prerrequisito:** `main` contiene `core/estrategias.js` (con `v1` y `v2`, `ESTRATEGIA_ACTIVA = 'v1'`) y `core/hora.js` acepta `estrategia`. Compruébalo antes de empezar:

```bash
node -e "import('./core/estrategias.js').then(m => console.log(Object.keys(m.ESTRATEGIAS), m.ESTRATEGIA_ACTIVA))"
```

Esperado: `[ 'v1', 'v2' ] v1`.

**Verified:** todo el código de este plan se ejecutó antes de escribirlo. Un script reprodujo **este mismo documento** sobre una copia limpia de `main` @ `75e7234` (Node 24.6): aplicó cada bloque en orden, ejecutó cada `Run:` y comprobó su `Expected:` (cada test falla con `ERR_MODULE_NOT_FOUND` donde el plan lo dice y pasa con el número de tests indicado) e hizo los 10 commits sin dejar nada fuera. Resultado final: `npm test` = 229 tests en verde (125 de `core` + 11 del léxico + 93 del Worker), también con el `fetch` global sustituido por uno que lanza (los tests no usan la red). Además, `npx wrangler@4 deploy --dry-run` (wrangler 4.151.1) empaqueta el Worker (88,3 KiB; 24,4 KiB gzip) y un `wrangler dev --test-scheduled` local (sin el binding AI, que exige login) ejecutó los dos crons contra Binance, alternative.me y los 14 RSS reales: 5 señales, simulación creada, HODL guardado, 196 titulares puntuados con el léxico y la API respondiendo con las formas del «Contrato de la API». Ese smoke test destapó que el módulo principal no puede tener exportaciones con nombre (de ahí `crones.js`).

## Global Constraints

- Node ≥ 22.13 (`node:sqlite` sin flag). Cero dependencias npm; Wrangler se usa con `npx wrangler@4` solo para desplegar.
- ES modules, `// @ts-check` en la primera línea de cada `.js`, sin punto y coma, comillas simples, identificadores y mensajes en español (estilo de `core/`).
- `core/` no importa red, `fetch`, `fs` ni D1. El código del Worker recibe `env`, `fetch` y `ahora` como parámetros; en `worker/src/` solo `index.js` (para `ahora` de la API) y el campo informativo `fin` de `ejecuciones` leen `Date.now()`.
- Nunca precios inventados o sintéticos en producción: una fuente caída deja el dato ausente (`SIN_DATOS`, derivados `null`, F&G `null`). Los generadores de velas solo existen en `test/ayudantes.js` y `worker/test/escenario.js`.
- Solo velas cerradas: una vela cuenta en `t` si `vela.fin <= t` (lo garantizan `core/` y `ultimoCierre`/`cambio24h`).
- Solo largos al contado; `CHECK (saldo >= 0)`; ninguna ruta envía órdenes a un exchange; ninguna clave con permisos de trading.
- Presupuesto §9 por invocación: ≤ 50 subpeticiones externas y ≤ 50 llamadas a D1; sin KV; exactamente 2 crons (`1 * * * *`, `3 * * * *`).
- Secrets solo con `wrangler secret put` (`ORACLE_PIN`, `GROQ_API_KEY`, `GEMINI_API_KEY`); nunca en `wrangler.toml` ni en el repo.
- El módulo principal `worker/src/index.js` solo tiene `export default` (el runtime rechaza cualquier otra exportación: comprobado con `wrangler dev`).
- Aviso obligatorio: "Simulación. No es asesoramiento financiero ni garantía de beneficio" (README; cabeceras de `index.js` y `wrangler.toml`).
- Commits con el trailer `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Decisiones de diseño (vinculantes para las tareas)

1. **Saldo por deltas, un lote por moneda.** `ejecutarHora` devuelve decisiones y eventos de todas las monedas juntos. Se separan por `decision.simbolo` (cada evento lleva `simbolo`; con `core/bot.js` hay como mucho un evento por moneda y hora, pero el código acepta varios en orden). Cada lote de moneda mueve el saldo con un **delta** (`saldo = saldo − importe` en compras, `saldo = saldo + importe − comisión` en ventas, las mismas operaciones y en el mismo orden que `core/bot.js`, así que el resultado es idéntico al de memoria) en lugar de escribir el `saldoTras` absoluto, y `operaciones.saldo_tras` se lee del saldo real dentro del lote (`(SELECT saldo FROM simulaciones WHERE id = ?)`). Así cualquier subconjunto de lotes que entre deja D1 coherente: si el lote de ETH falla a mitad de ejecución, BTC y SOL quedan bien, el saldo es exactamente capital − compras + ventas netas de lo que sí entró (el test «el libro cuadra» lo comprueba) y ETH se reintenta sola la hora siguiente porque su `progreso` no avanzó. Con un `saldoTras` absoluto, el lote de una moneda posterior arrastraría el efecto del lote fallido (dinero que aparece o desaparece). Si un delta dejara el saldo real negativo (porque un lote anterior no entró), `CHECK (saldo >= 0)` revierte ese lote entero.
2. **Idempotencia** (§7.5): el lote empieza con `INSERT INTO decisiones` sin `OR IGNORE`; repetir la hora (doble cron, reintento) viola `UNIQUE(simulacion_id, simbolo, vela_1h)` y revierte el lote completo. Esa violación se registra en `repetidas`, no como fallo. Las operaciones se enlazan a su posición con `(SELECT id FROM posiciones WHERE … AND estado = 'abierta')`: si no existe, `NOT NULL` revierte el lote.
3. **Estado reconstruido sin pérdida** (§10): `cargarEstado` lee en un lote las posiciones abiertas **`ORDER BY id`** (orden de apertura = orden de claves en memoria; `valorCartera` suma en ese orden y así el resultado coincide bit a bit con el backtest — sin el `ORDER BY` el test de paridad falla en el último decimal), `progreso` (sin fila = nunca revisada: la clave no existe) y `MAX(vela_salida) + PARAMETROS_BOT.enfriamientoHoras · 1 h` de los cierres por `stop_loss`. El HODL se guarda en `simulaciones.hodl_json` la primera vez que `ejecutarHora` lo devuelve (`UPDATE … WHERE hodl_json IS NULL`) y se restaura de ahí.
4. **Punto de capital desde D1, no desde memoria**: tras los lotes se recarga el estado y se valora con el último cierre EUR cerrado de cada moneda (`INSERT OR IGNORE`). Si una moneda con posición abierta no tiene precio EUR, no se escribe el punto (se anota el fallo) en vez de valorarla con un precio supuesto. `valor_hodl` es `null` mientras falte el precio de alguna moneda del HODL.
5. **Orden del cron de mercado**: velas + derivados + F&G (en paralelo) → titulares 24 h de D1 → bot (lotes + capital) → **una** llamada al LLM para explicar → `senales_actuales` → cierre de la ejecución. El bot va antes del LLM (la spec §5 lo pone después): si el LLM tarda o cae, las operaciones ya están guardadas. El resultado observable es el mismo.
6. **Análisis manual** (`POST /api/analizar`): el mismo `ejecutarMercado` con `manual: true`; calcula las señales con `estrategia.calcularSenal` (estrategia de la simulación activa, o `ESTRATEGIA_ACTIVA` si no hay) y nunca crea simulaciones ni escribe decisiones, operaciones, posiciones, progreso ni capital. 429 si la última ejecución `manual` empezó hace < 5 min.
7. **LLM en cascada** (resolución 1 del controlador): Workers AI (`env.AI`, modelo de `LLM_MODELO_CF`) → Groq (solo con `GROQ_API_KEY`) → Gemini (solo con `GEMINI_API_KEY`) → `core/lexico.js`. Modelo elegido y verificado en developers.cloudflare.com/workers-ai/models el 2026-10-18: **`@cf/meta/llama-3.1-8b-instruct-fp8`** (32k de contexto; 0,152 $/M de entrada y 0,287 $/M de salida ≈ 13.800 y 26.100 neuronas/M). Estimación: un lote de 80 titulares ≈ 2.500 tokens de entrada + 1.600 de salida ≈ 77 neuronas; una explicación de 5 señales ≈ 31 → ≈ 2.600 neuronas/día de las 10.000 gratuitas por cuenta (un 70B cuesta ~8× más y no cabría). Groq: `llama-3.3-70b-versatile`; Gemini: alias `gemini-flash-latest`; ambos en vars. Cada respuesta se valida estrictamente; los elementos inválidos se descartan y esos titulares (o explicaciones) pasan al siguiente recurso. `titulares.motor ∈ cf | groq | gemini | lexico`; `motorExplicacion ∈ cf | groq | gemini | plantilla`.
8. **Reddit por Atom, no `.json`**: `www.reddit.com/r/{sub}/new.json` responde 403 a clientes que no son navegador (comprobado el 2026-10-18); `…/new/.rss` responde 200 y se parsea con el mismo lector Atom que los RSS. Fixture grabado: `test/fixtures/reddit-cryptocurrency.xml` (el controlador pedía un JSON de Reddit, pero no hay JSON real que grabar). Reddit sigue siendo best-effort (429 frecuentes).
9. **Open interest con 25 puntos** horarios (`limit=25`): el cambio 24 h compara el último punto con el de exactamente 24 h antes (la spec dice «24 puntos», que solo abarcan 23 h). Se usa `sumOpenInterest` (contratos), no el valor en USDT, para no mezclar el movimiento del precio.
10. **Lotes de titulares en una sola sentencia D1**: inserción con `INSERT OR IGNORE … SELECT … FROM json_each(?)` y puntuaciones con `UPDATE … FROM json_each(?)`: un solo parámetro, lejos del límite de 100 parámetros por consulta de D1 (probado en `wrangler dev` con 196 titulares).
11. **CORS** por lista exacta de la var `ORIGENES` (`https://jcaboroca.github.io,http://localhost:8080`; la spec decía `localhost:*`, el controlador fijó la var). `GET /api/salud` es pública (sin PIN) para monitorizar.
12. **Archivos extra respecto al §3**: `worker/src/config.js` (lectura de `MONEDAS`, capital por defecto) y `worker/src/crones.js` (despacho por cron; no puede vivir en `index.js` porque el módulo principal solo puede exportar el manejador).
13. **Purga** (§10) en el cron de noticias: titulares > 7 días, ejecuciones > 30 días y, además, bloqueos de PIN caducados.

## Presupuesto por invocación (§9)

| Invocación | Subpeticiones externas (límite 50) | Llamadas a D1 (límite 50) |
|---|---|---|
| Cron `1 * * * *` noticias | 14 RSS + 3 Reddit + ≤ 2 LLM (Groq, Gemini) = **≤ 19** (Workers AI es un servicio interno) | iniciar, insertar, sin puntuar, guardar puntuaciones, purga (1 lote), finalizar = **6** |
| Cron `3 * * * *` mercado | 5 × 4 velas = 20 + derivados 1 + 5 × 2 = 11 + F&G 1 + ≤ 2 LLM = **≤ 34** (el test lo mide: exactamente 34 con Groq y Gemini fallando) | iniciar, simulación activa, (crear), titulares, cargar estado, (HODL), 5 lotes, simulación, cargar estado, capital, señales, finalizar = **≤ 17** (medido en el test) |
| `POST /api/analizar` | como el mercado: **≤ 34** | PIN ≤ 2 + última manual + iniciar + simulación + titulares + señales + finalizar = **≤ 8** |
| `GET` de la API | 0 | PIN ≤ 2 + ≤ 6 = **≤ 8** |

Escrituras D1/día ≈ 120 decisiones + 120 progreso + 120 señales + 24 capital + ~1.200 titulares nuevos + ~1.200 puntuaciones + 72 ejecuciones + operaciones ≈ 3.000 filas (+ índices) frente a 100.000: ~3-6 %. Sin KV. CPU: parsing por regex, sin librerías.

## Contrato de la API

La PWA (plan 3) se escribe contra esta sección. Lo que no está aquí no está garantizado.

**Convenciones**

- Base: `https://oracle.<subdominio>.workers.dev`. Respuestas `application/json; charset=utf-8` con `Cache-Control: no-store`.
- Autenticación: cabecera `Authorization: Bearer <PIN>` en todas las rutas salvo `GET /api/salud` y `OPTIONS`.
- CORS: solo para los orígenes exactos de `ORIGENES`; `OPTIONS` → 204 sin PIN.
- Unidades: precios e importes en **€** (`number`, sin redondear); porcentajes y rentabilidades como **fracción** (`0.05` = 5 %; `drawdownMaximo` es positivo, `0.25` = caída del 25 %); instantes en **ms desde epoch UTC**. `vela1h` = inicio (ms) de una vela 1H; en decisiones, capital y posiciones es la vela de decisión (la hora anterior a la ejecución).
- Excepción documentada: en la señal completa, `precio` es el cierre **USDT** que usan los indicadores; para mostrar, `precioEur`.
- `null` significa dato ausente (fuente caída, aún no calculado); nunca un 0 fingido.

**Errores** — cuerpo `{ "error": string, "detalle": string, "hasta"?: number }`:

| HTTP | `error` | Cuándo |
|---|---|---|
| 400 | `peticion_invalida` | parámetro o cuerpo mal formado (`detalle` dice cuál) |
| 401 | `pin_incorrecto` | PIN ausente o incorrecto; `detalle`: `"PIN incorrecto. Quedan N intentos."` |
| 404 | `no_encontrado` | ruta, moneda o simulación inexistente |
| 405 | `metodo_no_permitido` | ruta existente con otro método |
| 429 | `bloqueado` | 5 fallos de PIN desde la IP; `hasta` = fin del bloqueo (15 min) |
| 429 | `demasiado_pronto` | `POST /api/analizar` antes de 5 min; `hasta` = cuándo se podrá |
| 500 | `configuracion` | falta el secret `ORACLE_PIN` |
| 500 | `interno` | error inesperado |
| 502 | `analisis_fallido` | `POST /api/analizar` no pudo completarse |

**Tipos** (notación TypeScript; el orden de claves es el que devuelve el Worker):

```ts
type Veredicto = 'COMPRAR' | 'MANTENER' | 'VENDER' | 'SIN_DATOS'
type Ejecucion = { id: number, tipo: 'noticias' | 'mercado' | 'manual', inicio: number, fin: number | null,
  ok: boolean | null /* null = en curso */, fallos: string[] /* fuentes caídas, texto legible */ }
type Fng = { valor: number /* 0-100 */, clasificacion: string /* 'Neutral', 'Fear'… (inglés) */, t: number }
type SenalResumen = {
  simbolo: string, veredicto: Veredicto, indiceConfianza: number | null /* 0-0,95, sin calibrar */,
  puntuacion: number | null /* S ∈ [-1, 1] */, precioEur: number | null, cambio24h: number | null /* fracción */,
  fresca: boolean, calculadaEn: number, vela1h: number | null, frase: string /* 1.ª frase de la explicación */,
  motorExplicacion: 'cf' | 'groq' | 'gemini' | 'plantilla', estrategiaVersion: string }
type SenalCompleta = {            // senal_json tal cual: salida de calcularSenal de la estrategia + 5 campos del Worker
  version: string, simbolo: string, calculadaEn: number, vela1h: number | null, precio: number | null /* USDT */,
  fresca: boolean, veredicto: Veredicto, puntuacion: number | null, indiceConfianza: number | null,
  motivo: string | null /* p. ej. 'contradiccion_tecnico_derivados', 'filtro_regimen', 'velas_insuficientes' */,
  ausentes: string[] /* de 'tecnico' | 'derivados' | 'noticias' | 'fng' */, alineacion: boolean, atrPct: number | null,
  componentes: { tecnico: number | null, derivados: number | null, noticias: number | null, fng: number | null },
  detalle: {
    timeframes: Record<'1h' | '4h' | '1d', null | { tendencia: 'alcista' | 'bajista' | 'lateral', d: number,
      precio: number, ema20: number, ema50: number, ema200: number, rsi: number, macdHist: number, pctB: number,
      subs: { tendencia: number, ema200: number, rsi: number, macd: number, bollinger: number }, puntuacion: number }>,
    derivados: { funding?: number, longShort?: number, openInterest?: number } /* subpuntuaciones presentes */,
    noticias: string[] /* ids de los titulares usados */, fng: number | null /* valor 0-100 usado */,
    regimen?: { sobreEma200: boolean } | null /* solo v2 */ },
  precioEur: number | null, cambio24h: number | null, explicacion: string,
  motorExplicacion: 'cf' | 'groq' | 'gemini' | 'plantilla',
  orientativo: { stopLoss: number, takeProfit: number } | null /* € si se abriera ahora */ }
type Titular = { id: string, fuente: string, origen: 'rss' | 'reddit', titulo: string, url: string | null,
  publicadoEn: number, monedas: string[] /* símbolos, ['MERCADO'] o [] */, puntuacion: number | null /* [-1, 1] */,
  motor: 'cf' | 'groq' | 'gemini' | 'lexico' | null, usado: boolean /* entró en N de la señal actual */ }
type Decision = { id: number, simbolo: string, vela1h: number, veredicto: Veredicto, indiceConfianza: number | null,
  puntuacion: number | null, accion: 'abrir' | 'cerrar' | 'ninguna',
  motivo: string /* abierta | cerrada | mantener | sin_posicion | ya_en_posicion | confianza_baja | saldo_insuficiente |
    datos_desactualizados | sin_datos | enfriamiento | cerrada_por_stop | fuera_de_ventana | motivo de la señal */,
  precio: number | null /* € de cierre de la vela de decisión */, estrategiaVersion: string, creadaEn: number }
type Operacion = { id: number, posicionId: number, simbolo: string, lado: 'compra' | 'venta', vela1h: number,
  precio: number /* € con deslizamiento */, unidades: number,
  importe: number /* compra: € invertidos con comisión; venta: bruto antes de comisión */, comision: number,
  deslizamiento: number /* € */, motivo: 'senal' | 'stop_loss' | 'take_profit', saldoTras: number,
  pnlNeto: number | null /* solo ventas */, estrategiaVersion: string, creadaEn: number }
type Posicion = { id: number, simbolo: string, velaEntrada: number, precioEntrada: number, unidades: number,
  coste: number, stopLoss: number, takeProfit: number /* € fijos desde la apertura */,
  precioActual: number /* € de la última decisión con precio */, valorActual: number,
  pnlNoRealizado: number /* € */, pnlNoRealizadoPct: number /* fracción */ }
type Simulacion = { id: number, creadaEn: number, cerradaEn: number | null, activa: boolean,
  estrategiaVersion: string, capitalInicial: number, saldo: number }
type ResumenOperaciones = { operaciones: number /* compras + ventas */, cerradas: number, ganadoras: number,
  perdedoras: number, beneficioRealizado: number, beneficioMedio: number | null, comisiones: number, deslizamiento: number }
type Metricas = { valorCartera: number, saldo: number } & ResumenOperaciones & {
  beneficioNoRealizado: number, rentabilidad: number, rentabilidadHodl: number | null, drawdownMaximo: number,
  drawdownMaximoHodl: number | null, operacionesPorSemana: number | null }
type PuntoCurva = { t: number /* vela1h */, valor: number, saldo: number, hodl: number | null }
```

**Rutas**

| Método y ruta | Respuesta 2xx |
|---|---|
| `GET /api/salud` (pública) | `200` si la última ejecución `mercado` acabó bien hace ≤ 2 h; si no, `503`. Cuerpo `{ ok: boolean, ultimaEjecucion: Ejecucion \| null }` (la última de tipo `mercado`) |
| `GET /api/resumen` | `{ ahora: number, senales: SenalResumen[] /* orden de MONEDAS, solo las calculadas */, fng: Fng \| null /* último guardado */, bot: null \| { simulacionId: number, estrategiaVersion: string, capitalInicial: number, saldo: number, valorCartera: number, valorHodl: number \| null, rentabilidad: number, rentabilidadHodl: number \| null, posicionesAbiertas: number, actualizadoEn: number \| null /* vela1h del último punto de capital */ }, ultimaEjecucion: Ejecucion \| null /* mercado o manual */, ultimaNoticias: Ejecucion \| null, datosDesactualizados: boolean /* sin señales, alguna no fresca o calculada hace > 2 h */ }` |
| `GET /api/moneda/:sym` (`:sym` de `MONEDAS`, sin distinguir mayúsculas; si no, 404) | `{ simbolo: string, senal: SenalCompleta \| null, titulares: Titular[] /* de la moneda o MERCADO en las 24 h previas a la señal, recientes primero, máx. 50 */, decisiones: Decision[] /* simulación activa, recientes primero, máx. 48 */ }` |
| `GET /api/bot?simulacion=<id>` (sin parámetro: la activa; 404 si no hay) | `{ simulacion: Simulacion, metricas: Metricas, porMoneda: Record<string, ResumenOperaciones>, abiertas: Posicion[] /* orden de apertura */, curva: PuntoCurva[] /* horaria los últimos 30 días; antes, el último punto de cada día UTC */, hodl: Record<string, number> \| null /* unidades */ }` |
| `GET /api/bot/operaciones?simulacion=&simbolo=&cursor=` | `{ items: Operacion[] /* id descendente, 50 por página */, siguienteCursor: number \| null }`; la página siguiente se pide con `cursor=siguienteCursor` (ids menores) |
| `GET /api/bot/decisiones?simulacion=&simbolo=&cursor=` | `{ items: Decision[], siguienteCursor: number \| null }` (como operaciones; incluye MANTENER y no ejecutadas) |
| `GET /api/simulaciones` | `{ items: Simulacion[] /* id descendente */ }` |
| `POST /api/bot/reiniciar`, cuerpo `{ "capital_inicial": number /* 100-1.000.000 */, "confirmar": true }` | `201 { simulacion: Simulacion }` (la nueva, con `ESTRATEGIA_ACTIVA`; la anterior queda `activa: false` con `cerradaEn`; nada se borra) |
| `POST /api/analizar` (sin cuerpo) | `{ senales: SenalResumen[], ejecucion: Ejecucion }`; no opera |

Ejemplo real (smoke test con `wrangler dev`, 2026-10-18, recortado a una moneda):

```json
{
  "ahora": 1792361228071,
  "senales": [{ "simbolo": "BTC", "veredicto": "MANTENER", "indiceConfianza": 0.422523733, "puntuacion": 0.045047465,
    "precioEur": 72461.88, "cambio24h": 0.004356209264924971, "fresca": true, "calculadaEn": 1792361203556,
    "vela1h": 1792357200000, "frase": "Mantener en BTC (puntuación 0,05, confianza 42 %, sin calibrar).",
    "motorExplicacion": "plantilla", "estrategiaVersion": "v1" }],
  "fng": { "valor": 53, "clasificacion": "Neutral", "t": 1792281600000 },
  "bot": { "simulacionId": 1, "estrategiaVersion": "v1", "capitalInicial": 10000, "saldo": 10000, "valorCartera": 10000,
    "valorHodl": 9985.007496251876, "rentabilidad": 0, "rentabilidadHodl": -0.0014992503748124664,
    "posicionesAbiertas": 0, "actualizadoEn": 1792357200000 },
  "ultimaEjecucion": { "id": 1, "tipo": "mercado", "inicio": 1792361203556, "fin": 1792361205266, "ok": true, "fallos": [] },
  "ultimaNoticias": null,
  "datosDesactualizados": false
}
```

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `core/lexico.js` | léxico local: `detectarMonedas`, `puntuarTitular`, `analizarTitular`, `normalizarTexto` | 1 |
| `test/lexico.test.js` | tests del léxico | 1 |
| `package.json` | `engines` ≥ 22.13 y `npm test` también sobre `worker/test/*.test.js` | 2 |
| `worker/migrations/0001_inicial.sql` | esquema §10 (con `coste`, `pnl_neto`, `motor` cf) + índices | 2 |
| `worker/test/d1.js` | D1 simulado sobre `node:sqlite` (solo tests) | 2 |
| `worker/test/d1.test.js` | adaptador y restricciones del esquema | 2 |
| `test/fixtures/*.json` | respuestas reales grabadas: klines, premiumIndex, long/short, open interest, F&G | 3 |
| `worker/test/ayudantes.js` | `simularFetch`, fixtures, `aFilasBinance` (solo tests) | 3 |
| `worker/src/fuentes/binance.js` | velas validadas, `descargarMoneda`, `cambio24h`, `ultimoCierre` | 3 |
| `worker/src/fuentes/derivados.js` | funding, long/short, open interest → `Derivados` | 3 |
| `worker/src/fuentes/fng.js` | Fear & Greed | 3 |
| `test/fixtures/*.xml` | RSS de CoinTelegraph y Atom de r/CryptoCurrency grabados | 4 |
| `worker/src/fuentes/rss.js` | 14 feeds, lector RSS/Atom por regex | 4 |
| `worker/src/fuentes/reddit.js` | 3 subreddits por Atom | 4 |
| `worker/src/fuentes/llm.js` | cascada cf → groq → gemini, validación, léxico y plantilla | 5 |
| `worker/src/repositorio.js` | todo el SQL (se crea en 6 y crece en 7, 8 y 9) | 6-9 |
| `worker/test/escenario.js` | escenario sintético de varias horas + `fetchEscenario` (solo tests) | 6 |
| `worker/src/config.js` | `leerMonedas`, `CAPITAL_POR_DEFECTO` | 7 |
| `worker/src/ejecuciones/noticias.js` | cron de noticias | 7 |
| `worker/src/ejecuciones/mercado.js` | cron de mercado y análisis manual | 8 |
| `worker/src/auth.js` | PIN, bloqueo, CORS | 9 |
| `worker/src/api.js` | rutas y formas JSON del contrato | 9 |
| `worker/src/crones.js` | despacho por expresión de cron | 10 |
| `worker/src/index.js` | `export default { fetch, scheduled }` | 10 |
| `worker/wrangler.toml` | nombre, crons, D1, AI, vars | 10 |
| `README.md` | sección Worker | 10 |

`.gitignore` ya ignora `worker/.wrangler/` y `worker/.dev.vars` (plan 1).

Comandos de test de una tarea: los de `core` con `node --test test/<archivo>.test.js`; los del Worker con `node --disable-warning=ExperimentalWarning --test worker/test/<archivo>.test.js` (`node:sqlite` avisa de que es experimental; el aviso no afecta).

---

### Task 1: Léxico local de titulares

**Files:**
- Create: `core/lexico.js`
- Test: `test/lexico.test.js`

**Interfaces:**
- Consumes: nada.
- Produces (`core/lexico.js`, puro):
  - `ALIAS_MONEDAS: Readonly<Record<'BTC'|'ETH'|'SOL'|'BNB'|'XRP', readonly string[]>>` (BTC bitcoin/btc · ETH ethereum/ether/eth · SOL solana/sol · BNB bnb/binance coin/bnb chain · XRP xrp/ripple), `POSITIVAS`, `NEGATIVAS: readonly string[]`
  - `normalizarTexto(texto: string): string` — minúsculas, sin acentos, signos → espacio, rodeado de un espacio
  - `detectarMonedas(titulo: string): string[]` — palabras completas, en el orden BTC, ETH, SOL, BNB, XRP; `[]` si ninguna
  - `puntuarTitular(titulo: string): number` — `(pos − neg) / máx(2, pos + neg)` ∈ [-1, 1]
  - `analizarTitular(titulo: string): { puntuacion: number, monedas: string[] }` — sin monedas → `['MERCADO']`

- [ ] **Step 1: Write the failing test**

Create `test/lexico.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/lexico.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `core/lexico.js`.

- [ ] **Step 3: Write the implementation**

Create `core/lexico.js`:

```js
// @ts-check
// Análisis de titulares sin IA: último recurso cuando ningún LLM responde. Puro, sin red.

/** Alias por moneda. Se buscan como palabras completas sobre el texto normalizado. */
export const ALIAS_MONEDAS = Object.freeze({
  BTC: Object.freeze(['bitcoin', 'btc']),
  ETH: Object.freeze(['ethereum', 'ether', 'eth']),
  SOL: Object.freeze(['solana', 'sol']),
  BNB: Object.freeze(['bnb', 'binance coin', 'bnb chain']),
  XRP: Object.freeze(['xrp', 'ripple']),
})

export const POSITIVAS = Object.freeze([
  'surge', 'surges', 'surged', 'soar', 'soars', 'soared', 'rally', 'rallies', 'rallied',
  'jump', 'jumps', 'jumped', 'gain', 'gains', 'climb', 'climbs', 'rise', 'rises', 'bullish',
  'record high', 'all time high', 'ath', 'breakout', 'rebound', 'rebounds', 'recovers', 'recovery',
  'approval', 'approved', 'approves', 'adoption', 'inflows', 'upgrade', 'partnership',
  'buys', 'accumulate', 'accumulates',
  'sube', 'suben', 'dispara', 'alcista', 'maximo historico', 'aprobacion', 'aprueba', 'adopcion',
])

export const NEGATIVAS = Object.freeze([
  'crash', 'crashes', 'crashed', 'plunge', 'plunges', 'plunged', 'drop', 'drops', 'dropped',
  'fall', 'falls', 'fell', 'slump', 'slumps', 'tumble', 'tumbles', 'sink', 'sinks', 'bearish',
  'hack', 'hacked', 'hacker', 'hackers', 'exploit', 'exploited', 'stolen', 'theft', 'unauthorized',
  'lawsuit', 'sues', 'sued', 'ban', 'bans', 'banned', 'outflows', 'liquidation', 'liquidations',
  'sell off', 'selloff', 'dump', 'dumps', 'fraud', 'scam', 'investigation', 'probe',
  'delist', 'delists', 'delisting', 'halted', 'halts', 'bankruptcy', 'insolvent',
  'cae', 'caen', 'caida', 'desploma', 'bajista', 'hackeo', 'robo', 'demanda', 'prohibe',
  'prohibicion', 'quiebra', 'fraude', 'estafa',
])

/**
 * Minúsculas, sin acentos y con todo lo que no sea letra o número convertido en espacio.
 * Devuelve el texto rodeado de un espacio para buscar palabras completas con `includes(' x ')`.
 * @param {string} texto
 */
export function normalizarTexto(texto) {
  const limpio = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim()
  return ` ${limpio} `
}

/** @param {string} texto normalizado @param {readonly string[]} terminos */
const contar = (texto, terminos) => terminos.filter((t) => texto.includes(normalizarTexto(t))).length

/**
 * Monedas seguidas que menciona el titular, en el orden de ALIAS_MONEDAS.
 * @param {string} titulo
 * @returns {string[]}
 */
export function detectarMonedas(titulo) {
  const texto = normalizarTexto(titulo)
  return Object.entries(ALIAS_MONEDAS).filter(([, alias]) => contar(texto, alias) > 0).map(([simbolo]) => simbolo)
}

/**
 * (positivas − negativas) / máx(2, positivas + negativas): un acierto vale ±0,5 y dos del mismo signo ±1.
 * @param {string} titulo
 * @returns {number} en [-1, 1]
 */
export function puntuarTitular(titulo) {
  const texto = normalizarTexto(titulo)
  const positivas = contar(texto, POSITIVAS)
  const negativas = contar(texto, NEGATIVAS)
  return (positivas - negativas) / Math.max(2, positivas + negativas)
}

/**
 * Sin monedas reconocidas el titular cuenta como de mercado general.
 * @param {string} titulo
 * @returns {{ puntuacion: number, monedas: string[] }}
 */
export function analizarTitular(titulo) {
  const monedas = detectarMonedas(titulo)
  return { puntuacion: puntuarTitular(titulo), monedas: monedas.length > 0 ? monedas : ['MERCADO'] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/lexico.test.js`
Expected: PASS — 11 tests, 0 fail.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 0 fail (136 tests al escribir este plan: 125 previos de `core` + 11).

- [ ] **Step 6: Commit**

```bash
git add core/lexico.js test/lexico.test.js
git commit -m "feat(core): léxico local para puntuar titulares sin IA" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 2: Esquema D1 y D1 simulado para tests

**Files:**
- Modify: `package.json` (`engines.node` y `scripts.test`)
- Create: `worker/migrations/0001_inicial.sql`
- Create: `worker/test/d1.js`
- Test: `worker/test/d1.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - Esquema D1 de la spec §10 (tablas `simulaciones`, `posiciones`, `operaciones`, `decisiones`, `progreso`, `capital`, `senales_actuales`, `titulares`, `ejecuciones`, `intentos_pin`) + índices `posiciones_salida`, `operaciones_simulacion`, `decisiones_simulacion`, `ejecuciones_tipo`.
  - `worker/test/d1.js` (solo tests): `crearD1(): D1Simulado` con `prepare(sql).bind(...valores).first(columna?) | .all() | .run()`, `batch(sentencias)` atómico (BEGIN/COMMIT; ROLLBACK ante cualquier error), `exec(sql)`, `sqlite` (la `DatabaseSync`) y `llamadas: number` (cuenta first/all/run/batch/exec, como Cloudflare). `all()`/`run()` → `{ results, success: true, meta: { changes, last_row_id } }`; las filas son objetos planos. Cada sentencia expone `sql` y `valores` (los usan los tests de fallo de lote).

- [ ] **Step 1: Update `package.json`**

En `package.json` cambia solo estas dos líneas (deja el resto como esté):

```json
    "node": ">=22.13"
```

```json
    "test": "node --disable-warning=ExperimentalWarning --test \"test/*.test.js\" \"worker/test/*.test.js\"",
```

`node:sqlite` no necesita flag desde Node 22.13; `--disable-warning` silencia su aviso de API experimental (los procesos hijos de `node --test` heredan la opción).

- [ ] **Step 2: Write the failing test**

Create `worker/test/d1.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { crearD1 } from './d1.js'

/** @param {ReturnType<typeof crearD1>} db @param {number} [saldo] */
async function simulacion(db, saldo = 10_000) {
  const r = await db.prepare(
    "INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (0, 'v1', ?, ?)",
  ).bind(saldo, saldo).run()
  return r.meta.last_row_id
}

/** @param {number} simulacionId @param {string} simbolo @param {'abierta'|'cerrada'} [estado] */
const posicion = (simulacionId, simbolo, estado = 'abierta') => [
  `INSERT INTO posiciones (simulacion_id, simbolo, estado, vela_entrada, precio_entrada, unidades, coste, stop_loss, take_profit)
   VALUES (?, ?, ?, 0, 100, 1, 100, 90, 120)`,
  [simulacionId, simbolo, estado],
]

/** @param {number} simulacionId @param {string} simbolo @param {number} vela */
const decision = (simulacionId, simbolo, vela) => [
  `INSERT INTO decisiones (simulacion_id, simbolo, vela_1h, veredicto, accion, motivo, desglose_json, estrategia_version, creada_en)
   VALUES (?, ?, ?, 'MANTENER', 'ninguna', 'mantener', '{}', 'v1', 0)`,
  [simulacionId, simbolo, vela],
]

describe('D1 simulado', () => {
  test('aplica las migraciones: existen todas las tablas de la spec §10', async () => {
    const db = crearD1()
    const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    assert.deepEqual(results.map((r) => r.name), [
      'capital', 'decisiones', 'ejecuciones', 'intentos_pin', 'operaciones', 'posiciones', 'progreso',
      'senales_actuales', 'simulaciones', 'titulares',
    ])
  })

  test('first devuelve la fila, una columna o null; all devuelve results; run devuelve meta', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    assert.equal(id, 1)
    const fila = await db.prepare('SELECT id, saldo FROM simulaciones WHERE id = ?').bind(id).first()
    assert.deepEqual(fila, { id: 1, saldo: 10_000 })
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), 10_000)
    assert.equal(await db.prepare('SELECT * FROM simulaciones WHERE id = 99').first(), null)
    const r = await db.prepare('UPDATE simulaciones SET saldo = saldo - 1').run()
    assert.equal(r.meta.changes, 1)
  })

  test('RETURNING devuelve filas también en batch', async () => {
    const db = crearD1()
    const [r] = await db.batch([
      db.prepare("INSERT INTO simulaciones (creada_en, estrategia_version, capital_inicial, saldo) VALUES (5, 'v1', 1, 1) RETURNING id, creada_en"),
    ])
    assert.deepEqual(r.results, [{ id: 1, creada_en: 5 }])
  })

  test('batch es atómico: un error revierte todas las sentencias anteriores', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const [sqlD, valoresD] = decision(id, 'BTC', 0)
    await db.prepare(sqlD).bind(...valoresD).run()
    const [sqlP, valoresP] = posicion(id, 'ETH')
    await assert.rejects(db.batch([
      db.prepare('UPDATE simulaciones SET saldo = 1 WHERE id = ?').bind(id),
      db.prepare(sqlP).bind(...valoresP),
      db.prepare(sqlD).bind(...valoresD), // repetida: UNIQUE(simulacion_id, simbolo, vela_1h)
    ]), /UNIQUE/)
    assert.equal(await db.prepare('SELECT saldo FROM simulaciones').first('saldo'), 10_000)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM posiciones').first('n'), 0)
  })

  test('el saldo nunca puede quedar negativo', async () => {
    const db = crearD1()
    const id = await simulacion(db, 5)
    await assert.rejects(db.prepare('UPDATE simulaciones SET saldo = saldo - 6 WHERE id = ?').bind(id).run(), /CHECK/)
  })

  test('solo una simulación activa', async () => {
    const db = crearD1()
    await simulacion(db)
    await assert.rejects(simulacion(db), /UNIQUE/)
    await db.prepare('UPDATE simulaciones SET activa = 0').run()
    assert.equal(await simulacion(db), 2)
  })

  test('una sola posición abierta por moneda y simulación; las cerradas no cuentan', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const ejecutar = (/** @type {any[]} */ [sql, valores]) => db.prepare(sql).bind(...valores).run()
    await ejecutar(posicion(id, 'BTC', 'cerrada'))
    await ejecutar(posicion(id, 'BTC', 'cerrada'))
    await ejecutar(posicion(id, 'BTC'))
    await assert.rejects(ejecutar(posicion(id, 'BTC')), /UNIQUE/)
    await ejecutar(posicion(id, 'ETH'))
  })

  test('una posición se abre y se cierra una sola vez', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const [sql, valores] = posicion(id, 'BTC')
    const { meta } = await db.prepare(sql).bind(...valores).run()
    const operacion = (/** @type {string} */ lado) => db.prepare(
      `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades, importe, comision,
         deslizamiento, motivo, saldo_tras, estrategia_version, creada_en)
       VALUES (?, ?, 'BTC', ?, 0, 100, 1, 100, 0.1, 0.05, 'senal', 9900, 'v1', 0)`,
    ).bind(id, meta.last_row_id, lado).run()
    await operacion('compra')
    await operacion('venta')
    await assert.rejects(operacion('venta'), /UNIQUE/)
  })

  test('las claves foráneas se respetan: no hay operaciones de posiciones inexistentes', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    await assert.rejects(db.prepare(
      `INSERT INTO operaciones (simulacion_id, posicion_id, simbolo, lado, vela_1h, precio, unidades, importe, comision,
         deslizamiento, motivo, saldo_tras, estrategia_version, creada_en)
       VALUES (?, 999, 'BTC', 'compra', 0, 100, 1, 100, 0.1, 0.05, 'senal', 9900, 'v1', 0)`,
    ).bind(id).run(), /FOREIGN KEY/)
  })

  test('capital: INSERT OR IGNORE conserva el primer punto de cada vela', async () => {
    const db = crearD1()
    const id = await simulacion(db)
    const punto = (/** @type {number} */ valor) => db.prepare(
      'INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl) VALUES (?, 0, ?, ?, NULL)',
    ).bind(id, valor, valor).run()
    await punto(1)
    await punto(2)
    assert.equal(await db.prepare('SELECT valor_cartera FROM capital').first('valor_cartera'), 1)
  })

  test('cuenta cada llamada a D1 (first/all/run/batch), no cada sentencia del lote', async () => {
    const db = crearD1()
    await simulacion(db)
    await db.prepare('SELECT 1').first()
    await db.batch([db.prepare('SELECT 1'), db.prepare('SELECT 2')])
    assert.equal(db.llamadas, 3)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/d1.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/test/d1.js`.

- [ ] **Step 4: Write the migration**

Create `worker/migrations/0001_inicial.sql` (el esquema de la spec §10 más cuatro índices para el estado y la API; `titulares.motor` admite `cf`):

```sql
-- ORACLE · esquema inicial (spec §10). Importes en €, instantes en ms desde epoch (UTC).

CREATE TABLE simulaciones (
  id INTEGER PRIMARY KEY,
  creada_en INTEGER NOT NULL,
  cerrada_en INTEGER,
  activa INTEGER NOT NULL DEFAULT 1,
  estrategia_version TEXT NOT NULL,
  capital_inicial REAL NOT NULL,
  saldo REAL NOT NULL CHECK (saldo >= 0),
  hodl_json TEXT                          -- unidades por moneda de comprar y mantener
);
CREATE UNIQUE INDEX una_activa ON simulaciones(activa) WHERE activa = 1;

CREATE TABLE posiciones (
  id INTEGER PRIMARY KEY,
  simulacion_id INTEGER NOT NULL REFERENCES simulaciones(id),
  simbolo TEXT NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('abierta','cerrada')),
  vela_entrada INTEGER NOT NULL,
  precio_entrada REAL NOT NULL,
  unidades REAL NOT NULL CHECK (unidades > 0),
  coste REAL NOT NULL,                    -- € que salieron del saldo al abrir, comisión incluida
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  vela_salida INTEGER,
  precio_salida REAL,
  motivo_salida TEXT,                     -- senal | stop_loss | take_profit
  pnl_neto REAL
);
CREATE UNIQUE INDEX una_abierta ON posiciones(simulacion_id, simbolo) WHERE estado = 'abierta';
CREATE INDEX posiciones_salida ON posiciones(simulacion_id, motivo_salida, simbolo);

CREATE TABLE operaciones (
  id INTEGER PRIMARY KEY,
  simulacion_id INTEGER NOT NULL,
  posicion_id INTEGER NOT NULL REFERENCES posiciones(id),
  simbolo TEXT NOT NULL,
  lado TEXT NOT NULL CHECK (lado IN ('compra','venta')),
  vela_1h INTEGER NOT NULL,
  precio REAL NOT NULL,
  unidades REAL NOT NULL,
  importe REAL NOT NULL,
  comision REAL NOT NULL,
  deslizamiento REAL NOT NULL,
  motivo TEXT NOT NULL,                   -- senal | stop_loss | take_profit
  saldo_tras REAL NOT NULL,
  pnl_neto REAL,                          -- solo en ventas: importe − comisión − coste de la posición
  estrategia_version TEXT NOT NULL,
  creada_en INTEGER NOT NULL,
  UNIQUE (posicion_id, lado)
);
CREATE INDEX operaciones_simulacion ON operaciones(simulacion_id, simbolo);

CREATE TABLE decisiones (
  id INTEGER PRIMARY KEY,
  simulacion_id INTEGER NOT NULL,
  simbolo TEXT NOT NULL,
  vela_1h INTEGER NOT NULL,
  veredicto TEXT NOT NULL,                -- COMPRAR | MANTENER | VENDER | SIN_DATOS
  indice_confianza REAL,
  puntuacion REAL,
  accion TEXT NOT NULL,                   -- abrir | cerrar | ninguna
  motivo TEXT NOT NULL,                   -- vocabulario de §7.2 o motivo libre de la señal
  precio REAL,
  desglose_json TEXT NOT NULL,
  estrategia_version TEXT NOT NULL,
  creada_en INTEGER NOT NULL,
  UNIQUE (simulacion_id, simbolo, vela_1h)
);
CREATE INDEX decisiones_simulacion ON decisiones(simulacion_id);

CREATE TABLE progreso (
  simulacion_id INTEGER NOT NULL,
  simbolo TEXT NOT NULL,
  ultima_vela_revisada INTEGER NOT NULL,
  PRIMARY KEY (simulacion_id, simbolo)
);

CREATE TABLE capital (
  simulacion_id INTEGER NOT NULL,
  vela_1h INTEGER NOT NULL,
  valor_cartera REAL NOT NULL,
  saldo REAL NOT NULL,
  valor_hodl REAL,
  PRIMARY KEY (simulacion_id, vela_1h)
);

CREATE TABLE senales_actuales (
  simbolo TEXT PRIMARY KEY,
  calculada_en INTEGER NOT NULL,
  vela_1h INTEGER NOT NULL,
  senal_json TEXT NOT NULL                -- señal + precioEur, cambio24h, explicación, motor, SL/TP orientativos
);

CREATE TABLE titulares (
  id TEXT PRIMARY KEY,                    -- hash del título normalizado
  fuente TEXT NOT NULL,
  origen TEXT NOT NULL,                   -- rss | reddit
  titulo TEXT NOT NULL,
  url TEXT,
  publicado_en INTEGER NOT NULL,
  monedas_json TEXT,
  puntuacion REAL,
  motor TEXT                              -- cf | groq | gemini | lexico
);
CREATE INDEX titulares_fecha ON titulares(publicado_en);

CREATE TABLE ejecuciones (
  id INTEGER PRIMARY KEY,
  tipo TEXT NOT NULL,                     -- noticias | mercado | manual
  inicio INTEGER NOT NULL,
  fin INTEGER,
  ok INTEGER,
  detalle_json TEXT
);
CREATE INDEX ejecuciones_tipo ON ejecuciones(tipo, inicio);

CREATE TABLE intentos_pin (
  ip TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL,
  bloqueado_hasta INTEGER
);
```

- [ ] **Step 5: Write the D1 adapter**

Create `worker/test/d1.js`:

```js
// @ts-check
// D1 simulado sobre node:sqlite, solo para tests: misma API que usa el Worker
// (prepare/bind/first/all/run y batch atómico) y las mismas migraciones.
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const MIGRACIONES = new URL('../migrations/', import.meta.url)
const DEVUELVE_FILAS = /^\s*(select|with|pragma)\b|\breturning\b/i

/** @typedef {null|number|string} Valor */
/** @typedef {{ results: Record<string, any>[], success: true, meta: { changes: number, last_row_id: number } }} Resultado */

export class Sentencia {
  /** @param {DatabaseSync} db @param {string} sql @param {Valor[]} valores */
  constructor(db, sql, valores = []) {
    this.db = db
    this.sql = sql
    this.valores = valores
  }

  /** @param {...Valor} valores */
  bind(...valores) {
    return new Sentencia(this.db, this.sql, valores)
  }

  /** Ejecuta de forma síncrona (lo usa batch dentro de su transacción). @returns {Resultado} */
  ejecutar() {
    const sentencia = this.db.prepare(this.sql)
    if (DEVUELVE_FILAS.test(this.sql)) {
      const filas = sentencia.all(...this.valores).map((f) => ({ ...f }))
      return { results: filas, success: true, meta: { changes: 0, last_row_id: 0 } }
    }
    const r = sentencia.run(...this.valores)
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }

  /** @param {string} [columna] */
  async first(columna) {
    const fila = this.ejecutar().results[0] ?? null
    if (fila === null || columna === undefined) return fila
    return fila[columna] ?? null
  }

  async all() {
    return this.ejecutar()
  }

  async run() {
    return this.ejecutar()
  }
}

/**
 * Base de datos en memoria con todas las migraciones de worker/migrations aplicadas en orden.
 * `llamadas` cuenta las llamadas a D1 (first/all/run/batch), como las cuenta Cloudflare.
 */
export function crearD1() {
  const sqlite = new DatabaseSync(':memory:')
  for (const archivo of readdirSync(MIGRACIONES).filter((a) => a.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(archivo, MIGRACIONES), 'utf8'))
  }
  const d1 = {
    sqlite,
    llamadas: 0,
    /** @param {string} sql */
    prepare(sql) {
      const base = new Sentencia(sqlite, sql)
      return contar(base, d1)
    },
    /** Todas o ninguna: cualquier error revierte el lote completo. @param {Sentencia[]} sentencias */
    async batch(sentencias) {
      d1.llamadas++
      sqlite.exec('BEGIN')
      try {
        const resultados = sentencias.map((s) => s.ejecutar())
        sqlite.exec('COMMIT')
        return resultados
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
    /** @param {string} sql */
    async exec(sql) {
      d1.llamadas++
      sqlite.exec(sql)
      return { count: 0, duration: 0 }
    },
  }
  return d1
}

/**
 * Envuelve una sentencia para que first/all/run sumen una llamada (bind conserva el contador).
 * @param {Sentencia} sentencia
 * @param {{ llamadas: number }} d1
 * @returns {Sentencia}
 */
function contar(sentencia, d1) {
  const envuelta = Object.create(sentencia)
  envuelta.bind = (/** @type {Valor[]} */ ...valores) => contar(sentencia.bind(...valores), d1)
  for (const metodo of /** @type {const} */ (['first', 'all', 'run'])) {
    envuelta[metodo] = (/** @type {any[]} */ ...args) => {
      d1.llamadas++
      return /** @type {any} */ (sentencia)[metodo](...args)
    }
  }
  return envuelta
}

/** @typedef {ReturnType<typeof crearD1>} D1Simulado */
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/d1.test.js`
Expected: PASS — 11 tests, 0 fail.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: 0 fail (147 tests).

- [ ] **Step 8: Commit**

```bash
git add package.json worker/migrations/0001_inicial.sql worker/test/d1.js worker/test/d1.test.js
git commit -m "feat(worker): esquema D1 y D1 simulado con node:sqlite para los tests" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 3: Fuentes de mercado (Binance, derivados, Fear & Greed)

**Files:**
- Create: `test/fixtures/binance-klines-BTCEUR-1h.json`, `test/fixtures/binance-premiumIndex.json`, `test/fixtures/binance-globalLongShortAccountRatio-BTCUSDT.json`, `test/fixtures/binance-openInterestHist-BTCUSDT.json`, `test/fixtures/alternative-fng.json`
- Create: `worker/test/ayudantes.js`
- Create: `worker/src/fuentes/binance.js`, `worker/src/fuentes/derivados.js`, `worker/src/fuentes/fng.js`
- Test: `worker/test/fuentes-mercado.test.js`

**Interfaces:**
- Consumes: `core/velas.js` — `desdeBinance(filas)`, `cerradasHasta(velas, t)`, `HORA`, tipo `Vela`; `test/ayudantes.js` — `serie(n, cierre, op)`.
- Produces:
  - `worker/test/ayudantes.js` (solo tests): `fixtureTexto(nombre): string`, `fixtureJson(nombre): any` (leen `test/fixtures/`), `simularFetch(responder: (url, init) => { estado?, cuerpo?, error? }): typeof fetch & { llamadas: { url, init }[] }`, `aFilasBinance(velas: Vela[]): unknown[][]`.
  - `fuentes/binance.js`: `BINANCE`, `LIMITE_VELAS = 500`, `validarKlines(json: unknown): unknown[][]` (lanza `TypeError`), `descargarVelas(fetch, par, intervalo, limite?): Promise<Vela[]>` (lanza `Error('HTTP n')`), `descargarMoneda(fetch, simbolo): Promise<{ simbolo, velas: { '1h', '4h', '1d' }, velasEur, fallos: string[] }>` (4 subpeticiones, nunca lanza), `cambio24h(velas1h, ahora): number|null`, `ultimoCierre(velas, ahora): number|null`.
  - `fuentes/derivados.js`: `FAPI`, `leerFunding(json, simbolos): Record<string, number|null>`, `leerLongShort(json): number`, `leerOpenInterest(json): number`, `descargarDerivados(fetch, simbolos): Promise<{ base: Record<string, { funding, ratioLongShort, oiCambio24h }>, fallos: string[] }>` (1 + 2·n subpeticiones, nunca lanza), `completarDerivados(base|undefined, precioCambio24h: number|null): Derivados|null`.
  - `fuentes/fng.js`: `FNG`, tipo `Fng = { valor, clasificacion, t }`, `leerFng(json): Fng`, `descargarFng(fetch): Promise<Fng>`.

- [ ] **Step 1: Create the recorded fixtures**

Respuestas reales grabadas el 2026-10-18 con `curl` (`klines` con `limit=3`, con la 3.ª vela aún abierta; `premiumIndex` reducido a 6 símbolos; el resto, completas). Créalas con este contenido exacto:

`test/fixtures/binance-klines-BTCEUR-1h.json`:

```json
[[1792350000000,"72227.92000000","72256.20000000","71897.67000000","71989.84000000","1.98418000",1792353599999,"142949.47301900",737,"1.05609000","76077.38242750","0"],[1792353600000,"72009.03000000","72143.57000000","71850.00000000","72096.96000000","3.39525000",1792357199999,"244514.56586300",903,"1.52811000","110066.96427900","0"],[1792357200000,"72093.06000000","72145.19000000","72090.26000000","72145.19000000","0.04849000",1792360799999,"3497.26580050",20,"0.03723000","2685.31013120","0"]]
```

`test/fixtures/binance-premiumIndex.json`:

```json
[{"symbol":"BTCUSDT","markPrice":"80989.00000000","indexPrice":"81005.17130435","estimatedSettlePrice":"80898.80389348","lastFundingRate":"0.00000685","interestRate":"0.00010000","nextFundingTime":1792368000000,"time":1792357310000},{"symbol":"ETHUSDT","markPrice":"2355.05000000","indexPrice":"2355.48000000","estimatedSettlePrice":"2347.58534354","lastFundingRate":"0.00001120","interestRate":"0.00010000","nextFundingTime":1792368000000,"time":1792357310000},{"symbol":"SOLUSDT","markPrice":"101.42048355","indexPrice":"101.46732025","estimatedSettlePrice":"101.05677439","lastFundingRate":"-0.00008687","interestRate":"0.00010000","nextFundingTime":1792368000000,"time":1792357310000},{"symbol":"BNBUSDT","markPrice":"709.51211588","indexPrice":"709.25770534","estimatedSettlePrice":"707.75892794","lastFundingRate":"0.00000000","interestRate":"0.00000000","nextFundingTime":1792368000000,"time":1792357310000},{"symbol":"XRPUSDT","markPrice":"1.26770000","indexPrice":"1.26814090","estimatedSettlePrice":"1.26143518","lastFundingRate":"-0.00011915","interestRate":"0.00010000","nextFundingTime":1792368000000,"time":1792357310000},{"symbol":"IOSTUSDT","markPrice":"0.00071559","indexPrice":"0.00071593","estimatedSettlePrice":"0.00071206","lastFundingRate":"-0.00005006","interestRate":"0.00010000","nextFundingTime":1792368000000,"time":1792357310000}]
```

`test/fixtures/binance-globalLongShortAccountRatio-BTCUSDT.json`:

```json
[{"symbol":"BTCUSDT","longAccount":"0.6464","longShortRatio":"1.8281","shortAccount":"0.3536","timestamp":1792353600000}]
```

`test/fixtures/binance-openInterestHist-BTCUSDT.json`:

```json
[{"symbol":"BTCUSDT","sumOpenInterest":"93889.93800000","sumOpenInterestValue":"7662611343.01260000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792270800000},{"symbol":"BTCUSDT","sumOpenInterest":"93993.47900000","sumOpenInterestValue":"7622833549.50840000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792274400000},{"symbol":"BTCUSDT","sumOpenInterest":"94348.00600000","sumOpenInterestValue":"7673040283.96200000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792278000000},{"symbol":"BTCUSDT","sumOpenInterest":"94267.08000000","sumOpenInterestValue":"7678604713.77953500","CMCCirculatingSupply":"20098843.00000000","timestamp":1792281600000},{"symbol":"BTCUSDT","sumOpenInterest":"93959.37200000","sumOpenInterestValue":"7658976061.39640000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792285200000},{"symbol":"BTCUSDT","sumOpenInterest":"94104.45500000","sumOpenInterestValue":"7681266728.92950000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792288800000},{"symbol":"BTCUSDT","sumOpenInterest":"93547.58300000","sumOpenInterestValue":"7651247458.81170000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792292400000},{"symbol":"BTCUSDT","sumOpenInterest":"93192.72000000","sumOpenInterestValue":"7634273068.22400000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792296000000},{"symbol":"BTCUSDT","sumOpenInterest":"93147.79400000","sumOpenInterestValue":"7616508819.79200000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792299600000},{"symbol":"BTCUSDT","sumOpenInterest":"93023.06700000","sumOpenInterestValue":"7600391783.72369700","CMCCirculatingSupply":"20098843.00000000","timestamp":1792303200000},{"symbol":"BTCUSDT","sumOpenInterest":"93012.44400000","sumOpenInterestValue":"7598028520.19555400","CMCCirculatingSupply":"20098843.00000000","timestamp":1792306800000},{"symbol":"BTCUSDT","sumOpenInterest":"93598.43200000","sumOpenInterestValue":"7641853340.48320000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792310400000},{"symbol":"BTCUSDT","sumOpenInterest":"93673.68300000","sumOpenInterestValue":"7655810189.51046300","CMCCirculatingSupply":"20098843.00000000","timestamp":1792314000000},{"symbol":"BTCUSDT","sumOpenInterest":"94447.48000000","sumOpenInterestValue":"7756272621.04800000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792317600000},{"symbol":"BTCUSDT","sumOpenInterest":"94634.35000000","sumOpenInterestValue":"7765784822.53871500","CMCCirculatingSupply":"20098843.00000000","timestamp":1792321200000},{"symbol":"BTCUSDT","sumOpenInterest":"94808.54000000","sumOpenInterestValue":"7777959889.64400000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792324800000},{"symbol":"BTCUSDT","sumOpenInterest":"94702.82100000","sumOpenInterestValue":"7761129569.19018800","CMCCirculatingSupply":"20098843.00000000","timestamp":1792328400000},{"symbol":"BTCUSDT","sumOpenInterest":"92916.27500000","sumOpenInterestValue":"7572842286.22994400","CMCCirculatingSupply":"20098843.00000000","timestamp":1792332000000},{"symbol":"BTCUSDT","sumOpenInterest":"93745.74100000","sumOpenInterestValue":"7599798480.53620000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792335600000},{"symbol":"BTCUSDT","sumOpenInterest":"93736.50500000","sumOpenInterestValue":"7605689726.38871700","CMCCirculatingSupply":"20098843.00000000","timestamp":1792339200000},{"symbol":"BTCUSDT","sumOpenInterest":"93628.04500000","sumOpenInterestValue":"7587616766.80000000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792342800000},{"symbol":"BTCUSDT","sumOpenInterest":"93595.52400000","sumOpenInterestValue":"7595267413.04760000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792346400000},{"symbol":"BTCUSDT","sumOpenInterest":"93564.11100000","sumOpenInterestValue":"7593871815.36698600","CMCCirculatingSupply":"20098843.00000000","timestamp":1792350000000},{"symbol":"BTCUSDT","sumOpenInterest":"93708.18100000","sumOpenInterestValue":"7575992702.25505900","CMCCirculatingSupply":"20098843.00000000","timestamp":1792353600000},{"symbol":"BTCUSDT","sumOpenInterest":"93600.79700000","sumOpenInterestValue":"7575309062.88370000","CMCCirculatingSupply":"20098843.00000000","timestamp":1792357200000}]
```

`test/fixtures/alternative-fng.json`:

```json
{
	"name": "Fear and Greed Index",
	"data": [
		{
			"value": "53",
			"value_classification": "Neutral",
			"timestamp": "1792281600",
			"time_until_update": "10677"
		}
	],
	"metadata": {
		"error": null
	}
}
```

- [ ] **Step 2: Create the test helpers**

Create `worker/test/ayudantes.js`:

```js
// @ts-check
// Ayudantes de los tests del Worker: fetch simulado y fixtures grabados. Solo para tests.
import { readFileSync } from 'node:fs'

const FIXTURES = new URL('../../test/fixtures/', import.meta.url)

/** Contenido de test/fixtures/<nombre> como texto. @param {string} nombre */
export const fixtureTexto = (nombre) => readFileSync(new URL(nombre, FIXTURES), 'utf8')

/** Contenido de test/fixtures/<nombre> como JSON. @param {string} nombre */
export const fixtureJson = (nombre) => JSON.parse(fixtureTexto(nombre))

/**
 * @typedef {{ estado?: number, cuerpo?: unknown, error?: Error }} RespuestaSimulada
 * cuerpo: string se envía tal cual; cualquier otra cosa, como JSON. error: el fetch lanza (red caída).
 */

/**
 * fetch simulado: `responder(url, init)` decide la respuesta; `llamadas` guarda cada petición.
 * @param {(url: string, init: RequestInit|undefined) => RespuestaSimulada} responder
 */
export function simularFetch(responder) {
  /** @type {{ url: string, init: RequestInit|undefined }[]} */
  const llamadas = []
  /** @param {string|URL|Request} entrada @param {RequestInit} [init] */
  const fetch = async (entrada, init) => {
    const url = String(entrada instanceof Request ? entrada.url : entrada)
    llamadas.push({ url, init })
    const r = responder(url, init)
    if (r.error) throw r.error
    const cuerpo = typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo ?? null)
    return new Response(cuerpo, { status: r.estado ?? 200 })
  }
  return Object.assign(fetch, { llamadas })
}

/**
 * Velas → filas de /api/v3/klines (mismo formato que devuelve Binance).
 * @param {import('../../core/velas.js').Vela[]} velas
 */
export function aFilasBinance(velas) {
  return velas.map((v) => [
    v.inicio, String(v.apertura), String(v.maximo), String(v.minimo), String(v.cierre), String(v.volumen),
    v.fin - 1, '0', 0, '0', '0', '0',
  ])
}
```

- [ ] **Step 3: Write the failing test**

Create `worker/test/fuentes-mercado.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA, desdeBinance } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { BINANCE, cambio24h, descargarMoneda, descargarVelas, ultimoCierre, validarKlines } from '../src/fuentes/binance.js'
import {
  FAPI, completarDerivados, descargarDerivados, leerFunding, leerLongShort, leerOpenInterest,
} from '../src/fuentes/derivados.js'
import { FNG, descargarFng, leerFng } from '../src/fuentes/fng.js'
import { fixtureJson, simularFetch } from './ayudantes.js'

const KLINES = fixtureJson('binance-klines-BTCEUR-1h.json')

describe('binance', () => {
  test('valida y convierte el fixture real de klines', async () => {
    const fetch = simularFetch(() => ({ cuerpo: KLINES }))
    const velas = await descargarVelas(fetch, 'BTCEUR', '1h')
    assert.equal(fetch.llamadas[0].url, `${BINANCE}?symbol=BTCEUR&interval=1h&limit=500`)
    assert.equal(velas.length, 3)
    assert.deepEqual(velas[0], {
      inicio: 1792350000000, fin: 1792353600000, apertura: 72227.92, maximo: 72256.2, minimo: 71897.67,
      cierre: 71989.84, volumen: 1.98418,
    })
  })

  test('rechaza respuestas mal formadas antes de convertirlas', () => {
    const buena = KLINES[0]
    assert.throws(() => validarKlines({ code: -1121 }), /no es una lista/)
    assert.throws(() => validarKlines([buena.slice(0, 6)]), /mal formada/)
    assert.throws(() => validarKlines([[buena[0], 'NaN', ...buena.slice(2)]]), /precio no válido/)
    assert.throws(() => validarKlines([[buena[0], '0', ...buena.slice(2)]]), /precio no válido/)
    assert.throws(() => validarKlines([[buena[0], buena[1], '1', ...buena.slice(3)]]), /OHLC incoherente/)
    assert.throws(() => validarKlines([[buena[0], ...buena.slice(1, 6), buena[0] - 1, ...buena.slice(7)]]), /tiempos/)
    assert.throws(() => validarKlines([KLINES[1], KLINES[0]]), /desordenadas/)
    assert.throws(() => validarKlines([KLINES[0], KLINES[0]]), /desordenadas/)
    assert.deepEqual(validarKlines([]), [])
  })

  test('HTTP de error → excepción con el código', async () => {
    const fetch = simularFetch(() => ({ estado: 451, cuerpo: '' }))
    await assert.rejects(descargarVelas(fetch, 'BTCUSDT', '4h'), /HTTP 451/)
  })

  test('descargarMoneda pide 4 series; la que falla queda vacía y se anota', async () => {
    const fetch = simularFetch((url) => (url.includes('interval=4h') ? { estado: 500, cuerpo: '' } : { cuerpo: KLINES }))
    const m = await descargarMoneda(fetch, 'BTC')
    assert.deepEqual(fetch.llamadas.map((l) => l.url), [
      `${BINANCE}?symbol=BTCUSDT&interval=1h&limit=500`,
      `${BINANCE}?symbol=BTCUSDT&interval=4h&limit=500`,
      `${BINANCE}?symbol=BTCUSDT&interval=1d&limit=500`,
      `${BINANCE}?symbol=BTCEUR&interval=1h&limit=500`,
    ])
    assert.equal(m.velas['1h'].length, 3)
    assert.deepEqual(m.velas['4h'], [])
    assert.equal(m.velasEur.length, 3)
    assert.deepEqual(m.fallos, ['velas BTCUSDT 4h: HTTP 500'])
  })

  test('ultimoCierre ignora la vela en curso del fixture', () => {
    const velas = desdeBinance(validarKlines(KLINES))
    const ahora = 1792357200000 + 3 * 60_000 // la 3.ª vela del fixture sigue abierta
    assert.equal(ultimoCierre(velas, ahora), 72096.96)
    assert.equal(ultimoCierre([], ahora), null)
  })

  test('cambio24h compara con el cierre de 24 velas antes; null si faltan', () => {
    const velas = serie(30, (i) => 100 + i, { inicio: 0 })
    const ahora = 30 * HORA
    assert.equal(cambio24h(velas, ahora), 129 / 105 - 1)
    assert.equal(cambio24h(velas.slice(0, 24), ahora), null)
    const conHueco = [...velas.slice(0, 5), ...velas.slice(6)]
    assert.equal(cambio24h(conHueco, ahora), null)
  })
})

describe('derivados', () => {
  test('funding de las monedas pedidas desde el fixture real de premiumIndex', () => {
    const f = leerFunding(fixtureJson('binance-premiumIndex.json'), ['BTC', 'XRP', 'DOGE'])
    assert.deepEqual(f, { BTC: 0.00000685, XRP: -0.00011915, DOGE: null })
    assert.throws(() => leerFunding({}, ['BTC']), /no es una lista/)
  })

  test('long/short del fixture real', () => {
    assert.equal(leerLongShort(fixtureJson('binance-globalLongShortAccountRatio-BTCUSDT.json')), 1.8281)
    assert.throws(() => leerLongShort([]), /no válida/)
    assert.throws(() => leerLongShort([{ longShortRatio: 'x' }]), /ratio/)
  })

  test('open interest 24 h del fixture real (25 puntos horarios)', () => {
    const oi = leerOpenInterest(fixtureJson('binance-openInterestHist-BTCUSDT.json'))
    assert.ok(Math.abs(oi - (93600.797 / 93889.938 - 1)) < 1e-12)
    const puntos = fixtureJson('binance-openInterestHist-BTCUSDT.json')
    assert.throws(() => leerOpenInterest(puntos.slice(1)), /faltan puntos/)
    assert.throws(() => leerOpenInterest([...puntos.slice(0, 24), { ...puntos[24], timestamp: 0 }]), /24 h/)
  })

  test('descargarDerivados: 1 + 2·n peticiones y cada dato por su lado', async () => {
    const fetch = simularFetch((url) => {
      if (url.endsWith('/fapi/v1/premiumIndex')) return { cuerpo: fixtureJson('binance-premiumIndex.json') }
      if (url.includes('globalLongShortAccountRatio')) return { cuerpo: fixtureJson('binance-globalLongShortAccountRatio-BTCUSDT.json') }
      if (url.includes('symbol=ETHUSDT')) return { estado: 451, cuerpo: '' }
      return { cuerpo: fixtureJson('binance-openInterestHist-BTCUSDT.json') }
    })
    const { base, fallos } = await descargarDerivados(fetch, ['BTC', 'ETH'])
    assert.equal(fetch.llamadas.length, 5)
    assert.equal(fetch.llamadas[1].url, `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=1h&limit=1`)
    assert.equal(fetch.llamadas[2].url, `${FAPI}/futures/data/openInterestHist?symbol=BTCUSDT&period=1h&limit=25`)
    assert.equal(base.BTC.funding, 0.00000685)
    assert.equal(base.BTC.ratioLongShort, 1.8281)
    assert.ok(base.BTC.oiCambio24h !== null)
    assert.equal(base.ETH.funding, 0.0000112)
    assert.equal(base.ETH.oiCambio24h, null)
    assert.deepEqual(fallos, ['derivados open interest ETH: HTTP 451'])
  })

  test('todo fapi bloqueado → derivados ausentes (null) y fallos anotados', async () => {
    const fetch = simularFetch(() => ({ estado: 451, cuerpo: '' }))
    const { base, fallos } = await descargarDerivados(fetch, ['BTC'])
    assert.equal(fallos.length, 3)
    assert.equal(completarDerivados(base.BTC, 0.01), null)
  })

  test('completarDerivados añade el cambio de precio 24 h', () => {
    assert.deepEqual(
      completarDerivados({ funding: 0.0001, ratioLongShort: null, oiCambio24h: null }, -0.02),
      { funding: 0.0001, ratioLongShort: null, oiCambio24h: null, precioCambio24h: -0.02 },
    )
    assert.equal(completarDerivados(undefined, 0), null)
  })
})

describe('fear & greed', () => {
  test('lee el fixture real de alternative.me', async () => {
    const fetch = simularFetch(() => ({ cuerpo: fixtureJson('alternative-fng.json') }))
    assert.deepEqual(await descargarFng(fetch), { valor: 53, clasificacion: 'Neutral', t: 1792281600000 })
    assert.equal(fetch.llamadas[0].url, FNG)
  })

  test('rechaza valores fuera de 0-100 o sin fecha', () => {
    assert.throws(() => leerFng({ data: [{ value: '101', timestamp: '1' }] }), /valor/)
    assert.throws(() => leerFng({ data: [{ value: '50' }] }), /fecha/)
    assert.throws(() => leerFng({}), /valor/)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/fuentes-mercado.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/fuentes/binance.js`.

- [ ] **Step 5: Write `binance.js`**

Create `worker/src/fuentes/binance.js` (valida cada fila antes de `desdeBinance`, como pedía la revisión del plan 1):

```js
// @ts-check
// Velas de Binance desde el mirror público data-api.binance.vision. Cada fila se valida antes de convertirla.
import { cerradasHasta, desdeBinance } from '../../../core/velas.js'

/** @typedef {import('../../../core/velas.js').Vela} Vela */

export const BINANCE = 'https://data-api.binance.vision/api/v3/klines'
export const LIMITE_VELAS = 500

/**
 * Comprueba que la respuesta de /klines es una lista de filas coherentes y ordenadas.
 * @param {unknown} json
 * @returns {unknown[][]}
 */
export function validarKlines(json) {
  if (!Array.isArray(json)) throw new TypeError('klines: la respuesta no es una lista')
  let previa = -Infinity
  for (const fila of json) {
    if (!Array.isArray(fila) || fila.length < 7) throw new TypeError('klines: fila mal formada')
    const [inicio, apertura, maximo, minimo, cierre, volumen, cierreMs] = fila.slice(0, 7).map(Number)
    if (!Number.isInteger(inicio) || !Number.isInteger(cierreMs) || cierreMs <= inicio) {
      throw new TypeError('klines: tiempos no válidos')
    }
    if (![apertura, maximo, minimo, cierre].every((x) => Number.isFinite(x) && x > 0)) {
      throw new TypeError('klines: precio no válido')
    }
    if (!Number.isFinite(volumen) || volumen < 0) throw new TypeError('klines: volumen no válido')
    if (maximo < Math.max(apertura, cierre, minimo) || minimo > Math.min(apertura, cierre)) {
      throw new TypeError('klines: OHLC incoherente')
    }
    if (inicio <= previa) throw new TypeError('klines: velas desordenadas o repetidas')
    previa = inicio
  }
  return /** @type {unknown[][]} */ (json)
}

/**
 * @param {typeof fetch} fetch
 * @param {string} par p. ej. BTCUSDT o BTCEUR
 * @param {'1h'|'4h'|'1d'} intervalo
 * @param {number} [limite]
 * @returns {Promise<Vela[]>}
 */
export async function descargarVelas(fetch, par, intervalo, limite = LIMITE_VELAS) {
  const res = await fetch(`${BINANCE}?symbol=${par}&interval=${intervalo}&limit=${limite}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return desdeBinance(validarKlines(await res.json()))
}

/**
 * Las 4 series de una moneda (4 subpeticiones). Una serie que falla queda vacía y se anota.
 * @param {typeof fetch} fetch
 * @param {string} simbolo
 */
export async function descargarMoneda(fetch, simbolo) {
  /** @type {[string, '1h'|'4h'|'1d'][]} */
  const pedidos = [[`${simbolo}USDT`, '1h'], [`${simbolo}USDT`, '4h'], [`${simbolo}USDT`, '1d'], [`${simbolo}EUR`, '1h']]
  const resultados = await Promise.allSettled(pedidos.map(([par, intervalo]) => descargarVelas(fetch, par, intervalo)))
  /** @type {string[]} */
  const fallos = []
  /** @param {number} i @returns {Vela[]} */
  const serie = (i) => {
    const r = resultados[i]
    if (r.status === 'fulfilled') return r.value
    fallos.push(`velas ${pedidos[i][0]} ${pedidos[i][1]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
    return []
  }
  return { simbolo, velas: { '1h': serie(0), '4h': serie(1), '1d': serie(2) }, velasEur: serie(3), fallos }
}

/**
 * Variación del cierre en 24 h con velas 1H ya cerradas en `ahora` (0,02 = +2 %). null si faltan velas.
 * @param {Vela[]} velas1h
 * @param {number} ahora
 */
export function cambio24h(velas1h, ahora) {
  const cerradas = cerradasHasta(velas1h, ahora)
  if (cerradas.length < 25) return null
  const ultima = cerradas[cerradas.length - 1]
  const hace24h = cerradas[cerradas.length - 25]
  if (ultima.inicio - hace24h.inicio !== 24 * 3_600_000) return null
  return ultima.cierre / hace24h.cierre - 1
}

/**
 * Cierre de la última vela cerrada en `ahora`, o null.
 * @param {Vela[]} velas
 * @param {number} ahora
 */
export function ultimoCierre(velas, ahora) {
  const cerradas = cerradasHasta(velas, ahora)
  return cerradas.length > 0 ? cerradas[cerradas.length - 1].cierre : null
}
```

- [ ] **Step 6: Write `derivados.js`**

Create `worker/src/fuentes/derivados.js`:

```js
// @ts-check
// Derivados de Binance Futures (opcionales: fapi responde 451 desde algunas regiones).
// 1 + 2·n subpeticiones: premiumIndex para todas las monedas y long/short + open interest por moneda.

/** @typedef {import('../../../core/estrategia-v1.js').Derivados} Derivados */
/** @typedef {{ funding: number|null, ratioLongShort: number|null, oiCambio24h: number|null }} DerivadosBase */

export const FAPI = 'https://fapi.binance.com'

/** @param {unknown} x */
const numero = (x) => {
  const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : typeof x === 'number' ? x : NaN
  return Number.isFinite(n) ? n : null
}

/**
 * Funding por 8 h (fracción) de cada moneda a partir de /fapi/v1/premiumIndex (todas las monedas).
 * @param {unknown} json
 * @param {string[]} simbolos
 * @returns {Record<string, number|null>}
 */
export function leerFunding(json, simbolos) {
  if (!Array.isArray(json)) throw new TypeError('premiumIndex: la respuesta no es una lista')
  return Object.fromEntries(simbolos.map((s) => {
    const fila = json.find((f) => f && typeof f === 'object' && f.symbol === `${s}USDT`)
    return [s, fila ? numero(fila.lastFundingRate) : null]
  }))
}

/**
 * Último ratio de cuentas long/short (globalLongShortAccountRatio).
 * @param {unknown} json
 */
export function leerLongShort(json) {
  if (!Array.isArray(json) || json.length === 0) throw new TypeError('longShort: lista vacía o no válida')
  const ratio = numero(json[json.length - 1]?.longShortRatio)
  if (ratio === null || ratio <= 0) throw new TypeError('longShort: ratio no válido')
  return ratio
}

/**
 * Cambio del open interest (en contratos) en 24 h: último punto frente al de 24 puntos horarios antes.
 * @param {unknown} json respuesta de openInterestHist con period=1h y limit=25
 */
export function leerOpenInterest(json) {
  if (!Array.isArray(json) || json.length < 25) throw new TypeError('openInterest: faltan puntos')
  const ultimo = json[json.length - 1]
  const previo = json[json.length - 25]
  const actual = numero(ultimo?.sumOpenInterest)
  const antes = numero(previo?.sumOpenInterest)
  if (actual === null || antes === null || antes <= 0) throw new TypeError('openInterest: valor no válido')
  if (numero(ultimo.timestamp) !== /** @type {number} */ (numero(previo.timestamp)) + 24 * 3_600_000) {
    throw new TypeError('openInterest: los puntos no abarcan 24 h')
  }
  return actual / antes - 1
}

/**
 * @param {typeof fetch} fetch
 * @param {string} url
 */
async function pedirJson(fetch, url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * @param {typeof fetch} fetch
 * @param {string[]} simbolos
 * @returns {Promise<{ base: Record<string, DerivadosBase>, fallos: string[] }>}
 */
export async function descargarDerivados(fetch, simbolos) {
  /** @type {string[]} */
  const fallos = []
  const [funding, ...porMoneda] = await Promise.allSettled([
    pedirJson(fetch, `${FAPI}/fapi/v1/premiumIndex`).then((j) => leerFunding(j, simbolos)),
    ...simbolos.flatMap((s) => [
      pedirJson(fetch, `${FAPI}/futures/data/globalLongShortAccountRatio?symbol=${s}USDT&period=1h&limit=1`).then(leerLongShort),
      pedirJson(fetch, `${FAPI}/futures/data/openInterestHist?symbol=${s}USDT&period=1h&limit=25`).then(leerOpenInterest),
    ]),
  ])
  if (funding.status === 'rejected') fallos.push(`derivados funding: ${mensaje(funding.reason)}`)
  /** @type {Record<string, DerivadosBase>} */
  const base = {}
  simbolos.forEach((s, i) => {
    const ls = porMoneda[2 * i]
    const oi = porMoneda[2 * i + 1]
    if (ls.status === 'rejected') fallos.push(`derivados long/short ${s}: ${mensaje(ls.reason)}`)
    if (oi.status === 'rejected') fallos.push(`derivados open interest ${s}: ${mensaje(oi.reason)}`)
    base[s] = {
      funding: funding.status === 'fulfilled' ? funding.value[s] : null,
      ratioLongShort: ls.status === 'fulfilled' ? ls.value : null,
      oiCambio24h: oi.status === 'fulfilled' ? oi.value : null,
    }
  })
  return { base, fallos }
}

/**
 * Derivados para la estrategia: añade el cambio de precio 24 h (USDT). null si no hay ningún dato de derivados.
 * @param {DerivadosBase|undefined} base
 * @param {number|null} precioCambio24h
 * @returns {Derivados|null}
 */
export function completarDerivados(base, precioCambio24h) {
  if (!base || (base.funding === null && base.ratioLongShort === null && base.oiCambio24h === null)) return null
  return { ...base, precioCambio24h }
}
```

- [ ] **Step 7: Write `fng.js`**

Create `worker/src/fuentes/fng.js`:

```js
// @ts-check
// Índice Fear & Greed de alternative.me (1 subpetición). Opcional: si falla, el componente queda ausente.

export const FNG = 'https://api.alternative.me/fng/?limit=1'

/** @typedef {{ valor: number, clasificacion: string, t: number }} Fng */

/**
 * @param {unknown} json
 * @returns {Fng}
 */
export function leerFng(json) {
  const dato = /** @type {any} */ (json)?.data?.[0]
  const valor = Number(dato?.value)
  const t = Number(dato?.timestamp) * 1000
  if (!Number.isInteger(valor) || valor < 0 || valor > 100) throw new TypeError('fng: valor no válido')
  if (!Number.isFinite(t) || t <= 0) throw new TypeError('fng: fecha no válida')
  return { valor, clasificacion: typeof dato.value_classification === 'string' ? dato.value_classification : '', t }
}

/**
 * @param {typeof fetch} fetch
 * @returns {Promise<Fng>}
 */
export async function descargarFng(fetch) {
  const res = await fetch(FNG)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return leerFng(await res.json())
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/fuentes-mercado.test.js`
Expected: PASS — 14 tests, 0 fail.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: 0 fail (161 tests).

- [ ] **Step 10: Commit**

```bash
git add test/fixtures/binance-*.json test/fixtures/alternative-fng.json worker/test/ayudantes.js worker/src/fuentes/binance.js worker/src/fuentes/derivados.js worker/src/fuentes/fng.js worker/test/fuentes-mercado.test.js
git commit -m "feat(worker): fuentes de mercado validadas (Binance, derivados, Fear & Greed)" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 4: Fuentes de noticias (RSS y Reddit)

**Files:**
- Create: `test/fixtures/rss-cointelegraph.xml`, `test/fixtures/reddit-cryptocurrency.xml`
- Create: `worker/src/fuentes/rss.js`, `worker/src/fuentes/reddit.js`
- Test: `worker/test/fuentes-noticias.test.js`

**Interfaces:**
- Consumes: `worker/test/ayudantes.js` — `fixtureTexto`, `simularFetch` (Task 3).
- Produces:
  - `fuentes/rss.js`: tipo `TitularCrudo = { fuente: string, origen: 'rss'|'reddit', titulo: string, url: string|null, publicadoEn: number }`, `FEEDS` (14 `{ fuente, url }`, los de CryptoTrade), `CABECERAS_FEED`, `decodificarEntidades(texto)`, `limpiar(texto|null): string`, `leerFeed(xml, fuente, origen = 'rss'): TitularCrudo[]` (RSS 2.0 `<item>` o Atom `<entry>`), `descargarFeeds(fetch): Promise<{ titulares: TitularCrudo[], fallos: string[] }>` (14 subpeticiones, nunca lanza).
  - `fuentes/reddit.js`: `SUBREDDITS = ['CryptoCurrency', 'Bitcoin', 'ethereum']`, `CABECERAS_REDDIT`, `urlSubreddit(sub)`, `leerReddit(xml, sub): TitularCrudo[]` (fuente `r/<sub>`, origen `reddit`), `descargarReddit(fetch)` (3 subpeticiones, nunca lanza).

- [ ] **Step 1: Create the recorded fixtures**

Grabados el 2026-10-18: `https://cointelegraph.com/rss` recortado a sus 3 primeros `<item>` (cabecera y cierre intactos) y `https://www.reddit.com/r/CryptoCurrency/new/.rss?limit=3` completo (`.json` respondía 403, ver decisión 8). Contenido exacto:

`test/fixtures/rss-cointelegraph.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wfw="http://wellformedweb.org/CommentAPI/" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/" xmlns:slash="http://purl.org/rss/1.0/modules/slash/">
  <channel>
    <title>Cointelegraph.com News</title>
    <link>https://cointelegraph.com</link>
    <atom:link href="https://cointelegraph.com/rss" rel="self" type="application/rss+xml"/>
    <description>Cointelegraph covers fintech, blockchain and Bitcoin bringing you the latest crypto news and analyses on the future of money.</description>
    <generator>cointelegraph.com</generator>
    <lastBuildDate>Sun, 18 Oct 2026 20:57:39 +0000</lastBuildDate>
    <language>en</language>
    <sy:updatePeriod>hourly</sy:updatePeriod>
    <sy:updateFrequency>1</sy:updateFrequency>
    <image>
      <title>Cointelegraph.com News</title>
      <link>https://cointelegraph.com</link>
      <url>https://s3.cointelegraph.com/storage/uploads/view/b9ea15d46738b4df64e6e100ab59b373.png</url>
      <description>Cointelegraph covers fintech, blockchain and Bitcoin bringing you the latest crypto news and analyses on the future of money.</description>
    </image>
    <item>
      <title>Here’s what happened in crypto today</title>
      <pubDate>Sun, 18 Oct 2026 13:54:00 +0000</pubDate>
      <atom:updated>Sun, 18 Oct 2026 13:58:05 +0000</atom:updated>
      <guid isPermaLink="true">https://cointelegraph.com/news/what-happened-in-crypto-today</guid>
      <link><![CDATA[https://cointelegraph.com/news/what-happened-in-crypto-today?utm_source=rss_feed&utm_medium=rss&utm_campaign=rss_partner_inbound]]></link>
      <description><![CDATA[<p style="float:right; margin:0 0 10px 15px; width:240px;"><img src="https://s3-images.ctmedia.io/media/article-covers/article-covers-110589-what-happened-in-crypto-today.jpg" alt="Here’s what happened in crypto today" class="type:primaryImage"></p><p>Need to know what happened in crypto today? Here is the latest news on daily trends and events impacting Bitcoin price, blockchain, DeFi, Web3 and crypto regulation.</p>]]></description>
      <dc:creator>Cointelegraph by Michael Millard</dc:creator>
      <media:content url="https://s3-images.ctmedia.io/media/article-covers/article-covers-110589-what-happened-in-crypto-today.jpg" fileSize="848525" type="image/jpeg" medium="image" height="966" width="1450">
        <credit>Cointelegraph</credit>
        <media:credit role="publishing company">Cointelegraph</media:credit>
      </media:content>
      <enclosure url="https://s3-images.ctmedia.io/media/article-covers/article-covers-110589-what-happened-in-crypto-today.jpg" length="848525" type="image/jpeg"/>
      <category>Latest News</category>
    </item>
    <item>
      <title>Most Americans polled oppose betting on elections: Reuters</title>
      <pubDate>Sun, 18 Oct 2026 13:48:00 +0000</pubDate>
      <atom:updated>Sun, 18 Oct 2026 14:13:57 +0000</atom:updated>
      <guid isPermaLink="true">https://cointelegraph.com/news/most-americans-polled-oppose-betting-on-elections-reuters</guid>
      <link><![CDATA[https://cointelegraph.com/news/most-americans-polled-oppose-betting-on-elections-reuters?utm_source=rss_feed&utm_medium=rss&utm_campaign=rss_partner_inbound]]></link>
      <description><![CDATA[<p style="float:right; margin:0 0 10px 15px; width:240px;"><img src="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M57M1156GPPFQ4JMAMQP3RQS/hi-japan-having-a-hard-time-gambling-a-and-casinos-poker.jpg" alt="Most Americans polled oppose betting on elections: Reuters" class="type:primaryImage"></p><p>The prediction market industry enables people to bet on US ‌elections and sporting events.</p>]]></description>
      <dc:creator>Cointelegraph by Michael Millard</dc:creator>
      <media:content url="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M57M1156GPPFQ4JMAMQP3RQS/hi-japan-having-a-hard-time-gambling-a-and-casinos-poker.jpg" fileSize="364961" type="image/jpeg" medium="image" height="966" width="1450">
        <credit>Cointelegraph</credit>
        <media:credit role="publishing company">Cointelegraph</media:credit>
      </media:content>
      <enclosure url="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M57M1156GPPFQ4JMAMQP3RQS/hi-japan-having-a-hard-time-gambling-a-and-casinos-poker.jpg" length="364961" type="image/jpeg"/>
      <category>Latest News</category>
    </item>
    <item>
      <title>Cysic crypto bridge halted after unauthorized mint of 10M CYS</title>
      <pubDate>Sun, 18 Oct 2026 10:46:00 +0000</pubDate>
      <atom:updated>Sun, 18 Oct 2026 13:38:12 +0000</atom:updated>
      <guid isPermaLink="true">https://cointelegraph.com/news/cysic-crypto-bridge-halted-after-unauthorized-mint-of-10m-cys</guid>
      <link><![CDATA[https://cointelegraph.com/news/cysic-crypto-bridge-halted-after-unauthorized-mint-of-10m-cys?utm_source=rss_feed&utm_medium=rss&utm_campaign=rss_partner_inbound]]></link>
      <description><![CDATA[<p style="float:right; margin:0 0 10px 15px; width:240px;"><img src="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M579P8BRBQSA398D6CZ7DFCZ/hi-company-halts-bridge-after-reported-exploit.jpg" alt="Cysic crypto bridge halted after unauthorized mint of 10M CYS" class="type:primaryImage"></p><p>Cysic said the incident was limited to bridge message processing and minting and did not affect the mainnet or other operational systems.</p>]]></description>
      <dc:creator>Cointelegraph by Michael Millard</dc:creator>
      <media:content url="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M579P8BRBQSA398D6CZ7DFCZ/hi-company-halts-bridge-after-reported-exploit.jpg" fileSize="1029899" type="image/jpeg" medium="image" height="966" width="1450">
        <credit>Cointelegraph</credit>
        <media:credit role="publishing company">Cointelegraph</media:credit>
      </media:content>
      <enclosure url="https://s3-images.ctmedia.io/media/article-covers/2026/10/01M579P8BRBQSA398D6CZ7DFCZ/hi-company-halts-bridge-after-reported-exploit.jpg" length="1029899" type="image/jpeg"/>
      <category>Latest News</category>
    </item>
  </channel>
</rss>
```

`test/fixtures/reddit-cryptocurrency.xml` (una sola línea, tal cual la sirve Reddit, más el salto de línea final):

```xml
<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><category term="CryptoCurrency" label="r/CryptoCurrency"/><updated>2026-10-18T21:03:32+00:00</updated><icon>https://www.redditstatic.com/icon.png/</icon><id>/r/CryptoCurrency/new/.rss?limit=3</id><link rel="self" href="https://www.reddit.com/r/CryptoCurrency/new/.rss?limit=3" type="application/atom+xml" /><link rel="alternate" href="https://www.reddit.com/r/CryptoCurrency/new/?limit=3" type="text/html" /><subtitle>The leading community for cryptocurrency news, discussion, and analysis.</subtitle><title>newest submissions : CryptoCurrency</title><entry><author><name>/u/ansi09</name><uri>https://www.reddit.com/user/ansi09</uri></author><category term="CryptoCurrency" label="r/CryptoCurrency"/><content type="html">&lt;table&gt; &lt;tr&gt;&lt;td&gt; &lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x991yw/solana_ecosystem_news_october_182026/&quot;&gt; &lt;img src=&quot;https://preview.redd.it/cbf2xefhg9wh1.png?width=140&amp;amp;height=93&amp;amp;auto=webp&amp;amp;s=fda243def39e15bcb2e454f277bcb566faba1b39&quot; alt=&quot;Solana Ecosystem News - October 18-2026&quot; title=&quot;Solana Ecosystem News - October 18-2026&quot; /&gt; &lt;/a&gt; &lt;/td&gt;&lt;td&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/ansi09&quot;&gt; /u/ansi09 &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;/r/solana/comments/1x9913l/solana_ecosystem_news_october_182026/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x991yw/solana_ecosystem_news_october_182026/&quot;&gt;[comments]&lt;/a&gt;&lt;/span&gt; &lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content><id>t3_1x991yw</id><media:thumbnail url="https://preview.redd.it/cbf2xefhg9wh1.png?width=140&amp;height=93&amp;auto=webp&amp;s=fda243def39e15bcb2e454f277bcb566faba1b39" /><link href="https://www.reddit.com/r/CryptoCurrency/comments/1x991yw/solana_ecosystem_news_october_182026/" /><updated>2026-10-18T17:31:51+00:00</updated><published>2026-10-18T17:31:51+00:00</published><title>Solana Ecosystem News - October 18-2026</title></entry><entry><author><name>/u/kirtash93</name><uri>https://www.reddit.com/user/kirtash93</uri></author><category term="CryptoCurrency" label="r/CryptoCurrency"/><content type="html">&lt;table&gt; &lt;tr&gt;&lt;td&gt; &lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x97ujd/bitcoins_quantum_transition_wont_stop_at_bitcoin/&quot;&gt; &lt;img src=&quot;https://external-preview.redd.it/dmB1nhZfZbFoUrvQ9CDC_4ec9NvWpHk5ai3LPwTCh5E.jpeg?width=640&amp;amp;crop=smart&amp;amp;auto=webp&amp;amp;s=3fa82eda5ca3a05cf00a7b733390acf556f849bc&quot; alt=&quot;Bitcoin's Quantum Transition Won't Stop at Bitcoin&quot; title=&quot;Bitcoin's Quantum Transition Won't Stop at Bitcoin&quot; /&gt; &lt;/a&gt; &lt;/td&gt;&lt;td&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/kirtash93&quot;&gt; /u/kirtash93 &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://www.newsbtc.com/news/bitcoins-quantum-transition-wont-stop-at-bitcoin/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x97ujd/bitcoins_quantum_transition_wont_stop_at_bitcoin/&quot;&gt;[comments]&lt;/a&gt;&lt;/span&gt; &lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</content><id>t3_1x97ujd</id><media:thumbnail url="https://external-preview.redd.it/dmB1nhZfZbFoUrvQ9CDC_4ec9NvWpHk5ai3LPwTCh5E.jpeg?width=640&amp;crop=smart&amp;auto=webp&amp;s=3fa82eda5ca3a05cf00a7b733390acf556f849bc" /><link href="https://www.reddit.com/r/CryptoCurrency/comments/1x97ujd/bitcoins_quantum_transition_wont_stop_at_bitcoin/" /><updated>2026-10-18T16:43:22+00:00</updated><published>2026-10-18T16:43:22+00:00</published><title>Bitcoin's Quantum Transition Won't Stop at Bitcoin</title></entry><entry><author><name>/u/Electronic_Worker245</name><uri>https://www.reddit.com/user/Electronic_Worker245</uri></author><category term="CryptoCurrency" label="r/CryptoCurrency"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Been in two cycles now. Taken multuple 5 figures off Kraken with no issues in the past so I fully trust them.&lt;/p&gt; &lt;p&gt;So hackers got access to my email address, like a numpty I had the same password and email associated with my kraken account.&lt;/p&gt; &lt;p&gt;They got in. Everything was happening so fast. My phone was being bombarded with notifications.&lt;/p&gt; &lt;p&gt;They changed my largest crypto assets into another, added two withdrawal addresses to take it off.&lt;/p&gt; &lt;p&gt;They couldn&amp;#39;t withdraw it !!! My passport expires soon so Kraken wants me to update it. All in all I&amp;#39;ve lost around £300 to fees as Ive switched back to the asset i originally had and will be taking everything off the exchange once I get my ID verified. Im all for KYC after this ordeal and have enabled all sorts of additional security now.&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/Electronic_Worker245&quot;&gt; /u/Electronic_Worker245 &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x95ucj/saved_by_kyc/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/CryptoCurrency/comments/1x95ucj/saved_by_kyc/&quot;&gt;[comments]&lt;/a&gt;&lt;/span&gt;</content><id>t3_1x95ucj</id><link href="https://www.reddit.com/r/CryptoCurrency/comments/1x95ucj/saved_by_kyc/" /><updated>2026-10-18T15:21:54+00:00</updated><published>2026-10-18T15:21:54+00:00</published><title>Saved by KYC</title></entry></feed>
```

- [ ] **Step 2: Write the failing test**

Create `worker/test/fuentes-noticias.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { CABECERAS_REDDIT, SUBREDDITS, descargarReddit, leerReddit, urlSubreddit } from '../src/fuentes/reddit.js'
import { FEEDS, decodificarEntidades, descargarFeeds, leerFeed, limpiar } from '../src/fuentes/rss.js'
import { fixtureTexto, simularFetch } from './ayudantes.js'

const RSS = fixtureTexto('rss-cointelegraph.xml')
const REDDIT = fixtureTexto('reddit-cryptocurrency.xml')

describe('rss', () => {
  test('lee los 3 items del fixture real de CoinTelegraph (RSS 2.0)', () => {
    const t = leerFeed(RSS, 'CoinTelegraph')
    assert.equal(t.length, 3)
    assert.deepEqual(t[0], {
      fuente: 'CoinTelegraph',
      origen: 'rss',
      titulo: 'Here’s what happened in crypto today',
      url: 'https://cointelegraph.com/news/what-happened-in-crypto-today?utm_source=rss_feed&utm_medium=rss&utm_campaign=rss_partner_inbound',
      publicadoEn: Date.parse('2026-10-18T13:54:00Z'),
    })
    assert.equal(t[2].titulo, 'Cysic crypto bridge halted after unauthorized mint of 10M CYS')
    assert.equal(t[2].publicadoEn, Date.parse('2026-10-18T10:46:00Z'))
  })

  test('limpiar quita CDATA y etiquetas y decodifica entidades', () => {
    assert.equal(limpiar('<![CDATA[<b>BTC</b> &amp; ETH]]>'), 'BTC & ETH')
    assert.equal(limpiar('  Ripple&#8217;s   win &#x2014; XRP &lt; $3 '), 'Ripple’s win — XRP < $3')
    assert.equal(limpiar(null), '')
    assert.equal(decodificarEntidades('&desconocida; &#0;'), '&desconocida; &#0;')
  })

  test('descarta items sin título o con fecha ilegible', () => {
    const xml = `<rss><channel>
      <item><title></title><pubDate>Sun, 18 Oct 2026 13:54:00 +0000</pubDate></item>
      <item><title>Sin fecha</title><pubDate>ayer</pubDate></item>
      <item><title>Válido</title><dc:date>2026-10-18T10:00:00Z</dc:date><link>https://x.test/a</link></item>
    </channel></rss>`
    assert.deepEqual(leerFeed(xml, 'X'), [
      { fuente: 'X', origen: 'rss', titulo: 'Válido', url: 'https://x.test/a', publicadoEn: Date.parse('2026-10-18T10:00:00Z') },
    ])
  })

  test('descargarFeeds: 14 feeds en paralelo; los que fallan se anotan y no paran el resto', async () => {
    const fetch = simularFetch((url) => {
      if (url === 'https://cointelegraph.com/rss') return { cuerpo: RSS }
      if (url === 'https://decrypt.co/feed') return { error: new Error('timeout') }
      return { estado: 403, cuerpo: '' }
    })
    const { titulares, fallos } = await descargarFeeds(fetch)
    assert.equal(fetch.llamadas.length, FEEDS.length)
    assert.equal(FEEDS.length, 14)
    assert.equal(titulares.length, 3)
    assert.equal(fallos.length, 13)
    assert.ok(fallos.includes('rss Decrypt: timeout'))
    assert.ok(fallos.includes('rss CoinDesk: HTTP 403'))
  })
})

describe('reddit', () => {
  test('lee las 3 entradas del fixture real de r/CryptoCurrency (Atom)', () => {
    const t = leerReddit(REDDIT, 'CryptoCurrency')
    assert.deepEqual(t.map((x) => x.titulo), [
      'Solana Ecosystem News - October 18-2026',
      "Bitcoin's Quantum Transition Won't Stop at Bitcoin",
      'Saved by KYC',
    ])
    assert.deepEqual(t[0], {
      fuente: 'r/CryptoCurrency',
      origen: 'reddit',
      titulo: 'Solana Ecosystem News - October 18-2026',
      url: 'https://www.reddit.com/r/CryptoCurrency/comments/1x991yw/solana_ecosystem_news_october_182026/',
      publicadoEn: Date.parse('2026-10-18T17:31:51Z'),
    })
  })

  test('descargarReddit: 3 subreddits con User-Agent propio; 429 se anota', async () => {
    const fetch = simularFetch((url) => (url === urlSubreddit('CryptoCurrency') ? { cuerpo: REDDIT } : { estado: 429, cuerpo: '' }))
    const { titulares, fallos } = await descargarReddit(fetch)
    assert.deepEqual(fetch.llamadas.map((l) => l.url), SUBREDDITS.map(urlSubreddit))
    assert.equal(fetch.llamadas[0].init?.headers, CABECERAS_REDDIT)
    assert.equal(titulares.length, 3)
    assert.deepEqual(fallos, ['reddit r/Bitcoin: HTTP 429', 'reddit r/ethereum: HTTP 429'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/fuentes-noticias.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/fuentes/reddit.js`.

- [ ] **Step 4: Write `rss.js`**

Create `worker/src/fuentes/rss.js`:

```js
// @ts-check
// Titulares de feeds RSS 2.0 y Atom con expresiones regulares (sin librerías XML: CPU mínima).

/** @typedef {{ fuente: string, origen: 'rss'|'reddit', titulo: string, url: string|null, publicadoEn: number }} TitularCrudo */

/** Los 14 feeds de CryptoTrade (14 subpeticiones). */
export const FEEDS = Object.freeze([
  { fuente: 'CoinTelegraph', url: 'https://cointelegraph.com/rss' },
  { fuente: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { fuente: 'Decrypt', url: 'https://decrypt.co/feed' },
  { fuente: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed/' },
  { fuente: 'Bitcoin.com News', url: 'https://news.bitcoin.com/feed/' },
  { fuente: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { fuente: 'NewsBTC', url: 'https://www.newsbtc.com/feed/' },
  { fuente: 'CryptoPotato', url: 'https://cryptopotato.com/feed/' },
  { fuente: 'AMBCrypto', url: 'https://ambcrypto.com/feed/' },
  { fuente: 'U.Today', url: 'https://u.today/rss' },
  { fuente: 'BeInCrypto', url: 'https://beincrypto.com/feed/' },
  { fuente: 'CoinGape', url: 'https://coingape.com/feed/' },
  { fuente: 'Bitcoinist', url: 'https://bitcoinist.com/feed/' },
  { fuente: 'CryptoBriefing', url: 'https://cryptobriefing.com/feed/' },
])

export const CABECERAS_FEED = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (compatible; ORACLE/0.1; simulacion personal)',
  Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
})

/** @type {Record<string, string>} */
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

/** @param {string} texto */
export function decodificarEntidades(texto) {
  return texto.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === '#') {
      const codigo = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(codigo) && codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : todo
    }
    return ENTIDADES[e.toLowerCase()] ?? todo
  })
}

/**
 * Texto plano: quita CDATA y etiquetas, decodifica entidades y compacta espacios.
 * @param {string|null} texto
 */
export function limpiar(texto) {
  if (texto === null) return ''
  const sinCdata = texto.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return decodificarEntidades(sinCdata.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
}

/**
 * Contenido de la primera etiqueta `<nombre>…</nombre>` (no autocerrada) del bloque.
 * @param {string} bloque
 * @param {string} nombre p. ej. 'title', 'pubDate', 'dc:date'
 */
function etiqueta(bloque, nombre) {
  const m = bloque.match(new RegExp(`<${nombre}(?:\\s[^>]*)?(?<!/)>([\\s\\S]*?)</${nombre}>`, 'i'))
  return m ? m[1] : null
}

/** @param {string} bloque */
function enlace(bloque) {
  const texto = limpiar(etiqueta(bloque, 'link'))
  if (texto) return texto
  const atom = bloque.match(/<link\b[^>]*\bhref="([^"]+)"/i)
  return atom ? decodificarEntidades(atom[1]) : null
}

/**
 * Titulares de un feed RSS 2.0 (`<item>`) o Atom (`<entry>`). Descarta los que no tienen título o fecha.
 * @param {string} xml
 * @param {string} fuente
 * @param {'rss'|'reddit'} [origen]
 * @returns {TitularCrudo[]}
 */
export function leerFeed(xml, fuente, origen = 'rss') {
  const bloques = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []
  /** @type {TitularCrudo[]} */
  const titulares = []
  for (const bloque of bloques) {
    const titulo = limpiar(etiqueta(bloque, 'title'))
    const fecha = etiqueta(bloque, 'pubDate') ?? etiqueta(bloque, 'published') ?? etiqueta(bloque, 'updated')
      ?? etiqueta(bloque, 'dc:date')
    const publicadoEn = Date.parse(limpiar(fecha))
    if (!titulo || !Number.isFinite(publicadoEn)) continue
    titulares.push({ fuente, origen, titulo, url: enlace(bloque), publicadoEn })
  }
  return titulares
}

/**
 * Descarga todos los feeds en paralelo. Uno que falle se ignora y se anota.
 * @param {typeof fetch} fetch
 * @returns {Promise<{ titulares: TitularCrudo[], fallos: string[] }>}
 */
export async function descargarFeeds(fetch) {
  const resultados = await Promise.allSettled(FEEDS.map(async (f) => {
    const res = await fetch(f.url, { headers: CABECERAS_FEED })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return leerFeed(await res.text(), f.fuente)
  }))
  /** @type {TitularCrudo[]} */
  const titulares = []
  /** @type {string[]} */
  const fallos = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') titulares.push(...r.value)
    else fallos.push(`rss ${FEEDS[i].fuente}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
  })
  return { titulares, fallos }
}
```

- [ ] **Step 5: Write `reddit.js`**

Create `worker/src/fuentes/reddit.js`:

```js
// @ts-check
// Rumores de Reddit, best-effort: el feed Atom (.rss) de cada subreddit. El .json responde 403
// a clientes que no son navegador y Reddit limita mucho las IPs de nube; si falla, se ignora.
import { leerFeed } from './rss.js'

/** @typedef {import('./rss.js').TitularCrudo} TitularCrudo */

export const SUBREDDITS = Object.freeze(['CryptoCurrency', 'Bitcoin', 'ethereum'])

export const CABECERAS_REDDIT = Object.freeze({
  'User-Agent': 'web:oracle-paper-trading:v0.1 (simulacion personal)',
  Accept: 'application/atom+xml',
})

/** @param {string} subreddit */
export const urlSubreddit = (subreddit) => `https://www.reddit.com/r/${subreddit}/new/.rss?limit=25`

/**
 * @param {string} xml
 * @param {string} subreddit
 * @returns {TitularCrudo[]}
 */
export const leerReddit = (xml, subreddit) => leerFeed(xml, `r/${subreddit}`, 'reddit')

/**
 * 3 subpeticiones en paralelo.
 * @param {typeof fetch} fetch
 * @returns {Promise<{ titulares: TitularCrudo[], fallos: string[] }>}
 */
export async function descargarReddit(fetch) {
  const resultados = await Promise.allSettled(SUBREDDITS.map(async (s) => {
    const res = await fetch(urlSubreddit(s), { headers: CABECERAS_REDDIT })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return leerReddit(await res.text(), s)
  }))
  /** @type {TitularCrudo[]} */
  const titulares = []
  /** @type {string[]} */
  const fallos = []
  resultados.forEach((r, i) => {
    if (r.status === 'fulfilled') titulares.push(...r.value)
    else fallos.push(`reddit r/${SUBREDDITS[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`)
  })
  return { titulares, fallos }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/fuentes-noticias.test.js`
Expected: PASS — 6 tests, 0 fail.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: 0 fail (167 tests).

- [ ] **Step 8: Commit**

```bash
git add test/fixtures/rss-cointelegraph.xml test/fixtures/reddit-cryptocurrency.xml worker/src/fuentes/rss.js worker/src/fuentes/reddit.js worker/test/fuentes-noticias.test.js
git commit -m "feat(worker): titulares de 14 RSS y de Reddit (Atom) sin librerías XML" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 5: LLM en cascada con validación estricta

**Files:**
- Create: `worker/src/fuentes/llm.js`
- Test: `worker/test/llm.test.js`

**Interfaces:**
- Consumes: `core/lexico.js` — `analizarTitular(titulo)` (Task 1); tipo `Senal` de `core/hora.js`; `worker/test/ayudantes.js` — `simularFetch` (Task 3).
- Produces (`fuentes/llm.js`):
  - Tipos `Motor = 'cf'|'groq'|'gemini'`, `EntornoLlm = { AI?, LLM_MODELO_CF?, GROQ_API_KEY?, LLM_MODELO_GROQ?, GEMINI_API_KEY?, LLM_MODELO_GEMINI? }`.
  - `GROQ`, `GEMINI` (URLs), `TIEMPO_MAXIMO_MS = 20_000`, `MAX_TOKENS = 3000`.
  - `extraerJson(texto: unknown): unknown|null`; `proveedores(env, fetch): { motor, llamar(sistema, usuario): Promise<string> }[]`; `completarJson({ env, fetch, sistema, usuario, validar }): Promise<{ motor: Motor|null, datos: T|null, fallos: string[] }>`.
  - `puntuarTitulares({ env, fetch, titulares: { id, titulo }[], monedas: string[] }): Promise<{ resultados: Record<id, { puntuacion, monedas, motor: Motor|'lexico' }>, fallos: string[] }>` — una sola llamada por lote.
  - `explicarSenales({ env, fetch, senales: Senal[] }): Promise<{ textos: Record<simbolo, { texto, motor: Motor|'plantilla' }>, fallos: string[] }>` — una sola llamada.
  - `plantillaExplicacion(senal): string`, `resumenParaLlm(senal)`, `sistemaTitulares(monedas)`, `SISTEMA_EXPLICACION`.

- [ ] **Step 1: Write the failing test**

Create `worker/test/llm.test.js`:

````js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  GEMINI, GROQ, explicarSenales, extraerJson, plantillaExplicacion, proveedores, puntuarTitulares,
} from '../src/fuentes/llm.js'
import { simularFetch } from './ayudantes.js'

const MONEDAS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP']
const TITULARES = [
  { id: 'a', titulo: 'Bitcoin rally continues' },
  { id: 'b', titulo: 'Crypto exchange hacked' },
  { id: 'c', titulo: 'Ether ETFs see inflows' },
]

/**
 * Binding AI simulado: devuelve las respuestas en orden y guarda las entradas.
 * @param {...(string|Error)} respuestas
 */
function simularAi(...respuestas) {
  /** @type {{ modelo: string, entrada: any }[]} */
  const llamadas = []
  return {
    llamadas,
    /** @param {string} modelo @param {any} entrada */
    async run(modelo, entrada) {
      llamadas.push({ modelo, entrada })
      const r = respuestas.shift() ?? new Error('sin respuesta')
      if (r instanceof Error) throw r
      return { response: r }
    },
  }
}

/** @param {string} contenido */
const respuestaGroq = (contenido) => ({ cuerpo: { choices: [{ message: { content: contenido } }] } })
/** @param {string} texto */
const respuestaGemini = (texto) => ({ cuerpo: { candidates: [{ content: { parts: [{ text: texto }] } }] } })

/**
 * @param {Partial<import('../../core/hora.js').Senal>} [cambios]
 * @returns {import('../../core/hora.js').Senal}
 */
const senal = (cambios = {}) => ({
  version: 'v1', simbolo: 'BTC', calculadaEn: 0, vela1h: 0, precio: 100, fresca: true,
  veredicto: 'COMPRAR', puntuacion: 0.42, indiceConfianza: 0.71, alineacion: true, atrPct: 0.02, motivo: null,
  componentes: { tecnico: 0.6, derivados: null, noticias: -0.1, fng: 0 }, ausentes: ['derivados'],
  detalle: { timeframes: { '1h': { tendencia: 'alcista' }, '4h': { tendencia: 'lateral' }, '1d': { tendencia: 'alcista' } } },
  ...cambios,
})

describe('extraerJson', () => {
  test('acepta JSON envuelto en texto o en ```json; null si no hay objeto válido', () => {
    assert.deepEqual(extraerJson('```json\n{"a":1}\n```'), { a: 1 })
    assert.deepEqual(extraerJson('Aquí tienes: {"a":{"b":2}} ¡suerte!'), { a: { b: 2 } })
    assert.equal(extraerJson('{"a":'), null)
    assert.equal(extraerJson('sin json'), null)
    assert.equal(extraerJson(undefined), null)
  })
})

describe('proveedores', () => {
  test('orden cf → groq → gemini, cada uno solo si está configurado', () => {
    const fetch = simularFetch(() => ({}))
    assert.deepEqual(proveedores({}, fetch).map((p) => p.motor), [])
    assert.deepEqual(proveedores({ GEMINI_API_KEY: 'g' }, fetch).map((p) => p.motor), ['gemini'])
    const todos = { AI: simularAi(), LLM_MODELO_CF: '@cf/x', GROQ_API_KEY: 'k', GEMINI_API_KEY: 'g' }
    assert.deepEqual(proveedores(todos, fetch).map((p) => p.motor), ['cf', 'groq', 'gemini'])
    assert.deepEqual(proveedores({ AI: simularAi() }, fetch).map((p) => p.motor), [], 'sin modelo no hay cf')
  })
})

describe('puntuarTitulares', () => {
  test('Workers AI válido: puntúa todos con motor cf y envía el modelo de LLM_MODELO_CF', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 0.6, monedas: ['BTC'] },
      { n: 2, puntuacion: -0.8, monedas: ['MERCADO'] },
      { n: 3, puntuacion: 0.3, monedas: ['eth'] },
    ] }))
    const { resultados, fallos } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: '@cf/meta/llama-3.1-8b-instruct-fp8' }, fetch: simularFetch(() => ({})), titulares: TITULARES, monedas: MONEDAS,
    })
    assert.deepEqual(resultados, {
      a: { puntuacion: 0.6, monedas: ['BTC'], motor: 'cf' },
      b: { puntuacion: -0.8, monedas: ['MERCADO'], motor: 'cf' },
      c: { puntuacion: 0.3, monedas: ['ETH'], motor: 'cf' },
    })
    assert.deepEqual(fallos, [])
    assert.equal(ai.llamadas[0].modelo, '@cf/meta/llama-3.1-8b-instruct-fp8')
    assert.equal(ai.llamadas[0].entrada.messages[1].content,
      '{"titulares":[{"n":1,"titulo":"Bitcoin rally continues"},{"n":2,"titulo":"Crypto exchange hacked"},{"n":3,"titulo":"Ether ETFs see inflows"}]}')
  })

  test('elementos no válidos se descartan y esos titulares se puntúan con el léxico', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 1.5, monedas: ['BTC'] }, // fuera de rango
      { n: 2, puntuacion: -0.5, monedas: ['DOGE'] }, // moneda no seguida
      { n: 3, puntuacion: 0.2, monedas: ['ETH'] },
      { n: 3, puntuacion: 0.9, monedas: ['ETH'] }, // repetido: vale el primero
      { n: 9, puntuacion: 0.1, monedas: [] }, // no existe
    ] }))
    const { resultados } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: TITULARES, monedas: MONEDAS,
    })
    assert.deepEqual(resultados.a, { puntuacion: 0.5, monedas: ['BTC'], motor: 'lexico' })
    assert.deepEqual(resultados.b, { puntuacion: -0.5, monedas: ['MERCADO'], motor: 'lexico' })
    assert.deepEqual(resultados.c, { puntuacion: 0.2, monedas: ['ETH'], motor: 'cf' })
  })

  test('MERCADO junto a una moneda no es válido; [] (no afecta a ninguna) sí', async () => {
    const ai = simularAi(JSON.stringify({ titulares: [
      { n: 1, puntuacion: 0.1, monedas: ['MERCADO', 'BTC'] },
      { n: 2, puntuacion: 0, monedas: [] },
    ] }))
    const { resultados } = await puntuarTitulares({
      env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: TITULARES.slice(0, 2), monedas: MONEDAS,
    })
    assert.equal(resultados.a.motor, 'lexico')
    assert.deepEqual(resultados.b, { puntuacion: 0, monedas: [], motor: 'cf' })
  })

  test('cascada: cf lanza, Groq devuelve basura, Gemini responde bien → motor gemini', async () => {
    const fetch = simularFetch((url) => (url === GROQ
      ? respuestaGroq('no es json')
      : respuestaGemini('{"titulares":[{"n":1,"puntuacion":0.4,"monedas":["BTC"]}]}')))
    const { resultados, fallos } = await puntuarTitulares({
      env: {
        AI: simularAi(new Error('capacidad agotada')), LLM_MODELO_CF: 'm',
        GROQ_API_KEY: 'clave-groq', LLM_MODELO_GROQ: 'llama-3.3-70b-versatile',
        GEMINI_API_KEY: 'clave-gemini', LLM_MODELO_GEMINI: 'gemini-flash-latest',
      },
      fetch, titulares: TITULARES.slice(0, 1), monedas: MONEDAS,
    })
    assert.deepEqual(resultados.a, { puntuacion: 0.4, monedas: ['BTC'], motor: 'gemini' })
    assert.deepEqual(fallos, ['llm cf: capacidad agotada', 'llm groq: respuesta no válida'])
    const [groq, gemini] = fetch.llamadas
    assert.equal(groq.url, GROQ)
    assert.equal(/** @type {any} */ (groq.init?.headers).Authorization, 'Bearer clave-groq')
    const cuerpoGroq = JSON.parse(String(groq.init?.body))
    assert.equal(cuerpoGroq.model, 'llama-3.3-70b-versatile')
    assert.deepEqual(cuerpoGroq.response_format, { type: 'json_object' })
    assert.equal(gemini.url, `${GEMINI}/gemini-flash-latest:generateContent`)
    assert.equal(/** @type {any} */ (gemini.init?.headers)['x-goog-api-key'], 'clave-gemini')
  })

  test('sin ningún LLM configurado todo va al léxico, sin subpeticiones', async () => {
    const fetch = simularFetch(() => ({}))
    const { resultados, fallos } = await puntuarTitulares({ env: {}, fetch, titulares: TITULARES, monedas: MONEDAS })
    assert.deepEqual(Object.values(resultados).map((r) => r.motor), ['lexico', 'lexico', 'lexico'])
    assert.deepEqual(resultados.c, { puntuacion: 0.5, monedas: ['ETH'], motor: 'lexico' })
    assert.equal(fetch.llamadas.length, 0)
    assert.deepEqual(fallos, [])
  })

  test('lote vacío: no llama a nadie', async () => {
    const ai = simularAi()
    assert.deepEqual(
      await puntuarTitulares({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), titulares: [], monedas: MONEDAS }),
      { resultados: {}, fallos: [] },
    )
    assert.equal(ai.llamadas.length, 0)
  })
})

describe('explicaciones', () => {
  test('plantilla: veredicto, puntuación, confianza y componentes con los ausentes marcados', () => {
    assert.equal(plantillaExplicacion(senal()),
      'Señal de compra en BTC (puntuación 0,42, confianza 71 %, sin calibrar). técnico +0,60 · derivados ausente · noticias -0,10 · Fear & Greed +0,00.')
  })

  test('plantilla: contradicción técnico/derivados y SIN_DATOS', () => {
    const contradiccion = plantillaExplicacion(senal({ veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados' }))
    assert.ok(contradiccion.startsWith('Mantener en BTC'))
    assert.ok(contradiccion.endsWith('Técnico y derivados se contradicen, así que se mantiene.'))
    assert.equal(plantillaExplicacion(senal({ veredicto: 'SIN_DATOS', puntuacion: null, indiceConfianza: null })),
      'BTC: sin datos suficientes para analizar; el bot no abre posiciones.')
  })

  test('LLM válido para una moneda y ausente para otra → texto del LLM y plantilla', async () => {
    const ai = simularAi(JSON.stringify({ explicaciones: {
      BTC: 'El técnico es claramente alcista en dos de tres marcos temporales.', DOGE: 'No se pidió esta moneda.',
    } }))
    const senales = [senal(), senal({ simbolo: 'ETH', veredicto: 'MANTENER' })]
    const { textos } = await explicarSenales({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), senales })
    assert.deepEqual(textos.BTC, { texto: 'El técnico es claramente alcista en dos de tres marcos temporales.', motor: 'cf' })
    assert.equal(textos.ETH.motor, 'plantilla')
    assert.equal(textos.ETH.texto, plantillaExplicacion(senales[1]))
    assert.equal(Object.keys(textos).length, 2)
    const enviado = JSON.parse(ai.llamadas[0].entrada.messages[1].content)
    assert.deepEqual(enviado.senales[0].tendencias, { '1h': 'alcista', '4h': 'lateral', '1d': 'alcista' })
  })

  test('textos demasiado cortos o largos no valen → plantilla', async () => {
    const ai = simularAi(JSON.stringify({ explicaciones: { BTC: 'Sube.' } }))
    const { textos, fallos } = await explicarSenales({ env: { AI: ai, LLM_MODELO_CF: 'm' }, fetch: simularFetch(() => ({})), senales: [senal()] })
    assert.equal(textos.BTC.motor, 'plantilla')
    assert.deepEqual(fallos, ['llm cf: respuesta no válida'])
  })
})
````

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/llm.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/fuentes/llm.js`.

- [ ] **Step 3: Write the implementation**

Create `worker/src/fuentes/llm.js`:

````js
// @ts-check
// LLM en cascada: Workers AI → Groq (si hay GROQ_API_KEY) → Gemini (si hay GEMINI_API_KEY).
// Cada respuesta se valida de forma estricta; si no vale, se pasa al siguiente. Sin ninguno:
// léxico local para puntuar titulares y plantilla para explicar señales.
import { analizarTitular } from '../../../core/lexico.js'

/** @typedef {'cf'|'groq'|'gemini'} Motor */
/**
 * @typedef {{ AI?: { run: (modelo: string, entrada: object) => Promise<any> }, LLM_MODELO_CF?: string,
 *   GROQ_API_KEY?: string, LLM_MODELO_GROQ?: string, GEMINI_API_KEY?: string, LLM_MODELO_GEMINI?: string }} EntornoLlm
 */
/** @typedef {import('../../../core/hora.js').Senal} Senal */

export const TIEMPO_MAXIMO_MS = 20_000
export const MAX_TOKENS = 3000
export const GROQ = 'https://api.groq.com/openai/v1/chat/completions'
export const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'

/**
 * Primer objeto JSON del texto (los modelos a veces lo envuelven en ```json … ```). null si no hay.
 * @param {unknown} texto
 */
export function extraerJson(texto) {
  if (typeof texto !== 'string') return null
  const inicio = texto.indexOf('{')
  const fin = texto.lastIndexOf('}')
  if (inicio < 0 || fin <= inicio) return null
  try {
    return JSON.parse(texto.slice(inicio, fin + 1))
  } catch {
    return null
  }
}

/**
 * Proveedores configurados, en orden. Workers AI no gasta subpeticiones externas; Groq y Gemini, 1 cada uno.
 * @param {EntornoLlm} env
 * @param {typeof fetch} fetch
 * @returns {{ motor: Motor, llamar: (sistema: string, usuario: string) => Promise<string> }[]}
 */
export function proveedores(env, fetch) {
  /** @type {{ motor: Motor, llamar: (sistema: string, usuario: string) => Promise<string> }[]} */
  const lista = []
  if (env.AI && env.LLM_MODELO_CF) {
    const { AI, LLM_MODELO_CF: modelo } = env
    lista.push({
      motor: 'cf',
      llamar: async (sistema, usuario) => {
        const r = await AI.run(modelo, {
          messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
          max_tokens: MAX_TOKENS,
          temperature: 0.1,
        })
        return typeof r?.response === 'string' ? r.response : JSON.stringify(r?.response ?? null)
      },
    })
  }
  if (env.GROQ_API_KEY) {
    const clave = env.GROQ_API_KEY
    const modelo = env.LLM_MODELO_GROQ || 'llama-3.3-70b-versatile'
    lista.push({
      motor: 'groq',
      llamar: async (sistema, usuario) => {
        const res = await fetch(GROQ, {
          method: 'POST',
          headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: modelo,
            messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
            temperature: 0.1,
            max_tokens: MAX_TOKENS,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        return json?.choices?.[0]?.message?.content
      },
    })
  }
  if (env.GEMINI_API_KEY) {
    const clave = env.GEMINI_API_KEY
    const modelo = env.LLM_MODELO_GEMINI || 'gemini-flash-latest'
    lista.push({
      motor: 'gemini',
      llamar: async (sistema, usuario) => {
        const res = await fetch(`${GEMINI}/${modelo}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': clave, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sistema }] },
            contents: [{ role: 'user', parts: [{ text: usuario }] }],
            generationConfig: { temperature: 0.1, maxOutputTokens: MAX_TOKENS, responseMimeType: 'application/json' },
          }),
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        return json?.candidates?.[0]?.content?.parts?.[0]?.text
      },
    })
  }
  return lista
}

/**
 * Prueba los proveedores en orden hasta que uno devuelve JSON que `validar` acepta (≠ null).
 * @template T
 * @param {{ env: EntornoLlm, fetch: typeof fetch, sistema: string, usuario: string, validar: (json: unknown) => T|null }} entrada
 * @returns {Promise<{ motor: Motor|null, datos: T|null, fallos: string[] }>}
 */
export async function completarJson({ env, fetch, sistema, usuario, validar }) {
  /** @type {string[]} */
  const fallos = []
  for (const p of proveedores(env, fetch)) {
    try {
      const datos = validar(extraerJson(await p.llamar(sistema, usuario)))
      if (datos !== null) return { motor: p.motor, datos, fallos }
      fallos.push(`llm ${p.motor}: respuesta no válida`)
    } catch (e) {
      fallos.push(`llm ${p.motor}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { motor: null, datos: null, fallos }
}

/** @param {string[]} monedas */
export const sistemaTitulares = (monedas) => [
  'Eres un analista de mercados de criptomonedas. Para cada titular estima su efecto probable sobre el precio en las próximas horas.',
  '"puntuacion": número entre -1 (muy negativo) y 1 (muy positivo); 0 si es neutro o irrelevante.',
  `"monedas": símbolos afectados de esta lista: ${monedas.join(', ')}; ["MERCADO"] si afecta al mercado cripto en general; [] si no afecta a ninguna.`,
  'Responde SOLO con JSON con esta forma exacta: {"titulares":[{"n":1,"puntuacion":0.4,"monedas":["BTC"]}]}',
].join('\n')

/**
 * @typedef {{ puntuacion: number, monedas: string[], motor: Motor|'lexico' }} Puntuado
 */

/**
 * Puntúa un lote de titulares en una sola llamada. Los que el LLM no devuelve bien se puntúan con el léxico.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, titulares: { id: string, titulo: string }[], monedas: string[] }} entrada
 * @returns {Promise<{ resultados: Record<string, Puntuado>, fallos: string[] }>}
 */
export async function puntuarTitulares({ env, fetch, titulares, monedas }) {
  if (titulares.length === 0) return { resultados: {}, fallos: [] }
  const permitidas = new Set([...monedas, 'MERCADO'])
  /** @param {unknown} json */
  const validar = (json) => {
    const lista = /** @type {any} */ (json)?.titulares
    if (!Array.isArray(lista)) return null
    /** @type {Map<number, { puntuacion: number, monedas: string[] }>} */
    const validos = new Map()
    for (const it of lista) {
      const n = it?.n
      if (!Number.isInteger(n) || n < 1 || n > titulares.length || validos.has(n)) continue
      const p = it.puntuacion
      if (typeof p !== 'number' || !Number.isFinite(p) || p < -1 || p > 1) continue
      if (!Array.isArray(it.monedas) || !it.monedas.every((/** @type {unknown} */ m) => typeof m === 'string')) continue
      const ms = [...new Set(it.monedas.map((/** @type {string} */ m) => m.trim().toUpperCase()))]
      if (!ms.every((m) => permitidas.has(m)) || (ms.includes('MERCADO') && ms.length > 1)) continue
      validos.set(n, { puntuacion: p, monedas: ms })
    }
    return validos.size > 0 ? validos : null
  }
  const usuario = JSON.stringify({ titulares: titulares.map((t, i) => ({ n: i + 1, titulo: t.titulo })) })
  const r = await completarJson({ env, fetch, sistema: sistemaTitulares(monedas), usuario, validar })
  /** @type {Record<string, Puntuado>} */
  const resultados = {}
  titulares.forEach((t, i) => {
    const v = r.datos?.get(i + 1)
    resultados[t.id] = v && r.motor ? { ...v, motor: r.motor } : { ...analizarTitular(t.titulo), motor: 'lexico' }
  })
  return { resultados, fallos: r.fallos }
}

const NOMBRES = /** @type {const} */ ({ tecnico: 'técnico', derivados: 'derivados', noticias: 'noticias', fng: 'Fear & Greed' })
/** @type {Record<string, string>} */
const VEREDICTOS = { COMPRAR: 'Señal de compra', VENDER: 'Señal de venta', MANTENER: 'Mantener' }

/** @param {number} x @param {number} [decimales] */
const es = (x, decimales = 2) => x.toFixed(decimales).replace('.', ',')

/**
 * Explicación sin LLM a partir del desglose. Nunca inventa datos: solo los de la señal.
 * @param {Senal} senal
 */
export function plantillaExplicacion(senal) {
  if (senal.veredicto === 'SIN_DATOS') {
    return `${senal.simbolo}: sin datos suficientes para analizar; el bot no abre posiciones.`
  }
  /** @type {Record<string, number|null|undefined>} */
  const componentes = /** @type {any} */ (senal.componentes) ?? {}
  const partes = Object.entries(NOMBRES).map(([clave, nombre]) => {
    const v = componentes[clave]
    return typeof v === 'number' ? `${nombre} ${v >= 0 ? '+' : ''}${es(v)}` : `${nombre} ausente`
  })
  const confianza = senal.indiceConfianza === null ? '—' : `${Math.round(senal.indiceConfianza * 100)} %`
  const contradiccion = senal.motivo === 'contradiccion_tecnico_derivados'
    ? ' Técnico y derivados se contradicen, así que se mantiene.'
    : ''
  return `${VEREDICTOS[senal.veredicto] ?? senal.veredicto} en ${senal.simbolo} (puntuación ${es(senal.puntuacion ?? 0)}, `
    + `confianza ${confianza}, sin calibrar). ${partes.join(' · ')}.${contradiccion}`
}

/** Lo que ve el LLM de cada señal: datos estructurados, nada de texto libre. @param {Senal} senal */
export function resumenParaLlm(senal) {
  /** @type {any} */
  const detalle = senal.detalle ?? {}
  /** @type {Record<string, string>} */
  const tendencias = {}
  for (const tf of ['1h', '4h', '1d']) {
    const t = detalle.timeframes?.[tf]?.tendencia
    if (typeof t === 'string') tendencias[tf] = t
  }
  return {
    simbolo: senal.simbolo,
    veredicto: senal.veredicto,
    indiceConfianza: senal.indiceConfianza,
    puntuacion: senal.puntuacion,
    motivo: senal.motivo,
    componentes: senal.componentes,
    ausentes: senal.ausentes,
    alineacion: senal.alineacion,
    atrPct: senal.atrPct,
    tendencias,
  }
}

export const SISTEMA_EXPLICACION = [
  'Eres el asistente de ORACLE, un simulador de trading de criptomonedas. Explica en español, en 2 o 3 frases claras',
  'y sin jerga, por qué cada moneda tiene ese veredicto, usando SOLO los datos recibidos (componentes entre -1 y 1;',
  'los ausentes no se usaron). No cambies el veredicto, no inventes cifras ni des consejos de inversión.',
  'Responde SOLO con JSON con esta forma exacta: {"explicaciones":{"BTC":"texto"}}',
].join(' ')

/**
 * Una sola llamada para explicar todas las señales; la que falte o no valga usa la plantilla.
 * @param {{ env: EntornoLlm, fetch: typeof fetch, senales: Senal[] }} entrada
 * @returns {Promise<{ textos: Record<string, { texto: string, motor: Motor|'plantilla' }>, fallos: string[] }>}
 */
export async function explicarSenales({ env, fetch, senales }) {
  const simbolos = new Set(senales.map((s) => s.simbolo))
  /** @param {unknown} json */
  const validar = (json) => {
    const e = /** @type {any} */ (json)?.explicaciones
    if (!e || typeof e !== 'object' || Array.isArray(e)) return null
    /** @type {Record<string, string>} */
    const validas = {}
    for (const [simbolo, texto] of Object.entries(e)) {
      if (!simbolos.has(simbolo) || typeof texto !== 'string') continue
      const limpio = texto.trim()
      if (limpio.length >= 20 && limpio.length <= 600) validas[simbolo] = limpio
    }
    return Object.keys(validas).length > 0 ? validas : null
  }
  const usuario = JSON.stringify({ senales: senales.map(resumenParaLlm) })
  const r = senales.length > 0
    ? await completarJson({ env, fetch, sistema: SISTEMA_EXPLICACION, usuario, validar })
    : { motor: null, datos: null, fallos: [] }
  /** @type {Record<string, { texto: string, motor: Motor|'plantilla' }>} */
  const textos = {}
  for (const s of senales) {
    const texto = r.datos?.[s.simbolo]
    textos[s.simbolo] = texto && r.motor ? { texto, motor: r.motor } : { texto: plantillaExplicacion(s), motor: 'plantilla' }
  }
  return { textos, fallos: r.fallos }
}
````

- [ ] **Step 4: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/llm.test.js`
Expected: PASS — 12 tests, 0 fail.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: 0 fail (179 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/src/fuentes/llm.js worker/test/llm.test.js
git commit -m "feat(worker): LLM en cascada Workers AI → Groq → Gemini → léxico, con JSON validado" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 6: Repositorio del bot (simulaciones, estado y lote atómico por moneda)

**Files:**
- Create: `worker/src/repositorio.js`
- Create: `worker/test/escenario.js`
- Test: `worker/test/repositorio.test.js`

**Interfaces:**
- Consumes: `core/bot.js` (`estadoInicial`, tipos `Estado`, `Evento`, `Decision`, `ParametrosBot`), `core/hora.js` (`ejecutarHora`, tipos `Senal`, `EntradaMoneda`), `core/estrategia-v1.js` (módulo de estrategia), `core/velas.js` (`HORA`); `test/ayudantes.js` (`serie`); `worker/test/ayudantes.js` (`aFilasBinance`, `fixtureJson`, `simularFetch`); `worker/src/fuentes/llm.js` (`GROQ`, `GEMINI`); `worker/test/d1.js` (`crearD1`).
- Produces (`worker/src/repositorio.js`; todas reciben `db: D1` primero):
  - Tipos `D1 = { prepare(sql), batch(sentencias) }`, `FilaSimulacion = { id, creada_en, cerrada_en, activa, estrategia_version, capital_inicial, saldo, hodl_json }`.
  - `simulacionActiva(db): Promise<FilaSimulacion|null>`, `obtenerSimulacion(db, id)`, `listarSimulaciones(db): Promise<FilaSimulacion[]>` (id desc), `crearSimulacion(db, { capitalInicial, version, ahora }): Promise<FilaSimulacion>` (cierra la activa en el mismo lote), `guardarHodl(db, simulacionId, hodl)` (solo si `hodl_json IS NULL`).
  - `cargarEstado(db, simulacion, parametrosBot): Promise<{ estado: Estado, hodl: Record<string, number>|null }>` (1 llamada).
  - `sentenciasPasoMoneda(db, { simulacionId, version, decision, senal, eventos, ultimaRevisada, ahora })` → sentencias; `guardarPasoMoneda(db, paso)` → un `db.batch` (rechaza si D1 lo rechaza: UNIQUE, CHECK, NOT NULL; `RangeError` si llega un evento de otra moneda).
  - `guardarCapital(db, { simulacionId, vela, valorCartera, saldo, valorHodl })` (`INSERT OR IGNORE`).
  - `worker/test/escenario.js` (solo tests): `CIERRE` (2026-10-01 00:00 UTC), `ahoraDe(k)` (= CIERRE + k h + 3 min), `HORAS_EXTRA = 12`, `crearEscenario(): Record<'BTC'|'ETH', Series>`, `servidasEn(velas, ahora)`, `entradasEn(escenario, ahora): EntradaMoneda[]`, `fetchEscenario(escenario, ahora, { caidas?, premium? })` (Binance y alternative.me simulados; fapi 451 salvo `premium`; Groq/Gemini 500). Con v1: hora 0 abre BTC y ETH; hora 1 stop-loss de BTC; hora 3 take-profit de ETH; hora 4 reabre ETH; hora 5 reabre BTC (fin del enfriamiento de 4 h).

- [ ] **Step 1: Create the scenario helper**

Create `worker/test/escenario.js`:

```js
// @ts-check
// Escenario sintético de varias horas para los tests del Worker (nunca se usa en producción):
// tendencia alcista limpia en USDT (la estrategia v1 da COMPRAR con confianza 0,75) y, en EUR,
// un desplome de BTC en la vela CIERRE (stop-loss) y un pico de ETH en CIERRE + 2 h (take-profit).
import { HORA } from '../../core/velas.js'
import { serie } from '../../test/ayudantes.js'
import { GEMINI, GROQ } from '../src/fuentes/llm.js'
import { aFilasBinance, fixtureJson, simularFetch } from './ayudantes.js'

/** Inicio de la vela 1H que dispara el stop de BTC. Alineado a día y a 4 h. */
export const CIERRE = Date.UTC(2026, 9, 1)
/** Instante del cron de mercado de la hora k (minuto 3). @param {number} k */
export const ahoraDe = (k) => CIERRE + k * HORA + 3 * 60_000
export const HORAS_EXTRA = 12

/** @typedef {import('../../core/velas.js').Vela} Vela */
/** @typedef {{ '1h': Vela[], '4h': Vela[], '1d': Vela[], eur: Vela[] }} Series */

/** @param {number} base */
function seriesDe(base) {
  /** @param {number} duracion @param {number} previas */
  const subida = (duracion, previas) => serie(previas + Math.ceil((HORAS_EXTRA * HORA) / duracion) + 1, (i) => base * 1.002 ** i, {
    duracion, inicio: CIERRE - previas * duracion,
  })
  return {
    '1h': subida(HORA, 300),
    '4h': subida(4 * HORA, 300),
    '1d': subida(24 * HORA, 300),
    eur: serie(48 + HORAS_EXTRA + 1, (i) => base * 0.9 * 1.002 ** i, { inicio: CIERRE - 48 * HORA }),
  }
}

/** @returns {Record<string, Series>} */
export function crearEscenario() {
  const btc = seriesDe(100)
  const eth = seriesDe(10)
  const desplome = btc.eur.find((v) => v.inicio === CIERRE)
  const pico = eth.eur.find((v) => v.inicio === CIERRE + 2 * HORA)
  if (!desplome || !pico) throw new Error('escenario mal construido')
  desplome.minimo = desplome.minimo * 0.5
  pico.maximo = pico.maximo * 2
  return { BTC: btc, ETH: eth }
}

/**
 * Lo que serviría Binance en `ahora`: velas ya empezadas (incluida la que sigue abierta), las 500 últimas.
 * @param {Vela[]} velas
 * @param {number} ahora
 */
export const servidasEn = (velas, ahora) => velas.filter((v) => v.inicio < ahora).slice(-500)

/**
 * Entradas de core/hora.js para `ahora`, sin derivados.
 * @param {Record<string, Series>} escenario
 * @param {number} ahora
 */
export function entradasEn(escenario, ahora) {
  return Object.entries(escenario).map(([simbolo, s]) => ({
    simbolo,
    velas: { '1h': servidasEn(s['1h'], ahora), '4h': servidasEn(s['4h'], ahora), '1d': servidasEn(s['1d'], ahora) },
    velasEur: servidasEn(s.eur, ahora),
    derivados: null,
  }))
}

const FNG = fixtureJson('alternative-fng.json')

/**
 * Binance y alternative.me simulados sobre el escenario en el instante `ahora`. fapi responde 451 (bloqueado),
 * Groq y Gemini 500. Una moneda que no está en el escenario usa las series de BTC.
 * @param {ReturnType<typeof crearEscenario>} escenario
 * @param {number} ahora
 * @param {{ caidas?: string[], premium?: object[]|null }} [op] caidas: pares cuyas velas responden 500
 *   (p. ej. 'SOLUSDT'); premium: respuesta de /fapi/v1/premiumIndex (el resto de fapi sigue en 451).
 */
export function fetchEscenario(escenario, ahora, { caidas = [], premium = null } = {}) {
  return simularFetch((url) => {
    if (url.startsWith('https://data-api.binance.vision/api/v3/klines')) {
      const p = new URL(url).searchParams
      const par = /** @type {string} */ (p.get('symbol'))
      if (caidas.includes(par)) return { estado: 500, cuerpo: '' }
      const eur = par.endsWith('EUR')
      const series = escenario[par.replace(/(USDT|EUR)$/, '')] ?? escenario.BTC
      const velas = eur ? series.eur : series[/** @type {'1h'|'4h'|'1d'} */ (p.get('interval'))]
      return { cuerpo: aFilasBinance(servidasEn(velas, ahora)) }
    }
    if (url.startsWith('https://api.alternative.me/fng/')) return { cuerpo: FNG }
    if (premium && url === 'https://fapi.binance.com/fapi/v1/premiumIndex') return { cuerpo: premium }
    if (url.startsWith('https://fapi.binance.com/')) return { estado: 451, cuerpo: '' }
    if (url === GROQ || url.startsWith(GEMINI)) return { estado: 500, cuerpo: '' }
    throw new Error(`URL inesperada en el test: ${url}`)
  })
}
```

- [ ] **Step 2: Write the failing test**

Create `worker/test/repositorio.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import { ejecutarHora } from '../../core/hora.js'
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
  test('crear cierra la activa anterior (sin borrar nada) y abre otra con su versión y capital', async () => {
    const db = crearD1()
    const a = await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 100 })
    assert.equal(a.activa, 1)
    assert.equal(a.saldo, 10_000)
    assert.equal(a.hodl_json, null)
    const b = await crearSimulacion(db, { capitalInicial: 5_000, version: 'v2', ahora: 200 })
    assert.deepEqual(await simulacionActiva(db), b)
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
    assert.deepEqual(await filas(db, 'SELECT * FROM capital'), [
      { simulacion_id: sim.id, vela_1h: CIERRE, valor_cartera: 10_000, saldo: 10_000, valor_hodl: null },
    ])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/repositorio.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/repositorio.js`.

- [ ] **Step 4: Write the implementation**

Create `worker/src/repositorio.js` (las tareas 7, 8 y 9 añadirán secciones al final):

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

/** @param {D1} db @returns {Promise<FilaSimulacion|null>} */
export function simulacionActiva(db) {
  return db.prepare('SELECT * FROM simulaciones WHERE activa = 1').first()
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
 * Cierra la simulación activa (si hay) y abre otra, en un solo lote. Nada se borra.
 * @param {D1} db
 * @param {{ capitalInicial: number, version: string, ahora: number }} datos
 * @returns {Promise<FilaSimulacion>}
 */
export async function crearSimulacion(db, { capitalInicial, version, ahora }) {
  const [, insercion] = await db.batch([
    db.prepare('UPDATE simulaciones SET activa = 0, cerrada_en = ? WHERE activa = 1').bind(ahora),
    db.prepare(
      'INSERT INTO simulaciones (creada_en, activa, estrategia_version, capital_inicial, saldo) VALUES (?, 1, ?, ?, ?) RETURNING *',
    ).bind(ahora, version, capitalInicial, capitalInicial),
  ])
  return insercion.results[0]
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
 * Estado de core/bot.js reconstruido sin pérdida desde D1, con una sola llamada (lote de 3 lecturas).
 * Sin fila de progreso = moneda nunca revisada (la clave no existe → −∞ en el bot).
 * @param {D1} db
 * @param {FilaSimulacion} simulacion
 * @param {ParametrosBot} parametrosBot de la estrategia de la simulación (enfriamientoHoras)
 * @returns {Promise<{ estado: Estado, hodl: Record<string, number>|null }>}
 */
export async function cargarEstado(db, simulacion, parametrosBot) {
  const id = simulacion.id
  const [abiertas, progreso, stops] = await db.batch([
    // ORDER BY id = orden de apertura, el mismo orden de claves que en memoria: valorCartera suma en ese
    // orden y así el resultado es idéntico al del backtest hasta el último bit.
    db.prepare("SELECT * FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta' ORDER BY id").bind(id),
    db.prepare('SELECT simbolo, ultima_vela_revisada FROM progreso WHERE simulacion_id = ?').bind(id),
    db.prepare(
      `SELECT simbolo, MAX(vela_salida) AS vela FROM posiciones
       WHERE simulacion_id = ? AND estado = 'cerrada' AND motivo_salida = 'stop_loss' GROUP BY simbolo`,
    ).bind(id),
  ])
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
 * Punto horario de la curva de capital; si ya existe, se conserva el primero.
 * @param {D1} db
 * @param {{ simulacionId: number, vela: number, valorCartera: number, saldo: number, valorHodl: number|null }} punto
 */
export function guardarCapital(db, { simulacionId, vela, valorCartera, saldo, valorHodl }) {
  return db.prepare(
    'INSERT OR IGNORE INTO capital (simulacion_id, vela_1h, valor_cartera, saldo, valor_hodl) VALUES (?, ?, ?, ?, ?)',
  ).bind(simulacionId, vela, valorCartera, saldo, valorHodl).run()
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/repositorio.test.js`
Expected: PASS — 11 tests, 0 fail. (Si quitas `ORDER BY id` de la primera consulta de `cargarEstado`, falla «orden en la hora 5»: es el motivo de esa cláusula, decisión 3.)

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: 0 fail (190 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/repositorio.js worker/test/escenario.js worker/test/repositorio.test.js
git commit -m "feat(worker): estado del bot en D1 sin pérdida y lote atómico por moneda" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 7: Cron de noticias

**Files:**
- Create: `worker/src/config.js`
- Modify: `worker/src/repositorio.js` (añadir al final)
- Create: `worker/src/ejecuciones/noticias.js`
- Test: `worker/test/noticias.test.js`

**Interfaces:**
- Consumes: `normalizarTexto` (Task 1); `descargarFeeds`, `TitularCrudo`, `descargarReddit`, `urlSubreddit` (Task 4); `puntuarTitulares`, `EntornoLlm` (Task 5); `crearD1` (Task 2); `simularFetch`, `fixtureTexto` (Task 3); `HORA` (`core/velas.js`).
- Produces:
  - `config.js`: `MONEDAS_POR_DEFECTO`, `CAPITAL_POR_DEFECTO = 10_000`, `leerMonedas(texto?: string): string[]`.
  - `repositorio.js` (nuevo): tipo `Ejecucion = { id, tipo, inicio, fin, ok: boolean|null, fallos: string[] }`; `iniciarEjecucion(db, tipo, inicio): Promise<number>`, `finalizarEjecucion(db, id, { fin, ok, detalle: { fallos, … } })`, `filaAEjecucion(fila): Ejecucion`, `ultimaEjecucion(db, tipos[]): Promise<Ejecucion|null>`; tipo `TitularNuevo = TitularCrudo & { id }`; `insertarTitulares(db, titulares): Promise<number>` (insertados), `titularesSinPuntuar(db, desde, limite): Promise<{ id, titulo }[]>`, `guardarPuntuaciones(db, resultados)`, `titularesParaEstrategia(db, desde, hasta): Promise<Titular[]>` (forma de `core`), `purgar(db, ahora)`.
  - `ejecuciones/noticias.js`: `VENTANA_MS` (48 h), `TOLERANCIA_FUTURO_MS` (1 h), `LOTE_LLM = 80`, `VENTANA_PUNTUAR_MS` (24 h), `idTitular(titulo): Promise<string>` (32 hex), `prepararTitulares(crudos, ahora)`, `ejecutarNoticias({ env, fetch, ahora }): Promise<{ id, ok, fallos, descargados, nuevos, puntuados, motores, error? }>` (no lanza salvo que D1 no deje registrar la ejecución).

- [ ] **Step 1: Write the failing test**

Create `worker/test/noticias.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { HORA } from '../../core/velas.js'
import { idTitular, ejecutarNoticias, prepararTitulares } from '../src/ejecuciones/noticias.js'
import { urlSubreddit } from '../src/fuentes/reddit.js'
import { titularesParaEstrategia } from '../src/repositorio.js'
import { simularFetch, fixtureTexto } from './ayudantes.js'
import { crearD1 } from './d1.js'

const AHORA = Date.parse('2026-10-18T21:01:00Z')
const DIA = 24 * HORA

/** CoinTelegraph y r/CryptoCurrency responden con sus fixtures; el resto de feeds falla. */
const fetchFixtures = () => simularFetch((url) => {
  if (url === 'https://cointelegraph.com/rss') return { cuerpo: fixtureTexto('rss-cointelegraph.xml') }
  if (url === urlSubreddit('CryptoCurrency')) return { cuerpo: fixtureTexto('reddit-cryptocurrency.xml') }
  return { estado: 503, cuerpo: '' }
})

/** @param {ReturnType<typeof crearD1>} db */
const titulares = async (db) => (await db.prepare('SELECT * FROM titulares ORDER BY publicado_en DESC').all()).results

describe('prepararTitulares', () => {
  test('id = hash del título normalizado: mayúsculas, acentos y signos no cuentan', async () => {
    assert.equal(await idTitular('Bitcoin sube: ¡récord!'), await idTitular('bitcoin SUBE recórd'))
    assert.notEqual(await idTitular('Bitcoin sube'), await idTitular('Bitcoin baja'))
    assert.match(await idTitular('x'), /^[0-9a-f]{32}$/)
  })

  test('descarta > 48 h, > 1 h en el futuro y títulos vacíos; deduplica (gana el primero)', async () => {
    /** @param {string} titulo @param {number} publicadoEn @param {string} [fuente] */
    const t = (titulo, publicadoEn, fuente = 'A') => ({ fuente, origen: /** @type {const} */ ('rss'), titulo, url: null, publicadoEn })
    const r = await prepararTitulares([
      t('Viejo', AHORA - 49 * HORA),
      t('Límite', AHORA - 48 * HORA),
      t('Futuro', AHORA + 2 * HORA),
      t('¡!', AHORA),
      t('Bitcoin rally', AHORA - HORA, 'A'),
      t('BITCOIN RALLY!', AHORA, 'B'),
    ], AHORA)
    assert.deepEqual(r.map((x) => `${x.titulo}/${x.fuente}`), ['Límite/A', 'Bitcoin rally/A'])
  })
})

describe('ejecutarNoticias', () => {
  test('guarda los titulares nuevos de RSS y Reddit, los puntúa con el léxico y anota los feeds caídos', async () => {
    const db = crearD1()
    const fetch = fetchFixtures()
    const r = await ejecutarNoticias({ env: { DB: db }, fetch, ahora: AHORA })
    assert.equal(fetch.llamadas.length, 17, '14 RSS + 3 Reddit, sin LLM configurado')
    assert.equal(r.ok, true)
    assert.equal(r.nuevos, 6)
    assert.equal(r.puntuados, 6)
    assert.deepEqual(r.motores, { lexico: 6 })
    assert.equal(r.fallos.length, 15)
    const filas = await titulares(db)
    assert.deepEqual(filas.map((f) => [f.origen, f.titulo, f.monedas_json, f.puntuacion, f.motor]), [
      ['reddit', 'Solana Ecosystem News - October 18-2026', '["SOL"]', 0, 'lexico'],
      ['reddit', "Bitcoin's Quantum Transition Won't Stop at Bitcoin", '["BTC"]', 0, 'lexico'],
      ['reddit', 'Saved by KYC', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Here’s what happened in crypto today', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Most Americans polled oppose betting on elections: Reuters', '["MERCADO"]', 0, 'lexico'],
      ['rss', 'Cysic crypto bridge halted after unauthorized mint of 10M CYS', '["MERCADO"]', -1, 'lexico'],
    ])
    const ejecucion = await db.prepare('SELECT * FROM ejecuciones').first()
    assert.equal(ejecucion?.tipo, 'noticias')
    assert.equal(ejecucion?.ok, 1)
    assert.equal(JSON.parse(ejecucion?.detalle_json).fallos.length, 15)
    assert.ok(db.llamadas <= 50)
  })

  test('segunda ejecución con los mismos feeds: nada nuevo y nada que puntuar', async () => {
    const db = crearD1()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    const r = await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA + HORA })
    assert.equal(r.nuevos, 0)
    assert.equal(r.puntuados, 0)
    assert.equal((await titulares(db)).length, 6)
  })

  test('con Workers AI el lote va en una sola llamada y se guarda el motor de cada titular', async () => {
    const db = crearD1()
    /** @type {any[]} */
    const entradas = []
    const AI = {
      /** @param {string} _modelo @param {any} entrada */
      async run(_modelo, entrada) {
        entradas.push(entrada)
        const lote = JSON.parse(entrada.messages[1].content).titulares
        const saved = lote.find((/** @type {any} */ t) => t.titulo === 'Saved by KYC')
        return { response: JSON.stringify({ titulares: [{ n: saved.n, puntuacion: 0.2, monedas: ['MERCADO'] }] }) }
      },
    }
    const r = await ejecutarNoticias({ env: { DB: db, AI, LLM_MODELO_CF: 'm' }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(entradas.length, 1)
    assert.deepEqual(r.motores, { cf: 1, lexico: 5 })
    const saved = (await titulares(db)).find((f) => f.titulo === 'Saved by KYC')
    assert.deepEqual([saved?.puntuacion, saved?.monedas_json, saved?.motor], [0.2, '["MERCADO"]', 'cf'])
  })

  test('los titulares guardados llegan a la estrategia con su forma de core', async () => {
    const db = crearD1()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    const t = await titularesParaEstrategia(db, AHORA - DIA, AHORA)
    assert.equal(t.length, 6)
    const sol = t.find((x) => x.monedas.includes('SOL'))
    assert.deepEqual(Object.keys(sol ?? {}).sort(), ['id', 'monedas', 'origen', 'publicadoEn', 'puntuacion'])
    assert.equal(sol?.origen, 'reddit')
    assert.equal(sol?.publicadoEn, Date.parse('2026-10-18T17:31:51Z'))
  })

  test('purga titulares > 7 días, ejecuciones > 30 días y bloqueos de PIN caducados', async () => {
    const db = crearD1()
    await db.prepare("INSERT INTO titulares (id, fuente, origen, titulo, publicado_en) VALUES ('viejo', 'X', 'rss', 'Viejo', ?)")
      .bind(AHORA - 8 * DIA).run()
    await db.prepare("INSERT INTO ejecuciones (tipo, inicio) VALUES ('mercado', ?)").bind(AHORA - 31 * DIA).run()
    await db.prepare("INSERT INTO intentos_pin VALUES ('1.1.1.1', 0, ?), ('2.2.2.2', 0, ?)").bind(AHORA - 1, AHORA + HORA).run()
    await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM titulares WHERE id = 'viejo'").first('n'), 0)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM ejecuciones').first('n'), 1)
    assert.deepEqual((await db.prepare('SELECT ip FROM intentos_pin').all()).results, [{ ip: '2.2.2.2' }])
  })

  test('un fallo de D1 a mitad deja la ejecución registrada con ok = 0 y el error', async () => {
    const db = crearD1()
    await db.prepare('DROP TABLE titulares').run()
    const r = await ejecutarNoticias({ env: { DB: db }, fetch: fetchFixtures(), ahora: AHORA })
    assert.equal(r.ok, false)
    assert.match(String(r.error), /no such table: titulares/)
    const ejecucion = await db.prepare('SELECT ok, fin, detalle_json FROM ejecuciones').first()
    assert.equal(ejecucion?.ok, 0)
    assert.ok(ejecucion?.fin)
    assert.match(JSON.parse(ejecucion?.detalle_json).error, /titulares/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/noticias.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/ejecuciones/noticias.js`.

- [ ] **Step 3: Write `config.js`**

Create `worker/src/config.js`:

```js
// @ts-check
// Lectura de las vars de wrangler.toml. Valores por defecto = los de la spec.

export const MONEDAS_POR_DEFECTO = Object.freeze(['BTC', 'ETH', 'SOL', 'BNB', 'XRP'])
export const CAPITAL_POR_DEFECTO = 10_000

/**
 * "BTC, eth,SOL" → ['BTC', 'ETH', 'SOL']. Descarta lo que no parezca un símbolo y los repetidos.
 * @param {string|undefined} texto
 */
export function leerMonedas(texto) {
  if (!texto) return [...MONEDAS_POR_DEFECTO]
  const monedas = [...new Set(texto.split(',').map((m) => m.trim().toUpperCase()).filter((m) => /^[A-Z0-9]{2,10}$/.test(m)))]
  return monedas.length > 0 ? monedas : [...MONEDAS_POR_DEFECTO]
}
```

- [ ] **Step 4: Extend the repository**

Append to the end of `worker/src/repositorio.js` (tras una línea en blanco):

```js
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

/**
 * Ejecución más reciente de alguno de los tipos dados.
 * @param {D1} db @param {('noticias'|'mercado'|'manual')[]} tipos
 * @returns {Promise<Ejecucion|null>}
 */
export async function ultimaEjecucion(db, tipos) {
  const fila = await db.prepare(
    `SELECT * FROM ejecuciones WHERE tipo IN (${tipos.map(() => '?').join(', ')}) ORDER BY inicio DESC, id DESC LIMIT 1`,
  ).bind(...tipos).first()
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
```

- [ ] **Step 5: Write the news run**

Create `worker/src/ejecuciones/noticias.js`:

```js
// @ts-check
// Cron `1 * * * *` (spec §5): RSS + Reddit → titulares nuevos → un lote al LLM → purga.
// Subpeticiones externas: 14 RSS + 3 Reddit + hasta 2 LLM (Groq, Gemini) = 19. Llamadas a D1: 6.
import { normalizarTexto } from '../../../core/lexico.js'
import { HORA } from '../../../core/velas.js'
import { leerMonedas } from '../config.js'
import { puntuarTitulares } from '../fuentes/llm.js'
import { descargarReddit } from '../fuentes/reddit.js'
import { descargarFeeds } from '../fuentes/rss.js'
import {
  finalizarEjecucion, guardarPuntuaciones, iniciarEjecucion, insertarTitulares, purgar, titularesSinPuntuar,
} from '../repositorio.js'

/** @typedef {import('../fuentes/rss.js').TitularCrudo} TitularCrudo */

/** Solo se guardan titulares de las últimas 48 h. */
export const VENTANA_MS = 48 * HORA
/** Fechas de hasta 1 h en el futuro se aceptan (relojes de los feeds). */
export const TOLERANCIA_FUTURO_MS = HORA
/** Titulares por llamada al LLM; los que no entren se puntúan en la ejecución siguiente. */
export const LOTE_LLM = 80
/** La estrategia solo usa las últimas 24 h: no merece la pena puntuar lo más antiguo. */
export const VENTANA_PUNTUAR_MS = 24 * HORA

/**
 * Id de un titular: SHA-256 (hex, 32 caracteres) del título normalizado. Mismo título en dos feeds = mismo id.
 * @param {string} titulo
 */
export async function idTitular(titulo) {
  const datos = new TextEncoder().encode(normalizarTexto(titulo).trim())
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos))
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Normaliza, descarta los de fuera de la ventana y deduplica por id (gana el primero visto).
 * @param {TitularCrudo[]} crudos
 * @param {number} ahora
 */
export async function prepararTitulares(crudos, ahora) {
  /** @type {Map<string, TitularCrudo & { id: string }>} */
  const unicos = new Map()
  for (const t of crudos) {
    if (t.publicadoEn < ahora - VENTANA_MS || t.publicadoEn > ahora + TOLERANCIA_FUTURO_MS) continue
    if (normalizarTexto(t.titulo).trim().length < 3) continue
    const id = await idTitular(t.titulo)
    if (!unicos.has(id)) unicos.set(id, { ...t, id })
  }
  return [...unicos.values()]
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number }} deps
 */
export async function ejecutarNoticias({ env, fetch, ahora }) {
  const db = env.DB
  const id = await iniciarEjecucion(db, 'noticias', ahora)
  /** @type {string[]} */
  const fallos = []
  const resumen = { descargados: 0, nuevos: 0, puntuados: 0, /** @type {Record<string, number>} */ motores: {} }
  try {
    const [rss, reddit] = await Promise.all([descargarFeeds(fetch), descargarReddit(fetch)])
    fallos.push(...rss.fallos, ...reddit.fallos)
    const titulares = await prepararTitulares([...rss.titulares, ...reddit.titulares], ahora)
    resumen.descargados = titulares.length
    resumen.nuevos = await insertarTitulares(db, titulares)
    const pendientes = await titularesSinPuntuar(db, ahora - VENTANA_PUNTUAR_MS, LOTE_LLM)
    const { resultados, fallos: fallosLlm } = await puntuarTitulares({ env, fetch, titulares: pendientes, monedas: leerMonedas(env.MONEDAS) })
    fallos.push(...fallosLlm)
    await guardarPuntuaciones(db, resultados)
    resumen.puntuados = pendientes.length
    for (const r of Object.values(resultados)) resumen.motores[r.motor] = (resumen.motores[r.motor] ?? 0) + 1
    await purgar(db, ahora)
    await finalizarEjecucion(db, id, { fin: Date.now(), ok: true, detalle: { fallos, ...resumen } })
    return { id, ok: true, fallos, ...resumen }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await finalizarEjecucion(db, id, { fin: Date.now(), ok: false, detalle: { fallos, error, ...resumen } })
    return { id, ok: false, fallos, error, ...resumen }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/noticias.test.js`
Expected: PASS — 8 tests, 0 fail.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: 0 fail (198 tests).

- [ ] **Step 8: Commit**

```bash
git add worker/src/config.js worker/src/repositorio.js worker/src/ejecuciones/noticias.js worker/test/noticias.test.js
git commit -m "feat(worker): cron de noticias con deduplicación, lote único al LLM y purga" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 8: Cron de mercado y análisis manual

**Files:**
- Modify: `worker/src/repositorio.js` (añadir al final)
- Create: `worker/src/ejecuciones/mercado.js`
- Test: `worker/test/mercado.test.js`

**Interfaces:**
- Consumes: `valorCartera`, `valorHodl`, `velaDeDecision`, `estadoInicial` (`core/bot.js`); `ESTRATEGIA_ACTIVA`, `estrategia` (`core/estrategias.js`); `ejecutarHora` (`core/hora.js`); `core/estrategia-v1.js` y `core/estrategia-v2.js` (tests); `leerMonedas`, `CAPITAL_POR_DEFECTO` (Task 7); `descargarMoneda`, `cambio24h`, `ultimoCierre`, `descargarDerivados`, `completarDerivados`, `descargarFng`, `Fng` (Task 3); `explicarSenales` (Task 5); del repositorio: `simulacionActiva`, `crearSimulacion`, `obtenerSimulacion`, `cargarEstado`, `guardarHodl`, `guardarPasoMoneda`, `guardarCapital` (Task 6), `iniciarEjecucion`, `finalizarEjecucion`, `titularesParaEstrategia` (Task 7); `crearEscenario`, `ahoraDe`, `entradasEn`, `servidasEn`, `fetchEscenario` (Task 6).
- Produces:
  - `repositorio.js` (nuevo): `guardarSenales(db, { simbolo, calculadaEn, vela1h, senal }[])` (1 lote de upserts), `senalesActuales(db): Promise<Record<simbolo, SenalCompleta>>`.
  - `ejecuciones/mercado.js`: `recogerDatos(fetch, monedas, ahora): Promise<{ entradas: EntradaMoneda[], fng: Fng|null, fallos }>`, `enriquecerSenal(senal, entrada, ahora, explicacion, parametrosBot): SenalCompleta`, `operar(db, { sim, est, entradas, titulares, fng, ahora }): Promise<{ senales, fallos, repetidas, operaciones }>`, `ejecutarMercado({ env, fetch, ahora, manual = false }): Promise<{ ejecucion: Ejecucion, senales: SenalCompleta[], repetidas: string[], operaciones: number, error? }>`. `detalle_json` de la ejecución: `{ fallos, repetidas, operaciones, simulacionId, fng }` (de ahí sale el F&G de `/api/resumen`).

- [ ] **Step 1: Write the failing test**

Create `worker/test/mercado.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { estadoInicial, velaDeDecision } from '../../core/bot.js'
import * as v1 from '../../core/estrategia-v1.js'
import * as v2 from '../../core/estrategia-v2.js'
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { ejecutarHora } from '../../core/hora.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { cargarEstado, crearSimulacion, obtenerSimulacion, senalesActuales } from '../src/repositorio.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, entradasEn, fetchEscenario, servidasEn } from './escenario.js'

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
  test('primera ejecución: crea la simulación activa con 10.000 € y la estrategia activa, y lo guarda todo', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    assert.equal(r.ejecucion.ok, true)
    const sim = await db.prepare('SELECT * FROM simulaciones').first()
    assert.equal(sim.estrategia_version, ESTRATEGIA_ACTIVA)
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
    assert.equal(detalle.fallos.filter((/** @type {string} */ f) => f.startsWith('derivados')).length, 5)
    await comprobarLibro(db)
  })

  test('hora a hora da exactamente lo mismo que core/hora.js en memoria (paridad con el backtest)', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    await crearSimulacion(db, { capitalInicial: 10_000, version: 'v1', ahora: 0 })
    let estado = estadoInicial(10_000)
    /** @type {Record<string, number>|null} */
    let hodl = null
    for (let k = 0; k < 8; k++) {
      const ahora = ahoraDe(k)
      const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      assert.deepEqual(r.repetidas, [])
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasEn(escenario, ahora), titulares: [], fng: 53, estrategia: v1,
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
      const decisiones = await filas(db, 'SELECT simbolo, motivo FROM decisiones WHERE vela_1h = ? ORDER BY id', velaDeDecision(ahora))
      assert.deepEqual(decisiones, memoria.decisiones.map((d) => ({ simbolo: d.simbolo, motivo: d.motivo })))
    }
    const motivos = await filas(db, 'SELECT simbolo, lado, motivo FROM operaciones ORDER BY id')
    assert.deepEqual(motivos.map((o) => `${o.simbolo}:${o.lado}:${o.motivo}`), [
      'BTC:compra:senal', 'ETH:compra:senal', 'BTC:venta:stop_loss', 'ETH:venta:take_profit', 'ETH:compra:senal', 'BTC:compra:senal',
    ])
    await comprobarLibro(db)
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
      await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
      const memoria = ejecutarHora({
        estado, hodl, capitalInicial: 10_000, ahora, monedas: entradasEn(escenario, ahora), titulares: [], fng: 53, estrategia: v2,
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
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
    const contar = async () => Promise.all(['decisiones', 'operaciones', 'posiciones', 'capital'].map(
      (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first('n'),
    ))
    const antes = [...await contar(), await db.prepare('SELECT saldo FROM simulaciones').first('saldo')]
    const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora + 60_000), ahora: ahora + 60_000 })
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
    const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahora), ahora })
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
    await ejecutarMercado({ env: entorno(base), fetch: fetchEscenario(escenario, despues), ahora: despues })
    const eth = await filas(base, "SELECT motivo FROM decisiones WHERE simbolo = 'ETH'")
    assert.deepEqual(eth.map((d) => d.motivo), ['abierta'])
    await comprobarLibro(base)
  })

  test('una moneda sin velas: SIN_DATOS registrado, las demás siguen y el capital se guarda', async () => {
    const db = crearD1()
    const escenario = crearEscenario()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(escenario, ahora, { caidas: ['SOLUSDT', 'SOLEUR'] })
    const r = await ejecutarMercado({ env: entorno(db, 'BTC,ETH,SOL'), fetch, ahora })
    assert.ok(r.ejecucion.fallos.includes('velas SOLUSDT 1h: HTTP 500'))
    assert.ok(r.ejecucion.fallos.includes('velas SOLEUR 1h: HTTP 500'))
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
    const premium = [{ symbol: 'BTCUSDT', lastFundingRate: '0.0006' }]
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora, { premium }), ahora })
    const btc = await db.prepare("SELECT veredicto, motivo, accion FROM decisiones WHERE simbolo = 'BTC'").first()
    assert.deepEqual(btc, { veredicto: 'MANTENER', motivo: 'contradiccion_tecnico_derivados', accion: 'ninguna' })
    const eth = await db.prepare("SELECT motivo FROM decisiones WHERE simbolo = 'ETH'").first('motivo')
    assert.equal(eth, 'abierta', 'ETH no tiene funding en la respuesta: derivados ausentes')
  })

  test('presupuesto §9 con 5 monedas: 34 subpeticiones externas y como mucho 17 llamadas a D1', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const fetch = fetchEscenario(crearEscenario(), ahora)
    const env = { ...entorno(db, 'BTC,ETH,SOL,BNB,XRP'), GROQ_API_KEY: 'g', GEMINI_API_KEY: 'k' }
    await ejecutarMercado({ env, fetch, ahora })
    assert.equal(fetch.llamadas.length, 20 + 11 + 1 + 2)
    assert.ok(db.llamadas <= 17, `${db.llamadas} llamadas a D1`)
  })
})

describe('ejecutarMercado (manual: POST /api/analizar)', () => {
  test('refresca las señales sin crear simulaciones ni operar', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
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
    const r = await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora, manual: true })
    assert.ok(r.senales.every((s) => s.veredicto === 'COMPRAR'), 'la señal es de compra y aun así no se abre nada')
    assert.deepEqual(await obtenerSimulacion(db, sim.id), sim)
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM decisiones').first('n'), 0)
    assert.equal(r.senales[0].orientativo?.stopLoss < r.senales[0].precioEur, true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/mercado.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/ejecuciones/mercado.js`.

- [ ] **Step 3: Extend the repository**

Append to the end of `worker/src/repositorio.js` (tras una línea en blanco):

```js
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
```

- [ ] **Step 4: Write the market run**

Create `worker/src/ejecuciones/mercado.js`:

```js
// @ts-check
// Cron `3 * * * *` (mercado y bot) y POST /api/analizar (solo señales; nunca opera). Spec §5 y §7.
// Subpeticiones externas con 5 monedas: 20 velas + 11 derivados + 1 Fear & Greed + hasta 2 LLM = 34.
// Llamadas a D1: como mucho 17 (5 de ellas, un lote atómico por moneda).
import { valorCartera, valorHodl, velaDeDecision } from '../../../core/bot.js'
import { ESTRATEGIA_ACTIVA, estrategia as obtenerEstrategia } from '../../../core/estrategias.js'
import { ejecutarHora } from '../../../core/hora.js'
import { HORA } from '../../../core/velas.js'
import { CAPITAL_POR_DEFECTO, leerMonedas } from '../config.js'
import { cambio24h, descargarMoneda, ultimoCierre } from '../fuentes/binance.js'
import { completarDerivados, descargarDerivados } from '../fuentes/derivados.js'
import { descargarFng } from '../fuentes/fng.js'
import { explicarSenales } from '../fuentes/llm.js'
import * as repo from '../repositorio.js'

/** @typedef {import('../../../core/hora.js').EntradaMoneda} EntradaMoneda */
/** @typedef {import('../../../core/hora.js').Estrategia} Estrategia */
/** @typedef {import('../../../core/hora.js').Senal} Senal */
/** @typedef {import('../fuentes/fng.js').Fng} Fng */

/** @param {unknown} e */
const mensaje = (e) => (e instanceof Error ? e.message : String(e))

/**
 * Velas, derivados y Fear & Greed en paralelo. Nada de esto lanza: lo que falla se anota.
 * @param {typeof fetch} fetch
 * @param {string[]} monedas
 * @param {number} ahora
 * @returns {Promise<{ entradas: EntradaMoneda[], fng: Fng|null, fallos: string[] }>}
 */
export async function recogerDatos(fetch, monedas, ahora) {
  const [porMoneda, derivados, fng] = await Promise.all([
    Promise.all(monedas.map((m) => descargarMoneda(fetch, m))),
    descargarDerivados(fetch, monedas),
    descargarFng(fetch).then((valor) => ({ valor, fallo: null }), (e) => ({ valor: null, fallo: `fng: ${mensaje(e)}` })),
  ])
  const fallos = [...porMoneda.flatMap((m) => m.fallos), ...derivados.fallos, ...(fng.fallo ? [fng.fallo] : [])]
  const entradas = porMoneda.map((m) => ({
    simbolo: m.simbolo,
    velas: m.velas,
    velasEur: m.velasEur,
    derivados: completarDerivados(derivados.base[m.simbolo], cambio24h(m.velas['1h'], ahora)),
  }))
  return { entradas, fng: fng.valor, fallos }
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
 * Paso horario del bot y persistencia: un lote atómico por moneda, después el punto de capital.
 * Si el lote de una moneda falla, las demás siguen: el saldo se mueve por deltas, así que lo que ya
 * entró es coherente y la moneda fallida se reintenta sola la hora siguiente (su progreso no avanzó).
 * @param {import('../repositorio.js').D1} db
 * @param {{ sim: import('../repositorio.js').FilaSimulacion, est: Estrategia, entradas: EntradaMoneda[],
 *   titulares: import('../../../core/estrategia-v1.js').Titular[], fng: Fng|null, ahora: number }} datos
 */
export async function operar(db, { sim, est, entradas, titulares, fng, ahora }) {
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  const repetidas = []
  let operaciones = 0
  const { estado, hodl } = await repo.cargarEstado(db, sim, est.PARAMETROS_BOT)
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
      else fallos.push(`bot ${decision.simbolo}: ${mensaje(e)}`)
    }
  }

  /** @type {Record<string, number>} */
  const precios = {}
  for (const e of entradas) {
    const p = ultimoCierre(e.velasEur, ahora)
    if (p !== null) precios[e.simbolo] = p
  }
  const simFinal = /** @type {import('../repositorio.js').FilaSimulacion} */ (await repo.obtenerSimulacion(db, sim.id))
  const { estado: final } = await repo.cargarEstado(db, simFinal, est.PARAMETROS_BOT)
  const sinPrecio = Object.keys(final.posiciones).filter((s) => !(s in precios))
  if (sinPrecio.length > 0) {
    fallos.push(`capital: sin precio EUR de ${sinPrecio.join(', ')}`)
  } else {
    const hodlFinal = hora.hodl
    await repo.guardarCapital(db, {
      simulacionId: sim.id,
      vela: velaDeDecision(ahora),
      valorCartera: valorCartera(final, precios),
      saldo: final.saldo,
      valorHodl: hodlFinal && Object.keys(hodlFinal).every((s) => s in precios) ? valorHodl(hodlFinal, precios) : null,
    })
  }
  return { senales: hora.senales, fallos, repetidas, operaciones }
}

/**
 * @param {{ env: { DB: import('../repositorio.js').D1, MONEDAS?: string } & import('../fuentes/llm.js').EntornoLlm,
 *   fetch: typeof fetch, ahora: number, manual?: boolean }} deps
 *   manual: true para POST /api/analizar (refresca señales; nunca crea simulaciones ni opera).
 */
export async function ejecutarMercado({ env, fetch, ahora, manual = false }) {
  const db = env.DB
  const tipo = manual ? 'manual' : 'mercado'
  const id = await repo.iniciarEjecucion(db, tipo, ahora)
  /** @type {string[]} */
  const fallos = []
  /** @type {string[]} */
  let repetidas = []
  try {
    const monedas = leerMonedas(env.MONEDAS)
    let sim = await repo.simulacionActiva(db)
    if (!sim && !manual) sim = await repo.crearSimulacion(db, { capitalInicial: CAPITAL_POR_DEFECTO, version: ESTRATEGIA_ACTIVA, ahora })
    const est = obtenerEstrategia(sim?.estrategia_version ?? ESTRATEGIA_ACTIVA)
    const datos = await recogerDatos(fetch, monedas, ahora)
    fallos.push(...datos.fallos)
    const titulares = await repo.titularesParaEstrategia(db, ahora - 24 * HORA, ahora)
    const fngValor = datos.fng?.valor ?? null
    /** @type {Senal[]} */
    let senales
    let operaciones = 0
    if (manual || !sim) {
      senales = datos.entradas.map((e) => est.calcularSenal({
        simbolo: e.simbolo, ahora, velas: e.velas, derivados: e.derivados, titulares, fng: fngValor,
      }))
    } else {
      const r = await operar(db, { sim, est, entradas: datos.entradas, titulares, fng: datos.fng, ahora })
      senales = r.senales
      fallos.push(...r.fallos)
      repetidas = r.repetidas
      operaciones = r.operaciones
    }
    // El LLM va después del bot: si tarda o falla, las operaciones ya están guardadas.
    const { textos, fallos: fallosLlm } = await explicarSenales({ env, fetch, senales })
    fallos.push(...fallosLlm)
    const enriquecidas = senales.map((s, i) => enriquecerSenal(s, datos.entradas[i], ahora, textos[s.simbolo], est.PARAMETROS_BOT))
    await repo.guardarSenales(db, enriquecidas.map((s) => ({
      simbolo: s.simbolo, calculadaEn: ahora, vela1h: s.vela1h ?? velaDeDecision(ahora), senal: s,
    })))
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, {
      fin, ok: true, detalle: { fallos, repetidas, operaciones, simulacionId: sim?.id ?? null, fng: datos.fng },
    })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: true, fallos }, senales: enriquecidas, repetidas, operaciones }
  } catch (e) {
    const error = mensaje(e)
    const fin = Date.now()
    await repo.finalizarEjecucion(db, id, { fin, ok: false, detalle: { fallos, repetidas, error } })
    return { ejecucion: { id, tipo, inicio: ahora, fin, ok: false, fallos }, senales: [], repetidas, operaciones: 0, error }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/mercado.test.js`
Expected: PASS — 10 tests, 0 fail. El test de paridad recorre 8 horas y compara, hora a hora, el estado reconstruido desde D1, el HODL, el punto de capital y los motivos con `ejecutarHora` en memoria (lo mismo que hace el backtest); el de v2 hace lo mismo con una simulación `v2`.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: 0 fail (208 tests).

- [ ] **Step 7: Commit**

```bash
git add worker/src/repositorio.js worker/src/ejecuciones/mercado.js worker/test/mercado.test.js
git commit -m "feat(worker): cron de mercado idéntico al backtest, idempotente y con análisis manual" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 9: API con PIN, bloqueo y CORS

**Files:**
- Modify: `worker/src/repositorio.js` (añadir al final)
- Create: `worker/src/auth.js`
- Create: `worker/src/api.js`
- Test: `worker/test/api.test.js`

**Interfaces:**
- Consumes: `ESTRATEGIA_ACTIVA` (`core/estrategias.js`), `calcularMetricas`, `metricasPorMoneda` (`core/metricas.js`), `HORA`, `velaDeDecision`; `leerMonedas` (Task 7); `ejecutarMercado` (Task 8); del repositorio: `simulacionActiva`, `obtenerSimulacion`, `listarSimulaciones`, `crearSimulacion` (Task 6), `ultimaEjecucion`, `insertarTitulares`, `guardarPuntuaciones` (Task 7), `senalesActuales` (Task 8); `crearEscenario`, `ahoraDe`, `fetchEscenario` (Task 6); `simularFetch` (Task 3).
- Produces:
  - `repositorio.js` (nuevo): `ultimoFng(db): Promise<Fng|null>`, `resumenBot(db, simulacionId): Promise<{ capital: fila|null, abiertas: number }>`, `datosBot(db, simulacionId): Promise<{ abiertas, precios: Record<simbolo, number>, operaciones, curva }>` (1 lote), `titularesDeMoneda(db, simbolo, desde, hasta, limite)`, `pagina(db, 'decisiones'|'operaciones', { simulacionId, simbolo, cursor, limite }): Promise<{ filas, siguienteCursor }>`.
  - `auth.js`: `MAX_FALLOS = 5`, `BLOQUEO_MS = 15 min`, `compararSeguro(a, b): Promise<boolean>`, `ipDe(peticion)`, `pinDe(peticion)`, `verificarPin(db, peticion, pinEsperado, ahora): Promise<{ ok: true } | { ok: false, estado, cuerpo }>`, `leerOrigenes(texto)`, `cabecerasCors(origen, permitidos)`.
  - `api.js`: `atender(peticion: Request, { env, fetch, ahora }): Promise<Response>` (nunca lanza), `ErrorApi`, constantes `TAMANO_PAGINA = 50`, `DECISIONES_MONEDA = 48`, `TITULARES_MONEDA = 50`, `ESPERA_ANALIZAR_MS`, `MARGEN_SALUD_MS`, `DATOS_VIEJOS_MS`, `CURVA_HORARIA_MS`, `CAPITAL_MINIMO = 100`, `CAPITAL_MAXIMO = 1_000_000`, conversores `aSimulacion`, `aSenalResumen`, `aDecision`, `aOperacion`, `aPosicion`, `aTitular`, y `primeraFrase`, `submuestrearCurva`. Las formas exactas son las del «Contrato de la API».

- [ ] **Step 1: Write the failing test**

Create `worker/test/api.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { velaDeDecision } from '../../core/bot.js'
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { HORA } from '../../core/velas.js'
import { ESPERA_ANALIZAR_MS, TAMANO_PAGINA, atender, primeraFrase, submuestrearCurva } from '../src/api.js'
import { BLOQUEO_MS, compararSeguro } from '../src/auth.js'
import { ejecutarMercado } from '../src/ejecuciones/mercado.js'
import { crearSimulacion, guardarPuntuaciones, insertarTitulares } from '../src/repositorio.js'
import { simularFetch } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario } from './escenario.js'

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
 *   fetch?: typeof fetch }} [op]
 */
async function pedir(db, ruta, { metodo = 'GET', pin = PIN, origen = ORIGEN, ip = '1.2.3.4', cuerpo, ahora = ahoraDe(6), fetch } = {}) {
  /** @type {Record<string, string>} */
  const cabeceras = { Origin: origen, 'CF-Connecting-IP': ip }
  if (pin !== null) cabeceras.Authorization = `Bearer ${pin}`
  const peticion = new Request(`https://oracle.workers.dev${ruta}`, {
    method: metodo, headers: cabeceras, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
  const res = await atender(peticion, {
    env: entorno(db), fetch: fetch ?? fetchEscenario(crearEscenario(), ahora), ahora,
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
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(escenario, ahoraDe(k)), ahora: ahoraDe(k) })
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
    await ejecutarMercado({ env: entorno(db), fetch: fetchEscenario(crearEscenario(), ahora), ahora })
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
    assert.deepEqual(Object.keys(r.cuerpo), ['ahora', 'senales', 'fng', 'bot', 'ultimaEjecucion', 'ultimaNoticias', 'datosDesactualizados'])
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
      id: 1, creadaEn: 0, cerradaEn: null, activa: true, estrategiaVersion: 'v1', capitalInicial: 10_000, saldo: r.cuerpo.simulacion.saldo,
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

  test('POST /api/bot/reiniciar exige confirmar y un capital válido; cierra la activa y abre otra', async () => {
    const db = await conDatos()
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000 } })).estado, 400)
    assert.equal((await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 50, confirmar: true } })).estado, 400)
    const r = await pedir(db, '/api/bot/reiniciar', { metodo: 'POST', cuerpo: { capital_inicial: 5000, confirmar: true }, ahora: 777 })
    assert.equal(r.estado, 201)
    assert.deepEqual(r.cuerpo, {
      simulacion: { id: 2, creadaEn: 777, cerradaEn: null, activa: true, estrategiaVersion: ESTRATEGIA_ACTIVA, capitalInicial: 5000, saldo: 5000 },
    })
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/api.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/api.js`.

- [ ] **Step 3: Extend the repository**

Append to the end of `worker/src/repositorio.js` (tras una línea en blanco):

```js
// ── Lecturas de la API ───────────────────────────────────────────────────────

/** Último Fear & Greed guardado por una ejecución de mercado o manual. @param {D1} db */
export async function ultimoFng(db) {
  const fila = await db.prepare(
    `SELECT detalle_json FROM ejecuciones WHERE tipo IN ('mercado', 'manual') AND json_extract(detalle_json, '$.fng') IS NOT NULL
     ORDER BY inicio DESC, id DESC LIMIT 1`,
  ).first()
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
 * Todo lo que necesita GET /api/bot (1 llamada): posiciones abiertas, último precio EUR visto por
 * moneda (el de su última decisión con precio), operaciones y curva de capital completa.
 * @param {D1} db @param {number} simulacionId
 */
export async function datosBot(db, simulacionId) {
  const [abiertas, precios, operaciones, curva] = await db.batch([
    db.prepare("SELECT * FROM posiciones WHERE simulacion_id = ? AND estado = 'abierta' ORDER BY id").bind(simulacionId),
    db.prepare(
      `SELECT d.simbolo, d.precio FROM decisiones d
       JOIN (SELECT simbolo, MAX(vela_1h) AS vela FROM decisiones WHERE simulacion_id = ? AND precio IS NOT NULL GROUP BY simbolo) u
         ON u.simbolo = d.simbolo AND u.vela = d.vela_1h
       WHERE d.simulacion_id = ?`,
    ).bind(simulacionId, simulacionId),
    db.prepare('SELECT lado, simbolo, comision, deslizamiento, pnl_neto FROM operaciones WHERE simulacion_id = ? ORDER BY id')
      .bind(simulacionId),
    db.prepare('SELECT vela_1h, valor_cartera, saldo, valor_hodl FROM capital WHERE simulacion_id = ? ORDER BY vela_1h')
      .bind(simulacionId),
  ])
  return {
    abiertas: abiertas.results,
    precios: /** @type {Record<string, number>} */ (Object.fromEntries(precios.results.map((p) => [p.simbolo, p.precio]))),
    operaciones: operaciones.results,
    curva: curva.results,
  }
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
  const { results } = await db.prepare(
    `SELECT * FROM ${tabla} WHERE simulacion_id = ? AND (? IS NULL OR simbolo = ?) AND (? IS NULL OR id < ?)
     ORDER BY id DESC LIMIT ?`,
  ).bind(simulacionId, simbolo, simbolo, cursor, cursor, limite + 1).all()
  const filas = results.slice(0, limite)
  return { filas, siguienteCursor: results.length > limite ? filas[filas.length - 1].id : null }
}
```

- [ ] **Step 4: Write `auth.js`**

Create `worker/src/auth.js`:

```js
// @ts-check
// PIN único (Authorization: Bearer <PIN>) comparado en tiempo constante, con bloqueo por IP,
// y CORS solo para los orígenes de la var ORIGENES. El origen no es la seguridad: lo es el PIN.

export const MAX_FALLOS = 5
export const BLOQUEO_MS = 15 * 60_000

/**
 * Compara los SHA-256 de ambos textos con XOR acumulado: mismo tiempo sea cual sea la diferencia
 * y sin delatar la longitud del PIN.
 * @param {string} a @param {string} b
 */
export async function compararSeguro(a, b) {
  const codificador = new TextEncoder()
  const [ha, hb] = await Promise.all([a, b].map((x) => crypto.subtle.digest('SHA-256', codificador.encode(x))))
  const x = new Uint8Array(ha)
  const y = new Uint8Array(hb)
  let diferencia = 0
  for (let i = 0; i < x.length; i++) diferencia |= x[i] ^ y[i]
  return diferencia === 0
}

/** @param {Request} peticion */
export const ipDe = (peticion) => peticion.headers.get('CF-Connecting-IP') ?? 'desconocida'

/** @param {Request} peticion */
export function pinDe(peticion) {
  const m = /^Bearer\s+(.+)$/i.exec(peticion.headers.get('Authorization') ?? '')
  return m ? m[1].trim() : ''
}

/**
 * @typedef {{ ok: true } | { ok: false, estado: number, cuerpo: { error: string, detalle: string, hasta?: number } }} ResultadoPin
 */

/** @param {number} hasta @returns {ResultadoPin} */
const bloqueado = (hasta) => ({
  ok: false, estado: 429, cuerpo: { error: 'bloqueado', detalle: 'Demasiados intentos con PIN incorrecto. Espera y vuelve a probar.', hasta },
})

/**
 * Sin bloqueo: compara el PIN. Acierto → borra los fallos de la IP. Fallo → +1; al 5.º, bloqueo de 15 min.
 * Con bloqueo vigente ni siquiera compara. Como mucho 2 llamadas a D1.
 * @param {import('./repositorio.js').D1} db
 * @param {Request} peticion
 * @param {string|undefined} pinEsperado secret ORACLE_PIN
 * @param {number} ahora
 * @returns {Promise<ResultadoPin>}
 */
export async function verificarPin(db, peticion, pinEsperado, ahora) {
  if (!pinEsperado) return { ok: false, estado: 500, cuerpo: { error: 'configuracion', detalle: 'ORACLE_PIN no está configurado.' } }
  const ip = ipDe(peticion)
  const fila = await db.prepare('SELECT fallos, bloqueado_hasta FROM intentos_pin WHERE ip = ?').bind(ip).first()
  if (fila?.bloqueado_hasta && fila.bloqueado_hasta > ahora) return bloqueado(fila.bloqueado_hasta)
  if (await compararSeguro(pinDe(peticion), pinEsperado)) {
    if (fila) await db.prepare('DELETE FROM intentos_pin WHERE ip = ?').bind(ip).run()
    return { ok: true }
  }
  const fallos = (fila?.fallos ?? 0) + 1
  const hasta = fallos >= MAX_FALLOS ? ahora + BLOQUEO_MS : null
  await db.prepare(
    `INSERT INTO intentos_pin (ip, fallos, bloqueado_hasta) VALUES (?, ?, ?)
     ON CONFLICT (ip) DO UPDATE SET fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta`,
  ).bind(ip, hasta === null ? fallos : 0, hasta).run()
  if (hasta !== null) return bloqueado(hasta)
  return { ok: false, estado: 401, cuerpo: { error: 'pin_incorrecto', detalle: `PIN incorrecto. Quedan ${MAX_FALLOS - fallos} intentos.` } }
}

/** "https://a.io, http://localhost:8080" → lista. @param {string|undefined} texto */
export const leerOrigenes = (texto) => (texto ?? '').split(',').map((o) => o.trim()).filter(Boolean)

/**
 * Cabeceras CORS: solo se abren al origen si está en la lista exacta.
 * @param {string|null} origen
 * @param {string[]} permitidos
 * @returns {Record<string, string>}
 */
export function cabecerasCors(origen, permitidos) {
  if (!origen || !permitidos.includes(origen)) return { Vary: 'Origin' }
  return {
    'Access-Control-Allow-Origin': origen,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
```

- [ ] **Step 5: Write `api.js`**

Create `worker/src/api.js`:

```js
// @ts-check
// API JSON del Worker (spec §11). Contrato exacto de cada respuesta: sección «Contrato de la API» del plan 2.
// Precios e importes en €, porcentajes como fracción (0,05 = 5 %), instantes en ms desde epoch (UTC).
// No existe ninguna ruta que envíe órdenes a un exchange.
import { ESTRATEGIA_ACTIVA } from '../../core/estrategias.js'
import { calcularMetricas, metricasPorMoneda } from '../../core/metricas.js'
import { HORA } from '../../core/velas.js'
import { cabecerasCors, leerOrigenes, verificarPin } from './auth.js'
import { leerMonedas } from './config.js'
import { ejecutarMercado } from './ejecuciones/mercado.js'
import * as repo from './repositorio.js'

export const TAMANO_PAGINA = 50
export const DECISIONES_MONEDA = 48
export const TITULARES_MONEDA = 50
export const ESPERA_ANALIZAR_MS = 5 * 60_000
export const MARGEN_SALUD_MS = 2 * HORA
export const DATOS_VIEJOS_MS = 2 * HORA
export const CURVA_HORARIA_MS = 30 * 24 * HORA
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
 *   fetch: typeof fetch, ahora: number }} Deps
 * @typedef {Deps & { url: URL, peticion: Request, params: string[] }} Contexto
 * @typedef {{ estado?: number, cuerpo: unknown }} Respuesta
 */

// ── Conversión de filas a JSON de la API ────────────────────────────────────

/** @param {repo.FilaSimulacion} s */
export const aSimulacion = (s) => ({
  id: s.id, creadaEn: s.creada_en, cerradaEn: s.cerrada_en, activa: s.activa === 1,
  estrategiaVersion: s.estrategia_version, capitalInicial: s.capital_inicial, saldo: s.saldo,
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
 * @param {{ t: number, valor: number, saldo: number, hodl: number|null }[]} puntos ordenados por t
 */
export function submuestrearCurva(puntos) {
  if (puntos.length === 0) return []
  const corte = puntos[puntos.length - 1].t - CURVA_HORARIA_MS
  const dia = 24 * HORA
  return puntos.filter((p, i) => p.t >= corte || Math.floor(p.t / dia) !== Math.floor(puntos[i + 1].t / dia))
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

/** Simulación de ?simulacion= o, si no viene, la activa. @param {repo.D1} db @param {URL} url */
async function simulacionPedida(db, url) {
  const id = entero(url, 'simulacion')
  const sim = id === null ? await repo.simulacionActiva(db) : await repo.obtenerSimulacion(db, id)
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
async function resumen({ env, ahora }) {
  const db = env.DB
  const [guardadas, fng, sim, ultimaEjecucion, ultimaNoticias] = await Promise.all([
    repo.senalesActuales(db), repo.ultimoFng(db), repo.simulacionActiva(db),
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
  return { cuerpo: { ahora, senales, fng, bot, ultimaEjecucion, ultimaNoticias, datosDesactualizados } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function moneda({ env, ahora, params }) {
  const db = env.DB
  const simbolo = params[0].toUpperCase()
  if (!leerMonedas(env.MONEDAS).includes(simbolo)) throw new ErrorApi(404, 'no_encontrado', `Moneda no seguida: ${simbolo}`)
  const [guardadas, sim] = await Promise.all([repo.senalesActuales(db), repo.simulacionActiva(db)])
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
async function bot({ env, url }) {
  const sim = await simulacionPedida(env.DB, url)
  const d = await repo.datosBot(env.DB, sim.id)
  const abiertas = d.abiertas.map((p) => aPosicion(p, d.precios[p.simbolo] ?? p.precio_entrada))
  const operaciones = d.operaciones.map((o) => ({
    tipo: o.lado, simbolo: o.simbolo, comision: o.comision, deslizamiento: o.deslizamiento, pnlNeto: o.pnl_neto ?? undefined,
  }))
  const curva = d.curva.map((c) => ({ t: c.vela_1h, valor: c.valor_cartera, saldo: c.saldo, hodl: c.valor_hodl }))
  const metricas = calcularMetricas({
    capitalInicial: sim.capital_inicial, saldo: sim.saldo,
    abiertas: abiertas.map((p) => ({ unidades: p.unidades, coste: p.coste, precioActual: p.precioActual })),
    operaciones, curva,
  })
  return {
    cuerpo: {
      simulacion: aSimulacion(sim), metricas, porMoneda: metricasPorMoneda(operaciones), abiertas,
      curva: submuestrearCurva(curva), hodl: sim.hodl_json ? JSON.parse(sim.hodl_json) : null,
    },
  }
}

/** @param {'decisiones'|'operaciones'} tabla */
const paginada = (tabla) => /** @param {Contexto} c @returns {Promise<Respuesta>} */ async ({ env, url }) => {
  const sim = await simulacionPedida(env.DB, url)
  const { filas, siguienteCursor } = await repo.pagina(env.DB, tabla, {
    simulacionId: sim.id, simbolo: simboloOpcional(url), cursor: entero(url, 'cursor'), limite: TAMANO_PAGINA,
  })
  return { cuerpo: { items: filas.map(tabla === 'decisiones' ? aDecision : aOperacion), siguienteCursor } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function simulaciones({ env }) {
  return { cuerpo: { items: (await repo.listarSimulaciones(env.DB)).map(aSimulacion) } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function reiniciar({ env, ahora, peticion }) {
  const cuerpo = await cuerpoJson(peticion)
  if (cuerpo?.confirmar !== true) throw new ErrorApi(400, 'peticion_invalida', 'Falta confirmar: true')
  const capital = cuerpo.capital_inicial
  if (typeof capital !== 'number' || !Number.isFinite(capital) || capital < CAPITAL_MINIMO || capital > CAPITAL_MAXIMO) {
    throw new ErrorApi(400, 'peticion_invalida', `capital_inicial debe ser un número entre ${CAPITAL_MINIMO} y ${CAPITAL_MAXIMO}`)
  }
  const sim = await repo.crearSimulacion(env.DB, { capitalInicial: capital, version: ESTRATEGIA_ACTIVA, ahora })
  return { estado: 201, cuerpo: { simulacion: aSimulacion(sim) } }
}

/** @param {Contexto} c @returns {Promise<Respuesta>} */
async function analizar({ env, fetch, ahora }) {
  const previa = await repo.ultimaEjecucion(env.DB, ['manual'])
  if (previa && ahora - previa.inicio < ESPERA_ANALIZAR_MS) {
    throw new ErrorApi(429, 'demasiado_pronto', 'Solo se puede analizar una vez cada 5 minutos.', { hasta: previa.inicio + ESPERA_ANALIZAR_MS })
  }
  const r = await ejecutarMercado({ env, fetch, ahora, manual: true })
  if (!r.ejecucion.ok) throw new ErrorApi(502, 'analisis_fallido', r.error ?? 'El análisis falló')
  return { cuerpo: { senales: r.senales.map(aSenalResumen), ejecucion: r.ejecucion } }
}

/** @type {{ metodo: string, patron: RegExp, publica?: boolean, manejar: (c: Contexto) => Promise<Respuesta> }[]} */
const RUTAS = [
  { metodo: 'GET', patron: /^\/api\/salud$/, publica: true, manejar: salud },
  { metodo: 'GET', patron: /^\/api\/resumen$/, manejar: resumen },
  { metodo: 'GET', patron: /^\/api\/moneda\/([A-Za-z0-9]{2,10})$/, manejar: moneda },
  { metodo: 'GET', patron: /^\/api\/bot$/, manejar: bot },
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
    const r = await ruta.manejar({ ...deps, url, peticion, params })
    return responder(r.cuerpo, r.estado ?? 200)
  } catch (e) {
    if (e instanceof ErrorApi) return responder({ error: e.codigo, detalle: e.message, ...e.extra }, e.estado)
    return responder({ error: 'interno', detalle: e instanceof Error ? e.message : String(e) }, 500)
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/api.test.js`
Expected: PASS — 15 tests, 0 fail.

- [ ] **Step 7: Run the whole suite**

Run: `npm test`
Expected: 0 fail (223 tests).

- [ ] **Step 8: Commit**

```bash
git add worker/src/repositorio.js worker/src/auth.js worker/src/api.js worker/test/api.test.js
git commit -m "feat(worker): API JSON con PIN, bloqueo por IP, CORS y salud pública" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

### Task 10: Entrada del Worker, wrangler.toml y README

**Files:**
- Create: `worker/src/crones.js`
- Create: `worker/src/index.js`
- Create: `worker/wrangler.toml`
- Modify: `README.md` (añadir una sección al final)
- Test: `worker/test/index.test.js`

**Interfaces:**
- Consumes: `atender` (Task 9), `ejecutarNoticias` (Task 7), `ejecutarMercado` (Task 8); en tests `crearD1`, `simularFetch`, `crearEscenario`, `ahoraDe`, `fetchEscenario`.
- Produces:
  - `crones.js`: `CRON_NOTICIAS = '1 * * * *'`, `CRON_MERCADO = '3 * * * *'`, `programado(cron, { env, fetch, ahora }): Promise<…>` (rechaza un cron desconocido).
  - `index.js`: solo `export default { fetch(peticion, env), scheduled(evento, env, ctx) }`; `scheduled` usa `evento.scheduledTime` como `ahora` y `ctx.waitUntil`.
  - `wrangler.toml` según la resolución 3 del controlador (nombre `oracle`, `main = "src/index.js"`, 2 crons, D1 `DB` con `migrations_dir`, `[ai] binding = "AI"`, vars `MONEDAS`, `LLM_MODELO_CF`, `LLM_MODELO_GROQ`, `LLM_MODELO_GEMINI`, `ORIGENES`).

- [ ] **Step 1: Write the failing test**

Create `worker/test/index.test.js`:

```js
// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { CRON_MERCADO, CRON_NOTICIAS, programado } from '../src/crones.js'
import worker from '../src/index.js'
import { simularFetch } from './ayudantes.js'
import { crearD1 } from './d1.js'
import { ahoraDe, crearEscenario, fetchEscenario } from './escenario.js'

const WRANGLER = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8')

describe('index', () => {
  test('wrangler.toml declara exactamente los dos crons que atiende el Worker', () => {
    const crons = /crons = \[(.*)\]/.exec(WRANGLER)?.[1]
    assert.equal(crons, `"${CRON_NOTICIAS}", "${CRON_MERCADO}"`)
  })

  test('wrangler.toml: D1 como DB con migraciones, AI y las vars de la spec; sin KV ni secrets', () => {
    assert.match(WRANGLER, /^name = "oracle"$/m)
    assert.match(WRANGLER, /binding = "DB"\ndatabase_name = "oracle"/)
    assert.match(WRANGLER, /migrations_dir = "migrations"/)
    assert.match(WRANGLER, /\[ai\]\nbinding = "AI"/)
    for (const v of ['MONEDAS', 'LLM_MODELO_CF', 'LLM_MODELO_GROQ', 'LLM_MODELO_GEMINI', 'ORIGENES']) assert.match(WRANGLER, new RegExp(`^${v} = "`, 'm'))
    assert.doesNotMatch(WRANGLER, /kv_namespaces/)
    assert.doesNotMatch(WRANGLER, /^(ORACLE_PIN|GROQ_API_KEY|GEMINI_API_KEY) =/m)
  })

  test('programado: el minuto 1 son noticias y el 3 mercado; otro cron es un error', async () => {
    const db = crearD1()
    const ahora = ahoraDe(0)
    const noticias = /** @type {any} */ (await programado(CRON_NOTICIAS, { env: { DB: db }, fetch: simularFetch(() => ({ estado: 503, cuerpo: '' })), ahora }))
    assert.equal(noticias.ok, true)
    const mercado = /** @type {any} */ (await programado(CRON_MERCADO, { env: { DB: db, MONEDAS: 'BTC,ETH' }, fetch: fetchEscenario(crearEscenario(), ahora), ahora }))
    assert.equal(mercado.ejecucion.ok, true)
    const tipos = (await db.prepare('SELECT tipo FROM ejecuciones ORDER BY id').all()).results.map((f) => f.tipo)
    assert.deepEqual(tipos, ['noticias', 'mercado'])
    await assert.rejects(programado('*/5 * * * *', { env: { DB: db }, fetch: simularFetch(() => ({})), ahora }), /Cron desconocido/)
  })

  test('scheduled usa la hora programada como `ahora`, el fetch global y deja el trabajo en waitUntil', async () => {
    const db = crearD1()
    const original = globalThis.fetch
    const falso = simularFetch(() => ({ estado: 503, cuerpo: '' }))
    globalThis.fetch = falso // sin red en los tests
    try {
      /** @type {Promise<unknown>[]} */
      const pendientes = []
      worker.scheduled({ cron: CRON_NOTICIAS, scheduledTime: 1_792_357_260_000 }, { DB: db }, { waitUntil: (p) => pendientes.push(p) })
      assert.equal(pendientes.length, 1)
      await Promise.all(pendientes)
    } finally {
      globalThis.fetch = original
    }
    assert.equal(falso.llamadas.length, 17)
    assert.equal(await db.prepare('SELECT inicio FROM ejecuciones').first('inicio'), 1_792_357_260_000)
  })

  test('el módulo principal solo exporta el manejador por defecto (el runtime rechaza el resto)', async () => {
    assert.deepEqual(Object.keys(await import('../src/index.js')), ['default'])
  })

  test('fetch delega en la API', async () => {
    const res = await worker.fetch(new Request('https://oracle.workers.dev/api/salud'), { DB: crearD1() })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { ok: false, ultimaEjecucion: null })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/index.test.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` para `worker/src/crones.js`.

- [ ] **Step 3: Write `crones.js`**

Create `worker/src/crones.js`:

```js
// @ts-check
// Qué ejecución corresponde a cada cron de wrangler.toml. Vive fuera de index.js porque el módulo
// principal de un Worker solo puede exportar manejadores: cualquier otra exportación rompe el arranque.
import { ejecutarMercado } from './ejecuciones/mercado.js'
import { ejecutarNoticias } from './ejecuciones/noticias.js'

export const CRON_NOTICIAS = '1 * * * *'
export const CRON_MERCADO = '3 * * * *'

/**
 * @param {string} cron expresión del trigger que ha saltado
 * @param {{ env: any, fetch: typeof fetch, ahora: number }} deps
 */
export function programado(cron, deps) {
  if (cron === CRON_NOTICIAS) return ejecutarNoticias(deps)
  if (cron === CRON_MERCADO) return ejecutarMercado(deps)
  return Promise.reject(new Error(`Cron desconocido: ${cron}`))
}
```

- [ ] **Step 4: Write `index.js`**

Create `worker/src/index.js`:

```js
// @ts-check
// Worker de ORACLE: API (fetch) y dos crons (scheduled). Simulación: no envía órdenes a ningún exchange.
// Solo export default: el runtime rechaza cualquier otra exportación del módulo principal.
import { atender } from './api.js'
import { programado } from './crones.js'

// fetch global envuelto: pasarlo suelto dentro de un objeto puede dar «Illegal invocation» en Workers.
/** @type {typeof fetch} */
const fetchGlobal = (entrada, init) => fetch(entrada, init)

export default {
  /** @param {Request} peticion @param {any} env */
  fetch(peticion, env) {
    return atender(peticion, { env, fetch: fetchGlobal, ahora: Date.now() })
  },

  /**
   * `ahora` = hora programada (hh:01 o hh:03), no la de arranque: así un retraso del cron no cambia la vela.
   * @param {{ cron: string, scheduledTime: number }} evento @param {any} env @param {{ waitUntil: (p: Promise<unknown>) => void }} ctx
   */
  scheduled(evento, env, ctx) {
    ctx.waitUntil(programado(evento.cron, { env, fetch: fetchGlobal, ahora: evento.scheduledTime }))
  },
}
```

- [ ] **Step 5: Write `wrangler.toml`**

Create `worker/wrangler.toml` (el `database_id` de ceros se sustituye al desplegar; ver «Checklist de despliegue»):

```toml
# ORACLE · Worker de análisis y paper trading. Simulación: no envía órdenes a ningún exchange.
name = "oracle"
main = "src/index.js"
compatibility_date = "2026-10-01"
workers_dev = true
preview_urls = false

# 2 de los 5 crons de la cuenta (spec §9): noticias en el minuto 1, mercado y bot en el 3.
[triggers]
crons = ["1 * * * *", "3 * * * *"]

# El id real lo imprime `npx wrangler@4 d1 create oracle` y se pega aquí al desplegar.
[[d1_databases]]
binding = "DB"
database_name = "oracle"
database_id = "00000000-0000-0000-0000-000000000000"
migrations_dir = "migrations"

# Workers AI: primer LLM de la cascada (cuota gratuita de 10.000 neuronas/día por cuenta).
[ai]
binding = "AI"

[vars]
MONEDAS = "BTC,ETH,SOL,BNB,XRP"
LLM_MODELO_CF = "@cf/meta/llama-3.1-8b-instruct-fp8"
LLM_MODELO_GROQ = "llama-3.3-70b-versatile"
LLM_MODELO_GEMINI = "gemini-flash-latest"
ORIGENES = "https://jcaboroca.github.io,http://localhost:8080"

# Secrets (nunca en este archivo):
#   npx wrangler@4 secret put ORACLE_PIN
#   npx wrangler@4 secret put GROQ_API_KEY     (opcional)
#   npx wrangler@4 secret put GEMINI_API_KEY   (opcional)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --disable-warning=ExperimentalWarning --test worker/test/index.test.js`
Expected: PASS — 6 tests, 0 fail.

- [ ] **Step 7: Update the README**

En `README.md`, sustituye la línea `Node ≥ 22. Sin dependencias.` por:

```markdown
Node ≥ 22.13 (los tests del Worker usan `node:sqlite`). Sin dependencias.
```

Append to the end of `README.md` (tras una línea en blanco):

```markdown
## Worker (Cloudflare)

`worker/` es el servicio 24/7: dos crons (minuto 1, noticias; minuto 3, mercado y bot), D1 como
base de datos y una API JSON protegida por PIN para la PWA. Usa exactamente el mismo
`core/hora.js` que el backtest, con la estrategia guardada en cada simulación.

- Fuentes: velas de `data-api.binance.vision` (USDT para indicadores, EUR para el bot), derivados
  de Binance Futures (opcionales), Fear & Greed de alternative.me, 14 RSS y Reddit (best-effort).
- Titulares puntuados por un LLM en cascada: Workers AI → Groq → Gemini → léxico local
  (`core/lexico.js`). Se guarda qué motor puntuó cada titular.
- Cada moneda se guarda en un único lote atómico de D1: repetir una hora no duplica nada.
- Los tests del Worker corren con `npm test`, sin red: D1 se simula con `node:sqlite`
  (Node ≥ 22.13) y las fuentes con respuestas reales grabadas en `test/fixtures/`.
- Despliegue con `npx wrangler@4` desde `worker/`: pasos en la «Checklist de despliegue» de
  [docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md](docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md).
  Secrets: `ORACLE_PIN` y, opcionales, `GROQ_API_KEY` y `GEMINI_API_KEY`.

No existe ninguna ruta que envíe órdenes a un exchange: es una simulación.
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: 0 fail (229 tests al escribir este plan: 125 de `core` + 11 del léxico + 93 del Worker).

- [ ] **Step 9: Check that the Worker bundles (optional, needs network)**

Run: `cd worker && npx wrangler@4 deploy --dry-run --outdir ../.wrangler-dist; cd .. && rm -rf .wrangler-dist`
Expected: lista los bindings `env.DB (oracle)`, `env.AI` y las 5 vars, «Total Upload» ≈ 88 KiB y `--dry-run: exiting now.` No despliega nada.

- [ ] **Step 10: Commit**

```bash
git add worker/src/crones.js worker/src/index.js worker/wrangler.toml worker/test/index.test.js README.md
git commit -m "feat(worker): entrada del Worker, wrangler.toml con 2 crons, D1 y AI, y README" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Checklist de despliegue (fuera de este plan; lo hace el usuario)

Desde `worker/`, con la cuenta de Cloudflare compartida (comprueba antes en el panel que quedan al menos 2 de los 5 crons de la cuenta libres):

```bash
cd worker
npx wrangler@4 login
npx wrangler@4 d1 create oracle                       # copia el database_id que imprime en wrangler.toml
npx wrangler@4 d1 migrations apply oracle --remote
npx wrangler@4 secret put ORACLE_PIN
npx wrangler@4 secret put GROQ_API_KEY                # opcional
npx wrangler@4 secret put GEMINI_API_KEY              # opcional
npx wrangler@4 deploy
curl -s https://oracle.<subdominio>.workers.dev/api/salud    # 503 hasta el primer cron de mercado (hh:03), luego 200
```

Prueba local antes de desplegar (`wrangler dev` exige `wrangler login` porque el binding AI siempre es remoto y gasta neuronas reales; la D1 sí es local):

```bash
cd worker
npx wrangler@4 d1 migrations apply oracle --local
printf 'ORACLE_PIN=1234\n' > .dev.vars                # ignorado por git
npx wrangler@4 dev --test-scheduled
# en otra terminal:
curl "http://localhost:8787/__scheduled?cron=1+*+*+*+*"     # noticias
curl "http://localhost:8787/__scheduled?cron=3+*+*+*+*"     # mercado y bot
curl -H "Authorization: Bearer 1234" http://localhost:8787/api/resumen
curl -X POST -H "Authorization: Bearer 1234" http://localhost:8787/api/analizar
```

Tras desplegar, revisa en el panel de Workers → oracle → Logs una ejecución de cada cron (CPU por invocación: límite de 10 ms en el plan gratuito, no medible en local) y las ejecuciones guardadas: `npx wrangler@4 d1 execute oracle --remote --command "SELECT tipo, ok, detalle_json FROM ejecuciones ORDER BY id DESC LIMIT 4"`.

## Cobertura de la spec

| Spec | Dónde |
|---|---|
| §3 estructura del Worker | File Structure; Tasks 2-10 (+ `config.js`, `crones.js`, decisión 12) |
| §4 fuentes (mirror binance.vision, fapi opcional, alternative.me, 14 RSS, Reddit best-effort, LLM) | Tasks 3, 4, 5; decisiones 7-9 |
| §5 cron de noticias (paralelo, dedupe por hash, > 48 h fuera, solo nuevos, un lote al LLM, motor guardado) | Task 7 |
| §5 cron de mercado y análisis manual (nunca opera, 5 min) | Tasks 8 y 9; decisiones 5-6 |
| §7.2-7.4 bot (vía `ejecutarHora` de `core`, stops con velas perdidas, enfriamiento, `fuera_de_ventana` de v2) | Tasks 6 y 8 (paridad hora a hora con v1 y con v2) |
| §7.5 idempotencia y atomicidad | Tasks 6 y 8; decisiones 1-2 |
| §7.6 simulaciones, reinicio sin borrar, HODL | Tasks 6, 8, 9 |
| §7.7 métricas por simulación y moneda | Task 9 (`GET /api/bot`, `core/metricas.js`) |
| §9 presupuesto (subpeticiones, D1, sin KV, 2 crons, regex) | «Presupuesto por invocación»; test de presupuesto (Task 8); Task 10 |
| §10 esquema, reconstrucción del estado, purga | Tasks 2, 6, 7; decisión 3 |
| §11 API, PIN en tiempo constante, bloqueo, CORS, sin órdenes | Task 9; «Contrato de la API» |
| §12 lo que necesita la PWA | «Contrato de la API» (precio €, 24 h, frase, F&G, frescura, T/D/N/F con ausentes, titulares con motor, historial de decisiones, SL/TP orientativos, métricas por moneda, simulaciones) |
| §13 errores (SIN_DATOS, ausentes, léxico/plantilla, D1 reintentable, JSON `{error, detalle}`) | Tasks 3, 5, 8, 9 |
| §14 pruebas sin red con fixtures reales, idempotencia, API | Tasks 2-10 (D1 sobre `node:sqlite` en lugar de Miniflare, resolución 2) |
| Arrastres del plan 1 (validar filas de Binance, `hodl_json`, progreso ausente, `pnl_neto`, `coste`, enfriamiento desde `PARAMETROS_BOT`, motivo de contradicción en `decisiones.motivo`) | Tasks 3, 6, 8 |

Desviaciones de la spec, todas justificadas arriba: Reddit por Atom (8), OI con 25 puntos (9), bot antes que el LLM (5), CORS por lista exacta (11), `titulares.motor` admite `cf` (7), archivos `config.js` y `crones.js` (12), `GET /api/salud` (11), purga de bloqueos caducados (13), punto de capital omitido si falta el precio EUR de una moneda con posición abierta (4), `engines` ≥ 22.13 (Task 2).

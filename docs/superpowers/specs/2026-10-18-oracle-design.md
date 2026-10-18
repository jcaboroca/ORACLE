# ORACLE — Diseño

Fecha: 2026-10-18 · Estado: aprobado en brainstorming, pendiente de revisión escrita

Asistente de trading **solo crypto** que analiza gráficos, tendencias, noticias, rumores
y ánimo del mercado, emite un consejo (COMPRAR / MANTENER / VENDER) explicado, y ejecuta
un **bot de paper trading autónomo 24/7** con dinero virtual para medir si la estrategia
gana o pierde frente a comprar y mantener.

> ORACLE es una simulación. No ejecuta órdenes reales, no es asesoramiento financiero y
> sus señales no son garantía de beneficio. Este aviso es visible siempre en la interfaz.

## 1. Origen

Sustituye a dos proyectos previos que no acababan de cuadrar:

| Proyecto | Qué se aprovecha | Qué se descarta |
|---|---|---|
| CryptoSentiment (iOS) | Lectura multi-timeframe 1H/4H/1D, tendencia EMA20/50 con umbral ±2 %, stops por ATR, alineación de timeframes | "Sentiment" inexistente, métricas no respaldadas |
| CryptoTrade (web) | Pesos de puntuación 60/25/15, derivados de Binance, ~14 feeds RSS, LLM Groq/Gemini con fallback local, idea de backtest | FastAPI+React+SQLite sobredimensionado, 4 despliegues contradictorios, precios sintéticos de fallback |

## 2. Requisitos

### Funcionales
- Analizar BTC, ETH, SOL, BNB y XRP cada hora (lista configurable).
- Consejo por moneda con veredicto, índice de confianza, desglose de componentes y
  explicación en español.
- Bot de paper trading autónomo 24/7, capital virtual configurable (por defecto 10.000 €).
- Historial completo de decisiones (incluidos HOLD y oportunidades no ejecutadas),
  operaciones, curva de capital y comparación con comprar y mantener.
- Backtest de la estrategia con el mismo motor, sin información futura.
- Acceso desde cualquier dispositivo, protegido por PIN, para un único usuario.

### Restricciones
- Solo posiciones largas al contado. Prohibidos apalancamiento, cortos y saldo negativo.
- Ninguna clave API con permisos de trading. Ningún endpoint que envíe órdenes reales.
- Nunca precios inventados o sintéticos.
- Infraestructura gratuita, compartida con otros Workers de la misma cuenta de Cloudflare:
  ORACLE no puede poner en riesgo sus cuotas (ver §9).

### Criterio de éxito
Medir rentabilidad neta de costes, drawdown máximo, frecuencia de operaciones y
rendimiento frente a comprar y mantener. Ajustar la estrategia con datos, no a ojo.

## 3. Arquitectura

Stack habitual del autor (SolarMonitor, Mundialisimo, Bajamar): PWA vanilla JS sin build en
GitHub Pages + Cloudflare Worker + tests con `node --test`.

```
ORACLE/                       PWA en jcaboroca.github.io/ORACLE
├─ index.html, styles.css, sw.js, manifest.webmanifest
├─ js/                        interfaz: vistas, cliente API, gráficos
├─ vendor/                    lightweight-charts (TradingView, Apache-2.0, con atribución)
├─ core/                      lógica pura sin red ni E/S, compartida por Worker, backtest y tests
│  ├─ indicadores.js          EMA, SMA, RSI (Wilder), MACD, Bollinger, ATR
│  ├─ velas.js                normalización, filtrado de velas cerradas, frescura
│  ├─ estrategia-v1.js        parámetros y puntuación → señal
│  ├─ estrategia-v2.js        v1 + filtro de régimen y decisión diaria (§6.6)
│  ├─ estrategias.js          registro de versiones y ESTRATEGIA_ACTIVA
│  ├─ bot.js                  transición de estado de la cartera (puro: estado + velas + señal → acciones)
│  ├─ metricas.js             rentabilidad, drawdown, ganadoras/perdedoras, HODL…
│  ├─ hora.js                 paso horario compartido (Worker y backtest)
│  └─ lexico.js               análisis de titulares sin IA (fallback; se crea en el plan 2)
├─ worker/
│  ├─ wrangler.toml           2 crons, binding D1, vars; secrets aparte
│  ├─ migrations/             esquema D1
│  └─ src/
│     ├─ index.js             fetch (API) + scheduled (crons)
│     ├─ api.js, auth.js
│     ├─ ejecuciones/         noticias.js, mercado.js
│     ├─ fuentes/             binance.js, derivados.js, fng.js, rss.js, reddit.js, llm.js
│     └─ repositorio.js       todas las consultas D1
├─ scripts/
│  ├─ backtest.mjs            npm run backtest [-- --estrategia vN] → data/backtest-vN.json
│  └─ servir.mjs              servidor estático local
├─ data/backtest-v1.json, data/backtest-v2.json
└─ test/
```

`core/` no importa nada de red ni de D1: recibe datos y devuelve resultados. Así el
mismo código se ejecuta en el Worker, en el backtest y en los tests.

## 4. Fuentes de datos

| Fuente | Endpoint | Clave | Uso |
|---|---|---|---|
| Velas USDT (indicadores) | `data-api.binance.vision/api/v3/klines` `{SYM}USDT` 1h/4h/1d, 500 velas | No | Señal |
| Velas EUR (ejecución) | ídem `{SYM}EUR` 1h | No | Precios del bot, stops, valoración |
| Funding | `fapi.binance.com/fapi/v1/premiumIndex` (todas en 1 llamada) | No | Derivados |
| Long/short | `fapi.binance.com/futures/data/globalLongShortAccountRatio` 1h | No | Derivados |
| Open interest | `fapi.binance.com/futures/data/openInterestHist` 1h, 24 puntos | No | Derivados |
| Fear & Greed | `api.alternative.me/fng/` | No | Ánimo |
| Noticias | ~14 RSS (los de CryptoTrade) | No | Noticias |
| Rumores | Reddit r/CryptoCurrency, r/Bitcoin, r/ethereum (`.json`/RSS) | No | Noticias, **best-effort** (Reddit suele bloquear IPs de nube) |
| LLM | Groq → Gemini (modelo configurable en vars) | Sí, secret | Puntuar titulares + explicar |

`data-api.binance.vision` es el mirror público de datos de mercado; se usa porque el cron
de Cloudflare puede ejecutarse desde regiones donde `api.binance.com` responde 451. Los
derivados de `fapi` pueden fallar por la misma razón: son opcionales.

**Divisas.** Los indicadores se calculan sobre pares USDT (más líquidos). La contabilidad
del bot es en € y usa pares EUR para precio de entrada/salida, stops y valoración. Los
stops se expresan como % (ATR/precio), así no se mezclan divisas.

## 5. Ejecuciones programadas

Dos crons (uno por tipo de trabajo, para respetar 50 subpeticiones y 10 ms de CPU por
invocación):

### Cron `1 * * * *` — noticias
1. Descarga RSS y Reddit en paralelo. Un feed que falle se ignora y se registra.
2. Normaliza, deduplica por hash de título normalizado, descarta > 48 h.
3. Inserta en `titulares` solo los nuevos.
4. Los titulares sin puntuar se envían al LLM en **un solo lote**: devuelve por titular
   `puntuacion ∈ [-1,1]` y `monedas` afectadas (o `MERCADO`). Respuesta JSON validada.
   Groq → si falla, Gemini → si falla, `core/lexico.js`. Se guarda el motor usado.

### Cron `3 * * * *` — mercado y bot
1. Descarga velas USDT (1h/4h/1d), velas EUR 1h, derivados y Fear & Greed.
2. Para cada moneda, la estrategia de la simulación activa (`estrategia(simulacion.estrategia_version)`
   de `core/estrategias.js`; hoy `v1`) calcula la señal (§6) con titulares de las
   últimas 24 h leídos de D1.
3. Una llamada al LLM redacta la explicación de cada señal a partir del desglose
   estructurado. Si falla, plantilla de texto.
4. Guarda la señal en `senales_actuales`.
5. Ejecuta el bot (§7) para la simulación activa.
6. Guarda instantánea de capital.

Cada ejecución queda en `ejecuciones` (tipo, inicio, fin, ok, detalle de fuentes fallidas).

### Análisis manual
`POST /api/analizar` repite los pasos 1-4 del cron de mercado. **Nunca opera.** Limitado
a 1 vez cada 5 minutos.

## 6. Motor de señales — estrategia v1

Todos los umbrales y pesos viven en `core/estrategia-v1.js` como constantes exportadas,
junto a `VERSION = 'v1'`. Cualquier cambio de parámetros crea una versión nueva.

**Estrategias enchufables.** Cada versión es un módulo `core/estrategia-vN.js` que exporta
`VERSION`, `PARAMETROS` (señal), `PARAMETROS_BOT` (§7.1, con claves opcionales nuevas que
`core/bot.js` entiende) y `calcularSenal`. `core/estrategias.js` las registra
(`ESTRATEGIAS`, `estrategia(version)` que lanza `RangeError` si no existe) y fija
`ESTRATEGIA_ACTIVA` (la de las simulaciones nuevas y del backtest por defecto). Cada
simulación guarda su `estrategia_version` y siempre se ejecuta con esa versión. Hoy:
`ESTRATEGIA_ACTIVA = 'v1'` (ver §6.6).

Siempre se usan **solo velas cerradas**. Una vela 4H/1D cuenta solo si su cierre es
anterior al momento de decisión.

### 6.1 Técnico T ∈ [-1, 1] (peso 0,60)

Por cada timeframe (1H, 4H, 1D):

- `d = (EMA20 − EMA50) / EMA50`. Tendencia: **alcista** si `d > +0,02`, **bajista** si
  `d < −0,02`, **lateral** en otro caso.
- Subpuntuaciones:

| Sub | Peso | Regla |
|---|---|---|
| Tendencia | 0,35 | `clamp(d / 0,02, −1, 1)` |
| EMA200 | 0,15 | precio > EMA200 → +1; < → −1 |
| RSI14 | 0,25 | según tendencia (tabla siguiente) |
| MACD (12,26,9) | 0,15 | cruce de histograma en la última vela → ±1; si no, signo del histograma → ±0,5 |
| Bollinger (20, 2σ) | 0,10 | solo en lateral: %B < 0 → +1; %B > 1 → −1; resto 0. En tendencia: 0 |

RSI según tendencia (no suma por sí solo):

| Tendencia | Condición | Valor |
|---|---|---|
| Alcista | RSI ≤ 45 | +1 |
| Alcista | RSI ≥ 80 | −0,3 |
| Alcista | resto | 0 |
| Bajista | RSI ≥ 55 | −1 |
| Bajista | RSI ≤ 20 | +0,3 |
| Bajista | resto | 0 |
| Lateral | RSI ≤ 30 | +1 |
| Lateral | RSI ≥ 70 | −1 |
| Lateral | resto | 0 |

- `T_tf = clamp(Σ peso·sub, −1, 1)`; `T = 0,5·T_1D + 0,3·T_4H + 0,2·T_1H`.
- **Alineación**: al menos 2 de 3 timeframes con la misma tendencia no lateral.

### 6.2 Derivados D ∈ [-1, 1] (peso 0,20)

Lectura a la contra del posicionamiento apalancado. Media ponderada de las
subpuntuaciones disponibles:

| Sub | Peso | Regla |
|---|---|---|
| Funding (por 8 h) | 0,4 | > 0,05 % → −1; > 0,03 % → −0,5; < −0,03 % → +0,5; < −0,05 % → +1; resto 0 |
| Long/short (cuentas) | 0,3 | > 2,0 → −0,5; < 0,7 → +0,5; resto 0 |
| Open interest 24 h | 0,3 | OI +3 % y precio +1 % → +0,5; OI +3 % y precio −1 % → −0,5; resto 0 |

Si no hay ninguna subpuntuación disponible, D está **ausente**.

### 6.3 Noticias y rumores N ∈ [-1, 1] (peso 0,15)

Titulares de las últimas 24 h que afectan a la moneda o al `MERCADO`:
`w = e^(−edad_h / 12)`; ×0,5 si es de mercado general; ×0,5 si viene de Reddit.
`N = Σ w·s / Σ w`. Con menos de 3 titulares, N está **ausente**.

### 6.4 Fear & Greed F (peso 0,05)

Solo en extremos, a la contra: valor < 20 → +0,5; > 80 → −0,5; resto 0.

### 6.5 Combinación y veredicto

- `S = Σ peso·componente / Σ peso` sobre los componentes **presentes**. Sin T no hay
  señal (veredicto `SIN_DATOS`).
- **Contradicción**: si `sign(T) ≠ sign(D)`, `|T| ≥ 0,3` y `|D| ≥ 0,5` → `MANTENER`
  con motivo `contradiccion_tecnico_derivados`.
- `S ≥ +0,35` → `COMPRAR`; `S ≤ −0,35` → `VENDER`; resto → `MANTENER`.
- **Índice de confianza** = `min(0,95, 0,4 + 0,5·|S| + (alineación ? 0,1 : 0))`. No es una
  probabilidad; la interfaz lo indica como "sin calibrar".
- **Volatilidad**: `ATR% = ATR14(4H) / cierre(4H)`, sobre el par USDT.
- La señal guarda el desglose completo: componentes, subpuntuaciones, indicadores por
  timeframe, IDs de titulares usados y componentes ausentes.

### 6.6 Estrategia v2

Motivo: el backtest de v1 (2024-10-18 → 2026-10-18) dio −18,5 % frente a +20,3 % de comprar
y mantener, con 718 operaciones (6,9/semana), ~2.000 € de costes sobre 10.000 € y los 359
cierres por stop-loss/take-profit (ninguno por VENDER). v2 se eligió **con datos y un
protocolo declarado antes de mirar el periodo de prueba**, no a ojo.

**Reglas (`core/estrategia-v2.js`, `VERSION = 'v2'`):**

- Señal: la de v1 sin cambios (mismos indicadores, pesos, umbrales ±0,35 e índice de
  confianza, §6.1-6.5).
- **Filtro de régimen**: un `COMPRAR` solo se mantiene si el cierre de la última vela 1D
  (USDT) está **por encima de su EMA200 1D**; si no, pasa a `MANTENER` con motivo
  `filtro_regimen`. `VENDER`, `MANTENER` y `SIN_DATOS` no se filtran. El desglose añade
  `detalle.regimen = { sobreEma200 }` (`null` sin datos).
- **Cadencia diaria**: `PARAMETROS_BOT.cadenciaHoras = 24`. El bot solo decide (abrir o
  cerrar por señal) sobre la vela 1H que cierra a las 00:00 UTC (cierre de la vela 1D), es
  decir, en la ejecución de las 00:03 UTC. El resto de horas la decisión es `ninguna` con
  motivo `fuera_de_ventana`; los stops se siguen revisando **cada hora** con las velas 1H
  EUR (§7.4).
- Bot: el resto como v1 (§7.1): SL 1,5·ATR%(4H), TP 2,5·ATR%(4H) fijados al abrir y nunca
  recalculados (sin trailing), confianza mínima 0,60, 20 % por posición, enfriamiento 4 h,
  comisión 0,1 % y deslizamiento 0,05 %.

`cadenciaHoras` es un parámetro genérico y opcional de `core/bot.js` (por defecto 1 = cada
hora, comportamiento de v1): solo se decide sobre velas que cierran en una hora UTC múltiplo
de la cadencia (debe dividir a 24). Orden de comprobación: `sin_datos` →
`datos_desactualizados` → `fuera_de_ventana` → resto (§7.2).

**Protocolo walk-forward (declarado antes de ejecutar la rejilla):**

- TRAIN 2022-10-18 → 2024-10-18 y TEST 2024-10-18 → 2026-10-18 (00:00 UTC), 5 monedas,
  10.000 €, mismos costes, variante técnico + Fear & Greed (como v1, §8).
- Rejilla pequeña de 3 × 2 × 3 × 2 = **36 configuraciones**: cadencia de decisión
  {1 h, 4 h, 1 d}; régimen {ninguno, cierre 1D > EMA200 1D}; riesgo {A: SL 1,5·ATR4H y
  TP 2,5·ATR4H (v1); B: SL 2,5·ATR1D y TP 4·ATR1D; C: SL 2,5·ATR1D sin TP}; salida
  {VENDER si S ≤ −0,35 (v1); VENDER si la tendencia 1D es bajista}. Fijos: umbral de compra
  0,35, confianza mínima 0,60, 20 %, enfriamiento 4 h.
- Criterio de selección (solo TRAIN): máxima rentabilidad neta con drawdown máximo ≤ 0,6 ×
  el de comprar y mantener en TRAIN (0,6 × 42,65 % = 25,59 %); empate → menos operaciones.
  La elegida se evalúa **una sola vez** en TEST.
- Decisión binaria: `ESTRATEGIA_ACTIVA = 'v2'` solo si v2 supera a v1 en rentabilidad neta
  en TEST.

**Resultado.** Solo 12 de las 36 configuraciones cumplían la restricción de drawdown (todas
con el riesgo A). La mejor fue *decisión diaria + régimen EMA200 + riesgo A* (empatada
exactamente con su gemela de salida por tendencia 1D: con el TP ajustado ninguna posición
llega a cerrarse por señal, así que la regla de salida no influye; se conserva la de v1).

| Periodo | Estrategia | Rentabilidad neta | Drawdown máx. | Operaciones (por semana) |
|---|---|---|---|---|
| TRAIN | v1 | −13,23 % | 25,52 % | 760 (7,3) |
| TRAIN | **v2** | **+9,61 %** | **14,86 %** | 474 (4,5) |
| TRAIN | Comprar y mantener | +145,05 % | 42,65 % | — |
| TEST | v1 | −18,24 % | 35,49 % | 716 (6,9) |
| TEST | **v2** | **−22,84 %** | **39,43 %** | 458 (4,4) |
| TEST | Comprar y mantener | +23,26 % | 64,49 % | — |

Robustez (no usada para elegir): las 5 mejores de TRAIN según el criterio dieron en TEST
−22,84 % (las cuatro de cadencia diaria) y −26,50 % (cadencia 4 h).

**Decisión: `ESTRATEGIA_ACTIVA` sigue siendo `'v1'`**, porque v2 no superó a v1 en TEST
(−22,84 % < −18,24 %). v2 queda registrada y disponible (`npm run backtest -- --estrategia
v2`) pero las simulaciones nuevas usan v1.

**Limitaciones (honestas):**

- Ninguna de las dos estrategias bate a comprar y mantener en ningún periodo, y un backtest
  **no es garantía de resultados futuros**.
- Riesgo de sobreajuste: el resultado positivo de v2 en TRAIN depende sobre todo de SOL
  (+1.888 € realizados; las otras cuatro monedas suman −942 €) y no se repitió en TEST.
  Que el filtro de régimen apenas actúe (en TEST no cambia ninguna operación: un S ≥ 0,35
  ya implica casi siempre cierre 1D sobre la EMA200) indica que la mejora en TRAIN vino de
  la cadencia, no de una ventaja robusta.
- En TEST, configuraciones con stops más amplios (riesgo B/C) habrían rendido mucho mejor
  (hasta +52 %), pero en TRAIN violaban la restricción de drawdown (36-41 %). Elegirlas
  ahora sería usar el periodo de prueba para seleccionar (fuga de información): cualquier
  v3 que las explore necesita un protocolo nuevo y datos fuera de muestra nuevos (p. ej.
  el propio paper trading en vivo).
- El backtest solo usa técnico + Fear & Greed: no hay histórico de noticias ni de derivados,
  que en vivo sí participan y pueden cambiar las señales.
- Los costes simulados (0,1 % + 0,05 % por lado) son aproximados; con huecos de precio el
  stop puede ejecutarse peor que en la simulación.

## 7. Bot de paper trading

### 7.1 Parámetros v1

| Parámetro | Valor |
|---|---|
| Capital inicial | 10.000 € (configurable al crear simulación) |
| Comisión | 0,1 % por lado |
| Deslizamiento | 0,05 % en contra |
| Índice de confianza mínimo para abrir | 0,60 |
| Tamaño de posición | 20 % del valor de cartera en ese momento, limitado al saldo |
| Máximo por moneda | 1 posición = 20 % (sin promediar) |
| Orden mínima | 10 € |
| Stop-loss | entrada × (1 − 1,5·ATR%) |
| Take-profit | entrada × (1 + 2,5·ATR%) |
| Frescura | la última vela 1H cerrada (USDT y EUR) debe ser la de la hora anterior |
| Enfriamiento | tras un cierre por stop-loss, no reabre esa moneda en 4 h |

### 7.2 Semántica

| Señal | Sin posición | Con posición |
|---|---|---|
| COMPRAR (confianza ≥ 0,60, datos frescos, saldo ≥ 10 €) | Abre | Nada |
| COMPRAR (no cumple algún requisito) | Nada, registrada como no ejecutada con motivo | Nada |
| MANTENER | Nada | Nada |
| VENDER | Nada, registrada como no ejecutada (`sin_posicion`) | Cierra todas las unidades |
| SIN_DATOS | Nada (`sin_datos`) | Nada; los stops sí se siguen comprobando con las velas que lleguen |
| Datos desactualizados | Nada (`datos_desactualizados`) | Nada; los stops sí se siguen comprobando con las velas que lleguen |

Vocabulario de `decisiones.motivo`: `abierta`, `cerrada`, `mantener` (o el motivo de la
señal: `contradiccion_tecnico_derivados`, `filtro_regimen` en v2), `sin_posicion`,
`ya_en_posicion`, `confianza_baja`, `saldo_insuficiente`, `datos_desactualizados`,
`sin_datos`, `enfriamiento`, `cerrada_por_stop`, `fuera_de_ventana` (hora fuera de la
cadencia de decisión, solo con `cadenciaHoras > 1`, §6.6).

Todos los parámetros del bot salen de `PARAMETROS_BOT` de la estrategia de la simulación;
la tabla de §7.1 son los de v1.

### 7.3 Precios

- Entrada: `cierre_EUR(vela) × (1 + 0,0005)`; unidades = `(importe − comisión) / precio`.
- Salida por señal: `cierre_EUR(vela) × (1 − 0,0005)`.
- SL/TP fijados **al abrir** sobre el precio de entrada real (con deslizamiento). No se
  recalculan nunca.
- Nunca se venden más unidades de las que se poseen. Restricción `CHECK (saldo >= 0)`.

### 7.4 Comprobación de stops

En cada ejecución, por moneda con posición abierta, se recorren **todas las velas 1H EUR
cerradas** posteriores a `progreso.ultima_vela_revisada` (y posteriores a la vela de
entrada), de la más antigua a la más reciente:

1. `open ≤ SL` → sale a `open` (hueco).
2. `low ≤ SL` → sale a `SL`. Si en la misma vela también `high ≥ TP`, gana el SL
   (escenario conservador).
3. `open ≥ TP` → sale a `open`.
4. `high ≥ TP` → sale a `TP`.

Todas las salidas aplican deslizamiento y comisión. Si una ejecución falló, la siguiente
recupera las velas perdidas (se piden 500 velas 1H, ~20 días).

Orden por moneda: primero stops, luego decisión sobre la última vela cerrada. Si en la
misma ejecución se cerró por stop, no se reabre (y aplica el enfriamiento).

### 7.5 Idempotencia y atomicidad

- `decisiones` tiene `UNIQUE(simulacion_id, simbolo, vela_1h)`.
- Por moneda, **un único `db.batch()`**: `INSERT` de la decisión (sin `OR IGNORE`) +
  cierres por stop + operación + actualización de posición + saldo + progreso. Si la
  decisión ya existía (reintento, doble cron), el `INSERT` viola la restricción y **todo el
  batch se revierte**: no se duplica nada.
- `operaciones` tiene `UNIQUE(posicion_id, lado)`: una posición se abre y se cierra una
  sola vez.
- Índice único parcial: una sola posición `abierta` por `(simulacion_id, simbolo)`.
- `capital` tiene `PRIMARY KEY(simulacion_id, vela_1h)` con `INSERT OR IGNORE`.

### 7.6 Simulaciones

- Al reiniciar (con confirmación en la interfaz), la simulación activa se marca como
  cerrada (se congela con su última valoración) y se crea otra con `id` nuevo. Nada se
  borra.
- **Comprar y mantener**: en la primera ejecución de mercado de cada simulación se reparte
  el capital inicial a partes iguales entre las monedas, al precio de entrada con
  deslizamiento y comisión. Se valora cada hora junto al bot.

### 7.7 Métricas (por simulación, moneda y versión de estrategia)

Saldo disponible, valor de cartera, beneficio realizado y no realizado, rentabilidad neta
%, rentabilidad de comprar y mantener %, drawdown máximo (sobre la curva horaria),
operaciones ganadoras y perdedoras, beneficio medio por operación, comisiones y
deslizamiento acumulados, frecuencia (operaciones/semana). Se calculan en `core/metricas.js`
a partir de las filas de D1.

## 8. Backtest

- `npm run backtest [--desde AAAA-MM-DD] [--monedas BTC,ETH]` en local (Node ≥ 22), por
  defecto los últimos 2 años.
- Descarga el histórico 1H/4H/1D USDT y 1H EUR de Binance (paginado), y el histórico de
  Fear & Greed. Cachea en `scripts/.cache/` (ignorado por git).
- `--estrategia vN` elige la estrategia (por defecto `ESTRATEGIA_ACTIVA`); `--hasta`,
  `--capital` como antes.
- Recorre hora a hora llamando a **la misma** `ejecutarHora` de `core/hora.js` (que recibe
  el módulo de estrategia y usa su `calcularSenal` y sus `PARAMETROS_BOT` con `core/bot`)
  que el Worker, con ventanas de 500 velas (igual que en vivo).
- **Sin información futura**: en la hora t solo se ven velas cuyo cierre es ≤ t.
- **Limitación declarada**: no hay histórico gratuito de titulares, y el de long/short y
  open interest es de ~30 días. El backtest evalúa la variante **técnico + Fear & Greed**
  (pesos renormalizados) y lo etiqueta así en el JSON y en la interfaz.
- Salida: `data/backtest-vN.json` con parámetros (`estrategia`, `bot`, `ventana`), versión,
  periodo, métricas globales y por moneda, recuento de decisiones, curva de capital
  (submuestreada a diaria) y operaciones.

## 9. Presupuesto de recursos de Cloudflare (cuenta compartida)

| Recurso (plan gratuito) | Uso de ORACLE | % |
|---|---|---|
| Cron triggers: 5/cuenta (1 usado por SolarMonitor) | 2 | queda en 3/5 |
| Peticiones: 100.000/día por cuenta | 48 crons + ~300 PWA | < 0,5 % |
| KV escrituras: 1.000/día por cuenta (usado por 4 proyectos) | **0**: ORACLE no usa KV | 0 % |
| D1 escrituras: 100.000/día | ~5 decisiones + ~5 progreso + 1 capital + ~50 titulares/h ≈ 1.700/día | ~1,7 % |
| D1 lecturas: 5 M/día | consultas indexadas y acotadas | < 1 % |
| Subpeticiones: 50/invocación | noticias ≈ 19; mercado ≈ 15 + 5 EUR + 11 derivados + 1 F&G + 1 LLM ≈ 33 | bajo límite |
| CPU: 10 ms/invocación | parsing ligero (regex para RSS, sin librerías XML) | por invocación: si se excede, solo falla esa ejecución de ORACLE |

Salvaguardas: la PWA solo consulta al abrirse y cada 5 min mientras está visible; las
velas del gráfico van del navegador a Binance directamente; PIN con bloqueo; sin reintentos
en bucle. Si la CPU resultara insuficiente, se avisará antes de proponer el plan de pago.

## 10. Persistencia — esquema D1

```sql
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
  coste REAL NOT NULL,                    -- euros que salieron del saldo al abrir, comisión incluida (Posicion.coste)
  stop_loss REAL NOT NULL,
  take_profit REAL NOT NULL,
  vela_salida INTEGER,
  precio_salida REAL,
  motivo_salida TEXT,                     -- senal | stop_loss | take_profit
  pnl_neto REAL
);
CREATE UNIQUE INDEX una_abierta ON posiciones(simulacion_id, simbolo) WHERE estado = 'abierta';

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
  motivo TEXT NOT NULL,
  saldo_tras REAL NOT NULL,
  pnl_neto REAL,                          -- solo en ventas: importe − comisión − coste de la posición
  estrategia_version TEXT NOT NULL,
  creada_en INTEGER NOT NULL,
  UNIQUE (posicion_id, lado)
);

CREATE TABLE decisiones (
  id INTEGER PRIMARY KEY,
  simulacion_id INTEGER NOT NULL,
  simbolo TEXT NOT NULL,
  vela_1h INTEGER NOT NULL,
  veredicto TEXT NOT NULL,                -- COMPRAR | MANTENER | VENDER | SIN_DATOS
  indice_confianza REAL,
  puntuacion REAL,
  accion TEXT NOT NULL,                   -- abrir | cerrar | ninguna
  motivo TEXT NOT NULL,                   -- abierta | cerrada | mantener (o el motivo de la señal:
                                          -- contradiccion_tecnico_derivados | filtro_regimen) |
                                          -- sin_posicion | ya_en_posicion | confianza_baja |
                                          -- saldo_insuficiente | datos_desactualizados | sin_datos |
                                          -- enfriamiento | cerrada_por_stop | fuera_de_ventana
  precio REAL,
  desglose_json TEXT NOT NULL,
  estrategia_version TEXT NOT NULL,
  creada_en INTEGER NOT NULL,
  UNIQUE (simulacion_id, simbolo, vela_1h)
);

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
  senal_json TEXT NOT NULL                -- veredicto, confianza, desglose, explicación, precio
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
  motor TEXT                              -- groq | gemini | lexico
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

CREATE TABLE intentos_pin (
  ip TEXT PRIMARY KEY,
  fallos INTEGER NOT NULL,
  bloqueado_hasta INTEGER
);
```

**Reconstrucción del estado del bot.** El `Estado` de `core/bot.js` se reconstruye desde D1
sin pérdida: `Estado.saldo` = `simulaciones.saldo`; `Estado.posiciones` = filas `abierta`
de `posiciones` (`velaEntrada` = `vela_entrada`, `precioEntrada` = `precio_entrada`,
`unidades`, `coste`, `stopLoss` = `stop_loss`, `takeProfit` = `take_profit`);
`Estado.ultimaRevisada[simbolo]` = `progreso.ultima_vela_revisada`;
`Estado.enfriamientoHasta[simbolo]` = MAX(`vela_salida`) + `enfriamientoHoras` (de los
`PARAMETROS_BOT` de la estrategia de la simulación; 4 h en v1 y v2) de las posiciones cerradas
con `motivo_salida = 'stop_loss'`. Las métricas se calculan desde `operaciones` (con
`pnl_neto` en las ventas). El Worker (plan 2) debe usar `ejecutarHora` de `core/hora.js`
para que sus decisiones sean idénticas a las del backtest.

Purga: el cron de noticias borra titulares > 7 días y ejecuciones > 30 días.

## 11. API (Worker)

Todas las rutas exigen `Authorization: Bearer <PIN>`, comparado en tiempo constante con
el secret `ORACLE_PIN`. 5 fallos por IP → bloqueo de 15 min. CORS solo para
`https://jcaboroca.github.io` y `http://localhost:*`.

| Método | Ruta | Devuelve |
|---|---|---|
| GET | `/api/resumen` | señales actuales, Fear & Greed, resumen del bot, última ejecución y frescura |
| GET | `/api/moneda/:sym` | señal con desglose, titulares usados, últimas decisiones |
| GET | `/api/bot?simulacion=` | métricas, posiciones abiertas, curva de capital y comprar y mantener |
| GET | `/api/bot/operaciones?simulacion=&simbolo=&cursor=` | operaciones paginadas |
| GET | `/api/bot/decisiones?simulacion=&simbolo=&cursor=` | decisiones paginadas (incluye HOLD) |
| GET | `/api/simulaciones` | lista de simulaciones |
| POST | `/api/bot/reiniciar` `{capital_inicial, confirmar: true}` | nueva simulación |
| POST | `/api/analizar` | refresca señales (no opera); 429 si < 5 min |

No existe ninguna ruta que envíe órdenes a un exchange. Secrets: `ORACLE_PIN`,
`GROQ_API_KEY`, `GEMINI_API_KEY`. Vars: `MONEDAS`, `LLM_MODELO_GROQ`, `LLM_MODELO_GEMINI`.

## 12. Interfaz (PWA)

En español, pensada primero para el móvil, sin build (ES modules), instalable, con
service worker que cachea solo la estructura de la app (los datos siempre en red).

- **Acceso**: PIN una vez; se guarda en `localStorage` del dispositivo.
- **Panel**: medidor de Fear & Greed; tarjeta por moneda (precio €, 24 h, veredicto en
  color, índice de confianza, una frase); hora del último análisis y aviso de datos
  desactualizados; botón "Analizar ahora".
- **Detalle de moneda**: velas 1H/4H/1D con EMA20/50/200 y panel de RSI (datos directos de
  Binance desde el navegador); barras de T/D/N/F con los ausentes marcados; explicación;
  titulares con puntuación y motor; historial de señales; SL/TP orientativos.
- **Bot**: valor de cartera, saldo, beneficio realizado y no realizado, frente a comprar y
  mantener; curva de capital (bot frente a comprar y mantener); métricas de §7.7 (por moneda
  también); posiciones abiertas con SL/TP fijos; operaciones; decisiones con filtro
  (incluye HOLD y no ejecutadas); selector de simulación y versión; reinicio con confirmación.
- **Backtest**: mismas métricas sobre `data/backtest-vN.json` (una por estrategia), con la
  etiqueta "técnico + Fear & Greed", la versión y el periodo.
- **Pie fijo**: "Simulación. No es asesoramiento financiero ni garantía de beneficio".

## 13. Errores

- Fuente de velas caída para una moneda → `SIN_DATOS`, el bot no abre; si después llegan
  velas, los stops pendientes se comprueban.
- Derivados, noticias o Fear & Greed caídos → componente ausente, pesos renormalizados,
  marcado en el desglose.
- LLM caído → léxico local para puntuar; plantilla para explicar.
- Error de D1 en un batch → se registra; la siguiente ejecución lo reintenta de forma
  natural gracias a la idempotencia.
- La API devuelve errores JSON `{error, detalle}`; la PWA muestra los datos que tenga y un
  aviso, nunca una pantalla en blanco.

## 14. Pruebas

`node --test`, sin red, con fixtures reales grabados de Binance, alternative.me y RSS.

- **Indicadores**: valores de referencia conocidos (RSI de Wilder, EMA, MACD, ATR, Bollinger).
- **Estrategia**: cada fila de las tablas de §6; contradicción en su umbral exacto;
  renormalización con componentes ausentes; `SIN_DATOS` sin técnico; confianza máxima de 0,95.
- **Velas**: filtrado de la vela abierta; 4H/1D no cerrada no se usa; frescura.
- **Bot**: tamaño 20 % y orden mínima; nunca saldo negativo; no vende sin posición; SL y TP
  en la misma vela → SL; hueco bajo SL → sale a open; velas perdidas recuperadas;
  enfriamiento; SL/TP no cambian tras abrir; comisiones y deslizamiento exactos; parámetros
  inyectables; cadencia de decisión (`fuera_de_ventana`, stops cada hora).
- **Estrategias**: registro (`estrategia(version)`, `RangeError`); v1 usa los parámetros de bot
  por defecto; v2 = señal de v1 + `filtro_regimen` y cadencia 24 h; invariante: con v1 el
  backtest reproduce `data/backtest-v1.json` desde `scripts/.cache`.
- **Idempotencia**: ejecutar dos veces el cron de mercado sobre la misma vela no crea
  decisiones ni operaciones nuevas (D1 local con Miniflare/`wrangler`).
- **API**: PIN correcto/incorrecto, bloqueo, CORS, `analizar` no opera y respeta 429.
- **Backtest**: test que falla si en la hora t se accede a una vela con cierre > t.
- **Métricas**: drawdown, ganadoras/perdedoras y comprar y mantener sobre una curva sintética
  de test (solo en tests, nunca en producción).

## 15. Fuera de alcance (v1)

Notificaciones push, varios usuarios, acciones/ETFs, trading real, optimización
automática de parámetros, calibración del índice de confianza (se hará con datos
acumulados, en una versión posterior).

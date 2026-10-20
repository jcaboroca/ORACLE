# ORACLE

Asistente de trading **solo crypto** (BTC, ETH, SOL, BNB, XRP): analiza gráficos, tendencias,
noticias, rumores y ánimo del mercado, aconseja COMPRAR / MANTENER / VENDER y ejecuta un bot
de **paper trading** con dinero virtual para medir si la estrategia gana o pierde frente a
comprar y mantener.

> **Simulación.** ORACLE no ejecuta órdenes reales, no es asesoramiento financiero y sus
> señales no son garantía de beneficio.

Diseño: [docs/superpowers/specs/2026-10-18-oracle-design.md](docs/superpowers/specs/2026-10-18-oracle-design.md)

## Requisitos

Node ≥ 22.13 (los tests del Worker usan `node:sqlite`). Sin dependencias.

## Pruebas

```bash
npm test
```

## Estrategias

Cada estrategia es un módulo `core/estrategia-vN.js` (parámetros de señal, parámetros del bot
y `calcularSenal`) registrado en `core/estrategias.js`. Cada simulación guarda su versión.

| Versión | Qué hace | Estado |
|---|---|---|
| `v1` | Puntuación técnica + derivados + noticias + Fear & Greed; decide cada hora | Disponible |
| `v2` | La señal de v1 + solo compra con el cierre diario sobre la EMA200 diaria; decide una vez al día (00:03 UTC); los stops se siguen revisando cada hora | Disponible |
| `v3` | Laboratorio F3 Momentum: compra si la moneda sube en 30 días y vende si no; revisa los lunes (00:03 UTC), sin stop ni take-profit | **En vivo, principal y activa** |
| `v4` | Laboratorio F1 Cruce de medias: EMA10 > EMA50 diarias; decide cada día, sin stop ni take-profit | En vivo, **experimental** |
| `v5` | Laboratorio F2 Ruptura: compra al superar el máximo de 20 días y vende bajo el mínimo de 20 días | En vivo, **experimental** |

`core/estrategias.js` exporta `ESTRATEGIAS_EN_VIVO = ['v3', 'v4', 'v5']` (una simulación por cada una) y
`ESTRATEGIA_PRINCIPAL = 'v3'` (la que da el consejo del Panel; `ESTRATEGIA_ACTIVA` es la misma).

v2 se eligió con un protocolo walk-forward (entrenamiento 2022-10 → 2024-10, prueba 2024-10 →
2026-10) y **no superó a v1 en el periodo de prueba** (−23,1 % frente a −18,5 % con la ventana
de 299 velas; comprar y mantener: +23,3 %). Detalle, tabla y limitaciones en la spec §6.6.

v3–v5 salen del **laboratorio de estrategias** (abajo): F3 Momentum (v3) es la única familia que cumple el
criterio de «estrategia ganadora» fuera de muestra 2020–2025. Su cadena walk-forward (la configuración
elegida en cada año: 2020 60 días semanal con stop, 2021 30 diaria, 2022–2023 30 diaria con stop, 2024–2025
la desplegada) da +2.895 % con 38,7 % de caída máxima, frente a +4.715 % y 78,0 % de comprar y mantener; el
+5.622 % de la configuración desplegada en 2020–2025 es **dentro de muestra**. v4 y v5 son las siguientes
del ranking y **no** lo cumplen: van en vivo por una regla (completar hasta 3, marcadas experimentales)
decidida **después** de ver que solo había una ganadora, en contra de §4 de la spec. Elegir la nº 1 por su
ranking fuera de muestra ya es una selección sobre esos resultados, así que la única comprobación limpia es
el tramo reservado (2026): ahí las tres pierden y **v3 es la peor** (−11,0 % con caída 26,6 %, frente a
v4 −2,2 % / 19,4 % y v5 −9,2 % / 28,6 %; comprar y mantener −16,3 % / 49,5 %). Ninguna bate a comprar y
mantener en rentabilidad: lo que reducen es la caída.

**v3 no es robusta:** L = 30 días es el valor más bajo de la rejilla y su único vecino en L (60 días
semanal) tiene un cociente rentabilidad/caída de 9,5 frente a 144,6 (≈ 93 % menos); todo momentum con
L ≥ 60 falla el límite de caída (62–79 % frente a 46,8 %), y la meseta se cumple solo gracias a dos vecinos
que mantienen L = 30 (30 diaria, 93,0; 30 semanal con stop, 105,7). Además depende del día de revisión:
el lunes estaba fijado de antemano, pero revisando en domingo o miércoles la caída supera el 46,8 % y no
cumpliría el criterio. Resultados, tabla por día de la semana y limitaciones en la
[spec del laboratorio §9](docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md).

## Laboratorio de estrategias

```bash
npm run laboratorio                          # todo el histórico disponible hasta la hora actual
npm run laboratorio -- --hasta 2026-10-20    # fijando el final de los datos
```

Descarga las velas 1H/4H/1D USDT de Binance de BTC, ETH, SOL, BNB y XRP desde que cotiza cada par y el
histórico de Fear & Greed (caché por años en `scripts/.cache/`; la primera vez tarda ~3 min), prueba las
66 configuraciones de 5 familias (`core/familias/`) con validación anclada por años (prueba 2020–2025,
tramo reservado desde 2026-01-01) en `core/laboratorio.js` y escribe `data/laboratorio.json` (ranking,
criterio punto por punto, resultados por año y por moneda, meseta, selección y tramo reservado). El
cálculo tarda menos de un minuto. Si cambia la selección, las estrategias desplegables v3–v5 no se tocan
solas: cualquier cambio exige versiones nuevas (el test de `test/estrategias.test.js` avisa).

## Backtest

```bash
npm run backtest                                   # estrategia activa (v3), últimos 2 años, 5 monedas
npm run backtest -- --estrategia v2                # otra estrategia registrada
npm run backtest -- --desde 2025-01-01 --hasta 2026-01-01 --monedas BTC,ETH --capital 5000
```

Descarga histórico real de Binance (pares USDT para indicadores, EUR para ejecución) y de
Fear & Greed, lo cachea en `scripts/.cache/` y escribe `data/backtest-vN.json` según la
estrategia.

El backtest de v1 y v2 evalúa la variante **técnico + Fear & Greed**: no hay histórico gratuito fiable de
titulares ni de derivados, así que esos componentes no participan (sus pesos se renormalizan). v3–v5 son
**solo técnico** (velas, sin Fear & Greed): cada estrategia declara su variante (`VARIANTE_BACKTEST`) y
`data/backtest-vN.json` la publica.

## Worker (Cloudflare)

`worker/` es el servicio 24/7: dos crons (minuto 1, noticias; minuto 3, mercado y bot), D1 como
base de datos y una API JSON protegida por PIN para la PWA. Usa exactamente el mismo
`core/hora.js` que el backtest, con la estrategia guardada en cada simulación.

- Fuentes: velas y derivados (opcionales) de OKX (USDT para indicadores, EUR para el bot; desde
  Cloudflare Binance responde 403), con las velas cerradas y el funding en caché en D1 (cada hora solo
  se piden las velas nuevas) y Bybit spot como respaldo de las velas USDT; Fear & Greed de
  alternative.me, 14 RSS y Reddit (best-effort).
  El backtest usa histórico de Binance: misma lógica y misma ventana de 299 velas, distinta fuente
  (spec §4 y §8).
- Titulares puntuados por un LLM en cascada: Workers AI → Groq → Gemini → léxico local
  (`core/lexico.js`). Se guarda qué motor puntuó cada titular.
- Cada moneda se guarda en un único lote atómico de D1: repetir una hora no duplica nada.
- Los tests del Worker corren con `npm test`, sin red: D1 se simula con `node:sqlite`
  (Node ≥ 22.13) y las fuentes con respuestas reales grabadas en `worker/test/fixtures/`.
- Despliegue con `npx wrangler@4` desde `worker/`: pasos en la «Checklist de despliegue» de
  [docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md](docs/superpowers/plans/2026-10-18-oracle-plan-2-worker.md).
  Secrets: `ORACLE_PIN` y, opcionales, `GROQ_API_KEY` y `GEMINI_API_KEY`.
  La base D1 `oracle` (WEUR) ya existe y su id está en `worker/wrangler.toml`; antes del primer
  despliegue se aplican las migraciones `0001`-`0005` con `npx wrangler@4 d1 migrations apply oracle --remote`.

No existe ninguna ruta que envíe órdenes a un exchange: es una simulación.

## PWA

La interfaz es una PWA estática (HTML, CSS y módulos ES, sin build) en la raíz del repositorio, publicada
con GitHub Pages en <https://jcaboroca.github.io/ORACLE/>. Se instala en el iPhone desde Safari
(Compartir → Añadir a pantalla de inicio) y en Android desde el menú del navegador.

- Pantallas: acceso con PIN (se guarda en el dispositivo), Panel (Fear & Greed, una tarjeta por moneda,
  frescura y «Analizar ahora»), detalle de moneda (velas 1H/4H/1D de Binance pedidas desde el navegador
  —de OKX si Binance falla, con la fuente indicada— con EMA20/50/200 y RSI, desglose T/D/N/F, titulares e historial), Bot (cartera frente a comprar y
  mantener, curva, métricas, posiciones, operaciones, decisiones, simulaciones y reinicio) y Backtest
  (`data/backtest-vN.json`; v1 y v2 técnico + Fear & Greed, v3–v5 solo técnico).
- Refresca al abrir y cada 5 minutos solo mientras está visible. El service worker guarda únicamente la
  estructura de la app; los datos (API, Binance/OKX, backtest) van siempre a la red.
- `config.js` tiene la URL del Worker (`API_PRODUCCION` = `https://oracle.mundialisimo.workers.dev`); en
  `localhost` usa `http://localhost:8787`. El Worker solo abre CORS a `https://jcaboroca.github.io` y
  `http://localhost:8080` (var `ORIGENES`).
- Cliente de la API: como mucho 2 peticiones a la vez (el Worker reserva un intento de PIN por petición en
  vuelo), reintento automático ante 429 `ocupado` (hasta 3 veces) y plazo de 20 s (60 s en «Analizar
  ahora», que tarda 25-35 s). 401 → olvida el PIN y vuelve al acceso; sin PIN no se llama al Worker.
  Bloqueo (por IP o global) → aviso con la hora de fin, conservando el PIN guardado.
- Gráficos con [TradingView Lightweight Charts™](https://www.tradingview.com/) v5.2.1 (Apache-2.0,
  `vendor/`). Iconos generados desde `icons/icono.svg` con `npm run iconos`.

```bash
npm run dev            # http://localhost:8080
npm run api-simulada   # otra terminal: el Worker real con datos sintéticos de los tests en :8787, PIN 4815162342
```

Ambos escuchan solo en `127.0.0.1`, y `npm run dev` no sirve rutas ocultas (`.git/`, `worker/.dev.vars`…).

Para probar contra el Worker de verdad en local, en lugar de la API simulada usa `npx wrangler@4 dev`
desde `worker/` (ver la checklist del plan 2).

## Bot con varias estrategias en vivo

Spec: [docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md](docs/superpowers/specs/2026-10-20-oracle-laboratorio-design.md) §6-§8.

- `core/estrategias.js` exporta `ESTRATEGIAS_EN_VIVO` (las que operan, cada una con su simulación activa) y
  `ESTRATEGIA_PRINCIPAL` (la que da el consejo del Panel y la única con explicaciones del LLM). Cada módulo de
  estrategia puede exportar `ETIQUETA`, el nombre que enseñan el Bot y el Panel (v4 y v5 se marcan «experimental»).
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
  tiene la pestaña «Laboratorio» (`data/laboratorio.json`; sin ese archivo, «Laboratorio aún no ejecutado») con el
  criterio, el ranking, qué familia lo cumple y las desplegadas «experimental» que no.
- En local, `npm run api-simulada` arranca el Worker con 3 estrategias de prueba (datos sintéticos) para ver la
  comparativa sin desplegar.

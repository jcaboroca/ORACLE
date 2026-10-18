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
| `v1` | Puntuación técnica + derivados + noticias + Fear & Greed; decide cada hora | **Activa** |
| `v2` | La señal de v1 + solo compra con el cierre diario sobre la EMA200 diaria; decide una vez al día (00:03 UTC); los stops se siguen revisando cada hora | Disponible, no activa |

v2 se eligió con un protocolo walk-forward (entrenamiento 2022-10 → 2024-10, prueba 2024-10 →
2026-10) y **no superó a v1 en el periodo de prueba** (−22,8 % frente a −18,2 %; comprar y
mantener: +23,3 %), así que v1 sigue activa. Detalle, tabla y limitaciones en la spec §6.6.
Ninguna de las dos bate a comprar y mantener en el histórico: no es garantía de nada.

## Backtest

```bash
npm run backtest                                   # estrategia activa, últimos 2 años, 5 monedas
npm run backtest -- --estrategia v2                # otra estrategia registrada
npm run backtest -- --desde 2025-01-01 --hasta 2026-01-01 --monedas BTC,ETH --capital 5000
```

Descarga histórico real de Binance (pares USDT para indicadores, EUR para ejecución) y de
Fear & Greed, lo cachea en `scripts/.cache/` y escribe `data/backtest-vN.json` según la
estrategia.

El backtest evalúa la variante **técnico + Fear & Greed**: no hay histórico gratuito fiable de
titulares ni de derivados, así que esos componentes no participan (sus pesos se renormalizan).

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

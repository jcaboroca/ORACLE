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

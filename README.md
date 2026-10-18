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

## Backtest

```bash
npm run backtest                                   # últimos 2 años, 5 monedas
npm run backtest -- --desde 2025-01-01 --monedas BTC,ETH --capital 5000
```

Descarga histórico real de Binance (pares USDT para indicadores, EUR para ejecución) y de
Fear & Greed, lo cachea en `scripts/.cache/` y escribe `data/backtest-v1.json`.

El backtest evalúa la variante **técnico + Fear & Greed**: no hay histórico gratuito fiable de
titulares ni de derivados, así que esos componentes no participan (sus pesos se renormalizan).

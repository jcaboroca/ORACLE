# ORACLE — Laboratorio de estrategias y bot con 3 estrategias en paralelo

Fecha: 2026-10-20 · Estado: aprobado en brainstorming · Complementa a `2026-10-18-oracle-design.md`

## 1. Objetivo

Encontrar con datos, en todo el histórico disponible, estrategias de entrada y salida que
**ganen dinero con caídas claramente menores que comprar y mantener**, medido siempre en
periodos que no se usaron para encontrarlas y con comisiones y deslizamiento. Después, poner
las 3 mejores a operar en paralelo en el bot desde hoy, cada una con 10.000 € virtuales.

> Un resultado del pasado no garantiza el futuro. Por eso la selección se hace con
> validación por tramos fuera de muestra y un tramo final reservado.

## 2. Datos

- Velas 1H, 4H y 1D de los pares USDT de Binance (`data-api.binance.vision`), desde el inicio
  de cada par: BTC y ETH (2017-08), BNB (2017-11), XRP (2018-05), SOL (2020-08). Fear & Greed
  desde 2018-02. Caché local en `scripts/.cache/` (ignorada por git).
- En el laboratorio, señal y ejecución usan USDT; las rentabilidades se miden en % (no dependen
  de la divisa). En vivo, el bot sigue ejecutando con pares EUR de OKX (spec principal §4).
- Una moneda entra en un tramo solo si tiene historia suficiente para sus indicadores.

## 3. Familias de estrategias (todas largas al contado, con el motor de bot existente)

Decisión una vez al día, al cerrar la vela 1D (00:03 UTC). Stops (si los hay) se comprueban
cada hora con velas 1H, fijos al abrir. Tamaño, comisiones (0,1 %), deslizamiento (0,05 %),
orden mínima y 1 posición por moneda: los de `PARAMETROS_BOT` v1, salvo que la familia diga otra cosa.

| Familia | Entrada | Salida | Rejilla |
|---|---|---|---|
| F1 Cruce de medias 1D | EMA rápida > EMA lenta | EMA rápida < EMA lenta | rápida {10,20,30} × lenta {50,100,200} |
| F2 Ruptura (Donchian) | cierre > máximo de N días previos | cierre < mínimo de M días previos | (N,M) ∈ {(20,10),(40,20),(55,20),(100,40),(20,20),(55,40)} |
| F3 Momentum | rentabilidad de L días > 0 | rentabilidad de L días ≤ 0 | L {30,60,90,120,180} × revisión {diaria, semanal (lunes)} |
| F4 Caídas en tendencia | cierre > SMA200 y RSI(2) < u | cierre > SMA5 o tras D días | u {5,10,15} × D {5,10} |
| F5 v1 con stops amplios | señal v1 (decisión diaria) | VENDER, SL o TP | SL {2,5; 3,5}×ATR14 4H × TP {4×ATR; sin TP} |

F1–F4 se prueban también con un stop de emergencia fijo al abrir: {sin stop, 2,5 × ATR14 1D}.
"Sin TP" se implementa como take-profit inalcanzable que la base de datos acepta.
Total ≈ 2 × (9 + 6 + 10 + 6) + 4 = 66 configuraciones.

## 4. Validación (fijada antes de ver resultados)

- **Tramos de prueba**: años naturales 2020, 2021, 2022, 2023, 2024 y 2025. Para cada año Y,
  el **entrenamiento** es todo lo anterior a Y (anclado) y la **prueba** es Y.
- **Tramo reservado**: 2026-01-01 → hoy. Se mira una sola vez, al final, y no se usa para elegir.
- **Selección dentro de cada familia en cada tramo**: en el entrenamiento, la configuración con
  mayor rentabilidad / caída máxima entre las que tienen rentabilidad > 0; si ninguna, la de mayor
  rentabilidad. Se registra su resultado en el año de prueba.
- **Resultado fuera de muestra de la familia**: encadenar los 6 años de prueba (capital
  compuesto) con la configuración elegida en cada tramo.
- **Comparación**: comprar y mantener a partes iguales entre las monedas disponibles en cada año,
  con las mismas comisiones.

### Criterio de "estrategia ganadora" (todas deben cumplirse, fuera de muestra)
1. Rentabilidad neta encadenada 2020–2025 > 0.
2. Caída máxima encadenada ≤ 0,6 × la de comprar y mantener en el mismo periodo.
3. Rentabilidad > 0 en al menos 4 de los 6 años de prueba.
4. Beneficio realizado > 0 en al menos 4 de las 5 monedas.
5. Meseta: la mediana del cociente rentabilidad/caída de las configuraciones vecinas (un paso
   en la rejilla) es ≥ 50 % del de la elegida, evaluadas en todo 2020–2025.

**Ranking**: rentabilidad / caída máxima fuera de muestra. **Top 3 de familias distintas.**
La configuración que se despliega de cada familia es la que elige el mismo procedimiento con
todo el entrenamiento hasta 2025-12-31. Después se mide una vez en el tramo reservado.

Si menos de 3 familias cumplen el criterio, se despliegan las que lo cumplan y el informe lo
dice. Si ninguna lo cumple, no se etiqueta nada como ganadora: se informa con cifras y se
despliegan las 3 mejores marcadas "experimentales".

## 5. Entregables del laboratorio

- `core/familias/*.js`: una función pura por familia que, dada la configuración, cumple el
  contrato de estrategia (`calcularSenal` + `PARAMETROS` + `PARAMETROS_BOT`; spec principal §6.6).
- `core/laboratorio.js`: motor de validación por tramos, puro y testeado (incluido un test de
  que el entrenamiento nunca ve datos del año de prueba).
- `scripts/laboratorio.mjs`: descarga y ejecuta → `data/laboratorio.json` (todas las
  configuraciones, resultados por tramo, por moneda, meseta, criterio, ranking y tramo reservado).
- Estrategias desplegables `core/estrategia-v3.js`, `-v4.js` y `-v5.js` (las 3 elegidas, con
  parámetros fijos) registradas en `core/estrategias.js`, más `data/backtest-v3…v5.json` del
  periodo de 2 años habitual.

## 6. Bot en vivo con 3 estrategias

- `core/estrategias.js` exporta `ESTRATEGIAS_EN_VIVO` (p. ej. `['v3','v4','v5']`) y
  `ESTRATEGIA_PRINCIPAL` (la nº 1 del ranking).
- El Worker mantiene **una simulación activa por estrategia en vivo**. Migración: el índice
  único pasa de `activa` a `(estrategia_version) WHERE activa = 1`. Al desplegar, la simulación
  v1 activa se cierra (queda en el historial) y se crean las nuevas con 10.000 €.
- Cada cron de mercado descarga los datos una vez y ejecuta `ejecutarHora` por simulación. La
  idempotencia y los lotes por moneda no cambian: `UNIQUE(simulacion_id, simbolo, vela_1h)` ya
  separa las simulaciones.
- `senales_actuales` guarda la señal de la estrategia principal (consejo del Panel). Las
  explicaciones LLM se generan solo para la principal (cuota de Workers AI).
- API: `GET /api/bot` acepta `simulacion=` como hoy; `GET /api/simulaciones` marca las activas
  y su estrategia; nuevo `GET /api/bot/comparativa` con la curva de capital de cada simulación
  activa y la de comprar y mantener (submuestreada, mismas unidades que el contrato actual).
- Presupuesto: sin subpeticiones externas nuevas; se medirá la CPU por ejecución tras desplegar
  y se informará.

## 7. PWA

- **Panel**: consejo de la estrategia principal, indicando cuál es.
- **Bot**: comparativa de las 3 simulaciones activas (una gráfica de capital con las 3 más
  comprar y mantener, y una tabla de métricas lado a lado); el detalle de cada una como hoy.
- **Backtest**: pestaña "Laboratorio" con el ranking, el criterio (cumple / no cumple punto por
  punto), resultados por año y por moneda, y el tramo reservado, con el aviso de que el pasado
  no garantiza el futuro.

## 8. Pruebas

`node --test` sin red: familias (señales sobre series sintéticas conocidas), motor de tramos
(sin fuga de datos del año de prueba, encadenado compuesto, criterio y meseta), estrategias
v3–v5 (contrato), Worker multi-simulación (3 simulaciones, idempotencia, migración de la
simulación v1), API de comparativa y vistas de la PWA.

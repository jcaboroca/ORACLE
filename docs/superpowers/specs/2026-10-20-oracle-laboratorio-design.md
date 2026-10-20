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

## 9. Resultados del laboratorio

Ejecución: `npm run laboratorio` con el histórico de Binance hasta el **2026-10-20 21:00 UTC**
(velas 1H/4H/1D USDT de BTC, ETH, SOL, BNB y XRP desde que cotiza cada par; Fear & Greed desde
2018-02-01). Las 66 configuraciones se calculan en **47 s** en un Mac (Node 24). Resultado completo
en `data/laboratorio.json`. Todas las cifras incluyen comisión (0,1 %) y deslizamiento (0,05 %) por
lado; cartera de 10.000 € por tramo con 20 % por posición (como mucho 100 % invertido).

### 9.1 Cómo se aplicó §4 (decisiones de implementación, fijadas antes de ver resultados)

- **Tramos anuales independientes** (años naturales, capital nuevo en cada uno, sin arrastrar
  posiciones). El entrenamiento de un año Y es el **encadenado compuesto de todos los tramos
  anteriores** (anclado al primero) y el resultado fuera de muestra encadena los 6 años de prueba.
- **Moneda en un tramo** (§2): entra si al empezar el tramo ya tiene **200 velas 1D cerradas** (el
  indicador más largo de la rejilla: EMA/SMA200 y las 200 velas mínimas de v1). El primer tramo
  empieza el 2018-03-05 (BTC y ETH); BNB y XRP entran en 2019 y SOL en 2022 (el 1-1-2021 solo tenía
  143 días). Comprar y mantener usa las mismas monedas de cada tramo.
- **Motor** (`core/laboratorio.js`): la misma lógica que `ejecutarBacktest` (mismo `pasoMoneda`,
  ventanas de 299 velas cerradas, precios y costes; señal y ejecución con la 1H USDT), calculando la
  señal solo en las horas de decisión y saltando las horas sin posiciones fuera de ellas. Paridad
  exacta (operaciones y métricas idénticas) probada en `test/laboratorio.test.js` con datos
  sintéticos con huecos, y comprobada a mano con datos reales (momentum 2022, cruce 2021 y v1 con
  stops 2025-T1).
- **Beneficio por moneda** (punto 4): beneficio realizado de cada año de prueba, ponderado por el
  capital encadenado al empezar ese año (euros sobre 10.000 € iniciales).
- **Meseta** (punto 5): de la configuración que se despliega (la elegida con todo hasta
  2025-12-31) frente a sus vecinas a un paso (un solo eje, valor contiguo), con el cociente del
  encadenado 2020–2025 de cada una.
- **Selección**: primero las familias que cumplen, por ranking; como solo cumple una, se completa
  hasta 3 con las siguientes del ranking **marcadas como experimentales** (las 3 simulaciones en
  vivo de §6). Es una lectura del último párrafo de §4: la letra pide desplegar solo las que
  cumplen; aquí se despliegan 3 y las que no cumplen van etiquetadas.

### 9.2 Ranking fuera de muestra (2020–2025 encadenado)

Comprar y mantener en el mismo periodo: **+4.714,9 %**, caída máxima **78,0 %** (límite del punto 2:
0,6 × 78,0 % = 46,8 %).

| # | Familia | Config. desplegada | Rentab. | Caída máx. | Rentab./caída | Oper. | Criterio (1-2-3-4-5) | Versión |
|---|---|---|---|---|---|---|---|---|
| 1 | F3 Momentum | 30 días, revisión semanal, sin stop | +2.894,7 % | 38,7 % | 74,8 | 547 | ✓ ✓ ✓ ✓ ✓ **cumple** | v3 |
| 2 | F1 Cruce de medias | EMA10/EMA50, sin stop | +1.264,4 % | 58,4 % | 21,6 | 240 | ✓ ✗ ✓ ✗ ✓ no cumple | v4 (experimental) |
| 3 | F2 Ruptura | N 20 / M 20, sin stop | +1.035,3 % | 51,8 % | 20,0 | 222 | ✓ ✗ ✓ ✗ ✓ no cumple | v5 (experimental) |
| 4 | F5 v1 con stops amplios | SL 2,5×ATR4H, sin TP | +807,7 % | 66,0 % | 12,2 | 225 | ✓ ✗ ✓ ✗ ✓ no cumple | — |
| 5 | F4 Caídas en tendencia | RSI(2) < 5, 10 días, sin stop | +3,4 % | 29,1 % | 0,1 | 300 | ✓ ✓ ✗ ✗ ✓ no cumple | — |

Puntos: 1 rentabilidad > 0 · 2 caída ≤ 0,6 × la de comprar y mantener · 3 positiva en ≥ 4 de 6 años ·
4 beneficio realizado > 0 en ≥ 4 de 5 monedas · 5 meseta. Detalle de los que fallan: F1, F2 y F5
superan el 46,8 % de caída (58,4 %, 51,8 % y 66,0 %) y pierden dinero realizado en 2-3 monedas;
F4 apenas gana (positiva en 3 de 6 años) y pierde en SOL y BNB. Meseta (cociente elegida → mediana
de vecinas): F3 144,6 → 93,0; F1 32,3 → 22,8; F2 48,7 → 35,8; F5 12,9 → 7,5; F4 2,0 → 1,0.

Configuración elegida en cada entrenamiento (F3): 2020 60 días semanal con stop; 2021 30 diaria sin
stop; 2022 y 2023 30 diaria con stop; 2024 y 2025 30 semanal sin stop. La desplegada (30 semanal sin
stop) es la que elige el mismo procedimiento con todo hasta 2025-12-31.

### 9.3 Por año (fuera de muestra) frente a comprar y mantener

| Año | Comprar y mantener | F3 Momentum (v3) | F1 Cruce (v4) | F2 Ruptura (v5) | F5 v1 + stops | F4 Caídas |
|---|---|---|---|---|---|---|
| 2020 | +240,7 % (caída 65,9 %) | +48,4 % (36,1 %) | +58,7 % (46,6 %) | +58,1 % (25,5 %) | +95,6 % (28,4 %) | −1,3 % (12,0 %) |
| 2021 | +500,3 % (64,1 %) | +383,6 % (38,7 %) | +327,2 % (48,7 %) | +223,3 % (34,2 %) | +239,2 % (59,4 %) | +1,0 % (27,5 %) |
| 2022 | −67,4 % (70,8 %) | −20,9 % (27,6 %) | −35,7 % (43,8 %) | −33,8 % (41,9 %) | −16,8 % (18,5 %) | −14,7 % (17,2 %) |
| 2023 | +251,6 % (31,5 %) | +110,0 % (20,5 %) | +78,8 % (28,6 %) | +110,1 % (27,6 %) | +36,7 % (27,6 %) | +4,3 % (4,8 %) |
| 2024 | +123,2 % (36,0 %) | +98,7 % (27,6 %) | +62,5 % (36,2 %) | +64,7 % (37,8 %) | +40,0 % (33,3 %) | −2,0 % (11,2 %) |
| 2025 | −8,1 % (46,8 %) | +26,4 % (19,1 %) | +7,7 % (21,9 %) | −3,1 % (20,6 %) | −14,1 % (24,9 %) | +19,0 % (7,7 %) |

Comprar y mantener: 2020-2021 sin SOL (BTC, ETH, BNB, XRP); desde 2022, las 5.

### 9.4 Beneficio realizado por moneda (fuera de muestra, € sobre 10.000 € encadenados)

| Familia | BTC | ETH | SOL | BNB | XRP |
|---|---|---|---|---|---|
| F3 Momentum | +30.877 | +40.162 | +16.048 | +58.374 | +12.316 |
| F1 Cruce | +2.397 | +15.576 | −10.666 | +44.895 | −10.768 |
| F2 Ruptura | −9.600 | +15.665 | −1.666 | +31.640 | −4.151 |
| F5 v1 + stops | +799 | +8.145 | −14.920 | +23.031 | −19.488 |
| F4 Caídas | +154 | +447 | −946 | −696 | +2.540 |

### 9.5 Tramo reservado (2026-01-01 → 2026-10-20, mirado una vez, con 5 monedas)

| Versión | Rentabilidad | Caída máx. | Operaciones | Comprar y mantener |
|---|---|---|---|---|
| v3 (F3 Momentum) | −11,0 % | 26,6 % | 51 | −16,3 % (caída 49,5 %) |
| v4 (F1 Cruce, experimental) | −2,2 % | 19,4 % | 34 | −16,3 % (caída 49,5 %) |
| v5 (F2 Ruptura, experimental) | −9,2 % | 28,6 % | 35 | −16,3 % (caída 49,5 %) |

Las tres pierden en 2026, menos que comprar y mantener y con entre el 39 % y el 58 % de su caída.
No se usó para elegir nada.

Backtest habitual de 2 años (`data/backtest-v3…v5.json`, 2024-10-20 → 2026-10-20, ejecución con
pares EUR): v3 +107,0 % (caída 35,8 %, 117 operaciones), v4 +78,1 % (32,9 %, 88), v5 +56,9 %
(41,1 %, 75); comprar y mantener +24,3 % (64,4 %). **Ojo:** ese periodo se solapa con los años 2024
y 2025 usados para elegir la configuración desplegada, así que **no** es fuera de muestra.

### 9.6 Conclusión (honesta)

- Solo **F3 Momentum** cumple los 5 puntos: gana en 5 de 6 años, con todas las monedas en positivo
  y la mitad de la caída de comprar y mantener (38,7 % frente a 78,0 %), y su meseta es amplia (las
  vecinas conservan el 64 % del cociente). Es la estrategia principal (v3). Las demás familias de
  tendencia (F1, F2, F5) ganan mucho en el encadenado pero con caídas por encima del límite y
  pérdidas en 2-3 monedas: van en vivo como **experimentales** (v4 y v5) para comparar, no como
  ganadoras. F4 (comprar caídas) apenas gana.
- **Ninguna bate a comprar y mantener en rentabilidad** fuera de muestra (+2.895 % frente a
  +4.715 %): lo que se gana es caída menor (sobre todo en 2022), no más beneficio. En años alcistas
  fuertes (2020, 2021, 2023) todas se quedan muy por detrás.
- **Riesgo de sobreajuste y sesgos:** 66 configuraciones y 5 familias sobre un solo mercado muy
  tendencial; la elección de F3 varió entre tramos (60/30 días, diaria/semanal, con y sin stop) y su
  resultado depende mucho de 2021 (+384 %). Las 5 monedas son las supervivientes que hoy conocemos
  (sesgo de supervivencia que favorece cualquier estrategia larga). El tramo reservado es corto
  (~10 meses) y bajista: no confirma ni refuta nada por sí solo.
- **Solo técnico:** ni noticias ni derivados (no hay histórico gratuito); el laboratorio usa velas
  USDT de Binance y el bot en vivo ejecuta con EUR de OKX. Ejecución supuesta al cierre de la vela
  1D con deslizamiento fijo; sin impuestos.
- **El pasado no garantiza el futuro.** Las 3 estrategias se miden ahora en vivo (paper trading)
  como prueba fuera de muestra real.

-- ORACLE · lecturas acotadas: ninguna ruta recorre una tabla entera ni ordena con un B-tree temporal
-- (comprobado con EXPLAIN QUERY PLAN en worker/test/api.test.js). ejecuciones(tipo, inicio) ya existe
-- desde 0001 (ejecuciones_tipo): la última ejecución de cada tipo es una búsqueda con LIMIT 1.

-- Purga horaria de ejecuciones > 30 días sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS ejecuciones_inicio ON ejecuciones(inicio);

-- Posiciones abiertas por orden de apertura (rowid) sin ordenar aparte.
CREATE INDEX IF NOT EXISTS posiciones_estado ON posiciones(simulacion_id, estado);

-- Operaciones de una simulación por id (rowid), sin filtro de moneda; con filtro sirve operaciones_simulacion.
CREATE INDEX IF NOT EXISTS operaciones_por_simulacion ON operaciones(simulacion_id);

-- Decisiones de una moneda por id (rowid): paginación con ?simbolo=.
CREATE INDEX IF NOT EXISTS decisiones_simbolo ON decisiones(simulacion_id, simbolo);

-- Resumen acumulado de la curva de capital hasta cada punto, calculado al insertarlo con las mismas
-- operaciones que core/metricas.js (drawdownMaximo): GET /api/bot lee las métricas de la curva en el
-- último punto, sin recorrer toda la historia.
ALTER TABLE capital ADD COLUMN maximo REAL;               -- máximo de valor_cartera hasta este punto
ALTER TABLE capital ADD COLUMN drawdown REAL;             -- drawdown máximo de valor_cartera hasta este punto
ALTER TABLE capital ADD COLUMN maximo_hodl REAL;          -- ídem sobre los valor_hodl no nulos (NULL si aún no hay)
ALTER TABLE capital ADD COLUMN drawdown_hodl REAL;
ALTER TABLE capital ADD COLUMN ultimo_hodl REAL;          -- último valor_hodl no nulo hasta este punto

-- Relleno de los puntos que ya existieran, en orden de vela por simulación.
WITH a AS (
  SELECT simulacion_id, vela_1h, valor_cartera, valor_hodl,
    MAX(valor_cartera) OVER w AS mx,
    MAX(valor_hodl) OVER w AS mh
  FROM capital
  WINDOW w AS (PARTITION BY simulacion_id ORDER BY vela_1h ROWS UNBOUNDED PRECEDING)
), b AS (
  SELECT simulacion_id, vela_1h, mx, mh,
    MAX(CASE WHEN mx > 0 THEN (mx - valor_cartera) / mx ELSE 0 END) OVER w AS dd,
    CASE WHEN mh IS NULL THEN NULL
      ELSE MAX(CASE WHEN valor_hodl IS NOT NULL AND mh > 0 THEN (mh - valor_hodl) / mh ELSE 0 END) OVER w END AS ddh
  FROM a
  WINDOW w AS (PARTITION BY simulacion_id ORDER BY vela_1h ROWS UNBOUNDED PRECEDING)
)
UPDATE capital SET maximo = b.mx, drawdown = b.dd, maximo_hodl = b.mh, drawdown_hodl = b.ddh,
  ultimo_hodl = (SELECT c.valor_hodl FROM capital c WHERE c.simulacion_id = capital.simulacion_id
    AND c.vela_1h <= capital.vela_1h AND c.valor_hodl IS NOT NULL ORDER BY c.vela_1h DESC LIMIT 1)
FROM b WHERE capital.simulacion_id = b.simulacion_id AND capital.vela_1h = b.vela_1h;

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

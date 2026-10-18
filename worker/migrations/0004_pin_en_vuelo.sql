-- ORACLE · PIN: los intentos en vuelo se cuentan aparte de los fallos confirmados (spec §11).
-- Antes una reserva contaba como fallo hasta comparar, y varias peticiones a la vez con el PIN correcto
-- podían recibir un bloqueo de 15 min falso. Ahora:
--   fallos      = PIN comparados y no acertados (solo estos bloquean);
--   en_vuelo    = reservas aún sin comparar (con fallos + en_vuelo >= tope → «ocupado», reintento corto);
--   vuelo_hasta = caducidad de esas reservas (una invocación caída a mitad no las deja ocupadas para siempre);
--   token       = reserva de la última petición (para reservar el hueco global en el mismo lote).

ALTER TABLE intentos_pin ADD COLUMN en_vuelo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE intentos_pin ADD COLUMN vuelo_hasta INTEGER;
ALTER TABLE intentos_pin ADD COLUMN token TEXT;

ALTER TABLE pin_global ADD COLUMN en_vuelo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE pin_global ADD COLUMN vuelo_hasta INTEGER;

-- ORACLE · tope global de PIN fallidos (spec §11): más de 50 fallos entre todas las IPs en una ventana
-- de 15 min bloquean la comprobación del PIN para todos durante 15 min. Una sola fila (id = 1).

CREATE TABLE pin_global (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  desde INTEGER NOT NULL,                 -- inicio de la ventana de 15 min en curso
  fallos INTEGER NOT NULL,                -- PIN comparados (y no acertados) en la ventana
  bloqueado_hasta INTEGER
);

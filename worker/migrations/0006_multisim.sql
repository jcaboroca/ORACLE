-- ORACLE · Bot con varias estrategias en vivo (spec del laboratorio §6): una simulación activa POR ESTRATEGIA,
-- en lugar de una sola en total. Las simulaciones existentes no cambian: la v1 activa sigue activa hasta que el
-- cron de mercado la cierre porque su estrategia ya no está en ESTRATEGIAS_EN_VIVO (queda en el historial).
DROP INDEX una_activa;
CREATE UNIQUE INDEX una_activa_por_estrategia ON simulaciones(estrategia_version) WHERE activa = 1;

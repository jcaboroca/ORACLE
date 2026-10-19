-- ORACLE · Caché de datos de mercado (spec §4, §9 y §10). Las velas cerradas no cambian y el funding se liquida
-- cada 8 h: guardarlos evita pedir a OKX en cada ejecución lo que ya se tiene (menos 429 por la IP compartida de
-- Cloudflare y menos JSON que parsear). Una fila por serie; nada crece con la historia.

-- Últimas velas CERRADAS de OKX por serie: 300 USDT (1h/4h/1d) y 47 EUR (1h).
-- velas_json = [[inicio, apertura, máximo, mínimo, cierre, volumen], …] en orden ascendente.
CREATE TABLE cache_velas (
  instrumento TEXT NOT NULL,                    -- BTC-USDT, BTC-EUR…
  intervalo TEXT NOT NULL CHECK (intervalo IN ('1h', '4h', '1d')),
  velas_json TEXT NOT NULL,
  actualizado_en INTEGER NOT NULL,              -- ms de la ejecución que la escribió
  PRIMARY KEY (instrumento, intervalo)
);

-- Funding del perpetuo {SYM}-USDT-SWAP (fracción por 8 h), refrescado como mucho cada 8 h.
CREATE TABLE cache_funding (
  simbolo TEXT PRIMARY KEY,
  valor REAL NOT NULL,
  actualizado_en INTEGER NOT NULL
);

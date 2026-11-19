-- ============================================================
-- Buscador de oportunidades: productos descubiertos.
-- Aditivo: crea dos tablas nuevas, no toca las existentes.
--
-- buscador_descubiertos: productos nuevos que el pre-analisis encuentra en las
-- busquedas en tendencia de MercadoLibre (/trends/MLA/{cat}) y que la API de
-- Anthropic completa con la misma ficha que el CATALOGO fijo (api/analyze.js).
-- Los nombres de columna en camelCase ("volCm3", "costoMin", ...) son los
-- mismos campos del catalogo, para que la fila se use tal cual.
--   activo=false: lo desactivo el sistema (2 analisis seguidos sin datos o con
--   "No conviene") o a mano. No se borra: asi no se vuelve a descubrir.
--
-- buscador_descubrimiento_corridas: ultima corrida de descubrimiento por rubro
-- (una por semana). Una corrida que fallo no se anota y se reintenta.
--
-- Mismo criterio que cerrar_policies_abiertas.sql: RLS activado y SIN
-- policies. El servidor entra con la service_role.
-- ============================================================

CREATE TABLE IF NOT EXISTS buscador_descubiertos (
  id             BIGSERIAL PRIMARY KEY,
  nicho          TEXT NOT NULL,
  nombre         TEXT NOT NULL,
  q              TEXT NOT NULL,
  keyword_en     TEXT,
  "volCm3"       INTEGER NOT NULL,
  "costoMin"     NUMERIC(10,2) NOT NULL,
  "costoMax"     NUMERIC(10,2) NOT NULL,
  "pesoG"        INTEGER NOT NULL,
  nota           TEXT,
  origen         TEXT,                 -- "trends/MLA/<cat> #<posicion>"
  cat            TEXT,                 -- categoria de MeLi de la tendencia (filtro de ofertas)
  keyword_origen TEXT,                 -- la busqueda en tendencia tal cual
  descubierto_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activo         BOOLEAN NOT NULL DEFAULT TRUE,
  analisis       INTEGER NOT NULL DEFAULT 0,
  fallos         INTEGER NOT NULL DEFAULT 0,   -- analisis seguidos sin datos o "No conviene"
  ultimo_estado  TEXT,
  actualizado    TIMESTAMPTZ,
  UNIQUE (nicho, q)
);
CREATE INDEX IF NOT EXISTS idx_buscador_descubiertos_nicho ON buscador_descubiertos(nicho, activo, descubierto_en DESC);
ALTER TABLE buscador_descubiertos ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS buscador_descubrimiento_corridas (
  nicho      TEXT PRIMARY KEY,
  corrido_en TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resultado  JSONB
);
ALTER TABLE buscador_descubrimiento_corridas ENABLE ROW LEVEL SECURITY;

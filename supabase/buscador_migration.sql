-- ============================================================
-- Buscador de oportunidades: cache por nicho y "Mi lista".
-- Aditivo: crea dos tablas nuevas, no toca las existentes.
--
-- buscador_cache: el MERCADO de los 12 productos de un nicho (publicaciones,
-- comision de la categoria, tendencia), 24 h (BUSCADOR_CACHE_HORAS). El perfil
-- se aplica encima en cada consulta, asi que cambiar capital/canal/riesgo no
-- vuelve a consultar MercadoLibre. Si la tabla no existe, todo anda sin cache.
--
-- buscador_lista: "Guardar en mi lista", por usuario de la sesion firmada.
--
-- Mismo criterio que cerrar_policies_abiertas.sql: RLS activado y SIN
-- policies. El servidor entra con la service_role (saltea RLS); anon y
-- authenticated quedan sin acceso.
-- ============================================================

CREATE TABLE IF NOT EXISTS buscador_cache (
  nicho      TEXT PRIMARY KEY,
  mercado    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { "<query>": {results, total, comision, tendencia, ...} | null }
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE buscador_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS buscador_lista (
  user_id      TEXT NOT NULL,
  producto_key TEXT NOT NULL,                       -- "<nicho>::<query>"
  producto     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- resumen: nombre, margen, score, veredicto, links
  nicho        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, producto_key)
);
CREATE INDEX IF NOT EXISTS idx_buscador_lista_user ON buscador_lista(user_id, created_at DESC);
ALTER TABLE buscador_lista ENABLE ROW LEVEL SECURITY;

-- Tokens de corrida de un solo uso para el pre-analisis (api/_precalculo.js).
-- CRON_SECRET y ADMIN_KEY solo existen en produccion; esto permite correr el
-- proceso a mano sobre un preview. Se insertan a mano con vencimiento corto:
--   INSERT INTO buscador_job_tokens(token, motivo, expires_at)
--   VALUES (encode(gen_random_bytes(24),'hex'), 'corrida manual', NOW() + INTERVAL '2 hours');
CREATE TABLE IF NOT EXISTS buscador_job_tokens (
  token      TEXT PRIMARY KEY,
  motivo     TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE buscador_job_tokens ENABLE ROW LEVEL SECURITY;

-- Rotacion real (vendidos) con Apify, solo en el proceso nocturno y solo para
-- el top 3 de cada nicho. Una fila por producto y por medicion. La variacion
-- entre dos mediciones cosechadas es la rotacion.
--   estado: en_cola | arrancada | cosechada | fallida | sin_presupuesto
CREATE TABLE IF NOT EXISTS buscador_vendidos (
  id             BIGSERIAL PRIMARY KEY,
  query          TEXT NOT NULL,
  nicho          TEXT,
  estado         TEXT NOT NULL,
  item_ids       TEXT[],
  run_id         TEXT,
  dataset_id     TEXT,
  gasto_id       BIGINT,
  items          JSONB,             -- [{id, vendidos, vendidos_texto, reviews, rating, precio, titulo}]
  vendidos_total INTEGER,           -- suma del piso de cada rango ("+100" = 100)
  reviews_total  INTEGER,
  costo_usd      NUMERIC,           -- costo real de la corrida, prorrateado por producto
  motivo         TEXT,
  creado         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  medido_en      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_buscador_vendidos_query ON buscador_vendidos(query, creado DESC);
CREATE INDEX IF NOT EXISTS idx_buscador_vendidos_estado ON buscador_vendidos(estado);
ALTER TABLE buscador_vendidos ENABLE ROW LEVEL SECURITY;

-- Productos de catalogo que dieron 404 en /products/{id}/items (sin ofertas):
-- se saltean 30 dias para no repetir la llamada (~70% de las llamadas eran 404).
CREATE TABLE IF NOT EXISTS buscador_sin_ofertas (
  producto_id TEXT PRIMARY KEY,
  visto       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE buscador_sin_ofertas ENABLE ROW LEVEL SECURITY;

-- Busquedas de visitantes por nicho: el proceso nocturno prioriza los nichos
-- buscados en los ultimos 7 dias.
CREATE TABLE IF NOT EXISTS buscador_busquedas (
  id    BIGSERIAL PRIMARY KEY,
  nicho TEXT NOT NULL,
  ts    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_buscador_busquedas_ts ON buscador_busquedas(ts DESC);
ALTER TABLE buscador_busquedas ENABLE ROW LEVEL SECURITY;

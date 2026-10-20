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

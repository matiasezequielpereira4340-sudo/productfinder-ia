-- ============================================================
-- MeLi Connect - Analizador de Publicaciones (Funcionalidad 2)
-- Tabla de cache + historial de analisis.
--
-- Corre este SQL UNA sola vez en el SQL Editor de Supabase
-- (proyecto existente, el mismo de la app). No crea infra nueva.
--
-- Para que sirve cada cosa:
--   * cache: si un item ya se analizo hace poco (< 12h en el
--     endpoint) se reusa la fila mas reciente y no se le pega
--     de mas a los rate limits de la API de MercadoLibre.
--   * historial: cada corrida queda guardada con su fecha, asi
--     a los 30 dias se puede re-correr y mostrar si mejoro el
--     score (motivo de vuelta a la app / lead magnet del embudo).
-- ============================================================

CREATE TABLE IF NOT EXISTS listing_analyses (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id      TEXT NOT NULL,           -- ej: MLA123456789
  input_url    TEXT,                    -- link que pego el usuario
  user_id      TEXT,                    -- opcional (alumno logueado), null si es prueba anonima
  category_id  TEXT,                    -- categoria de MeLi para segmentar
  score_total  INTEGER,                 -- 0-100, para graficar la evolucion
  report       JSONB NOT NULL,          -- informe completo (secciones, comparacion, cta, etc.)
  analyzed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Busquedas por item (cache + historial + evolucion a 30 dias)
CREATE INDEX IF NOT EXISTS idx_listing_analyses_item      ON listing_analyses(item_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_analyses_user      ON listing_analyses(user_id, analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_listing_analyses_analyzed  ON listing_analyses(analyzed_at DESC);

-- Mismo patron de seguridad que el resto de las tablas del proyecto:
-- el endpoint entra con la service_role key (server-side, nunca expuesta al front).
ALTER TABLE listing_analyses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'listing_analyses' AND policyname = 'service_role_all_listing_analyses'
  ) THEN
    CREATE POLICY "service_role_all_listing_analyses"
      ON listing_analyses FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

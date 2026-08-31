-- ============================================================
-- Cache de busquedas de mercado.
-- Corre este SQL una sola vez en el SQL Editor de Supabase.
--
-- Para que sirve: cada busqueda que termina en el proveedor externo (Apify)
-- cuesta plata, y el actor cobra el lote entero de 48 resultados aunque se
-- pidan menos. El recomendador repite los mismos 12 terminos de un nicho en
-- cada corrida: con el cache, la segunda corrida del dia no gasta nada.
--
-- La ventana se controla con BUSQUEDA_CACHE_HORAS (default 12; 0 lo apaga).
-- Si esta tabla no existe, la app funciona igual, sin cache.
-- ============================================================

CREATE TABLE IF NOT EXISTS busquedas_cache (
  termino    TEXT PRIMARY KEY,        -- termino normalizado (minusculas, sin acentos)
  fuente     TEXT,                    -- de que via salio el dato
  total      INTEGER,                 -- publicaciones totales, si la via lo expone
  categoria  TEXT,
  resultados JSONB NOT NULL DEFAULT '[]'::jsonb,  -- publicaciones ya normalizadas
  -- Una corrida del scraper tarda mas de 50 s, o sea que no entra en un
  -- request. Se arranca, se anota el id aca, y la consulta siguiente levanta
  -- el resultado sin volver a pagar.
  run_id      TEXT,
  dataset_id  TEXT,
  run_estado  TEXT,
  run_desde   TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Si la tabla ya existia de la version anterior:
ALTER TABLE busquedas_cache ADD COLUMN IF NOT EXISTS run_id     TEXT;
ALTER TABLE busquedas_cache ADD COLUMN IF NOT EXISTS dataset_id TEXT;
ALTER TABLE busquedas_cache ADD COLUMN IF NOT EXISTS run_estado TEXT;
ALTER TABLE busquedas_cache ADD COLUMN IF NOT EXISTS run_desde  TIMESTAMPTZ;
ALTER TABLE busquedas_cache ALTER COLUMN resultados SET DEFAULT '[]'::jsonb;

-- Para limpiar lo viejo y para el filtro por antiguedad.
CREATE INDEX IF NOT EXISTS idx_busquedas_cache_fecha ON busquedas_cache(created_at DESC);

-- Mismo patron que el resto: se entra con la service_role key, server-side.
ALTER TABLE busquedas_cache ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'busquedas_cache' AND policyname = 'service_role_all_busquedas_cache'
  ) THEN
    CREATE POLICY "service_role_all_busquedas_cache"
      ON busquedas_cache FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Opcional, para que no crezca sin control:
-- DELETE FROM busquedas_cache WHERE created_at < NOW() - INTERVAL '7 days';

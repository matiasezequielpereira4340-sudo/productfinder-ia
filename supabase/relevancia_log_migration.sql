-- ============================================================
-- Registro de relevancia de busquedas.
-- Corre este SQL una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- PARA QUE SIRVE, y por que no es opcional:
--
-- MercadoLibre casi nunca devuelve cero. Ante una busqueda sin coincidencias
-- sirve resultados DE RESCATE (bujias cuando se busca un proyector) y los
-- presenta como normales. Para distinguir "esto no se vende aca" de "MeLi me
-- mando cualquier cosa", el Market Reader calcula un ratio de relevancia: que
-- fraccion de las palabras de la busqueda aparece en los titulos devueltos.
--
-- Los umbrales de ese ratio (RELEVANCIA_UMBRAL_ALTO / BAJO en api/_meli.js)
-- estan calibrados contra titulos escritos a mano, NO contra datos reales:
-- desde donde corre el codigo no hay salida a MercadoLibre. Esta tabla es el
-- unico camino para recalibrarlos con busquedas de verdad.
--
-- Sin esta tabla el registro vive solo en memoria del proceso, y un cold start
-- de Vercel lo vacia. La app funciona igual, pero la instrumentacion no sirve:
-- nunca vas a juntar suficientes consultas para decidir nada.
--
-- Se lee con:  GET /api/market?relevancia=1   (cabecera x-admin-key: ADMIN_KEY)
-- ============================================================

CREATE TABLE IF NOT EXISTS relevancia_log (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW(),  -- cuando se midio
  query      TEXT NOT NULL,                       -- lo que se busco
  site       TEXT,                                -- MLA / MLB / MLM
  palabras   JSONB DEFAULT '[]'::jsonb,           -- palabras significativas usadas
  ratio      NUMERIC,                             -- 0..1, promedio ponderado
  estado     TEXT,                                -- existe | dudoso | noExiste
  muestra    INTEGER,                             -- publicaciones devueltas por MeLi
  relevantes INTEGER,                             -- las que tienen al menos una palabra
  -- Los primeros 5 titulos DEVUELTOS, crudos, incluidos los de rescate.
  -- Son los que sirven para recalibrar: sin ellos, un ratio suelto no dice
  -- por que dio lo que dio.
  titulos    JSONB DEFAULT '[]'::jsonb,
  -- Con que umbrales se tomo la decision. Si despues se cambian, hace falta
  -- saber cuales regian en cada medicion para no comparar peras con manzanas.
  umbrales   JSONB DEFAULT '{}'::jsonb
);

-- Para leer las ultimas N, que es como se consulta siempre.
CREATE INDEX IF NOT EXISTS idx_relevancia_log_ts ON relevancia_log(ts DESC);
-- Para agrupar por estado al recalibrar.
CREATE INDEX IF NOT EXISTS idx_relevancia_log_estado ON relevancia_log(estado);

-- Mismo patron que el resto: se entra con la service_role key, server-side.
ALTER TABLE relevancia_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'relevancia_log' AND policyname = 'service_role_all_relevancia_log'
  ) THEN
    CREATE POLICY "service_role_all_relevancia_log"
      ON relevancia_log FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- COMO RECALIBRAR, cuando haya unos dias de uso real.
--
-- 1) Los productos que el usuario SABE que se venden y quedaron en 'dudoso' o
--    'noExiste' son falsos negativos. Son el error grave: invisible, y el
--    usuario no vuelve a mirar ese producto.
--      SELECT query, ratio, estado, muestra, titulos
--      FROM relevancia_log
--      WHERE estado <> 'existe'
--      ORDER BY ts DESC LIMIT 50;
--
-- 2) El reparto general dice si los umbrales estan bien puestos. Si casi todo
--    cae en 'dudoso', el techo (0.35) esta alto.
--      SELECT estado, COUNT(*), ROUND(AVG(ratio)::numeric, 3) AS ratio_medio
--      FROM relevancia_log GROUP BY estado;
--
-- 3) Para ver si el largo de la consulta corre el ratio (el sesgo que se
--    intento sacar con el peso por posicion):
--      SELECT jsonb_array_length(palabras) AS n_palabras,
--             COUNT(*), ROUND(AVG(ratio)::numeric, 3) AS ratio_medio
--      FROM relevancia_log GROUP BY 1 ORDER BY 1;
--
-- Opcional, para que no crezca sin control:
-- DELETE FROM relevancia_log WHERE ts < NOW() - INTERVAL '90 days';
-- ============================================================

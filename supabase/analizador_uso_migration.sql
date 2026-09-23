-- ============================================================
-- Analizador de publicaciones: limite de analisis gratis por IP.
--
-- Corre este SQL UNA sola vez en el SQL Editor de Supabase (el mismo
-- proyecto de la app). Es idempotente: se puede volver a correr.
--
-- Sin esta tabla el Analizador funciona igual, pero cuenta en memoria de
-- cada instancia de Vercel: el limite de 3 por IP y el tope global de 100
-- por dia pasan a ser aproximados. En los logs aparece
-- "[analizador] tabla analizador_uso no disponible".
--
-- La IP NUNCA se guarda en crudo: ip_hash es un HMAC-SHA256 con una clave
-- del servidor (SESSION_SECRET o ADMIN_KEY). La fila '__global__' lleva el
-- total del dia de todos.
-- ============================================================

CREATE TABLE IF NOT EXISTS analizador_uso (
  ip_hash      TEXT        NOT NULL,
  fecha        DATE        NOT NULL,          -- dia calendario de Argentina
  cantidad     INTEGER     NOT NULL DEFAULT 0,
  actualizado  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ip_hash, fecha)
);

CREATE INDEX IF NOT EXISTS idx_analizador_uso_fecha ON analizador_uso(fecha);

ALTER TABLE analizador_uso ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'analizador_uso' AND policyname = 'service_role_all_analizador_uso'
  ) THEN
    CREATE POLICY "service_role_all_analizador_uso"
      ON analizador_uso FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Suma 1 a la IP y al total del dia en una sola transaccion (sin carreras
-- entre dos analisis simultaneos). Devuelve los dos contadores ya sumados.
CREATE OR REPLACE FUNCTION analizador_sumar(p_ip_hash TEXT, p_fecha DATE)
RETURNS TABLE (ip INTEGER, global INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip INTEGER;
  v_global INTEGER;
BEGIN
  INSERT INTO analizador_uso (ip_hash, fecha, cantidad) VALUES (p_ip_hash, p_fecha, 1)
  ON CONFLICT (ip_hash, fecha)
  DO UPDATE SET cantidad = analizador_uso.cantidad + 1, actualizado = NOW()
  RETURNING cantidad INTO v_ip;

  INSERT INTO analizador_uso (ip_hash, fecha, cantidad) VALUES ('__global__', p_fecha, 1)
  ON CONFLICT (ip_hash, fecha)
  DO UPDATE SET cantidad = analizador_uso.cantidad + 1, actualizado = NOW()
  RETURNING cantidad INTO v_global;

  RETURN QUERY SELECT v_ip, v_global;
END;
$$;

-- Solo el servidor (service_role) puede llamarla.
REVOKE ALL ON FUNCTION analizador_sumar(TEXT, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION analizador_sumar(TEXT, DATE) TO service_role;

-- Limpieza opcional (las filas son chicas; con una vez por mes alcanza):
-- DELETE FROM analizador_uso WHERE fecha < CURRENT_DATE - 30;

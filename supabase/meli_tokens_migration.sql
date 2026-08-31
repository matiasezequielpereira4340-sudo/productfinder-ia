-- ============================================================
-- Conexion con MercadoLibre: tablas que usa el OAuth.
-- Corre este SQL una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
--   meli_tokens        -> el token de cada cuenta conectada.
--   meli_user_aliases  -> puente entre el usuario con el que se entra a la
--                         app y el usuario con el que se conecto MercadoLibre.
--                         Hace falta cuando se cambia APP_USER: sin el, la
--                         conexion sigue viva en la base pero la app la busca
--                         con el nombre nuevo y la da por inexistente.
-- ============================================================

CREATE TABLE IF NOT EXISTS meli_tokens (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       TEXT NOT NULL,          -- usuario de ProductFinder (el del login)
  meli_user_id  TEXT NOT NULL,          -- id numerico de la cuenta de MercadoLibre
  access_token  TEXT NOT NULL,
  refresh_token TEXT,                   -- sin esto la conexion se cae a las 6 h
  expires_at    TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- El upsert del callback entra por on_conflict=user_id: sin este UNIQUE,
-- conectar la cuenta falla con "no unique or exclusion constraint matching".
CREATE UNIQUE INDEX IF NOT EXISTS meli_tokens_user_id_uidx ON meli_tokens(user_id);

CREATE TABLE IF NOT EXISTS meli_user_aliases (
  alias      TEXT PRIMARY KEY,  -- usuario con el que se entra hoy a la app
  user_id    TEXT NOT NULL,     -- usuario con el que esta guardado el token
  nota       TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Los endpoints entran con la service_role key (server-side, nunca expuesta
-- al front): mismo patron que el resto de las tablas del proyecto.
ALTER TABLE meli_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE meli_user_aliases ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meli_tokens' AND policyname='service_role_all_meli_tokens') THEN
    CREATE POLICY "service_role_all_meli_tokens" ON meli_tokens FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='meli_user_aliases' AND policyname='service_role_all_meli_user_aliases') THEN
    CREATE POLICY "service_role_all_meli_user_aliases" ON meli_user_aliases FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Ejemplo: si cambias APP_USER, apunta el nombre nuevo a la conexion vieja
-- en vez de volver a autorizar la app.
-- INSERT INTO meli_user_aliases (alias, user_id, nota)
-- VALUES ('usuario_nuevo', 'matypereira', 'APP_USER nuevo -> conexion existente')
-- ON CONFLICT (alias) DO UPDATE SET user_id = EXCLUDED.user_id;

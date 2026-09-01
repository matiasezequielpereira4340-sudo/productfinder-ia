-- ============================================================
-- Costos propios y tipo de cambio del vendedor.
-- Corre este SQL una sola vez en el SQL Editor de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Para que sirve: sin el costo de compra, el dashboard solo puede descontar
-- la comision de MercadoLibre y el envio, y termina mostrando casi todo el
-- precio de venta como ganancia (85% donde el margen real puede ser 30%).
-- Estas dos tablas son lo que convierte ese numero en uno de verdad.
-- ============================================================

CREATE TABLE IF NOT EXISTS productos_costos (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            TEXT NOT NULL,    -- usuario de la app (el canonico, ver meli_user_aliases)
  meli_item_id       TEXT NOT NULL,    -- MLA de la publicacion
  titulo             TEXT,
  costo_usd          NUMERIC,          -- costo de compra por unidad, en dolares
  costo_embalaje_ars NUMERIC,          -- embalaje por unidad, en pesos
  notas              TEXT,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- El upsert de /api/costos entra por on_conflict=user_id,meli_item_id.
CREATE UNIQUE INDEX IF NOT EXISTS productos_costos_user_item_uidx
  ON productos_costos(user_id, meli_item_id);

CREATE TABLE IF NOT EXISTS clientes (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         TEXT NOT NULL,
  nombre          TEXT NOT NULL,
  email           TEXT,
  tipo_cambio_usd NUMERIC,   -- si esta cargado manda sobre el dolar del dia
  margen_objetivo NUMERIC,
  activo          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS clientes_user_id_uidx ON clientes(user_id);

-- Mismo patron que el resto: se entra con la service_role key, server-side.
ALTER TABLE productos_costos ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='productos_costos' AND policyname='service_role_all_productos_costos') THEN
    CREATE POLICY "service_role_all_productos_costos" ON productos_costos FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clientes' AND policyname='service_role_all_clientes') THEN
    CREATE POLICY "service_role_all_clientes" ON clientes FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

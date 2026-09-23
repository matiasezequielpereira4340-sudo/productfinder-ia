-- ============================================================
-- OPCIONAL, revisar antes de correr. Cierra las 4 tablas que hoy tienen una
-- policy abierta a TODOS los roles (verificado en produccion el 23/09/2026
-- con pg_policies: roles {public}, ALL, USING true):
--
--   apify_gasto, busquedas_cache, listing_analyses, relevancia_log
--
-- Una policy "FOR ALL USING (true)" sin "TO service_role" aplica tambien a la
-- clave anon: quien la tenga puede leer, modificar y borrar esas tablas. Hoy
-- la clave anon no aparece en el front de la app, pero no hay que depender de
-- eso.
--
-- Por que es seguro: el servidor usa la service_role, que saltea RLS. Con RLS
-- activado y sin policies, el servidor sigue funcionando igual y anon /
-- authenticated quedan sin acceso.
-- ============================================================

DROP POLICY IF EXISTS "service_role_all_apify_gasto"      ON apify_gasto;
DROP POLICY IF EXISTS "service_role_all_busquedas_cache"  ON busquedas_cache;
DROP POLICY IF EXISTS "service_role_all_listing_analyses" ON listing_analyses;
DROP POLICY IF EXISTS "service_role_all_relevancia_log"   ON relevancia_log;

ALTER TABLE apify_gasto      ENABLE ROW LEVEL SECURITY;
ALTER TABLE busquedas_cache  ENABLE ROW LEVEL SECURITY;
ALTER TABLE listing_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE relevancia_log   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE apify_gasto, busquedas_cache, listing_analyses, relevancia_log FROM anon, authenticated;

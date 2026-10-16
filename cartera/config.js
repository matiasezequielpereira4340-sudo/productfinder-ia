/* =====================================================================
   CONFIGURACIÓN DE SUPABASE — ÚNICO LUGAR DONDE ESTÁN LA URL Y LA CLAVE
   ---------------------------------------------------------------------
   · supabaseUrl:     "Project URL" (Supabase → Project Settings → API)
   · supabaseAnonKey: clave "anon public". Es pública por diseño: los
                      datos los protege Row Level Security (ver supabase.sql).
   · NUNCA pongas acá la clave "service_role" (salta toda la seguridad).
   La usan la app (index.html) y el cron que evita la pausa (api/keepalive.js).
   ===================================================================== */
(function (root) {
  var CARTERA_CONFIG = {
    supabaseUrl: 'https://uuxvgrvhezkpkoidrtso.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV1eHZncnZoZXprcGtvaWRydHNvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIxODM3NDUsImV4cCI6MjEwNzc1OTc0NX0.lHwVtTXisDgxG3lEh2SdjmqEfGI9Xkne9tRL00Ggm9g'
  };
  if (typeof module === 'object' && module.exports) module.exports = CARTERA_CONFIG;
  else root.CARTERA_CONFIG = CARTERA_CONFIG;
})(this);

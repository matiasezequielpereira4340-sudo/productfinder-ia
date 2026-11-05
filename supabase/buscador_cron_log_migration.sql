-- buscador_cron_log: una fila por tanda del pre-analisis nocturno (cron).
-- Sirve para ver hasta donde llega la cadena cada noche y si Apify arranco.
-- Solo la escribe el backend con la service key (RLS activado, sin politicas
-- publicas: anon/authenticated no leen ni escriben).
create table if not exists public.buscador_cron_log (
  id bigserial primary key,
  ts timestamptz not null default now(),
  hop integer,
  procesados text[],
  pendientes integer,
  nichos_pendientes integer,
  apify_inicial jsonb,
  apify_final jsonb,
  encadenado text,            -- 'timeout-3s' (esperado), 'respondio' (status en el detalle), 'error'
  encadenado_detalle jsonb,
  ms integer
);
alter table public.buscador_cron_log enable row level security;
create index if not exists buscador_cron_log_ts on public.buscador_cron_log (ts desc);

-- Revision de una noche:
-- select ts, hop, procesados, pendientes, encadenado, encadenado_detalle->>'status' status,
--        apify_inicial->>'arrancada' apify_ini, apify_inicial->>'motivo' motivo_ini
-- from buscador_cron_log where ts > now() - interval '1 day' order by ts;

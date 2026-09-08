-- supabase/apify_gasto_migration.sql
-- ------------------------------------------------------------
-- Tope diario de corridas pagas de Apify + auditoria de gasto.
--
-- Una fila = una corrida (o un intento de corrida). Se inserta ANTES de
-- arrancar el actor, no despues: asi dos requests simultaneos no pueden pasar
-- los dos el mismo cupo. Si la corrida no llega a arrancar, la fila queda en
-- estado 'anulada' y deja de contar contra el tope.
--
-- El contador NO puede vivir en memoria del proceso: Vercel mata y levanta
-- lambdas todo el tiempo, y un contador en memoria se reinicia en cada cold
-- start (o sea, no hay tope).
-- ------------------------------------------------------------

create table if not exists public.apify_gasto (
  id             bigserial primary key,
  ts             timestamptz not null default now(),
  -- Dia calendario ARGENTINO (America/Argentina/Buenos_Aires). Lo calcula la
  -- app y lo manda ya resuelto: con UTC el tope se reiniciaria a las 21:00
  -- hora de Buenos Aires, en el medio de la tarde de trabajo.
  dia            date not null,
  termino        text,
  site           text default 'MLA',
  run_id         text,
  dataset_id     text,
  enriquecido    boolean default true,
  items          integer,
  -- Estimacion, no factura: items * precio por item del actor.
  costo_estimado numeric(10,4),
  -- 'reservada' -> cupo tomado, corrida todavia no arrancada
  -- 'arrancada' -> corrida arrancada, run_id anotado
  -- 'anulada'   -> no arranco o se aborto; no cuenta contra el tope
  estado         text not null default 'reservada',
  origen         text,
  motivo         text
);

-- El conteo del dia es la consulta caliente: se hace antes de CADA corrida.
create index if not exists apify_gasto_dia_estado_idx
  on public.apify_gasto (dia, estado);

create index if not exists apify_gasto_ts_idx
  on public.apify_gasto (ts desc);

create index if not exists apify_gasto_run_id_idx
  on public.apify_gasto (run_id);

alter table public.apify_gasto enable row level security;

drop policy if exists service_role_all_apify_gasto on public.apify_gasto;
create policy service_role_all_apify_gasto
  on public.apify_gasto for all
  using (true) with check (true);

-- ------------------------------------------------------------
-- Consultas de auditoria (las mismas que sirve /api/market?gasto=1)
-- ------------------------------------------------------------

-- En que termino se fue la plata, ultimos 30 dias:
--   select termino,
--          count(*) as corridas,
--          sum(costo_estimado) as usd_estimado,
--          count(*) filter (where enriquecido) as enriquecidas
--   from apify_gasto
--   where estado <> 'anulada' and ts > now() - interval '30 days'
--   group by termino order by usd_estimado desc;

-- Gasto por dia:
--   select dia, count(*) as corridas, sum(costo_estimado) as usd_estimado
--   from apify_gasto where estado <> 'anulada'
--   group by dia order by dia desc;

-- Corridas que quedaron reservadas y nunca arrancaron (deberian ser 0):
--   select * from apify_gasto where estado = 'reservada'
--     and ts < now() - interval '1 hour' order by ts desc;

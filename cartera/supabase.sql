-- =====================================================================
-- CONTROL DE CARTERA — esquema para Supabase
-- Pegar TODO este archivo en el SQL Editor de Supabase y tocar "Run".
-- Se puede correr más de una vez sin romper nada.
--
-- Diseño: un documento JSON por usuario (tabla carteras) con número de
-- versión, más un historial automático de versiones anteriores
-- (tabla carteras_historial) que el usuario puede leer pero NO borrar.
-- =====================================================================

-- 1) Cartera actual: una fila por usuario --------------------------------
create table if not exists public.carteras (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb       not null,
  version     integer     not null default 1,
  updated_at  timestamptz not null default now(),
  constraint carteras_data_objeto check (jsonb_typeof(data) = 'object')
);

-- 2) Historial: copia de cada versión anterior --------------------------
create table if not exists public.carteras_historial (
  id          bigint generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete cascade,
  version     integer     not null,
  data        jsonb       not null,
  guardado_en timestamptz not null default now()
);
create index if not exists carteras_historial_user_id_idx on public.carteras_historial (user_id, id desc);

-- 3) Row Level Security: cada usuario sólo ve y toca lo suyo -------------
alter table public.carteras           enable row level security;
alter table public.carteras_historial enable row level security;

drop policy if exists "carteras: leer la propia"      on public.carteras;
drop policy if exists "carteras: crear la propia"     on public.carteras;
drop policy if exists "carteras: modificar la propia" on public.carteras;
create policy "carteras: leer la propia"      on public.carteras for select to authenticated using ((select auth.uid()) = user_id);
create policy "carteras: crear la propia"     on public.carteras for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "carteras: modificar la propia" on public.carteras for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- (a propósito NO hay política de DELETE: desde la app nadie puede borrar su fila)

drop policy if exists "historial: leer el propio" on public.carteras_historial;
create policy "historial: leer el propio" on public.carteras_historial for select to authenticated using ((select auth.uid()) = user_id);
-- (sin INSERT/UPDATE/DELETE: el historial lo escribe sólo el trigger de abajo)

-- Permisos explícitos (los anónimos no tocan nada)
revoke all on public.carteras, public.carteras_historial from anon, authenticated;
grant select, insert, update on public.carteras           to authenticated;
grant select                 on public.carteras_historial to authenticated;

-- 4) Trigger: antes de cada cambio, guarda la versión anterior ----------
--    Conserva las últimas 300 versiones + la última de cada día (para siempre).
create or replace function public.carteras_guardar_historial()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.data is distinct from new.data then
    insert into public.carteras_historial (user_id, version, data)
    values (old.user_id, old.version, old.data);

    delete from public.carteras_historial h
     where h.user_id = old.user_id
       and h.id not in (select id from public.carteras_historial
                         where user_id = old.user_id order by id desc limit 300)
       and h.id not in (select max(id) from public.carteras_historial
                         where user_id = old.user_id
                         group by (guardado_en at time zone 'America/Argentina/Buenos_Aires')::date);
  end if;
  return new;
end;
$$;
revoke all on function public.carteras_guardar_historial() from public, anon, authenticated;

drop trigger if exists carteras_historial_trg on public.carteras;
create trigger carteras_historial_trg
  before update on public.carteras
  for each row execute function public.carteras_guardar_historial();

-- 5) Guardar con control de versión ------------------------------------
--    Devuelve la versión nueva, o -1 si otro dispositivo guardó antes
--    (la app entonces combina los cambios y reintenta).
create or replace function public.guardar_cartera(p_data jsonb, p_version integer)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new integer;
begin
  if v_uid is null then
    raise exception 'No hay sesión iniciada' using errcode = '28000';
  end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;

  if coalesce(p_version, 0) = 0 then
    insert into public.carteras (user_id, data, version)
    values (v_uid, p_data, 1)
    on conflict (user_id) do nothing
    returning version into v_new;
  else
    update public.carteras
       set data = p_data, version = version + 1, updated_at = now()
     where user_id = v_uid and version = p_version
    returning version into v_new;
  end if;

  return coalesce(v_new, -1);
end;
$$;
revoke all on function public.guardar_cartera(jsonb, integer) from public, anon;
grant execute on function public.guardar_cartera(jsonb, integer) to authenticated;

-- 6) Resumen del historial (para la pantalla "Historial en la nube") ----
create or replace function public.historial_cartera()
returns table (id bigint, version integer, guardado_en timestamptz, clientes integer, prestamos integer, pagos integer)
language sql
stable
security invoker
set search_path = public
as $$
  select h.id, h.version, h.guardado_en,
         coalesce(jsonb_array_length(h.data -> 'clients'), 0),
         coalesce(jsonb_array_length(h.data -> 'loans'), 0),
         coalesce(jsonb_array_length(h.data -> 'payments'), 0)
    from public.carteras_historial h
   where h.user_id = auth.uid()
   order by h.id desc
   limit 60;
$$;
revoke all on function public.historial_cartera() from public, anon;
grant execute on function public.historial_cartera() to authenticated;

-- 7) Ping liviano para que el proyecto gratis no se pause -------------
create or replace function public.ping()
returns text
language sql
stable
as $$ select 'ok'::text $$;
grant execute on function public.ping() to anon, authenticated;

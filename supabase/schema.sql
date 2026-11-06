-- ═══════════════════════════════════════════════════════════════
--  TRAZOS · Base de datos para Supabase
--  Pega TODO este archivo en Supabase → SQL Editor → Run.
--  Se puede volver a ejecutar sin romper nada.
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── Tablas ─────────────────────────────────────────────────────

create table if not exists public.sesiones (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null check (codigo ~ '^[0-9]{4}$'),
  profe_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  estado     text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  creada_en  timestamptz not null default now()
);
-- Un mismo código no puede estar en dos sesiones abiertas a la vez
create unique index if not exists sesiones_codigo_abierta on public.sesiones (codigo) where estado = 'abierta';

create table if not exists public.rondas (
  id               uuid primary key default gen_random_uuid(),
  sesion_id        uuid not null references public.sesiones(id) on delete cascade,
  numero           int  not null,
  consigna         text not null default '',
  mostrar_consigna boolean not null default true,
  abierta          boolean not null default true,
  termina_en       timestamptz,
  creada_en        timestamptz not null default now(),
  unique (sesion_id, numero)
);

create table if not exists public.participantes (
  id         uuid primary key default gen_random_uuid(),
  sesion_id  uuid not null references public.sesiones(id) on delete cascade,
  nombre     text not null check (char_length(nombre) between 1 and 30),
  token      uuid not null default gen_random_uuid(),
  creado_en  timestamptz not null default now()
);
create index if not exists participantes_sesion on public.participantes (sesion_id);

create table if not exists public.dibujos (
  id              uuid primary key default gen_random_uuid(),
  sesion_id       uuid not null references public.sesiones(id) on delete cascade,
  ronda_id        uuid not null references public.rondas(id) on delete cascade,
  participante_id uuid not null references public.participantes(id) on delete cascade,
  nombre          text not null,
  ruta            text not null,
  creado_en       timestamptz not null default now(),
  unique (ronda_id, participante_id)
);
create index if not exists dibujos_sesion on public.dibujos (sesion_id);

-- ── Seguridad: solo la profe ve sus datos ──────────────────────
-- Los alumnos NO acceden a las tablas: usan las funciones de abajo.

alter table public.sesiones      enable row level security;
alter table public.rondas        enable row level security;
alter table public.participantes enable row level security;
alter table public.dibujos       enable row level security;

create or replace function public.es_mi_sesion(p_sesion text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from sesiones where id::text = p_sesion and profe_id = auth.uid());
$$;

drop policy if exists "profe_sesiones" on public.sesiones;
create policy "profe_sesiones" on public.sesiones for all to authenticated
  using (profe_id = auth.uid()) with check (profe_id = auth.uid());

drop policy if exists "profe_rondas" on public.rondas;
create policy "profe_rondas" on public.rondas for all to authenticated
  using (public.es_mi_sesion(sesion_id::text)) with check (public.es_mi_sesion(sesion_id::text));

drop policy if exists "profe_participantes" on public.participantes;
create policy "profe_participantes" on public.participantes for all to authenticated
  using (public.es_mi_sesion(sesion_id::text));

drop policy if exists "profe_dibujos" on public.dibujos;
create policy "profe_dibujos" on public.dibujos for all to authenticated
  using (public.es_mi_sesion(sesion_id::text));

-- ── Funciones de la profe ──────────────────────────────────────

create or replace function public.hora_servidor()
returns timestamptz language sql stable as $$ select now(); $$;

create or replace function public.lanzar_ronda(p_sesion uuid, p_consigna text, p_mostrar boolean, p_segundos int)
returns public.rondas language plpgsql security invoker set search_path = public as $$
declare
  v_num int;
  v_r   rondas;
begin
  if not exists (select 1 from sesiones where id = p_sesion and profe_id = auth.uid() and estado = 'abierta') then
    raise exception 'SESION_NO_VALIDA';
  end if;
  update rondas set abierta = false where sesion_id = p_sesion and abierta;
  select coalesce(max(numero), 0) + 1 into v_num from rondas where sesion_id = p_sesion;
  insert into rondas (sesion_id, numero, consigna, mostrar_consigna, termina_en)
  values (
    p_sesion, v_num, coalesce(left(p_consigna, 300), ''), coalesce(p_mostrar, true),
    case when coalesce(p_segundos, 0) > 0 then now() + make_interval(secs => p_segundos) end
  )
  returning * into v_r;
  return v_r;
end $$;

-- "Recoger dibujos": la ronda se cierra en p_segundos; los alumnos ven la cuenta atrás
-- y su dibujo se envía solo al llegar a cero.
create or replace function public.programar_cierre(p_ronda uuid, p_segundos int)
returns public.rondas language plpgsql security invoker set search_path = public as $$
declare v_r rondas;
begin
  update rondas
     set termina_en = least(coalesce(termina_en, 'infinity'::timestamptz),
                            now() + make_interval(secs => greatest(p_segundos, 0)))
   where id = p_ronda and abierta
  returning * into v_r;
  if v_r.id is null then raise exception 'RONDA_CERRADA'; end if;
  return v_r;
end $$;

revoke execute on function public.lanzar_ronda(uuid, text, boolean, int) from anon;
revoke execute on function public.programar_cierre(uuid, int) from anon;

-- ── Funciones de los alumnos (sin cuenta) ──────────────────────

create or replace function public.unirse_sesion(p_codigo text, p_nombre text)
returns table (o_sesion uuid, o_participante uuid, o_token uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_sesion uuid;
  v_nombre text := left(btrim(coalesce(p_nombre, '')), 30);
begin
  if v_nombre = '' then raise exception 'NOMBRE_VACIO'; end if;
  select s.id into v_sesion from sesiones s
   where s.codigo = btrim(p_codigo) and s.estado = 'abierta' limit 1;
  if v_sesion is null then raise exception 'CODIGO_NO_VALIDO'; end if;
  return query
    insert into participantes (sesion_id, nombre) values (v_sesion, v_nombre)
    returning participantes.sesion_id, participantes.id, participantes.token;
end $$;

create or replace function public.estado_sesion(p_participante uuid, p_token uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_s sesiones;
  v_r rondas;
begin
  select s.* into v_s from sesiones s
    join participantes p on p.sesion_id = s.id
   where p.id = p_participante and p.token = p_token;
  if not found then return json_build_object('estado', 'no_existe'); end if;

  select r.* into v_r from rondas r where r.sesion_id = v_s.id order by r.numero desc limit 1;

  return json_build_object(
    'estado', v_s.estado,
    'ahora', now(),
    'enviado', coalesce((select true from dibujos d where d.ronda_id = v_r.id and d.participante_id = p_participante), false),
    'ronda', case when v_r.id is null then null else json_build_object(
      'id', v_r.id,
      'numero', v_r.numero,
      'consigna', case when v_r.mostrar_consigna then v_r.consigna else '' end,
      'abierta', v_r.abierta,
      'termina_en', v_r.termina_en
    ) end
  );
end $$;

create or replace function public.enviar_dibujo(p_participante uuid, p_token uuid, p_ronda uuid, p_ruta text)
returns void language plpgsql security definer set search_path = public as $$
declare v_p participantes;
begin
  select * into v_p from participantes where id = p_participante and token = p_token;
  if not found then raise exception 'NO_AUTORIZADO'; end if;

  if not exists (
    select 1 from rondas r join sesiones s on s.id = r.sesion_id
     where r.id = p_ronda and r.sesion_id = v_p.sesion_id and r.abierta and s.estado = 'abierta'
  ) then
    raise exception 'RONDA_CERRADA';
  end if;

  if p_ruta not like v_p.sesion_id::text || '/' || p_ronda::text || '/' || p_participante::text || '-%.png' then
    raise exception 'RUTA_NO_VALIDA';
  end if;

  insert into dibujos (sesion_id, ronda_id, participante_id, nombre, ruta)
  values (v_p.sesion_id, p_ronda, p_participante, v_p.nombre, p_ruta)
  on conflict (ronda_id, participante_id)
  do update set ruta = excluded.ruta, creado_en = now();
end $$;

grant execute on function public.unirse_sesion(text, text) to anon, authenticated;
grant execute on function public.estado_sesion(uuid, uuid) to anon, authenticated;
grant execute on function public.enviar_dibujo(uuid, uuid, uuid, text) to anon, authenticated;
grant execute on function public.hora_servidor() to anon, authenticated;

-- ── Almacenamiento de las imágenes ─────────────────────────────
-- Bucket privado: los dibujos solo los ve la profe (con enlaces temporales).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dibujos', 'dibujos', false, 3145728, array['image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/png'];

create or replace function public.puede_subir(p_sesion text, p_ronda text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from rondas r join sesiones s on s.id = r.sesion_id
     where s.id::text = p_sesion and r.id::text = p_ronda and r.abierta and s.estado = 'abierta'
  );
$$;
grant execute on function public.puede_subir(text, text) to anon, authenticated;

drop policy if exists "trazos_alumnos_suben" on storage.objects;
create policy "trazos_alumnos_suben" on storage.objects for insert to anon, authenticated
  with check (
    bucket_id = 'dibujos'
    and public.puede_subir((storage.foldername(name))[1], (storage.foldername(name))[2])
  );

drop policy if exists "trazos_profe_lee" on storage.objects;
create policy "trazos_profe_lee" on storage.objects for select to authenticated
  using (bucket_id = 'dibujos' and public.es_mi_sesion((storage.foldername(name))[1]));

drop policy if exists "trazos_profe_borra" on storage.objects;
create policy "trazos_profe_borra" on storage.objects for delete to authenticated
  using (bucket_id = 'dibujos' and public.es_mi_sesion((storage.foldername(name))[1]));

-- ── Tiempo real: que a la profe le lleguen los dibujos al instante ──

do $$
begin
  begin alter publication supabase_realtime add table public.dibujos;       exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.participantes; exception when duplicate_object then null; end;
end $$;

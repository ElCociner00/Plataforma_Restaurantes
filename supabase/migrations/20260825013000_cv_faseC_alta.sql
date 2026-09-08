-- ============================================================================
-- CICLO DE VIDA · FASE C (b) — El alta
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase C
--
-- Tres huecos que se cierran aquí:
--
--   1. El registro no creaba cuenta ni suscripción. Un cliente nuevo veía
--      "tu empresa todavía no tiene cuenta de facturación".
--   2. No existía el botón del cliente para arrancar su propia prueba.
--   3. No existía la ventana de 30 días ni su bloqueo.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Términos y condiciones versionados
--
-- Sin versionado, un cambio de términos no es oponible a nadie: no hay forma
-- de demostrar qué aceptó cada cliente. El contenido se carga en la Fase E;
-- aquí solo van las tablas, porque el registro depende de ellas.
-- ----------------------------------------------------------------------------
create table if not exists public.terminos_versiones (
  id             uuid primary key default gen_random_uuid(),
  version        text not null unique,
  titulo         text not null default 'Términos y Condiciones',
  contenido_html text not null,
  resumen_cambios text not null default '',
  publicado_en   date not null default current_date,
  vigente        boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Solo una versión vigente a la vez.
create unique index if not exists terminos_versiones_vigente_uq
  on public.terminos_versiones ((vigente)) where vigente;

create table if not exists public.aceptaciones_terminos (
  id          uuid primary key default gen_random_uuid(),
  cuenta_id   uuid references public.cuentas(id) on delete cascade,
  usuario_id  uuid not null,
  correo      text not null default '',
  version_id  uuid not null references public.terminos_versiones(id),
  aceptado_en timestamptz not null default now(),
  ip          text not null default '',
  user_agent  text not null default ''
);

create index if not exists aceptaciones_terminos_cuenta_idx
  on public.aceptaciones_terminos (cuenta_id, aceptado_en desc);

alter table public.terminos_versiones    enable row level security;
alter table public.aceptaciones_terminos enable row level security;

drop policy if exists terminos_versiones_lectura      on public.terminos_versiones;
drop policy if exists terminos_versiones_admin        on public.terminos_versiones;
drop policy if exists aceptaciones_terminos_lectura   on public.aceptaciones_terminos;
drop policy if exists aceptaciones_terminos_admin     on public.aceptaciones_terminos;

-- Los términos vigentes los puede leer cualquiera: hay que poder enseñarlos
-- antes de registrarse.
create policy terminos_versiones_lectura on public.terminos_versiones
  for select to anon, authenticated using (true);
create policy terminos_versiones_admin on public.terminos_versiones
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy aceptaciones_terminos_lectura on public.aceptaciones_terminos
  for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy aceptaciones_terminos_admin on public.aceptaciones_terminos
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select on public.terminos_versiones    to anon, authenticated;
grant select on public.aceptaciones_terminos to authenticated;
grant all    on public.terminos_versiones, public.aceptaciones_terminos to service_role;

-- ----------------------------------------------------------------------------
-- 2. Registro conectado con la facturación
--
-- Se reemplaza la versión de 5 argumentos por una de 6 (el sexto con valor por
-- defecto) para que el frontend actual siga funcionando mientras se actualiza.
-- Se hace DROP explícito: dejar las dos vivas provocaría ambigüedad al
-- resolver una llamada de 5 argumentos.
-- ----------------------------------------------------------------------------
drop function if exists public.registrar_empresa_self_service(text, text, text, text, text);

create or replace function public.registrar_empresa_self_service(
  p_nombre_comercial text,
  p_razon_social     text,
  p_nit              text,
  p_correo_empresa   text,
  p_nombre_completo  text,
  p_acepta_terminos  boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid         uuid := auth.uid();
  v_empresa_id  uuid;
  v_cuenta_id   uuid;
  v_nit         text := btrim(coalesce(p_nit, ''));
  v_hoy         date := (now() at time zone 'America/Bogota')::date;
  v_dias_ventana integer := 30;
  v_terminos    uuid;
begin
  -- Guarda 1 · autenticación
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar una empresa.' using errcode = 'EK001';
  end if;

  -- Guarda 2 · una identidad por cuenta
  if exists (select 1 from public.usuarios_sistema us where us.id = v_uid) then
    raise exception 'Tu cuenta ya pertenece a una empresa.' using errcode = 'EK002';
  end if;

  -- Guarda 3 · datos obligatorios
  if coalesce(btrim(p_nombre_comercial), '') = ''
     or coalesce(btrim(p_razon_social), '')   = ''
     or v_nit                                  = ''
     or coalesce(btrim(p_correo_empresa), '')  = ''
     or coalesce(btrim(p_nombre_completo), '') = '' then
    raise exception 'Faltan datos obligatorios del registro.' using errcode = 'EK004';
  end if;

  -- Guarda 4 · NIT libre
  if exists (select 1 from public.empresas e where e.nit = v_nit) then
    raise exception 'Ese NIT ya está registrado.' using errcode = 'EK003';
  end if;

  -- Guarda 5 · aceptación de términos
  if not coalesce(p_acepta_terminos, false) then
    raise exception 'Debes aceptar los términos y condiciones.' using errcode = 'EK005';
  end if;

  insert into public.empresas (
    nombre_comercial, razon_social, nit, correo_empresa, activa, activo, plan, plan_actual
  )
  values (
    btrim(p_nombre_comercial), btrim(p_razon_social), v_nit,
    btrim(p_correo_empresa), true, true, 'pro', 'pro'
  )
  returning id into v_empresa_id;

  insert into public.usuarios_sistema (id, empresa_id, nombre_completo, rol, activo)
  values (v_uid, v_empresa_id, btrim(p_nombre_completo), 'admin_root', true);

  -- ── Lo nuevo: la cuenta de facturación nace con la empresa ──────────────
  insert into public.cuentas (
    nombre, nit, correo_facturacion, contacto_nombre,
    tipo, estado, registrada_en, activacion_limite, notas
  )
  values (
    btrim(p_nombre_comercial), v_nit, btrim(p_correo_empresa), btrim(p_nombre_completo),
    'cliente', 'registrada', v_hoy, v_hoy + v_dias_ventana,
    'Alta self-service. La prueba de 15 días arranca cuando el cliente pulse "Activar".'
  )
  returning id into v_cuenta_id;

  insert into public.cuenta_empresas (cuenta_id, empresa_id, es_principal, desde)
  values (v_cuenta_id, v_empresa_id, true, v_hoy);

  -- Suscripción SIN reloj: prueba_desde y prueba_hasta quedan NULL a
  -- propósito. Se rellenan cuando el cliente activa.
  insert into public.suscripciones (
    cuenta_id, plan_id, periodicidad, estado, proveedor, sedes_facturadas
  )
  values (v_cuenta_id, 'pro', 'mensual', 'registrada', 'manual', 1);

  -- Constancia de qué versión de los términos aceptó.
  select id into v_terminos from public.terminos_versiones where vigente limit 1;
  if v_terminos is not null then
    insert into public.aceptaciones_terminos (cuenta_id, usuario_id, correo, version_id)
    values (v_cuenta_id, v_uid, btrim(p_correo_empresa), v_terminos);
  end if;

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  values (v_cuenta_id, 'cuenta_registrada',
          jsonb_build_object('empresa_id', v_empresa_id, 'nit', v_nit,
                             'activacion_limite', v_hoy + v_dias_ventana),
          coalesce(auth.jwt()->>'email', v_uid::text));

  return v_empresa_id;
end;
$$;

revoke execute on function public.registrar_empresa_self_service(text,text,text,text,text,boolean) from public, anon;
grant  execute on function public.registrar_empresa_self_service(text,text,text,text,text,boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. activar_prueba_cliente() — el botón del cliente
--
-- Lo pulsa el propio cliente cuando está listo, no un administrador. Es lo que
-- hace que el reloj mida lo que debe medir.
-- ----------------------------------------------------------------------------
create or replace function public.activar_prueba_cliente(p_dias integer default 15)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_empresa   uuid := public.current_empresa_id();
  v_cuenta_id uuid;
  v_cuenta    public.cuentas%rowtype;
  v_sus       public.suscripciones%rowtype;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
  v_dias      integer := least(greatest(coalesce(p_dias, 15), 1), 15);
  v_rol       text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  v_cuenta_id := public.cuenta_de_empresa(v_empresa);
  if v_cuenta_id is null then
    raise exception 'Tu empresa no está vinculada a ninguna cuenta.' using errcode = '22023';
  end if;

  -- Solo el administrador principal de la cuenta. Un operativo no compromete
  -- al negocio arrancando el reloj sin querer.
  select rol into v_rol from public.usuarios_sistema where id = v_uid;
  if not public.is_super_admin() and lower(coalesce(v_rol, '')) <> 'admin_root' then
    raise exception 'Solo el administrador de la cuenta puede activar la prueba.'
      using errcode = '42501';
  end if;

  select * into v_cuenta from public.cuentas       where id = v_cuenta_id;
  select * into v_sus    from public.suscripciones where cuenta_id = v_cuenta_id
    and estado <> 'cancelada' limit 1;

  if v_cuenta.estado in ('cancelada', 'purgada') then
    raise exception 'Esta cuenta está dada de baja.' using errcode = '22023';
  end if;

  -- Idempotente: pulsarlo dos veces no reinicia ni extiende el reloj.
  if v_sus.prueba_hasta is not null then
    return jsonb_build_object('ok', true, 'repetido', true,
                              'prueba_hasta', v_sus.prueba_hasta);
  end if;

  if v_cuenta.estado = 'bloqueada_sin_activar' then
    raise exception 'El plazo para activar venció. Escríbenos y reabrimos tu cuenta.'
      using errcode = '22023';
  end if;

  update public.suscripciones
  set prueba_desde = v_hoy,
      prueba_hasta = v_hoy + v_dias,
      estado       = 'prueba',
      updated_at   = now()
  where id = v_sus.id;

  update public.cuentas
  set estado            = 'prueba',
      activacion_limite = null,   -- la ventana ya cumplió su función
      updated_at        = now()
  where id = v_cuenta_id;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_cuenta_id, v_sus.id, 'prueba_activada_por_cliente',
          jsonb_build_object('dias', v_dias, 'hasta', v_hoy + v_dias),
          coalesce(auth.jwt()->>'email', v_uid::text));

  return jsonb_build_object(
    'ok', true, 'repetido', false,
    'prueba_desde', v_hoy,
    'prueba_hasta', v_hoy + v_dias,
    'dias', v_dias
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. marcar_implementacion() — congela el reloj
--
-- El caso BATUT Cartagena: una cuenta que tú montas durante semanas antes de
-- que el cliente pueda usarla. Si la ventana de 30 días corriera durante el
-- montaje, se gastaría sin que el cliente hubiera tocado el producto.
-- ----------------------------------------------------------------------------
create or replace function public.marcar_implementacion(p_cuenta_id uuid, p_nota text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_permiso_superadmin('marcar_implementacion');

  update public.cuentas
  set estado            = 'implementacion',
      activacion_limite = null,          -- reloj PARADO
      notas             = coalesce(p_nota, notas),
      updated_at        = now()
  where id = p_cuenta_id;

  update public.suscripciones
  set estado = 'implementacion', updated_at = now()
  where cuenta_id = p_cuenta_id and estado not in ('cancelada', 'purgada');

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  values (p_cuenta_id, 'implementacion_iniciada',
          jsonb_build_object('nota', p_nota),
          coalesce(auth.jwt()->>'email', 'superadmin'));

  return jsonb_build_object('ok', true, 'estado', 'implementacion');
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. desbloquear_cuenta() — reabre la ventana
-- ----------------------------------------------------------------------------
create or replace function public.desbloquear_cuenta(
  p_cuenta_id uuid,
  p_dias      integer default 30,
  p_motivo    text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy   date := (now() at time zone 'America/Bogota')::date;
  v_hasta date;
begin
  perform public.exigir_permiso_superadmin('desbloquear');

  v_hasta := v_hoy + greatest(coalesce(p_dias, 30), 1);

  update public.cuentas
  set estado            = 'registrada',
      activacion_limite = v_hasta,
      bloqueada_en      = null,
      updated_at        = now()
  where id = p_cuenta_id and estado = 'bloqueada_sin_activar';

  if not found then
    raise exception 'La cuenta % no está bloqueada por falta de activación', p_cuenta_id
      using errcode = '22023';
  end if;

  update public.suscripciones
  set estado = 'registrada', updated_at = now()
  where cuenta_id = p_cuenta_id and estado = 'bloqueada_sin_activar';

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  values (p_cuenta_id, 'cuenta_desbloqueada',
          jsonb_build_object('dias', p_dias, 'nuevo_limite', v_hasta, 'motivo', p_motivo),
          coalesce(auth.jwt()->>'email', 'superadmin'));

  return jsonb_build_object('ok', true, 'activacion_limite', v_hasta);
end;
$$;

grant execute on function public.activar_prueba_cliente(integer)         to authenticated;
grant execute on function public.marcar_implementacion(uuid, text)       to authenticated;
grant execute on function public.desbloquear_cuenta(uuid, integer, text) to authenticated;

commit;

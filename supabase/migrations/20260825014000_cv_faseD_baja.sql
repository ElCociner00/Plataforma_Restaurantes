-- ============================================================================
-- CICLO DE VIDA · FASE D — La baja
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase D
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  LO QUE NO ESTÁ AQUÍ, A PROPÓSITO                                        │
-- │                                                                          │
-- │  El BORRADO de datos a los 90 días NO se implementa. Andrés lo dejó      │
-- │  expresamente fuera de esta entrega.                                     │
-- │                                                                          │
-- │  Sí se guarda `purgar_desde`, que es la fecha a partir de la cual serían │
-- │  borrables, para que la cuenta atrás exista y se pueda avisar. Pero no   │
-- │  hay función de purga, no hay cron de purga, y NADA borra nada.          │
-- │  Una cuenta cancelada conserva todos sus datos indefinidamente hasta que │
-- │  se decida implementar la purga.                                         │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- Lo que sí hace la baja:
--   - suspende el acceso salvo /facturacion/ (para poder retomar el plan)
--   - cancela la renovación automática
--   - deja de emitir facturas nuevas; las pendientes se siguen debiendo
--   - permite volver en cualquier momento con todos los datos intactos
--
-- SIN REEMBOLSOS (decisión de Andrés, 2026-08-25): quien pagó un periodo por
-- adelantado conserva el servicio hasta el final de ese periodo, y no se
-- devuelve dinero. Por eso la baja respeta `cubierto_hasta`.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Registro de bajas
-- ----------------------------------------------------------------------------
create table if not exists public.bajas_suscripcion (
  id              uuid primary key default gen_random_uuid(),
  cuenta_id       uuid not null references public.cuentas(id) on delete cascade,
  solicitada_en   timestamptz not null default now(),
  solicitada_por  uuid,
  correo          text not null default '',
  motivo          text not null default '',
  comentario      text not null default '',
  -- Hasta cuándo conserva el servicio ya pagado. Sin reembolsos: si pagó el
  -- año, lo usa hasta el final aunque se dé de baja hoy.
  servicio_hasta  date,
  purgar_desde    date,
  estado          text not null default 'efectiva'
                    check (estado in ('efectiva', 'revertida')),
  reactivada_en   timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists bajas_suscripcion_cuenta_idx
  on public.bajas_suscripcion (cuenta_id, solicitada_en desc);

alter table public.bajas_suscripcion enable row level security;

drop policy if exists bajas_suscripcion_lectura on public.bajas_suscripcion;
drop policy if exists bajas_suscripcion_admin   on public.bajas_suscripcion;

create policy bajas_suscripcion_lectura on public.bajas_suscripcion
  for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy bajas_suscripcion_admin on public.bajas_suscripcion
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

grant select on public.bajas_suscripcion to authenticated;
grant all    on public.bajas_suscripcion to service_role;

-- ----------------------------------------------------------------------------
-- 2. solicitar_baja() — la pide el cliente
-- ----------------------------------------------------------------------------
create or replace function public.solicitar_baja(
  p_motivo     text default '',
  p_comentario text default '',
  p_cuenta_id  uuid default null      -- solo un superadmin puede indicarla
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid        uuid := auth.uid();
  v_cuenta_id  uuid;
  v_cuenta     public.cuentas%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
  v_retencion  integer := 90;
  v_pendientes numeric;
  v_baja_id    uuid;
  v_rol        text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  if p_cuenta_id is not null then
    perform public.exigir_permiso_superadmin('cancelar_cuenta');
    v_cuenta_id := p_cuenta_id;
  else
    v_cuenta_id := public.mi_cuenta_id();
    select rol into v_rol from public.usuarios_sistema where id = v_uid;
    if lower(coalesce(v_rol, '')) <> 'admin_root' then
      raise exception 'Solo el administrador de la cuenta puede darla de baja.'
        using errcode = '42501';
    end if;
  end if;

  if v_cuenta_id is null then
    raise exception 'No se pudo determinar tu cuenta.' using errcode = '22023';
  end if;

  select * into v_cuenta from public.cuentas where id = v_cuenta_id;

  if v_cuenta.estado in ('cancelada', 'purgada') then
    return jsonb_build_object('ok', true, 'repetido', true,
                              'cancelada_en', v_cuenta.cancelada_en);
  end if;

  select * into v_sus from public.suscripciones
  where cuenta_id = v_cuenta_id and estado not in ('cancelada', 'purgada') limit 1;

  -- Lo que deba sigue debiéndolo: darse de baja no cancela facturas emitidas.
  select coalesce(sum(total), 0) into v_pendientes
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta_id and estado in ('emitida', 'vencida');

  insert into public.bajas_suscripcion (
    cuenta_id, solicitada_por, correo, motivo, comentario,
    servicio_hasta, purgar_desde
  )
  values (
    v_cuenta_id, v_uid, coalesce(auth.jwt()->>'email', ''),
    coalesce(p_motivo, ''), coalesce(p_comentario, ''),
    v_sus.cubierto_hasta,
    v_hoy + v_retencion
  )
  returning id into v_baja_id;

  update public.cuentas
  set estado             = 'cancelada',
      cancelada_en       = v_hoy,
      motivo_cancelacion = coalesce(p_motivo, ''),
      purgar_desde       = v_hoy + v_retencion,
      updated_at         = now()
  where id = v_cuenta_id;

  update public.suscripciones
  set estado                = 'cancelada',
      renovacion_automatica = false,
      id_externo            = null,          -- se suelta la fuente de pago
      metodo_pago_resumen   = '',
      updated_at            = now()
  where cuenta_id = v_cuenta_id;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_cuenta_id, v_sus.id, 'baja_solicitada',
          jsonb_build_object('motivo', p_motivo, 'comentario', p_comentario,
                             'servicio_hasta', v_sus.cubierto_hasta,
                             'purgar_desde', v_hoy + v_retencion,
                             'saldo_pendiente', v_pendientes),
          coalesce(auth.jwt()->>'email', v_uid::text));

  return jsonb_build_object(
    'ok', true, 'repetido', false,
    'baja_id', v_baja_id,
    'cancelada_en', v_hoy,
    'servicio_hasta', v_sus.cubierto_hasta,
    'purgar_desde', v_hoy + v_retencion,
    'dias_retencion', v_retencion,
    'saldo_pendiente', v_pendientes
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. reactivar_cuenta() — retomar el plan
--
-- Es la única acción que sigue disponible con la cuenta dada de baja, y por
-- eso el nivel de acceso `solo_facturacion` conserva esta pantalla.
-- ----------------------------------------------------------------------------
create or replace function public.reactivar_cuenta(p_cuenta_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_cuenta_id uuid;
  v_cuenta    public.cuentas%rowtype;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
  v_estado    text;
  v_rol       text;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesión.' using errcode = '42501';
  end if;

  if p_cuenta_id is not null and public.is_super_admin() then
    perform public.exigir_permiso_superadmin('reactivar_cuenta');
    v_cuenta_id := p_cuenta_id;
  else
    v_cuenta_id := public.mi_cuenta_id();
    select rol into v_rol from public.usuarios_sistema where id = v_uid;
    if lower(coalesce(v_rol, '')) <> 'admin_root' then
      raise exception 'Solo el administrador de la cuenta puede retomar el plan.'
        using errcode = '42501';
    end if;
  end if;

  select * into v_cuenta from public.cuentas where id = v_cuenta_id;

  if v_cuenta.estado = 'purgada' then
    raise exception 'Los datos de esta cuenta ya se eliminaron. Hay que registrarse de nuevo.'
      using errcode = '22023';
  end if;

  if v_cuenta.estado <> 'cancelada' then
    return jsonb_build_object('ok', true, 'repetido', true, 'estado', v_cuenta.estado);
  end if;

  -- Vuelve al estado que le corresponde según lo que tenga pagado.
  select case
           when s.cubierto_hasta is not null and s.cubierto_hasta >= v_hoy then 'activa'
           when s.prueba_hasta   is not null and s.prueba_hasta   >= v_hoy then 'prueba'
           else 'activa'
         end
  into v_estado
  from public.suscripciones s where s.cuenta_id = v_cuenta_id limit 1;

  update public.cuentas
  set estado        = coalesce(v_estado, 'activa'),
      reactivada_en = v_hoy,
      cancelada_en  = null,
      purgar_desde  = null,
      updated_at    = now()
  where id = v_cuenta_id;

  update public.suscripciones
  set estado = coalesce(v_estado, 'activa'), updated_at = now()
  where cuenta_id = v_cuenta_id;

  update public.bajas_suscripcion
  set estado = 'revertida', reactivada_en = now()
  where cuenta_id = v_cuenta_id and estado = 'efectiva';

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  values (v_cuenta_id, 'cuenta_reactivada',
          jsonb_build_object('estado', v_estado),
          coalesce(auth.jwt()->>'email', v_uid::text));

  return jsonb_build_object('ok', true, 'repetido', false, 'estado', v_estado);
end;
$$;

grant execute on function public.solicitar_baja(text, text, uuid) to authenticated;
grant execute on function public.reactivar_cuenta(uuid)           to authenticated;

-- ----------------------------------------------------------------------------
-- 4. ciclo_vida_diario() — la ventana de 30 días
--
-- Va aparte de facturacion_ciclo_diario() porque son cosas distintas: una
-- cobra, la otra vigila el alta. La Edge Function llama a las dos.
--
-- No hay ninguna rama que borre datos. Sobre las cuentas canceladas solo
-- informa cuántos días llevan.
-- ----------------------------------------------------------------------------
create or replace function public.ciclo_vida_diario()
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
  v_avisos     jsonb := '[]'::jsonb;
  v_bloqueadas jsonb := '[]'::jsonb;
  v_canceladas jsonb := '[]'::jsonb;
begin
  -- ── Avisos: 10 días y 3 días antes de que venza la ventana ───────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'cuenta_id', c.id, 'cuenta', c.nombre, 'correo', c.correo_facturacion,
           'activacion_limite', c.activacion_limite,
           'dias_restantes', c.activacion_limite - v_hoy
         )), '[]'::jsonb)
  into v_avisos
  from public.cuentas c
  where c.tipo = 'cliente'
    and c.estado = 'registrada'
    and c.activacion_limite is not null
    and (c.activacion_limite - v_hoy) in (10, 3);

  -- ── Bloqueo por no activar en plazo ──────────────────────────────────────
  with bloqueadas as (
    update public.cuentas c
    set estado       = 'bloqueada_sin_activar',
        bloqueada_en = v_hoy,
        updated_at   = now()
    where c.tipo = 'cliente'
      and c.estado = 'registrada'
      and c.activacion_limite is not null
      and c.activacion_limite < v_hoy
    returning c.id, c.nombre, c.correo_facturacion, c.activacion_limite
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'cuenta_id', id, 'cuenta', nombre, 'correo', correo_facturacion,
           'activacion_limite', activacion_limite
         )), '[]'::jsonb)
  into v_bloqueadas
  from bloqueadas;

  update public.suscripciones s
  set estado = 'bloqueada_sin_activar', updated_at = now()
  from public.cuentas c
  where c.id = s.cuenta_id
    and c.estado = 'bloqueada_sin_activar'
    and s.estado = 'registrada';

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  select (x->>'cuenta_id')::uuid, 'bloqueada_sin_activar', x, 'sistema:ciclo_vida'
  from jsonb_array_elements(v_bloqueadas) x;

  -- ── Cuentas canceladas: solo informar. NADA se borra ─────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'cuenta_id', c.id, 'cuenta', c.nombre, 'correo', c.correo_facturacion,
           'cancelada_en', c.cancelada_en,
           'purgar_desde', c.purgar_desde,
           'dias_desde_baja', v_hoy - c.cancelada_en
         )), '[]'::jsonb)
  into v_canceladas
  from public.cuentas c
  where c.estado = 'cancelada';

  return jsonb_build_object(
    'ok', true,
    'fecha', v_hoy,
    'avisos_activacion', v_avisos,
    'bloqueadas', v_bloqueadas,
    'canceladas', v_canceladas,
    'purga', 'no_implementada'
  );
end;
$$;

comment on function public.ciclo_vida_diario() is
  'Vigila la ventana de activación de 30 días y bloquea a quien no activó. NO borra datos: la purga a 90 días está pendiente por decisión de Andrés.';

grant execute on function public.ciclo_vida_diario() to service_role;

commit;

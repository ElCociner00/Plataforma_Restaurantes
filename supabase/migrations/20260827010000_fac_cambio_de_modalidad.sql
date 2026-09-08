-- ============================================================================
-- Cambio de modalidad de una renovación anticipada, y anulación de facturas
-- no pagadas.
--
-- EL PROBLEMA
-- ---------------------------------------------------------------------------
-- El botón «Pagar el año (−20%)» de la pantalla antigua no llevaba a pagar:
-- EMITÍA una factura anual. El 2026-08-27 se emitió así AX-01004 a BATUT
-- —$575.040, periodo 2027-06-01 → 2028-05-31— sobre una cuenta que ya estaba
-- cubierta hasta 2027-05-31 y no debía nada.
--
-- Eso destapó que faltaba una distinción en el modelo:
--
--   FACTURA EXIGIBLE      periodo_desde <= hoy. Es deuda. Se paga.
--   RENOVACIÓN ANTICIPADA periodo_desde  > hoy y la vigencia sigue cubierta.
--                         No es deuda: es una reserva del periodo siguiente.
--
-- Sobre la segunda, el cliente tiene que poder cambiar de opinión. Hasta
-- ahora no podía, porque no existía NINGUNA forma de anular una factura: el
-- estado 'anulada' solo lo escribía la migración de datos históricos. Pedir la
-- otra modalidad se limitaba a emitir una segunda factura y dejar viva la
-- primera — dos cobros solapados.
--
-- LOS CANDADOS
-- ---------------------------------------------------------------------------
-- Anular una factura mueve dinero potencial, así que las dos funciones exigen
-- las mismas cuatro condiciones y ninguna es opcional:
--
--   1. estado = 'emitida'. Una 'vencida' es deuda real y no se toca aquí; una
--      'pagada' jamás.
--   2. SIN NINGÚN PAGO asociado, ni siquiera pendiente de conciliar. Si entró
--      dinero contra esa referencia, la factura se queda.
--   3. periodo_desde > hoy. Solo se cambia lo que aún no ha empezado a correr.
--   4. Alcance: la cuenta propia, o superadmin, o rol de servicio.
--
-- Todo en una sola transacción: o se anula la vieja y nace la nueva, o no pasa
-- nada. Nunca puede quedar el cliente con las dos, ni con ninguna.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. anular_factura_no_pagada — la pieza que faltaba.
--
-- Deliberadamente NO acepta facturas vencidas ni pagadas: para esas, la vía es
-- una nota de crédito o una conciliación manual, no este atajo.
-- ----------------------------------------------------------------------------
create or replace function public.anular_factura_no_pagada(
  p_factura_id uuid,
  p_motivo     text default 'anulada por el cliente'
)
returns public.facturas_suscripcion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_factura public.facturas_suscripcion%rowtype;
  v_hoy     date := (now() at time zone 'America/Bogota')::date;
  v_pagos   integer;
begin
  select * into v_factura
  from public.facturas_suscripcion
  where id = p_factura_id
  for update;

  if not found then
    raise exception 'La factura % no existe', p_factura_id using errcode = '22023';
  end if;

  -- (4) Alcance.
  if not public.is_super_admin()
     and not public.app_es_rol_servicio()
     and v_factura.cuenta_id is distinct from public.mi_cuenta_id() then
    raise exception 'Fuera de alcance' using errcode = '42501';
  end if;

  -- (1) Solo emitidas.
  if v_factura.estado <> 'emitida' then
    raise exception 'La factura % está en estado %; solo se pueden anular las emitidas',
      v_factura.numero, v_factura.estado using errcode = '22023';
  end if;

  -- (2) Sin dinero de por medio. Cuenta cualquier pago, también los que están
  --     pendientes de conciliar: si algo entró, esto no se toca.
  select count(*) into v_pagos
  from public.pagos_suscripcion
  where factura_id = v_factura.id;

  if v_pagos > 0 then
    raise exception 'La factura % tiene % pago(s) registrados y no se puede anular',
      v_factura.numero, v_pagos using errcode = '22023';
  end if;

  -- (3) Solo lo que aún no ha empezado a correr.
  if v_factura.periodo_desde <= v_hoy then
    raise exception
      'El periodo de la factura % ya empezó (%): es un cobro exigible, no una reserva',
      v_factura.numero, v_factura.periodo_desde using errcode = '22023';
  end if;

  update public.facturas_suscripcion
     set estado = 'anulada', updated_at = now()
   where id = v_factura.id
  returning * into v_factura;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_factura.cuenta_id, v_factura.suscripcion_id, 'factura_anulada',
          jsonb_build_object('numero', v_factura.numero, 'total', v_factura.total,
                             'periodo', v_factura.periodo_desde::text || ' → ' ||
                                        v_factura.periodo_hasta::text,
                             'motivo', p_motivo),
          case when public.is_super_admin() then 'superadmin' else 'cliente' end);

  return v_factura;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. cambiar_modalidad_factura — lo que pulsa el cliente.
--
-- Anula la renovación anticipada viva y emite la de la otra modalidad. Como
-- emitir_factura_cuenta() recalcula el periodo desde cubierto_hasta + 1, la
-- nueva arranca exactamente donde arrancaba la anterior.
-- ----------------------------------------------------------------------------
create or replace function public.cambiar_modalidad_factura(
  p_periodicidad text,
  p_empresa_id   uuid default null
)
returns public.facturas_suscripcion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy          date := (now() at time zone 'America/Bogota')::date;
  v_cuenta_id    uuid := public.cuenta_de_empresa(coalesce(p_empresa_id, public.current_empresa_id()));
  v_periodicidad text := lower(coalesce(p_periodicidad, ''));
  v_factura      public.facturas_suscripcion%rowtype;
  v_actual       text;
  v_nueva        public.facturas_suscripcion%rowtype;
begin
  if v_cuenta_id is null then
    raise exception 'Esta empresa no está vinculada a ninguna cuenta de facturación'
      using errcode = '22023';
  end if;

  if v_periodicidad not in ('mensual', 'anual') then
    raise exception 'La modalidad debe ser mensual o anual' using errcode = '22023';
  end if;

  -- (4) Alcance.
  if not public.is_super_admin()
     and not public.app_es_rol_servicio()
     and v_cuenta_id is distinct from public.mi_cuenta_id() then
    raise exception 'Fuera de alcance' using errcode = '42501';
  end if;

  -- La renovación anticipada viva, si la hay. 'vencida' queda fuera a
  -- propósito: eso es deuda y se paga, no se cambia.
  select * into v_factura
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta_id
    and estado = 'emitida'
    and periodo_desde > v_hoy
  order by periodo_desde
  limit 1;

  if not found then
    raise exception 'No tienes ninguna renovación anticipada que cambiar'
      using errcode = '22023';
  end if;

  -- Un mes va de 28 a 31 días; un año, 365. El corte en 300 no puede confundir
  -- un prorrateo con un año. Mismo criterio que usa el frontend.
  v_actual := case when (v_factura.periodo_hasta - v_factura.periodo_desde) >= 300
                   then 'anual' else 'mensual' end;

  if v_actual = v_periodicidad then
    raise exception 'Tu renovación ya es %', v_periodicidad using errcode = '22023';
  end if;

  -- Anular primero: si algo falla aquí (pagos, alcance, periodo ya empezado),
  -- la transacción entera se deshace y no se emite nada.
  perform public.anular_factura_no_pagada(
    v_factura.id,
    format('cambio de modalidad %s → %s', v_actual, v_periodicidad));

  v_nueva := public.emitir_factura_cuenta(v_cuenta_id, v_periodicidad, 'cliente');

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_cuenta_id, v_nueva.suscripcion_id, 'modalidad_cambiada',
          jsonb_build_object('de', v_actual, 'a', v_periodicidad,
                             'factura_anulada', v_factura.numero,
                             'factura_nueva', v_nueva.numero,
                             'total_anterior', v_factura.total,
                             'total_nuevo', v_nueva.total),
          case when public.is_super_admin() then 'superadmin' else 'cliente' end);

  return v_nueva;
end;
$$;

-- ----------------------------------------------------------------------------
-- Permisos.
--
-- Las dos son SECURITY DEFINER y comprueban el alcance por dentro, así que el
-- cliente puede llamarlas: solo alcanzan a su propia cuenta. anon no.
-- ----------------------------------------------------------------------------
revoke all on function public.anular_factura_no_pagada(uuid, text)   from public, anon;
revoke all on function public.cambiar_modalidad_factura(text, uuid)  from public, anon;

grant execute on function public.anular_factura_no_pagada(uuid, text)  to authenticated, service_role;
grant execute on function public.cambiar_modalidad_factura(text, uuid) to authenticated, service_role;

-- La limpieza de AX-01004 va en su propia migración
-- (20260827020000_fac_anular_ax01004.sql): esta solo toca el esquema, y así un
-- fallo de datos no revierte la creación de las funciones.

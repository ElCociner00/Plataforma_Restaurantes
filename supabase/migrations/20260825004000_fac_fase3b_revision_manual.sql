-- ============================================================================
-- FACTURACIÓN · FASE 3 (b) — Revisión manual de comprobantes
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §3.5 y §7 Fase 0.6
--
-- El defecto que corrige:
--
--   revision_pagos.js llamaba al RPC aprobar_pago, que NUNCA se desplegó
--   (supabase/sql/002_billing_rpcs.sql no se ejecutó jamás). Caía entonces a un
--   fallback que escribía el CORREO del revisor en revisado_por, una columna
--   uuid con FK a system_users(id). El UPDATE fallaba por tipo, el código no
--   comprobaba el error, y las dos sentencias siguientes marcaban el ciclo como
--   pagado igualmente. Resultado: comprobante "pendiente" para siempre y
--   empresa dada por pagada.
--
--   El SQL nunca desplegado arrastraba el mismo error de tipo (p_revisado_por
--   text), así que desplegarlo tal cual tampoco lo arreglaba.
--
-- Aquí se hace bien: el revisor sale de auth.uid(), nunca del cliente, y el
-- pago se registra también contra el modelo nuevo, moviendo la vigencia.
-- ============================================================================

begin;

-- Firmas viejas con p_revisado_por text: fuera, para que nadie las llame por
-- error desde código antiguo.
drop function if exists public.aprobar_pago(uuid, text, text);
drop function if exists public.rechazar_pago(uuid, text, text);

-- ----------------------------------------------------------------------------
-- aprobar_pago — el superadmin da por bueno un comprobante subido a mano
--
-- Sigue haciendo falta aunque exista el cobro en línea: transferencias, pagos
-- en efectivo y conciliaciones puntuales entran por aquí.
-- ----------------------------------------------------------------------------
create or replace function public.aprobar_pago(
  p_attempt_id    uuid,
  p_observaciones text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor     uuid := auth.uid();
  v_attempt   public.payment_attempts%rowtype;
  v_cuenta_id uuid;
  v_factura   public.facturas_suscripcion%rowtype;
  v_monto     numeric;
  v_resultado jsonb := jsonb_build_object('modelo_nuevo', 'sin_factura_abierta');
begin
  if not public.is_super_admin() then
    raise exception 'Solo un superadministrador puede aprobar pagos' using errcode = '42501';
  end if;

  select * into v_attempt from public.payment_attempts where id = p_attempt_id;
  if not found then
    raise exception 'El comprobante % no existe', p_attempt_id using errcode = '22023';
  end if;

  if v_attempt.estado = 'aprobado' then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;

  -- revisado_por es uuid con FK a system_users: va el id del superadmin, que
  -- sale de la sesión. Nunca un correo, y nunca algo enviado por el cliente.
  update public.payment_attempts
  set estado        = 'aprobado',
      revisado_por  = v_actor,
      observaciones = coalesce(p_observaciones, observaciones),
      updated_at    = now()
  where id = p_attempt_id;

  -- Modelo viejo: se mantiene al día mientras siga vivo.
  if v_attempt.billing_cycle_id is not null then
    update public.billing_cycles
    set estado              = 'paid_verified',
        banner_activo       = false,
        suspension_aplicada = false,
        updated_at          = now()
    where id = v_attempt.billing_cycle_id;
  end if;

  update public.empresas
  set mostrar_anuncio_impago = false
  where id = v_attempt.empresa_id;

  -- Modelo nuevo: registrar el pago de verdad y mover la vigencia.
  v_cuenta_id := public.cuenta_de_empresa(v_attempt.empresa_id);

  if v_cuenta_id is not null then
    select * into v_factura
    from public.facturas_suscripcion
    where cuenta_id = v_cuenta_id and estado in ('emitida', 'vencida')
    order by fecha_corte asc
    limit 1;

    if found then
      -- El comprobante viejo se guardaba con monto_reportado = 0 fijo (§3.2).
      -- Si no trae monto, se toma el total de la factura: es el superadmin
      -- quien está aprobando, y ya vio el comprobante.
      v_monto := coalesce(nullif(v_attempt.monto_reportado, 0), v_factura.total);

      v_resultado := public.registrar_pago_confirmado(
        'manual',
        'comprobante:' || p_attempt_id::text,
        public.referencia_de_factura(v_factura.id),
        v_monto,
        v_factura.moneda,
        coalesce(v_attempt.canal, 'transferencia'),
        jsonb_build_object('attempt_id', p_attempt_id,
                           'comprobante_url', v_attempt.comprobante_url,
                           'aprobado_por', v_actor)
      );
    end if;
  end if;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (v_attempt.empresa_id, v_attempt.billing_cycle_id, 'pago_aprobado',
          jsonb_build_object('attempt_id', p_attempt_id, 'observaciones', p_observaciones,
                             'resultado', v_resultado),
          coalesce(auth.jwt()->>'email', v_actor::text));

  return jsonb_build_object('ok', true, 'repetido', false, 'resultado', v_resultado);
end;
$$;

-- ----------------------------------------------------------------------------
-- rechazar_pago
-- ----------------------------------------------------------------------------
create or replace function public.rechazar_pago(
  p_attempt_id    uuid,
  p_observaciones text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   uuid := auth.uid();
  v_attempt public.payment_attempts%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un superadministrador puede rechazar pagos' using errcode = '42501';
  end if;

  select * into v_attempt from public.payment_attempts where id = p_attempt_id;
  if not found then
    raise exception 'El comprobante % no existe', p_attempt_id using errcode = '22023';
  end if;

  update public.payment_attempts
  set estado        = 'rechazado',
      revisado_por  = v_actor,
      observaciones = coalesce(p_observaciones, observaciones),
      updated_at    = now()
  where id = p_attempt_id;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (v_attempt.empresa_id, v_attempt.billing_cycle_id, 'pago_rechazado',
          jsonb_build_object('attempt_id', p_attempt_id, 'observaciones', p_observaciones),
          coalesce(auth.jwt()->>'email', v_actor::text));

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.aprobar_pago(uuid, text)  to authenticated;
grant execute on function public.rechazar_pago(uuid, text) to authenticated;

commit;

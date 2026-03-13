-- RPCs de facturación (FASE 3)
-- Nota: ejecutar con rol de servicio en Supabase SQL Editor.

create or replace function public.aprobar_pago(
  p_attempt_id uuid,
  p_revisado_por text,
  p_observaciones text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_attempt record;
begin
  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'payment_attempts no encontrado';
  end if;

  update public.payment_attempts
  set estado = 'aprobado',
      revisado_por = p_revisado_por,
      observaciones = p_observaciones,
      updated_at = now()
  where id = p_attempt_id;

  update public.billing_cycles
  set estado = 'paid_verified',
      banner_activo = false,
      suspension_aplicada = false,
      updated_at = now()
  where id = v_attempt.billing_cycle_id;

  update public.empresas
  set mostrar_anuncio_impago = false,
      activa = true,
      activo = true
  where id = v_attempt.empresa_id;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (v_attempt.empresa_id, v_attempt.billing_cycle_id, 'pago_aprobado', jsonb_build_object('attempt_id', p_attempt_id, 'observaciones', p_observaciones), p_revisado_por);

  return jsonb_build_object('ok', true, 'attempt_id', p_attempt_id, 'accion', 'aprobado');
end;
$$;

create or replace function public.rechazar_pago(
  p_attempt_id uuid,
  p_revisado_por text,
  p_observaciones text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_attempt record;
begin
  select * into v_attempt
  from public.payment_attempts
  where id = p_attempt_id
  for update;

  if v_attempt.id is null then
    raise exception 'payment_attempts no encontrado';
  end if;

  update public.payment_attempts
  set estado = 'rechazado',
      revisado_por = p_revisado_por,
      observaciones = p_observaciones,
      updated_at = now()
  where id = p_attempt_id;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (v_attempt.empresa_id, v_attempt.billing_cycle_id, 'pago_rechazado', jsonb_build_object('attempt_id', p_attempt_id, 'observaciones', p_observaciones), p_revisado_por);

  return jsonb_build_object('ok', true, 'attempt_id', p_attempt_id, 'accion', 'rechazado');
end;
$$;

create or replace function public.aplicar_suspension(
  p_empresa_id uuid,
  p_billing_cycle_id uuid
)
returns jsonb
language plpgsql
security definer
as $$
begin
  update public.empresas
  set plan_actual = 'free',
      activa = false,
      activo = false,
      mostrar_anuncio_impago = true
  where id = p_empresa_id;

  update public.billing_cycles
  set estado = 'suspended',
      suspension_aplicada = true,
      banner_activo = true,
      updated_at = now()
  where id = p_billing_cycle_id;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (p_empresa_id, p_billing_cycle_id, 'suspension_aplicada', '{}'::jsonb, 'sistema');

  return jsonb_build_object('ok', true, 'empresa_id', p_empresa_id, 'accion', 'suspendida');
end;
$$;

create or replace function public.restaurar_servicio(
  p_empresa_id uuid,
  p_billing_cycle_id uuid,
  p_plan_restaurado text default 'pro'
)
returns jsonb
language plpgsql
security definer
as $$
begin
  update public.empresas
  set plan_actual = coalesce(p_plan_restaurado, 'pro'),
      activa = true,
      activo = true,
      mostrar_anuncio_impago = false
  where id = p_empresa_id;

  update public.billing_cycles
  set estado = 'paid_verified',
      suspension_aplicada = false,
      banner_activo = false,
      updated_at = now()
  where id = p_billing_cycle_id;

  insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
  values (p_empresa_id, p_billing_cycle_id, 'servicio_restaurado', jsonb_build_object('plan', p_plan_restaurado), 'sistema');

  return jsonb_build_object('ok', true, 'empresa_id', p_empresa_id, 'accion', 'restaurada');
end;
$$;

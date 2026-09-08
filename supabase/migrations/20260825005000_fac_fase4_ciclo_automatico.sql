-- ============================================================================
-- FACTURACIÓN · FASE 4 — Ciclo automático
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §1.2 y §7 Fase 4
--
-- El calendario que se automatiza:
--
--   día 25        se emite y se envía la factura del mes (ya es pagable)
--   último día    corte del periodo
--   días 1-5      gracia; puede pagar sin perder nada
--   día 6         vencida  →  SE ANOTA quién quedaría restringido, NO se
--                             restringe a nadie (§1.4)
--
-- Quién queda fuera, siempre:
--   - cuentas tipo interna / cortesia
--   - suscripciones en implementación (no tienen reloj)
--   - suscripciones en prueba vigente
--   - cuentas con cubierto_hasta por delante (el caso del pago anual de BATUT:
--     no se le emite nada hasta que se acerque mayo de 2027)
-- ============================================================================

begin;

create or replace function public.facturacion_ciclo_diario(p_forzar_dia integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy         date    := (now() at time zone 'America/Bogota')::date;
  v_dia         integer := coalesce(p_forzar_dia, extract(day from v_hoy)::integer);
  v_fin_mes     date    := (date_trunc('month', v_hoy) + interval '1 month' - interval '1 day')::date;
  v_dia_emision integer := 25;
  v_emitidas    jsonb   := '[]'::jsonb;
  v_recordar    jsonb   := '[]'::jsonb;
  v_vencidas    jsonb   := '[]'::jsonb;
  v_fila        record;
  v_factura     public.facturas_suscripcion%rowtype;
begin
  -- ── 1. Emisión (día 25 en adelante) ───────────────────────────────────────
  if v_dia >= v_dia_emision then
    for v_fila in
      select c.id as cuenta_id, c.nombre, c.correo_facturacion, s.id as suscripcion_id
      from public.cuentas c
      join public.suscripciones s on s.cuenta_id = c.id
      where c.tipo = 'cliente'
        and s.estado not in ('cancelada', 'implementacion')
        and (s.prueba_hasta   is null or s.prueba_hasta   <  v_hoy)
        and (s.cubierto_hasta is null or s.cubierto_hasta <  v_fin_mes)
    loop
      begin
        v_factura := public.emitir_factura_cuenta(v_fila.cuenta_id, null, 'cron');

        -- emitir_factura_cuenta es idempotente: si la factura ya existía la
        -- devuelve. Solo se avisa de las emitidas HOY, para no repetir correos.
        if v_factura.fecha_emision = v_hoy then
          v_emitidas := v_emitidas || jsonb_build_array(jsonb_build_object(
            'cuenta_id', v_fila.cuenta_id, 'cuenta', v_fila.nombre,
            'correo', v_fila.correo_facturacion,
            'numero', v_factura.numero, 'total', v_factura.total,
            'periodo_desde', v_factura.periodo_desde, 'periodo_hasta', v_factura.periodo_hasta,
            'fecha_limite_pago', v_factura.fecha_limite_pago
          ));
        end if;
      exception when others then
        -- Que una cuenta falle no puede dejar sin facturar a las demás.
        insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
        values (v_fila.cuenta_id, 'error_emision',
                jsonb_build_object('error', sqlerrm), 'cron');
      end;
    end loop;
  end if;

  -- ── 2. Recordatorios (días 1 y 4 de gracia) ───────────────────────────────
  if v_dia in (1, 4) then
    select coalesce(jsonb_agg(jsonb_build_object(
             'cuenta_id', c.id, 'cuenta', c.nombre, 'correo', c.correo_facturacion,
             'numero', f.numero, 'total', f.total,
             'fecha_limite_pago', f.fecha_limite_pago,
             'dias_restantes', f.fecha_limite_pago - v_hoy
           )), '[]'::jsonb)
    into v_recordar
    from public.facturas_suscripcion f
    join public.cuentas c on c.id = f.cuenta_id
    where f.estado = 'emitida'
      and c.tipo = 'cliente'
      and f.fecha_limite_pago >= v_hoy;
  end if;

  -- ── 3. Vencimiento (día 6 en adelante) ────────────────────────────────────
  update public.facturas_suscripcion f
  set estado = 'vencida', updated_at = now()
  from public.cuentas c
  where c.id = f.cuenta_id
    and c.tipo = 'cliente'
    and f.estado = 'emitida'
    and f.fecha_limite_pago < v_hoy;

  select coalesce(jsonb_agg(jsonb_build_object(
           'cuenta_id', c.id, 'cuenta', c.nombre, 'correo', c.correo_facturacion,
           'numero', f.numero, 'total', f.total,
           'fecha_limite_pago', f.fecha_limite_pago,
           'dias_vencido', v_hoy - f.fecha_limite_pago
         )), '[]'::jsonb)
  into v_vencidas
  from public.facturas_suscripcion f
  join public.cuentas c on c.id = f.cuenta_id
  where f.estado = 'vencida' and c.tipo = 'cliente';

  -- Estado informativo de la suscripción. NO restringe: solo describe.
  update public.suscripciones s
  set estado = 'morosa', updated_at = now()
  where s.estado = 'activa'
    and exists (
      select 1 from public.facturas_suscripcion f
      where f.cuenta_id = s.cuenta_id and f.estado = 'vencida'
    );

  -- ── 4. Modo observación (§1.4) ────────────────────────────────────────────
  -- Aquí es donde, el día que Andrés lo autorice, se encenderá el corte.
  -- Hasta entonces se limita a dejar constancia de a quién habría afectado.
  insert into public.billing_observaciones (empresa_id, fecha, periodo, accion, monto, dias_vencido)
  select ce.empresa_id, v_hoy, to_char(v_hoy, 'YYYY-MM'), 'habria_suspendido',
         f.total, v_hoy - f.fecha_limite_pago
  from public.facturas_suscripcion f
  join public.cuentas c         on c.id = f.cuenta_id and c.tipo = 'cliente'
  join public.cuenta_empresas ce on ce.cuenta_id = f.cuenta_id and ce.activo
  where f.estado = 'vencida'
  on conflict (empresa_id, fecha, accion) do nothing;

  -- El banner sí se enciende: avisar no es bloquear.
  update public.empresas e
  set mostrar_anuncio_impago = true
  from public.cuenta_empresas ce
  join public.facturas_suscripcion f on f.cuenta_id = ce.cuenta_id and f.estado = 'vencida'
  where ce.empresa_id = e.id and ce.activo;

  return jsonb_build_object(
    'ok', true, 'fecha', v_hoy, 'dia', v_dia,
    'modo', 'observacion',
    'emitidas', v_emitidas,
    'recordatorios', v_recordar,
    'vencidas', v_vencidas
  );
end;
$$;

comment on function public.facturacion_ciclo_diario(integer) is
  'Ciclo diario de facturación: emite el 25, recuerda el 1 y el 4, vence el 6. NO restringe a nadie: anota en billing_observaciones lo que habría hecho.';

grant execute on function public.facturacion_ciclo_diario(integer) to service_role;

commit;

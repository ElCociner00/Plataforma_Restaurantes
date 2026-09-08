-- ============================================================================
-- CICLO DE VIDA · FASE F — Consola de administración
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase F
--
-- cuentas_backoffice() se amplía con todo el ciclo de vida: en qué estado está
-- cada cuenta, cuánto le queda de ventana o de prueba, qué hay que atender hoy.
-- Se añaden además las métricas y la bandeja de conciliación, que hoy recogía
-- pagos descuadrados que no veía nadie.
-- ============================================================================

begin;

create or replace function public.cuentas_backoffice()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  perform public.exigir_permiso_superadmin('ver_cuentas');

  return coalesce((
    select jsonb_agg(fila order by fila->>'orden', fila->>'nombre')
    from (
      select jsonb_build_object(
        'id', c.id,
        'nombre', c.nombre,
        'nit', c.nit,
        'tipo', c.tipo,
        'estado', c.estado,
        'correo_facturacion', c.correo_facturacion,
        'contacto_nombre', c.contacto_nombre,
        'notas', c.notas,

        -- Ciclo de vida
        'registrada_en', c.registrada_en,
        'activacion_limite', c.activacion_limite,
        'dias_para_activar', case when c.activacion_limite is not null
                                  then c.activacion_limite - v_hoy end,
        'bloqueada_en', c.bloqueada_en,
        'cancelada_en', c.cancelada_en,
        'motivo_cancelacion', c.motivo_cancelacion,
        'purgar_desde', c.purgar_desde,
        'reactivada_en', c.reactivada_en,

        -- Orden en la lista: primero lo que hay que atender
        'orden', case c.estado
                   when 'bloqueada_sin_activar' then '1'
                   when 'morosa'                then '2'
                   when 'registrada'            then '3'
                   when 'implementacion'        then '4'
                   when 'prueba'                then '5'
                   when 'cancelada'             then '6'
                   when 'activa'                then '7'
                   else '8'
                 end || case when c.tipo = 'cliente' then 'a' else 'b' end,

        'suscripcion', case when s.id is null then null else jsonb_build_object(
          'id', s.id, 'plan_id', s.plan_id, 'periodicidad', s.periodicidad,
          'estado', s.estado,
          'prueba_desde', s.prueba_desde, 'prueba_hasta', s.prueba_hasta,
          'dias_prueba', case when s.prueba_hasta is not null then s.prueba_hasta - v_hoy end,
          'cubierto_hasta', s.cubierto_hasta,
          'dias_restantes', case when s.cubierto_hasta is not null then s.cubierto_hasta - v_hoy end,
          'renovacion_automatica', s.renovacion_automatica,
          'proveedor', s.proveedor, 'metodo_pago_resumen', s.metodo_pago_resumen
        ) end,

        'sedes', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'empresa_id', e.id, 'nombre', e.nombre_comercial,
                   'principal', ce.es_principal,
                   'acceso', public.acceso_de_empresa(e.id)->>'nivel'
                 ) order by ce.es_principal desc, e.nombre_comercial), '[]'::jsonb)
          from public.cuenta_empresas ce join public.empresas e on e.id = ce.empresa_id
          where ce.cuenta_id = c.id and ce.activo
        ),

        'precio', case when c.tipo = 'cliente'
                       then public.calcular_monto_cuenta(c.id, coalesce(s.periodicidad, 'mensual'))
                  end,

        'facturas_abiertas', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'id', f.id, 'numero', f.numero, 'total', f.total,
                   'fecha_corte', f.fecha_corte, 'fecha_limite_pago', f.fecha_limite_pago,
                   'estado', f.estado,
                   'dias_vencido', greatest(0, v_hoy - f.fecha_limite_pago)
                 ) order by f.fecha_corte), '[]'::jsonb)
          from public.facturas_suscripcion f
          where f.cuenta_id = c.id and f.estado in ('emitida', 'vencida')
        ),

        'pagado_total', (
          select coalesce(sum(p.monto), 0)
          from public.pagos_suscripcion p
          where p.cuenta_id = c.id and p.estado = 'confirmado'
        ),

        'observaciones', (
          select count(*)
          from public.billing_observaciones o
          join public.cuenta_empresas ce on ce.empresa_id = o.empresa_id and ce.activo
          where ce.cuenta_id = c.id
        ),

        'bitacora', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'tipo', b.tipo, 'actor', b.actor,
                   'cuando', b.created_at, 'detalle', b.detalle
                 ) order by b.created_at desc), '[]'::jsonb)
          from (select * from public.suscripcion_bitacora sb
                where sb.cuenta_id = c.id
                order by sb.created_at desc limit 8) b
        )
      ) as fila
      from public.cuentas c
      left join public.suscripciones s
             on s.cuenta_id = c.id and s.estado <> 'purgada'
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- Métricas de negocio
-- ----------------------------------------------------------------------------
create or replace function public.metricas_facturacion()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_mes date := date_trunc('month', v_hoy)::date;
begin
  perform public.exigir_permiso_superadmin('ver_cuentas');

  return jsonb_build_object(
    'ingreso_recurrente_mensual', (
      select coalesce(sum((public.calcular_monto_cuenta(c.id, 'mensual')->>'total')::numeric), 0)
      from public.cuentas c
      join public.suscripciones s on s.cuenta_id = c.id
      where c.tipo = 'cliente' and c.estado in ('activa', 'morosa')
    ),
    'clientes_activos',   (select count(*) from public.cuentas where tipo='cliente' and estado in ('activa','morosa')),
    'en_prueba',          (select count(*) from public.cuentas where tipo='cliente' and estado='prueba'),
    'sin_activar',        (select count(*) from public.cuentas where tipo='cliente' and estado='registrada'),
    'bloqueadas',         (select count(*) from public.cuentas where estado='bloqueada_sin_activar'),
    'canceladas',         (select count(*) from public.cuentas where estado='cancelada'),
    'altas_del_mes',      (select count(*) from public.cuentas where tipo='cliente' and registrada_en >= v_mes),
    'bajas_del_mes',      (select count(*) from public.cuentas where cancelada_en >= v_mes),
    'mora_total', (
      select coalesce(sum(f.total), 0)
      from public.facturas_suscripcion f join public.cuentas c on c.id = f.cuenta_id
      where c.tipo='cliente' and f.estado = 'vencida'
    ),
    'cobrado_del_mes', (
      select coalesce(sum(p.monto), 0)
      from public.pagos_suscripcion p
      where p.estado='confirmado' and p.fecha_pago >= v_mes
    ),
    'por_conciliar', (
      select count(*) from public.pagos_suscripcion where estado = 'pendiente_conciliar'
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- Bandeja de conciliación: pagos que entraron pero no cuadraron
--
-- Hoy registrar_pago_confirmado() los guarda bien —descuadres y referencias
-- irreconocibles— pero no había pantalla que los mostrara.
-- ----------------------------------------------------------------------------
create or replace function public.pagos_por_conciliar()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.exigir_permiso_superadmin('conciliar_pagos');

  return jsonb_build_object(
    'pagos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'cuenta', c.nombre, 'cuenta_id', p.cuenta_id,
               'monto', p.monto, 'moneda', p.moneda, 'canal', p.canal,
               'proveedor', p.proveedor, 'proveedor_pago_id', p.proveedor_pago_id,
               'referencia', p.referencia, 'fecha_pago', p.fecha_pago,
               'factura', f.numero, 'factura_total', f.total,
               'diferencia', p.monto - coalesce(f.total, 0)
             ) order by p.fecha_pago desc)
      from public.pagos_suscripcion p
      left join public.cuentas c on c.id = p.cuenta_id
      left join public.facturas_suscripcion f on f.id = p.factura_id
      where p.estado = 'pendiente_conciliar'
    ), '[]'::jsonb),
    'huerfanos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'proveedor', e.proveedor, 'evento_id', e.evento_id,
               'recibido', e.recibido_at, 'error', e.error, 'payload', e.payload
             ) order by e.recibido_at desc)
      from public.pasarela_eventos e
      where e.resultado in ('sin_factura', 'error')
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.metricas_facturacion()  to authenticated;
grant execute on function public.pagos_por_conciliar()   to authenticated;

commit;

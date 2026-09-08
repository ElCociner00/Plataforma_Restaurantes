-- ============================================================================
-- FACTURACIÓN · FASE 5 — Backoffice de cuentas
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §7 Fase 5.2
--
-- Lo que necesita la pantalla del superadmin, en un solo viaje: cuentas, sus
-- sedes, la suscripción, la vigencia y las facturas abiertas. Y las dos
-- acciones que hoy no existen en ninguna parte:
--
--   · "Iniciar prueba"  — arranca el reloj de los 15 días cuando la
--                         implementación termina, no al crear la empresa (§1.3).
--                         Es el botón que pondrá en marcha a BATUT Cartagena.
--   · "Emitir factura"  — emisión manual, para no depender del día 25.
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
  if not public.is_super_admin() then
    raise exception 'Solo un superadministrador puede ver el backoffice' using errcode = '42501';
  end if;

  return coalesce((
    select jsonb_agg(fila order by fila->>'tipo', fila->>'nombre')
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
        'suscripcion', case when s.id is null then null else jsonb_build_object(
          'id', s.id,
          'plan_id', s.plan_id,
          'periodicidad', s.periodicidad,
          'estado', s.estado,
          'prueba_desde', s.prueba_desde,
          'prueba_hasta', s.prueba_hasta,
          'cubierto_hasta', s.cubierto_hasta,
          'dias_restantes', case when s.cubierto_hasta is not null then s.cubierto_hasta - v_hoy end,
          'renovacion_automatica', s.renovacion_automatica,
          'proveedor', s.proveedor,
          'metodo_pago_resumen', s.metodo_pago_resumen
        ) end,
        'sedes', (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'empresa_id', e.id, 'nombre', e.nombre_comercial,
                   'principal', ce.es_principal, 'activa', (e.activa and e.activo)
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
        -- Modo observación: cuántas veces se habría restringido a esta cuenta
        -- si el corte estuviera encendido (§1.4). Informativo, nada más.
        'observaciones', (
          select count(*)
          from public.billing_observaciones o
          join public.cuenta_empresas ce on ce.empresa_id = o.empresa_id and ce.activo
          where ce.cuenta_id = c.id
        )
      ) as fila
      from public.cuentas c
      left join public.suscripciones s on s.cuenta_id = c.id and s.estado <> 'cancelada'
    ) t
  ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- Emisión manual desde el backoffice.
-- emitir_factura_cuenta solo la puede llamar service_role; este envoltorio
-- añade la comprobación de superadmin para poder exponerla al navegador.
-- ----------------------------------------------------------------------------
create or replace function public.emitir_factura_manual(
  p_cuenta_id    uuid,
  p_periodicidad text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_factura public.facturas_suscripcion%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un superadministrador puede emitir facturas' using errcode = '42501';
  end if;

  v_factura := public.emitir_factura_cuenta(
    p_cuenta_id, p_periodicidad, coalesce(auth.jwt()->>'email', 'superadmin')
  );

  return jsonb_build_object(
    'ok', true, 'numero', v_factura.numero, 'total', v_factura.total,
    'periodo_desde', v_factura.periodo_desde, 'periodo_hasta', v_factura.periodo_hasta,
    'fecha_limite_pago', v_factura.fecha_limite_pago, 'estado', v_factura.estado
  );
end;
$$;

grant execute on function public.cuentas_backoffice()                 to authenticated;
grant execute on function public.emitir_factura_manual(uuid, text)    to authenticated;

commit;

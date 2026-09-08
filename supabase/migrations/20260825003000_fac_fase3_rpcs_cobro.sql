-- ============================================================================
-- FACTURACIÓN · FASE 3 (a) — RPC del circuito de cobro
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §4 y §7 Fase 3
--
-- Aquí vive la parte transaccional. Las Edge Functions hablan con Wompi; la
-- verdad sobre el dinero se escribe SIEMPRE por estas funciones, en una sola
-- transacción, para que no exista el estado intermedio "cobré pero no anoté".
--
-- La regla de oro de §4.1: una factura solo se marca pagada desde el webhook
-- verificado, nunca desde la redirección del navegador.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Referencia de pago <-> factura
--
-- La referencia que viaja a Wompi es:  <uuid de factura sin guiones>-<epoch>
-- El sufijo permite reintentar un pago fallido sin repetir referencia; el
-- prefijo es lo que hace que la notificación se pueda aplicar a la factura
-- correcta. Esto es exactamente lo que le falta al link estático de hoy (§3.1).
-- ----------------------------------------------------------------------------
create or replace function public.referencia_de_factura(p_factura_id uuid)
returns text
language sql
volatile
as $$
  select replace(p_factura_id::text, '-', '') || '-' || extract(epoch from now())::bigint::text;
$$;

create or replace function public.factura_por_referencia(p_referencia text)
returns uuid
language plpgsql
stable
as $$
declare
  v_hex text := split_part(coalesce(p_referencia, ''), '-', 1);
begin
  if length(v_hex) <> 32 then
    return null;
  end if;
  return (substr(v_hex,1,8)  || '-' || substr(v_hex,9,4)  || '-' ||
          substr(v_hex,13,4) || '-' || substr(v_hex,17,4) || '-' ||
          substr(v_hex,21,12))::uuid;
exception when others then
  return null;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Emitir la factura de una cuenta
--
-- Calendario de §1.2: corte el último día del periodo, límite de pago el día 5
-- del mes siguiente. Prorrateo por días cuando el periodo no empieza en día 1
-- (es el caso del primer mes tras la prueba).
--
-- Idempotente: si ya existe una factura viva para ese mismo periodo, la
-- devuelve en vez de emitir otra.
-- ----------------------------------------------------------------------------
create or replace function public.emitir_factura_cuenta(
  p_cuenta_id    uuid,
  p_periodicidad text default null,
  p_actor        text default 'sistema'
)
returns public.facturas_suscripcion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
  v_cuenta     public.cuentas%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_periodicidad text;
  v_desde      date;
  v_hasta      date;
  v_monto      jsonb;
  v_total      numeric;
  v_subtotal   numeric;
  v_iva        numeric;
  v_detalle    jsonb;
  v_dias_mes   integer;
  v_dias_cobro integer;
  v_factor     numeric := 1;
  v_limite     date;
  v_factura    public.facturas_suscripcion%rowtype;
begin
  select * into v_cuenta from public.cuentas where id = p_cuenta_id;
  if not found then
    raise exception 'La cuenta % no existe', p_cuenta_id using errcode = '22023';
  end if;

  -- Internas y cortesías nunca reciben factura (§1.3).
  if v_cuenta.tipo in ('interna', 'cortesia') then
    raise exception 'La cuenta % es de tipo % y no se factura', v_cuenta.nombre, v_cuenta.tipo
      using errcode = '22023';
  end if;

  select * into v_sus
  from public.suscripciones
  where cuenta_id = p_cuenta_id and estado <> 'cancelada'
  limit 1;

  if not found then
    raise exception 'La cuenta % no tiene suscripción activa', v_cuenta.nombre using errcode = '22023';
  end if;

  v_periodicidad := lower(coalesce(p_periodicidad, v_sus.periodicidad, 'mensual'));

  -- ¿Desde cuándo cobra este periodo?
  --   1. Si ya hay periodo pagado por delante, el siguiente empieza al día
  --      siguiente de cubierto_hasta (así el pago anual de BATUT encadena bien).
  --   2. Si está en prueba vigente, empieza al terminar la prueba.
  --   3. Si no, el primer día del mes en curso.
  v_desde := coalesce(
    case when v_sus.cubierto_hasta is not null and v_sus.cubierto_hasta >= v_hoy
         then v_sus.cubierto_hasta + 1 end,
    case when v_sus.prueba_hasta is not null and v_sus.prueba_hasta >= v_hoy
         then v_sus.prueba_hasta + 1 end,
    date_trunc('month', v_hoy)::date
  );

  if v_periodicidad = 'anual' then
    v_hasta := (v_desde + interval '1 year' - interval '1 day')::date;
  else
    v_hasta := (date_trunc('month', v_desde) + interval '1 month' - interval '1 day')::date;
  end if;

  -- ¿Ya existe una factura viva para este mismo periodo?
  select * into v_factura
  from public.facturas_suscripcion
  where cuenta_id = p_cuenta_id
    and periodo_desde = v_desde
    and periodo_hasta = v_hasta
    and estado in ('emitida', 'vencida')
  limit 1;

  if found then
    return v_factura;
  end if;

  v_monto    := public.calcular_monto_cuenta(p_cuenta_id, v_periodicidad);
  v_subtotal := (v_monto->>'subtotal')::numeric;
  v_iva      := (v_monto->>'iva')::numeric;
  v_detalle  := v_monto->'detalle';

  -- Prorrateo por días: solo aplica al mensual que no arranca en día 1 (§1.2).
  if v_periodicidad = 'mensual' and extract(day from v_desde) > 1 then
    v_dias_mes   := extract(day from (date_trunc('month', v_desde) + interval '1 month' - interval '1 day'))::integer;
    v_dias_cobro := (v_hasta - v_desde) + 1;
    v_factor     := v_dias_cobro::numeric / v_dias_mes::numeric;

    v_subtotal := round(v_subtotal * v_factor);
    v_iva      := round(v_iva * v_factor);
    v_detalle  := v_detalle || jsonb_build_array(
      jsonb_build_object(
        'concepto', format('Prorrateo %s de %s días', v_dias_cobro, v_dias_mes),
        'cantidad', v_dias_cobro,
        'valor_unitario', null,
        'total', v_subtotal
      )
    );
  end if;

  v_total  := v_subtotal + v_iva;
  -- Límite de pago: día 5 del mes SIGUIENTE al del corte (§1.2).
  v_limite := (date_trunc('month', v_hasta) + interval '1 month' + interval '4 days')::date;

  insert into public.facturas_suscripcion (
    cuenta_id, suscripcion_id, numero,
    periodo_desde, periodo_hasta, detalle,
    subtotal, iva, total, moneda,
    fecha_emision, fecha_corte, fecha_limite_pago, estado
  )
  values (
    p_cuenta_id, v_sus.id, public.siguiente_numero_factura(),
    v_desde, v_hasta, v_detalle,
    v_subtotal, v_iva, v_total, 'COP',
    v_hoy, v_hasta, v_limite, 'emitida'
  )
  returning * into v_factura;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (p_cuenta_id, v_sus.id, 'factura_emitida',
          jsonb_build_object('numero', v_factura.numero, 'total', v_total,
                             'periodo', v_desde::text || ' → ' || v_hasta::text,
                             'periodicidad', v_periodicidad),
          p_actor);

  return v_factura;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. La factura que este cliente puede pagar ahora
--
-- La llama la Edge Function pago-iniciar. Devuelve la más antigua sin pagar;
-- si no hay ninguna y toca cobrar, la emite.
-- ----------------------------------------------------------------------------
create or replace function public.factura_a_pagar(
  p_empresa_id   uuid,
  p_periodicidad text default null
)
returns public.facturas_suscripcion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta_id uuid := public.cuenta_de_empresa(p_empresa_id);
  v_tipo      text;
  v_factura   public.facturas_suscripcion%rowtype;
begin
  if v_cuenta_id is null then
    raise exception 'Esta empresa no está vinculada a ninguna cuenta de facturación'
      using errcode = '22023';
  end if;

  select tipo into v_tipo from public.cuentas where id = v_cuenta_id;
  if v_tipo in ('interna', 'cortesia') then
    raise exception 'Esta cuenta no genera cobros' using errcode = '22023';
  end if;

  -- Si el cliente elige explícitamente anual, se emite una anual nueva aunque
  -- haya mensuales pendientes: es una decisión suya, no un descuido.
  if lower(coalesce(p_periodicidad, '')) = 'anual' then
    return public.emitir_factura_cuenta(v_cuenta_id, 'anual', 'cliente');
  end if;

  select * into v_factura
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta_id and estado in ('emitida', 'vencida')
  order by fecha_corte asc
  limit 1;

  if found then
    return v_factura;
  end if;

  return public.emitir_factura_cuenta(v_cuenta_id, p_periodicidad, 'cliente');
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. registrar_pago_confirmado — el corazón del webhook (§4.4)
--
-- Todo o nada:
--   a) idempotencia por (proveedor, proveedor_pago_id)
--   b) el monto tiene que cuadrar; si no, se guarda para conciliar y NO se
--      marca la factura como pagada
--   c) mueve cubierto_hasta, que es lo que de verdad da derecho de uso (§6.1)
--   d) deja bitácora
--
-- SECURITY DEFINER y solo la llama service_role: ningún cliente puede
-- declararse pagado a sí mismo.
-- ----------------------------------------------------------------------------
create or replace function public.registrar_pago_confirmado(
  p_proveedor         text,
  p_proveedor_pago_id text,
  p_referencia        text,
  p_monto             numeric,
  p_moneda            text,
  p_canal             text,
  p_payload           jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_factura_id uuid;
  v_factura    public.facturas_suscripcion%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_pago_id    uuid;
  v_estado     text := 'confirmado';
  v_canal      text;
  v_nuevo_hasta date;
begin
  -- (a) ¿Ya se procesó este pago? Idempotencia real, por constraint.
  select id into v_pago_id
  from public.pagos_suscripcion
  where proveedor = p_proveedor and proveedor_pago_id = p_proveedor_pago_id;

  if found then
    return jsonb_build_object('ok', true, 'repetido', true, 'pago_id', v_pago_id);
  end if;

  v_factura_id := public.factura_por_referencia(p_referencia);

  select * into v_factura from public.facturas_suscripcion where id = v_factura_id;
  if not found then
    -- Dinero que entró sin factura identificable. Se guarda igual: perder el
    -- registro de un pago recibido es mucho peor que tener que conciliarlo.
    insert into public.pasarela_eventos (proveedor, evento_id, tipo, payload, procesado_at, resultado, error)
    values (p_proveedor, 'huerfano:' || p_proveedor_pago_id, 'pago_sin_factura', p_payload, now(),
            'sin_factura', 'Referencia no reconocida: ' || coalesce(p_referencia, '(vacía)'))
    on conflict (proveedor, evento_id) do nothing;

    return jsonb_build_object('ok', false, 'motivo', 'factura_no_encontrada',
                              'referencia', p_referencia);
  end if;

  v_canal := lower(coalesce(p_canal, 'otro'));
  if v_canal not in ('tarjeta','pse','nequi','bancolombia','efectivo','transferencia','daviplata') then
    v_canal := 'otro';
  end if;

  -- (b) El monto tiene que cuadrar. Se tolera 1 peso de redondeo.
  if abs(coalesce(p_monto, 0) - v_factura.total) > 1 then
    v_estado := 'pendiente_conciliar';
  end if;

  insert into public.pagos_suscripcion (
    factura_id, cuenta_id, monto, moneda, fecha_pago,
    canal, proveedor, proveedor_pago_id, referencia, estado, payload
  )
  values (
    v_factura.id, v_factura.cuenta_id, p_monto, coalesce(p_moneda, 'COP'), now(),
    v_canal, p_proveedor, p_proveedor_pago_id, coalesce(p_referencia, ''), v_estado, p_payload
  )
  returning id into v_pago_id;

  if v_estado = 'pendiente_conciliar' then
    insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
    values (v_factura.cuenta_id, 'pago_descuadrado',
            jsonb_build_object('factura', v_factura.numero, 'esperado', v_factura.total,
                               'recibido', p_monto, 'pago_id', v_pago_id),
            'sistema:webhook');

    return jsonb_build_object('ok', false, 'motivo', 'monto_no_cuadra',
                              'esperado', v_factura.total, 'recibido', p_monto,
                              'pago_id', v_pago_id);
  end if;

  update public.facturas_suscripcion
  set estado = 'pagada', updated_at = now()
  where id = v_factura.id;

  -- (c) Mover la vigencia: esto es lo que realmente da derecho de uso.
  select * into v_sus from public.suscripciones where id = v_factura.suscripcion_id;

  if found then
    v_nuevo_hasta := greatest(coalesce(v_sus.cubierto_hasta, v_factura.periodo_hasta),
                              v_factura.periodo_hasta);

    update public.suscripciones
    set cubierto_hasta = v_nuevo_hasta,
        estado         = case when estado in ('morosa','restringida','prueba','implementacion')
                              then 'activa' else estado end,
        updated_at     = now()
    where id = v_sus.id;

    update public.cuentas
    set estado     = case when estado in ('morosa','restringida','prueba','implementacion')
                           then 'activa' else estado end,
        updated_at = now()
    where id = v_factura.cuenta_id;
  end if;

  -- El banner de impago se apaga para todas las sedes de la cuenta.
  update public.empresas e
  set mostrar_anuncio_impago = false
  from public.cuenta_empresas ce
  where ce.empresa_id = e.id and ce.cuenta_id = v_factura.cuenta_id and ce.activo;

  -- (d)
  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_factura.cuenta_id, v_factura.suscripcion_id, 'pago_confirmado',
          jsonb_build_object('factura', v_factura.numero, 'monto', p_monto,
                             'canal', v_canal, 'proveedor', p_proveedor,
                             'proveedor_pago_id', p_proveedor_pago_id,
                             'cubierto_hasta', v_nuevo_hasta),
          'sistema:webhook');

  return jsonb_build_object(
    'ok', true, 'repetido', false,
    'pago_id', v_pago_id,
    'factura', v_factura.numero,
    'cuenta_id', v_factura.cuenta_id,
    'cubierto_hasta', v_nuevo_hasta
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. revertir_pago — contracargos y devoluciones (§4.5)
-- ----------------------------------------------------------------------------
create or replace function public.revertir_pago(
  p_proveedor         text,
  p_proveedor_pago_id text,
  p_motivo            text default 'reverso'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_pago    public.pagos_suscripcion%rowtype;
  v_factura public.facturas_suscripcion%rowtype;
begin
  select * into v_pago
  from public.pagos_suscripcion
  where proveedor = p_proveedor and proveedor_pago_id = p_proveedor_pago_id;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pago_no_encontrado');
  end if;

  if v_pago.estado = 'revertido' then
    return jsonb_build_object('ok', true, 'repetido', true);
  end if;

  update public.pagos_suscripcion
  set estado  = 'revertido',
      payload = payload || jsonb_build_object('reverso_motivo', p_motivo, 'reverso_at', now())
  where id = v_pago.id;

  select * into v_factura from public.facturas_suscripcion where id = v_pago.factura_id;

  if found then
    update public.facturas_suscripcion
    set estado = 'vencida', updated_at = now()
    where id = v_factura.id;

    -- La vigencia retrocede al día anterior al periodo que ese pago cubría.
    update public.suscripciones
    set cubierto_hasta = least(coalesce(cubierto_hasta, v_factura.periodo_desde - 1),
                               v_factura.periodo_desde - 1),
        updated_at     = now()
    where id = v_factura.suscripcion_id;
  end if;

  insert into public.suscripcion_bitacora (cuenta_id, tipo, detalle, actor)
  values (v_pago.cuenta_id, 'pago_revertido',
          jsonb_build_object('proveedor_pago_id', p_proveedor_pago_id, 'motivo', p_motivo,
                             'monto', v_pago.monto),
          'sistema:webhook');

  return jsonb_build_object('ok', true, 'repetido', false);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. iniciar_prueba — el botón del backoffice (§1.3)
--
-- El reloj de los 15 días arranca AQUÍ, no al crear la empresa. También sirve
-- para extender la prueba si la implementación se alarga.
-- ----------------------------------------------------------------------------
create or replace function public.iniciar_prueba(
  p_cuenta_id uuid,
  p_dias      integer default 15
)
returns public.suscripciones
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_sus public.suscripciones%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Solo un superadministrador puede iniciar la prueba' using errcode = '42501';
  end if;

  update public.suscripciones
  set prueba_desde = coalesce(prueba_desde, v_hoy),
      prueba_hasta = v_hoy + greatest(coalesce(p_dias, 15), 1),
      estado       = 'prueba',
      updated_at   = now()
  where cuenta_id = p_cuenta_id and estado <> 'cancelada'
  returning * into v_sus;

  if not found then
    raise exception 'La cuenta % no tiene suscripción', p_cuenta_id using errcode = '22023';
  end if;

  update public.cuentas set estado = 'prueba', updated_at = now() where id = p_cuenta_id;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (p_cuenta_id, v_sus.id, 'prueba_iniciada',
          jsonb_build_object('dias', p_dias, 'hasta', v_sus.prueba_hasta),
          coalesce(auth.jwt()->>'email', 'superadmin'));

  return v_sus;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. estado_facturacion_empresa — lo que pinta la pantalla /facturacion/
-- ----------------------------------------------------------------------------
create or replace function public.estado_facturacion_empresa(p_empresa_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_empresa_id uuid := coalesce(p_empresa_id, public.current_empresa_id());
  v_cuenta_id  uuid;
  v_cuenta     public.cuentas%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_hoy        date := (now() at time zone 'America/Bogota')::date;
begin
  v_cuenta_id := public.cuenta_de_empresa(v_empresa_id);
  if v_cuenta_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sin_cuenta');
  end if;

  -- Solo la propia cuenta, el superadmin, o una Edge Function con la clave de
  -- servicio (que ya resolvió el contexto y el alcance antes de llamar aquí).
  if not public.is_super_admin()
     and not public.app_es_rol_servicio()
     and v_cuenta_id is distinct from public.mi_cuenta_id() then
    raise exception 'Fuera de alcance' using errcode = '42501';
  end if;

  select * into v_cuenta from public.cuentas       where id = v_cuenta_id;
  select * into v_sus    from public.suscripciones where cuenta_id = v_cuenta_id and estado <> 'cancelada' limit 1;

  return jsonb_build_object(
    'ok', true,
    'cuenta', jsonb_build_object(
      'id', v_cuenta.id, 'nombre', v_cuenta.nombre, 'nit', v_cuenta.nit,
      'tipo', v_cuenta.tipo, 'estado', v_cuenta.estado,
      'correo_facturacion', v_cuenta.correo_facturacion
    ),
    'suscripcion', case when v_sus.id is null then null else jsonb_build_object(
      'id', v_sus.id, 'plan_id', v_sus.plan_id, 'periodicidad', v_sus.periodicidad,
      'estado', v_sus.estado, 'prueba_hasta', v_sus.prueba_hasta,
      'cubierto_hasta', v_sus.cubierto_hasta,
      'dias_restantes', case when v_sus.cubierto_hasta is not null
                             then v_sus.cubierto_hasta - v_hoy end,
      'renovacion_automatica', v_sus.renovacion_automatica,
      'proveedor', v_sus.proveedor, 'metodo_pago_resumen', v_sus.metodo_pago_resumen
    ) end,
    'sedes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'empresa_id', e.id, 'nombre', e.nombre_comercial, 'principal', ce.es_principal
             ) order by ce.es_principal desc, e.nombre_comercial), '[]'::jsonb)
      from public.cuenta_empresas ce join public.empresas e on e.id = ce.empresa_id
      where ce.cuenta_id = v_cuenta_id and ce.activo
    ),
    'precio_mensual', public.calcular_monto_cuenta(v_cuenta_id, 'mensual'),
    'precio_anual',   public.calcular_monto_cuenta(v_cuenta_id, 'anual'),
    'al_dia', public.cuenta_al_dia(v_empresa_id),
    'facturas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id, 'numero', f.numero, 'total', f.total,
               'periodo_desde', f.periodo_desde, 'periodo_hasta', f.periodo_hasta,
               'fecha_corte', f.fecha_corte, 'fecha_limite_pago', f.fecha_limite_pago,
               'estado', f.estado, 'detalle', f.detalle,
               'total_en_letras', public.monto_en_letras(f.total)
             ) order by f.fecha_corte desc), '[]'::jsonb)
      from public.facturas_suscripcion f
      where f.cuenta_id = v_cuenta_id and f.numero not like 'AX-H-%'
    )
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Permisos
--
-- Nótese qué NO se concede: registrar_pago_confirmado y revertir_pago solo las
-- puede llamar service_role, es decir, las Edge Functions. Un cliente con
-- sesión no puede declararse pagado.
-- ----------------------------------------------------------------------------
revoke all on function public.registrar_pago_confirmado(text,text,text,numeric,text,text,jsonb) from public, anon, authenticated;
revoke all on function public.revertir_pago(text,text,text)                                     from public, anon, authenticated;

grant execute on function public.registrar_pago_confirmado(text,text,text,numeric,text,text,jsonb) to service_role;
grant execute on function public.revertir_pago(text,text,text)                                     to service_role;
grant execute on function public.emitir_factura_cuenta(uuid,text,text)                             to service_role;
grant execute on function public.factura_a_pagar(uuid,text)                                        to service_role;
grant execute on function public.referencia_de_factura(uuid)                                       to service_role;
grant execute on function public.factura_por_referencia(text)                                      to service_role;
grant execute on function public.iniciar_prueba(uuid,integer)                                      to authenticated, service_role;
grant execute on function public.estado_facturacion_empresa(uuid)                                  to authenticated, service_role;

commit;

-- Un pago confirmado tiene que dar derecho de uso. Hasta ahora no siempre lo daba.
--
-- El agujero, paso a paso:
--   1. Una empresa se registra sola          -> cuentas.estado = 'registrada',
--                                               con activacion_limite.
--   2. No activa la prueba dentro del plazo  -> `ciclo_vida_diario` (pg_cron)
--                                               la pasa a 'bloqueada_sin_activar'.
--   3. `acceso_de_empresa` devuelve 'solo_facturacion' -> solo lectura.
--   4. La empresa PAGA.
--   5. `registrar_pago_confirmado` marcaba la factura pagada, movia
--      `cubierto_hasta` y apagaba el banner de impago... pero solo promovia a
--      'activa' desde ('morosa','restringida','prueba','implementacion').
--      'registrada' y 'bloqueada_sin_activar' NO estaban en esa lista.
--
-- Resultado: un cliente que pago se quedaba en solo lectura, con el mensaje
-- "Contacta a Enkrato para reabrirla", y `activar_prueba_cliente` ademas se
-- niega a ayudarle porque la cuenta ya esta bloqueada. Solo un superadmin
-- podia rescatarlo con `desbloquear_cuenta`.
--
-- Se anaden los dos estados que faltaban y se limpian las marcas del bloqueo,
-- para que no vuelva a dispararse en la siguiente pasada del cron.
--
-- 'cancelada' y 'purgada' se quedan FUERA a proposito: una cuenta dada de baja
-- que paga una factura vieja no debe reactivarse sola y sin que nadie lo vea.

CREATE OR REPLACE FUNCTION public.registrar_pago_confirmado(
  p_proveedor         text,
  p_proveedor_pago_id text,
  p_referencia        text,
  p_monto             numeric,
  p_moneda            text,
  p_canal             text,
  p_payload           jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'storage', 'extensions', 'pg_temp'
AS $function$
declare
  v_factura_id uuid;
  v_factura    public.facturas_suscripcion%rowtype;
  v_sus        public.suscripciones%rowtype;
  v_pago_id    uuid;
  v_estado     text := 'confirmado';
  v_canal      text;
  v_nuevo_hasta date;
  v_estado_previo text;
  -- Estados desde los que un pago confirmado devuelve el acceso completo.
  v_reactivables text[] := ARRAY[
    'morosa', 'restringida', 'prueba', 'implementacion',
    'registrada', 'bloqueada_sin_activar'
  ];
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

    select estado into v_estado_previo from public.cuentas where id = v_factura.cuenta_id;

    update public.suscripciones
    set cubierto_hasta = v_nuevo_hasta,
        estado         = case when estado = any(v_reactivables)
                              then 'activa' else estado end,
        updated_at     = now()
    where id = v_sus.id;

    -- Se limpian tambien las marcas del bloqueo por no activar: si quedaran
    -- puestas, la siguiente pasada de `ciclo_vida_diario` volveria a bloquear
    -- a un cliente que ya pago.
    update public.cuentas
    set estado            = case when estado = any(v_reactivables)
                                 then 'activa' else estado end,
        activacion_limite = case when estado = any(v_reactivables)
                                 then null else activacion_limite end,
        bloqueada_en      = case when estado = any(v_reactivables)
                                 then null else bloqueada_en end,
        updated_at        = now()
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
                             'cubierto_hasta', v_nuevo_hasta,
                             'estado_previo', v_estado_previo,
                             'desbloqueada_por_pago',
                               v_estado_previo = any(v_reactivables)),
          'sistema:webhook');

  return jsonb_build_object(
    'ok', true, 'repetido', false,
    'pago_id', v_pago_id,
    'factura', v_factura.numero,
    'cuenta_id', v_factura.cuenta_id,
    'cubierto_hasta', v_nuevo_hasta,
    'estado_previo', v_estado_previo
  );
end;
$function$;

COMMENT ON FUNCTION public.registrar_pago_confirmado(text, text, text, numeric, text, text, jsonb) IS
  'Registra un pago de pasarela. Un pago confirmado devuelve el acceso completo, incluso a cuentas bloqueadas por no activar la prueba a tiempo. No reactiva cuentas canceladas ni purgadas.';

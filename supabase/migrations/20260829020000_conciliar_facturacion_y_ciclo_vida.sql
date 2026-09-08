-- Conciliacion segura de las 27 migraciones historicas.
-- No repite backfills ni documentos: corrige hacia adelante el esquema que ya
-- existe en produccion y deja sus contratos con minimo privilegio.

-- Tableros: conservar las vistas finales sin saltarse RLS del usuario.
ALTER VIEW public.v_turnos_lineas SET (security_invoker = true);
ALTER VIEW public.v_turnos_pivote SET (security_invoker = true);
ALTER VIEW public.v_dias_operacion SET (security_invoker = true);
ALTER FUNCTION public.parse_hora(text) STABLE;

-- El pago manual es un proveedor valido y se procesa con la misma idempotencia
-- (proveedor, evento_id) que Wompi y Mercado Pago.
DO $$
DECLARE v_constraint text;
BEGIN
  SELECT c.conname INTO v_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'public.pasarela_eventos'::regclass
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%proveedor%';
  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.pasarela_eventos DROP CONSTRAINT %I', v_constraint);
  END IF;
END $$;

ALTER TABLE public.pasarela_eventos
  ADD CONSTRAINT pasarela_eventos_proveedor_check
  CHECK (proveedor IN ('wompi', 'mercadopago', 'manual'));

-- Las aceptaciones heredadas no se presentan como consentimiento capturado en
-- pantalla. Las nuevas inserciones quedan marcadas como explicitas.
ALTER TABLE public.aceptaciones_terminos
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'explicita',
  ADD COLUMN IF NOT EXISTS evidencia jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.aceptaciones_terminos a
SET origen = 'migracion_administrativa',
    evidencia = a.evidencia || jsonb_build_object(
      'nota', 'Registro historico reclasificado durante conciliacion 2026-08-29'
    )
FROM public.terminos_versiones v
WHERE v.id = a.version_id
  AND v.version = '2026-08-25'
  AND a.origen = 'explicita';

ALTER TABLE public.aceptaciones_terminos
  DROP CONSTRAINT IF EXISTS aceptaciones_terminos_origen_check;
ALTER TABLE public.aceptaciones_terminos
  ADD CONSTRAINT aceptaciones_terminos_origen_check
  CHECK (origen IN ('explicita', 'migracion_administrativa', 'importada'));

-- Los datos de facturacion se leen con RLS; no se modifican directamente
-- desde el navegador. Toda escritura pasa por RPC o service_role.
DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'billing_observaciones', 'cuentas', 'cuenta_empresas', 'suscripciones',
    'facturas_suscripcion', 'pagos_suscripcion', 'pasarela_eventos',
    'suscripcion_bitacora', 'superadmin_permisos', 'terminos_versiones',
    'aceptaciones_terminos', 'bajas_suscripcion'
  ] LOOP
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.%I FROM anon, authenticated',
      v_table
    );
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END $$;

-- Las tablas de respaldo dejan de estar expuestas por el esquema public.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND c.relname LIKE 'zz_backup_20260823_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', r.relname);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', r.relname);
  END LOOP;
END $$;

-- Ninguna RPC historica hereda EXECUTE para anon por el privilegio PUBLIC.
-- Se conserva authenticated donde el contrato de usuario lo necesita.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'parse_hora', 'dashboard_sedes', 'dashboard_dias_pendientes',
        'marcar_dia_operacion', 'dashboard_conciliacion', 'dashboard_ventas',
        'dashboard_ventas_responsable', 'billing_daily_enforcer',
        'cuenta_de_empresa', 'mi_cuenta_id', 'calcular_monto_cuenta',
        'cuenta_al_dia', 'siguiente_numero_factura', 'monto_en_letras',
        'tres_cifras_en_letras', 'apocope_mil', 'referencia_de_factura',
        'factura_por_referencia', 'emitir_factura_cuenta', 'factura_a_pagar',
        'registrar_pago_confirmado', 'revertir_pago', 'iniciar_prueba',
        'estado_facturacion_empresa', 'aprobar_pago', 'rechazar_pago',
        'facturacion_ciclo_diario', 'cuentas_backoffice',
        'emitir_factura_manual', 'current_empresa_id', 'is_super_admin',
        'tiene_permiso_superadmin', 'exigir_permiso_superadmin',
        'acceso_de_empresa', 'registrar_empresa_self_service',
        'activar_prueba_cliente', 'marcar_implementacion',
        'desbloquear_cuenta', 'solicitar_baja', 'reactivar_cuenta',
        'ciclo_vida_diario', 'metricas_facturacion', 'pagos_por_conciliar',
        'exigir_acceso_escritura', 'subir_cierre_turno',
        'guardar_parametros_nomina', 'cuentas_banco_pruebas_guarda',
        'factura_de_prueba', 'anular_factura_no_pagada',
        'cambiar_modalidad_factura'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.oid::regprocedure);
  END LOOP;

  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname = ANY (ARRAY[
        'billing_daily_enforcer', 'cuenta_de_empresa', 'mi_cuenta_id',
        'calcular_monto_cuenta', 'cuenta_al_dia', 'siguiente_numero_factura',
        'referencia_de_factura', 'factura_por_referencia',
        'emitir_factura_cuenta', 'factura_a_pagar',
        'registrar_pago_confirmado', 'revertir_pago', 'iniciar_prueba',
        'estado_facturacion_empresa', 'aprobar_pago', 'rechazar_pago',
        'facturacion_ciclo_diario', 'cuentas_backoffice',
        'emitir_factura_manual', 'current_empresa_id', 'is_super_admin',
        'tiene_permiso_superadmin', 'exigir_permiso_superadmin',
        'acceso_de_empresa', 'registrar_empresa_self_service',
        'activar_prueba_cliente', 'marcar_implementacion',
        'desbloquear_cuenta', 'solicitar_baja', 'reactivar_cuenta',
        'ciclo_vida_diario', 'metricas_facturacion', 'pagos_por_conciliar',
        'exigir_acceso_escritura', 'subir_cierre_turno',
        'guardar_parametros_nomina', 'cuentas_banco_pruebas_guarda',
        'factura_de_prueba', 'anular_factura_no_pagada',
        'cambiar_modalidad_factura'
      ])
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %s SET search_path TO public, auth, storage, extensions, pg_temp',
      r.oid::regprocedure
    );
  END LOOP;
END $$;

-- Operaciones exclusivamente internas.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'billing_daily_enforcer', 'siguiente_numero_factura',
        'referencia_de_factura', 'factura_por_referencia',
        'emitir_factura_cuenta', 'factura_a_pagar',
        'registrar_pago_confirmado', 'revertir_pago',
        'facturacion_ciclo_diario', 'ciclo_vida_diario',
        'factura_de_prueba', 'cuentas_banco_pruebas_guarda'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', r.oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.oid::regprocedure);
  END LOOP;
END $$;

-- Una cuenta cancelada conserva acceso hasta consumir el periodo que pago.
CREATE OR REPLACE FUNCTION public.acceso_de_empresa(p_empresa_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_empresa_id uuid := coalesce(p_empresa_id, public.current_empresa_id());
  v_cuenta public.cuentas%rowtype;
  v_sus public.suscripciones%rowtype;
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cuenta_id uuid;
BEGIN
  v_cuenta_id := public.cuenta_de_empresa(v_empresa_id);
  IF v_cuenta_id IS NULL THEN
    RETURN jsonb_build_object('nivel', 'total', 'motivo', 'sin_cuenta');
  END IF;

  SELECT * INTO v_cuenta FROM public.cuentas WHERE id = v_cuenta_id;
  SELECT * INTO v_sus FROM public.suscripciones
  WHERE cuenta_id = v_cuenta_id AND estado <> 'purgada'
  ORDER BY CASE WHEN estado = 'cancelada' THEN 1 ELSE 0 END
  LIMIT 1;

  IF v_cuenta.tipo IN ('interna', 'cortesia') THEN
    RETURN jsonb_build_object('nivel', 'total', 'motivo', 'cuenta_exenta', 'cuenta_id', v_cuenta_id);
  END IF;

  IF v_cuenta.estado = 'cancelada'
     AND coalesce(v_sus.cubierto_hasta, v_sus.prueba_hasta) >= v_hoy THEN
    RETURN jsonb_build_object(
      'nivel', 'total', 'motivo', 'cancelacion_programada',
      'estado', v_cuenta.estado, 'cuenta_id', v_cuenta_id,
      'servicio_hasta', coalesce(v_sus.cubierto_hasta, v_sus.prueba_hasta)
    );
  END IF;

  IF v_cuenta.estado IN ('cancelada', 'purgada') THEN
    RETURN jsonb_build_object(
      'nivel', 'solo_facturacion', 'motivo', 'cuenta_cancelada',
      'estado', v_cuenta.estado, 'cuenta_id', v_cuenta_id,
      'fecha', v_cuenta.purgar_desde,
      'mensaje', CASE WHEN v_cuenta.estado = 'purgada'
        THEN 'La cuenta fue dada de baja. Puedes contratar nuevamente.'
        ELSE 'El periodo contratado termino. Puedes retomar el plan desde facturacion.' END
    );
  END IF;

  IF v_cuenta.estado = 'bloqueada_sin_activar'
     OR (v_cuenta.estado = 'registrada' AND v_cuenta.activacion_limite IS NOT NULL
         AND v_cuenta.activacion_limite < v_hoy) THEN
    RETURN jsonb_build_object(
      'nivel', 'solo_facturacion', 'motivo', 'no_activada',
      'estado', v_cuenta.estado, 'cuenta_id', v_cuenta_id,
      'fecha', coalesce(v_cuenta.bloqueada_en, v_cuenta.activacion_limite),
      'mensaje', 'El plazo para activar la prueba termino. Contacta a Enkrato para reabrirla.'
    );
  END IF;

  RETURN jsonb_build_object(
    'nivel', 'total', 'motivo', 'ok',
    'estado', coalesce(v_sus.estado, v_cuenta.estado),
    'cuenta_id', v_cuenta_id, 'activacion_limite', v_cuenta.activacion_limite,
    'prueba_hasta', v_sus.prueba_hasta, 'cubierto_hasta', v_sus.cubierto_hasta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.acceso_de_empresa(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acceso_de_empresa(uuid) TO authenticated, service_role;

-- Evita que una identidad ya vinculada como otro_usuario sea dada de alta de
-- nuevo como administrador principal en otra empresa.
CREATE OR REPLACE FUNCTION public.guardar_identidad_unica_usuario_sistema()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.otros_usuarios ou WHERE ou.id = NEW.id) THEN
    RAISE EXCEPTION 'La identidad ya pertenece a otra empresa.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS usuarios_sistema_identidad_unica ON public.usuarios_sistema;
CREATE TRIGGER usuarios_sistema_identidad_unica
BEFORE INSERT ON public.usuarios_sistema
FOR EACH ROW EXECUTE FUNCTION public.guardar_identidad_unica_usuario_sistema();

REVOKE ALL ON FUNCTION public.guardar_identidad_unica_usuario_sistema() FROM PUBLIC, anon, authenticated;

-- La llamada antigua de cinco argumentos ya no puede aceptar terminos por
-- omision. El cliente vigente usa la firma de seis argumentos con booleano.
CREATE OR REPLACE FUNCTION public.registrar_empresa_self_service(
  p_nombre_comercial text,
  p_razon_social text,
  p_nit text,
  p_correo_empresa text,
  p_nombre_completo text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Debes aceptar explicitamente los terminos y condiciones.' USING ERRCODE = 'EK005';
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_empresa_self_service(text,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_empresa_self_service(text,text,text,text,text) TO authenticated;

-- Quince dias incluye el dia de activacion: hasta = desde + 14.
CREATE OR REPLACE FUNCTION public.activar_prueba_cliente(p_dias integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_empresa uuid := public.current_empresa_id();
  v_cuenta_id uuid;
  v_cuenta public.cuentas%rowtype;
  v_sus public.suscripciones%rowtype;
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_dias integer := least(greatest(coalesce(p_dias, 15), 1), 15);
  v_hasta date;
  v_rol text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  v_cuenta_id := public.cuenta_de_empresa(v_empresa);
  IF v_cuenta_id IS NULL THEN
    RAISE EXCEPTION 'Tu empresa no esta vinculada a una cuenta.' USING ERRCODE = '22023';
  END IF;

  SELECT rol INTO v_rol FROM public.usuarios_sistema WHERE id = v_uid;
  IF NOT public.is_super_admin() AND lower(coalesce(v_rol, '')) <> 'admin_root' THEN
    RAISE EXCEPTION 'Solo el administrador puede activar la prueba.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cuenta FROM public.cuentas WHERE id = v_cuenta_id;
  SELECT * INTO v_sus FROM public.suscripciones
  WHERE cuenta_id = v_cuenta_id AND estado <> 'cancelada' LIMIT 1;
  IF v_cuenta.estado IN ('cancelada', 'purgada') THEN
    RAISE EXCEPTION 'Esta cuenta esta dada de baja.' USING ERRCODE = '22023';
  END IF;
  IF v_sus.prueba_hasta IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'repetido', true, 'prueba_hasta', v_sus.prueba_hasta);
  END IF;
  IF v_cuenta.estado = 'bloqueada_sin_activar' THEN
    RAISE EXCEPTION 'El plazo para activar termino.' USING ERRCODE = '22023';
  END IF;

  v_hasta := v_hoy + (v_dias - 1);
  UPDATE public.suscripciones
  SET prueba_desde = v_hoy, prueba_hasta = v_hasta,
      estado = 'prueba', updated_at = now()
  WHERE id = v_sus.id;
  UPDATE public.cuentas
  SET estado = 'prueba', activacion_limite = NULL, updated_at = now()
  WHERE id = v_cuenta_id;
  INSERT INTO public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  VALUES (v_cuenta_id, v_sus.id, 'prueba_activada_por_cliente',
    jsonb_build_object('dias', v_dias, 'hasta', v_hasta),
    coalesce(auth.jwt()->>'email', v_uid::text));
  RETURN jsonb_build_object('ok', true, 'repetido', false,
    'prueba_desde', v_hoy, 'prueba_hasta', v_hasta, 'dias', v_dias);
END;
$$;

REVOKE ALL ON FUNCTION public.activar_prueba_cliente(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activar_prueba_cliente(integer) TO authenticated, service_role;

-- Numeracion transaccional para documentos del banco de pruebas.
CREATE SEQUENCE IF NOT EXISTS public.factura_prueba_seq START 1;
GRANT USAGE, SELECT ON SEQUENCE public.factura_prueba_seq TO service_role;

DO $$
DECLARE v_max bigint;
BEGIN
  SELECT max(nullif(regexp_replace(numero, '^AX-TEST-', ''), '')::bigint)
  INTO v_max
  FROM public.facturas_suscripcion
  WHERE numero ~ '^AX-TEST-[0-9]+$';
  IF v_max IS NOT NULL THEN
    PERFORM setval('public.factura_prueba_seq', v_max, true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.factura_de_prueba(p_monto numeric DEFAULT 1000)
RETURNS public.facturas_suscripcion
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_hoy date := (now() AT TIME ZONE 'America/Bogota')::date;
  v_cuenta public.cuentas%rowtype;
  v_sus public.suscripciones%rowtype;
  v_monto numeric;
  v_factura public.facturas_suscripcion%rowtype;
  v_secuencia bigint;
BEGIN
  v_monto := round(coalesce(p_monto, 1000));
  IF v_monto < 1000 OR v_monto > 5000 THEN
    RAISE EXCEPTION 'El importe de prueba debe estar entre 1.000 y 5.000' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cuenta FROM public.cuentas
  WHERE es_banco_pruebas ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No hay una cuenta habilitada como banco de pruebas' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_cuenta.id::text, 20260829));

  SELECT * INTO v_sus FROM public.suscripciones
  WHERE cuenta_id = v_cuenta.id AND estado <> 'cancelada' LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La cuenta de pruebas no tiene suscripcion activa' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_factura FROM public.facturas_suscripcion
  WHERE cuenta_id = v_cuenta.id AND periodo_desde = v_hoy AND periodo_hasta = v_hoy
    AND total = v_monto AND estado IN ('emitida', 'vencida')
  LIMIT 1;
  IF FOUND THEN RETURN v_factura; END IF;

  v_secuencia := nextval('public.factura_prueba_seq');
  INSERT INTO public.facturas_suscripcion (
    cuenta_id, suscripcion_id, numero, periodo_desde, periodo_hasta, detalle,
    subtotal, iva, total, moneda, fecha_emision, fecha_corte,
    fecha_limite_pago, estado
  ) VALUES (
    v_cuenta.id, v_sus.id, 'AX-TEST-' || lpad(v_secuencia::text, 6, '0'),
    v_hoy, v_hoy,
    jsonb_build_array(jsonb_build_object(
      'concepto', 'Prueba tecnica del ciclo de cobro - sin valor comercial',
      'cantidad', 1, 'valor_unitario', v_monto, 'total', v_monto
    )),
    v_monto, 0, v_monto, 'COP', v_hoy, v_hoy, v_hoy + 1, 'emitida'
  ) RETURNING * INTO v_factura;

  INSERT INTO public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  VALUES (v_cuenta.id, v_sus.id, 'factura_emitida',
    jsonb_build_object('numero', v_factura.numero, 'total', v_monto,
      'periodo', v_hoy::text, 'periodicidad', 'prueba'),
    'sistema:banco_pruebas');
  RETURN v_factura;
END;
$$;

REVOKE ALL ON FUNCTION public.factura_de_prueba(numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.factura_de_prueba(numeric) TO service_role;

-- El cron conserva el secreto existente, pero lo retira del texto de cron.job
-- y lo almacena en Vault. No se imprime ni se cambia el secreto de la funcion.
DO $$
DECLARE
  v_job record;
  v_secret text;
  v_secret_id uuid;
  v_command text;
BEGIN
  SELECT jobid, schedule, command INTO v_job
  FROM cron.job WHERE jobname = 'facturacion-ciclo-diario' LIMIT 1;
  IF v_job.jobid IS NULL THEN RETURN; END IF;

  SELECT (regexp_match(v_job.command, '''x-cron-secret''\s*,\s*''([^'']+)'''))[1]
  INTO v_secret;
  IF coalesce(v_secret, '') = '' THEN
    RAISE EXCEPTION 'No se pudo migrar de forma segura el secreto del cron de facturacion';
  END IF;

  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = 'facturacion_cron_secret';
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(v_secret, 'facturacion_cron_secret', 'Secreto del cron diario de facturacion', NULL);
  ELSE
    PERFORM vault.update_secret(v_secret_id, v_secret, 'facturacion_cron_secret', 'Secreto del cron diario de facturacion', NULL);
  END IF;

  v_command := $command$
    SELECT net.http_post(
      url := 'https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/cron-facturacion',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'facturacion_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $command$;
  PERFORM cron.alter_job(v_job.jobid, schedule := v_job.schedule, command := v_command, active := true);
END $$;

COMMENT ON FUNCTION public.factura_de_prueba(numeric) IS
  'Banco de pruebas interno: idempotente por cuenta/dia/monto y numerado con secuencia transaccional.';
COMMENT ON FUNCTION public.acceso_de_empresa(uuid) IS
  'Contrato de acceso. Una cancelacion conserva acceso hasta cubierto_hasta o prueba_hasta.';

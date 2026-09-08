-- Invariantes verificables de la conciliacion. Esta migracion no modifica
-- datos: aborta si una correccion critica deja de estar presente.
DO $$
DECLARE
  v_count integer;
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM supabase_migrations.schema_migrations
  WHERE version = ANY (ARRAY[
    '20260823170000','20260823180000','20260823190000','20260823200000',
    '20260823210000','20260823220000','20260824100000','20260825000000',
    '20260825001000','20260825002000','20260825003000','20260825004000',
    '20260825005000','20260825006000','20260825007000','20260825010000',
    '20260825011000','20260825012000','20260825013000','20260825014000',
    '20260825015000','20260825016000','20260825017000','20260825018000',
    '20260827000000','20260827010000','20260827020000'
  ]);
  IF v_count <> 27 THEN
    RAISE EXCEPTION 'Historial incompleto: % de 27 migraciones', v_count;
  END IF;

  SELECT count(*) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('v_turnos_lineas','v_turnos_pivote','v_dias_operacion')
    AND NOT (
      'security_invoker=on' = ANY(coalesce(c.reloptions, ARRAY[]::text[]))
      OR 'security_invoker=true' = ANY(coalesce(c.reloptions, ARRAY[]::text[]))
    );
  IF v_bad <> 0 THEN RAISE EXCEPTION 'Una vista de tablero perdio security_invoker'; END IF;

  SELECT count(*) INTO v_bad
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'billing_observaciones','cuentas','cuenta_empresas','suscripciones',
      'facturas_suscripcion','pagos_suscripcion','pasarela_eventos',
      'suscripcion_bitacora','superadmin_permisos','terminos_versiones',
      'aceptaciones_terminos','bajas_suscripcion'
    )
    AND (
      has_table_privilege('anon', c.oid, 'INSERT,UPDATE,DELETE')
      OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE')
    );
  IF v_bad <> 0 THEN RAISE EXCEPTION 'Persisten privilegios DML directos en facturacion'; END IF;

  SELECT count(*) INTO v_bad
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'billing_daily_enforcer','siguiente_numero_factura',
      'referencia_de_factura','factura_por_referencia','emitir_factura_cuenta',
      'factura_a_pagar','registrar_pago_confirmado','revertir_pago',
      'facturacion_ciclo_diario','ciclo_vida_diario','factura_de_prueba'
    )
    AND (
      has_function_privilege('anon', p.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
    );
  IF v_bad <> 0 THEN RAISE EXCEPTION 'Una RPC de servicio sigue expuesta'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.pasarela_eventos'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%manual%'
  ) THEN RAISE EXCEPTION 'El proveedor manual no esta permitido'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'aceptaciones_terminos'
      AND column_name = 'origen'
  ) THEN RAISE EXCEPTION 'Falta trazabilidad de origen en terminos'; END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('subir_cierre_turno','guardar_parametros_nomina')
      AND (position('estÃ' in pg_get_functiondef(p.oid)) > 0
        OR position('recibiÃ' in pg_get_functiondef(p.oid)) > 0
        OR position(chr(65533) in pg_get_functiondef(p.oid)) > 0)
  ) THEN RAISE EXCEPTION 'Persisten cuerpos con mojibake'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'facturacion-ciclo-diario' AND active
      AND command LIKE '%facturacion_cron_secret%'
      AND command NOT LIKE '%''x-cron-secret'',''%'
  ) THEN RAISE EXCEPTION 'El cron de facturacion no usa Vault de forma segura'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM vault.secrets WHERE name = 'facturacion_cron_secret'
  ) THEN RAISE EXCEPTION 'Falta el secreto de facturacion en Vault'; END IF;
END $$;

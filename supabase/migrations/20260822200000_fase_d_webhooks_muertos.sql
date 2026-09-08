-- ============================================================================
-- FASE D · Cierre de los webhooks n8n muertos
--
-- Cubre las dos piezas de backend que necesitaba la limpieza de js/webhooks.js:
--
--   1. `duplicar_usuarios_local()`, reemplazo del webhook
--      `locales/duplicar_usuarios`. Ese flujo replicaba los usuarios de la
--      empresa madre en la tabla `usuarios_locales` para que cada local
--      tuviera su propia fila (id distinto) apuntando al mismo usuario
--      principal. No hay export del flujo en `Flujos N8N/`: el contrato se
--      reconstruyó desde el payload de js/anadir_local_usuario.js y desde el
--      esquema de `usuarios_locales`.
--
--   2. Las dos tareas `pg_cron` que sustituyen a los webhooks de facturación
--      `billing_daily_enforcer` y `crear_ciclos_mensuales`. Aquellos flujos de
--      n8n no calculaban nada: eran un Schedule Trigger y un HTTP Request que
--      llamaban a funciones SQL que YA existen en 20240101000000_init.sql.
--      Programarlas dentro de la base elimina el salto de red y el punto de
--      fallo externo.
--
-- Reversión: al final del archivo, comentada línea por línea.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · duplicar_usuarios_local()
-- ----------------------------------------------------------------------------
-- Es SECURITY DEFINER porque la política `usuarios_locales_insert` solo deja
-- insertar a is_super_admin(), y quien registra un local es un admin normal.
-- Por eso el alcance se comprueba a mano aquí dentro: el defecto heredado #2
-- (obtener_historico_inventarios) fue exactamente esto mismo hecho mal, un
-- SECURITY DEFINER que aceptaba el empresa_id del cliente sin validarlo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.duplicar_usuarios_local(
  p_local_empresa_id  uuid,
  p_matriz_empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_matriz     uuid;
  v_actor      text;
  v_duplicados integer := 0;
  v_previos    integer := 0;
  v_total      integer := 0;
BEGIN
  IF p_local_empresa_id IS NULL THEN
    RAISE EXCEPTION 'Falta el identificador del local'
      USING ERRCODE = '22023';
  END IF;

  -- La madre se deduce del grupo salvo que la indiquen explícitamente.
  -- Recordatorio del modelo: en grupos_empresariales, empresa_id es el LOCAL
  -- y grupo_id es la empresa MADRE (y es text, no uuid).
  v_matriz := COALESCE(p_matriz_empresa_id, public.app_grupo_de(p_local_empresa_id));

  IF v_matriz IS NULL THEN
    RAISE EXCEPTION 'La empresa % no es un local de ningún grupo', p_local_empresa_id
      USING ERRCODE = '22023';
  END IF;

  IF v_matriz = p_local_empresa_id THEN
    RAISE EXCEPTION 'El local y la empresa madre no pueden ser el mismo'
      USING ERRCODE = '22023';
  END IF;

  -- El vínculo tiene que existir de verdad: sin esto, un admin podría volcar
  -- los usuarios de su empresa dentro de cualquier local que nombrara.
  IF NOT EXISTS (
    SELECT 1
    FROM public.grupos_empresariales
    WHERE empresa_id = p_local_empresa_id
      AND grupo_id::uuid = v_matriz
      AND COALESCE(activo, true) = true
  ) THEN
    RAISE EXCEPTION 'El local indicado no pertenece a esa empresa madre'
      USING ERRCODE = '42501';
  END IF;

  -- ── Autorización ────────────────────────────────────────────────────────
  -- El rol de servicio entra directo (lo llama la Edge Function, que ya
  -- resolvió el contexto del usuario). Un usuario autenticado tiene que ser
  -- admin Y tener ambas empresas dentro de su alcance.
  IF NOT public.app_es_rol_servicio() THEN
    IF NOT public.app_es_admin() THEN
      RAISE EXCEPTION 'Se requiere rol de administrador para preparar usuarios de un local'
        USING ERRCODE = '42501';
    END IF;

    IF NOT (public.app_puede_ver_empresa(v_matriz)
            AND public.app_puede_ver_empresa(p_local_empresa_id)) THEN
      RAISE EXCEPTION 'Fuera de alcance: el local o la empresa madre no te pertenecen'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  v_actor := COALESCE(
    NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''),
    'duplicar_usuarios_local'
  );

  SELECT count(*) INTO v_previos
  FROM public.usuarios_locales
  WHERE empresa_id = p_local_empresa_id;

  -- El ON CONFLICT se apoya en uq_usuarios_locales_principal_empresa
  -- (Fase A). Es un índice único TOTAL, no parcial: la lección del parche3 de
  -- la Fase B es que un índice único parcial no sirve como destino de
  -- ON CONFLICT y la sentencia falla en tiempo de ejecución.
  INSERT INTO public.usuarios_locales (
    usuario_principal_id, empresa_id, nombre_completo, rol, activo, "añadido_por"
  )
  SELECT us.id, p_local_empresa_id, us.nombre_completo, us.rol, true, v_actor
  FROM public.usuarios_sistema us
  WHERE us.empresa_id = v_matriz
    AND COALESCE(us.activo, true) = true
  ON CONFLICT (empresa_id, usuario_principal_id) DO NOTHING;

  GET DIAGNOSTICS v_duplicados = ROW_COUNT;

  SELECT count(*) INTO v_total
  FROM public.usuarios_locales
  WHERE empresa_id = p_local_empresa_id;

  RETURN jsonb_build_object(
    'ok', true,
    'local_empresa_id', p_local_empresa_id,
    'matriz_empresa_id', v_matriz,
    'duplicados', v_duplicados,
    'existentes_antes', v_previos,
    'total_local', v_total
  );
END;
$$;

COMMENT ON FUNCTION public.duplicar_usuarios_local(uuid, uuid) IS
  'Replica en usuarios_locales los usuarios activos de la empresa madre para un local. Reemplaza el webhook n8n locales/duplicar_usuarios. Idempotente gracias a uq_usuarios_locales_principal_empresa.';

REVOKE ALL ON FUNCTION public.duplicar_usuarios_local(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duplicar_usuarios_local(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicar_usuarios_local(uuid, uuid)
  TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 2 · Tareas pg_cron de facturación
-- ----------------------------------------------------------------------------
-- Sustituyen a WEBHOOKS.BILLING_DAILY_ENFORCER y WEBHOOKS.BILLING_CREAR_CICLOS.
--
-- Ambas funciones destino ya existían y son SECURITY DEFINER:
--   · billing_daily_enforcer()                  → no comprueba usuario.
--   · create_billing_cycles_for_period(p_periodo) → solo exige superadmin
--     cuando auth.uid() NO es nulo, así que desde el cron (sin JWT) pasa.
--
-- pg_cron corre en UTC. Colombia es UTC-5:
--   · '0 14 * * *'  → 09:00 hora Colombia, todos los días.
--   · '5 5 1 * *'   → 00:05 hora Colombia del día 1 de cada mes.
-- El enforcer va después de crear los ciclos para que el día 1 encuentre ya
-- el periodo abierto.
-- ============================================================================

DO $cron$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron no está instalado: se omite la programación de facturación';
    RETURN;
  END IF;

  PERFORM cron.unschedule('billing-enforcer-diario')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-enforcer-diario');

  PERFORM cron.schedule(
    'billing-enforcer-diario',
    '0 14 * * *',
    'SELECT public.billing_daily_enforcer();'
  );

  PERFORM cron.unschedule('billing-crear-ciclos')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-crear-ciclos');

  PERFORM cron.schedule(
    'billing-crear-ciclos',
    '5 5 1 * *',
    'SELECT public.create_billing_cycles_for_period(NULL);'
  );

  RAISE NOTICE 'Tareas de facturación programadas: billing-enforcer-diario, billing-crear-ciclos';
END
$cron$;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Ejecutar en este orden, línea por línea, para dejar la base como estaba
-- antes de esta migración:
--
--   SELECT cron.unschedule('billing-enforcer-diario');
--   SELECT cron.unschedule('billing-crear-ciclos');
--   DROP FUNCTION IF EXISTS public.duplicar_usuarios_local(uuid, uuid);
--
-- Nada de esto borra datos: las filas que la función haya insertado en
-- usuarios_locales permanecen. Para deshacer también esas filas, y SOLO si se
-- sabe el id del local afectado:
--
--   DELETE FROM public.usuarios_locales
--   WHERE empresa_id = '<id-del-local>' AND "añadido_por" <> '';
--
-- Tras revertir, los webhooks n8n equivalentes seguirían muertos: la reversión
-- del frontend está descrita en el documento de esta fase, en docs/.
-- ============================================================================

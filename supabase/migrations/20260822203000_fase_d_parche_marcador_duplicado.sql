-- ============================================================================
-- FASE D · Parche 1 · Marcador de fila duplicada
--
-- Al escribir la migración anterior no se había localizado el original: el
-- webhook `locales/duplicar_usuarios` no tiene export propio en `Flujos N8N/`
-- porque su lógica vive en `Registro/Registro_Primer_Usuario_Local_Dups.txt`,
-- que se dispara con executeWorkflowTrigger en vez de con un nodo Webhook. Por
-- eso no aparecía al buscar por path.
--
-- Comparado con aquel flujo, la reconstrucción era correcta salvo en un punto:
-- el nodo `Create a row1` escribía `añadido_por = 'duplicado_local'` en cada
-- fila replicada, no el correo de quien registraba el local.
--
-- No es cosmético. Ese valor es lo único que distingue una fila creada por la
-- duplicación de una creada a mano, y por tanto lo único que permite deshacer
-- una duplicación sin barrer usuarios legítimos del local. La instrucción de
-- reversión del documento de la fase depende de él.
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

  SELECT count(*) INTO v_previos
  FROM public.usuarios_locales
  WHERE empresa_id = p_local_empresa_id;

  -- El ON CONFLICT se apoya en uq_usuarios_locales_principal_empresa
  -- (Fase A). Es un índice único TOTAL, no parcial: la lección del parche3 de
  -- la Fase B es que un índice único parcial no sirve como destino de
  -- ON CONFLICT y la sentencia falla en tiempo de ejecución.
  --
  -- 'duplicado_local' es el marcador que usaba el flujo original. Es lo que
  -- hace reversible esta operación: identifica exactamente las filas creadas
  -- por la duplicación.
  INSERT INTO public.usuarios_locales (
    usuario_principal_id, empresa_id, nombre_completo, rol, activo, "añadido_por"
  )
  SELECT us.id, p_local_empresa_id, us.nombre_completo, us.rol,
         COALESCE(us.activo, true), 'duplicado_local'
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
  'Replica en usuarios_locales los usuarios activos de la empresa madre para un local, marcándolas con añadido_por = duplicado_local como hacía el flujo n8n original. Idempotente gracias a uq_usuarios_locales_principal_empresa.';

REVOKE ALL ON FUNCTION public.duplicar_usuarios_local(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duplicar_usuarios_local(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicar_usuarios_local(uuid, uuid)
  TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Para volver a la versión anterior de la función, reaplicar el bloque
-- CREATE OR REPLACE de 20260822200000_fase_d_webhooks_muertos.sql.
--
-- Deshacer una duplicación concreta, ahora con precisión (esta instrucción
-- SUSTITUYE a la del documento original, que borraba de más):
--
--   DELETE FROM public.usuarios_locales
--   WHERE empresa_id = '<id-del-local>' AND "añadido_por" = 'duplicado_local';
--
-- Esa condición deja intactos al administrador del local y a cualquier usuario
-- añadido a mano después.
-- ============================================================================

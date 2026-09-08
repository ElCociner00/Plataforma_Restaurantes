-- ============================================================================
-- FASE C · RPC transaccional del cierre de turno
--
-- Reemplaza `Loggro/Cierre_Turno/subir_cierre.txt` (25 nodos).
--
-- Aquel flujo recorría cuatro bucles splitInBatches insertando fila a fila en
-- cierres_turno_final / apoyos_turno (o sus gemelas _locales). Si fallaba a
-- mitad, el turno quedaba a medias en base y nadie se enteraba: el webhook ya
-- había respondido "ok".
--
-- Aquí es una sola función: o entra el cierre completo, o no entra nada.
-- La elección entre tablas base y `_locales` la resuelve app_es_local(), el
-- mismo criterio que usa _shared/tenant.ts, en lugar de estar duplicada en
-- dos ramas del lienzo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subir_cierre_turno(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER          -- el RLS del usuario sigue aplicando: es la red de seguridad
SET search_path = public, pg_temp
AS $$
DECLARE
  v_global      jsonb := COALESCE(p_datos -> 'global', '{}'::jsonb);
  v_resumen     jsonb := COALESCE(p_datos -> 'resumen', '{}'::jsonb);
  v_variables   jsonb := COALESCE(p_datos -> 'variables', '[]'::jsonb);
  v_apoyos      jsonb := COALESCE(p_datos -> 'apoyos', '[]'::jsonb);
  v_empresa     uuid;
  v_es_local    boolean;
  v_fecha       text;
  v_insertadas  integer := 0;
  v_apoyos_ins  integer := 0;
BEGIN
  -- ── Tenant ────────────────────────────────────────────────────────────
  -- La empresa se toma del cuerpo solo si está dentro del alcance del
  -- usuario; en cualquier otro caso manda la suya. Mismo invariante que
  -- resolverContexto() en las Edge Functions.
  v_empresa := NULLIF(v_global ->> 'empresa_id', '')::uuid;
  IF v_empresa IS NULL THEN
    v_empresa := NULLIF(v_global ->> 'tenant_id', '')::uuid;
  END IF;
  IF v_empresa IS NULL OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    v_empresa := public.app_empresa_id();
  END IF;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a ninguna empresa'
      USING ERRCODE = '42501';
  END IF;

  v_fecha := v_global ->> 'fecha';
  IF v_fecha IS NULL OR v_fecha = '' THEN
    RAISE EXCEPTION 'Falta la fecha del turno' USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(v_variables) = 0 THEN
    RAISE EXCEPTION 'El cierre no trae ninguna variable que guardar'
      USING ERRCODE = '22023';
  END IF;

  -- responsable_id es NOT NULL en las dos tablas de cierre. Sin esta guarda,
  -- el fallo llegaría como un error de restricción ilegible para el usuario.
  IF NULLIF(v_global ->> 'responsable_id', '') IS NULL THEN
    RAISE EXCEPTION 'Falta el responsable del turno' USING ERRCODE = '22023';
  END IF;

  v_es_local := public.app_es_local(v_empresa);

  -- ── Cierre ────────────────────────────────────────────────────────────
  IF v_es_local THEN
    INSERT INTO public.cierres_turno_final_locales (
      empresa_id, fecha_turno, responsable_id, comentarios, valor,
      hora_inicio, hora_fin, variable, registrado_por, categoria,
      domicilios_global, efectivo_apertura, propina_global, total_global,
      bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa,
      v_fecha,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      COALESCE((item ->> 'valor')::numeric, 0),
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      COALESCE(item ->> 'tipo', ''),
      COALESCE(v_global ->> 'registrado_por', ''),
      COALESCE(item ->> 'categoria', ''),
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      COALESCE((v_global ->> 'efectivo_apertura')::numeric, 0),
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM jsonb_array_elements(v_variables) AS item;
  ELSE
    INSERT INTO public.cierres_turno_final (
      empresa_id, fecha_turno, responsable_id, comentarios, valor,
      hora_inicio, hora_fin, variable, registrado_por, categoria,
      domicilios_global, efectivo_apertura, propina_global, total_global,
      bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa,
      v_fecha,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      COALESCE((item ->> 'valor')::numeric, 0),
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      COALESCE(item ->> 'tipo', ''),
      COALESCE(v_global ->> 'registrado_por', ''),
      COALESCE(item ->> 'categoria', ''),
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      COALESCE((v_global ->> 'efectivo_apertura')::numeric, 0),
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM jsonb_array_elements(v_variables) AS item;
  END IF;

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;

  -- ── Apoyos ────────────────────────────────────────────────────────────
  IF jsonb_array_length(v_apoyos) > 0 THEN
    IF v_es_local THEN
      INSERT INTO public.apoyos_turno_locales (
        empresa_id, fecha_turno, responsable_turno_id, hora_inicio, hora_fin,
        apoyo_responsable_id, propina, tiempo_minutos, tiempo_texto, rango_tiempo
      )
      SELECT
        v_empresa,
        v_fecha,
        NULLIF(v_global ->> 'responsable_id', '')::uuid,
        COALESCE(item ->> 'rango_hora_inicio_simple', v_global #>> '{turno,inicio}', ''),
        COALESCE(item ->> 'rango_hora_fin_simple',    v_global #>> '{turno,fin}', ''),
        NULLIF(item ->> 'apoyo_responsable_id', '')::uuid,
        COALESCE((item ->> 'propina')::numeric, 0),
        COALESCE((item ->> 'tiempo_minutos')::integer, 0),
        COALESCE(item ->> 'tiempo_texto', ''),
        COALESCE(item ->> 'rango_hora_unificado', '')
      FROM jsonb_array_elements(v_apoyos) AS item
      WHERE NULLIF(item ->> 'apoyo_responsable_id', '') IS NOT NULL;
    ELSE
      INSERT INTO public.apoyos_turno (
        empresa_id, fecha_turno, responsable_turno_id, hora_inicio, hora_fin,
        apoyo_responsable_id, propina, tiempo_minutos, tiempo_texto, rango_tiempo
      )
      SELECT
        v_empresa,
        v_fecha,
        NULLIF(v_global ->> 'responsable_id', '')::uuid,
        COALESCE(item ->> 'rango_hora_inicio_simple', v_global #>> '{turno,inicio}', ''),
        COALESCE(item ->> 'rango_hora_fin_simple',    v_global #>> '{turno,fin}', ''),
        NULLIF(item ->> 'apoyo_responsable_id', '')::uuid,
        COALESCE((item ->> 'propina')::numeric, 0),
        COALESCE((item ->> 'tiempo_minutos')::integer, 0),
        COALESCE(item ->> 'tiempo_texto', ''),
        COALESCE(item ->> 'rango_hora_unificado', '')
      FROM jsonb_array_elements(v_apoyos) AS item
      WHERE NULLIF(item ->> 'apoyo_responsable_id', '') IS NOT NULL;
    END IF;

    GET DIAGNOSTICS v_apoyos_ins = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'message', 'Cierre de turno guardado correctamente.',
    'empresa_id', v_empresa,
    'es_local', v_es_local,
    'fecha_turno', v_fecha,
    'variables_guardadas', v_insertadas,
    'apoyos_guardados', v_apoyos_ins
  );
END;
$$;

COMMENT ON FUNCTION public.subir_cierre_turno(jsonb) IS
  'Guarda un cierre de turno completo de forma atómica. Reemplaza el flujo n8n subir_cierre, que insertaba fila a fila y podía dejar cierres a medias.';

GRANT EXECUTE ON FUNCTION public.subir_cierre_turno(jsonb) TO authenticated, service_role;


-- ============================================================================
-- Histórico de cierres de turno · reemplaza cierre_turno_historico (16 nodos)
-- ----------------------------------------------------------------------------
-- El flujo consultaba turnos_agrupados o turnos_agrupados_locales según la
-- empresa, y luego cruzaba con usuarios_sistema o usuarios_locales para poner
-- el nombre del responsable. Aquí es una función con la rama resuelta dentro.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.historico_cierre_turno(
  p_empresa_id uuid DEFAULT NULL,
  p_desde date DEFAULT NULL,
  p_hasta date DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa uuid;
  v_filas   jsonb;
BEGIN
  v_empresa := COALESCE(p_empresa_id, public.app_empresa_id());

  IF v_empresa IS NULL OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    RAISE EXCEPTION 'Sin acceso a la empresa solicitada' USING ERRCODE = '42501';
  END IF;

  IF public.app_es_local(v_empresa) THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('responsable_nombre', u.nombre_completo)), '[]'::jsonb)
      INTO v_filas
    FROM (
      SELECT * FROM public.turnos_agrupados_locales ta
      WHERE ta.empresa_id = v_empresa
        AND (p_desde IS NULL OR ta.fecha_turno::date >= p_desde)
        AND (p_hasta IS NULL OR ta.fecha_turno::date <= p_hasta)
      ORDER BY ta.fecha_turno DESC, ta.hora_inicio DESC
      LIMIT p_limit
    ) t
    LEFT JOIN public.usuarios_locales u ON u.usuario_principal_id = t.responsable_id;
  ELSE
    SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('responsable_nombre', u.nombre_completo)), '[]'::jsonb)
      INTO v_filas
    FROM (
      SELECT * FROM public.turnos_agrupados ta
      WHERE ta.empresa_id = v_empresa
        AND (p_desde IS NULL OR ta.fecha_turno::date >= p_desde)
        AND (p_hasta IS NULL OR ta.fecha_turno::date <= p_hasta)
      ORDER BY ta.fecha_turno DESC, ta.hora_inicio DESC
      LIMIT p_limit
    ) t
    LEFT JOIN public.usuarios_sistema u ON u.id = t.responsable_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa,
    'es_local', public.app_es_local(v_empresa),
    'turnos', v_filas
  );
END;
$$;

COMMENT ON FUNCTION public.historico_cierre_turno(uuid, date, date, integer) IS
  'Histórico de cierres de turno con el nombre del responsable ya resuelto. Reemplaza el flujo n8n cierre_turno_historico.';

GRANT EXECUTE ON FUNCTION public.historico_cierre_turno(uuid, date, date, integer) TO authenticated, service_role;


-- ============================================================================
-- Parámetros de nómina · reemplaza nuevo_parametro_nómina (12 nodos)
-- ----------------------------------------------------------------------------
-- OJO con la forma real de la tabla: parametros_nomina NO es una fila por
-- empresa, es una fila por combinación (empresa, dimensión de tiempo,
-- dimensión de concepto) con su valor monetario. El flujo n8n hacía
-- get → if → create/update a mano para cada una; aquí es un upsert por lote.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_parametros_nomina_empresa_dimensiones
  ON public.parametros_nomina (empresa_id, dimension_tiempo_id, dimension_concepto_id);

CREATE OR REPLACE FUNCTION public.guardar_parametros_nomina(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa    uuid;
  v_parametros jsonb := COALESCE(p_datos -> 'parametros', '[]'::jsonb);
  v_guardados  integer := 0;
BEGIN
  v_empresa := NULLIF(p_datos ->> 'empresa_id', '')::uuid;
  IF v_empresa IS NULL OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    v_empresa := public.app_empresa_id();
  END IF;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a ninguna empresa' USING ERRCODE = '42501';
  END IF;

  IF jsonb_array_length(v_parametros) = 0 THEN
    RAISE EXCEPTION 'No se recibió ningún parámetro que guardar' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.parametros_nomina AS pn (
    empresa_id, dimension_tiempo_id, dimension_concepto_id, valor_monetario, es_ingreso
  )
  SELECT
    v_empresa,
    (item ->> 'dimension_tiempo_id')::uuid,
    (item ->> 'dimension_concepto_id')::uuid,
    COALESCE((item ->> 'valor_monetario')::numeric, 0),
    COALESCE((item ->> 'es_ingreso')::boolean, true)
  FROM jsonb_array_elements(v_parametros) AS item
  WHERE NULLIF(item ->> 'dimension_tiempo_id', '') IS NOT NULL
    AND NULLIF(item ->> 'dimension_concepto_id', '') IS NOT NULL
  ON CONFLICT (empresa_id, dimension_tiempo_id, dimension_concepto_id)
  DO UPDATE SET
    valor_monetario = EXCLUDED.valor_monetario,
    es_ingreso      = EXCLUDED.es_ingreso,
    updated_at      = now();

  GET DIAGNOSTICS v_guardados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', v_empresa,
    'parametros_guardados', v_guardados
  );
END;
$$;

COMMENT ON FUNCTION public.guardar_parametros_nomina(jsonb) IS
  'Upsert por lote de los parámetros de nómina de una empresa. Reemplaza el flujo n8n nuevo_parametro_nómina, que resolvía a mano el "existe o no" para cada parámetro.';

GRANT EXECUTE ON FUNCTION public.guardar_parametros_nomina(jsonb) TO authenticated, service_role;

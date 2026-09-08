-- ============================================================================
-- FASE 10 (backend) · Jornada 3 y lote en las sobrescrituras
--
-- Dos cambios sobre subir_cierre_turno(), que por lo demás queda igual que en
-- la Fase 3:
--
--   1. Admite la jornada 3. El 01/08 y el 15/08 tuvieron tres turnos reales, y
--      a partir de ahora el formulario ofrece esa opción. Sin este cambio, el
--      RPC rechazaría con "Indica la jornada del turno: 1 o 2" cualquier
--      cierre de un tercer turno.
--
--   2. Al archivar la versión anterior, escribe lote_id, codigo_motivo y una
--      observación. Sin esto, las sobrescrituras futuras llegarían a la
--      pantalla de auditoría sin lote —y por tanto sin poder restaurarse— y
--      sin poder filtrarse por motivo.
--
-- Se reescribe la función entera porque CREATE OR REPLACE FUNCTION no admite
-- parches parciales.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.subir_cierre_turno(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_global       jsonb   := COALESCE(p_datos -> 'global', '{}'::jsonb);
  v_resumen      jsonb   := COALESCE(p_datos -> 'resumen', '{}'::jsonb);
  v_variables    jsonb   := COALESCE(p_datos -> 'variables', '[]'::jsonb);
  v_apoyos       jsonb   := COALESCE(p_datos #> '{apoyo,registros}', '[]'::jsonb);
  v_empresa      uuid;
  v_es_local     boolean;
  v_fecha        date;
  v_numero       smallint;
  v_token        text;
  v_sobrescribir boolean := COALESCE((v_global ->> 'sobrescribir')::boolean, false);
  v_motivo       text    := COALESCE(v_global ->> 'motivo', '');
  v_hoy          date    := (now() AT TIME ZONE 'America/Bogota')::date;
  v_existentes   integer := 0;
  v_insertadas   integer := 0;
  v_apoyos_ins   integer := 0;
  v_movidas      integer := 0;
  v_correo       text;
  v_apertura     jsonb;
  v_esperado     numeric := 0;
  v_declarado    numeric := 0;
  v_lote         uuid;
  v_observacion  text;
BEGIN
  -- ── Tenant ────────────────────────────────────────────────────────────
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

  -- ── Datos obligatorios ────────────────────────────────────────────────
  v_fecha := NULLIF(v_global ->> 'fecha', '')::date;
  IF v_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha del turno' USING ERRCODE = '22023';
  END IF;

  v_numero := COALESCE((v_global ->> 'numero_turno')::smallint, 0);
  IF v_numero NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Indica la jornada del turno: 1 (mañana), 2 (tarde) o 3'
      USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(v_variables) = 0 THEN
    RAISE EXCEPTION 'El cierre no trae ninguna variable que guardar'
      USING ERRCODE = '22023';
  END IF;

  IF NULLIF(v_global ->> 'responsable_id', '') IS NULL THEN
    RAISE EXCEPTION 'Falta el responsable del turno' USING ERRCODE = '22023';
  END IF;

  v_token    := NULLIF(v_global ->> 'token_envio', '');
  v_es_local := public.app_es_local(v_empresa);

  -- ── 1. Idempotencia: ¿este envío ya se procesó? ───────────────────────
  IF v_token IS NOT NULL THEN
    IF v_es_local THEN
      SELECT count(*) INTO v_existentes
      FROM public.cierres_turno_final_locales
      WHERE empresa_id = v_empresa AND token_envio = v_token;
    ELSE
      SELECT count(*) INTO v_existentes
      FROM public.cierres_turno_final
      WHERE empresa_id = v_empresa AND token_envio = v_token;
    END IF;

    IF v_existentes > 0 THEN
      RETURN jsonb_build_object(
        'ok', true,
        'message', 'Este cierre ya se había guardado.',
        'empresa_id', v_empresa,
        'fecha_turno', v_fecha,
        'numero_turno', v_numero,
        'reenvio_ignorado', true,
        'variables_guardadas', 0
      );
    END IF;
  END IF;

  -- ── 2. ¿Ya hay un turno con esta jornada? ─────────────────────────────
  IF v_es_local THEN
    SELECT count(*) INTO v_existentes
    FROM public.cierres_turno_final_locales
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
  ELSE
    SELECT count(*) INTO v_existentes
    FROM public.cierres_turno_final
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
  END IF;

  IF v_existentes > 0 THEN
    IF NOT v_sobrescribir THEN
      RETURN jsonb_build_object(
        'ok', false,
        'requiere_confirmacion', true,
        'message', format('Ya existe un cierre para el %s, turno %s. Confirma si quieres reemplazarlo.',
                          to_char(v_fecha, 'DD/MM/YYYY'), v_numero),
        'empresa_id', v_empresa,
        'fecha_turno', v_fecha,
        'numero_turno', v_numero,
        'filas_existentes', v_existentes
      );
    END IF;

    IF NOT public.app_es_admin() AND v_fecha <> v_hoy THEN
      RAISE EXCEPTION 'Solo puedes reemplazar turnos del día en curso. Pide a un administrador que lo haga.'
        USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''), '')
    INTO v_correo;

    -- Un lote por sobrescritura: es lo que permite a la pantalla de auditoría
    -- mostrar el reemplazo como una unidad y devolverlo si fue un error.
    v_lote := gen_random_uuid();
    v_observacion := format(
      'Versión anterior del cierre del %s (jornada %s), reemplazada el %s por %s. %s',
      to_char(v_fecha, 'DD/MM/YYYY'),
      v_numero,
      to_char(now() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
      COALESCE(NULLIF(v_correo, ''), 'un usuario sin correo registrado'),
      CASE WHEN NULLIF(v_motivo, '') IS NULL
           THEN 'No se indicó motivo.'
           ELSE 'Motivo indicado: ' || v_motivo END
    );

    -- ── 3. Mover la versión anterior al histórico ───────────────────────
    IF v_es_local THEN
      INSERT INTO public.cierres_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        origen, reemplazado_por, reemplazado_por_correo, motivo,
        lote_id, codigo_motivo, observaciones
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        'cierres_turno_final_locales', auth.uid(), v_correo, v_motivo,
        v_lote, 'SOBRESCRITO', v_observacion
      FROM public.cierres_turno_final_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      GET DIAGNOSTICS v_movidas = ROW_COUNT;

      DELETE FROM public.cierres_turno_final_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      INSERT INTO public.apoyos_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        origen, reemplazado_por, reemplazado_por_correo, motivo,
        lote_id, codigo_motivo, observaciones
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        'apoyos_turno_locales', auth.uid(), v_correo, v_motivo,
        v_lote, 'SOBRESCRITO', v_observacion
      FROM public.apoyos_turno_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      DELETE FROM public.apoyos_turno_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
    ELSE
      INSERT INTO public.cierres_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        origen, reemplazado_por, reemplazado_por_correo, motivo,
        lote_id, codigo_motivo, observaciones
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        'cierres_turno_final', auth.uid(), v_correo, v_motivo,
        v_lote, 'SOBRESCRITO', v_observacion
      FROM public.cierres_turno_final
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      GET DIAGNOSTICS v_movidas = ROW_COUNT;

      DELETE FROM public.cierres_turno_final
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      INSERT INTO public.apoyos_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        origen, reemplazado_por, reemplazado_por_correo, motivo,
        lote_id, codigo_motivo, observaciones
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        'apoyos_turno', auth.uid(), v_correo, v_motivo,
        v_lote, 'SOBRESCRITO', v_observacion
      FROM public.apoyos_turno
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      DELETE FROM public.apoyos_turno
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
    END IF;
  END IF;

  -- ── 4. Efectivo de apertura, calculado aquí ───────────────────────────
  v_apertura  := public.efectivo_apertura_esperado(v_fecha, v_numero, v_empresa);
  v_esperado  := COALESCE((v_apertura ->> 'valor')::numeric, 0);
  v_declarado := COALESCE((v_global ->> 'efectivo_apertura')::numeric, 0);

  -- ── 5. Insertar el cierre ─────────────────────────────────────────────
  IF v_es_local THEN
    INSERT INTO public.cierres_turno_final_locales (
      empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, valor, hora_inicio, hora_fin, variable, registrado_por,
      categoria, domicilios_global, efectivo_apertura, propina_global,
      total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa, v_fecha, v_numero, v_token,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      COALESCE((item ->> 'valor')::numeric, 0),
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      COALESCE(item ->> 'tipo', ''),
      COALESCE(v_global ->> 'registrado_por', ''),
      COALESCE(item ->> 'categoria', ''),
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      v_declarado,
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM jsonb_array_elements(v_variables) AS item
    WHERE COALESCE(item ->> 'tipo', '') <> 'efectivo_apertura';
  ELSE
    INSERT INTO public.cierres_turno_final (
      empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, valor, hora_inicio, hora_fin, variable, registrado_por,
      categoria, domicilios_global, efectivo_apertura, propina_global,
      total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa, v_fecha, v_numero, v_token,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      COALESCE((item ->> 'valor')::numeric, 0),
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      COALESCE(item ->> 'tipo', ''),
      COALESCE(v_global ->> 'registrado_por', ''),
      COALESCE(item ->> 'categoria', ''),
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      v_declarado,
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM jsonb_array_elements(v_variables) AS item
    WHERE COALESCE(item ->> 'tipo', '') <> 'efectivo_apertura';
  END IF;

  GET DIAGNOSTICS v_insertadas = ROW_COUNT;

  -- ── 6. Las dos filas del efectivo de apertura ─────────────────────────
  IF v_es_local THEN
    INSERT INTO public.cierres_turno_final_locales (
      empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, valor, hora_inicio, hora_fin, variable, registrado_por,
      categoria, domicilios_global, efectivo_apertura, propina_global,
      total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa, v_fecha, v_numero, v_token,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      cat.valor,
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      'efectivo_apertura',
      COALESCE(v_global ->> 'registrado_por', ''),
      cat.categoria,
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      v_declarado,
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM (VALUES ('sistema', v_esperado), ('real', v_declarado)) AS cat(categoria, valor);
  ELSE
    INSERT INTO public.cierres_turno_final (
      empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, valor, hora_inicio, hora_fin, variable, registrado_por,
      categoria, domicilios_global, efectivo_apertura, propina_global,
      total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      v_empresa, v_fecha, v_numero, v_token,
      NULLIF(v_global ->> 'responsable_id', '')::uuid,
      COALESCE(NULLIF(v_global ->> 'comentarios', ''), 'Nada por comentar'),
      cat.valor,
      COALESCE(v_global #>> '{turno,inicio}', ''),
      COALESCE(v_global #>> '{turno,fin}', ''),
      'efectivo_apertura',
      COALESCE(v_global ->> 'registrado_por', ''),
      cat.categoria,
      COALESCE((v_global ->> 'domicilios_global')::numeric, 0),
      v_declarado,
      COALESCE((v_global ->> 'propina_global')::numeric, 0),
      COALESCE((v_resumen ->> 'total_sistema')::numeric, 0),
      COALESCE((v_global ->> 'bolsa_global')::numeric, 0),
      COALESCE((v_global ->> 'caja_global')::numeric, 0),
      COALESCE(v_global #>> '{turno,hora_llegada}', '')
    FROM (VALUES ('sistema', v_esperado), ('real', v_declarado)) AS cat(categoria, valor);
  END IF;

  v_insertadas := v_insertadas + 2;

  -- ── 7. Apoyos ─────────────────────────────────────────────────────────
  IF jsonb_array_length(v_apoyos) > 0 THEN
    IF v_es_local THEN
      INSERT INTO public.apoyos_turno_locales (
        empresa_id, fecha_turno, numero_turno, responsable_turno_id,
        hora_inicio, hora_fin, apoyo_responsable_id, propina,
        tiempo_minutos, tiempo_texto, rango_tiempo
      )
      SELECT
        v_empresa, v_fecha, v_numero,
        NULLIF(v_global ->> 'responsable_id', '')::uuid,
        COALESCE(item ->> 'rango_hora_inicio_24', v_global #>> '{turno,inicio}', ''),
        COALESCE(item ->> 'rango_hora_fin_24',    v_global #>> '{turno,fin}', ''),
        NULLIF(item ->> 'apoyo_responsable_id', '')::uuid,
        COALESCE((item ->> 'propina')::numeric, 0),
        COALESCE((item ->> 'tiempo_minutos')::integer, 0),
        COALESCE(item ->> 'tiempo_texto', ''),
        COALESCE(item ->> 'rango_hora_unificado', '')
      FROM jsonb_array_elements(v_apoyos) AS item
      WHERE NULLIF(item ->> 'apoyo_responsable_id', '') IS NOT NULL;
    ELSE
      INSERT INTO public.apoyos_turno (
        empresa_id, fecha_turno, numero_turno, responsable_turno_id,
        hora_inicio, hora_fin, apoyo_responsable_id, propina,
        tiempo_minutos, tiempo_texto, rango_tiempo
      )
      SELECT
        v_empresa, v_fecha, v_numero,
        NULLIF(v_global ->> 'responsable_id', '')::uuid,
        COALESCE(item ->> 'rango_hora_inicio_24', v_global #>> '{turno,inicio}', ''),
        COALESCE(item ->> 'rango_hora_fin_24',    v_global #>> '{turno,fin}', ''),
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
    'message', CASE WHEN v_movidas > 0
                    THEN 'Cierre reemplazado. La versión anterior quedó en el histórico.'
                    ELSE 'Cierre de turno guardado correctamente.' END,
    'empresa_id', v_empresa,
    'es_local', v_es_local,
    'fecha_turno', v_fecha,
    'numero_turno', v_numero,
    'variables_guardadas', v_insertadas,
    'apoyos_guardados', v_apoyos_ins,
    'sobrescrito', v_movidas > 0,
    'filas_archivadas', v_movidas,
    'lote_historico', v_lote,
    'efectivo_apertura', jsonb_build_object(
      'esperado', v_esperado,
      'declarado', v_declarado,
      'diferencia', v_declarado - v_esperado,
      'origen', v_apertura ->> 'etiqueta'
    )
  );
END;
$$;

COMMENT ON FUNCTION public.subir_cierre_turno(jsonb) IS
  'Guarda un cierre de turno de forma idempotente. Identidad: empresa + fecha + numero_turno (1, 2 o 3). Reenvíos con el mismo token no duplican; sobrescribir exige confirmación y archiva la versión anterior en cierres_turno_historico con su propio lote.';

REVOKE ALL ON FUNCTION public.subir_cierre_turno(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.subir_cierre_turno(jsonb) TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Reaplicar el bloque CREATE OR REPLACE FUNCTION public.subir_cierre_turno(jsonb)
-- de 20260822220000_fase_3_cierre_idempotente.sql. Ojo: esa versión rechaza la
-- jornada 3, así que el 01/08 y el 15/08 dejarían de poder rehacerse.
-- ============================================================================

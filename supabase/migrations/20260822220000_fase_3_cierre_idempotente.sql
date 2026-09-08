-- ============================================================================
-- FASE 3 y 4 · Cierre de turno idempotente y efectivo de apertura
--
-- Reemplaza subir_cierre_turno() de la Fase C. Lo que cambia:
--
--   · Recibe numero_turno: la identidad del turno pasa a ser
--     (empresa_id, fecha_turno, numero_turno).
--   · Recibe token_envio: dos peticiones con el mismo token no duplican nada.
--   · Si el turno ya existe, no inserta a ciegas: exige confirmación explícita
--     y comprueba permisos.
--   · Al sobrescribir, mueve la versión anterior a cierres_turno_historico en
--     lugar de borrarla.
--   · Calcula el efectivo de apertura esperado EN EL SERVIDOR y lo guarda como
--     una variable más, junto al valor que declaró la persona.
--
-- Permisos de sobrescritura acordados:
--   · operativo            → solo turnos del día en curso (hora Colombia)
--   · admin y admin_root   → cualquier turno, cualquier día
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Efectivo con el que cerró el turno anterior
-- ----------------------------------------------------------------------------
-- El turno anterior es el cierre inmediatamente previo de la MISMA sede,
-- ordenando por (fecha_turno, numero_turno). Para el turno 1 del 21/08 es el
-- turno 2 del 20/08; para el turno 2 del 21/08 es el turno 1 de ese mismo día.
--
-- Lo que se hereda es `caja_global`: la bolsa es el dinero que se retira del
-- local y la caja es lo que queda para quien entra después.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.efectivo_apertura_esperado(
  p_fecha      date,
  p_numero     smallint DEFAULT 1,
  p_empresa_id uuid     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER          -- el RLS decide qué turnos puede ver quien pregunta
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa  uuid;
  v_es_local boolean;
  v_fila     record;
BEGIN
  v_empresa := COALESCE(p_empresa_id, public.app_empresa_id());

  IF v_empresa IS NULL OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    v_empresa := public.app_empresa_id();
  END IF;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a ninguna empresa'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha del turno' USING ERRCODE = '22023';
  END IF;

  v_es_local := public.app_es_local(v_empresa);

  IF v_es_local THEN
    SELECT fecha_turno, numero_turno, MAX(caja_global) AS caja
    INTO v_fila
    FROM public.cierres_turno_final_locales
    WHERE empresa_id = v_empresa
      AND (fecha_turno, COALESCE(numero_turno, 1)) < (p_fecha, p_numero)
    GROUP BY fecha_turno, numero_turno
    ORDER BY fecha_turno DESC, numero_turno DESC
    LIMIT 1;
  ELSE
    SELECT fecha_turno, numero_turno, MAX(caja_global) AS caja
    INTO v_fila
    FROM public.cierres_turno_final
    WHERE empresa_id = v_empresa
      AND (fecha_turno, COALESCE(numero_turno, 1)) < (p_fecha, p_numero)
    GROUP BY fecha_turno, numero_turno
    ORDER BY fecha_turno DESC, numero_turno DESC
    LIMIT 1;
  END IF;

  -- Primera vez que opera la sede, o no hay cierre anterior: no hay nada con
  -- qué comparar. Se devuelve 0 y sin etiqueta, y el formulario no muestra
  -- diferencia.
  IF v_fila IS NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'hay_anterior', false,
      'valor', 0,
      'etiqueta', '',
      'fecha_origen', NULL,
      'numero_origen', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'hay_anterior', true,
    'valor', COALESCE(v_fila.caja, 0),
    'fecha_origen', v_fila.fecha_turno,
    'numero_origen', v_fila.numero_turno,
    'etiqueta', format('Caja del %s turno %s',
                       to_char(v_fila.fecha_turno, 'DD/MM/YYYY'),
                       COALESCE(v_fila.numero_turno, 1))
  );
END;
$$;

COMMENT ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid) IS
  'Caja con la que cerró el turno inmediatamente anterior de la sede. Alimenta la tarjeta de efectivo de apertura del formulario de cierre.';

REVOKE ALL ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid)
  TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 2 · ¿Ya existe este turno?
-- ----------------------------------------------------------------------------
-- El formulario la llama al elegir fecha y jornada, para avisar ANTES de que
-- la persona rellene todo.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.turno_existente(
  p_fecha      date,
  p_numero     smallint,
  p_empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa  uuid;
  v_es_local boolean;
  v_fila     record;
  v_hoy      date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  v_empresa := COALESCE(p_empresa_id, public.app_empresa_id());
  IF v_empresa IS NULL OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    v_empresa := public.app_empresa_id();
  END IF;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a ninguna empresa'
      USING ERRCODE = '42501';
  END IF;

  v_es_local := public.app_es_local(v_empresa);

  IF v_es_local THEN
    SELECT MIN(created_at) AS subido_en,
           MAX(registrado_por) AS registrado_por,
           MAX(hora_inicio) AS hora_inicio,
           count(*) AS filas
    INTO v_fila
    FROM public.cierres_turno_final_locales
    WHERE empresa_id = v_empresa AND fecha_turno = p_fecha AND numero_turno = p_numero;
  ELSE
    SELECT MIN(created_at) AS subido_en,
           MAX(registrado_por) AS registrado_por,
           MAX(hora_inicio) AS hora_inicio,
           count(*) AS filas
    INTO v_fila
    FROM public.cierres_turno_final
    WHERE empresa_id = v_empresa AND fecha_turno = p_fecha AND numero_turno = p_numero;
  END IF;

  IF v_fila.filas = 0 THEN
    RETURN jsonb_build_object('ok', true, 'existe', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'existe', true,
    'subido_en', v_fila.subido_en,
    'registrado_por', COALESCE(v_fila.registrado_por, ''),
    'hora_inicio', COALESCE(v_fila.hora_inicio, ''),
    'filas', v_fila.filas,
    -- Si quien pregunta puede o no reemplazarlo, para que el formulario avise
    -- con antelación en lugar de dejar que falle al enviar.
    'puede_sobrescribir', public.app_es_admin() OR p_fecha = v_hoy
  );
END;
$$;

COMMENT ON FUNCTION public.turno_existente(date, smallint, uuid) IS
  'Indica si ya hay un cierre para esa sede, fecha y jornada, y si quien pregunta podría reemplazarlo.';

REVOKE ALL ON FUNCTION public.turno_existente(date, smallint, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.turno_existente(date, smallint, uuid)
  TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 3 · subir_cierre_turno(), ahora idempotente
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
  v_apoyos       jsonb   := COALESCE(p_datos -> 'apoyos', '[]'::jsonb);
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
  IF v_numero NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Indica la jornada del turno: 1 (mañana) o 2 (tarde)'
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
  -- Cubre el doble clic y el reintento por red lenta. Devuelve éxito sin
  -- volver a insertar, que es lo que espera quien reintenta.
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
    -- Sin confirmación explícita no se toca nada. El formulario usa esta
    -- respuesta para preguntar antes de reemplazar.
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

    -- Permisos de sobrescritura: un operativo solo puede rehacer el turno del
    -- día en curso. Administradores, cualquiera.
    IF NOT public.app_es_admin() AND v_fecha <> v_hoy THEN
      RAISE EXCEPTION 'Solo puedes reemplazar turnos del día en curso. Pide a un administrador que lo haga.'
        USING ERRCODE = '42501';
    END IF;

    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''), '')
    INTO v_correo;

    -- ── 3. Mover la versión anterior al histórico ───────────────────────
    -- No se borra: es un arqueo de caja y la evidencia de la versión previa
    -- tiene que sobrevivir a la corrección.
    IF v_es_local THEN
      INSERT INTO public.cierres_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        origen, reemplazado_por, reemplazado_por_correo, motivo
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        'cierres_turno_final_locales', auth.uid(), v_correo, v_motivo
      FROM public.cierres_turno_final_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      GET DIAGNOSTICS v_movidas = ROW_COUNT;

      DELETE FROM public.cierres_turno_final_locales
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      INSERT INTO public.apoyos_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        origen, reemplazado_por, reemplazado_por_correo, motivo
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        'apoyos_turno_locales', auth.uid(), v_correo, v_motivo
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
        origen, reemplazado_por, reemplazado_por_correo, motivo
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
        created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
        categoria, domicilios_global, efectivo_apertura, propina_global,
        total_global, bolsa_global, caja_global, hora_llegada, token_envio,
        'cierres_turno_final', auth.uid(), v_correo, v_motivo
      FROM public.cierres_turno_final
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      GET DIAGNOSTICS v_movidas = ROW_COUNT;

      DELETE FROM public.cierres_turno_final
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      INSERT INTO public.apoyos_turno_historico (
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        origen, reemplazado_por, reemplazado_por_correo, motivo
      )
      SELECT
        id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
        responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
        tiempo_minutos, rango_tiempo, created_at, updated_at,
        'apoyos_turno', auth.uid(), v_correo, v_motivo
      FROM public.apoyos_turno
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

      DELETE FROM public.apoyos_turno
      WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
    END IF;
  END IF;

  -- ── 4. Efectivo de apertura, calculado aquí ───────────────────────────
  -- Deliberadamente NO se acepta el valor esperado que venga del navegador:
  -- si la diferencia de caja se calculara en el cliente, quien tuviera que
  -- justificar un faltante podría enviarla en cero.
  v_apertura  := public.efectivo_apertura_esperado(v_fecha, v_numero, v_empresa);
  v_esperado  := COALESCE((v_apertura ->> 'valor')::numeric, 0);
  v_declarado := COALESCE((v_global ->> 'efectivo_apertura')::numeric, 0);

  -- ── 5. Insertar el cierre ─────────────────────────────────────────────
  -- Se descarta cualquier variable 'efectivo_apertura' que mande el cliente:
  -- esas dos filas las escribe el servidor unas líneas más abajo.
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
  -- Mismo modelo que los seis canales: sistema contra real. Así la vista de
  -- pivote de los tableros lo recoge sin código especial.
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
        empresa_id, fecha_turno, numero_turno, responsable_turno_id,
        hora_inicio, hora_fin, apoyo_responsable_id, propina,
        tiempo_minutos, tiempo_texto, rango_tiempo
      )
      SELECT
        v_empresa, v_fecha, v_numero,
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
  'Guarda un cierre de turno de forma idempotente. Identidad: empresa + fecha + numero_turno. Reenvíos con el mismo token no duplican; sobrescribir exige confirmación y archiva la versión anterior en cierres_turno_historico.';

REVOKE ALL ON FUNCTION public.subir_cierre_turno(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.subir_cierre_turno(jsonb) TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Para volver al comportamiento anterior, reaplicar el bloque
-- CREATE OR REPLACE FUNCTION public.subir_cierre_turno(jsonb) de
-- 20260822180000_fase_c_rpc_cierre_turno.sql, y después:
--
--   DROP FUNCTION IF EXISTS public.turno_existente(date, smallint, uuid);
--   DROP FUNCTION IF EXISTS public.efectivo_apertura_esperado(date, smallint, uuid);
--
-- Los datos ya guardados no se ven afectados: las filas de efectivo_apertura
-- quedan como dos variables más y no estorban a ninguna consulta existente.
-- ============================================================================

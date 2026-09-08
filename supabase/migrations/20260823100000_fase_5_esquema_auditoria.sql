-- ============================================================================
-- FASE 5 · Esquema de auditoría del histórico de turnos
--
-- Primera de las seis fases descritas en
-- docs/2026-08-23_plan_depuracion_turnos_y_auditoria.md
--
-- Qué resuelve: la tabla cierres_turno_historico de la Fase 1 guarda filas
-- sueltas. Para la pantalla de gestión que van a usar los administradores hace
-- falta cuatro cosas que no tiene:
--
--   1. Algo que ate las filas de un mismo movimiento  → lote_id
--   2. Poder editar la observación y borrar una línea → políticas UPDATE/DELETE
--   3. Un camino de vuelta a la tabla de trabajo      → restaurar_turno_historico()
--   4. Un motivo filtrable, no solo texto libre       → codigo_motivo
--
-- Todo lo de esta migración es aditivo. No toca ni una fila de datos.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Columnas nuevas
-- ----------------------------------------------------------------------------
-- lote_id es la pieza central. Sin él, las 2 902 filas que mueve la Fase 6
-- llegarían a la pantalla como 2 902 líneas sueltas y no habría forma de decir
-- "devuelve ese turno": nada indicaría qué filas formaban parte del mismo acto.
--
-- restaurado_en / editado_en no borran nada: marcan. La fila del histórico
-- sobrevive a la restauración, que es justo lo que hace auditable el proceso.
-- ============================================================================

ALTER TABLE public.cierres_turno_historico
  ADD COLUMN IF NOT EXISTS lote_id        uuid,
  ADD COLUMN IF NOT EXISTS codigo_motivo  text,
  ADD COLUMN IF NOT EXISTS restaurado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS restaurado_por uuid,
  ADD COLUMN IF NOT EXISTS editado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS editado_por    uuid;

ALTER TABLE public.apoyos_turno_historico
  ADD COLUMN IF NOT EXISTS lote_id        uuid,
  ADD COLUMN IF NOT EXISTS codigo_motivo  text,
  ADD COLUMN IF NOT EXISTS restaurado_en  timestamptz,
  ADD COLUMN IF NOT EXISTS restaurado_por uuid,
  ADD COLUMN IF NOT EXISTS editado_en     timestamptz,
  ADD COLUMN IF NOT EXISTS editado_por    uuid;

COMMENT ON COLUMN public.cierres_turno_historico.lote_id IS
  'Agrupa todas las filas movidas al histórico en el mismo acto. Es la unidad que la pantalla de auditoría muestra, restaura o elimina.';
COMMENT ON COLUMN public.cierres_turno_historico.codigo_motivo IS
  'Clasificación cerrada del movimiento. Ver el CHECK cierres_turno_historico_codigo_motivo_check.';
COMMENT ON COLUMN public.cierres_turno_historico.restaurado_en IS
  'Cuándo se devolvió este lote a la tabla de trabajo. La fila NO se borra al restaurar: queda marcada.';
COMMENT ON COLUMN public.cierres_turno_historico.editado_en IS
  'Cuándo un administrador modificó los valores de esta fila desde la pantalla de auditoría.';


-- ============================================================================
-- SECCIÓN 2 · Catálogo de motivos
-- ----------------------------------------------------------------------------
-- Cerrado a propósito. Un texto libre no se puede filtrar, y la pantalla
-- necesita responder a "enséñame solo los duplicados por doble clic".
--
-- Admite NULL porque las filas que escribió la Fase 3 antes de esta migración
-- no lo tienen. Hoy no hay ninguna, pero la migración no debe depender de eso.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cierres_turno_historico_codigo_motivo_check'
  ) THEN
    ALTER TABLE public.cierres_turno_historico
      ADD CONSTRAINT cierres_turno_historico_codigo_motivo_check
      CHECK (codigo_motivo IS NULL OR codigo_motivo IN (
        'DUP_EXACTO',      -- reenvío idéntico del mismo turno (doble clic)
        'DUP_CORREGIDO',   -- envío anterior sustituido por una corrección posterior
        'DUP_JORNADA',     -- jornada entera repetida dentro del mismo día
        'FILA_HUERFANA',   -- fila suelta sin envío completo detrás
        'ENVIO_TRUNCADO',  -- envío que se cortó a medias
        'SOBRESCRITO',     -- reemplazo hecho desde el formulario de cierre
        'DATOS_PRUEBA',    -- cierres de ensayo, no corresponden a operación real
        'MANUAL'           -- movimiento hecho a mano por un administrador
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apoyos_turno_historico_codigo_motivo_check'
  ) THEN
    ALTER TABLE public.apoyos_turno_historico
      ADD CONSTRAINT apoyos_turno_historico_codigo_motivo_check
      CHECK (codigo_motivo IS NULL OR codigo_motivo IN (
        'DUP_EXACTO', 'DUP_CORREGIDO', 'DUP_JORNADA', 'FILA_HUERFANA',
        'ENVIO_TRUNCADO', 'SOBRESCRITO', 'DATOS_PRUEBA', 'MANUAL'
      ));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS ix_cierres_turno_historico_lote
  ON public.cierres_turno_historico (lote_id);
CREATE INDEX IF NOT EXISTS ix_cierres_turno_historico_codigo
  ON public.cierres_turno_historico (codigo_motivo);
CREATE INDEX IF NOT EXISTS ix_apoyos_turno_historico_lote
  ON public.apoyos_turno_historico (lote_id);


-- ============================================================================
-- SECCIÓN 3 · Nombre del responsable
-- ----------------------------------------------------------------------------
-- El responsable de un turno puede vivir en cuatro tablas distintas según cómo
-- se dio de alta, y en las sedes hay además una tabla de enlace. La pantalla
-- necesita el nombre para su filtro, así que se resuelve una sola vez aquí en
-- lugar de repetir la cascada en cada consulta del navegador.
--
-- SECURITY DEFINER: sin él, el RLS de esas tablas podría devolver NULL y el
-- filtro de responsable quedaría vacío. Lo único que expone es un nombre a
-- partir de un identificador que quien pregunta ya tiene delante.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_nombre_responsable(p_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT nombre_completo FROM public.usuarios_locales  WHERE id = p_id                   LIMIT 1),
    (SELECT nombre_completo FROM public.usuarios_locales  WHERE usuario_principal_id = p_id  LIMIT 1),
    (SELECT nombre_completo FROM public.usuarios_sistema  WHERE id = p_id                   LIMIT 1),
    (SELECT nombre_completo FROM public.otros_usuarios    WHERE id = p_id                   LIMIT 1),
    (SELECT nombre_completo FROM public.empleados         WHERE id = p_id                   LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.app_nombre_responsable(uuid) IS
  'Nombre del responsable de un turno, buscándolo en las cuatro tablas de usuarios y en la de enlace de sedes.';

REVOKE ALL ON FUNCTION public.app_nombre_responsable(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.app_nombre_responsable(uuid) TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 4 · Permisos de edición y borrado
-- ----------------------------------------------------------------------------
-- Hasta ahora el histórico solo admitía SELECT e INSERT: un administrador no
-- podía ni corregir una observación ni retirar una línea que sobra.
--
-- Sobre el UPDATE de los valores: permite a un admin editar la evidencia de un
-- arqueo de caja. Se pidió expresamente para poder corregir un registro antes
-- de devolverlo, y por eso existen editado_en / editado_por: toda edición
-- queda fechada y firmada, y la pantalla marca los lotes tocados.
-- ============================================================================

DROP POLICY IF EXISTS cierres_turno_historico_update ON public.cierres_turno_historico;
CREATE POLICY cierres_turno_historico_update
  ON public.cierres_turno_historico FOR UPDATE
  USING      (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

DROP POLICY IF EXISTS cierres_turno_historico_delete ON public.cierres_turno_historico;
CREATE POLICY cierres_turno_historico_delete
  ON public.cierres_turno_historico FOR DELETE
  USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

DROP POLICY IF EXISTS apoyos_turno_historico_update ON public.apoyos_turno_historico;
CREATE POLICY apoyos_turno_historico_update
  ON public.apoyos_turno_historico FOR UPDATE
  USING      (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

DROP POLICY IF EXISTS apoyos_turno_historico_delete ON public.apoyos_turno_historico;
CREATE POLICY apoyos_turno_historico_delete
  ON public.apoyos_turno_historico FOR DELETE
  USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

GRANT UPDATE, DELETE ON public.cierres_turno_historico TO authenticated;
GRANT UPDATE, DELETE ON public.apoyos_turno_historico  TO authenticated;


-- ============================================================================
-- SECCIÓN 5 · Vista de lotes
-- ----------------------------------------------------------------------------
-- Una fila por movimiento. Es lo que lee la pantalla: sin esto el navegador
-- tendría que descargar y agrupar miles de filas para pintar una tabla.
--
-- security_invoker: cada administrador ve los lotes de las sedes que ya podía
-- ver, porque manda el RLS de la tabla de abajo.
-- ============================================================================

CREATE OR REPLACE VIEW public.historico_turnos_lotes
WITH (security_invoker = on) AS
SELECT
  h.lote_id,
  h.empresa_id,
  e.nombre_comercial                                   AS sede,
  h.origen,
  h.fecha_turno,
  h.numero_turno,
  MAX(h.hora_inicio)                                   AS hora_inicio,
  MAX(h.hora_fin)                                      AS hora_fin,
  MAX(h.codigo_motivo)                                 AS codigo_motivo,
  MAX(h.motivo)                                        AS motivo,
  MAX(h.observaciones)                                 AS observaciones,
  MAX(h.responsable_id::text)::uuid                    AS responsable_id,
  public.app_nombre_responsable(MAX(h.responsable_id::text)::uuid) AS responsable,
  MAX(h.registrado_por)                                AS registrado_por,
  COUNT(*)                                             AS filas,
  SUM(h.valor) FILTER (
    WHERE h.categoria = 'real' AND h.variable <> 'efectivo_apertura'
  )                                                    AS importe_real,
  MIN(h.created_at)                                    AS creado_en,
  MAX(h.reemplazado_en)                                AS movido_en,
  MAX(h.reemplazado_por_correo)                        AS movido_por_correo,
  MAX(h.restaurado_en)                                 AS restaurado_en,
  MAX(h.editado_en)                                    AS editado_en,
  -- ¿Sigue existiendo ese turno en la tabla de trabajo? Determina si al
  -- restaurar se desplazaría algo, y la pantalla lo avisa antes de pulsar.
  EXISTS (
    SELECT 1 FROM public.cierres_turno_final c
    WHERE c.empresa_id = h.empresa_id AND c.fecha_turno = h.fecha_turno
      AND c.numero_turno = h.numero_turno AND h.origen = 'cierres_turno_final'
    UNION ALL
    SELECT 1 FROM public.cierres_turno_final_locales cl
    WHERE cl.empresa_id = h.empresa_id AND cl.fecha_turno = h.fecha_turno
      AND cl.numero_turno = h.numero_turno AND h.origen = 'cierres_turno_final_locales'
  )                                                    AS turno_vigente_existe
FROM public.cierres_turno_historico h
LEFT JOIN public.empresas e ON e.id = h.empresa_id
GROUP BY h.lote_id, h.empresa_id, e.nombre_comercial, h.origen, h.fecha_turno, h.numero_turno;

COMMENT ON VIEW public.historico_turnos_lotes IS
  'Una fila por movimiento al histórico de turnos. Alimenta la pantalla de auditoría de turnos.';

REVOKE ALL ON public.historico_turnos_lotes FROM anon;
GRANT SELECT ON public.historico_turnos_lotes TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 6 · Devolver un lote a la tabla de trabajo
-- ----------------------------------------------------------------------------
-- El orden de los pasos importa: la Fase 9 activa el índice único, así que
-- reinsertar un turno cuando ya hay otro vigente fallaría si no se archiva el
-- vigente antes. Por eso el paso 2 va delante del 3, y todo en la misma
-- transacción: o entra completo o no entra.
--
-- Nunca se pisa nada sin dejar copia. El turno que hoy está en la tabla de
-- trabajo podría ser el bueno, y quien restaura puede equivocarse.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.restaurar_turno_historico(
  p_lote_id uuid,
  p_motivo  text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa      uuid;
  v_fecha        date;
  v_numero       smallint;
  v_origen       text;
  v_ya           timestamptz;
  v_correo       text;
  v_lote_desplaz uuid;
  v_desplazadas  integer := 0;
  v_restauradas  integer := 0;
BEGIN
  IF p_lote_id IS NULL THEN
    RAISE EXCEPTION 'Falta el lote que se quiere restaurar' USING ERRCODE = '22023';
  END IF;

  SELECT empresa_id, fecha_turno, numero_turno, origen, MAX(restaurado_en)
  INTO v_empresa, v_fecha, v_numero, v_origen, v_ya
  FROM public.cierres_turno_historico
  WHERE lote_id = p_lote_id
  GROUP BY empresa_id, fecha_turno, numero_turno, origen;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Ese lote no existe en el histórico' USING ERRCODE = '22023';
  END IF;

  IF NOT public.app_es_admin() OR NOT public.app_puede_ver_empresa(v_empresa) THEN
    RAISE EXCEPTION 'Solo un administrador de esa sede puede restaurar turnos'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotencia: llamar dos veces no restaura dos veces.
  IF v_ya IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'ya_restaurado', true,
      'message', 'Este lote ya se había restaurado.',
      'restaurado_en', v_ya
    );
  END IF;

  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'email', ''), '')
  INTO v_correo;

  v_lote_desplaz := gen_random_uuid();

  -- ── 1. Archivar el turno vigente, si lo hay ──────────────────────────
  IF v_origen = 'cierres_turno_final_locales' THEN
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
      'cierres_turno_final_locales', auth.uid(), v_correo, p_motivo,
      v_lote_desplaz, 'SOBRESCRITO',
      format('Desplazado el %s al restaurar desde el histórico el lote %s. %s',
             to_char(now() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
             p_lote_id, COALESCE(NULLIF(p_motivo, ''), 'Sin motivo indicado.'))
    FROM public.cierres_turno_final_locales
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

    GET DIAGNOSTICS v_desplazadas = ROW_COUNT;

    DELETE FROM public.cierres_turno_final_locales
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
      'cierres_turno_final', auth.uid(), v_correo, p_motivo,
      v_lote_desplaz, 'SOBRESCRITO',
      format('Desplazado el %s al restaurar desde el histórico el lote %s. %s',
             to_char(now() AT TIME ZONE 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
             p_lote_id, COALESCE(NULLIF(p_motivo, ''), 'Sin motivo indicado.'))
    FROM public.cierres_turno_final
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;

    GET DIAGNOSTICS v_desplazadas = ROW_COUNT;

    DELETE FROM public.cierres_turno_final
    WHERE empresa_id = v_empresa AND fecha_turno = v_fecha AND numero_turno = v_numero;
  END IF;

  -- ── 2. Devolver las filas del lote ───────────────────────────────────
  IF v_origen = 'cierres_turno_final_locales' THEN
    INSERT INTO public.cierres_turno_final_locales (
      id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, created_at, valor, hora_inicio, hora_fin, variable,
      registrado_por, categoria, domicilios_global, efectivo_apertura,
      propina_global, total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, created_at, valor, hora_inicio, hora_fin, variable,
      registrado_por, categoria, domicilios_global, efectivo_apertura,
      propina_global, total_global, bolsa_global, caja_global, hora_llegada
    FROM public.cierres_turno_historico
    WHERE lote_id = p_lote_id;
  ELSE
    INSERT INTO public.cierres_turno_final (
      id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, created_at, valor, hora_inicio, hora_fin, variable,
      registrado_por, categoria, domicilios_global, efectivo_apertura,
      propina_global, total_global, bolsa_global, caja_global, hora_llegada
    )
    SELECT
      id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
      comentarios, created_at, valor, hora_inicio, hora_fin, variable,
      registrado_por, categoria, domicilios_global, efectivo_apertura,
      propina_global, total_global, bolsa_global, caja_global, hora_llegada
    FROM public.cierres_turno_historico
    WHERE lote_id = p_lote_id;
  END IF;

  GET DIAGNOSTICS v_restauradas = ROW_COUNT;

  -- ── 3. Marcar el lote. No se borra: la traza tiene que sobrevivir. ───
  UPDATE public.cierres_turno_historico
  SET restaurado_en  = now(),
      restaurado_por = auth.uid()
  WHERE lote_id = p_lote_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message', CASE WHEN v_desplazadas > 0
                    THEN format('Turno restaurado. Se archivaron %s filas del turno que estaba vigente.', v_desplazadas)
                    ELSE 'Turno restaurado.' END,
    'empresa_id', v_empresa,
    'fecha_turno', v_fecha,
    'numero_turno', v_numero,
    'filas_restauradas', v_restauradas,
    'filas_desplazadas', v_desplazadas,
    'lote_desplazado', CASE WHEN v_desplazadas > 0 THEN v_lote_desplaz ELSE NULL END
  );
END;
$$;

COMMENT ON FUNCTION public.restaurar_turno_historico(uuid, text) IS
  'Devuelve un lote del histórico a la tabla de trabajo. Si ese turno ya existe, lo archiva antes. Idempotente por lote_id.';

REVOKE ALL ON FUNCTION public.restaurar_turno_historico(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.restaurar_turno_historico(uuid, text) TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 7 · Anotar y editar desde la pantalla
-- ----------------------------------------------------------------------------
-- Dos funciones en lugar de dejar que el navegador haga UPDATE a pelo: así
-- editado_en / editado_por se rellenan siempre, y no dependen de que el
-- frontend se acuerde de mandarlos.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.anotar_historico_turno(
  p_lote_id       uuid,
  p_observaciones text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_filas integer := 0;
BEGIN
  UPDATE public.cierres_turno_historico
  SET observaciones = COALESCE(p_observaciones, '')
  WHERE lote_id = p_lote_id;

  GET DIAGNOSTICS v_filas = ROW_COUNT;

  IF v_filas = 0 THEN
    RAISE EXCEPTION 'No se pudo anotar ese lote. Comprueba que existe y que eres administrador de esa sede.'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('ok', true, 'filas_anotadas', v_filas);
END;
$$;

CREATE OR REPLACE FUNCTION public.editar_valor_historico_turno(
  p_historico_id uuid,
  p_valor        numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_filas integer := 0;
BEGIN
  UPDATE public.cierres_turno_historico
  SET valor       = COALESCE(p_valor, 0),
      editado_en  = now(),
      editado_por = auth.uid()
  WHERE historico_id = p_historico_id;

  GET DIAGNOSTICS v_filas = ROW_COUNT;

  IF v_filas = 0 THEN
    RAISE EXCEPTION 'No se pudo editar esa fila. Comprueba que existe y que eres administrador de esa sede.'
      USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.anotar_historico_turno(uuid, text)          FROM anon;
REVOKE ALL ON FUNCTION public.editar_valor_historico_turno(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.anotar_historico_turno(uuid, text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.editar_valor_historico_turno(uuid, numeric) TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
--   DROP VIEW     IF EXISTS public.historico_turnos_lotes;
--   DROP FUNCTION IF EXISTS public.restaurar_turno_historico(uuid, text);
--   DROP FUNCTION IF EXISTS public.anotar_historico_turno(uuid, text);
--   DROP FUNCTION IF EXISTS public.editar_valor_historico_turno(uuid, numeric);
--   DROP FUNCTION IF EXISTS public.app_nombre_responsable(uuid);
--   DROP POLICY   IF EXISTS cierres_turno_historico_update ON public.cierres_turno_historico;
--   DROP POLICY   IF EXISTS cierres_turno_historico_delete ON public.cierres_turno_historico;
--   DROP POLICY   IF EXISTS apoyos_turno_historico_update  ON public.apoyos_turno_historico;
--   DROP POLICY   IF EXISTS apoyos_turno_historico_delete  ON public.apoyos_turno_historico;
--   ALTER TABLE public.cierres_turno_historico
--     DROP COLUMN IF EXISTS lote_id, DROP COLUMN IF EXISTS codigo_motivo,
--     DROP COLUMN IF EXISTS restaurado_en, DROP COLUMN IF EXISTS restaurado_por,
--     DROP COLUMN IF EXISTS editado_en, DROP COLUMN IF EXISTS editado_por;
--   ALTER TABLE public.apoyos_turno_historico
--     DROP COLUMN IF EXISTS lote_id, DROP COLUMN IF EXISTS codigo_motivo,
--     DROP COLUMN IF EXISTS restaurado_en, DROP COLUMN IF EXISTS restaurado_por,
--     DROP COLUMN IF EXISTS editado_en, DROP COLUMN IF EXISTS editado_por;
--
-- Nada de esta migración toca datos de negocio.
-- ============================================================================

-- Hotfix 2026-09-08: efectivo de apertura por sede y sin saltos de fechas.
--
-- Una ausencia de cierre del día anterior no autoriza a recuperar una caja de
-- semanas atrás. Además, una sede fuera del alcance del usuario debe fallar de
-- forma explícita; nunca se sustituye silenciosamente por la empresa principal.

CREATE OR REPLACE FUNCTION public.efectivo_apertura_esperado(
  p_fecha      date,
  p_numero     smallint DEFAULT 1,
  p_empresa_id uuid     DEFAULT NULL
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
BEGIN
  v_empresa := COALESCE(p_empresa_id, public.app_empresa_id());

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no está vinculada a ninguna empresa'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.app_puede_ver_empresa(v_empresa) THEN
    RAISE EXCEPTION 'No tienes acceso a la sede solicitada'
      USING ERRCODE = '42501';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha del turno' USING ERRCODE = '22023';
  END IF;

  IF p_numero NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Indica la jornada del turno: 1, 2 o 3'
      USING ERRCODE = '22023';
  END IF;

  v_es_local := public.app_es_local(v_empresa);

  IF v_es_local THEN
    SELECT fecha_turno, numero_turno, MAX(caja_global) AS caja
      INTO v_fila
      FROM public.cierres_turno_final_locales
     WHERE empresa_id = v_empresa
       AND (
         (fecha_turno = p_fecha AND numero_turno < p_numero)
         OR fecha_turno = p_fecha - 1
       )
     GROUP BY fecha_turno, numero_turno
     ORDER BY fecha_turno DESC, numero_turno DESC
     LIMIT 1;
  ELSE
    SELECT fecha_turno, numero_turno, MAX(caja_global) AS caja
      INTO v_fila
      FROM public.cierres_turno_final
     WHERE empresa_id = v_empresa
       AND (
         (fecha_turno = p_fecha AND numero_turno < p_numero)
         OR fecha_turno = p_fecha - 1
       )
     GROUP BY fecha_turno, numero_turno
     ORDER BY fecha_turno DESC, numero_turno DESC
     LIMIT 1;
  END IF;

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
    'etiqueta', format(
      'Caja del %s turno %s',
      to_char(v_fila.fecha_turno, 'DD/MM/YYYY'),
      COALESCE(v_fila.numero_turno, 1)
    )
  );
END;
$$;

COMMENT ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid) IS
  'Caja del turno previo de la misma sede, limitada al mismo día o al día inmediatamente anterior.';

REVOKE ALL ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid)
  TO authenticated, service_role;

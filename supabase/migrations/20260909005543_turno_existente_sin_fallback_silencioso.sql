-- turno_existente sustituía en silencio una sede fuera de alcance por la
-- empresa del usuario. Con eso, un operario trabajando en contexto VIVA que
-- preguntaba por el turno de VIVA recibía la respuesta de LE MERIDIEM: el
-- formulario le decía "Este turno ya fue subido", él daba el cierre por hecho
-- y no lo subía. Ese aviso es el que hizo perder quince días de turnos.
--
-- Reproducido en la base simulando la sesión de una operaria de LE MERIDIEM:
--   sin sede  -> existe=true,  empresa_id=f37f6983 (LE MERIDIEM)   <- el fallo
--   con VIVA  -> existe=false                                      <- correcto
--
-- Ahora: si se pide una sede concreta y no está en el alcance, se falla de
-- forma explícita. Sin p_empresa_id se sigue usando la empresa del usuario,
-- que es el único caso en que esa suposición es correcta.

CREATE OR REPLACE FUNCTION public.turno_existente(
  p_fecha      date,
  p_numero     smallint,
  p_empresa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_empresa  uuid;
  v_es_local boolean;
  v_fila     record;
  v_hoy      date := (now() AT TIME ZONE 'America/Bogota')::date;
BEGIN
  IF p_empresa_id IS NOT NULL THEN
    IF NOT public.app_puede_ver_empresa(p_empresa_id) THEN
      RAISE EXCEPTION 'No tienes acceso a la sede solicitada'
        USING ERRCODE = '42501';
    END IF;
    v_empresa := p_empresa_id;
  ELSE
    v_empresa := public.app_empresa_id();
  END IF;

  IF v_empresa IS NULL THEN
    RAISE EXCEPTION 'Tu cuenta no esta vinculada a ninguna empresa'
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
    RETURN jsonb_build_object('ok', true, 'existe', false, 'empresa_id', v_empresa);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'existe', true,
    -- Se devuelve la empresa consultada para que el cliente pueda comprobar
    -- que le respondieron por la sede que preguntó.
    'empresa_id', v_empresa,
    'es_local', v_es_local,
    'subido_en', v_fila.subido_en,
    'registrado_por', COALESCE(v_fila.registrado_por, ''),
    'hora_inicio', COALESCE(v_fila.hora_inicio, ''),
    'filas', v_fila.filas,
    'puede_sobrescribir', public.app_es_admin() OR p_fecha = v_hoy
  );
END;
$function$;

COMMENT ON FUNCTION public.turno_existente(date, smallint, uuid) IS
  'Comprueba si ya existe un cierre para (sede, fecha, jornada). Falla si la sede pedida está fuera del alcance: nunca la sustituye en silencio.';

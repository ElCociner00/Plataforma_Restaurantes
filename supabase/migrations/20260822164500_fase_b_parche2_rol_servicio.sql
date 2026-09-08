-- ============================================================================
-- FASE B · parche 2 · detección correcta del rol de servicio
-- ----------------------------------------------------------------------------
-- El parche 1 comparaba current_user = 'service_role'. Dentro de una función
-- SECURITY DEFINER, current_user es el PROPIETARIO de la función (postgres),
-- no el rol de la petición, así que la comprobación nunca se cumplía.
-- El rol real de la llamada viaja en las reclamaciones del JWT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.app_es_rol_servicio()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

COMMENT ON FUNCTION public.app_es_rol_servicio() IS
  'TRUE cuando la petición llega con la clave de servicio. current_user no sirve dentro de SECURITY DEFINER: devuelve el propietario de la función.';

GRANT EXECUTE ON FUNCTION public.app_es_rol_servicio() TO anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.programar_refresco_loggro(
  p_url    text,
  p_secret text,
  p_cron   text DEFAULT '0 */4 * * *'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_id bigint;
BEGIN
  IF NOT (public.app_es_superadmin() OR public.app_es_rol_servicio()) THEN
    RAISE EXCEPTION 'Solo un superadministrador puede programar tareas'
      USING ERRCODE = '42501';
  END IF;

  PERFORM cron.unschedule('refrescar-token-loggro')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refrescar-token-loggro');

  SELECT cron.schedule(
    'refrescar-token-loggro',
    p_cron,
    format(
      $cmd$SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L),
        body := '{}'::jsonb
      );$cmd$,
      p_url, p_secret
    )
  ) INTO v_id;

  RETURN format('Tarea refrescar-token-loggro programada (%s) con id %s', p_cron, v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.estado_tareas_programadas()
RETURNS TABLE(nombre text, programacion text, activa boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jobname::text, schedule::text, active
  FROM cron.job
  WHERE public.app_es_superadmin() OR public.app_es_rol_servicio();
$$;

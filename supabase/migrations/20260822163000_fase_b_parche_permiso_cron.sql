-- ============================================================================
-- FASE B · parche 1 · permiso de programación desde service_role
-- ----------------------------------------------------------------------------
-- programar_refresco_loggro() exigía app_es_superadmin(), que se apoya en
-- auth.uid(). Cuando la llamada llega con la clave de servicio (que es como se
-- programa una tarea desde fuera de la aplicación) no hay usuario autenticado,
-- auth.uid() es NULL y la función se rechazaba a sí misma.
-- Se admite ahora también el rol service_role.
-- ============================================================================

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
  IF NOT (public.app_es_superadmin() OR current_user = 'service_role') THEN
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
  WHERE public.app_es_superadmin() OR current_user = 'service_role';
$$;

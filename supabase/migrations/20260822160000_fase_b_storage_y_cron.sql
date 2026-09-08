-- ============================================================================
-- FASE B · Almacenamiento de nómina y programación del refresco de token
--
-- Solo CREATE / INSERT idempotente. No borra nada.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Bucket privado para los PDF de nómina
-- ----------------------------------------------------------------------------
-- La Edge Function nomina-enviar-correo archiva aquí el documento de
-- autorización de descuentos antes de enviarlo. El bucket es privado: se lee
-- con service_role o con URL firmada, nunca en abierto.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('nomina-pdf', 'nomina-pdf', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Cada empresa solo ve su propia carpeta. La ruta que escribe la función es
-- <empresa_id>/<empleado_id>/<marca-de-tiempo>-autorizacion-descuentos.pdf,
-- así que el primer tramo del nombre identifica al tenant.
DROP POLICY IF EXISTS "nomina_pdf_lectura_tenant" ON storage.objects;
CREATE POLICY "nomina_pdf_lectura_tenant" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'nomina-pdf'
    AND public.app_puede_ver_empresa((string_to_array(name, '/'))[1]::uuid)
  );


-- ============================================================================
-- SECCIÓN 2 · Extensiones para tareas programadas
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net   WITH SCHEMA extensions;


-- ============================================================================
-- SECCIÓN 3 · Programación del refresco de token de Loggro
-- ----------------------------------------------------------------------------
-- Sustituye al Schedule Trigger del flujo n8n Reinicio_Credenciales_loggro.
--
-- La URL y el secreto NO se escriben en este archivo: acabaría versionado en
-- git, que es exactamente el problema que tenían los flujos n8n. Se pasan como
-- argumentos al ejecutar la función una sola vez desde fuera.
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
  IF NOT public.app_es_superadmin() THEN
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

COMMENT ON FUNCTION public.programar_refresco_loggro(text, text, text) IS
  'Programa la llamada periódica a la Edge Function cron-refrescar-token-loggro. Reemplaza el Schedule Trigger de n8n. Solo superadmin.';

GRANT EXECUTE ON FUNCTION public.programar_refresco_loggro(text, text, text) TO service_role;


-- Consulta de apoyo para ver qué está programado sin entrar al panel.
CREATE OR REPLACE FUNCTION public.estado_tareas_programadas()
RETURNS TABLE(nombre text, programacion text, activa boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT jobname::text, schedule::text, active
  FROM cron.job
  WHERE public.app_es_superadmin();
$$;

GRANT EXECUTE ON FUNCTION public.estado_tareas_programadas() TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 4 · Salud de las integraciones por empresa
-- ----------------------------------------------------------------------------
-- Permite ver de un vistazo qué empresas tienen Loggro operativo, sin exponer
-- ninguna credencial. Útil para el panel de superadministración.
-- ============================================================================

CREATE OR REPLACE VIEW public.estado_integraciones
WITH (security_invoker = 'on') AS
SELECT
  e.id                                   AS empresa_id,
  e.nombre_comercial,
  ic.plataforma,
  (ic.id IS NOT NULL)                    AS tiene_credencial,
  COALESCE(ic.activo, false)             AS credencial_activa,
  ic.validado_en,
  cp.plataforma_tenant_id                AS negocio_externo,
  cp.token_expira_en,
  (cp.token_expira_en > now())           AS token_vigente,
  cp.token_actualizado_en,
  cp.ultimo_error
FROM public.empresas e
LEFT JOIN public.integraciones_credenciales ic
       ON ic.empresa_id = e.id
LEFT JOIN public.credenciales_plataforma cp
       ON cp.empresa_id = e.id
      AND cp.plataforma = ic.plataforma
      AND cp.activo = true;

COMMENT ON VIEW public.estado_integraciones IS
  'Salud de las integraciones por empresa. No expone usuario ni contraseña.';

GRANT SELECT ON public.estado_integraciones TO authenticated, service_role;

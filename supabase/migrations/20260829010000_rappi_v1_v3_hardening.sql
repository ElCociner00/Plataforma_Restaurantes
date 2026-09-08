-- ENKRATO + RAPPI V1 · hardening requerido por control V3.
-- Aditiva hacia adelante: no borra eventos ni datos de negocio.

-- Recupera leases abandonados y agota de forma explícita trabajos que ya
-- alcanzaron el máximo. Así una caída del worker no deja PROCESSING eternos.
CREATE OR REPLACE FUNCTION public.rappi_claim_webhook_jobs(
  p_limit integer DEFAULT 20,
  p_worker text DEFAULT 'rappi-worker',
  p_empresa_id uuid DEFAULT NULL
)
RETURNS SETOF public.rappi_webhook_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH exhausted AS (
    UPDATE public.rappi_webhook_jobs
    SET status = 'DEAD',
        finished_at = now(),
        last_error = coalesce(last_error, 'Worker lease expired after maximum attempts'),
        updated_at = now()
    WHERE status = 'PROCESSING'
      AND claimed_at < now() - interval '10 minutes'
      AND attempts >= 5
      AND (p_empresa_id IS NULL OR empresa_id = p_empresa_id)
    RETURNING id
  ), candidates AS (
    SELECT j.id
    FROM public.rappi_webhook_jobs j
    WHERE (
      (j.status IN ('PENDING', 'RETRY') AND j.available_at <= now())
      OR (j.status = 'PROCESSING' AND j.claimed_at < now() - interval '10 minutes')
    )
      AND j.attempts < 5
      AND (p_empresa_id IS NULL OR j.empresa_id = p_empresa_id)
      AND NOT EXISTS (SELECT 1 FROM exhausted e WHERE e.id = j.id)
    ORDER BY j.available_at, j.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), claimed AS (
    UPDATE public.rappi_webhook_jobs j
    SET status = 'PROCESSING',
        attempts = attempts + 1,
        claimed_at = now(),
        claimed_by = left(coalesce(p_worker, 'rappi-worker'), 100),
        finished_at = NULL,
        updated_at = now()
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
$$;

REVOKE ALL ON FUNCTION public.rappi_claim_webhook_jobs(integer, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rappi_claim_webhook_jobs(integer, text, uuid)
  TO service_role;

-- El secreto se cifra en Supabase Vault y el texto de cron.job solo contiene
-- una consulta a Vault. Financial se agenda únicamente si la conexión lo tiene
-- habilitado; en V1/V3 permanece en standby.
CREATE OR REPLACE FUNCTION public.programar_tareas_rappi_v1(
  p_empresa_id uuid,
  p_secret text,
  p_environment text DEFAULT 'DEV',
  p_base_url text DEFAULT NULL,
  p_worker_cron text DEFAULT '* * * * *',
  p_operational_cron text DEFAULT '*/15 * * * *',
  p_financial_cron text DEFAULT '15 12 * * *'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault, pg_temp
AS $$
DECLARE
  v_environment text := CASE WHEN upper(p_environment) = 'PROD' THEN 'PROD' ELSE 'DEV' END;
  v_suffix text := lower(replace(p_empresa_id::text, '-', '')) || '-' || lower(v_environment);
  v_worker_name text := 'rappi-worker-v1';
  v_operational_name text := 'rappi-operational-' || v_suffix;
  v_financial_name text := 'rappi-financial-' || v_suffix;
  v_base_url text := rtrim(coalesce(p_base_url, ''), '/');
  v_secret_name text := 'rappi-cron-secret-v1';
  v_secret_id uuid;
  v_financial_enabled boolean;
  v_jobs jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role puede programar Rappi' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_secret, '')) < 24 THEN
    RAISE EXCEPTION 'CRON_SECRET inválido' USING ERRCODE = '22023';
  END IF;
  IF v_base_url !~ '^https://[a-z0-9-]+[.]supabase[.]co/functions/v1$' THEN
    RAISE EXCEPTION 'p_base_url debe ser la URL HTTPS explícita del proyecto Supabase' USING ERRCODE = '22023';
  END IF;

  SELECT financial_enabled INTO v_financial_enabled
  FROM public.rappi_connections
  WHERE empresa_id = p_empresa_id AND environment = v_environment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conexión Rappi no configurada' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_secret_name LIMIT 1;
  IF v_secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret, v_secret_name, 'CRON_SECRET para jobs Rappi V1', NULL);
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_secret, v_secret_name, 'CRON_SECRET para jobs Rappi V1', NULL);
  END IF;

  PERFORM cron.unschedule(v_worker_name)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_worker_name);
  PERFORM cron.unschedule(v_operational_name)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_operational_name);
  PERFORM cron.unschedule(v_financial_name)
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_financial_name);

  PERFORM cron.schedule(
    v_worker_name,
    p_worker_cron,
    format(
      $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=%L LIMIT 1)), body := '{}'::jsonb);$cmd$,
      v_base_url || '/rappi-worker', v_secret_name
    )
  );
  PERFORM cron.schedule(
    v_operational_name,
    p_operational_cron,
    format(
      $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=%L LIMIT 1)), body := %L::jsonb);$cmd$,
      v_base_url || '/rappi-sync', v_secret_name,
      jsonb_build_object('empresa_id', p_empresa_id, 'environment', v_environment, 'sync_type', 'operational')::text
    )
  );

  v_jobs := jsonb_build_array(v_worker_name, v_operational_name);
  IF coalesce(v_financial_enabled, false) THEN
    PERFORM cron.schedule(
      v_financial_name,
      p_financial_cron,
      format(
        $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name=%L LIMIT 1)), body := %L::jsonb);$cmd$,
        v_base_url || '/rappi-sync', v_secret_name,
        jsonb_build_object('empresa_id', p_empresa_id, 'environment', v_environment, 'sync_type', 'financial')::text
      )
    );
    v_jobs := v_jobs || jsonb_build_array(v_financial_name);
  END IF;

  RETURN jsonb_build_object(
    'scheduled', true,
    'environment', v_environment,
    'financial_scheduled', coalesce(v_financial_enabled, false),
    'jobs', v_jobs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.programar_tareas_rappi_v1(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.programar_tareas_rappi_v1(uuid, text, text, text, text, text, text)
  TO service_role;

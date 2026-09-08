-- ============================================================================
-- ENKRATO + RAPPI V1 · núcleo aislado y multi-tenant
-- Fecha: 2026-08-29
--
-- Migración completamente aditiva. No altera ni elimina datos existentes.
-- Las credenciales, tokens y secretos de webhook viven en tablas sin políticas
-- de lectura: únicamente las Edge Functions con service_role pueden acceder.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.rappi_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  environment text NOT NULL DEFAULT 'DEV' CHECK (environment IN ('DEV', 'PROD')),
  status text NOT NULL DEFAULT 'DISCONNECTED'
    CHECK (status IN ('DISCONNECTED', 'CONFIGURED', 'CONNECTED', 'DEGRADED', 'ERROR')),
  operational_base_url text NOT NULL DEFAULT 'https://api.dev.rappi.com',
  orders_base_url text NOT NULL DEFAULT 'https://microservices.dev.rappi.com',
  financial_base_url text NOT NULL DEFAULT 'https://api.dev.rappi.com',
  operational_enabled boolean NOT NULL DEFAULT true,
  financial_enabled boolean NOT NULL DEFAULT false,
  last_auth_ok_at timestamptz,
  last_financial_auth_ok_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, environment)
);

CREATE TABLE IF NOT EXISTS public.rappi_connection_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('OPERATIONAL', 'FINANCIAL')),
  client_id_ciphertext text NOT NULL,
  client_secret_ciphertext text NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, scope)
);

CREATE TABLE IF NOT EXISTS public.rappi_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('OPERATIONAL', 'FINANCIAL')),
  access_token_ciphertext text NOT NULL,
  token_type text NOT NULL DEFAULT 'Bearer',
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, scope)
);

CREATE TABLE IF NOT EXISTS public.rappi_stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  enkrato_empresa_id uuid REFERENCES public.empresas(id) ON DELETE RESTRICT,
  rappi_store_id text NOT NULL,
  integration_store_id text,
  store_name text,
  store_type text,
  active boolean NOT NULL DEFAULT true,
  connectivity_status text NOT NULL DEFAULT 'UNKNOWN',
  last_connectivity_at timestamptz,
  last_ping_at timestamptz,
  last_ping_ok boolean,
  menu_approval_status text,
  menu_updated_at timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, rappi_store_id)
);

CREATE TABLE IF NOT EXISTS public.rappi_webhook_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  endpoint_key uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  event_type text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING', 'ENABLE', 'DISABLE', 'ERROR')),
  remote_url text,
  subscribed_store_ids text[] NOT NULL DEFAULT '{}',
  last_received_at timestamptz,
  last_valid_signature_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, event_type)
);

CREATE TABLE IF NOT EXISTS public.rappi_webhook_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_config_id uuid NOT NULL REFERENCES public.rappi_webhook_configs(id) ON DELETE RESTRICT,
  secret_ciphertext text NOT NULL,
  rotated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  UNIQUE (webhook_config_id)
);

CREATE TABLE IF NOT EXISTS public.rappi_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_config_id uuid NOT NULL REFERENCES public.rappi_webhook_configs(id) ON DELETE RESTRICT,
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  signature_timestamp bigint NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  selected_headers jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'RECEIVED'
    CHECK (processing_status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED_DUPLICATE')),
  duplicate_count integer NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error_code text,
  error_message text,
  UNIQUE (webhook_config_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS public.rappi_webhook_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_event_id uuid NOT NULL REFERENCES public.rappi_webhook_events(id) ON DELETE RESTRICT UNIQUE,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'DONE', 'RETRY', 'DEAD')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text,
  finished_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rappi_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.rappi_stores(id) ON DELETE RESTRICT,
  rappi_order_id text NOT NULL,
  order_kind text NOT NULL DEFAULT 'REGULAR',
  is_scheduled boolean NOT NULL DEFAULT false,
  scheduled_for timestamptz,
  rappi_status text,
  operational_status text NOT NULL DEFAULT 'RECEIVED',
  financial_status text NOT NULL DEFAULT 'PENDING',
  accounting_status text NOT NULL DEFAULT 'NOT_READY',
  reconciliation_status text NOT NULL DEFAULT 'PENDING',
  delivery_operation_type text,
  delivery_method text,
  payment_method text,
  total_products numeric(18,2),
  total_discounts numeric(18,2),
  total_order numeric(18,2),
  total_to_pay numeric(18,2),
  tip_amount numeric(18,2),
  currency text NOT NULL DEFAULT 'COP',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  incident_severity text CHECK (incident_severity IN ('INFO', 'WARNING', 'CRITICAL')),
  incident_code text,
  provider_created_at timestamptz,
  last_event_at timestamptz,
  first_received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, rappi_order_id)
);

CREATE TABLE IF NOT EXISTS public.rappi_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rappi_orders(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  raw_event_id uuid REFERENCES public.rappi_webhook_events(id) ON DELETE RESTRICT UNIQUE,
  event_type text NOT NULL,
  rappi_status text,
  normalized_status text,
  provider_event_at timestamptz,
  additional_information jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rappi_order_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.rappi_orders(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  raw_event_id uuid REFERENCES public.rappi_webhook_events(id) ON DELETE RESTRICT UNIQUE,
  tracking_status text,
  courier_id text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  eta text,
  eta_type text,
  tracked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rappi_store_connectivity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.rappi_stores(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  raw_event_id uuid REFERENCES public.rappi_webhook_events(id) ON DELETE RESTRICT UNIQUE,
  provider_status text,
  normalized_status text NOT NULL DEFAULT 'UNKNOWN',
  is_online boolean,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.rappi_menu_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.rappi_stores(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  content_hash text NOT NULL,
  approval_status text,
  item_count integer NOT NULL DEFAULT 0,
  menu_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'SYNC',
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, content_hash)
);

CREATE TABLE IF NOT EXISTS public.rappi_financial_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.rappi_stores(id) ON DELETE RESTRICT,
  rappi_payment_id text NOT NULL,
  status text,
  period_start_date timestamptz,
  period_end_date timestamptz,
  expected_execution_date timestamptz,
  confirmed_payment_date timestamptz,
  total_amount numeric(18,2),
  payment_reference text,
  frequency_type text,
  stores_consolidated jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, rappi_payment_id, store_id)
);

CREATE TABLE IF NOT EXISTS public.rappi_financial_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  store_id uuid REFERENCES public.rappi_stores(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.rappi_financial_payments(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.rappi_orders(id) ON DELETE RESTRICT,
  entry_kind text NOT NULL,
  record_key text NOT NULL,
  rappi_order_id text,
  rappi_payment_id text,
  amount numeric(18,2),
  occurred_at timestamptz,
  billing jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, store_id, entry_kind, record_key)
);

CREATE TABLE IF NOT EXISTS public.rappi_accounting_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES public.rappi_orders(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES public.rappi_financial_payments(id) ON DELETE RESTRICT,
  external_id text NOT NULL,
  target_provider text NOT NULL DEFAULT 'LOGGRO',
  status text NOT NULL DEFAULT 'BLOCKED_CONFIGURATION'
    CHECK (status IN ('BLOCKED_CONFIGURATION', 'PENDING', 'PROCESSING', 'RETRY', 'ACCEPTED', 'REJECTED', 'INCIDENT')),
  attempts integer NOT NULL DEFAULT 0,
  remote_id text,
  amount numeric(18,2),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_provider, external_id)
);

CREATE TABLE IF NOT EXISTS public.rappi_reconciliation_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.rappi_orders(id) ON DELETE RESTRICT UNIQUE,
  payment_id uuid REFERENCES public.rappi_financial_payments(id) ON DELETE RESTRICT,
  accounting_attempt_id uuid REFERENCES public.rappi_accounting_attempts(id) ON DELETE RESTRICT,
  operational_amount numeric(18,2),
  financial_amount numeric(18,2),
  accounting_amount numeric(18,2),
  difference_amount numeric(18,2),
  severity text NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  status text NOT NULL DEFAULT 'PENDING',
  rule_codes text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rappi_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING', 'SUCCEEDED', 'PARTIAL', 'FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  cursor_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  records_read integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  pages_read integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.rappi_integration_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid REFERENCES public.rappi_connections(id) ON DELETE RESTRICT,
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE RESTRICT,
  source text NOT NULL,
  error_class text NOT NULL,
  error_code text,
  public_message text NOT NULL,
  technical_detail text,
  retryable boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RETRYING', 'RESOLVED', 'IGNORED')),
  occurrence_count integer NOT NULL DEFAULT 1,
  first_occurred_at timestamptz NOT NULL DEFAULT now(),
  last_occurred_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Índices de lectura operacional, financiera y de cola.
CREATE INDEX IF NOT EXISTS ix_rappi_stores_empresa ON public.rappi_stores (empresa_id, active);
CREATE INDEX IF NOT EXISTS ix_rappi_stores_mapeo ON public.rappi_stores (enkrato_empresa_id) WHERE enkrato_empresa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_rappi_webhook_events_estado ON public.rappi_webhook_events (processing_status, received_at);
CREATE INDEX IF NOT EXISTS ix_rappi_jobs_disponibles ON public.rappi_webhook_jobs (status, available_at);
CREATE INDEX IF NOT EXISTS ix_rappi_orders_empresa_fecha ON public.rappi_orders (empresa_id, provider_created_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS ix_rappi_orders_estado ON public.rappi_orders (empresa_id, operational_status, reconciliation_status);
CREATE INDEX IF NOT EXISTS ix_rappi_order_events_order ON public.rappi_order_events (order_id, provider_event_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_rappi_tracking_order ON public.rappi_order_tracking (order_id, tracked_at DESC);
CREATE INDEX IF NOT EXISTS ix_rappi_payments_empresa_fecha ON public.rappi_financial_payments (empresa_id, confirmed_payment_date DESC);
CREATE INDEX IF NOT EXISTS ix_rappi_financial_entries_order ON public.rappi_financial_entries (rappi_order_id, entry_kind);
CREATE INDEX IF NOT EXISTS ix_rappi_errors_abiertos ON public.rappi_integration_errors (empresa_id, status, last_occurred_at DESC);
CREATE INDEX IF NOT EXISTS ix_rappi_sync_empresa ON public.rappi_sync_runs (empresa_id, started_at DESC);

-- updated_at aislado para las tablas Rappi.
CREATE OR REPLACE FUNCTION public.rappi_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rappi_connections_updated_at ON public.rappi_connections;
CREATE TRIGGER rappi_connections_updated_at BEFORE UPDATE ON public.rappi_connections
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_connection_secrets_updated_at ON public.rappi_connection_secrets;
CREATE TRIGGER rappi_connection_secrets_updated_at BEFORE UPDATE ON public.rappi_connection_secrets
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_tokens_updated_at ON public.rappi_tokens;
CREATE TRIGGER rappi_tokens_updated_at BEFORE UPDATE ON public.rappi_tokens
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_stores_updated_at ON public.rappi_stores;
CREATE TRIGGER rappi_stores_updated_at BEFORE UPDATE ON public.rappi_stores
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_webhook_configs_updated_at ON public.rappi_webhook_configs;
CREATE TRIGGER rappi_webhook_configs_updated_at BEFORE UPDATE ON public.rappi_webhook_configs
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_jobs_updated_at ON public.rappi_webhook_jobs;
CREATE TRIGGER rappi_jobs_updated_at BEFORE UPDATE ON public.rappi_webhook_jobs
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_orders_updated_at ON public.rappi_orders;
CREATE TRIGGER rappi_orders_updated_at BEFORE UPDATE ON public.rappi_orders
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_payments_updated_at ON public.rappi_financial_payments;
CREATE TRIGGER rappi_payments_updated_at BEFORE UPDATE ON public.rappi_financial_payments
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_accounting_updated_at ON public.rappi_accounting_attempts;
CREATE TRIGGER rappi_accounting_updated_at BEFORE UPDATE ON public.rappi_accounting_attempts
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();
DROP TRIGGER IF EXISTS rappi_reconciliation_updated_at ON public.rappi_reconciliation_records;
CREATE TRIGGER rappi_reconciliation_updated_at BEFORE UPDATE ON public.rappi_reconciliation_records
FOR EACH ROW EXECUTE FUNCTION public.rappi_set_updated_at();

-- Claim atómico: evita que dos workers procesen el mismo evento.
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
  WITH candidates AS (
    SELECT id
    FROM public.rappi_webhook_jobs
    WHERE status IN ('PENDING', 'RETRY')
      AND available_at <= now()
      AND (p_empresa_id IS NULL OR empresa_id = p_empresa_id)
    ORDER BY available_at, created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 100)
  ), claimed AS (
    UPDATE public.rappi_webhook_jobs j
    SET status = 'PROCESSING',
        attempts = attempts + 1,
        claimed_at = now(),
        claimed_by = left(coalesce(p_worker, 'rappi-worker'), 100)
    FROM candidates c
    WHERE j.id = c.id
    RETURNING j.*
  )
  SELECT * FROM claimed;
$$;

REVOKE ALL ON FUNCTION public.rappi_claim_webhook_jobs(integer, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rappi_claim_webhook_jobs(integer, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rappi_finance_summary(
  p_empresa_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_payments_count bigint := 0;
  v_payments_total numeric := 0;
  v_matched bigint := 0;
  v_warnings bigint := 0;
  v_critical bigint := 0;
  v_pending bigint := 0;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role puede calcular el resumen Rappi' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), coalesce(sum(total_amount), 0)
  INTO v_payments_count, v_payments_total
  FROM public.rappi_financial_payments
  WHERE empresa_id = p_empresa_id
    AND (p_from IS NULL OR confirmed_payment_date >= p_from::timestamptz)
    AND (p_to IS NULL OR confirmed_payment_date < (p_to + 1)::timestamptz);

  SELECT
    count(*) FILTER (WHERE status = 'MATCHED'),
    count(*) FILTER (WHERE status = 'WARNING'),
    count(*) FILTER (WHERE status = 'CRITICAL'),
    count(*) FILTER (WHERE status = 'PENDING')
  INTO v_matched, v_warnings, v_critical, v_pending
  FROM public.rappi_reconciliation_records
  WHERE empresa_id = p_empresa_id
    AND (p_from IS NULL OR evaluated_at >= p_from::timestamptz)
    AND (p_to IS NULL OR evaluated_at < (p_to + 1)::timestamptz);

  RETURN jsonb_build_object(
    'payments_count', v_payments_count,
    'payments_total', v_payments_total,
    'reconciliation', jsonb_build_object(
      'matched', v_matched,
      'warnings', v_warnings,
      'critical', v_critical,
      'pending', v_pending
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rappi_finance_summary(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rappi_finance_summary(uuid, date, date) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- La programación se activa de forma explícita después del despliegue. El
-- secreto nunca queda versionado: se entrega únicamente al invocar esta RPC
-- con service_role desde un entorno seguro.
CREATE OR REPLACE FUNCTION public.programar_tareas_rappi_v1(
  p_empresa_id uuid,
  p_secret text,
  p_environment text DEFAULT 'DEV',
  p_base_url text DEFAULT 'https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1',
  p_worker_cron text DEFAULT '* * * * *',
  p_operational_cron text DEFAULT '*/15 * * * *',
  p_financial_cron text DEFAULT '15 12 * * *'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_environment text := CASE WHEN upper(p_environment) = 'PROD' THEN 'PROD' ELSE 'DEV' END;
  v_suffix text := lower(replace(p_empresa_id::text, '-', '')) || '-' || lower(v_environment);
  v_worker_name text := 'rappi-worker-v1';
  v_operational_name text;
  v_financial_name text;
  v_base_url text := rtrim(p_base_url, '/');
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role puede programar Rappi' USING ERRCODE = '42501';
  END IF;
  IF length(coalesce(p_secret, '')) < 24 THEN
    RAISE EXCEPTION 'CRON_SECRET inválido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.empresas WHERE id = p_empresa_id) THEN
    RAISE EXCEPTION 'Empresa no encontrada' USING ERRCODE = '23503';
  END IF;

  v_operational_name := 'rappi-operational-' || v_suffix;
  v_financial_name := 'rappi-financial-' || v_suffix;

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
      $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := '{}'::jsonb);$cmd$,
      v_base_url || '/rappi-worker', p_secret
    )
  );
  PERFORM cron.schedule(
    v_operational_name,
    p_operational_cron,
    format(
      $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := %L::jsonb);$cmd$,
      v_base_url || '/rappi-sync', p_secret,
      jsonb_build_object('empresa_id', p_empresa_id, 'environment', v_environment, 'sync_type', 'operational')::text
    )
  );
  PERFORM cron.schedule(
    v_financial_name,
    p_financial_cron,
    format(
      $cmd$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',%L), body := %L::jsonb);$cmd$,
      v_base_url || '/rappi-sync', p_secret,
      jsonb_build_object('empresa_id', p_empresa_id, 'environment', v_environment, 'sync_type', 'financial')::text
    )
  );

  RETURN jsonb_build_object(
    'scheduled', true,
    'environment', v_environment,
    'jobs', jsonb_build_array(v_worker_name, v_operational_name, v_financial_name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.desprogramar_tareas_rappi_v1(
  p_empresa_id uuid,
  p_environment text DEFAULT 'DEV'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_environment text := CASE WHEN upper(p_environment) = 'PROD' THEN 'PROD' ELSE 'DEV' END;
  v_suffix text := lower(replace(p_empresa_id::text, '-', '')) || '-' || lower(v_environment);
  v_names text[];
  v_name text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role puede desprogramar Rappi' USING ERRCODE = '42501';
  END IF;
  v_names := ARRAY['rappi-operational-' || v_suffix, 'rappi-financial-' || v_suffix];
  FOREACH v_name IN ARRAY v_names LOOP
    PERFORM cron.unschedule(v_name)
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_name);
  END LOOP;
  RETURN jsonb_build_object('unscheduled', true, 'jobs', to_jsonb(v_names));
END;
$$;

REVOKE ALL ON FUNCTION public.programar_tareas_rappi_v1(uuid, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desprogramar_tareas_rappi_v1(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.programar_tareas_rappi_v1(uuid, text, text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.desprogramar_tareas_rappi_v1(uuid, text) TO service_role;

-- RLS en todas las entidades. Las escrituras de proveedor pasan por backend.
ALTER TABLE public.rappi_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_connection_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_webhook_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_webhook_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_order_tracking ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_store_connectivity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_menu_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_financial_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_financial_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_accounting_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_reconciliation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rappi_integration_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY rappi_connections_select_tenant ON public.rappi_connections
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_stores_select_tenant ON public.rappi_stores
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) OR public.app_puede_ver_empresa(enkrato_empresa_id));
CREATE POLICY rappi_webhook_configs_select_admin ON public.rappi_webhook_configs
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());
CREATE POLICY rappi_webhook_events_select_admin ON public.rappi_webhook_events
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());
CREATE POLICY rappi_webhook_jobs_select_admin ON public.rappi_webhook_jobs
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());
CREATE POLICY rappi_orders_select_tenant ON public.rappi_orders
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_order_events_select_tenant ON public.rappi_order_events
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_tracking_select_tenant ON public.rappi_order_tracking
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_connectivity_select_tenant ON public.rappi_store_connectivity_events
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_menus_select_tenant ON public.rappi_menu_versions
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_payments_select_tenant ON public.rappi_financial_payments
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_financial_entries_select_tenant ON public.rappi_financial_entries
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_accounting_select_tenant ON public.rappi_accounting_attempts
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_reconciliation_select_tenant ON public.rappi_reconciliation_records
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id));
CREATE POLICY rappi_sync_select_admin ON public.rappi_sync_runs
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());
CREATE POLICY rappi_errors_select_admin ON public.rappi_integration_errors
  FOR SELECT USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());

-- Las tablas de secretos quedan sin políticas SELECT por diseño.
REVOKE ALL ON public.rappi_connection_secrets, public.rappi_tokens, public.rappi_webhook_secrets
  FROM PUBLIC, anon, authenticated;

-- El esquema inicial del proyecto concede ALL por defecto sobre tablas nuevas.
-- RLS ya impediría escrituras sin política, pero se revocan también a nivel de
-- privilegio para que la API pública solo tenga la lectura explícita de abajo.
REVOKE ALL ON public.rappi_connections, public.rappi_stores, public.rappi_webhook_configs,
  public.rappi_webhook_events, public.rappi_webhook_jobs, public.rappi_orders,
  public.rappi_order_events, public.rappi_order_tracking, public.rappi_store_connectivity_events,
  public.rappi_menu_versions, public.rappi_financial_payments, public.rappi_financial_entries,
  public.rappi_accounting_attempts, public.rappi_reconciliation_records,
  public.rappi_sync_runs, public.rappi_integration_errors FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.rappi_connections, public.rappi_stores, public.rappi_webhook_configs,
  public.rappi_webhook_events, public.rappi_webhook_jobs, public.rappi_orders,
  public.rappi_order_events, public.rappi_order_tracking, public.rappi_store_connectivity_events,
  public.rappi_menu_versions, public.rappi_financial_payments, public.rappi_financial_entries,
  public.rappi_accounting_attempts, public.rappi_reconciliation_records,
  public.rappi_sync_runs, public.rappi_integration_errors TO authenticated;

COMMENT ON TABLE public.rappi_webhook_events IS
  'Eventos raw de Rappi. Puede contener PII; lectura limitada a administradores mediante RLS.';
COMMENT ON TABLE public.rappi_connection_secrets IS
  'Credenciales Rappi cifradas AES-GCM. Sin acceso desde el navegador.';
COMMENT ON TABLE public.rappi_tokens IS
  'Tokens Rappi cifrados y separados por scope OPERATIONAL/FINANCIAL.';
COMMENT ON TABLE public.rappi_accounting_attempts IS
  'Frontera contable: no se envía nada a Loggro hasta que exista parametrización aprobada.';

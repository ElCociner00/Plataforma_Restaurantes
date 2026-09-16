-- Vinculación de la cuenta Rappi Partners del restaurante con su empresa en
-- Enkrato (auto-onboarding). Cada fila es un intento de un solo uso: la marca
-- `state` ata el regreso desde Rappi a la empresa y al usuario que lo inició,
-- así la cuenta de Rappi nunca crea ni elige cuentas de Enkrato.
CREATE TABLE IF NOT EXISTS public.rappi_partner_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  environment text NOT NULL CHECK (environment IN ('DEV', 'PROD')),
  state_hash text NOT NULL UNIQUE,
  code_verifier_ciphertext text NOT NULL,
  merchant_token_ciphertext text,
  merchant_token_expires_at timestamptz,
  merchant_email text,
  status text NOT NULL DEFAULT 'STARTED'
    CHECK (status IN ('STARTED', 'AUTHORIZED', 'PROVISIONED', 'FAILED')),
  last_error text,
  provisioned_store_ids text[] NOT NULL DEFAULT '{}',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  authorized_at timestamptz,
  provisioned_at timestamptz
);

CREATE INDEX IF NOT EXISTS rappi_partner_links_empresa_idx
  ON public.rappi_partner_links (empresa_id, created_at DESC);

-- Solo las Edge Functions (service_role) leen o escriben: guarda tokens cifrados.
ALTER TABLE public.rappi_partner_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rappi_partner_links FROM anon, authenticated;

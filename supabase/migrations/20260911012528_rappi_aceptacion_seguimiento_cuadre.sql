-- Rappi: aceptación automática de pedidos, seguimiento de entrega y cuadre.
--
-- Por qué: Enkrato recibía el webhook NEW_ORDER pero nunca tomaba la orden.
-- Rappi da 6 minutos para aceptarla y después la vence (TIMEOUT) sin mandar
-- ningún webhook. Resultado: en Rappi el pedido se perdía y en Enkrato
-- quedaba "Recibido" para siempre, sin repartidor ni entrega que seguir.
--
-- Todo es aditivo: columnas nuevas con valores por defecto, sin tocar datos.

ALTER TABLE public.rappi_stores
  ADD COLUMN IF NOT EXISTS auto_accept boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.rappi_stores.auto_accept IS
  'true: Enkrato acepta en Rappi cada pedido apenas llega. false: la tienda lo acepta por otro medio (tablet de Rappi) y Enkrato solo observa.';

ALTER TABLE public.rappi_orders
  ADD COLUMN IF NOT EXISTS acceptance_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS acceptance_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS acceptance_error text,
  ADD COLUMN IF NOT EXISTS courier_name text,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_event text,
  ADD COLUMN IF NOT EXISTS last_provider_check_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rappi_orders_acceptance_status_check'
  ) THEN
    ALTER TABLE public.rappi_orders
      ADD CONSTRAINT rappi_orders_acceptance_status_check
      CHECK (acceptance_status IN ('UNKNOWN', 'PENDING', 'ACCEPTED', 'MANUAL', 'FAILED'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.rappi_orders.acceptance_status IS
  'UNKNOWN: anterior a la aceptación automática. PENDING: esperando que Enkrato la tome. ACCEPTED: tomada (por Enkrato o por la tablet). MANUAL: la tienda acepta por otro medio. FAILED: no se pudo tomar a tiempo.';

ALTER TABLE public.rappi_connections
  ADD COLUMN IF NOT EXISTS last_order_sweep_at timestamptz;

-- Barrido del worker: órdenes activas ordenadas por última consulta.
CREATE INDEX IF NOT EXISTS ix_rappi_orders_activas
  ON public.rappi_orders (connection_id, last_provider_check_at NULLS FIRST)
  WHERE operational_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'NOT_ACCEPTED');
CREATE INDEX IF NOT EXISTS ix_rappi_orders_aceptacion_pendiente
  ON public.rappi_orders (connection_id, first_received_at)
  WHERE acceptance_status = 'PENDING';
CREATE INDEX IF NOT EXISTS ix_rappi_orders_empresa_creacion
  ON public.rappi_orders (empresa_id, provider_created_at DESC);

-- Cuadre diario Rappi contra los cierres de turno.
--
-- Día calendario de Colombia. Del lado Rappi: pedidos entregados, cancelados,
-- vencidos y lo que el repartidor cobró en efectivo. Del lado Enkrato: lo que
-- los cierres de turno registraron como Rappi (sistema = Loggro, real =
-- contado). La diferencia no es automáticamente un error (descuentos,
-- pedidos que cruzan medianoche), pero es por donde se empieza a revisar.
CREATE OR REPLACE FUNCTION public.rappi_cuadre_diario(
  p_empresa_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_dias jsonb;
  v_metodos jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Solo service_role puede calcular el cuadre Rappi' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'Rango de fechas inválido' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > 92 THEN
    RAISE EXCEPTION 'El cuadre admite como máximo 93 días' USING ERRCODE = '22023';
  END IF;

  WITH pedidos AS (
    SELECT
      (coalesce(o.provider_created_at, o.first_received_at) AT TIME ZONE 'America/Bogota')::date AS dia,
      o.*
    FROM public.rappi_orders o
    WHERE o.empresa_id = p_empresa_id
      AND o.rappi_order_id NOT LIKE 'ENKRATO-DEV-%'
      AND o.rappi_order_id NOT LIKE 'SAMPLE-%'
      AND coalesce(o.provider_created_at, o.first_received_at) >= (p_from::timestamp AT TIME ZONE 'America/Bogota')
      AND coalesce(o.provider_created_at, o.first_received_at) < ((p_to + 1)::timestamp AT TIME ZONE 'America/Bogota')
  ),
  rappi AS (
    SELECT
      dia,
      count(*) AS pedidos,
      count(*) FILTER (WHERE operational_status = 'COMPLETED') AS entregados,
      count(*) FILTER (WHERE operational_status IN ('CANCELLED', 'REJECTED')) AS cancelados,
      count(*) FILTER (WHERE operational_status = 'NOT_ACCEPTED') AS vencidos,
      count(*) FILTER (WHERE operational_status NOT IN ('COMPLETED', 'CANCELLED', 'REJECTED', 'NOT_ACCEPTED')) AS en_curso,
      coalesce(sum(total_order) FILTER (WHERE operational_status = 'COMPLETED'), 0) AS total_entregado,
      coalesce(sum(total_discounts) FILTER (WHERE operational_status = 'COMPLETED'), 0) AS descuentos_entregados,
      coalesce(sum(total_to_pay) FILTER (
        WHERE operational_status = 'COMPLETED' AND lower(coalesce(payment_method, '')) = 'cash'
      ), 0) AS efectivo_repartidor,
      coalesce(sum(total_order) FILTER (
        WHERE operational_status IN ('CANCELLED', 'REJECTED', 'NOT_ACCEPTED')
      ), 0) AS total_no_vendido
    FROM pedidos
    GROUP BY dia
  ),
  cierres AS (
    SELECT
      fecha_turno AS dia,
      count(*) AS turnos,
      coalesce(sum(rappi_sistema), 0) AS rappi_sistema,
      coalesce(sum(rappi_real), 0) AS rappi_real
    FROM public.v_turnos_pivote
    WHERE empresa_id = p_empresa_id
      AND fecha_turno BETWEEN p_from AND p_to
    GROUP BY fecha_turno
  )
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.dia), '[]'::jsonb)
  INTO v_dias
  FROM (
    SELECT
      coalesce(r.dia, c.dia) AS dia,
      coalesce(r.pedidos, 0) AS pedidos,
      coalesce(r.entregados, 0) AS entregados,
      coalesce(r.cancelados, 0) AS cancelados,
      coalesce(r.vencidos, 0) AS vencidos,
      coalesce(r.en_curso, 0) AS en_curso,
      coalesce(r.total_entregado, 0) AS total_entregado,
      coalesce(r.descuentos_entregados, 0) AS descuentos_entregados,
      coalesce(r.efectivo_repartidor, 0) AS efectivo_repartidor,
      coalesce(r.total_no_vendido, 0) AS total_no_vendido,
      coalesce(c.turnos, 0) AS turnos,
      c.rappi_sistema,
      c.rappi_real
    FROM rappi r
    FULL OUTER JOIN cierres c ON c.dia = r.dia
  ) x;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.total DESC), '[]'::jsonb)
  INTO v_metodos
  FROM (
    SELECT
      coalesce(nullif(lower(payment_method), ''), 'desconocido') AS metodo,
      count(*) AS pedidos,
      coalesce(sum(total_order), 0) AS total
    FROM public.rappi_orders
    WHERE empresa_id = p_empresa_id
      AND operational_status = 'COMPLETED'
      AND rappi_order_id NOT LIKE 'ENKRATO-DEV-%'
      AND rappi_order_id NOT LIKE 'SAMPLE-%'
      AND coalesce(provider_created_at, first_received_at) >= (p_from::timestamp AT TIME ZONE 'America/Bogota')
      AND coalesce(provider_created_at, first_received_at) < ((p_to + 1)::timestamp AT TIME ZONE 'America/Bogota')
    GROUP BY 1
  ) m;

  RETURN jsonb_build_object('dias', v_dias, 'metodos_pago', v_metodos);
END;
$$;

REVOKE ALL ON FUNCTION public.rappi_cuadre_diario(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rappi_cuadre_diario(uuid, date, date) TO service_role;

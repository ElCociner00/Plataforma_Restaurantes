-- Cuadre Rappi: "efectivo_repartidor" pasa a llamarse "cobrado_por_local".
--
-- Pedidos reales del sandbox (2026-09-11) mostraron que total_to_pay NO es lo
-- que cobra el repartidor de Rappi: es lo que el LOCAL le cobra al cliente.
-- Vale 0 en Full delivery (el repartidor de Rappi recibe el efectivo) y el
-- total de la app en Pickup y Marketplace. Ese dinero entra a la caja del
-- local, así que es justo lo que el cuadre debe mostrar contra el cierre.
-- Se quita además el filtro por efectivo: si Rappi dice que el local cobra,
-- lo cobra sin importar cómo se haya etiquetado el pago.

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
      coalesce(sum(total_to_pay) FILTER (WHERE operational_status = 'COMPLETED'), 0) AS cobrado_por_local,
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
      coalesce(r.cobrado_por_local, 0) AS cobrado_por_local,
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

-- ==============================================================================
-- FASE 3: TABLERO 1 - CONCILIACION
-- ==============================================================================
-- Definicion corregida (fase 15): el filtro por empresa se resuelve UNA vez a
-- un arreglo local y se aplica con = ANY(...), en vez de unnest() sobre
-- app_empresas_visibles(), que devuelve SETOF uuid y no un arreglo.

CREATE OR REPLACE FUNCTION public.dashboard_conciliacion(p_desde date, p_hasta date, p_empresa_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_resultado json;
  v_empresas  uuid[];
BEGIN
  IF NOT public.app_es_admin() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;

  v_empresas := ARRAY(SELECT public.app_empresas_visibles());

  -- Una sede concreta solo se acepta si ya estaba dentro del alcance.
  IF p_empresa_id IS NOT NULL THEN
    v_empresas := CASE WHEN p_empresa_id = ANY (v_empresas)
                       THEN ARRAY[p_empresa_id]
                       ELSE ARRAY[]::uuid[] END;
  END IF;

  WITH turnos_filtrados AS (
    SELECT *
    FROM public.v_turnos_pivote
    WHERE fecha_turno >= p_desde AND fecha_turno <= p_hasta
      AND empresa_id = ANY (v_empresas)
  ),
  totales AS (
    SELECT
      COUNT(*) AS total_turnos,
      COUNT(*) FILTER (WHERE NOT cuadrado) AS turnos_descuadrados,
      SUM(descuadre_total) AS descuadre_neto,
      SUM(efectivo_dif) AS dif_efectivo,
      SUM(datafono_dif) AS dif_datafono,
      SUM(transferencias_dif) AS dif_transferencias,
      SUM(rappi_dif) AS dif_rappi,
      SUM(nequi_dif) AS dif_nequi,
      SUM(bono_dif) AS dif_bono
    FROM turnos_filtrados
  ),
  evolucion_diaria AS (
    SELECT
      fecha_turno AS fecha,
      SUM(descuadre_total) AS descuadre,
      SUM(efectivo_dif) AS dif_efectivo
    FROM turnos_filtrados
    GROUP BY fecha_turno
    ORDER BY fecha_turno
  )
  SELECT json_build_object(
    'resumen', (SELECT row_to_json(totales.*) FROM totales),
    'evolucion', (SELECT COALESCE(json_agg(row_to_json(evolucion_diaria.*)), '[]'::json) FROM evolucion_diaria)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

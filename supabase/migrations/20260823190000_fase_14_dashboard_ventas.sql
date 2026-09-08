-- ==============================================================================
-- FASE 4: TABLERO 2 - VENTAS Y TURNOS
-- ==============================================================================
-- Definicion corregida (fase 15): el filtro por empresa se resuelve UNA vez a
-- un arreglo local y se aplica con = ANY(...), en vez de unnest() sobre
-- app_empresas_visibles(), que devuelve SETOF uuid y no un arreglo.

CREATE OR REPLACE FUNCTION public.dashboard_ventas(p_desde date, p_hasta date, p_empresa_id uuid DEFAULT NULL::uuid)
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
      SUM(total_global) AS total_ventas,
      SUM(efectivo_sistema) AS ventas_efectivo,
      SUM(datafono_sistema) AS ventas_datafono,
      SUM(transferencias_sistema) AS ventas_transferencias,
      SUM(rappi_sistema) AS ventas_rappi,
      SUM(nequi_sistema) AS ventas_nequi,
      SUM(bono_sistema) AS ventas_bono
    FROM turnos_filtrados
  ),
  evolucion_diaria AS (
    SELECT
      fecha_turno AS fecha,
      SUM(total_global) AS venta_dia
    FROM turnos_filtrados
    GROUP BY fecha_turno
    ORDER BY fecha_turno
  ),
  -- El nombre del responsable se resuelve DESPUÃ‰S del LIMIT: 20 llamadas, no
  -- una por cada turno del perÃ­odo.
  lista_turnos AS (
    SELECT
      fecha_turno,
      numero_turno,
      responsable_id,
      hora_inicio,
      hora_llegada,
      total_global AS venta_turno
    FROM turnos_filtrados
    ORDER BY fecha_turno DESC, numero_turno DESC
    LIMIT 20
  )
  SELECT json_build_object(
    'resumen', (SELECT row_to_json(totales.*) FROM totales),
    'evolucion', (SELECT COALESCE(json_agg(row_to_json(evolucion_diaria.*)), '[]'::json) FROM evolucion_diaria),
    'turnos', (SELECT COALESCE(json_agg(row_to_json(t.*)), '[]'::json)
               FROM (SELECT lt.fecha_turno,
                            lt.numero_turno,
                            public.app_nombre_responsable(lt.responsable_id) AS responsable_nombre,
                            lt.hora_inicio,
                            lt.hora_llegada,
                            lt.venta_turno
                     FROM lista_turnos lt) t)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

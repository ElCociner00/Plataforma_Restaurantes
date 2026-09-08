-- ==============================================================================
-- FASE 18 · Corregir graficas de ventas usando Ventas Netas
-- ==============================================================================
-- 
-- El problema: Las graficas de ventas del dashboard estaban sumando "total_global", 
-- el cual incluia el "efectivo de apertura" (base de caja) y las propinas, inflando
-- de forma significativa todas las graficas de ventas (casi 10M al mes extra).
-- 
-- La solucion: No modificamos la vista raiz v_turnos_pivote para no romper la 
-- pagina de conciliacion contable, sino que redefinimos los dos RPC del dashboard 
-- (dashboard_ventas y dashboard_ventas_responsable) para que calculen al vuelo 
-- la venta neta (venta_neta = total_global - apertura_sistema - propina_global) 
-- y agreguen / agrupen usando esta variable.
--
-- No hay DROP, ALTER TABLE, DELETE ni TRUNCATE. Solo CREATE OR REPLACE FUNCTION.
-- ==============================================================================

-- 1 · dashboard_ventas: usar venta_neta en lugar de total_global
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
    SELECT *, (COALESCE(total_global, 0) - COALESCE(apertura_sistema, 0) - COALESCE(propina_global, 0)) AS venta_neta
    FROM public.v_turnos_pivote
    WHERE fecha_turno >= p_desde AND fecha_turno <= p_hasta
      AND empresa_id = ANY (v_empresas)
  ),
  totales AS (
    SELECT
      SUM(venta_neta) AS total_ventas,
      SUM(efectivo_sistema) AS ventas_efectivo,
      SUM(datafono_sistema) AS ventas_datafono,
      SUM(transferencias_sistema) AS ventas_transferencias,
      SUM(rappi_sistema) AS ventas_rappi,
      SUM(nequi_sistema) AS ventas_nequi,
      SUM(bono_sistema) AS ventas_bono,
      SUM(gastos_turno) AS total_gastos,
      COUNT(*) AS total_turnos
    FROM turnos_filtrados
  ),
  evolucion_diaria AS (
    SELECT
      fecha_turno AS fecha,
      SUM(venta_neta) AS venta_dia,
      COUNT(*) AS turnos_dia
    FROM turnos_filtrados
    GROUP BY fecha_turno
    ORDER BY fecha_turno
  ),
  lista_turnos AS (
    SELECT
      fecha_turno, numero_turno, responsable_id,
      hora_inicio, hora_llegada,
      venta_neta AS venta_turno
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

-- 2 · dashboard_ventas_responsable: usar venta_neta en lugar de total_global
CREATE OR REPLACE FUNCTION public.dashboard_ventas_responsable(p_desde date, p_hasta date, p_empresa_id uuid DEFAULT NULL::uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY INVOKER
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
    SELECT COALESCE(public.app_nombre_responsable(responsable_id), 'Sin responsable') AS responsable,
           (COALESCE(total_global, 0) - COALESCE(apertura_sistema, 0) - COALESCE(propina_global, 0)) AS venta_neta
    FROM public.v_turnos_pivote
    WHERE fecha_turno >= p_desde AND fecha_turno <= p_hasta
      AND empresa_id = ANY (v_empresas)
  ),
  con_nombre AS (
    SELECT
      responsable,
      COUNT(*)                          AS turnos,
      SUM(venta_neta)                   AS venta_total,
      ROUND(SUM(venta_neta) / COUNT(*)) AS venta_por_turno
    FROM turnos_filtrados
    GROUP BY responsable
    ORDER BY venta_total DESC
  )
  SELECT json_build_object(
    'resumen', json_build_object(
       'responsables',  (SELECT COUNT(*) FROM con_nombre),
       'venta_total',   (SELECT COALESCE(SUM(venta_total), 0) FROM con_nombre),
       'turnos_total',  (SELECT COALESCE(SUM(turnos), 0) FROM con_nombre)
    ),
    'responsables', (SELECT COALESCE(json_agg(row_to_json(con_nombre.*)), '[]'::json) FROM con_nombre)
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$function$;

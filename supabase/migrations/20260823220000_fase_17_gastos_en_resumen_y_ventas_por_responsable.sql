-- ==============================================================================
-- FASE 17 · Gastos en el resumen de ventas + ventas por responsable de turno
-- ==============================================================================
--
-- Dos cambios, los dos ADITIVOS. Ninguna firma existente cambia, asi que
-- cualquier llamada actual sigue funcionando igual:
--
--   1. dashboard_ventas() gana dos campos en su bloque `resumen`:
--        total_gastos  -> suma de gastos del periodo
--        total_turnos  -> numero de turnos del periodo
--      El primero permite al navegador mostrar el efectivo BRUTO sin volver a
--      consultar. Recordar por que hace falta: el efectivo se guarda neto,
--        efectivo_sistema = apertura + Loggro - gastos del turno
--      asi que para ver "cuanto entro por cada medio de pago" hay que sumarle
--      los gastos de vuelta. Esto NO mete el gasto en la dona: devuelve el
--      efectivo a su valor real. El gasto sigue siendo gasto.
--
--   2. Funcion nueva dashboard_ventas_responsable(): ventas agrupadas por el
--      responsable del turno.
--
-- Sobre la granularidad (dia / semana / mes) de las graficas: se resuelve en el
-- navegador agregando el bloque `evolucion`, que ya viene por dia. Se decidio
-- asi a proposito para NO anadir un parametro a las funciones existentes: eso
-- crearia una sobrecarga con dos firmas conviviendo y PostgREST tendria que
-- desambiguar. Un ano son ~365 filas, unos 15 KB: agregarlas en el cliente es
-- trivial y no cuesta ni un viaje mas a la base.
--
-- No hay DROP, ALTER TABLE, DELETE, TRUNCATE ni UPDATE.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- 1 · dashboard_ventas: total_gastos y total_turnos en el resumen
-- ------------------------------------------------------------------------------
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
      SUM(bono_sistema) AS ventas_bono,
      -- NUEVO: para poder reconstruir el efectivo bruto en el navegador
      SUM(gastos_turno) AS total_gastos,
      COUNT(*) AS total_turnos
    FROM turnos_filtrados
  ),
  evolucion_diaria AS (
    SELECT
      fecha_turno AS fecha,
      SUM(total_global) AS venta_dia,
      COUNT(*) AS turnos_dia
    FROM turnos_filtrados
    GROUP BY fecha_turno
    ORDER BY fecha_turno
  ),
  lista_turnos AS (
    SELECT
      fecha_turno, numero_turno, responsable_id,
      hora_inicio, hora_llegada,
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


-- ------------------------------------------------------------------------------
-- 2 · dashboard_ventas_responsable: ventas por responsable de turno
-- ------------------------------------------------------------------------------
-- Mide las ventas de los turnos que cada persona tuvo A CARGO. No mide "lo que
-- vendio esa persona": en un restaurante vende el equipo y el responsable es
-- quien cerro el turno. El nombre de la seccion en pantalla lo refleja.
--
-- Devuelve total Y promedio por turno a proposito. Ordenar solo por total mide
-- sobre todo quien trabajo mas turnos: en julio de 2026, Saray de la Hoz es 4a
-- por venta total y 1a por venta por turno (12 turnos frente a 20 de otra).
--
-- Misma seguridad que las demas: app_es_admin(), arreglo de empresas visibles y
-- = ANY(...) para que el filtro llegue al indice.
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

  -- Se agrupa por el NOMBRE resuelto, no por responsable_id, porque la misma
  -- persona tiene un id distinto en cada sede (uno en usuarios_sistema y otro
  -- en usuarios_locales). Agrupando por id, Wendy Molina salia partida en
  -- 14 + 2 turnos y Tatiana Salas en 12 + 4, y el ranking quedaba mal.
  -- Contrapartida asumida: dos personas homonimas se sumarian como una. A la
  -- escala de un restaurante es el mal menor frente a partir a la misma persona.
  WITH turnos_filtrados AS (
    SELECT COALESCE(public.app_nombre_responsable(responsable_id), 'Sin responsable') AS responsable,
           total_global
    FROM public.v_turnos_pivote
    WHERE fecha_turno >= p_desde AND fecha_turno <= p_hasta
      AND empresa_id = ANY (v_empresas)
  ),
  con_nombre AS (
    SELECT
      responsable,
      COUNT(*)                            AS turnos,
      SUM(total_global)                   AS venta_total,
      ROUND(SUM(total_global) / COUNT(*)) AS venta_por_turno
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

GRANT EXECUTE ON FUNCTION public.dashboard_ventas_responsable(date, date, uuid) TO authenticated;

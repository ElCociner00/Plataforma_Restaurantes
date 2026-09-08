-- ==============================================================================
-- FASE 1: CIMIENTOS DE DASHBOARDS
-- ==============================================================================

-- 1. v_turnos_lineas: Unión de matriz y locales, aplicando DISTINCT ON
CREATE OR REPLACE VIEW "public"."v_turnos_lineas" AS
SELECT 
  id, empresa_id, fecha_turno, numero_turno, variable, categoria, valor, created_at,
  hora_inicio, hora_fin, hora_llegada,
  total_global, propina_global, domicilios_global, bolsa_global, caja_global, efectivo_apertura,
  responsable_id,
  false AS es_local
FROM (
  SELECT DISTINCT ON (empresa_id, fecha_turno, numero_turno, variable, categoria) *
  FROM "public"."cierres_turno_final"
  ORDER BY empresa_id, fecha_turno, numero_turno, variable, categoria, created_at DESC
) t
UNION ALL
SELECT 
  id, empresa_id, fecha_turno, numero_turno, variable, categoria, valor, created_at,
  hora_inicio, hora_fin, hora_llegada,
  total_global, propina_global, domicilios_global, bolsa_global, caja_global, efectivo_apertura,
  responsable_id,
  true AS es_local
FROM (
  SELECT DISTINCT ON (empresa_id, fecha_turno, numero_turno, variable, categoria) *
  FROM "public"."cierres_turno_final_locales"
  ORDER BY empresa_id, fecha_turno, numero_turno, variable, categoria, created_at DESC
) tl;

-- 2. Función auxiliar para parsear horas (12h/24h a TIME)
CREATE OR REPLACE FUNCTION "public"."parse_hora"(hora_str text)
RETURNS time AS $$
DECLARE
  parsed time;
BEGIN
  IF hora_str IS NULL OR hora_str = '' THEN RETURN NULL; END IF;
  BEGIN
    parsed := hora_str::time;
    RETURN parsed;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 3. v_turnos_pivote: Convertir modelo EAV a columnas con agregaciones
CREATE OR REPLACE VIEW "public"."v_turnos_pivote" AS
SELECT
  empresa_id, fecha_turno, numero_turno, es_local,
  MAX(responsable_id::text)::uuid AS responsable_id,
  parse_hora(MAX(hora_inicio)) AS hora_inicio,
  parse_hora(MAX(hora_llegada)) AS hora_llegada,
  
  -- Canales (sistema / real / diferencia = real - sistema)
  SUM(CASE WHEN variable = 'efectivo' AND categoria = 'sistema' THEN valor ELSE 0 END) AS efectivo_sistema,
  SUM(CASE WHEN variable = 'efectivo' AND categoria = 'real' THEN valor ELSE 0 END) AS efectivo_real,
  SUM(CASE WHEN variable = 'efectivo' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'efectivo' AND categoria = 'sistema' THEN valor ELSE 0 END) AS efectivo_dif,

  SUM(CASE WHEN variable = 'datafono' AND categoria = 'sistema' THEN valor ELSE 0 END) AS datafono_sistema,
  SUM(CASE WHEN variable = 'datafono' AND categoria = 'real' THEN valor ELSE 0 END) AS datafono_real,
  SUM(CASE WHEN variable = 'datafono' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'datafono' AND categoria = 'sistema' THEN valor ELSE 0 END) AS datafono_dif,

  SUM(CASE WHEN variable = 'transferencias' AND categoria = 'sistema' THEN valor ELSE 0 END) AS transferencias_sistema,
  SUM(CASE WHEN variable = 'transferencias' AND categoria = 'real' THEN valor ELSE 0 END) AS transferencias_real,
  SUM(CASE WHEN variable = 'transferencias' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'transferencias' AND categoria = 'sistema' THEN valor ELSE 0 END) AS transferencias_dif,

  SUM(CASE WHEN variable = 'rappi' AND categoria = 'sistema' THEN valor ELSE 0 END) AS rappi_sistema,
  SUM(CASE WHEN variable = 'rappi' AND categoria = 'real' THEN valor ELSE 0 END) AS rappi_real,
  SUM(CASE WHEN variable = 'rappi' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'rappi' AND categoria = 'sistema' THEN valor ELSE 0 END) AS rappi_dif,

  SUM(CASE WHEN variable = 'nequi' AND categoria = 'sistema' THEN valor ELSE 0 END) AS nequi_sistema,
  SUM(CASE WHEN variable = 'nequi' AND categoria = 'real' THEN valor ELSE 0 END) AS nequi_real,
  SUM(CASE WHEN variable = 'nequi' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'nequi' AND categoria = 'sistema' THEN valor ELSE 0 END) AS nequi_dif,

  SUM(CASE WHEN variable = 'bono_regalo' AND categoria = 'sistema' THEN valor ELSE 0 END) AS bono_sistema,
  SUM(CASE WHEN variable = 'bono_regalo' AND categoria = 'real' THEN valor ELSE 0 END) AS bono_real,
  SUM(CASE WHEN variable = 'bono_regalo' AND categoria = 'real' THEN valor ELSE 0 END) - SUM(CASE WHEN variable = 'bono_regalo' AND categoria = 'sistema' THEN valor ELSE 0 END) AS bono_dif,

  -- Descuadre global del turno (real - sistema de todos los canales)
  (SUM(CASE WHEN variable IN ('efectivo','datafono','transferencias','rappi','nequi','bono_regalo') AND categoria = 'real' THEN valor ELSE 0 END)
   - SUM(CASE WHEN variable IN ('efectivo','datafono','transferencias','rappi','nequi','bono_regalo') AND categoria = 'sistema' THEN valor ELSE 0 END)) AS descuadre_total,
  ((SUM(CASE WHEN variable IN ('efectivo','datafono','transferencias','rappi','nequi','bono_regalo') AND categoria = 'real' THEN valor ELSE 0 END)
   - SUM(CASE WHEN variable IN ('efectivo','datafono','transferencias','rappi','nequi','bono_regalo') AND categoria = 'sistema' THEN valor ELSE 0 END)) = 0) AS cuadrado,

  -- Globales (MAX para evitar multiplicaciones por el EAV)
  MAX(efectivo_apertura) AS apertura_sistema,
  MAX(caja_global) AS caja_global,
  MAX(total_global) AS total_global,
  MAX(propina_global) AS propina_global,
  MAX(domicilios_global) AS domicilios_global,
  MAX(bolsa_global) AS bolsa_global,

  -- Gastos de turno
  SUM(CASE WHEN variable = 'gasto_extra' THEN valor ELSE 0 END) AS gastos_turno,
  SUM(CASE WHEN variable = 'gasto_extra' AND (categoria = 'domicilios_clientes' OR categoria = 'cliente') THEN valor ELSE 0 END) AS domicilios_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND categoria = 'insumos' THEN valor ELSE 0 END) AS insumos_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND categoria = 'aseo' THEN valor ELSE 0 END) AS aseo_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND (categoria = 'general' OR categoria = 'operativo') THEN valor ELSE 0 END) AS general_coste
FROM "public"."v_turnos_lineas"
GROUP BY empresa_id, fecha_turno, numero_turno, es_local;

-- 4. Tabla y vista de estado de días (para revisar los días de 1 turno)
CREATE TABLE IF NOT EXISTS "public"."dias_operacion_estado" (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  empresa_id uuid NOT NULL,
  fecha_turno date NOT NULL,
  estado text NOT NULL CHECK (estado IN ('completo', 'falta_turno')),
  revisado_por uuid,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE (empresa_id, fecha_turno)
);

-- Habilitar RLS en dias_operacion_estado
ALTER TABLE "public"."dias_operacion_estado" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin check" ON "public"."dias_operacion_estado" FOR ALL USING (public.app_es_admin());

CREATE OR REPLACE VIEW "public"."v_dias_operacion" AS
WITH turnos_por_dia AS (
  SELECT 
    empresa_id, 
    fecha_turno, 
    COUNT(*) AS num_turnos, 
    SUM(total_global) AS venta_dia,
    EXTRACT(DOW FROM fecha_turno) AS dow
  FROM "public"."v_turnos_pivote"
  GROUP BY empresa_id, fecha_turno
),
medianas_dia AS (
  SELECT 
    empresa_id, 
    dow, 
    percentile_cont(0.5) WITHIN GROUP (ORDER BY venta_dia) AS mediana_venta
  FROM turnos_por_dia
  WHERE num_turnos > 1
  GROUP BY empresa_id, dow
)
SELECT 
  t.empresa_id, 
  t.fecha_turno, 
  t.num_turnos, 
  t.venta_dia,
  m.mediana_venta,
  CASE WHEN m.mediana_venta > 0 THEN (t.venta_dia / m.mediana_venta) ELSE 1 END AS porcentaje_mediana,
  e.estado AS estado_revisado,
  CASE 
    WHEN t.num_turnos > 1 THEN 'completo'
    WHEN e.estado IS NOT NULL THEN e.estado
    WHEN m.mediana_venta IS NULL THEN 'completo_sugerido'
    WHEN (t.venta_dia / m.mediana_venta) >= 0.85 THEN 'completo_sugerido'
    WHEN (t.venta_dia / m.mediana_venta) >= 0.65 THEN 'dudoso'
    ELSE 'falta_turno_sugerido'
  END AS sugerencia
FROM turnos_por_dia t
LEFT JOIN medianas_dia m ON t.empresa_id = m.empresa_id AND t.dow = m.dow
LEFT JOIN "public"."dias_operacion_estado" e ON t.empresa_id = e.empresa_id AND t.fecha_turno = e.fecha_turno;

-- 5. RPC dashboard_sedes()
CREATE OR REPLACE FUNCTION public.dashboard_sedes()
 RETURNS TABLE(id uuid, nombre text, tipo text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_empresas uuid[];
BEGIN
  v_empresas := ARRAY(SELECT public.app_empresas_visibles());

  RETURN QUERY
  SELECT e.id,
         COALESCE(NULLIF(btrim(e.nombre_comercial), ''),
                  NULLIF(btrim(e.razon_social), ''),
                  'Sin nombre')::text,
         (CASE WHEN EXISTS (SELECT 1
                            FROM public.grupos_empresariales ge
                            WHERE ge.empresa_id = e.id
                              AND COALESCE(ge.activo, true))
               THEN 'local' ELSE 'principal' END)::text
  FROM public.empresas e
  WHERE e.id = ANY (v_empresas)
  ORDER BY 3 DESC, 2;
END;
$function$;



-- 6. RPC dashboard_dias_pendientes()
CREATE OR REPLACE FUNCTION public.dashboard_dias_pendientes(p_empresa_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(empresa_id uuid, fecha_turno date, venta_dia numeric, sugerencia text)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_empresas uuid[];
BEGIN
  IF NOT public.app_es_admin() THEN
    RETURN;
  END IF;

  v_empresas := ARRAY(SELECT public.app_empresas_visibles());

  IF p_empresa_id IS NOT NULL THEN
    v_empresas := CASE WHEN p_empresa_id = ANY (v_empresas)
                       THEN ARRAY[p_empresa_id]
                       ELSE ARRAY[]::uuid[] END;
  END IF;

  RETURN QUERY
  SELECT v.empresa_id, v.fecha_turno, v.venta_dia, v.sugerencia
  FROM public.v_dias_operacion v
  WHERE v.num_turnos = 1
    AND v.estado_revisado IS NULL
    AND v.empresa_id = ANY (v_empresas);
END;
$function$;



-- 7. RPC marcar_dia_operacion()
CREATE OR REPLACE FUNCTION "public"."marcar_dia_operacion"(p_empresa_id uuid, p_fecha date, p_estado text)
RETURNS void
SECURITY INVOKER AS $$
BEGIN
  IF NOT "public"."app_es_admin"() THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  
  INSERT INTO "public"."dias_operacion_estado" (empresa_id, fecha_turno, estado, revisado_por)
  VALUES (p_empresa_id, p_fecha, p_estado, auth.uid())
  ON CONFLICT (empresa_id, fecha_turno) 
  DO UPDATE SET estado = EXCLUDED.estado, revisado_por = EXCLUDED.revisado_por;
END;
$$ LANGUAGE plpgsql;

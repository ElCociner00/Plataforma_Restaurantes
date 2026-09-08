-- ==============================================================================
-- FASE 16: DOS CORRECCIONES EN LAS VISTAS DE TURNOS
-- ==============================================================================
--
-- (1) v_turnos_lineas dejaba fuera 123 lineas de gasto legitimas
--
--     El DISTINCT ON se puso en la fase 12 para neutralizar los envios
--     repetidos: cuando alguien pulsaba "Enviar" dos veces, el cierre entero se
--     insertaba otra vez dentro del mismo turno. Se quedaba con la linea mas
--     reciente de cada (turno, variable, categoria).
--
--     Para los canales eso es correcto: hay exactamente una linea por
--     combinacion. Para gasto_extra NO: un turno puede tener dos gastos de
--     insumos legitimos. La propia base lo permite a proposito — el indice
--     unico ux_..._identidad es PARCIAL, lleva WHERE variable <> 'gasto_extra'
--     justamente para no bloquearlos.
--
--     Medido antes de este cambio:
--         filas de gasto_extra en las tablas  2.016
--         filas que veia la vista             1.893   (-123)
--         suma de gastos en las tablas   19.548.562
--         suma que veia el pivote        19.498.162   (-50.400)
--
--     Arreglo: deduplicar solo las filas que NO son gasto_extra, y traer las de
--     gasto tal cual. Comprobado que no hay filas con variable NULL, asi que
--     <> basta y no hace falta IS DISTINCT FROM.
--
-- (2) v_turnos_pivote se quedaba con el valor MAYOR, no con el mas reciente
--
--     Las columnas globales del turno (total, caja, propina, domicilios, bolsa,
--     apertura) vienen repetidas en cada linea del turno, asi que hay que
--     colapsarlas. Se hacia con MAX(), y MAX no significa "el ultimo".
--
--     Caso real: BATUT LE MERIDIEM, 2026-06-10 turno 1. Se subio a las 20:17
--     con total 1.185.400 y se corrigio a las 20:20 a 1.155.900, pero dos
--     lineas del primer envio sobrevivieron (eran combinaciones que el segundo
--     envio no traia). MAX se quedaba con 1.185.400: 29.500 de mas.
--
--     Acertaria solo si las correcciones fueran siempre hacia arriba. Es
--     aleatorio.
--
--     Arreglo: tomar el valor de la linea mas reciente por created_at,
--     ignorando los nulos para no perder un valor cuando la ultima linea no lo
--     trae:
--         (array_agg(x ORDER BY created_at DESC) FILTER (WHERE x IS NOT NULL))[1]
--
--     NO se tocan en esta migracion, aunque tienen el mismo defecto:
--       - responsable_id, que usa MAX(responsable_id::text)
--       - hora_inicio y hora_llegada, que usan MAX() sobre texto
--     Quedan anotados para decidirlos aparte.
--
-- Solo CREATE OR REPLACE VIEW. No se altera ningun registro.
-- ==============================================================================


-- ------------------------------------------------------------------------------
-- (1) v_turnos_lineas
-- ------------------------------------------------------------------------------
CREATE OR REPLACE VIEW "public"."v_turnos_lineas" AS
SELECT
  id, empresa_id, fecha_turno, numero_turno, variable, categoria, valor, created_at,
  hora_inicio, hora_fin, hora_llegada,
  total_global, propina_global, domicilios_global, bolsa_global, caja_global, efectivo_apertura,
  responsable_id,
  false AS es_local
FROM (
  -- canales y demas: un envio repetido se colapsa al mas reciente
  (SELECT DISTINCT ON (empresa_id, fecha_turno, numero_turno, variable, categoria) *
   FROM "public"."cierres_turno_final"
   WHERE variable <> 'gasto_extra'
   ORDER BY empresa_id, fecha_turno, numero_turno, variable, categoria, created_at DESC)
  UNION ALL
  -- gastos: varias lineas por categoria son legitimas, pasan enteras
  (SELECT *
   FROM "public"."cierres_turno_final"
   WHERE variable = 'gasto_extra')
) t
UNION ALL
SELECT
  id, empresa_id, fecha_turno, numero_turno, variable, categoria, valor, created_at,
  hora_inicio, hora_fin, hora_llegada,
  total_global, propina_global, domicilios_global, bolsa_global, caja_global, efectivo_apertura,
  responsable_id,
  true AS es_local
FROM (
  (SELECT DISTINCT ON (empresa_id, fecha_turno, numero_turno, variable, categoria) *
   FROM "public"."cierres_turno_final_locales"
   WHERE variable <> 'gasto_extra'
   ORDER BY empresa_id, fecha_turno, numero_turno, variable, categoria, created_at DESC)
  UNION ALL
  (SELECT *
   FROM "public"."cierres_turno_final_locales"
   WHERE variable = 'gasto_extra')
) tl;


-- ------------------------------------------------------------------------------
-- (2) v_turnos_pivote
-- ------------------------------------------------------------------------------
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

  -- Globales del turno: el valor de la linea MAS RECIENTE, no el mayor.
  -- (fase 16; antes era MAX() y se quedaba con correcciones obsoletas)
  (array_agg(efectivo_apertura  ORDER BY created_at DESC) FILTER (WHERE efectivo_apertura  IS NOT NULL))[1] AS apertura_sistema,
  (array_agg(caja_global        ORDER BY created_at DESC) FILTER (WHERE caja_global        IS NOT NULL))[1] AS caja_global,
  (array_agg(total_global       ORDER BY created_at DESC) FILTER (WHERE total_global       IS NOT NULL))[1] AS total_global,
  (array_agg(propina_global     ORDER BY created_at DESC) FILTER (WHERE propina_global     IS NOT NULL))[1] AS propina_global,
  (array_agg(domicilios_global  ORDER BY created_at DESC) FILTER (WHERE domicilios_global  IS NOT NULL))[1] AS domicilios_global,
  (array_agg(bolsa_global       ORDER BY created_at DESC) FILTER (WHERE bolsa_global       IS NOT NULL))[1] AS bolsa_global,

  -- Gastos de turno
  SUM(CASE WHEN variable = 'gasto_extra' THEN valor ELSE 0 END) AS gastos_turno,
  SUM(CASE WHEN variable = 'gasto_extra' AND (categoria = 'domicilios_clientes' OR categoria = 'cliente') THEN valor ELSE 0 END) AS domicilios_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND categoria = 'insumos' THEN valor ELSE 0 END) AS insumos_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND categoria = 'aseo' THEN valor ELSE 0 END) AS aseo_coste,
  SUM(CASE WHEN variable = 'gasto_extra' AND (categoria = 'general' OR categoria = 'operativo') THEN valor ELSE 0 END) AS general_coste
FROM "public"."v_turnos_lineas"
GROUP BY empresa_id, fecha_turno, numero_turno, es_local;

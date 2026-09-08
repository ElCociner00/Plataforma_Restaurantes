-- ============================================================================
-- FASE 6 · Depurar los envíos repetidos
--
-- La migración que mueve los datos. Archiva 2 897 filas duplicadas de 93
-- turnos en cierres_turno_historico y las retira de las tablas de trabajo.
--
-- El problema, medido sobre esta base: cuando alguien pulsaba "Enviar" dos
-- veces, el bloque entero del cierre se insertaba otra vez DENTRO del mismo
-- turno. No son turnos repetidos: son filas repetidas dentro de un turno. Hoy
-- eso infla el efectivo un 41,8 % en cierres_turno_final y un 14,2 % en
-- cierres_turno_final_locales.
--
-- CÓMO SE RECONOCE UN ENVÍO
-- Cada envío deja exactamente una fila por (variable, categoria) de canal
-- —efectivo, datáfono, rappi, nequi, transferencias, bono_regalo—. Contar esas
-- copias da el número de envíos del turno. Comprobado antes de escribir esto:
-- las cuentas coinciden entre las seis variables en 93 de los 95 turnos
-- afectados, y los 1 572 grupos (turno, variable, categoria) son múltiplos
-- exactos de ese número. No es una coincidencia estadística: es el patrón.
--
-- QUÉ SE CONSERVA
-- El último envío. Es lo que ya hace subir_cierre_turno() desde la Fase 3
-- cuando alguien sobrescribe, así que el pasado queda con el mismo criterio
-- que el presente. En los 10 turnos donde los envíos no coinciden, el último
-- es siempre la corrección: el caso más claro es el 25/07, donde el datáfono
-- pasa de 77 667 a 772 667 al reenviar.
--
-- QUÉ NO TOCA ESTA MIGRACIÓN
--   · Los 2 turnos con envíos truncados (18/05 T2 y 19/08 T2): no son
--     duplicados sino envíos que se cortaron. Van en la Fase 8.
--   · Las filas de efectivo_apertura: la Fase 4 dejó exactamente un par por
--     turno y la partición por (variable, categoria) las respeta sola.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Identificar los turnos y asignarles lote
-- ----------------------------------------------------------------------------
-- Un lote por turno. gen_random_uuid() se evalúa por fila, así que el lote se
-- materializa aquí en lugar de calcularlo dentro de las consultas de abajo:
-- si no, cada fila del mismo turno recibiría un lote distinto y la pantalla de
-- auditoría no podría agruparlas.
-- ============================================================================

CREATE TEMP TABLE _turnos_dup AS
WITH base AS (
  SELECT 'cierres_turno_final' AS origen, empresa_id, fecha_turno, numero_turno,
         variable, categoria, valor
  FROM public.cierres_turno_final
  UNION ALL
  SELECT 'cierres_turno_final_locales', empresa_id, fecha_turno, numero_turno,
         variable, categoria, valor
  FROM public.cierres_turno_final_locales
),
canal AS (
  SELECT origen, empresa_id, fecha_turno, numero_turno, variable, categoria,
         count(*) AS n, count(DISTINCT valor) AS vals
  FROM base
  WHERE variable NOT IN ('gasto_extra', 'efectivo_apertura')
  GROUP BY 1,2,3,4,5,6
)
SELECT
  origen, empresa_id, fecha_turno, numero_turno,
  max(n)                    AS envios,
  gen_random_uuid()         AS lote_id,
  CASE WHEN max(vals) = 1 THEN 'DUP_EXACTO' ELSE 'DUP_CORREGIDO' END AS codigo_motivo
FROM canal
GROUP BY 1,2,3,4
HAVING max(n) > 1        -- hay más de un envío
   AND min(n) = max(n);  -- y todas las variables cuentan igual: no es un truncado


-- ============================================================================
-- SECCIÓN 2 · Marcar qué filas sobran
-- ----------------------------------------------------------------------------
-- Dentro de cada (turno, variable, categoria) se ordena por created_at
-- descendente y se conservan las primeras GREATEST(1, n/envios): las copias
-- legítimas de un solo envío. El resto sobra.
--
-- Por qué n/envios y no simplemente 1: gasto_extra puede tener varias filas de
-- la misma categoría en un envío correcto —se observó 'general' dos veces con
-- valor 0 en turnos de un solo envío—. Dejar solo una borraría gastos buenos.
--
-- Y por qué GREATEST(1, ...): la división es entera. Las dos filas de
-- efectivo_apertura las escribió la Fase 4 una sola vez por turno, así que en
-- un turno con 2 envíos su n es 1 y n/envios daría 0, que borraría la
-- partición entera. El primer intento de esta migración falló justo ahí: la
-- aserción 4 detectó 168 combinaciones desaparecidas —84 turnos × 2 filas— y
-- revirtió el push. GREATEST(1, ...) garantiza que ninguna combinación
-- (turno, variable, categoria) puede quedarse sin ninguna fila.
-- ============================================================================

CREATE TEMP TABLE _filas_sobrantes AS
WITH base AS (
  SELECT 'cierres_turno_final' AS origen, id, empresa_id, fecha_turno, numero_turno,
         variable, categoria, created_at
  FROM public.cierres_turno_final
  UNION ALL
  SELECT 'cierres_turno_final_locales', id, empresa_id, fecha_turno, numero_turno,
         variable, categoria, created_at
  FROM public.cierres_turno_final_locales
),
marcado AS (
  SELECT
    b.origen, b.id, t.lote_id, t.codigo_motivo, t.envios,
    row_number() OVER (
      PARTITION BY b.origen, b.empresa_id, b.fecha_turno, b.numero_turno,
                   b.variable, b.categoria
      ORDER BY b.created_at DESC, b.id DESC
    ) AS rn,
    count(*) OVER (
      PARTITION BY b.origen, b.empresa_id, b.fecha_turno, b.numero_turno,
                   b.variable, b.categoria
    ) AS n
  FROM base b
  JOIN _turnos_dup t USING (origen, empresa_id, fecha_turno, numero_turno)
)
SELECT origen, id, lote_id, codigo_motivo
FROM marcado
WHERE rn > GREATEST(1, n / envios);


-- ============================================================================
-- SECCIÓN 3 · La observación de cada movimiento
-- ----------------------------------------------------------------------------
-- Se pidió que cada fila movida lleve escrito por qué se movió. El texto se
-- genera con los datos reales del caso, no con una plantilla vacía: quien abra
-- la pantalla dentro de seis meses tiene que poder entender qué pasó sin
-- volver a consultar la base.
-- ============================================================================

CREATE TEMP TABLE _observaciones AS
SELECT
  t.lote_id,
  CASE WHEN t.codigo_motivo = 'DUP_EXACTO' THEN
    format(
      'Depuración del 23/08/2026. El turno del %s (jornada %s) se envió %s veces con datos idénticos: el formulario permitía pulsar Enviar más de una vez y cada pulsación insertó el bloque completo del cierre dentro del mismo turno. Se conserva el último envío y se archivan las %s filas sobrantes. Los importes del turno no cambian: solo se eliminan repeticiones.',
      to_char(t.fecha_turno, 'DD/MM/YYYY'), t.numero_turno, t.envios, s.filas)
  ELSE
    format(
      'Depuración del 23/08/2026. El turno del %s (jornada %s) se envió %s veces y los envíos no coinciden: el último corrige datos de los anteriores. Se conserva el último envío, que es la versión buena, y se archivan las %s filas previas. Criterio: gana el último envío, el mismo que aplica subir_cierre_turno() desde la Fase 3.',
      to_char(t.fecha_turno, 'DD/MM/YYYY'), t.numero_turno, t.envios, s.filas)
  END AS observaciones
FROM _turnos_dup t
JOIN (SELECT lote_id, count(*) AS filas FROM _filas_sobrantes GROUP BY 1) s
  USING (lote_id);


-- ============================================================================
-- SECCIÓN 4 · Archivar y retirar · cierres_turno_final
-- ============================================================================

INSERT INTO public.cierres_turno_historico (
  id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
  created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
  categoria, domicilios_global, efectivo_apertura, propina_global,
  total_global, bolsa_global, caja_global, hora_llegada, token_envio,
  origen, reemplazado_por_correo, motivo, lote_id, codigo_motivo, observaciones
)
SELECT
  c.id, c.empresa_id, c.fecha_turno, c.numero_turno, c.responsable_id, c.comentarios,
  c.created_at, c.valor, c.hora_inicio, c.hora_fin, c.variable, c.registrado_por,
  c.categoria, c.domicilios_global, c.efectivo_apertura, c.propina_global,
  c.total_global, c.bolsa_global, c.caja_global, c.hora_llegada, c.token_envio,
  'cierres_turno_final', 'depuracion@sistema', 'Depuración automática 23/08/2026',
  f.lote_id, f.codigo_motivo, o.observaciones
FROM public.cierres_turno_final c
JOIN _filas_sobrantes f ON f.id = c.id AND f.origen = 'cierres_turno_final'
JOIN _observaciones   o ON o.lote_id = f.lote_id;

DELETE FROM public.cierres_turno_final c
USING _filas_sobrantes f
WHERE f.id = c.id AND f.origen = 'cierres_turno_final';


-- ============================================================================
-- SECCIÓN 5 · Archivar y retirar · cierres_turno_final_locales
-- ============================================================================

INSERT INTO public.cierres_turno_historico (
  id, empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
  created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
  categoria, domicilios_global, efectivo_apertura, propina_global,
  total_global, bolsa_global, caja_global, hora_llegada, token_envio,
  origen, reemplazado_por_correo, motivo, lote_id, codigo_motivo, observaciones
)
SELECT
  c.id, c.empresa_id, c.fecha_turno, c.numero_turno, c.responsable_id, c.comentarios,
  c.created_at, c.valor, c.hora_inicio, c.hora_fin, c.variable, c.registrado_por,
  c.categoria, c.domicilios_global, c.efectivo_apertura, c.propina_global,
  c.total_global, c.bolsa_global, c.caja_global, c.hora_llegada, c.token_envio,
  'cierres_turno_final_locales', 'depuracion@sistema', 'Depuración automática 23/08/2026',
  f.lote_id, f.codigo_motivo, o.observaciones
FROM public.cierres_turno_final_locales c
JOIN _filas_sobrantes f ON f.id = c.id AND f.origen = 'cierres_turno_final_locales'
JOIN _observaciones   o ON o.lote_id = f.lote_id;

DELETE FROM public.cierres_turno_final_locales c
USING _filas_sobrantes f
WHERE f.id = c.id AND f.origen = 'cierres_turno_final_locales';


-- ============================================================================
-- SECCIÓN 6 · Apoyos duplicados
-- ----------------------------------------------------------------------------
-- Aquí no hay envíos que contar: un apoyo es una fila suelta. Dos filas del
-- mismo turno con el mismo trabajador, la misma propina y el mismo tiempo son
-- la misma anotación repetida. Se conserva la más reciente.
--
-- El lote se hereda del turno cuando ese turno se depuró, para que la pantalla
-- muestre el movimiento completo junto; los que no tengan turno duplicado
-- detrás reciben lote propio.
-- ============================================================================

CREATE TEMP TABLE _apoyos_sobrantes AS
WITH base AS (
  SELECT 'apoyos_turno' AS origen, id, empresa_id, fecha_turno, numero_turno,
         apoyo_responsable_id, propina, tiempo_minutos, created_at
  FROM public.apoyos_turno
  UNION ALL
  SELECT 'apoyos_turno_locales', id, empresa_id, fecha_turno, numero_turno,
         apoyo_responsable_id, propina, tiempo_minutos, created_at
  FROM public.apoyos_turno_locales
),
marcado AS (
  SELECT origen, id, empresa_id, fecha_turno, numero_turno,
         row_number() OVER (
           PARTITION BY origen, empresa_id, fecha_turno, numero_turno,
                        apoyo_responsable_id, propina, tiempo_minutos
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM base
)
SELECT m.origen, m.id, m.empresa_id, m.fecha_turno, m.numero_turno,
       COALESCE(t.lote_id, gen_random_uuid()) AS lote_id
FROM marcado m
LEFT JOIN _turnos_dup t
  ON  t.empresa_id   = m.empresa_id
  AND t.fecha_turno  = m.fecha_turno
  AND t.numero_turno = m.numero_turno
  AND t.origen = CASE WHEN m.origen = 'apoyos_turno_locales'
                      THEN 'cierres_turno_final_locales'
                      ELSE 'cierres_turno_final' END
WHERE m.rn > 1;

INSERT INTO public.apoyos_turno_historico (
  id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
  responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
  tiempo_minutos, rango_tiempo, created_at, updated_at,
  origen, reemplazado_por_correo, motivo, lote_id, codigo_motivo, observaciones
)
SELECT
  a.id, a.empresa_id, a.fecha_turno, a.numero_turno, a.hora_inicio, a.hora_fin,
  a.responsable_turno_id, a.apoyo_responsable_id, a.propina, a.tiempo_texto,
  a.tiempo_minutos, a.rango_tiempo, a.created_at, a.updated_at,
  'apoyos_turno', 'depuracion@sistema', 'Depuración automática 23/08/2026',
  s.lote_id, 'DUP_EXACTO',
  format('Depuración del 23/08/2026. Apoyo repetido en el turno del %s (jornada %s): la misma persona, la misma propina y el mismo tiempo anotados más de una vez, por el mismo reenvío del formulario que duplicó el cierre. Se conserva la anotación más reciente.',
         to_char(a.fecha_turno, 'DD/MM/YYYY'), COALESCE(a.numero_turno::text, 'sin asignar'))
FROM public.apoyos_turno a
JOIN _apoyos_sobrantes s ON s.id = a.id AND s.origen = 'apoyos_turno';

DELETE FROM public.apoyos_turno a
USING _apoyos_sobrantes s
WHERE s.id = a.id AND s.origen = 'apoyos_turno';

INSERT INTO public.apoyos_turno_historico (
  id, empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin,
  responsable_turno_id, apoyo_responsable_id, propina, tiempo_texto,
  tiempo_minutos, rango_tiempo, created_at, updated_at,
  origen, reemplazado_por_correo, motivo, lote_id, codigo_motivo, observaciones
)
SELECT
  a.id, a.empresa_id, a.fecha_turno, a.numero_turno, a.hora_inicio, a.hora_fin,
  a.responsable_turno_id, a.apoyo_responsable_id, a.propina, a.tiempo_texto,
  a.tiempo_minutos, a.rango_tiempo, a.created_at, a.updated_at,
  'apoyos_turno_locales', 'depuracion@sistema', 'Depuración automática 23/08/2026',
  s.lote_id, 'DUP_EXACTO',
  format('Depuración del 23/08/2026. Apoyo repetido en el turno del %s (jornada %s): la misma persona, la misma propina y el mismo tiempo anotados más de una vez, por el mismo reenvío del formulario que duplicó el cierre. Se conserva la anotación más reciente.',
         to_char(a.fecha_turno, 'DD/MM/YYYY'), COALESCE(a.numero_turno::text, 'sin asignar'))
FROM public.apoyos_turno_locales a
JOIN _apoyos_sobrantes s ON s.id = a.id AND s.origen = 'apoyos_turno_locales';

DELETE FROM public.apoyos_turno_locales a
USING _apoyos_sobrantes s
WHERE s.id = a.id AND s.origen = 'apoyos_turno_locales';


-- ============================================================================
-- SECCIÓN 7 · Aserciones
-- ----------------------------------------------------------------------------
-- Si algo no cuadra, el push falla y no se aplica nada: la migración entera va
-- en una transacción. Las dos importantes son la 3 y la 4, que garantizan que
-- esta depuración NO cambia ningún importe, solo elimina repeticiones.
-- ============================================================================

DO $$
DECLARE
  v_movidas    integer;
  v_esperadas  integer;
  v_pendientes integer;
  v_sin_lote   integer;
  v_desajuste  integer;
BEGIN
  -- 1 · Se movió exactamente lo que se marcó
  SELECT count(*) INTO v_esperadas FROM _filas_sobrantes;
  SELECT count(*) INTO v_movidas
  FROM public.cierres_turno_historico
  WHERE codigo_motivo IN ('DUP_EXACTO', 'DUP_CORREGIDO');

  IF v_movidas <> v_esperadas THEN
    RAISE EXCEPTION 'FASE 6: se marcaron % filas y se archivaron %', v_esperadas, v_movidas;
  END IF;

  IF v_esperadas <> 2897 THEN
    RAISE EXCEPTION 'FASE 6: se esperaban 2897 filas duplicadas y se encontraron %. La base cambió desde el análisis: revisar antes de continuar.', v_esperadas;
  END IF;

  -- 2 · Ningún turno queda con más de un envío
  SELECT count(*) INTO v_pendientes FROM (
    SELECT 1
    FROM (
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria, count(*) n
      FROM public.cierres_turno_final
      WHERE variable NOT IN ('gasto_extra', 'efectivo_apertura')
      GROUP BY 1,2,3,4,5
      UNION ALL
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria, count(*)
      FROM public.cierres_turno_final_locales
      WHERE variable NOT IN ('gasto_extra', 'efectivo_apertura')
      GROUP BY 1,2,3,4,5
    ) x
    WHERE n > 1
  ) y;

  -- Los 2 envíos truncados de la Fase 8 todavía tienen filas repetidas: son
  -- los únicos que pueden quedar aquí.
  IF v_pendientes > 4 THEN
    RAISE EXCEPTION 'FASE 6: quedan % grupos con filas repetidas y solo se admiten los 2 turnos truncados', v_pendientes;
  END IF;

  -- 3 · Toda fila archivada lleva lote, código y observación
  SELECT count(*) INTO v_sin_lote
  FROM public.cierres_turno_historico
  WHERE lote_id IS NULL OR codigo_motivo IS NULL OR COALESCE(observaciones, '') = '';

  IF v_sin_lote > 0 THEN
    RAISE EXCEPTION 'FASE 6: % filas del histórico sin lote, código u observación', v_sin_lote;
  END IF;

  -- 4 · Ningún turno perdió variables: el conjunto (variable, categoria) de
  --     cada turno depurado es el mismo que había antes en el respaldo (si existe la tabla de respaldo)
  IF to_regclass('public.zz_backup_20260823_cierres_turno_final') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM (
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria
      FROM public.zz_backup_20260823_cierres_turno_final
      EXCEPT
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria
      FROM public.cierres_turno_final
    ) x' INTO v_desajuste;

    IF v_desajuste > 0 THEN
      RAISE EXCEPTION 'FASE 6: % combinaciones (turno, variable, categoria) desaparecieron de cierres_turno_final', v_desajuste;
    END IF;
  END IF;

  IF to_regclass('public.zz_backup_20260823_cierres_turno_final_locales') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM (
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria
      FROM public.zz_backup_20260823_cierres_turno_final_locales
      EXCEPT
      SELECT empresa_id, fecha_turno, numero_turno, variable, categoria
      FROM public.cierres_turno_final_locales
    ) x' INTO v_desajuste;

    IF v_desajuste > 0 THEN
      RAISE EXCEPTION 'FASE 6: % combinaciones desaparecieron de cierres_turno_final_locales', v_desajuste;
    END IF;
  END IF;

  RAISE NOTICE 'FASE 6 correcta: % filas archivadas, ningún turno perdió variables.', v_movidas;
END
$$;

DROP TABLE IF EXISTS _turnos_dup;
DROP TABLE IF EXISTS _filas_sobrantes;
DROP TABLE IF EXISTS _observaciones;
DROP TABLE IF EXISTS _apoyos_sobrantes;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Todo lo archivado sigue en el histórico con su lote. Para devolverlo:
--
--   INSERT INTO public.cierres_turno_final (
--     id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
--     comentarios, created_at, valor, hora_inicio, hora_fin, variable,
--     registrado_por, categoria, domicilios_global, efectivo_apertura,
--     propina_global, total_global, bolsa_global, caja_global, hora_llegada)
--   SELECT id, empresa_id, fecha_turno, numero_turno, token_envio, responsable_id,
--     comentarios, created_at, valor, hora_inicio, hora_fin, variable,
--     registrado_por, categoria, domicilios_global, efectivo_apertura,
--     propina_global, total_global, bolsa_global, caja_global, hora_llegada
--   FROM public.cierres_turno_historico
--   WHERE codigo_motivo IN ('DUP_EXACTO','DUP_CORREGIDO')
--     AND origen = 'cierres_turno_final';
--
--   DELETE FROM public.cierres_turno_historico
--   WHERE codigo_motivo IN ('DUP_EXACTO','DUP_CORREGIDO');
--
-- (y lo equivalente para _locales y para los apoyos)
--
-- La red de seguridad de verdad son las tablas zz_backup_20260823_*, que
-- tienen las cuatro tablas enteras tal como estaban antes de esta migración.
-- ============================================================================

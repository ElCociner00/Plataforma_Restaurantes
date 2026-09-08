-- ============================================================================
-- FASE 2 · Numeración de los turnos existentes
--
-- Regla acordada con el dueño del producto: el turno 1 es el PRIMER cierre
-- subido del día y el turno 2 el segundo, sin importar la hora. Se ordena por
-- el created_at más antiguo de cada turno.
--
-- Comprobado sobre el volcado: en 143 de los 145 días con dos turnos ese orden
-- coincide con el orden por hora de inicio. En 2 días la persona del turno de
-- mañana subió su cierre después que la de la tarde, así que quedan numerados
-- al revés. Se listan al final para revisión manual en lugar de forzar una
-- excepción automática.
--
-- El índice único de la clave nueva NO se activa aquí: 10 días tienen 3 o 4
-- registros y colisionarían. Primero hay que analizarlos (sección 4), y el
-- índice se activa en una migración posterior, ya con los datos limpios.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Ampliar el rango admitido
-- ----------------------------------------------------------------------------
-- 1 y 2 son las jornadas reales. Del 3 en adelante marca turnos pendientes de
-- análisis: son los duplicados que la clave vieja dejó pasar. Sin este margen
-- habría que descartarlos, y la instrucción fue conservarlos para revisarlos.
-- ============================================================================

ALTER TABLE public.cierres_turno_final
  DROP CONSTRAINT IF EXISTS cierres_turno_final_numero_turno_check;
ALTER TABLE public.cierres_turno_final
  ADD CONSTRAINT cierres_turno_final_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 9);

ALTER TABLE public.cierres_turno_final_locales
  DROP CONSTRAINT IF EXISTS cierres_turno_final_locales_numero_turno_check;
ALTER TABLE public.cierres_turno_final_locales
  ADD CONSTRAINT cierres_turno_final_locales_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 9);

ALTER TABLE public.apoyos_turno
  DROP CONSTRAINT IF EXISTS apoyos_turno_numero_turno_check;
ALTER TABLE public.apoyos_turno
  ADD CONSTRAINT apoyos_turno_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 9);

ALTER TABLE public.apoyos_turno_locales
  DROP CONSTRAINT IF EXISTS apoyos_turno_locales_numero_turno_check;
ALTER TABLE public.apoyos_turno_locales
  ADD CONSTRAINT apoyos_turno_locales_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 9);


-- ============================================================================
-- SECCIÓN 2 · Backfill de cierres_turno_final
-- ----------------------------------------------------------------------------
-- Un turno, en el modelo viejo, es la combinación
-- (empresa_id, fecha_turno, hora_inicio, responsable_id).
-- Se numeran por orden de primer envío dentro de cada (empresa, fecha).
-- ============================================================================

WITH turnos AS (
  SELECT
    empresa_id,
    fecha_turno,
    hora_inicio,
    responsable_id,
    MIN(created_at) AS primer_envio
  FROM public.cierres_turno_final
  GROUP BY empresa_id, fecha_turno, hora_inicio, responsable_id
),
numerados AS (
  SELECT
    empresa_id, fecha_turno, hora_inicio, responsable_id,
    ROW_NUMBER() OVER (
      PARTITION BY empresa_id, fecha_turno
      ORDER BY primer_envio, hora_inicio
    )::smallint AS n
  FROM turnos
)
UPDATE public.cierres_turno_final c
SET numero_turno = x.n
FROM numerados x
WHERE c.empresa_id     = x.empresa_id
  AND c.fecha_turno    = x.fecha_turno
  AND c.hora_inicio    = x.hora_inicio
  AND c.responsable_id = x.responsable_id
  AND c.numero_turno IS NULL;


-- ============================================================================
-- SECCIÓN 3 · Backfill de cierres_turno_final_locales
-- ============================================================================

WITH turnos AS (
  SELECT
    empresa_id, fecha_turno, hora_inicio, responsable_id,
    MIN(created_at) AS primer_envio
  FROM public.cierres_turno_final_locales
  GROUP BY empresa_id, fecha_turno, hora_inicio, responsable_id
),
numerados AS (
  SELECT
    empresa_id, fecha_turno, hora_inicio, responsable_id,
    ROW_NUMBER() OVER (
      PARTITION BY empresa_id, fecha_turno
      ORDER BY primer_envio, hora_inicio
    )::smallint AS n
  FROM turnos
)
UPDATE public.cierres_turno_final_locales c
SET numero_turno = x.n
FROM numerados x
WHERE c.empresa_id     = x.empresa_id
  AND c.fecha_turno    = x.fecha_turno
  AND c.hora_inicio    = x.hora_inicio
  AND c.responsable_id = x.responsable_id
  AND c.numero_turno IS NULL;


-- ============================================================================
-- SECCIÓN 4 · Backfill de los apoyos
-- ----------------------------------------------------------------------------
-- Los apoyos no tienen responsable_id del turno con el mismo nombre, así que
-- se enganchan por (empresa_id, fecha_turno, hora_inicio) contra el cierre ya
-- numerado. Los que no encuentren pareja quedan en NULL, que es información
-- útil: significa que el apoyo no cuadra con ningún turno registrado.
-- ============================================================================

UPDATE public.apoyos_turno a
SET numero_turno = c.numero_turno
FROM (
  SELECT DISTINCT ON (empresa_id, fecha_turno, hora_inicio)
    empresa_id, fecha_turno, hora_inicio, numero_turno
  FROM public.cierres_turno_final
  WHERE numero_turno IS NOT NULL
  ORDER BY empresa_id, fecha_turno, hora_inicio, numero_turno
) c
WHERE a.empresa_id  = c.empresa_id
  AND a.fecha_turno = c.fecha_turno
  AND a.hora_inicio = c.hora_inicio
  AND a.numero_turno IS NULL;

UPDATE public.apoyos_turno_locales a
SET numero_turno = c.numero_turno
FROM (
  SELECT DISTINCT ON (empresa_id, fecha_turno, hora_inicio)
    empresa_id, fecha_turno, hora_inicio, numero_turno
  FROM public.cierres_turno_final_locales
  WHERE numero_turno IS NOT NULL
  ORDER BY empresa_id, fecha_turno, hora_inicio, numero_turno
) c
WHERE a.empresa_id  = c.empresa_id
  AND a.fecha_turno = c.fecha_turno
  AND a.hora_inicio = c.hora_inicio
  AND a.numero_turno IS NULL;


-- ============================================================================
-- SECCIÓN 5 · Vista de turnos sospechosos
-- ----------------------------------------------------------------------------
-- Todo lo que reciba numero_turno >= 3 es un día con más registros de los que
-- caben en dos jornadas. Esta vista los deja a mano para el análisis que se
-- hará más adelante, sin tocar ni un dato.
-- ============================================================================

CREATE OR REPLACE VIEW public.turnos_sospechosos
WITH (security_invoker = on) AS
SELECT
  t.empresa_id,
  e.nombre_comercial,
  t.fecha_turno,
  t.numero_turno,
  t.hora_inicio,
  t.hora_fin,
  t.responsable_id,
  t.registrado_por,
  MIN(t.created_at)              AS primer_envio,
  MAX(t.created_at)              AS ultimo_envio,
  COUNT(*)                       AS filas,
  MAX(t.total_global)            AS total_global,
  MAX(t.caja_global)             AS caja_global,
  'mas de dos jornadas en el dia'::text AS motivo
FROM public.cierres_turno_final t
LEFT JOIN public.empresas e ON e.id = t.empresa_id
WHERE t.empresa_id IN (
  SELECT empresa_id
  FROM public.cierres_turno_final
  WHERE numero_turno >= 3
)
AND (t.empresa_id, t.fecha_turno) IN (
  SELECT empresa_id, fecha_turno
  FROM public.cierres_turno_final
  WHERE numero_turno >= 3
)
GROUP BY t.empresa_id, e.nombre_comercial, t.fecha_turno, t.numero_turno,
         t.hora_inicio, t.hora_fin, t.responsable_id, t.registrado_por
ORDER BY t.fecha_turno, t.numero_turno;

COMMENT ON VIEW public.turnos_sospechosos IS
  'Días con más de dos jornadas registradas. Casi todos son el mismo turno subido dos veces con la hora o el responsable ligeramente distintos. Para revisión manual antes de activar el índice único.';

REVOKE ALL ON public.turnos_sospechosos FROM anon;
GRANT SELECT ON public.turnos_sospechosos TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
--   DROP VIEW IF EXISTS public.turnos_sospechosos;
--   UPDATE public.cierres_turno_final         SET numero_turno = NULL;
--   UPDATE public.cierres_turno_final_locales SET numero_turno = NULL;
--   UPDATE public.apoyos_turno                SET numero_turno = NULL;
--   UPDATE public.apoyos_turno_locales        SET numero_turno = NULL;
--
-- Ningún dato de negocio se modifica en esta migración: solo se rellena una
-- columna que estaba vacía. Volver a ponerla en NULL deja la base como estaba.
-- ============================================================================

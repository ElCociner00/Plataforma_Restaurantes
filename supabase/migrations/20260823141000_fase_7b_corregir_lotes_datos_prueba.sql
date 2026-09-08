-- ============================================================================
-- FASE 7b · Corregir el archivado de Restaurante Prueba
--
-- QUÉ PASÓ
-- La Fase 7 construyó la lista de turnos de prueba así:
--
--   SELECT DISTINCT empresa_id, fecha_turno, numero_turno, gen_random_uuid()
--   FROM public.cierres_turno_final WHERE empresa_id = '...';
--
-- gen_random_uuid() se evalúa ANTES del DISTINCT y devuelve un valor distinto
-- por fila, así que el DISTINCT no colapsó nada: la tabla temporal acabó con
-- una fila por cada fila de cierre, no una por turno. El JOIN posterior por
-- (empresa, fecha, jornada) multiplicó cada fila por el número de filas de su
-- turno, y en el histórico entraron 13 868 copias de 712 filas reales, cada
-- una con su propio lote.
--
-- QUÉ NO SE ESTROPEÓ
-- Las tablas de trabajo. El DELETE de la Fase 7 filtraba por empresa_id
-- directamente, sin JOIN, así que retiró exactamente las 781 filas que debía.
-- Los importes de cierres_turno_final son correctos. Lo único inflado es el
-- histórico, y con él la pantalla de auditoría, que mostraría 712 lotes en
-- lugar de 37 turnos.
--
-- Las Fases 6 y 8 no tienen este problema: allí el lote se materializa con
-- GROUP BY (Fase 6) o desde una lista escrita a mano (Fase 8). Comprobado:
-- 3 016 filas archivadas con 3 016 identificadores distintos, sin repetir uno.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Un lote por turno, esta vez de verdad
-- ----------------------------------------------------------------------------
-- GROUP BY en lugar de DISTINCT: así gen_random_uuid() se evalúa una vez por
-- grupo y no una vez por fila. Es exactamente la diferencia que provocó el
-- fallo.
-- ============================================================================

CREATE TEMP TABLE _lotes_prueba AS
SELECT empresa_id, fecha_turno, numero_turno, gen_random_uuid() AS lote_id
FROM public.cierres_turno_historico
WHERE codigo_motivo = 'DATOS_PRUEBA'
GROUP BY empresa_id, fecha_turno, numero_turno;


-- ============================================================================
-- SECCIÓN 2 · Quitar las copias sobrantes
-- ----------------------------------------------------------------------------
-- Cada fila original quedó repetida tantas veces como filas tenía su turno.
-- Todas las copias son idénticas salvo en historico_id y lote_id, así que se
-- conserva la primera de cada identificador y se borran las demás.
--
-- Se borra del histórico, no de una tabla de trabajo: no se pierde ningún dato
-- de negocio, solo copias que esta misma ejecución creó por error hace unos
-- minutos.
--
-- Con row_number() y no con una subconsulta correlacionada por id: el primer
-- intento la escribió así y Postgres canceló la sentencia por tiempo, porque
-- recorría las 13 868 filas una vez por fila. La ventana lo hace en una sola
-- pasada.
-- ============================================================================

DELETE FROM public.cierres_turno_historico h
USING (
  SELECT historico_id FROM (
    SELECT historico_id,
           row_number() OVER (PARTITION BY id ORDER BY historico_id) AS rn
    FROM public.cierres_turno_historico
    WHERE codigo_motivo = 'DATOS_PRUEBA'
  ) x WHERE rn > 1
) sobra
WHERE h.historico_id = sobra.historico_id;

DELETE FROM public.apoyos_turno_historico a
USING (
  SELECT historico_id FROM (
    SELECT historico_id,
           row_number() OVER (PARTITION BY id ORDER BY historico_id) AS rn
    FROM public.apoyos_turno_historico
    WHERE codigo_motivo = 'DATOS_PRUEBA'
  ) x WHERE rn > 1
) sobra
WHERE a.historico_id = sobra.historico_id;


-- ============================================================================
-- SECCIÓN 3 · Reagrupar los lotes
-- ============================================================================

UPDATE public.cierres_turno_historico h
SET lote_id = l.lote_id
FROM _lotes_prueba l
WHERE h.codigo_motivo = 'DATOS_PRUEBA'
  AND h.empresa_id   = l.empresa_id
  AND h.fecha_turno  = l.fecha_turno
  AND h.numero_turno = l.numero_turno;

-- Los apoyos se cuelgan del lote de su turno; si no lo encuentran, se agrupan
-- en uno propio por fecha y jornada.
UPDATE public.apoyos_turno_historico a
SET lote_id = COALESCE(l.lote_id, a.lote_id)
FROM (SELECT * FROM _lotes_prueba) l
WHERE a.codigo_motivo = 'DATOS_PRUEBA'
  AND a.empresa_id   = l.empresa_id
  AND a.fecha_turno  = l.fecha_turno
  AND a.numero_turno IS NOT DISTINCT FROM l.numero_turno;


-- ============================================================================
-- SECCIÓN 4 · Aserciones
-- ============================================================================

DO $$
DECLARE
  v_filas   integer;
  v_ids     integer;
  v_lotes   integer;
  v_backup  integer;
  v_repes   integer;
BEGIN
  SELECT count(*), count(DISTINCT id), count(DISTINCT lote_id)
  INTO v_filas, v_ids, v_lotes
  FROM public.cierres_turno_historico
  WHERE codigo_motivo = 'DATOS_PRUEBA';

  IF v_filas <> v_ids THEN
    RAISE EXCEPTION 'FASE 7b: quedan copias repetidas: % filas para % identificadores', v_filas, v_ids;
  END IF;

  IF v_lotes > 40 THEN
    RAISE EXCEPTION 'FASE 7b: % lotes de datos de prueba, y solo hubo 37 turnos', v_lotes;
  END IF;

  -- Ninguna fila de Restaurante Prueba se perdió: todo lo que había en el
  -- respaldo tiene que estar hoy o en el histórico o —si la Fase 6 lo archivó
  -- como duplicado— con otro código (si existe la tabla de respaldo).
  IF to_regclass('public.zz_backup_20260823_cierres_turno_final') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)
    FROM public.zz_backup_20260823_cierres_turno_final b
    WHERE b.empresa_id = ''b76d89f6-43ea-4a2f-a21b-b159f7d7b162''
      AND NOT EXISTS (
        SELECT 1 FROM public.cierres_turno_historico h WHERE h.id = b.id
      )' INTO v_backup;

    IF v_backup > 0 THEN
      RAISE EXCEPTION 'FASE 7b: % filas de Restaurante Prueba no están en el histórico', v_backup;
    END IF;
  END IF;

  -- Y ninguna otra fila del histórico está repetida
  SELECT count(*) INTO v_repes FROM (
    SELECT id FROM public.cierres_turno_historico GROUP BY id HAVING count(*) > 1
  ) x;

  IF v_repes > 0 THEN
    RAISE EXCEPTION 'FASE 7b: % identificadores repetidos en el histórico', v_repes;
  END IF;

  RAISE NOTICE 'FASE 7b correcta: % filas de prueba en % lotes.', v_filas, v_lotes;
END
$$;

DROP TABLE IF EXISTS _lotes_prueba;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- No procede: esta migración solo retira copias que la Fase 7 creó por error.
-- Los datos de Restaurante Prueba siguen íntegros en el histórico y en
-- zz_backup_20260823_cierres_turno_final.
-- ============================================================================

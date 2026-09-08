-- ============================================================================
-- FASE 7 · Jornadas de más y datos de prueba
--
-- Dos trabajos distintos que comparten mecanismo:
--
--   A. Seis días de BATUT LE MERIDIEM tienen una jornada repetida entera. No
--      son filas duplicadas dentro de un turno —eso lo resolvió la Fase 6—
--      sino un turno completo subido dos veces con una jornada distinta,
--      porque la clave vieja incluía la hora y el responsable.
--
--   B. Restaurante Prueba entera. Son los cierres de ensayo que se hicieron al
--      montar el sistema; no corresponden a ninguna operación real y falsean
--      cualquier tablero que los sume.
--
-- Decisiones tomadas por el dueño del producto el 23/08/2026:
--   · Los días 15/08 y 01/08 SÍ tuvieron tres jornadas reales. Se conservan
--     como turno 3 y el sistema pasa a admitirlos: el formulario ofrecerá la
--     jornada 3 a partir de la Fase 10.
--   · Restaurante Prueba se retira de las tablas de trabajo.
--
-- Nada se borra: todo va al histórico con su lote y su observación, y desde la
-- pantalla de auditoría se puede eliminar de verdad o devolver.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Qué jornada sobra en cada día
-- ----------------------------------------------------------------------------
-- Escrito día a día a propósito, no con una regla automática. Cada caso se
-- revisó comparando horas, importes y minuto de subida, y la elección de cuál
-- sobra no es la misma en todos: en el 20/08 sobra la PRIMERA, porque la
-- segunda es la corrección.
-- ============================================================================

CREATE TEMP TABLE _jornadas_sobrantes (
  empresa_id   uuid,
  fecha_turno  date,
  numero_turno smallint,
  observacion  text
);

INSERT INTO _jornadas_sobrantes VALUES
-- 08/04 · T2 y T3 idénticos: misma franja, mismo importe, un minuto de diferencia
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-04-08', 3,
 'Depuración del 23/08/2026. El 08/04/2026 se registraron tres jornadas. Las jornadas 2 y 3 son el mismo turno: idéntica franja (15:13-21:20), idéntico importe ($1.279.664) y subidas con un minuto de diferencia. Se archiva la jornada 3 y el día queda con dos turnos.'),

-- 30/05 · T2 y T3 mismo importe; el T3 corrige la hora de fin
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-05-30', 2,
 'Depuración del 23/08/2026. El 30/05/2026 se registraron tres jornadas. Las jornadas 2 y 3 son el mismo turno de tarde ($1.244.311); la 3 se subió dos minutos después corrigiendo la hora de fin (21:18 a 21:42). Se archiva la jornada 2 y la 3 pasa a ser la 2.'),

-- 18/06 · T1 y T2 idénticos; el turno de tarde estaba en T3
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-06-18', 2,
 'Depuración del 23/08/2026. El 18/06/2026 se registraron tres jornadas. Las jornadas 1 y 2 son el mismo turno de mañana: idéntica franja (07:39-14:45) e idéntico importe ($1.028.400). Se archiva la jornada 2 y la 3, que es el turno de tarde, pasa a ser la 2.'),

-- 01/08 · T2 y T3 idénticos; ese día hubo TRES turnos reales
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-01', 3,
 'Depuración del 23/08/2026. El 01/08/2026 se registraron cuatro jornadas. Las jornadas 2 y 3 son el mismo turno: idéntica franja (11:30-15:00) e idéntico importe ($845.862). Se archiva la jornada 3 y la 4 pasa a ser la 3. El día conserva tres turnos porque las tres franjas restantes son distintas y reales (07:30-11:02, 11:30-15:00 y 15:00-21:53).'),

-- 10/08 · T1 y T2 idénticos; el turno de tarde estaba en T3
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-10', 2,
 'Depuración del 23/08/2026. El 10/08/2026 se registraron tres jornadas. Las jornadas 1 y 2 son el mismo turno de mañana: idéntica franja (08:04-14:30) e idéntico importe ($861.500), subidas con seis horas de diferencia. Se archiva la jornada 2 y la 3, que es el turno de tarde, pasa a ser la 2.'),

-- 20/08 · aquí sobra la PRIMERA: la segunda es la corrección
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-20', 1,
 'Depuración del 23/08/2026. El 20/08/2026 se registraron tres jornadas. Las jornadas 1 y 2 son el mismo turno de mañana con el mismo efectivo real ($1.338.838); la 2 se subió trece minutos después ampliando la hora de fin (14:52 a 15:10) y con el total del sistema recalculado, así que es la corrección. Se archiva la jornada 1, la 2 pasa a ser la 1 y la 3 pasa a ser la 2.');


-- ============================================================================
-- SECCIÓN 2 · Renumerar lo que queda
-- ----------------------------------------------------------------------------
-- El orden importa: primero se archiva la jornada que sobra y solo después se
-- corren las siguientes, para que no haya dos turnos con el mismo número ni
-- huecos en la numeración de un día.
-- ============================================================================

CREATE TEMP TABLE _renumerar (
  empresa_id  uuid,
  fecha_turno date,
  de          smallint,
  a           smallint,
  orden       smallint
);

INSERT INTO _renumerar VALUES
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-05-30', 3, 2, 1),
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-06-18', 3, 2, 1),
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-01', 4, 3, 1),
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-10', 3, 2, 1),
-- El 20/08 corre dos jornadas: la 2 a la 1 primero, la 3 a la 2 después
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-20', 2, 1, 1),
('f37f6983-9d59-40c8-b0c1-5949b45743c6', '2026-08-20', 3, 2, 2);


-- ============================================================================
-- SECCIÓN 3 · Restaurante Prueba
-- ----------------------------------------------------------------------------
-- La sede entera. Se marcan todos sus turnos con código DATOS_PRUEBA para que
-- salgan de las tablas de trabajo sin desaparecer: si algún día hace falta
-- revisar cómo se probó el sistema, siguen ahí.
-- ============================================================================

CREATE TEMP TABLE _turnos_prueba AS
SELECT DISTINCT empresa_id, fecha_turno, numero_turno, gen_random_uuid() AS lote_id
FROM public.cierres_turno_final
WHERE empresa_id = 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';


-- ============================================================================
-- SECCIÓN 4 · Archivar · jornadas sobrantes
-- ============================================================================

CREATE TEMP TABLE _lotes_jornada AS
SELECT empresa_id, fecha_turno, numero_turno, observacion, gen_random_uuid() AS lote_id
FROM _jornadas_sobrantes;

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
  j.lote_id, 'DUP_JORNADA', j.observacion
FROM public.cierres_turno_final c
JOIN _lotes_jornada j
  ON j.empresa_id = c.empresa_id AND j.fecha_turno = c.fecha_turno
 AND j.numero_turno = c.numero_turno;

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
  j.lote_id, 'DUP_JORNADA', j.observacion
FROM public.apoyos_turno a
JOIN _lotes_jornada j
  ON j.empresa_id = a.empresa_id AND j.fecha_turno = a.fecha_turno
 AND j.numero_turno = a.numero_turno;

DELETE FROM public.apoyos_turno a
USING _jornadas_sobrantes j
WHERE j.empresa_id = a.empresa_id AND j.fecha_turno = a.fecha_turno
  AND j.numero_turno = a.numero_turno;

DELETE FROM public.cierres_turno_final c
USING _jornadas_sobrantes j
WHERE j.empresa_id = c.empresa_id AND j.fecha_turno = c.fecha_turno
  AND j.numero_turno = c.numero_turno;


-- ============================================================================
-- SECCIÓN 5 · Renumerar
-- ============================================================================

DO $$
DECLARE
  v_paso record;
BEGIN
  FOR v_paso IN SELECT * FROM _renumerar ORDER BY orden, fecha_turno LOOP
    UPDATE public.cierres_turno_final
    SET numero_turno = v_paso.a
    WHERE empresa_id = v_paso.empresa_id
      AND fecha_turno = v_paso.fecha_turno
      AND numero_turno = v_paso.de;

    UPDATE public.apoyos_turno
    SET numero_turno = v_paso.a
    WHERE empresa_id = v_paso.empresa_id
      AND fecha_turno = v_paso.fecha_turno
      AND numero_turno = v_paso.de;
  END LOOP;
END
$$;


-- ============================================================================
-- SECCIÓN 6 · Archivar · Restaurante Prueba
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
  p.lote_id, 'DATOS_PRUEBA',
  format('Depuración del 23/08/2026. Cierre de la sede Restaurante Prueba (turno del %s, jornada %s). Corresponde a los ensayos que se hicieron al montar el sistema, no a una operación real, y falseaba cualquier tablero que lo sumara. Retirado de la tabla de trabajo por decisión del dueño del producto. Se conserva aquí por si hace falta revisar cómo se probó el sistema; se puede eliminar definitivamente desde esta misma pantalla.',
         to_char(c.fecha_turno, 'DD/MM/YYYY'), c.numero_turno)
FROM public.cierres_turno_final c
JOIN _turnos_prueba p
  ON p.empresa_id = c.empresa_id AND p.fecha_turno = c.fecha_turno
 AND p.numero_turno = c.numero_turno;

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
  COALESCE(p.lote_id, gen_random_uuid()), 'DATOS_PRUEBA',
  'Depuración del 23/08/2026. Apoyo de turno de la sede Restaurante Prueba, retirado junto con sus cierres de ensayo.'
FROM public.apoyos_turno a
LEFT JOIN _turnos_prueba p
  ON p.empresa_id = a.empresa_id AND p.fecha_turno = a.fecha_turno
 AND p.numero_turno = a.numero_turno
WHERE a.empresa_id = 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';

DELETE FROM public.apoyos_turno
WHERE empresa_id = 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';

DELETE FROM public.cierres_turno_final
WHERE empresa_id = 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';


-- ============================================================================
-- SECCIÓN 7 · Aserciones
-- ============================================================================

DO $$
DECLARE
  v_prueba   integer;
  v_huecos   integer;
  v_max      integer;
  v_dias3    integer;
  v_sin_obs  integer;
BEGIN
  -- 1 · No queda nada de Restaurante Prueba en las tablas de trabajo
  SELECT count(*) INTO v_prueba
  FROM public.cierres_turno_final
  WHERE empresa_id = 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162';

  IF v_prueba > 0 THEN
    RAISE EXCEPTION 'FASE 7: quedan % filas de Restaurante Prueba', v_prueba;
  END IF;

  -- 2 · Ningún día tiene huecos en la numeración de sus jornadas
  SELECT count(*) INTO v_huecos FROM (
    SELECT empresa_id, fecha_turno
    FROM public.cierres_turno_final
    GROUP BY 1,2
    HAVING max(numero_turno) <> count(DISTINCT numero_turno)
    UNION ALL
    SELECT empresa_id, fecha_turno
    FROM public.cierres_turno_final_locales
    GROUP BY 1,2
    HAVING max(numero_turno) <> count(DISTINCT numero_turno)
  ) x;

  IF v_huecos > 0 THEN
    RAISE EXCEPTION 'FASE 7: % días quedaron con huecos en la numeración de jornadas', v_huecos;
  END IF;

  -- 3 · Ningún día pasa de tres jornadas
  SELECT COALESCE(max(numero_turno), 0) INTO v_max FROM public.cierres_turno_final;

  IF v_max > 3 THEN
    RAISE EXCEPTION 'FASE 7: todavía hay días con jornada %, y el máximo admitido es 3', v_max;
  END IF;

  -- 4 · Los dos días de tres jornadas reales siguen intactos
  SELECT count(*) INTO v_dias3 FROM (
    SELECT fecha_turno
    FROM public.cierres_turno_final
    WHERE empresa_id = 'f37f6983-9d59-40c8-b0c1-5949b45743c6'
      AND fecha_turno IN ('2026-08-01', '2026-08-15')
    GROUP BY 1
    HAVING count(DISTINCT numero_turno) = 3
  ) x;

  IF v_dias3 <> 2 THEN
    RAISE EXCEPTION 'FASE 7: se esperaban 2 días con tres jornadas reales (01/08 y 15/08) y hay %', v_dias3;
  END IF;

  -- 5 · Todo lo archivado lleva observación
  SELECT count(*) INTO v_sin_obs
  FROM public.cierres_turno_historico
  WHERE COALESCE(observaciones, '') = '' OR lote_id IS NULL OR codigo_motivo IS NULL;

  IF v_sin_obs > 0 THEN
    RAISE EXCEPTION 'FASE 7: % filas del histórico sin observación, lote o código', v_sin_obs;
  END IF;

  RAISE NOTICE 'FASE 7 correcta.';
END
$$;

DROP TABLE IF EXISTS _jornadas_sobrantes;
DROP TABLE IF EXISTS _renumerar;
DROP TABLE IF EXISTS _turnos_prueba;
DROP TABLE IF EXISTS _lotes_jornada;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- Devolver las jornadas archivadas:
--
--   (usar public.restaurar_turno_historico(lote_id) sobre cada lote con
--    codigo_motivo IN ('DUP_JORNADA','DATOS_PRUEBA'), que además deshace la
--    renumeración al reinsertar con el numero_turno original)
--
-- Deshacer solo la renumeración:
--
--   UPDATE public.cierres_turno_final SET numero_turno = 3
--   WHERE empresa_id = 'f37f6983-9d59-40c8-b0c1-5949b45743c6'
--     AND fecha_turno = '2026-05-30' AND numero_turno = 2;
--   (y equivalentes para 18/06, 01/08, 10/08 y las dos del 20/08, en orden inverso)
--
-- Red de seguridad completa: zz_backup_20260823_*.
-- ============================================================================

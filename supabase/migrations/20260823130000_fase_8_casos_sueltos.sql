-- ============================================================================
-- FASE 8 · Casos sueltos
--
-- Lo que no encaja en ninguna regla general. Tres cosas:
--
--   A. Una fila huérfana en BATUT VIVA: el cierre del 19/08 entró completo a
--      las 02:01 y diecisiete horas después apareció una fila suelta de
--      efectivo/sistema, sin nada detrás. Es basura.
--
--   B. Un envío truncado en BATUT LE MERIDIEM el 18/05: la petición se cortó a
--      la mitad y el reintento también. El turno tiene efectivo duplicado y le
--      faltan transferencias, bono_regalo y los gastos.
--
--   C. Cuatro apoyos que la Fase 2 no supo emparejar con ningún turno.
--
-- OJO CON EL CRITERIO: aquí NO gana el último envío. En la Fase 6 lo posterior
-- era la corrección; aquí lo posterior es el intento fallido. Se conserva la
-- copia MÁS ANTIGUA, que es la del envío que llegó entero.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Fila huérfana y sobrante del truncado
-- ----------------------------------------------------------------------------
-- Se archivan las copias posteriores a la primera de cada (variable,
-- categoria) en los dos turnos afectados. Son tres filas en total: dos del
-- reintento cortado del 18/05 y la huérfana del 19/08.
-- ============================================================================

CREATE TEMP TABLE _sueltas AS
WITH afectados AS (
  SELECT 'cierres_turno_final'::text AS origen,
         'f37f6983-9d59-40c8-b0c1-5949b45743c6'::uuid AS empresa_id,
         '2026-05-18'::date AS fecha_turno, 2::smallint AS numero_turno,
         'ENVIO_TRUNCADO'::text AS codigo_motivo,
         'Depuración del 23/08/2026. El cierre del 18/05/2026 (jornada 2) se cortó a la mitad: la petición solo alcanzó a guardar efectivo, datáfono, rappi y nequi, y el reintento se cortó otra vez dejando el efectivo duplicado. Se archivan las dos filas del segundo intento y se conserva el primero. AVISO: el turno sigue incompleto. Le faltan transferencias, bono de regalo y los gastos de esa tarde, y no hay forma de reconstruirlos desde la base. Cualquier total de ese día está por debajo de lo real.'::text AS observacion
  UNION ALL
  SELECT 'cierres_turno_final_locales',
         (SELECT empresa_id FROM public.cierres_turno_final_locales
          WHERE fecha_turno = '2026-08-19' AND numero_turno = 2 LIMIT 1),
         '2026-08-19'::date, 2::smallint,
         'FILA_HUERFANA',
         'Depuración del 23/08/2026. El cierre del 19/08/2026 (jornada 2) entró completo el 20/08 a las 02:01. Diecisiete horas después, el 20/08 a las 19:41, apareció una fila suelta de efectivo/sistema con el mismo valor y sin ningún otro dato detrás: no es un envío, es una fila huérfana. Se archiva. El turno queda igual que estaba, sin el efectivo contado dos veces.'
),
lotes AS (
  SELECT *, gen_random_uuid() AS lote_id FROM afectados
),
base AS (
  SELECT 'cierres_turno_final' AS origen, id, empresa_id, fecha_turno, numero_turno,
         variable, categoria, created_at
  FROM public.cierres_turno_final
  UNION ALL
  SELECT 'cierres_turno_final_locales', id, empresa_id, fecha_turno, numero_turno,
         variable, categoria, created_at
  FROM public.cierres_turno_final_locales
),
marcado AS (
  SELECT b.origen, b.id, l.lote_id, l.codigo_motivo, l.observacion,
         row_number() OVER (
           PARTITION BY b.origen, b.empresa_id, b.fecha_turno, b.numero_turno,
                        b.variable, b.categoria
           ORDER BY b.created_at ASC, b.id ASC   -- la más antigua se queda
         ) AS rn
  FROM base b
  JOIN lotes l USING (origen, empresa_id, fecha_turno, numero_turno)
)
SELECT origen, id, lote_id, codigo_motivo, observacion
FROM marcado
WHERE rn > 1;


-- ============================================================================
-- SECCIÓN 2 · Archivar y retirar
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
  s.lote_id, s.codigo_motivo, s.observacion
FROM public.cierres_turno_final c
JOIN _sueltas s ON s.id = c.id AND s.origen = 'cierres_turno_final';

DELETE FROM public.cierres_turno_final c
USING _sueltas s
WHERE s.id = c.id AND s.origen = 'cierres_turno_final';

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
  s.lote_id, s.codigo_motivo, s.observacion
FROM public.cierres_turno_final_locales c
JOIN _sueltas s ON s.id = c.id AND s.origen = 'cierres_turno_final_locales';

DELETE FROM public.cierres_turno_final_locales c
USING _sueltas s
WHERE s.id = c.id AND s.origen = 'cierres_turno_final_locales';


-- ============================================================================
-- SECCIÓN 3 · Apoyos sin jornada
-- ----------------------------------------------------------------------------
-- La Fase 2 los emparejó exigiendo que hora_inicio del apoyo fuese idéntica a
-- la del turno. Estos cuatro no casaron porque el apoyo empezó más tarde que
-- el turno, que es lo normal: alguien entra a echar una mano a media jornada.
--
-- Aquí se empareja por RANGO: el apoyo pertenece al turno dentro de cuyo
-- horario empieza. Los que sigan sin casar se quedan en NULL, que es
-- información útil: significa que no hay turno registrado que los explique.
-- ============================================================================

UPDATE public.apoyos_turno a
SET numero_turno = c.numero_turno
FROM (
  SELECT DISTINCT empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin
  FROM public.cierres_turno_final
  WHERE numero_turno IS NOT NULL
) c
WHERE a.numero_turno IS NULL
  AND a.empresa_id  = c.empresa_id
  AND a.fecha_turno = c.fecha_turno
  AND a.hora_inicio >= c.hora_inicio
  AND (c.hora_fin = '' OR a.hora_inicio <= c.hora_fin);

UPDATE public.apoyos_turno_locales a
SET numero_turno = c.numero_turno
FROM (
  SELECT DISTINCT empresa_id, fecha_turno, numero_turno, hora_inicio, hora_fin
  FROM public.cierres_turno_final_locales
  WHERE numero_turno IS NOT NULL
) c
WHERE a.numero_turno IS NULL
  AND a.empresa_id  = c.empresa_id
  AND a.fecha_turno = c.fecha_turno
  AND a.hora_inicio >= c.hora_inicio
  AND (c.hora_fin = '' OR a.hora_inicio <= c.hora_fin);


-- ============================================================================
-- SECCIÓN 4 · Aserciones
-- ============================================================================

DO $$
DECLARE
  v_sueltas   integer;
  v_repes     integer;
  v_truncado  integer;
BEGIN
  SELECT count(*) INTO v_sueltas FROM _sueltas;

  IF v_sueltas <> 3 THEN
    RAISE EXCEPTION 'FASE 8: se esperaban 3 filas sueltas (2 del truncado del 18/05 y 1 huérfana del 19/08) y se encontraron %', v_sueltas;
  END IF;

  -- Ya no debe quedar NINGUNA fila repetida en ninguna de las dos tablas
  SELECT count(*) INTO v_repes FROM (
    SELECT 1 FROM public.cierres_turno_final
    WHERE variable NOT IN ('gasto_extra', 'efectivo_apertura')
    GROUP BY empresa_id, fecha_turno, numero_turno, variable, categoria
    HAVING count(*) > 1
    UNION ALL
    SELECT 1 FROM public.cierres_turno_final_locales
    WHERE variable NOT IN ('gasto_extra', 'efectivo_apertura')
    GROUP BY empresa_id, fecha_turno, numero_turno, variable, categoria
    HAVING count(*) > 1
  ) x;

  IF v_repes > 0 THEN
    RAISE EXCEPTION 'FASE 8: todavía quedan % grupos con filas repetidas', v_repes;
  END IF;

  -- El turno truncado sigue en su sitio: no se archivó entero
  SELECT count(*) INTO v_truncado
  FROM public.cierres_turno_final
  WHERE empresa_id = 'f37f6983-9d59-40c8-b0c1-5949b45743c6'
    AND fecha_turno = '2026-05-18' AND numero_turno = 2;

  IF v_truncado = 0 THEN
    RAISE EXCEPTION 'FASE 8: el turno truncado del 18/05 desapareció, y debía conservarse';
  END IF;

  RAISE NOTICE 'FASE 8 correcta: 3 filas archivadas, el turno truncado del 18/05 conservado con % filas.', v_truncado;
END
$$;

DROP TABLE IF EXISTS _sueltas;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
--   Usar public.restaurar_turno_historico(lote_id) sobre los lotes con
--   codigo_motivo IN ('FILA_HUERFANA','ENVIO_TRUNCADO').
--
--   Para deshacer el emparejamiento de apoyos:
--     UPDATE public.apoyos_turno         SET numero_turno = NULL
--       WHERE fecha_turno = '2026-08-21';
--     UPDATE public.apoyos_turno_locales SET numero_turno = NULL
--       WHERE fecha_turno IN ('2026-08-19', '2026-08-21');
-- ============================================================================

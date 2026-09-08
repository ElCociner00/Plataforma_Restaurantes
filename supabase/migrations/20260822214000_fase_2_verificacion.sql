-- ============================================================================
-- FASE 2 · Verificación del backfill
--
-- La CLI de Supabase no tiene ejecutor de SQL arbitrario, así que la
-- comprobación se hace con aserciones: si alguna invariante no se cumple, esta
-- migración lanza excepción y `supabase db push` falla. Que el push termine
-- bien ES la verificación.
--
-- Se comprueban invariantes, no conteos exactos, para que la migración siga
-- siendo válida aunque entren turnos nuevos mientras tanto.
-- ============================================================================

DO $$
DECLARE
  v_sin_numero   bigint;
  v_fuera_rango  bigint;
  v_con_hueco    bigint;
  v_turnos       bigint;
  v_sospechosos  bigint;
  v_apoyos_libre bigint;
BEGIN
  -- ── 1. Ninguna fila puede quedarse sin jornada ────────────────────────────
  SELECT count(*) INTO v_sin_numero
  FROM public.cierres_turno_final
  WHERE numero_turno IS NULL;

  IF v_sin_numero > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % filas de cierres_turno_final sin numero_turno', v_sin_numero;
  END IF;

  SELECT count(*) INTO v_sin_numero
  FROM public.cierres_turno_final_locales
  WHERE numero_turno IS NULL;

  IF v_sin_numero > 0 THEN
    RAISE EXCEPTION 'Backfill incompleto: % filas de _locales sin numero_turno', v_sin_numero;
  END IF;

  -- ── 2. El número siempre empieza en 1 ─────────────────────────────────────
  SELECT count(*) INTO v_fuera_rango
  FROM public.cierres_turno_final
  WHERE numero_turno < 1;

  IF v_fuera_rango > 0 THEN
    RAISE EXCEPTION 'Hay % filas con numero_turno menor que 1', v_fuera_rango;
  END IF;

  -- ── 3. Sin huecos: cada día numera 1,2,3… sin saltarse ninguno ────────────
  -- Si un día tuviera turnos 1 y 3 pero no el 2, la numeración estaría rota.
  SELECT count(*) INTO v_con_hueco
  FROM (
    SELECT empresa_id, fecha_turno,
           max(numero_turno) AS maximo,
           count(DISTINCT numero_turno) AS distintos
    FROM public.cierres_turno_final
    GROUP BY empresa_id, fecha_turno
    HAVING max(numero_turno) <> count(DISTINCT numero_turno)
  ) huecos;

  IF v_con_hueco > 0 THEN
    RAISE EXCEPTION 'Numeración con huecos en % días', v_con_hueco;
  END IF;

  -- ── 4. Los apoyos que encontraron turno deben tener jornada válida ────────
  SELECT count(*) INTO v_apoyos_libre
  FROM public.apoyos_turno
  WHERE numero_turno IS NOT NULL AND numero_turno < 1;

  IF v_apoyos_libre > 0 THEN
    RAISE EXCEPTION 'Apoyos con numero_turno inválido: %', v_apoyos_libre;
  END IF;

  -- ── 5. La vista de sospechosos tiene que responder ────────────────────────
  SELECT count(*) INTO v_sospechosos FROM public.turnos_sospechosos;

  -- ── Resumen ───────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_turnos
  FROM (
    SELECT DISTINCT empresa_id, fecha_turno, numero_turno
    FROM public.cierres_turno_final
  ) t;

  RAISE NOTICE 'Fase 2 verificada: % turnos numerados, % filas en turnos_sospechosos',
    v_turnos, v_sospechosos;
END
$$;


-- ============================================================================
-- Función de consulta para revisar el resultado desde la aplicación.
-- Devuelve el recuento por jornada, que es la forma rápida de ver si la
-- numeración quedó como se esperaba.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.resumen_jornadas()
RETURNS TABLE(
  empresa            text,
  numero_turno       smallint,
  turnos             bigint,
  primera_fecha      date,
  ultima_fecha       date
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(e.nombre_comercial, t.empresa_id::text) AS empresa,
    t.numero_turno,
    count(*)          AS turnos,
    min(t.fecha_turno) AS primera_fecha,
    max(t.fecha_turno) AS ultima_fecha
  FROM (
    SELECT DISTINCT empresa_id, fecha_turno, numero_turno
    FROM public.cierres_turno_final
  ) t
  LEFT JOIN public.empresas e ON e.id = t.empresa_id
  GROUP BY 1, 2
  ORDER BY 1, 2;
$$;

COMMENT ON FUNCTION public.resumen_jornadas() IS
  'Recuento de turnos por jornada y empresa. Sirve para comprobar de un vistazo cómo quedó la numeración de la Fase 2.';

REVOKE ALL ON FUNCTION public.resumen_jornadas() FROM anon;
GRANT EXECUTE ON FUNCTION public.resumen_jornadas() TO authenticated, service_role;


-- ============================================================================
-- REVERSIÓN
--   DROP FUNCTION IF EXISTS public.resumen_jornadas();
-- El bloque DO no deja nada persistente: solo comprueba.
-- ============================================================================

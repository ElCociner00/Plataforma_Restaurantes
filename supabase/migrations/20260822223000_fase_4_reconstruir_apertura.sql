-- ============================================================================
-- FASE 4 · Reconstrucción del efectivo de apertura hacia atrás
--
-- El plan preveía inicialmente rellenar el histórico con ceros. No hace falta:
-- `caja_global` tiene valor en todos los turnos y `efectivo_apertura` guarda lo
-- que declaró cada persona, así que la comparación se puede reconstruir sin
-- inventar nada.
--
-- De hecho la cadena ya se cumplía en la práctica. Ejemplo del 19/08: la caja
-- del cierre anterior era 333 150 y la apertura declarada 334 500 — un
-- descuadre real de +1 350 que estaba en la base sin que nadie lo mirara.
--
-- Se ejecuta DESPUÉS del backfill de la Fase 2, porque la cadena se apoya en
-- (fecha_turno, numero_turno) y los turnos sin numerar la romperían.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · cierres_turno_final
-- ----------------------------------------------------------------------------
-- Un turno son ~25 filas que repiten los mismos valores globales, así que se
-- resume con MAX y se le añaden dos filas nuevas: el esperado (caja del turno
-- anterior) y el real (lo declarado).
-- ============================================================================

WITH turnos AS (
  SELECT
    empresa_id,
    fecha_turno,
    numero_turno,
    MIN(created_at)          AS created_at,
    MAX(caja_global)         AS caja,
    MAX(bolsa_global)        AS bolsa,
    MAX(efectivo_apertura)   AS apertura,
    MAX(hora_inicio)         AS hora_inicio,
    MAX(hora_fin)            AS hora_fin,
    MAX(hora_llegada)        AS hora_llegada,
    MAX(registrado_por)      AS registrado_por,
    MAX(comentarios)         AS comentarios,
    MAX(domicilios_global)   AS domicilios,
    MAX(propina_global)      AS propina,
    MAX(total_global)        AS total,
    (array_agg(responsable_id ORDER BY created_at))[1] AS responsable_id
  FROM public.cierres_turno_final
  GROUP BY empresa_id, fecha_turno, numero_turno
),
con_anterior AS (
  SELECT
    t.*,
    LAG(t.caja) OVER (
      PARTITION BY t.empresa_id
      ORDER BY t.fecha_turno, t.numero_turno
    ) AS caja_anterior
  FROM turnos t
),
pendientes AS (
  SELECT c.*
  FROM con_anterior c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cierres_turno_final x
    WHERE x.empresa_id   = c.empresa_id
      AND x.fecha_turno  = c.fecha_turno
      AND x.numero_turno = c.numero_turno
      AND x.variable     = 'efectivo_apertura'
  )
)
INSERT INTO public.cierres_turno_final (
  empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
  created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
  categoria, domicilios_global, efectivo_apertura, propina_global,
  total_global, bolsa_global, caja_global, hora_llegada
)
SELECT
  p.empresa_id, p.fecha_turno, p.numero_turno, p.responsable_id, p.comentarios,
  p.created_at,
  -- Sin turno anterior no hay nada que comparar: el esperado se iguala al
  -- declarado y la diferencia queda en cero, en vez de fabricar un descuadre.
  CASE WHEN cat.categoria = 'sistema'
       THEN COALESCE(p.caja_anterior, p.apertura)
       ELSE p.apertura END,
  p.hora_inicio, p.hora_fin, 'efectivo_apertura', p.registrado_por,
  cat.categoria,
  p.domicilios, p.apertura, p.propina, p.total, p.bolsa, p.caja, p.hora_llegada
FROM pendientes p
CROSS JOIN (VALUES ('sistema'), ('real')) AS cat(categoria);


-- ============================================================================
-- SECCIÓN 2 · cierres_turno_final_locales
-- ============================================================================

WITH turnos AS (
  SELECT
    empresa_id, fecha_turno, numero_turno,
    MIN(created_at)        AS created_at,
    MAX(caja_global)       AS caja,
    MAX(bolsa_global)      AS bolsa,
    MAX(efectivo_apertura) AS apertura,
    MAX(hora_inicio)       AS hora_inicio,
    MAX(hora_fin)          AS hora_fin,
    MAX(hora_llegada)      AS hora_llegada,
    MAX(registrado_por)    AS registrado_por,
    MAX(comentarios)       AS comentarios,
    MAX(domicilios_global) AS domicilios,
    MAX(propina_global)    AS propina,
    MAX(total_global)      AS total,
    (array_agg(responsable_id ORDER BY created_at))[1] AS responsable_id
  FROM public.cierres_turno_final_locales
  GROUP BY empresa_id, fecha_turno, numero_turno
),
con_anterior AS (
  SELECT t.*,
    LAG(t.caja) OVER (
      PARTITION BY t.empresa_id ORDER BY t.fecha_turno, t.numero_turno
    ) AS caja_anterior
  FROM turnos t
),
pendientes AS (
  SELECT c.* FROM con_anterior c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.cierres_turno_final_locales x
    WHERE x.empresa_id   = c.empresa_id
      AND x.fecha_turno  = c.fecha_turno
      AND x.numero_turno = c.numero_turno
      AND x.variable     = 'efectivo_apertura'
  )
)
INSERT INTO public.cierres_turno_final_locales (
  empresa_id, fecha_turno, numero_turno, responsable_id, comentarios,
  created_at, valor, hora_inicio, hora_fin, variable, registrado_por,
  categoria, domicilios_global, efectivo_apertura, propina_global,
  total_global, bolsa_global, caja_global, hora_llegada
)
SELECT
  p.empresa_id, p.fecha_turno, p.numero_turno, p.responsable_id, p.comentarios,
  p.created_at,
  CASE WHEN cat.categoria = 'sistema'
       THEN COALESCE(p.caja_anterior, p.apertura)
       ELSE p.apertura END,
  p.hora_inicio, p.hora_fin, 'efectivo_apertura', p.registrado_por,
  cat.categoria,
  p.domicilios, p.apertura, p.propina, p.total, p.bolsa, p.caja, p.hora_llegada
FROM pendientes p
CROSS JOIN (VALUES ('sistema'), ('real')) AS cat(categoria);


-- ============================================================================
-- SECCIÓN 3 · Vista de descuadres de apertura
-- ----------------------------------------------------------------------------
-- Deja el dato reconstruido listo para mirar sin tener que pivotar a mano.
-- ============================================================================

CREATE OR REPLACE VIEW public.descuadres_apertura
WITH (security_invoker = on) AS
SELECT
  t.empresa_id,
  e.nombre_comercial               AS empresa,
  t.fecha_turno,
  t.numero_turno,
  MAX(t.hora_inicio)               AS hora_inicio,
  MAX(t.registrado_por)            AS registrado_por,
  MAX(t.valor) FILTER (WHERE t.categoria = 'sistema') AS caja_heredada,
  MAX(t.valor) FILTER (WHERE t.categoria = 'real')    AS apertura_declarada,
  COALESCE(MAX(t.valor) FILTER (WHERE t.categoria = 'real'), 0)
    - COALESCE(MAX(t.valor) FILTER (WHERE t.categoria = 'sistema'), 0) AS diferencia
FROM public.cierres_turno_final t
LEFT JOIN public.empresas e ON e.id = t.empresa_id
WHERE t.variable = 'efectivo_apertura'
GROUP BY t.empresa_id, e.nombre_comercial, t.fecha_turno, t.numero_turno
ORDER BY t.fecha_turno DESC, t.numero_turno DESC;

COMMENT ON VIEW public.descuadres_apertura IS
  'Un renglón por turno con la caja heredada del cierre anterior, lo que declaró quien recibió, y la diferencia. Tolerancia cero: cualquier valor distinto de 0 es un descuadre.';

REVOKE ALL ON public.descuadres_apertura FROM anon;
GRANT SELECT ON public.descuadres_apertura TO authenticated, service_role;


-- ============================================================================
-- SECCIÓN 4 · Verificación
-- ============================================================================

DO $$
DECLARE
  v_turnos     bigint;
  v_con_apert  bigint;
  v_descuadres bigint;
  v_sin_par    bigint;
BEGIN
  SELECT count(*) INTO v_turnos
  FROM (SELECT DISTINCT empresa_id, fecha_turno, numero_turno
        FROM public.cierres_turno_final) t;

  SELECT count(*) INTO v_con_apert FROM public.descuadres_apertura;

  -- Cada turno tiene que haber recibido las DOS filas, sistema y real.
  SELECT count(*) INTO v_sin_par
  FROM public.descuadres_apertura
  WHERE caja_heredada IS NULL OR apertura_declarada IS NULL;

  IF v_sin_par > 0 THEN
    RAISE EXCEPTION 'Hay % turnos con el par sistema/real incompleto', v_sin_par;
  END IF;

  IF v_con_apert <> v_turnos THEN
    RAISE EXCEPTION 'Reconstrucción incompleta: % turnos, % con efectivo de apertura',
      v_turnos, v_con_apert;
  END IF;

  SELECT count(*) INTO v_descuadres
  FROM public.descuadres_apertura WHERE diferencia <> 0;

  RAISE NOTICE 'Fase 4: % turnos con efectivo de apertura, % con descuadre',
    v_con_apert, v_descuadres;
END
$$;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
--   DROP VIEW IF EXISTS public.descuadres_apertura;
--   DELETE FROM public.cierres_turno_final          WHERE variable = 'efectivo_apertura';
--   DELETE FROM public.cierres_turno_final_locales  WHERE variable = 'efectivo_apertura';
--
-- El DELETE solo borra las filas que creó esta migración: antes de ella no
-- existía ninguna fila con variable = 'efectivo_apertura'.
-- ============================================================================

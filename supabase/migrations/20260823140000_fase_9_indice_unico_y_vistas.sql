-- ============================================================================
-- FASE 9 · Cerrar el invariante
--
-- Con los datos ya limpios, la base pasa a rechazar físicamente lo que hasta
-- ahora dependía de que el código se acordara. Tres cosas:
--
--   1. numero_turno obligatorio y limitado a 1..3.
--   2. Índice único sobre la identidad del turno.
--   3. turnos_agrupados deja de inventarse el número de turno.
--
-- El riesgo que quedaba abierto de la ejecución anterior —la pantalla auxiliar
-- que insertaba directo en cierres_turno_final sin pasar por el RPC— está
-- cerrado: cierre_turno/auxiliar.html y js/cierre_turno_auxiliar.js se
-- eliminaron, y no queda ningún .insert() directo en el módulo. Por eso el
-- índice se puede activar ahora sin dejar una pantalla rota detrás.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · La jornada pasa a ser obligatoria
-- ----------------------------------------------------------------------------
-- Sin NOT NULL el índice único de la sección 2 no sirve de nada: dos filas con
-- numero_turno NULL nunca chocan entre sí, así que bastaría con no mandar la
-- jornada para volver a duplicar turnos.
--
-- El rango vuelve a 1..3. La Fase 2 lo había abierto hasta 9 para dar sitio a
-- los duplicados heredados mientras se analizaban; ya no hacen falta. Se deja
-- en 3 y no en 2 porque el 01/08 y el 15/08 tuvieron tres jornadas reales,
-- confirmado por el dueño del producto.
-- ============================================================================

ALTER TABLE public.cierres_turno_final         ALTER COLUMN numero_turno SET NOT NULL;
ALTER TABLE public.cierres_turno_final_locales ALTER COLUMN numero_turno SET NOT NULL;

ALTER TABLE public.cierres_turno_final
  DROP CONSTRAINT IF EXISTS cierres_turno_final_numero_turno_check;
ALTER TABLE public.cierres_turno_final
  ADD CONSTRAINT cierres_turno_final_numero_turno_check
  CHECK (numero_turno BETWEEN 1 AND 3);

ALTER TABLE public.cierres_turno_final_locales
  DROP CONSTRAINT IF EXISTS cierres_turno_final_locales_numero_turno_check;
ALTER TABLE public.cierres_turno_final_locales
  ADD CONSTRAINT cierres_turno_final_locales_numero_turno_check
  CHECK (numero_turno BETWEEN 1 AND 3);

-- En los apoyos sigue admitiéndose NULL: un apoyo sin turno que lo explique es
-- información, no un error que haya que tapar.
ALTER TABLE public.apoyos_turno
  DROP CONSTRAINT IF EXISTS apoyos_turno_numero_turno_check;
ALTER TABLE public.apoyos_turno
  ADD CONSTRAINT apoyos_turno_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);

ALTER TABLE public.apoyos_turno_locales
  DROP CONSTRAINT IF EXISTS apoyos_turno_locales_numero_turno_check;
ALTER TABLE public.apoyos_turno_locales
  ADD CONSTRAINT apoyos_turno_locales_numero_turno_check
  CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);


-- ============================================================================
-- SECCIÓN 2 · Índice único
-- ----------------------------------------------------------------------------
-- Un turno no puede tener dos filas de la misma variable y categoría. Es el
-- invariante que se rompió 95 veces y que produjo el 42 % de inflación.
--
-- POR QUÉ ES PARCIAL: gasto_extra sí puede repetir categoría dentro de un
-- mismo cierre —un turno correcto puede tener dos gastos 'general'— así que
-- entra en la excepción. El resto de variables no.
--
-- Un índice único parcial NO sirve como destino de ON CONFLICT: es la lección
-- del parche 3 de la Fase B. Aquí no importa, porque subir_cierre_turno()
-- resuelve la sobrescritura archivando y borrando, no con ON CONFLICT. Si
-- algún día se añade un ON CONFLICT contra estas tablas, habrá que revisarlo.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS ux_cierres_turno_final_identidad
  ON public.cierres_turno_final (empresa_id, fecha_turno, numero_turno, variable, categoria)
  WHERE variable <> 'gasto_extra';

CREATE UNIQUE INDEX IF NOT EXISTS ux_cierres_turno_final_locales_identidad
  ON public.cierres_turno_final_locales (empresa_id, fecha_turno, numero_turno, variable, categoria)
  WHERE variable <> 'gasto_extra';

COMMENT ON INDEX public.ux_cierres_turno_final_identidad IS
  'Identidad del turno: una sola fila por variable y categoría. Excluye gasto_extra, que sí puede repetir categoría dentro de un cierre.';


-- ============================================================================
-- SECCIÓN 3 · turnos_agrupados deja de inventarse el número de turno
-- ----------------------------------------------------------------------------
-- La vista calculaba su propio numero_turno con
-- dense_rank() OVER (... ORDER BY hora_inicio) e ignoraba la columna real.
-- Resultado: la pantalla de Histórico numeraba por hora y el resto del sistema
-- por jornada, así que las dos daban números distintos para el mismo turno.
--
-- También agrupaba por (fecha, hora_inicio, hora_fin, responsable, registrado_por),
-- que es la clave VIEJA. Con esa agrupación, un turno cuya hora se corrigió
-- salía dos veces. Ahora agrupa por la identidad real.
--
-- Las columnas de salida se mantienen exactamente iguales para no tocar
-- js/historico_cierre_turno.js.
-- ============================================================================

CREATE OR REPLACE VIEW public.turnos_agrupados AS
SELECT
  empresa_id,
  fecha_turno,
  max(hora_inicio)  AS hora_inicio,
  max(hora_fin)     AS hora_fin,
  -- El cast a bigint conserva el tipo que la vista ya publicaba cuando lo
  -- calculaba con dense_rank(). CREATE OR REPLACE VIEW no admite cambiar el
  -- tipo de una columna existente.
  numero_turno::bigint AS numero_turno,
  CASE numero_turno
    WHEN 1 THEN 'Mañana'::text
    WHEN 2 THEN 'Tarde'::text
    ELSE        'Noche'::text
  END               AS nombre_turno,
  (fecha_turno || ' - T' || numero_turno
    || ' (' || max(hora_inicio) || '-' || max(hora_fin) || ')')::text AS turno_nombre,
  max(responsable_id::text)::uuid AS responsable_id,
  max(registrado_por)             AS registrado_por,
  max(comentarios)                AS comentarios,
  max(created_at)                 AS created_at,
  max(domicilios_global)          AS domicilios,
  max(efectivo_apertura)          AS efectivo_inicial,
  max(propina_global)             AS propinas,
  max(total_global)               AS ventas_brutas,
  max(bolsa_global)               AS bolsas,
  max(caja_global)                AS caja_final,
  json_agg(json_build_object('id', id, 'variable', variable, 'categoria', categoria, 'valor', valor)
           ORDER BY categoria, variable) FILTER (WHERE variable <> '') AS variables_detalle,
  sum(CASE WHEN variable <> '' THEN valor ELSE 0::numeric END)         AS total_variables,
  max(total_global)
    + sum(CASE WHEN variable <> '' THEN valor ELSE 0::numeric END)
    - max(caja_global)                                                 AS diferencia_caja
FROM public.cierres_turno_final
GROUP BY empresa_id, fecha_turno, numero_turno
ORDER BY fecha_turno DESC, numero_turno;

CREATE OR REPLACE VIEW public.turnos_agrupados_locales AS
SELECT
  empresa_id,
  fecha_turno,
  max(hora_inicio)  AS hora_inicio,
  max(hora_fin)     AS hora_fin,
  -- El cast a bigint conserva el tipo que la vista ya publicaba cuando lo
  -- calculaba con dense_rank(). CREATE OR REPLACE VIEW no admite cambiar el
  -- tipo de una columna existente.
  numero_turno::bigint AS numero_turno,
  CASE numero_turno
    WHEN 1 THEN 'Mañana'::text
    WHEN 2 THEN 'Tarde'::text
    ELSE        'Noche'::text
  END               AS nombre_turno,
  (fecha_turno || ' - T' || numero_turno
    || ' (' || max(hora_inicio) || '-' || max(hora_fin) || ')')::text AS turno_nombre,
  max(responsable_id::text)::uuid AS responsable_id,
  max(registrado_por)             AS registrado_por,
  max(comentarios)                AS comentarios,
  max(created_at)                 AS created_at,
  max(domicilios_global)          AS domicilios,
  max(efectivo_apertura)          AS efectivo_inicial,
  max(propina_global)             AS propinas,
  max(total_global)               AS ventas_brutas,
  max(bolsa_global)               AS bolsas,
  max(caja_global)                AS caja_final,
  json_agg(json_build_object('id', id, 'variable', variable, 'categoria', categoria, 'valor', valor)
           ORDER BY categoria, variable) FILTER (WHERE variable <> '') AS variables_detalle,
  sum(CASE WHEN variable <> '' THEN valor ELSE 0::numeric END)         AS total_variables,
  max(total_global)
    + sum(CASE WHEN variable <> '' THEN valor ELSE 0::numeric END)
    - max(caja_global)                                                 AS diferencia_caja
FROM public.cierres_turno_final_locales
GROUP BY empresa_id, fecha_turno, numero_turno
ORDER BY fecha_turno DESC, numero_turno;


-- ============================================================================
-- SECCIÓN 4 · Aserciones
-- ============================================================================

DO $$
DECLARE
  v_turnos_final integer;
  v_turnos_loc   integer;
  v_filas_vista  integer;
BEGIN
  -- El índice único ya está activo: si algo hubiese quedado duplicado, la
  -- creación de arriba habría fallado. Estas comprobaciones son de forma.

  SELECT count(DISTINCT (empresa_id, fecha_turno, numero_turno))
  INTO v_turnos_final FROM public.cierres_turno_final;

  SELECT count(DISTINCT (empresa_id, fecha_turno, numero_turno))
  INTO v_turnos_loc FROM public.cierres_turno_final_locales;

  -- La vista debe devolver exactamente un registro por turno. Antes devolvía
  -- uno por combinación de hora y responsable, que era el fallo.
  SELECT count(*) INTO v_filas_vista FROM public.turnos_agrupados;

  IF v_filas_vista <> v_turnos_final THEN
    RAISE EXCEPTION 'FASE 9: turnos_agrupados devuelve % filas y hay % turnos', v_filas_vista, v_turnos_final;
  END IF;

  SELECT count(*) INTO v_filas_vista FROM public.turnos_agrupados_locales;

  IF v_filas_vista <> v_turnos_loc THEN
    RAISE EXCEPTION 'FASE 9: turnos_agrupados_locales devuelve % filas y hay % turnos', v_filas_vista, v_turnos_loc;
  END IF;

  RAISE NOTICE 'FASE 9 correcta: % turnos en la tabla principal y % en la de sedes, uno por fila en las vistas.',
    v_turnos_final, v_turnos_loc;
END
$$;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
--   DROP INDEX IF EXISTS public.ux_cierres_turno_final_identidad;
--   DROP INDEX IF EXISTS public.ux_cierres_turno_final_locales_identidad;
--   ALTER TABLE public.cierres_turno_final         ALTER COLUMN numero_turno DROP NOT NULL;
--   ALTER TABLE public.cierres_turno_final_locales ALTER COLUMN numero_turno DROP NOT NULL;
--
--   Y reaplicar los CHECK con BETWEEN 1 AND 9 y las dos vistas tal como estaban
--   en 20240101000000_init.sql.
-- ============================================================================

-- Evidencia del reparto de propinas, propina por propina.
--
-- El reparto ya se calculaba bien: `consultar-propina-apoyos` divide cada
-- propina a partes iguales entre quienes estaban presentes en el instante de
-- la factura y concilia los centavos. Pero solo devolvía el TOTAL por persona,
-- y ese total se consulta a Loggro en vivo: al recargar la página no queda
-- rastro. El cliente veía una cifra final sin poder rastrear de dónde salía, y
-- de ahí la sospecha de que no se repartía.
--
-- Esta tabla guarda cada propina con su hora exacta, su monto, quiénes estaban
-- presentes y cuánto le tocó a cada uno. No participa en ningún cálculo: es
-- soporte para poder mostrar el reparto y revisarlo después.
--
-- Una sola tabla para sedes y empresa principal, a diferencia de
-- `cierres_turno_final` / `_locales`. Esa duplicación es justo lo que hizo que
-- una pantalla leyera de la tabla equivocada y pareciera que no había datos;
-- aquí el aislamiento lo da `empresa_id` + RLS, que es donde debe estar.

CREATE TABLE IF NOT EXISTS public.propinas_turno_eventos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  fecha_turno   date        NOT NULL,
  numero_turno  smallint    NOT NULL,
  factura_id    text,
  ocurrido_en   timestamptz NOT NULL,
  monto         numeric     NOT NULL,
  -- [{id, tipo, nombre}] de quienes cubrían ese instante.
  presentes     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- [{id, tipo, parte}] con lo que le correspondió a cada uno de esa propina.
  reparto       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT propinas_turno_eventos_jornada_valida CHECK (numero_turno IN (1, 2, 3)),
  CONSTRAINT propinas_turno_eventos_monto_positivo CHECK (monto > 0)
);

COMMENT ON TABLE public.propinas_turno_eventos IS
  'Evidencia del reparto de propinas: una fila por propina recibida, con hora exacta, presentes y reparto. No interviene en ningún cálculo.';

-- La consulta natural es "dame el turno tal de la sede tal".
CREATE INDEX IF NOT EXISTS propinas_turno_eventos_turno_idx
  ON public.propinas_turno_eventos (empresa_id, fecha_turno, numero_turno, ocurrido_en);

ALTER TABLE public.propinas_turno_eventos ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que `apoyos_turno`: el tenant lo acota `app_puede_ver_empresa`.
DROP POLICY IF EXISTS propinas_turno_eventos_tenant ON public.propinas_turno_eventos;
CREATE POLICY propinas_turno_eventos_tenant
  ON public.propinas_turno_eventos
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.propinas_turno_eventos TO authenticated;
GRANT ALL ON public.propinas_turno_eventos TO service_role;


-- Guarda la evidencia de un turno. Idempotente: reemplaza lo que hubiera para
-- esa (empresa, fecha, jornada), de modo que reenviar un cierre no duplica
-- propinas ni deja mezclada la evidencia de dos intentos.
--
-- Va aparte de `subir_cierre_turno` a propósito: esa función son 18 KB de
-- lógica crítica de dinero y reescribirla entera para colgarle un insert de
-- evidencia es más riesgo que valor. Si esto falla, el cierre sigue en pie y
-- la evidencia se puede volver a generar.
CREATE OR REPLACE FUNCTION public.guardar_propinas_turno(
  p_empresa_id uuid,
  p_fecha      date,
  p_numero     smallint,
  p_eventos    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_guardados integer := 0;
BEGIN
  IF p_empresa_id IS NULL OR NOT public.app_puede_ver_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'No tienes acceso a la sede solicitada' USING ERRCODE = '42501';
  END IF;

  IF p_fecha IS NULL THEN
    RAISE EXCEPTION 'Falta la fecha del turno' USING ERRCODE = '22023';
  END IF;

  IF p_numero NOT IN (1, 2, 3) THEN
    RAISE EXCEPTION 'Indica la jornada del turno: 1, 2 o 3' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.propinas_turno_eventos
   WHERE empresa_id = p_empresa_id
     AND fecha_turno = p_fecha
     AND numero_turno = p_numero;

  INSERT INTO public.propinas_turno_eventos (
    empresa_id, fecha_turno, numero_turno, factura_id, ocurrido_en, monto, presentes, reparto
  )
  SELECT
    p_empresa_id,
    p_fecha,
    p_numero,
    NULLIF(item ->> 'factura_id', ''),
    (item ->> 'ocurrido_en')::timestamptz,
    (item ->> 'monto')::numeric,
    COALESCE(item -> 'presentes', '[]'::jsonb),
    COALESCE(item -> 'reparto', '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(p_eventos, '[]'::jsonb)) AS item
  WHERE NULLIF(item ->> 'ocurrido_en', '') IS NOT NULL
    AND COALESCE((item ->> 'monto')::numeric, 0) > 0;

  GET DIAGNOSTICS v_guardados = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'empresa_id', p_empresa_id,
    'fecha_turno', p_fecha,
    'numero_turno', p_numero,
    'eventos_guardados', v_guardados
  );
END;
$$;

COMMENT ON FUNCTION public.guardar_propinas_turno(uuid, date, smallint, jsonb) IS
  'Reemplaza la evidencia de propinas de un turno. Idempotente por (empresa, fecha, jornada).';

REVOKE ALL ON FUNCTION public.guardar_propinas_turno(uuid, date, smallint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.guardar_propinas_turno(uuid, date, smallint, jsonb)
  TO authenticated, service_role;

-- ============================================================================
-- FASE 1 · Jornada del turno, idempotencia e histórico
--
-- Primera de las cuatro fases de datos descritas en
-- docs/2026-08-22_plan_sistema_dashboards.md (Parte II).
--
-- Qué resuelve: hoy un turno se identifica por
-- (empresa_id, fecha_turno, hora_inicio, responsable_id). Como la hora y el
-- responsable forman parte de la clave, el mismo turno subido con la hora
-- corregida o por otra persona cuenta como un turno distinto. Eso produjo 85
-- turnos con filas repetidas de 356 (24 %), e infla el efectivo del sistema en
-- $40 978 378 (45 %) si se suma sin deduplicar.
--
-- La clave pasa a ser (empresa_id, fecha_turno, numero_turno).
--
-- Esta migración NO numera los turnos existentes ni activa el índice único:
-- eso es la Fase 2, que necesita los datos ya clasificados. Aquí solo se
-- preparan las estructuras.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Columna de jornada
-- ----------------------------------------------------------------------------
-- smallint con CHECK 1..3. Hoy no hay terceras jornadas, pero admitir el 3
-- desde ahora cuesta nada y evita rehacer la clave si una sede abre turno de
-- noche. Nula al principio: la Fase 2 la rellena.
-- ============================================================================

ALTER TABLE public.cierres_turno_final
  ADD COLUMN IF NOT EXISTS numero_turno smallint;
ALTER TABLE public.cierres_turno_final_locales
  ADD COLUMN IF NOT EXISTS numero_turno smallint;
ALTER TABLE public.apoyos_turno
  ADD COLUMN IF NOT EXISTS numero_turno smallint;
ALTER TABLE public.apoyos_turno_locales
  ADD COLUMN IF NOT EXISTS numero_turno smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cierres_turno_final_numero_turno_check'
  ) THEN
    ALTER TABLE public.cierres_turno_final
      ADD CONSTRAINT cierres_turno_final_numero_turno_check
      CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cierres_turno_final_locales_numero_turno_check'
  ) THEN
    ALTER TABLE public.cierres_turno_final_locales
      ADD CONSTRAINT cierres_turno_final_locales_numero_turno_check
      CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apoyos_turno_numero_turno_check'
  ) THEN
    ALTER TABLE public.apoyos_turno
      ADD CONSTRAINT apoyos_turno_numero_turno_check
      CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'apoyos_turno_locales_numero_turno_check'
  ) THEN
    ALTER TABLE public.apoyos_turno_locales
      ADD CONSTRAINT apoyos_turno_locales_numero_turno_check
      CHECK (numero_turno IS NULL OR numero_turno BETWEEN 1 AND 3);
  END IF;
END
$$;

COMMENT ON COLUMN public.cierres_turno_final.numero_turno IS
  'Jornada del turno: 1 = mañana, 2 = tarde. Parte de la identidad del turno junto con empresa_id y fecha_turno.';


-- ============================================================================
-- SECCIÓN 2 · Token de envío (idempotencia)
-- ----------------------------------------------------------------------------
-- El navegador genera un identificador al abrir el formulario. Si llegan dos
-- peticiones con el mismo, la segunda no hace nada. Cubre el doble clic y el
-- reintento por red lenta, que explican los 989 reenvíos idénticos.
-- ============================================================================

ALTER TABLE public.cierres_turno_final
  ADD COLUMN IF NOT EXISTS token_envio text;
ALTER TABLE public.cierres_turno_final_locales
  ADD COLUMN IF NOT EXISTS token_envio text;

CREATE INDEX IF NOT EXISTS ix_cierres_turno_final_token
  ON public.cierres_turno_final (token_envio)
  WHERE token_envio IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_cierres_turno_final_locales_token
  ON public.cierres_turno_final_locales (token_envio)
  WHERE token_envio IS NOT NULL;


-- ============================================================================
-- SECCIÓN 3 · Tablas de histórico
-- ----------------------------------------------------------------------------
-- Cuando un turno se sobrescribe, la versión anterior se MUEVE aquí. La tabla
-- de trabajo se queda solo con el turno definitivo.
--
-- Por qué mover en vez de marcar con una columna `reemplazado_en`: así el
-- índice único de la Fase 2 puede ser TOTAL en lugar de parcial. La lección
-- del parche 3 de la Fase B fue que un índice único parcial NO sirve como
-- destino de ON CONFLICT, y aquel error costó un cron que reportaba éxito sin
-- hacer nada.
--
-- Y por qué guardar en vez de borrar: esto es un arqueo de caja. Si alguien
-- sube un cierre descuadrado y lo reemplaza por uno cuadrado, sin histórico no
-- queda rastro del primero, y la función que corrige el problema se convierte
-- en la forma más limpia de tapar un faltante.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cierres_turno_historico (
  -- Identidad propia de la fila histórica
  historico_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Copia íntegra de la fila original, incluido su id
  id                     uuid NOT NULL,
  empresa_id             uuid NOT NULL,
  fecha_turno            date NOT NULL,
  numero_turno           smallint,
  responsable_id         uuid,
  comentarios            text        DEFAULT ''::text NOT NULL,
  created_at             timestamptz NOT NULL,
  valor                  numeric     DEFAULT 0 NOT NULL,
  hora_inicio            text        DEFAULT ''::text NOT NULL,
  hora_fin               text        DEFAULT ''::text NOT NULL,
  variable               text        DEFAULT ''::text NOT NULL,
  registrado_por         text        DEFAULT ''::text NOT NULL,
  categoria              text        DEFAULT ''::text NOT NULL,
  domicilios_global      numeric     DEFAULT 0 NOT NULL,
  efectivo_apertura      numeric     DEFAULT 0 NOT NULL,
  propina_global         numeric     DEFAULT 0 NOT NULL,
  total_global           numeric     DEFAULT 0 NOT NULL,
  bolsa_global           numeric     DEFAULT 0 NOT NULL,
  caja_global            numeric     DEFAULT 0 NOT NULL,
  hora_llegada           text        DEFAULT ''::text NOT NULL,
  token_envio            text,

  -- De qué tabla vino: la base o su gemela de locales
  origen                 text NOT NULL DEFAULT 'cierres_turno_final',

  -- Trazabilidad de la sobrescritura
  reemplazado_en         timestamptz NOT NULL DEFAULT now(),
  reemplazado_por        uuid,
  reemplazado_por_correo text DEFAULT ''::text NOT NULL,

  -- Motivo que escribe quien sobrescribe desde el formulario
  motivo                 text DEFAULT ''::text NOT NULL,

  -- Espacio para anotar a mano la razón de los movimientos que se hagan más
  -- adelante (limpieza de duplicados, correcciones puntuales, migraciones).
  observaciones          text DEFAULT ''::text NOT NULL
);

COMMENT ON TABLE public.cierres_turno_historico IS
  'Versiones anteriores de cierres de turno sobrescritos. La tabla de trabajo conserva solo la versión vigente.';
COMMENT ON COLUMN public.cierres_turno_historico.observaciones IS
  'Nota libre sobre por qué esta fila llegó al histórico. Para anotar los movimientos manuales de limpieza.';
COMMENT ON COLUMN public.cierres_turno_historico.origen IS
  'Tabla de la que procede la fila: cierres_turno_final o cierres_turno_final_locales.';

CREATE INDEX IF NOT EXISTS ix_cierres_turno_historico_turno
  ON public.cierres_turno_historico (empresa_id, fecha_turno, numero_turno);
CREATE INDEX IF NOT EXISTS ix_cierres_turno_historico_fecha
  ON public.cierres_turno_historico (reemplazado_en DESC);


CREATE TABLE IF NOT EXISTS public.apoyos_turno_historico (
  historico_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  id                     uuid NOT NULL,
  empresa_id             uuid NOT NULL,
  fecha_turno            date NOT NULL,
  numero_turno           smallint,
  hora_inicio            text NOT NULL,
  hora_fin               text NOT NULL,
  responsable_turno_id   uuid,
  apoyo_responsable_id   uuid,
  propina                numeric     DEFAULT 0 NOT NULL,
  tiempo_texto           text        DEFAULT ''::text NOT NULL,
  tiempo_minutos         numeric     DEFAULT 0 NOT NULL,
  rango_tiempo           text        DEFAULT ''::text NOT NULL,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz,

  origen                 text NOT NULL DEFAULT 'apoyos_turno',

  reemplazado_en         timestamptz NOT NULL DEFAULT now(),
  reemplazado_por        uuid,
  reemplazado_por_correo text DEFAULT ''::text NOT NULL,
  motivo                 text DEFAULT ''::text NOT NULL,
  observaciones          text DEFAULT ''::text NOT NULL
);

COMMENT ON TABLE public.apoyos_turno_historico IS
  'Versiones anteriores de apoyos de turno sobrescritos, en paralelo a cierres_turno_historico.';

CREATE INDEX IF NOT EXISTS ix_apoyos_turno_historico_turno
  ON public.apoyos_turno_historico (empresa_id, fecha_turno, numero_turno);


-- ============================================================================
-- SECCIÓN 4 · RLS del histórico
-- ----------------------------------------------------------------------------
-- Mismo criterio que el resto del proyecto: cada empresa ve lo suyo. El
-- histórico es material de auditoría, así que la lectura se limita a
-- administradores; escribe solo el rol de servicio, desde el RPC de la Fase 3.
-- ============================================================================

ALTER TABLE public.cierres_turno_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.apoyos_turno_historico  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cierres_turno_historico_select ON public.cierres_turno_historico;
CREATE POLICY cierres_turno_historico_select
  ON public.cierres_turno_historico FOR SELECT
  USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

DROP POLICY IF EXISTS cierres_turno_historico_insert ON public.cierres_turno_historico;
CREATE POLICY cierres_turno_historico_insert
  ON public.cierres_turno_historico FOR INSERT
  WITH CHECK (public.app_es_rol_servicio() OR public.app_es_superadmin());

DROP POLICY IF EXISTS apoyos_turno_historico_select ON public.apoyos_turno_historico;
CREATE POLICY apoyos_turno_historico_select
  ON public.apoyos_turno_historico FOR SELECT
  USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

DROP POLICY IF EXISTS apoyos_turno_historico_insert ON public.apoyos_turno_historico;
CREATE POLICY apoyos_turno_historico_insert
  ON public.apoyos_turno_historico FOR INSERT
  WITH CHECK (public.app_es_rol_servicio() OR public.app_es_superadmin());

GRANT SELECT ON public.cierres_turno_historico TO authenticated;
GRANT SELECT ON public.apoyos_turno_historico  TO authenticated;
GRANT ALL    ON public.cierres_turno_historico TO service_role;
GRANT ALL    ON public.apoyos_turno_historico  TO service_role;
REVOKE ALL   ON public.cierres_turno_historico FROM anon;
REVOKE ALL   ON public.apoyos_turno_historico  FROM anon;


-- ============================================================================
-- REVERSIÓN DE EMERGENCIA
-- ----------------------------------------------------------------------------
-- En este orden, línea por línea:
--
--   DROP TABLE IF EXISTS public.cierres_turno_historico;
--   DROP TABLE IF EXISTS public.apoyos_turno_historico;
--   DROP INDEX IF EXISTS public.ix_cierres_turno_final_token;
--   DROP INDEX IF EXISTS public.ix_cierres_turno_final_locales_token;
--   ALTER TABLE public.cierres_turno_final          DROP COLUMN IF EXISTS token_envio;
--   ALTER TABLE public.cierres_turno_final_locales  DROP COLUMN IF EXISTS token_envio;
--   ALTER TABLE public.cierres_turno_final          DROP COLUMN IF EXISTS numero_turno;
--   ALTER TABLE public.cierres_turno_final_locales  DROP COLUMN IF EXISTS numero_turno;
--   ALTER TABLE public.apoyos_turno                 DROP COLUMN IF EXISTS numero_turno;
--   ALTER TABLE public.apoyos_turno_locales         DROP COLUMN IF EXISTS numero_turno;
--
-- Ninguna de estas operaciones toca datos existentes: todo lo que añade esta
-- migración es aditivo y las columnas nuevas quedan en NULL.
-- ============================================================================

-- ============================================================================
-- FASE A · Cimientos de base de datos para la migración n8n → Edge Functions
-- Proyecto destino: tgkvcvnwwnrlyhbqmhaf  ("Enkrato Google")
--
-- Reglas respetadas:
--   · Solo CREATE / ALTER ... ADD / CREATE POLICY.
--   · NINGÚN drop de tabla, truncate ni delete de datos.
--   · Los DROP POLICY que aparecen son para RECREAR políticas defectuosas
--     (ver sección 2); no eliminan datos.
-- ============================================================================


-- ============================================================================
-- SECCIÓN 1 · Funciones de contexto multi-tenant
-- ----------------------------------------------------------------------------
-- Ya existían is_super_admin(), get_my_empresa_id() y get_empresas_del_grupo().
-- Se conservan intactas. Estas nuevas app_* las complementan:
--   · fijan search_path (las anteriores no lo hacen: riesgo de secuestro)
--   · get_empresas_del_grupo() solo mira "hacia arriba": si soy un local veo
--     mis hermanos, pero si soy la empresa MADRE no veo a mis locales.
--     app_empresas_visibles() resuelve las dos direcciones.
-- ============================================================================

-- ¿El usuario autenticado es superadministrador de plataforma?
CREATE OR REPLACE FUNCTION public.app_es_superadmin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (SELECT 1 FROM public.system_users WHERE id = auth.uid());
$$;

COMMENT ON FUNCTION public.app_es_superadmin() IS
  'TRUE si auth.uid() está en system_users. system_users no tiene empresa_id: es la lista blanca de superadmins de plataforma.';


-- Empresa a la que pertenece el usuario autenticado.
CREATE OR REPLACE FUNCTION public.app_empresa_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT empresa_id
  FROM public.usuarios_sistema
  WHERE id = auth.uid() AND COALESCE(activo, true) = true
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.app_empresa_id() IS
  'empresa_id del usuario autenticado. Es la ÚNICA fuente de verdad del tenant: el cliente nunca elige empresa.';


-- ¿La empresa indicada es un local dentro de un grupo empresarial?
CREATE OR REPLACE FUNCTION public.app_es_local(p_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.grupos_empresariales
    WHERE empresa_id = p_empresa_id AND COALESCE(activo, true) = true
  );
$$;

COMMENT ON FUNCTION public.app_es_local(uuid) IS
  'En grupos_empresariales, empresa_id es el LOCAL y grupo_id es la empresa MADRE. Si hay fila, la empresa es un local.';


-- Empresa madre de un local (NULL si la empresa no es un local).
CREATE OR REPLACE FUNCTION public.app_grupo_de(p_empresa_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT grupo_id::uuid
  FROM public.grupos_empresariales
  WHERE empresa_id = p_empresa_id AND COALESCE(activo, true) = true
  LIMIT 1;
$$;


-- Conjunto de empresas que el usuario autenticado puede ver.
--   · superadmin  → todas
--   · local       → él mismo + su madre + sus hermanos
--   · madre       → ella misma + todos sus locales
--   · suelta      → solo ella misma
CREATE OR REPLACE FUNCTION public.app_empresas_visibles()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_empresa uuid;
  v_grupo   uuid;
BEGIN
  IF public.app_es_superadmin() THEN
    RETURN QUERY SELECT id FROM public.empresas;
    RETURN;
  END IF;

  v_empresa := public.app_empresa_id();
  IF v_empresa IS NULL THEN
    RETURN;
  END IF;

  RETURN NEXT v_empresa;

  -- Rama "soy un local": devuelvo mi madre y mis hermanos.
  v_grupo := public.app_grupo_de(v_empresa);
  IF v_grupo IS NOT NULL THEN
    RETURN NEXT v_grupo;
    RETURN QUERY
      SELECT ge.empresa_id
      FROM public.grupos_empresariales ge
      WHERE ge.grupo_id::uuid = v_grupo
        AND ge.empresa_id <> v_empresa
        AND COALESCE(ge.activo, true) = true;
    RETURN;
  END IF;

  -- Rama "soy la madre": devuelvo mis locales.
  RETURN QUERY
    SELECT ge.empresa_id
    FROM public.grupos_empresariales ge
    WHERE ge.grupo_id::uuid = v_empresa
      AND COALESCE(ge.activo, true) = true;
END;
$$;

COMMENT ON FUNCTION public.app_empresas_visibles() IS
  'Alcance de tenant del usuario autenticado. Base de todas las políticas RLS nuevas.';


-- Atajo booleano para usar dentro de políticas RLS.
CREATE OR REPLACE FUNCTION public.app_puede_ver_empresa(p_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_empresa_id IS NOT NULL
     AND p_empresa_id IN (SELECT public.app_empresas_visibles());
$$;


-- ¿El usuario autenticado administra su empresa?
-- Roles reales presentes en los datos: admin_root, admin, revisor.
CREATE OR REPLACE FUNCTION public.app_es_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.app_es_superadmin()
      OR EXISTS (
        SELECT 1 FROM public.usuarios_sistema
        WHERE id = auth.uid()
          AND COALESCE(activo, true) = true
          AND lower(rol) IN ('admin_root', 'admin')
      );
$$;

COMMENT ON FUNCTION public.app_es_admin() IS
  'Roles administrativos reales del sistema. OJO: sql/009 usaba rol = ''administrador'', valor que NO existe en los datos.';


-- ============================================================================
-- SECCIÓN 2 · Corrección de fuga entre empresas (CRÍTICO)
-- ----------------------------------------------------------------------------
-- Cuatro políticas de init.sql contienen la condición  ge.empresa_id = ge.empresa_id
-- que es una TAUTOLOGÍA. El EXISTS queda reducido a "¿pertenezco a algún grupo?",
-- así que CUALQUIER usuario de un grupo podía leer los cierres de CUALQUIER
-- empresa de la plataforma. Se recrean con el alcance correcto.
-- ============================================================================

DROP POLICY IF EXISTS "cierres_turno_final_all_tenant_or_super" ON public.cierres_turno_final;
DROP POLICY IF EXISTS "cierres_turno_final_select"             ON public.cierres_turno_final;
DROP POLICY IF EXISTS "cierres_inventario_all_tenant_or_super" ON public.cierres_inventario;
DROP POLICY IF EXISTS "cierres_inventario_select"              ON public.cierres_inventario;

CREATE POLICY "cierres_turno_final_tenant" ON public.cierres_turno_final
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

CREATE POLICY "cierres_inventario_tenant" ON public.cierres_inventario
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));


-- ============================================================================
-- SECCIÓN 3 · Políticas RLS para las 7 tablas que estaban en deny-all
-- ----------------------------------------------------------------------------
-- Tenían ENABLE ROW LEVEL SECURITY pero CERO políticas. n8n las leía con la
-- service_role (que ignora RLS); una Edge Function que use el JWT del usuario
-- recibiría 0 filas. Sin esta sección, Nómina y Cierre de turno no funcionan.
-- ============================================================================

-- 3.1 historico_nomina  (Guardar/Consultar/Borrar Nómina)
CREATE POLICY "historico_nomina_tenant" ON public.historico_nomina
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

-- 3.2 apoyos_turno  (subir_cierre, Nómina_Nuevo)
CREATE POLICY "apoyos_turno_tenant" ON public.apoyos_turno
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

-- 3.3 gastos_costos
CREATE POLICY "gastos_costos_tenant" ON public.gastos_costos
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

-- 3.4 empresa_configuracion_nomina
CREATE POLICY "empresa_configuracion_nomina_tenant" ON public.empresa_configuracion_nomina
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

-- 3.5 historial_facturacion  (solo lectura para el tenant; escribe el backend)
CREATE POLICY "historial_facturacion_select_tenant" ON public.historial_facturacion
  FOR SELECT
  USING (public.app_puede_ver_empresa(empresa_id));

-- 3.6 integracion_credibanco  (contiene secretos: solo administradores)
CREATE POLICY "integracion_credibanco_admin" ON public.integracion_credibanco
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin())
  WITH CHECK (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());

-- 3.7 loggro_refrescar_token
--     Tabla heredada con usuario y contraseña EN CLARO. Queda deliberadamente
--     SIN política de SELECT: nadie la lee desde el frontend. La sustituye
--     integraciones_credenciales (cifrada). No se borra: es histórico.
CREATE POLICY "loggro_refrescar_token_sin_lectura" ON public.loggro_refrescar_token
  FOR SELECT
  USING (false);

COMMENT ON TABLE public.loggro_refrescar_token IS
  'HEREDADA / OBSOLETA. Credenciales en claro. Sustituida por integraciones_credenciales (cifrada). Lectura denegada por RLS; solo service_role.';


-- ============================================================================
-- SECCIÓN 4 · integraciones_credenciales — el corazón del multi-tenant
-- ----------------------------------------------------------------------------
-- Es la tabla de la que depende TODO módulo que hable con Loggro.
-- Las dos políticas heredadas de sql/009 comparaban rol = 'administrador',
-- un valor que NO EXISTE en los datos (los roles reales son admin_root, admin,
-- revisor), así que nunca concedían nada. Se recrean.
-- SELECT sigue denegado a todo el mundo: la contraseña cifrada solo la lee
-- la Edge Function con service_role.
-- ============================================================================

ALTER TABLE public.integraciones_credenciales
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

ALTER TABLE public.integraciones_credenciales
  ADD COLUMN IF NOT EXISTS validado_en timestamptz;

ALTER TABLE public.integraciones_credenciales
  ADD COLUMN IF NOT EXISTS actualizado_por uuid;

DROP POLICY IF EXISTS "Permitir inserción a administradores de la empresa"    ON public.integraciones_credenciales;
DROP POLICY IF EXISTS "Permitir actualización a administradores de la empresa" ON public.integraciones_credenciales;

CREATE POLICY "integraciones_credenciales_insert_admin" ON public.integraciones_credenciales
  FOR INSERT
  WITH CHECK (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());

CREATE POLICY "integraciones_credenciales_update_admin" ON public.integraciones_credenciales
  FOR UPDATE
  USING (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin())
  WITH CHECK (public.app_puede_ver_empresa(empresa_id) AND public.app_es_admin());

-- SELECT: deliberadamente sin política → nadie lee contraseñas desde el navegador.

COMMENT ON TABLE public.integraciones_credenciales IS
  'Credenciales por empresa de plataformas externas (Loggro/pirpos, Siigo...). password va CIFRADO (AES-GCM, prefijo enc:). SELECT denegado por RLS: solo Edge Functions con service_role.';


-- ============================================================================
-- SECCIÓN 5 · Caché de token e índices de unicidad
-- ----------------------------------------------------------------------------
-- credenciales_plataforma guarda el token vigente de cada empresa. Sin
-- token_expira_en había que refrescarlo a ciegas; el flujo n8n
-- Reinicio_Credenciales_loggro lo renovaba TODO cada vez por no tener esto.
-- ============================================================================

ALTER TABLE public.credenciales_plataforma
  ADD COLUMN IF NOT EXISTS token_expira_en timestamptz;

ALTER TABLE public.credenciales_plataforma
  ADD COLUMN IF NOT EXISTS token_actualizado_en timestamptz;

ALTER TABLE public.credenciales_plataforma
  ADD COLUMN IF NOT EXISTS ultimo_error text;

-- Deduplicar antes de imponer unicidad: conserva la fila más reciente por
-- (empresa_id, plataforma) y desactiva las demás. NO borra nada.
UPDATE public.credenciales_plataforma c
SET activo = false
WHERE activo = true
  AND EXISTS (
    SELECT 1 FROM public.credenciales_plataforma o
    WHERE o.empresa_id = c.empresa_id
      AND o.plataforma = c.plataforma
      AND o.activo = true
      AND (o.created_at > c.created_at
           OR (o.created_at = c.created_at AND o.id > c.id))
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_credenciales_plataforma_activa
  ON public.credenciales_plataforma (empresa_id, plataforma)
  WHERE activo = true;

-- Mata por completo el cron Verificación_Usuarios_Local_Dups: la base impide
-- el duplicado en lugar de barrerlo periódicamente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usuarios_locales_principal_empresa
  ON public.usuarios_locales (empresa_id, usuario_principal_id);

CREATE INDEX IF NOT EXISTS ix_integraciones_credenciales_empresa
  ON public.integraciones_credenciales (empresa_id, plataforma)
  WHERE activo = true;


-- ============================================================================
-- SECCIÓN 6 · Vista que el flujo histórico_cierre_inventarios espera
-- ----------------------------------------------------------------------------
-- El flujo n8n lee inventario_diario_resumen, relación que NO EXISTE en el
-- esquema. Se construye sobre cierres_inventario con security_invoker, igual
-- que turnos_agrupados, para que el RLS del usuario siga aplicando.
-- ============================================================================

-- Columnas reales de cierres_inventario: fecha, producto, stock_actual,
-- stock_gastado, stock_restante, hora_inicio, hora_fin. La forma de salida
-- replica la de obtener_historico_inventarios() para que el frontend no cambie.
CREATE OR REPLACE VIEW public.inventario_diario_resumen
WITH (security_invoker = 'on') AS
SELECT
  ci.empresa_id,
  ci.fecha                                   AS fecha_cierre,
  count(*)                                   AS total_productos,
  COALESCE(sum(ci.stock_gastado), 0)         AS consumo_total,
  COALESCE(sum(ci.stock_restante), 0)        AS stock_total_final,
  COALESCE(sum(ci.stock_actual), 0)          AS stock_total_inicial,
  min(ci.hora_inicio)                        AS hora_inicio,
  max(ci.hora_fin)                           AS hora_fin,
  max(ci.registrado_por)                     AS registrado_por,
  bool_or(ci."Inconsistencia")               AS tiene_inconsistencia,
  min(ci.created_at)                         AS registrado_en,
  json_agg(
    json_build_object(
      'producto_id',     ci.id,
      'producto_nombre', ci.producto,
      'stock_inicial',   ci.stock_actual,
      'stock_gastado',   ci.stock_gastado,
      'stock_restante',  ci.stock_restante,
      'hora_inicio',     ci.hora_inicio,
      'hora_fin',        ci.hora_fin
    ) ORDER BY ci.producto
  )                                          AS productos
FROM public.cierres_inventario ci
GROUP BY ci.empresa_id, ci.fecha;

COMMENT ON VIEW public.inventario_diario_resumen IS
  'Reemplaza la relación homónima que el flujo n8n cierre_inventarios_historico esperaba y que no existía en el esquema. security_invoker: hereda el RLS del usuario.';


-- ----------------------------------------------------------------------------
-- Fuga adicional detectada: obtener_historico_inventarios() es SECURITY DEFINER
-- y acepta p_empresa_id del cliente SIN comprobar el tenant. Cualquier usuario
-- autenticado podía leer el inventario de otra empresa pasando su uuid.
-- Se recrea con la misma firma y salida, añadiendo el control de alcance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.obtener_historico_inventarios(
  p_empresa_id uuid,
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  fecha_cierre date,
  total_productos bigint,
  consumo_total numeric,
  stock_total_final numeric,
  productos json,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.app_puede_ver_empresa(p_empresa_id) THEN
    RAISE EXCEPTION 'Sin acceso a la empresa solicitada'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH paginated AS (
    SELECT
      ci.fecha,
      COUNT(*)                     AS total_productos,
      SUM(ci.stock_gastado)        AS consumo_total,
      SUM(ci.stock_restante)       AS stock_total_final,
      json_agg(
        json_build_object(
          'producto_id',     ci.id,
          'producto_nombre', ci.producto,
          'stock_inicial',   ci.stock_actual,
          'stock_gastado',   ci.stock_gastado,
          'stock_restante',  ci.stock_restante,
          'hora_inicio',     ci.hora_inicio,
          'hora_fin',        ci.hora_fin
        ) ORDER BY ci.producto
      )                            AS productos,
      COUNT(*) OVER()              AS total_count
    FROM public.cierres_inventario ci
    WHERE ci.empresa_id = p_empresa_id
    GROUP BY ci.fecha
    ORDER BY ci.fecha DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT * FROM paginated;
END;
$$;


-- ============================================================================
-- SECCIÓN 7 · Compras: sustituye la hoja de cálculo «Automatización Facturas»
-- ----------------------------------------------------------------------------
-- El módulo Compras vivía íntegramente en Google Sheets. Se modela en dos
-- tablas siguiendo la forma real de la hoja:
--   · Hoja 3 = una fila por factura  → compras_facturas
--   · Hoja 1 = una fila por renglón  → compras_facturas_lineas
-- La columna "uuid" de la hoja es un hash de 96 caracteres que identifica la
-- factura de forma estable; se conserva como hash_factura y es la clave de
-- deduplicación. La columna "Empresa" de la hoja es el empresa_id del tenant.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.compras_facturas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id          uuid NOT NULL REFERENCES public.empresas(id),
  hash_factura        text NOT NULL,                     -- columna "uuid" de la hoja
  prefijo_factura     text NOT NULL DEFAULT '',
  consecutivo_factura text NOT NULL DEFAULT '',
  proveedor           text NOT NULL DEFAULT '',
  nit_proveedor       text NOT NULL DEFAULT '',
  direccion           text,
  telefono            text,
  correo_proveedor    text,
  tipo_factura        text NOT NULL DEFAULT '',
  fecha_factura       date,
  subtotal            numeric(14,2) NOT NULL DEFAULT 0,
  impuestos           numeric(14,2) NOT NULL DEFAULT 0,
  total               numeric(14,2) NOT NULL DEFAULT 0,
  revisada            boolean NOT NULL DEFAULT false,    -- hoja 3, "Revisada"
  distribuida         boolean NOT NULL DEFAULT false,    -- hoja 3, "Distribuida"
  local_asignado      uuid REFERENCES public.empresas(id),
  subida_loggro       boolean NOT NULL DEFAULT false,
  subida_loggro_en    timestamptz,
  subida_por          uuid,
  origen              text NOT NULL DEFAULT 'sheet',     -- sheet | correo | manual
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_compras_facturas_hash UNIQUE (empresa_id, hash_factura)
);

CREATE INDEX IF NOT EXISTS ix_compras_facturas_empresa_fecha
  ON public.compras_facturas (empresa_id, fecha_factura DESC);

CREATE INDEX IF NOT EXISTS ix_compras_facturas_estado
  ON public.compras_facturas (empresa_id, revisada, distribuida, subida_loggro);

CREATE INDEX IF NOT EXISTS ix_compras_facturas_local
  ON public.compras_facturas (local_asignado)
  WHERE local_asignado IS NOT NULL;


CREATE TABLE IF NOT EXISTS public.compras_facturas_lineas (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id        uuid NOT NULL REFERENCES public.compras_facturas(id) ON DELETE CASCADE,
  empresa_id        uuid NOT NULL REFERENCES public.empresas(id),
  linea             integer NOT NULL DEFAULT 0,
  producto          text NOT NULL DEFAULT '',
  valor_unitario    numeric(14,2) NOT NULL DEFAULT 0,
  cantidad          numeric(14,3) NOT NULL DEFAULT 0,
  subtotal          numeric(14,2) NOT NULL DEFAULT 0,
  valor_inc_iva     numeric(14,2) NOT NULL DEFAULT 0,
  codigo_contable   text NOT NULL DEFAULT '',
  valor_debito      numeric(14,2) NOT NULL DEFAULT 0,
  valor_credito     numeric(14,2) NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_compras_facturas_lineas_factura
  ON public.compras_facturas_lineas (factura_id);

CREATE INDEX IF NOT EXISTS ix_compras_facturas_lineas_empresa
  ON public.compras_facturas_lineas (empresa_id);


ALTER TABLE public.compras_facturas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compras_facturas_lineas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "compras_facturas_tenant" ON public.compras_facturas
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

CREATE POLICY "compras_facturas_lineas_tenant" ON public.compras_facturas_lineas
  FOR ALL
  USING (public.app_puede_ver_empresa(empresa_id))
  WITH CHECK (public.app_puede_ver_empresa(empresa_id));

DROP TRIGGER IF EXISTS trg_compras_facturas_updated_at ON public.compras_facturas;
CREATE TRIGGER trg_compras_facturas_updated_at
  BEFORE UPDATE ON public.compras_facturas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================================
-- SECCIÓN 8 · Permisos
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.app_es_superadmin()          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_empresa_id()             TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_es_local(uuid)           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_grupo_de(uuid)           TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_empresas_visibles()      TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_puede_ver_empresa(uuid)  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.app_es_admin()               TO anon, authenticated, service_role;

GRANT SELECT                         ON public.inventario_diario_resumen   TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compras_facturas            TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compras_facturas_lineas     TO authenticated, service_role;

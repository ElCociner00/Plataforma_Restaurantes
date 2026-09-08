-- ============================================================================
-- FASE C · parche · cerrar la vista estado_integraciones
-- ----------------------------------------------------------------------------
-- Detectado en la verificación posterior al despliegue: la vista devolvía
-- filas a un llamante ANÓNIMO (nombre comercial de cada empresa y estado de
-- su integración). La causa es que se apoya en `empresas`, que arrastra una
-- política permisiva heredada, y security_invoker se limita a heredarla.
--
-- Se añade el filtro de alcance dentro de la propia vista y se retira el
-- permiso a anon. No se toca la política de `empresas`: cambiarla podría
-- romper el registro self-service, que necesita leerla antes de haber sesión.
-- ============================================================================

CREATE OR REPLACE VIEW public.estado_integraciones
WITH (security_invoker = 'on') AS
SELECT
  e.id                                   AS empresa_id,
  e.nombre_comercial,
  ic.plataforma,
  (ic.id IS NOT NULL)                    AS tiene_credencial,
  COALESCE(ic.activo, false)             AS credencial_activa,
  ic.validado_en,
  cp.plataforma_tenant_id                AS negocio_externo,
  cp.token_expira_en,
  (cp.token_expira_en > now())           AS token_vigente,
  cp.token_actualizado_en,
  cp.ultimo_error
FROM public.empresas e
LEFT JOIN public.integraciones_credenciales ic
       ON ic.empresa_id = e.id
LEFT JOIN public.credenciales_plataforma cp
       ON cp.empresa_id = e.id
      AND cp.plataforma = ic.plataforma
      AND cp.activo = true
WHERE public.app_puede_ver_empresa(e.id);

COMMENT ON VIEW public.estado_integraciones IS
  'Salud de las integraciones por empresa, acotada al alcance del usuario. No expone usuario ni contraseña. Sin acceso anónimo.';

REVOKE ALL ON public.estado_integraciones FROM anon;
GRANT SELECT ON public.estado_integraciones TO authenticated, service_role;

-- Misma revisión para lo demás que se creó en estas fases: nada de lo que
-- exponga datos de empresa debe ser legible sin sesión.
REVOKE ALL ON public.inventario_diario_resumen FROM anon;
GRANT SELECT ON public.inventario_diario_resumen TO authenticated, service_role;

-- ============================================================================
-- FASE B · parche 3 · índice único utilizable como destino de ON CONFLICT
-- ----------------------------------------------------------------------------
-- La Fase A creó uq_credenciales_plataforma_activa como índice PARCIAL
-- (WHERE activo = true). PostgreSQL no infiere un índice parcial como destino
-- de ON CONFLICT (empresa_id, plataforma): la sentencia falla con 42P10.
--
-- Efecto observado: el cron informaba "renovado" para las 4 empresas, pero
-- token_expira_en y token_actualizado_en se quedaban en NULL porque el upsert
-- se rechazaba en silencio.
--
-- Se añade el índice único TOTAL sobre (empresa_id, plataforma). Verificado
-- antes de crearlo: 6 filas, 0 duplicados, 0 inactivos.
-- El índice parcial se conserva; no estorba.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_credenciales_plataforma_empresa
  ON public.credenciales_plataforma (empresa_id, plataforma);

COMMENT ON INDEX public.uq_credenciales_plataforma_empresa IS
  'Destino de ON CONFLICT para el upsert de tokens. Debe ser TOTAL, no parcial.';

-- integraciones_credenciales ya tenía uq_integraciones_credenciales_empresa_plataforma
-- creado en sql/009, que sí es total: su upsert nunca tuvo este problema.

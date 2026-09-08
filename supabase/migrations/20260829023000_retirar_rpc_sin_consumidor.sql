-- Decisiones finales sobre objetos que existen pero no tienen consumidor en la
-- aplicacion. Se conserva su definicion para auditoria/reuso, pero se retira la
-- exposicion al navegador hasta que exista una pantalla con permisos probados.
REVOKE ALL ON FUNCTION public.dashboard_dias_pendientes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marcar_dia_operacion(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagos_por_conciliar() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.dashboard_dias_pendientes(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.marcar_dia_operacion(uuid, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.pagos_por_conciliar() TO service_role;

COMMENT ON FUNCTION public.dashboard_dias_pendientes(uuid) IS
  'Retirada de la API de navegador: sin consumidor UI al conciliar las 27 migraciones.';
COMMENT ON FUNCTION public.marcar_dia_operacion(uuid, date, text) IS
  'Retirada de la API de navegador: sin consumidor UI al conciliar las 27 migraciones.';
COMMENT ON FUNCTION public.pagos_por_conciliar() IS
  'Backoffice conservado solo para service_role hasta implementar una pantalla de conciliacion.';

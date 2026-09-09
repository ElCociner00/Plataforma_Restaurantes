-- El REVOKE ... FROM anon de las migraciones anteriores no surtía efecto: en
-- PostgreSQL toda función nace con EXECUTE concedido a PUBLIC, y `anon` lo
-- heredaba por ahí. Quitarle el permiso a `anon` sin tocar PUBLIC no quita nada.
--
-- Ninguna de las dos era explotable sin sesión —ambas son SECURITY INVOKER y
-- comprueban `app_puede_ver_empresa`, que sin sesión es falso—, pero la
-- intención declarada en el repo era que `anon` no pudiera invocarlas, y hasta
-- ahora el repo decía una cosa y la base hacía otra.

REVOKE ALL ON FUNCTION public.guardar_propinas_turno(uuid, date, smallint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guardar_propinas_turno(uuid, date, smallint, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.efectivo_apertura_esperado(date, smallint, uuid)
  TO authenticated, service_role;

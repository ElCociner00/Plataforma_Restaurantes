-- Permisos del módulo simulador_propinas (Auditoría de propinas).
--
-- Mismo criterio que auditoria_turnos: es una herramienta de revisión, no de
-- operación diaria. Quien cierra turnos no la necesita y podría confundir la
-- simulación con el reparto real.
--
-- La pantalla además comprueba el rol al entrar y el RLS acota los datos: esta
-- fila es la tercera capa, la que permite ajustarlo por usuario desde permisos.

INSERT INTO public.roles_permisos_modulo (modulo, rol, permitido)
VALUES
  ('simulador_propinas', 'admin_root', true),
  ('simulador_propinas', 'admin',      true),
  ('simulador_propinas', 'revisor',    false),
  ('simulador_propinas', 'operativo',  false)
ON CONFLICT DO NOTHING;

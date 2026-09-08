-- ============================================================================
-- CICLO DE VIDA · FASE C (c) — La guarda del servidor
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §2.3
--
-- Un bloqueo que solo vive en el navegador no es un bloqueo: quien abra la
-- consola del navegador se lo salta. Aquí se aplica donde sí manda.
--
-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  QUÉ BLOQUEA ESTA GUARDA (§2.4)                                          │
-- │                                                                          │
-- │  SÍ:  cuentas que nunca activaron su prueba en 30 días                   │
-- │       cuentas dadas de baja por el propio cliente                        │
-- │                                                                          │
-- │  NO:  cuentas con facturas vencidas. Un cliente que está operando y debe │
-- │       dinero NO queda bloqueado. Eso sigue en modo observación y espera   │
-- │       autorización explícita de Andrés.                                  │
-- │                                                                          │
-- │  La lógica de esa distinción vive entera en acceso_de_empresa().         │
-- └──────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

begin;

create or replace function public.exigir_acceso_escritura(p_empresa_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_acceso jsonb := public.acceso_de_empresa(p_empresa_id);
begin
  if (v_acceso->>'nivel') = 'total' then
    return;
  end if;

  -- El mensaje que sale es el que compuso acceso_de_empresa(): explica el
  -- motivo y cómo salir, en vez de un "permiso denegado" seco.
  raise exception '%', coalesce(
    v_acceso->>'mensaje',
    'Tu cuenta no permite registrar información en este momento.'
  ) using errcode = 'EK100';
end;
$$;

comment on function public.exigir_acceso_escritura(uuid) is
  'Corta la escritura cuando acceso_de_empresa() no devuelve nivel "total". No corta por mora: eso sigue en observación.';

grant execute on function public.exigir_acceso_escritura(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- La guarda se aplica a los RPC de escritura en la migración siguiente
-- (20260825018000), reescribiéndolos por completo y de forma verificada. No se
-- inyecta con regexp sobre pg_get_functiondef(): un fallo de coincidencia en
-- subir_cierre_turno dejaría el cierre de turno inservible.
-- ----------------------------------------------------------------------------

commit;

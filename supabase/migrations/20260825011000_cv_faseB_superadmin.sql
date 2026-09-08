-- ============================================================================
-- CICLO DE VIDA · FASE B — Superadministrador
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase B
--
-- Hasta hoy system_users tenía una sola fila (Santiago). Se añade Andrés, y se
-- crea el sistema de permisos para poder ir dándole funciones sin tocar código
-- cada vez.
--
-- Nota deliberada: el usuario de Andrés es a la vez admin_root de BATUT VIVA
-- en usuarios_sistema. Es su empresa de pruebas, no la del cliente. Funciona
-- porque is_super_admin() tiene prioridad sobre el contexto de empresa, pero
-- queda anotado para separarlo cuando haya más clientes.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Alta de Andrés como superadministrador
-- ----------------------------------------------------------------------------
insert into public.system_users (id, nombre, correo)
select u.id, 'Andrés Zamora', u.email
from auth.users u
where lower(u.email) = 'andreszamora4life@gmail.com'
on conflict (id) do update
  set nombre = excluded.nombre,
      correo = excluded.correo;

-- ----------------------------------------------------------------------------
-- 2. Permisos por superadministrador
--
-- No todos los superadmin tienen por qué poder todo. Purgar datos o
-- impersonar a un cliente no son la misma clase de acción que emitir una
-- factura, y conviene poder separarlas antes de que haya un equipo.
-- ----------------------------------------------------------------------------
create table if not exists public.superadmin_permisos (
  id              uuid primary key default gen_random_uuid(),
  system_user_id  uuid not null references public.system_users(id) on delete cascade,
  permiso         text not null,
  otorgado_en     timestamptz not null default now(),
  otorgado_por    text not null default 'sistema',
  unique (system_user_id, permiso)
);

comment on table public.superadmin_permisos is
  'Permisos finos del superadministrador. Sin fila para un permiso, la acción se deniega salvo que el usuario tenga el comodín "todo".';

alter table public.superadmin_permisos enable row level security;

drop policy if exists superadmin_permisos_admin on public.superadmin_permisos;
create policy superadmin_permisos_admin on public.superadmin_permisos
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Catálogo de permisos reconocidos, para referencia de quien lea esto:
--   todo                comodín, concede cualquier permiso
--   ver_cuentas         entrar al backoffice
--   iniciar_prueba      arrancar o extender el periodo de prueba
--   marcar_implementacion  congelar la ventana de activación
--   desbloquear         reabrir una cuenta bloqueada por no activar
--   emitir_factura      emisión manual
--   conciliar_pagos     aprobar o rechazar comprobantes
--   cancelar_cuenta     tramitar una baja en nombre del cliente
--   reactivar_cuenta    devolver al servicio una cuenta cancelada
--   purgar_datos        borrado definitivo (todavía sin implementar)
--   impersonar          ver la plataforma como un cliente

insert into public.superadmin_permisos (system_user_id, permiso, otorgado_por)
select su.id, 'todo', 'migracion:faseB'
from public.system_users su
on conflict (system_user_id, permiso) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Comprobación de permiso
-- ----------------------------------------------------------------------------
create or replace function public.tiene_permiso_superadmin(p_permiso text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.superadmin_permisos sp
    where sp.system_user_id = auth.uid()
      and sp.permiso in (p_permiso, 'todo')
  );
$$;

comment on function public.tiene_permiso_superadmin(text) is
  'TRUE si el usuario de la petición es superadmin y tiene ese permiso (o el comodín "todo").';

-- Atajo que se usará en todos los RPC de administración.
create or replace function public.exigir_permiso_superadmin(p_permiso text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Esta acción es solo para administradores de la plataforma'
      using errcode = '42501';
  end if;
  if not public.tiene_permiso_superadmin(p_permiso) then
    raise exception 'No tienes el permiso "%"', p_permiso using errcode = '42501';
  end if;
end;
$$;

grant select on public.superadmin_permisos to authenticated;
grant all    on public.superadmin_permisos to service_role;
grant execute on function public.tiene_permiso_superadmin(text)  to authenticated, service_role;
grant execute on function public.exigir_permiso_superadmin(text) to authenticated, service_role;

commit;

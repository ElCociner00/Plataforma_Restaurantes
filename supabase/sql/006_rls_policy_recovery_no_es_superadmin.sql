-- 2026-07-21 - Recuperación RLS por políticas que referencian columna inexistente `es_superadmin`.
-- Ejecutar en Supabase SQL Editor con rol owner/service_role. NO se puede ejecutar con anon public key.
-- Objetivo: identificar políticas rotas y reemplazar el chequeo de superadmin por una función estable.

create or replace function public.current_user_is_admin_root()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.system_users su
    where lower(coalesce(su.correo, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ) or exists (
    select 1
    from public.usuarios_sistema us
    where us.id = auth.uid()
      and lower(coalesce(us.rol, '')) = 'admin_root'
      and coalesce(us.activo, true) = true
  );
$$;

grant execute on function public.current_user_is_admin_root() to anon, authenticated;

-- Diagnóstico: políticas que todavía contienen la referencia rota.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual ilike '%es_superadmin%' or with_check ilike '%es_superadmin%')
order by tablename, policyname;

-- Generador de SQL para revisar/recrear manualmente cada política afectada.
-- Copia cada salida, revisa que conserve el resto de condiciones de tenant/empresa,
-- y reemplaza SOLO la referencia a es_superadmin por public.current_user_is_admin_root().
select format(
  '-- Revisar política rota: %I.%I / %I / cmd=%s%s%s',
  schemaname,
  tablename,
  policyname,
  cmd,
  E'\n-- USING actual: ',
  coalesce(qual, '<sin using>')
) as politica_a_revisar
from pg_policies
where schemaname = 'public'
  and (qual ilike '%es_superadmin%' or with_check ilike '%es_superadmin%')
order by tablename, policyname;

-- Plantillas seguras para las tablas reportadas en consola. Ajustar nombres de políticas si ya existen.
-- Estas políticas NO borran políticas existentes; primero corrige o elimina las políticas rotas detectadas arriba.

do $$
begin
  create policy usuarios_sistema_select_self_empresa_admin
  on public.usuarios_sistema
  for select
  to authenticated
  using (
    id = auth.uid()
    or empresa_id in (select us.empresa_id from public.usuarios_sistema us where us.id = auth.uid())
    or public.current_user_is_admin_root()
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy otros_usuarios_select_empresa_admin
  on public.otros_usuarios
  for select
  to authenticated
  using (
    empresa_id in (select us.empresa_id from public.usuarios_sistema us where us.id = auth.uid())
    or public.current_user_is_admin_root()
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy empleados_select_empresa_admin
  on public.empleados
  for select
  to authenticated
  using (
    empresa_id in (select us.empresa_id from public.usuarios_sistema us where us.id = auth.uid())
    or public.current_user_is_admin_root()
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy empresas_select_contexto_admin
  on public.empresas
  for select
  to authenticated
  using (
    id in (select us.empresa_id from public.usuarios_sistema us where us.id = auth.uid())
    or id in (select ul.empresa_id from public.usuarios_locales ul where ul.id = auth.uid() or ul.usuario_principal_id = auth.uid())
    or public.current_user_is_admin_root()
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy billing_cycles_select_empresa_admin
  on public.billing_cycles
  for select
  to authenticated
  using (
    empresa_id in (select us.empresa_id from public.usuarios_sistema us where us.id = auth.uid())
    or empresa_id in (select ul.empresa_id from public.usuarios_locales ul where ul.id = auth.uid() or ul.usuario_principal_id = auth.uid())
    or public.current_user_is_admin_root()
  );
exception when duplicate_object then null;
end $$;

-- Verificación final: debe retornar 0 filas antes de probar la plataforma.
select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (qual ilike '%es_superadmin%' or with_check ilike '%es_superadmin%')
order by tablename, policyname;

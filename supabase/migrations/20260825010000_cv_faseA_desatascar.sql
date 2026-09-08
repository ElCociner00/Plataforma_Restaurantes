-- ============================================================================
-- CICLO DE VIDA · FASE A — Desatascar
--
-- Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §0 y §3 Fase A
--
-- current_empresa_id() estaba rota desde el init:
--
--     and lower(coalesce(ou.estado, 'activo')) <> 'inactivo'
--                          ↑ boolean      ↑ texto
--
-- PostgreSQL intenta convertir el literal 'activo' a booleano AL PREPARAR la
-- función, no al ejecutar la rama, así que el coalesce nunca llega a
-- cortocircuitar y falla siempre, para todos:
--
--     ERROR 22P02: invalid input syntax for type boolean: "activo"
--     CONTEXT: SQL function "current_empresa_id" during startup
--
-- No había explotado porque nadie la llamaba: facturación usaba
-- get_my_empresa_id(), que solo mira usuarios_sistema. El modelo de cuentas es
-- el primero que la ejercita.
--
-- Se lleva por delante dos cosas:
--   - /facturacion/ no carga para NINGÚN usuario
--   - las políticas comprobantes_pago_subir y comprobantes_pago_leer, que se
--     apoyan en ella, tampoco funcionan
-- ============================================================================

begin;

create or replace function public.current_empresa_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (
      select us.empresa_id
      from public.usuarios_sistema us
      where us.id = auth.uid()
        and coalesce(us.activo, true) = true
      limit 1
    ),
    (
      -- otros_usuarios.estado es BOOLEAN. Antes se comparaba contra el texto
      -- 'activo' y eso rompía la función entera.
      select ou.empresa_id
      from public.otros_usuarios ou
      where ou.id = auth.uid()
        and coalesce(ou.estado, true) = true
      limit 1
    )
  );
$$;

comment on function public.current_empresa_id() is
  'Empresa efectiva del usuario de la petición. Contempla usuarios_sistema y otros_usuarios, a diferencia de get_my_empresa_id(). Corregida 2026-08-25: comparaba un booleano contra texto y fallaba siempre.';

-- ----------------------------------------------------------------------------
-- is_super_admin() no fijaba search_path.
--
-- Una función SECURITY DEFINER sin search_path fijo se resuelve contra el
-- search_path de quien la llama: quien pueda crear objetos en un esquema que
-- vaya antes puede secuestrar la referencia a `public.system_users` y hacerse
-- pasar por superadmin. Se fija, y se referencia el esquema explícitamente.
-- ----------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.system_users where id = auth.uid()
  );
$$;

commit;

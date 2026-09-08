-- =============================================================================
-- 007 · Políticas RLS para registro self-service (Google OAuth)
-- Fecha: 2026-08-21
-- Contexto: Fase 2 — eliminación de los webhooks n8n del flujo de registro.
-- =============================================================================
--
-- POR QUÉ HACE FALTA
-- ------------------
-- El registro lo ejecutaba n8n con la service_role key, que IGNORA RLS. Al
-- mover los inserts al navegador, la petición corre como rol `authenticated`
-- y RLS SÍ aplica. Sin estas dos políticas, el registro falla con:
--     new row violates row-level security policy for table "empresas"
--
-- ALCANCE
-- -------
-- Solo CREATE POLICY. Ningún DROP, ALTER, TRUNCATE, DELETE ni UPDATE activo.
-- Ninguna tabla ni fila existente se modifica. RLS ya está habilitado en ambas
-- tablas, así que no hace falta ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
--
-- Ejecutar en Supabase → SQL Editor con rol owner/service_role.
-- =============================================================================


-- =============================================================================
-- 1 · INSERT SOBRE `empresas`
-- -----------------------------------------------------------------------------
-- Permite que un usuario autenticado cree UNA empresa, y solo si todavía no
-- pertenece a ninguna.
--
-- El guard `not exists (...)` es lo que impide el abuso evidente: sin él,
-- cualquier cuenta de Google podría crear empresas de forma ilimitada. Con él,
-- la política se agota en cuanto el usuario obtiene su fila en
-- usuarios_sistema, que es justo el segundo insert del registro.
--
-- No concede SELECT: la lectura la siguen gobernando las políticas ya
-- existentes. Por eso el frontend genera el UUID con crypto.randomUUID() y lo
-- envía explícito, en vez de depender de un RETURNING que RLS bloquearía.
-- =============================================================================

create policy empresas_insert_self_registro
on public.empresas
for insert
to authenticated
with check (
  not exists (
    select 1
    from public.usuarios_sistema us
    where us.id = auth.uid()
  )
);


-- =============================================================================
-- 2 · INSERT SOBRE `usuarios_sistema`
-- -----------------------------------------------------------------------------
-- Permite que el usuario cree SU PROPIA fila, y solo esa. Tres candados:
--
--   a. id = auth.uid()
--      Impide crear filas a nombre de otra persona. Es además exactamente lo
--      que js/session.js exige para resolver el contexto:
--          .from("usuarios_sistema").eq("id", user.id)
--
--   b. El usuario no tiene ya una fila. Una sola identidad por cuenta.
--
--   c. La empresa destino no tiene todavía ningún usuario.
--      Este es el candado importante: sin él, alguien podría insertarse como
--      admin_root dentro de una empresa AJENA ya existente. Al exigir que la
--      empresa esté vacía, solo puede reclamar la que acaba de crear.
--
-- Sobre la cualificación `usuarios_sistema.empresa_id` en el último subquery:
-- dentro de un WITH CHECK, el nombre de la tabla referencia la FILA NUEVA. El
-- subquery usa el alias us3 precisamente para que `empresa_id` sin cualificar
-- no se resuelva contra la tabla del subquery.
--
-- El rol se fija a 'admin_root' porque es el primer usuario y dueño del tenant.
-- =============================================================================

create policy usuarios_sistema_insert_self_registro
on public.usuarios_sistema
for insert
to authenticated
with check (
  id = auth.uid()
  and lower(coalesce(rol, '')) = 'admin_root'
  and not exists (
    select 1
    from public.usuarios_sistema us2
    where us2.id = auth.uid()
  )
  and not exists (
    select 1
    from public.usuarios_sistema us3
    where us3.empresa_id = usuarios_sistema.empresa_id
  )
);


-- =============================================================================
-- 3 · VERIFICACIÓN (solo lectura)
-- Debe devolver exactamente las dos políticas creadas arriba.
-- =============================================================================

select tablename, policyname, cmd, roles, with_check
from pg_policies
where schemaname = 'public'
  and policyname in (
    'empresas_insert_self_registro',
    'usuarios_sistema_insert_self_registro'
  )
order by tablename;


-- =============================================================================
-- CÓMO REVERTIR
-- -----------------------------------------------------------------------------
-- Eliminan ÚNICAMENTE las políticas creadas por este archivo. No tocan datos ni
-- estructura. Comentadas a propósito: descoméntalas solo si necesitas deshacer.
--
--   drop policy empresas_insert_self_registro on public.empresas;
--   drop policy usuarios_sistema_insert_self_registro on public.usuarios_sistema;
-- =============================================================================

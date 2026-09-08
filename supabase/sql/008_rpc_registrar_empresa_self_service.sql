-- =============================================================================
-- 008 · RPC atómico de registro self-service
-- Fecha: 2026-08-21
-- Contexto: Fase 2 — elimina el riesgo de empresa huérfana.
-- =============================================================================
--
-- EL PROBLEMA QUE RESUELVE
-- -----------------------
-- El frontend hacía dos inserts encadenados: primero `empresas`, después
-- `usuarios_sistema`. Son dos peticiones HTTP distintas, así que no comparten
-- transacción: si la segunda fallaba (o el usuario cerraba la pestaña entre
-- una y otra), la empresa quedaba creada sin dueño. Una fila huérfana que
-- además bloquea el NIT para siempre por la restricción de unicidad.
--
-- Una función de PostgreSQL corre dentro de una única transacción implícita:
-- o se insertan las dos filas, o no se inserta ninguna. No hay estado
-- intermedio posible.
--
-- SOBRE SECURITY DEFINER
-- ----------------------
-- La función se ejecuta con los privilegios de su propietario, así que IGNORA
-- RLS. Eso es justo lo que necesitamos, y también lo que la vuelve peligrosa:
-- toda la autorización tiene que hacerla ella misma. Los cuatro guardas del
-- cuerpo (autenticación, unicidad de identidad, datos obligatorios, NIT libre)
-- no son validación cosmética; son el control de acceso.
--
-- Dos detalles de endurecimiento que no son opcionales:
--   · `set search_path = public` evita que un search_path manipulado por el
--     llamante redirija las tablas a un esquema falso.
--   · El REVOKE del final es necesario porque PostgreSQL concede EXECUTE a
--     PUBLIC por defecto en cada función nueva. Sin él, el rol `anon` podría
--     invocar una función que ignora RLS.
--
-- ALCANCE
-- -------
-- CREATE FUNCTION + REVOKE/GRANT sobre esa misma función. No hay DROP, ALTER,
-- TRUNCATE, DELETE ni UPDATE. Ninguna tabla ni fila existente se modifica.
--
-- Ejecutar en Supabase → SQL Editor con rol owner/service_role.
-- =============================================================================


create or replace function public.registrar_empresa_self_service(
  p_nombre_comercial text,
  p_razon_social     text,
  p_nit              text,
  p_correo_empresa   text,
  p_nombre_completo  text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid        uuid := auth.uid();
  v_empresa_id uuid;
  v_nit        text := btrim(coalesce(p_nit, ''));
begin
  -- --------------------------------------------------------------------
  -- Guarda 1 · autenticación
  -- Sin sesión no hay auth.uid(), y usuarios_sistema.id DEBE ser igual a
  -- ese valor: es lo que js/session.js busca para resolver el contexto.
  -- --------------------------------------------------------------------
  if v_uid is null then
    raise exception 'Debes iniciar sesión para registrar una empresa.'
      using errcode = 'EK001';
  end if;

  -- --------------------------------------------------------------------
  -- Guarda 2 · una identidad por cuenta
  -- Impide que alguien ya registrado cree empresas de forma ilimitada.
  -- --------------------------------------------------------------------
  if exists (select 1 from public.usuarios_sistema us where us.id = v_uid) then
    raise exception 'Tu cuenta ya pertenece a una empresa.'
      using errcode = 'EK002';
  end if;

  -- --------------------------------------------------------------------
  -- Guarda 3 · datos obligatorios
  -- El navegador ya valida, pero un RPC es un endpoint público: cualquiera
  -- con la anon key puede llamarlo saltándose el formulario.
  -- --------------------------------------------------------------------
  if coalesce(btrim(p_nombre_comercial), '') = ''
     or coalesce(btrim(p_razon_social), '')   = ''
     or v_nit                                  = ''
     or coalesce(btrim(p_correo_empresa), '')  = ''
     or coalesce(btrim(p_nombre_completo), '') = '' then
    raise exception 'Faltan datos obligatorios del registro.'
      using errcode = 'EK004';
  end if;

  -- --------------------------------------------------------------------
  -- Guarda 4 · NIT libre
  -- Se comprueba antes de insertar para devolver un error legible en vez
  -- del 23505 crudo de la restricción de unicidad.
  -- --------------------------------------------------------------------
  if exists (select 1 from public.empresas e where e.nit = v_nit) then
    raise exception 'Ese NIT ya está registrado.'
      using errcode = 'EK003';
  end if;

  -- --------------------------------------------------------------------
  -- Inserts · ambos o ninguno
  -- `id` se omite a propósito: la columna tiene default gen_random_uuid()
  -- y el RETURNING nos lo devuelve. Al correr como definer, aquí sí
  -- funciona el RETURNING, que era lo que RLS bloqueaba desde el cliente.
  --
  -- `activa` y `activo` van explícitos en true para que la empresa no
  -- nazca inactiva. `plan` y `plan_actual` se dejan al default de la
  -- tabla, que es de donde depende la lógica de facturación.
  -- --------------------------------------------------------------------
  insert into public.empresas (
    nombre_comercial, razon_social, nit, correo_empresa, activa, activo
  )
  values (
    btrim(p_nombre_comercial),
    btrim(p_razon_social),
    v_nit,
    btrim(p_correo_empresa),
    true,
    true
  )
  returning id into v_empresa_id;

  insert into public.usuarios_sistema (
    id, empresa_id, nombre_completo, rol, activo
  )
  values (
    v_uid,
    v_empresa_id,
    btrim(p_nombre_completo),
    'admin_root',
    true
  );

  return v_empresa_id;
end;
$$;


-- =============================================================================
-- PERMISOS
-- -----------------------------------------------------------------------------
-- PostgreSQL concede EXECUTE a PUBLIC por defecto. Hay que retirarlo antes de
-- concederlo solo a `authenticated`, o el rol anónimo podría invocar una
-- función que ignora RLS.
-- =============================================================================

revoke execute on function public.registrar_empresa_self_service(text, text, text, text, text) from public;
revoke execute on function public.registrar_empresa_self_service(text, text, text, text, text) from anon;
grant  execute on function public.registrar_empresa_self_service(text, text, text, text, text) to authenticated;


-- =============================================================================
-- VERIFICACIÓN (solo lectura)
-- =============================================================================

select p.proname,
       pg_get_function_identity_arguments(p.oid) as argumentos,
       p.prosecdef                               as es_security_definer,
       p.proconfig                               as search_path,
       array(
         select grantee
         from information_schema.routine_privileges rp
         where rp.specific_name = p.proname || '_' || p.oid
       )                                          as quien_puede_ejecutar
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'registrar_empresa_self_service';


-- =============================================================================
-- OPCIONAL · retirar las políticas de INSERT del archivo 007
-- -----------------------------------------------------------------------------
-- Con el RPC en funcionamiento, el frontend ya NO inserta directamente en esas
-- tablas, así que las dos políticas de 007 dejan de hacer falta. Retirarlas
-- deja la superficie mínima: el único camino de escritura pasa a ser esta
-- función, con sus cuatro guardas.
--
-- Hazlo solo DESPUÉS de comprobar que el registro funciona de punta a punta,
-- porque revertir el frontend al método anterior las necesitaría de vuelta.
--
--   drop policy empresas_insert_self_registro on public.empresas;
--   drop policy usuarios_sistema_insert_self_registro on public.usuarios_sistema;
--
--
-- NOTA SOBRE PRUEBAS PREVIAS
-- -----------------------------------------------------------------------------
-- Si durante las pruebas del método anterior quedó alguna empresa huérfana
-- (creada sin su fila en usuarios_sistema), su NIT sigue ocupado y el registro
-- con ese mismo NIT fallará con EK003. Para localizarlas:
--
--   select e.id, e.nit, e.nombre_comercial, e.created_at
--   from public.empresas e
--   where not exists (
--     select 1 from public.usuarios_sistema us where us.empresa_id = e.id
--   )
--   order by e.created_at desc;
--
-- La limpieza es decisión tuya; este script no borra nada.
-- =============================================================================

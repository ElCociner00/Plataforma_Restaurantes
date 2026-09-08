-- Auditoría exclusivamente de lectura para reconciliar migraciones locales
-- pendientes con el esquema real del proyecto Supabase vinculado.

select 'VIEWS' as section;
select
  c.relname as object_name,
  coalesce(array_to_string(c.reloptions, ','), '') as options,
  has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
  md5(pg_get_viewdef(c.oid, true)) as definition_md5
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname in (
    'v_turnos_lineas', 'v_turnos_pivote', 'v_dias_operacion'
  )
order by c.relname;

select 'FUNCTIONS' as section;
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as arguments,
  case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
  coalesce(array_to_string(p.proconfig, ','), '') as config,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
  position('estÃ' in pg_get_functiondef(p.oid)) > 0
    or position('recibiÃ' in pg_get_functiondef(p.oid)) > 0 as mojibake,
  md5(pg_get_functiondef(p.oid)) as definition_md5
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'parse_hora', 'dashboard_sedes', 'dashboard_dias_pendientes',
    'marcar_dia_operacion', 'dashboard_conciliacion', 'dashboard_ventas',
    'dashboard_ventas_responsable', 'billing_daily_enforcer',
    'cuenta_de_empresa', 'mi_cuenta_id', 'calcular_monto_cuenta',
    'cuenta_al_dia', 'siguiente_numero_factura', 'monto_en_letras',
    'tres_cifras_en_letras', 'apocope_mil', 'referencia_de_factura',
    'factura_por_referencia', 'emitir_factura_cuenta', 'factura_a_pagar',
    'registrar_pago_confirmado', 'revertir_pago', 'iniciar_prueba',
    'estado_facturacion_empresa', 'aprobar_pago', 'rechazar_pago',
    'facturacion_ciclo_diario', 'cuentas_backoffice',
    'emitir_factura_manual', 'current_empresa_id', 'is_super_admin',
    'tiene_permiso_superadmin', 'exigir_permiso_superadmin',
    'acceso_de_empresa', 'registrar_empresa_self_service',
    'activar_prueba_cliente', 'marcar_implementacion',
    'desbloquear_cuenta', 'solicitar_baja', 'reactivar_cuenta',
    'ciclo_vida_diario', 'metricas_facturacion', 'pagos_por_conciliar',
    'exigir_acceso_escritura', 'subir_cierre_turno',
    'guardar_parametros_nomina', 'cuentas_banco_pruebas_guarda',
    'factura_de_prueba', 'anular_factura_no_pagada',
    'cambiar_modalidad_factura'
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

select 'TABLES_AND_RLS' as section;
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
  has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
  has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
  count(pol.oid) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy pol on pol.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'dias_operacion_estado', 'billing_observaciones', 'cuentas',
    'cuenta_empresas', 'suscripciones', 'facturas_suscripcion',
    'pagos_suscripcion', 'pasarela_eventos', 'suscripcion_bitacora',
    'superadmin_permisos', 'terminos_versiones', 'aceptaciones_terminos',
    'bajas_suscripcion'
  )
group by c.oid, c.relname, c.relrowsecurity
order by c.relname;

select 'EXPECTED_COLUMNS' as section;
select table_name, string_agg(column_name, ',' order by ordinal_position) as columns
from information_schema.columns
where table_schema = 'public'
  and table_name in ('planes', 'cuentas', 'suscripciones')
group by table_name
order by table_name;

select 'CHECK_CONSTRAINTS' as section;
select
  c.conrelid::regclass::text as table_name,
  c.conname,
  pg_get_constraintdef(c.oid, true) as definition
from pg_constraint c
where c.conrelid in (
  'public.cuentas'::regclass,
  'public.suscripciones'::regclass,
  'public.pasarela_eventos'::regclass
)
  and c.contype = 'c'
order by table_name, c.conname;

select 'ROW_COUNTS' as section;
select 'billing_observaciones' as object_name, count(*)::bigint as row_count from public.billing_observaciones
union all select 'cuentas', count(*) from public.cuentas
union all select 'cuenta_empresas', count(*) from public.cuenta_empresas
union all select 'suscripciones', count(*) from public.suscripciones
union all select 'facturas_suscripcion', count(*) from public.facturas_suscripcion
union all select 'pagos_suscripcion', count(*) from public.pagos_suscripcion
union all select 'pasarela_eventos', count(*) from public.pasarela_eventos
union all select 'suscripcion_bitacora', count(*) from public.suscripcion_bitacora
union all select 'superadmin_permisos', count(*) from public.superadmin_permisos
union all select 'terminos_versiones', count(*) from public.terminos_versiones
union all select 'aceptaciones_terminos', count(*) from public.aceptaciones_terminos
union all select 'bajas_suscripcion', count(*) from public.bajas_suscripcion
order by object_name;

select 'ACCOUNT_STATE_SUMMARY' as section;
select tipo, estado, count(*) as accounts
from public.cuentas
group by tipo, estado
order by tipo, estado;

select 'SUBSCRIPTION_STATE_SUMMARY' as section;
select plan_id, periodicidad, estado, count(*) as subscriptions
from public.suscripciones
group by plan_id, periodicidad, estado
order by plan_id, periodicidad, estado;

select 'TARGETED_INVOICE' as section;
select
  f.numero,
  f.estado,
  f.periodo_desde,
  f.periodo_hasta,
  f.total,
  count(p.id) as payments
from public.facturas_suscripcion f
left join public.pagos_suscripcion p on p.factura_id = f.id
where f.numero = 'AX-01004'
group by f.id, f.numero, f.estado, f.periodo_desde, f.periodo_hasta, f.total;

select 'TERMS' as section;
select
  version,
  vigente,
  publicado_en,
  length(contenido_html) as content_length
from public.terminos_versiones
order by publicado_en, version;

select 'CRON' as section;
select jobname, schedule, active
from cron.job
where jobname in (
  'billing-crear-ciclos', 'facturacion-ciclo-diario', 'rappi-worker-v1'
)
   or jobname like 'rappi-operational-%'
   or jobname like 'rappi-financial-%'
order by jobname;

select 'MIGRATION_HISTORY' as section;
select version, name
from supabase_migrations.schema_migrations
where version > '20260823160000'
order by version;

-- La API de administración devuelve el último resultset. Este resumen único
-- conserva todos los hallazgos anteriores en un objeto JSON auditable.
with
view_audit as (
  select
    c.relname as object_name,
    coalesce(array_to_string(c.reloptions, ','), '') as options,
    has_table_privilege('anon', c.oid, 'SELECT') as anon_select,
    has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
    md5(pg_get_viewdef(c.oid, true)) as definition_md5
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'v'
    and c.relname in ('v_turnos_lineas', 'v_turnos_pivote', 'v_dias_operacion')
),
function_audit as (
  select
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as arguments,
    case when p.prosecdef then 'DEFINER' else 'INVOKER' end as security,
    coalesce(array_to_string(p.proconfig, ','), '') as config,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') as service_execute,
    position('estÃ' in pg_get_functiondef(p.oid)) > 0
      or position('recibiÃ' in pg_get_functiondef(p.oid)) > 0 as mojibake,
    md5(pg_get_functiondef(p.oid)) as definition_md5
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'parse_hora', 'dashboard_sedes', 'dashboard_dias_pendientes',
      'marcar_dia_operacion', 'dashboard_conciliacion', 'dashboard_ventas',
      'dashboard_ventas_responsable', 'billing_daily_enforcer',
      'cuenta_de_empresa', 'mi_cuenta_id', 'calcular_monto_cuenta',
      'cuenta_al_dia', 'siguiente_numero_factura', 'monto_en_letras',
      'tres_cifras_en_letras', 'apocope_mil', 'referencia_de_factura',
      'factura_por_referencia', 'emitir_factura_cuenta', 'factura_a_pagar',
      'registrar_pago_confirmado', 'revertir_pago', 'iniciar_prueba',
      'estado_facturacion_empresa', 'aprobar_pago', 'rechazar_pago',
      'facturacion_ciclo_diario', 'cuentas_backoffice',
      'emitir_factura_manual', 'current_empresa_id', 'is_super_admin',
      'tiene_permiso_superadmin', 'exigir_permiso_superadmin',
      'acceso_de_empresa', 'registrar_empresa_self_service',
      'activar_prueba_cliente', 'marcar_implementacion',
      'desbloquear_cuenta', 'solicitar_baja', 'reactivar_cuenta',
      'ciclo_vida_diario', 'metricas_facturacion', 'pagos_por_conciliar',
      'exigir_acceso_escritura', 'subir_cierre_turno',
      'guardar_parametros_nomina', 'cuentas_banco_pruebas_guarda',
      'factura_de_prueba', 'anular_factura_no_pagada',
      'cambiar_modalidad_factura'
    )
),
table_audit as (
  select
    c.relname as table_name,
    c.relrowsecurity as rls_enabled,
    has_table_privilege('anon', c.oid, 'INSERT') as anon_insert,
    has_table_privilege('anon', c.oid, 'UPDATE') as anon_update,
    has_table_privilege('authenticated', c.oid, 'INSERT') as authenticated_insert,
    has_table_privilege('authenticated', c.oid, 'UPDATE') as authenticated_update,
    count(pol.oid) as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy pol on pol.polrelid = c.oid
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in (
      'dias_operacion_estado', 'billing_observaciones', 'cuentas',
      'cuenta_empresas', 'suscripciones', 'facturas_suscripcion',
      'pagos_suscripcion', 'pasarela_eventos', 'suscripcion_bitacora',
      'superadmin_permisos', 'terminos_versiones', 'aceptaciones_terminos',
      'bajas_suscripcion'
    )
  group by c.oid, c.relname, c.relrowsecurity
),
column_audit as (
  select table_name, string_agg(column_name, ',' order by ordinal_position) as columns
  from information_schema.columns
  where table_schema = 'public' and table_name in ('planes', 'cuentas', 'suscripciones')
  group by table_name
),
constraint_audit as (
  select c.conrelid::regclass::text as table_name, c.conname,
         pg_get_constraintdef(c.oid, true) as definition
  from pg_constraint c
  where c.conrelid in (
    'public.cuentas'::regclass, 'public.suscripciones'::regclass,
    'public.pasarela_eventos'::regclass
  ) and c.contype = 'c'
),
count_audit as (
  select 'billing_observaciones' as object_name, count(*)::bigint as row_count from public.billing_observaciones
  union all select 'cuentas', count(*) from public.cuentas
  union all select 'cuenta_empresas', count(*) from public.cuenta_empresas
  union all select 'suscripciones', count(*) from public.suscripciones
  union all select 'facturas_suscripcion', count(*) from public.facturas_suscripcion
  union all select 'pagos_suscripcion', count(*) from public.pagos_suscripcion
  union all select 'pasarela_eventos', count(*) from public.pasarela_eventos
  union all select 'suscripcion_bitacora', count(*) from public.suscripcion_bitacora
  union all select 'superadmin_permisos', count(*) from public.superadmin_permisos
  union all select 'terminos_versiones', count(*) from public.terminos_versiones
  union all select 'aceptaciones_terminos', count(*) from public.aceptaciones_terminos
  union all select 'bajas_suscripcion', count(*) from public.bajas_suscripcion
),
account_audit as (
  select tipo, estado, count(*) as accounts from public.cuentas group by tipo, estado
),
subscription_audit as (
  select plan_id, periodicidad, estado, count(*) as subscriptions
  from public.suscripciones group by plan_id, periodicidad, estado
),
invoice_audit as (
  select f.numero, f.estado, f.periodo_desde, f.periodo_hasta, f.total,
         count(p.id) as payments
  from public.facturas_suscripcion f
  left join public.pagos_suscripcion p on p.factura_id = f.id
  where f.numero = 'AX-01004'
  group by f.id, f.numero, f.estado, f.periodo_desde, f.periodo_hasta, f.total
),
term_audit as (
  select version, vigente, publicado_en, length(contenido_html) as content_length
  from public.terminos_versiones
),
cron_audit as (
  select jobname, schedule, active from cron.job
  where jobname in ('billing-crear-ciclos', 'facturacion-ciclo-diario', 'rappi-worker-v1')
     or jobname like 'rappi-operational-%' or jobname like 'rappi-financial-%'
),
migration_audit as (
  select version, name from supabase_migrations.schema_migrations
  where version > '20260823160000'
)
select jsonb_build_object(
  'views', coalesce((select jsonb_agg(to_jsonb(x) order by object_name) from view_audit x), '[]'::jsonb),
  'functions', coalesce((select jsonb_agg(to_jsonb(x) order by function_name, arguments) from function_audit x), '[]'::jsonb),
  'tables', coalesce((select jsonb_agg(to_jsonb(x) order by table_name) from table_audit x), '[]'::jsonb),
  'columns', coalesce((select jsonb_agg(to_jsonb(x) order by table_name) from column_audit x), '[]'::jsonb),
  'constraints', coalesce((select jsonb_agg(to_jsonb(x) order by table_name, conname) from constraint_audit x), '[]'::jsonb),
  'row_counts', coalesce((select jsonb_agg(to_jsonb(x) order by object_name) from count_audit x), '[]'::jsonb),
  'account_states', coalesce((select jsonb_agg(to_jsonb(x) order by tipo, estado) from account_audit x), '[]'::jsonb),
  'subscription_states', coalesce((select jsonb_agg(to_jsonb(x) order by plan_id, periodicidad, estado) from subscription_audit x), '[]'::jsonb),
  'targeted_invoice', coalesce((select jsonb_agg(to_jsonb(x)) from invoice_audit x), '[]'::jsonb),
  'terms', coalesce((select jsonb_agg(to_jsonb(x) order by publicado_en, version) from term_audit x), '[]'::jsonb),
  'cron', coalesce((select jsonb_agg(to_jsonb(x) order by jobname) from cron_audit x), '[]'::jsonb),
  'migration_history', coalesce((select jsonb_agg(to_jsonb(x) order by version) from migration_audit x), '[]'::jsonb)
) as audit;

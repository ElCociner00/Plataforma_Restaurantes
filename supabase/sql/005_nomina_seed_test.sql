-- 005_nomina_seed_test.sql
-- Datos de prueba para una empresa test (ajusta los UUID antes de ejecutar)

begin;

-- Reemplaza estos valores por IDs reales de tu entorno de pruebas
-- empresa_id: una empresa existente en public.empresas
-- admin_user_id / empleado_*: IDs de usuarios en usuarios_sistema
with vars as (
  select
    '00000000-0000-0000-0000-000000000001'::uuid as empresa_id,
    '00000000-0000-0000-0000-000000000010'::uuid as admin_user_id,
    '00000000-0000-0000-0000-000000000011'::uuid as empleado_a,
    '00000000-0000-0000-0000-000000000012'::uuid as empleado_b
),
upsert_reglas as (
  insert into public.nomina_reglas_empresa (
    empresa_id,
    corte,
    porcentaje_descuento_fallas,
    reconocimiento_apoyo_por_hora,
    porcentaje_propina_para_nomina,
    activo
  )
  select
    empresa_id,
    'quincenal',
    100,
    7000,
    100,
    true
  from vars
  on conflict (empresa_id) do update
  set
    corte = excluded.corte,
    porcentaje_descuento_fallas = excluded.porcentaje_descuento_fallas,
    reconocimiento_apoyo_por_hora = excluded.reconocimiento_apoyo_por_hora,
    porcentaje_propina_para_nomina = excluded.porcentaje_propina_para_nomina,
    activo = excluded.activo,
    updated_at = now()
  returning empresa_id
),
periodo as (
  insert into public.nomina_periodos (
    empresa_id,
    fecha_inicio,
    fecha_fin,
    corte,
    estado,
    creado_por,
    metadata
  )
  select
    v.empresa_id,
    date '2026-04-01',
    date '2026-04-15',
    'quincenal',
    'abierto',
    v.admin_user_id,
    jsonb_build_object('origen', 'seed_test')
  from vars v
  on conflict (empresa_id, fecha_inicio, fecha_fin)
  do update set updated_at = now()
  returning id, empresa_id
),
turnos as (
  insert into public.turnos_programados (
    empresa_id,
    usuario_id,
    fecha,
    hora_inicio_programada,
    hora_fin_programada,
    area,
    metadata
  )
  select p.empresa_id, v.empleado_a, date '2026-04-03', time '08:00', time '17:00', 'cocina', '{}'::jsonb
  from periodo p join vars v on true
  union all
  select p.empresa_id, v.empleado_b, date '2026-04-03', time '09:00', time '18:00', 'caja', '{}'::jsonb
  from periodo p join vars v on true
  returning id
),
apoyo as (
  insert into public.turno_apoyos (
    empresa_id,
    fecha,
    usuario_apoyo_id,
    usuario_beneficiado_id,
    minutos_apoyo,
    tipo_reconocimiento,
    valor_reconocimiento,
    aprobado,
    aprobado_por,
    observaciones,
    metadata
  )
  select
    p.empresa_id,
    date '2026-04-03',
    v.empleado_b,
    v.empleado_a,
    90,
    'bono_por_hora',
    10500,
    true,
    v.admin_user_id,
    'Apoyo en cierre de cocina por alta demanda',
    jsonb_build_object('origen', 'seed_test')
  from periodo p
  join vars v on true
  returning id, empresa_id
)
insert into public.nomina_movimientos (
  empresa_id,
  periodo_id,
  usuario_id,
  tipo,
  naturaleza,
  valor,
  fuente,
  fuente_id,
  descripcion,
  aprobado,
  aprobado_por,
  metadata
)
select p.empresa_id, p.id, v.empleado_a, 'base', 'devengo', 950000, 'sistema', null, 'Salario base proporcional quincenal', true, v.admin_user_id, '{}'::jsonb
from periodo p join vars v on true
union all
select p.empresa_id, p.id, v.empleado_a, 'bono_propina', 'devengo', 180000, 'cierre_turno', null, 'Propina acumulada del periodo', true, v.admin_user_id, '{}'::jsonb
from periodo p join vars v on true
union all
select p.empresa_id, p.id, v.empleado_a, 'descuento_inventario', 'deduccion', 30000, 'cierre_inventario', null, 'Faltante de inventario aplicado', true, v.admin_user_id, '{}'::jsonb
from periodo p join vars v on true
union all
select p.empresa_id, p.id, v.empleado_b, 'base', 'devengo', 900000, 'sistema', null, 'Salario base proporcional quincenal', true, v.admin_user_id, '{}'::jsonb
from periodo p join vars v on true
union all
select p.empresa_id, p.id, v.empleado_b, 'bono_apoyo', 'devengo', 10500, 'apoyo_turno', a.id, 'Reconocimiento por apoyo a otro turno', true, v.admin_user_id, '{}'::jsonb
from periodo p
join vars v on true
join apoyo a on a.empresa_id = p.empresa_id;

-- Genera desprendibles consolidados de prueba
insert into public.nomina_desprendibles (
  empresa_id,
  periodo_id,
  usuario_id,
  total_devengado,
  total_deducciones,
  total_neto,
  detalle_json,
  estado,
  creado_por
)
select
  r.empresa_id,
  r.periodo_id,
  r.usuario_id,
  r.total_devengado,
  r.total_deducciones,
  r.total_neto,
  jsonb_build_object('fuente', 'seed_test', 'cantidad_movimientos', r.cantidad_movimientos),
  'borrador',
  v.admin_user_id
from public.v_nomina_resumen r
join vars v on v.empresa_id = r.empresa_id
where r.periodo_id in (
  select id from public.nomina_periodos p where p.empresa_id = v.empresa_id and p.fecha_inicio = date '2026-04-01' and p.fecha_fin = date '2026-04-15'
)
on conflict (empresa_id, periodo_id, usuario_id)
do update set
  total_devengado = excluded.total_devengado,
  total_deducciones = excluded.total_deducciones,
  total_neto = excluded.total_neto,
  detalle_json = excluded.detalle_json,
  updated_at = now();

commit;

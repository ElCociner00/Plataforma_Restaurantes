-- 004_nomina_core.sql
-- Módulo de nómina multitenant (scaffold inicial)
-- Objetivo: crear tablas nuevas sin alterar módulos existentes.

begin;

-- =============================
-- 1) Catálogo de reglas nómina
-- =============================
create table if not exists public.nomina_reglas_empresa (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  corte text not null default 'quincenal' check (corte in ('quincenal','mensual')),
  porcentaje_descuento_fallas numeric(5,2) not null default 100,
  reconocimiento_apoyo_por_hora numeric(14,2) not null default 0,
  porcentaje_propina_para_nomina numeric(5,2) not null default 100,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id)
);

-- =============================
-- 2) Periodos de nómina
-- =============================
create table if not exists public.nomina_periodos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fecha_inicio date not null,
  fecha_fin date not null,
  corte text not null check (corte in ('quincenal','mensual')),
  estado text not null default 'abierto' check (estado in ('abierto','cerrado','liquidado')),
  creado_por uuid,
  cerrado_por uuid,
  liquidado_por uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio)
);

create unique index if not exists uq_nomina_periodo_empresa_rango
on public.nomina_periodos (empresa_id, fecha_inicio, fecha_fin);

-- ==================================
-- 3) Turnos programados (tabla base)
-- ==================================
create table if not exists public.turnos_programados (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  usuario_id uuid not null,
  fecha date not null,
  hora_inicio_programada time not null,
  hora_fin_programada time not null,
  area text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_turnos_programados_empresa_fecha
on public.turnos_programados (empresa_id, fecha, usuario_id);

-- =====================================
-- 4) Reconocimiento de apoyos entre turnos
-- =====================================
create table if not exists public.turno_apoyos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  fecha date not null,
  turno_origen_id uuid,
  turno_apoyado_id uuid,
  usuario_apoyo_id uuid not null,
  usuario_beneficiado_id uuid,
  minutos_apoyo integer not null default 0 check (minutos_apoyo >= 0),
  tipo_reconocimiento text not null default 'bono_por_hora'
    check (tipo_reconocimiento in ('bono_fijo','bono_por_hora','solo_reconocimiento')),
  valor_reconocimiento numeric(14,2) not null default 0,
  aprobado boolean not null default false,
  aprobado_por uuid,
  observaciones text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_turno_apoyos_empresa_fecha
on public.turno_apoyos (empresa_id, fecha, usuario_apoyo_id);

-- =====================================
-- 5) Movimientos de nómina por empleado
-- =====================================
create table if not exists public.nomina_movimientos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  periodo_id uuid not null references public.nomina_periodos(id) on delete cascade,
  usuario_id uuid not null,
  tipo text not null check (tipo in (
    'base','hora_extra','descuento_inventario','bono_propina','bono_apoyo','ajuste_manual','descuento_manual'
  )),
  naturaleza text not null check (naturaleza in ('devengo','deduccion')),
  valor numeric(14,2) not null,
  fuente text not null check (fuente in ('cierre_turno','cierre_inventario','apoyo_turno','manual','sistema')),
  fuente_id uuid,
  descripcion text,
  aprobado boolean not null default false,
  aprobado_por uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_nomina_mov_empresa_periodo_usuario
on public.nomina_movimientos (empresa_id, periodo_id, usuario_id);

create index if not exists idx_nomina_mov_fuente
on public.nomina_movimientos (empresa_id, fuente, fuente_id);

-- =====================================
-- 6) Desprendibles consolidados
-- =====================================
create table if not exists public.nomina_desprendibles (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  periodo_id uuid not null references public.nomina_periodos(id) on delete cascade,
  usuario_id uuid not null,
  total_devengado numeric(14,2) not null default 0,
  total_deducciones numeric(14,2) not null default 0,
  total_neto numeric(14,2) not null default 0,
  detalle_json jsonb not null default '[]'::jsonb,
  estado text not null default 'borrador' check (estado in ('borrador','emitido','entregado')),
  archivo_url text,
  creado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, periodo_id, usuario_id)
);

create index if not exists idx_nomina_desprendibles_empresa_periodo
on public.nomina_desprendibles (empresa_id, periodo_id);

-- =====================================
-- 7) Vista de resumen por empleado/periodo
-- =====================================
create or replace view public.v_nomina_resumen as
select
  m.empresa_id,
  m.periodo_id,
  m.usuario_id,
  sum(case when m.naturaleza = 'devengo' then m.valor else 0 end) as total_devengado,
  sum(case when m.naturaleza = 'deduccion' then m.valor else 0 end) as total_deducciones,
  sum(case when m.naturaleza = 'devengo' then m.valor else -m.valor end) as total_neto,
  count(*) as cantidad_movimientos
from public.nomina_movimientos m
group by m.empresa_id, m.periodo_id, m.usuario_id;

-- =====================================
-- 8) RLS (solo service_role de momento)
-- =====================================
alter table public.nomina_reglas_empresa enable row level security;
alter table public.nomina_periodos enable row level security;
alter table public.turnos_programados enable row level security;
alter table public.turno_apoyos enable row level security;
alter table public.nomina_movimientos enable row level security;
alter table public.nomina_desprendibles enable row level security;

drop policy if exists nomina_reglas_service_role_all on public.nomina_reglas_empresa;
create policy nomina_reglas_service_role_all on public.nomina_reglas_empresa
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists nomina_periodos_service_role_all on public.nomina_periodos;
create policy nomina_periodos_service_role_all on public.nomina_periodos
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists turnos_programados_service_role_all on public.turnos_programados;
create policy turnos_programados_service_role_all on public.turnos_programados
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists turno_apoyos_service_role_all on public.turno_apoyos;
create policy turno_apoyos_service_role_all on public.turno_apoyos
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists nomina_movimientos_service_role_all on public.nomina_movimientos;
create policy nomina_movimientos_service_role_all on public.nomina_movimientos
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists nomina_desprendibles_service_role_all on public.nomina_desprendibles;
create policy nomina_desprendibles_service_role_all on public.nomina_desprendibles
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

commit;

-- ============================================================================
-- FACTURACIÓN · FASE 1 — Modelo de datos
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §6.2 y §7 Fase 1
--
-- El principio rector (§6.1):
--
--     El acceso al producto lo decide LA CUENTA, no la empresa; y se resuelve
--     con UNA FECHA (cubierto_hasta) más la lista de facturas vencidas.
--     Un pago confirmado es lo único que mueve esa fecha.
--
-- Esto resuelve de raíz tres cosas que el modelo viejo no podía representar:
--   - Un pago anual (BATUT, cubierto hasta 2027-05-31).
--   - Una cuenta con varias sedes que paga UNA factura (§3.7).
--   - Un periodo de prueba cuyo reloj arranca cuando Andrés lo diga (§1.3).
--
-- Aditivo: no se borra ni se desconecta nada del modelo viejo todavía.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. planes — se amplía con las reglas de precio de §1.1
-- ----------------------------------------------------------------------------
alter table public.planes
  add column if not exists locales_incluidos      integer not null default 1,
  add column if not exists precio_local_adicional numeric not null default 0,
  add column if not exists descuento_anual_pct    numeric not null default 0,
  add column if not exists iva_porcentaje         numeric not null default 0,
  add column if not exists activo                 boolean not null default true;

comment on column public.planes.locales_incluidos is
  'Locales adicionales sin costo por encima de la sede principal. Con 1, una cuenta de 2 sedes paga solo el plan base.';

update public.planes
set locales_incluidos      = 1,
    precio_local_adicional = 30000,
    descuento_anual_pct    = 20,
    iva_porcentaje         = 0
where id = 'pro';

update public.planes
set locales_incluidos      = 1,
    precio_local_adicional = 0,
    descuento_anual_pct    = 0,
    iva_porcentaje         = 0
where id = 'free';

-- ----------------------------------------------------------------------------
-- 2. cuentas — el que paga
--
-- Separada de `empresas` a propósito. BATUT y BATUT Cartagena comparten marca
-- pero son dos cuentas: contacto de facturación distinto, vigencias
-- independientes, y Cartagena no entra como "local adicional" de BATUT (§1.3).
-- ----------------------------------------------------------------------------
create table if not exists public.cuentas (
  id                  uuid primary key default gen_random_uuid(),
  nombre              text not null,
  nit                 text not null default '',
  ciudad              text not null default '',
  correo_facturacion  text not null default '',
  contacto_nombre     text not null default '',
  contacto_telefono   text not null default '',
  tipo                text not null default 'cliente'
                        check (tipo in ('cliente', 'interna', 'cortesia')),
  estado              text not null default 'implementacion'
                        check (estado in ('implementacion', 'prueba', 'activa',
                                          'morosa', 'restringida', 'cancelada')),
  notas               text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table  public.cuentas is 'El cliente que paga. Una cuenta agrupa una o varias empresas (sedes).';
comment on column public.cuentas.tipo is 'cliente = se le factura. interna/cortesia = nunca se le emite factura ni se le restringe.';

-- ----------------------------------------------------------------------------
-- 3. cuenta_empresas — qué sedes cubre la cuenta
--
-- Explícito, no derivado. La relación madre/local de hoy se infiere de
-- usuarios_locales, que es demasiado frágil para decidir cobros.
-- ----------------------------------------------------------------------------
create table if not exists public.cuenta_empresas (
  id           uuid primary key default gen_random_uuid(),
  cuenta_id    uuid not null references public.cuentas(id)  on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  es_principal boolean not null default false,
  activo       boolean not null default true,
  desde        date not null default current_date,
  hasta        date,
  created_at   timestamptz not null default now()
);

-- Una empresa no puede estar en dos cuentas a la vez.
create unique index if not exists cuenta_empresas_empresa_activa_uq
  on public.cuenta_empresas (empresa_id) where activo;

create index if not exists cuenta_empresas_cuenta_idx on public.cuenta_empresas (cuenta_id);

-- ----------------------------------------------------------------------------
-- 4. suscripciones — el corazón
-- ----------------------------------------------------------------------------
create table if not exists public.suscripciones (
  id                     uuid primary key default gen_random_uuid(),
  cuenta_id              uuid not null references public.cuentas(id) on delete cascade,
  plan_id                text not null references public.planes(id),
  periodicidad           text not null default 'mensual'
                           check (periodicidad in ('mensual', 'anual')),
  estado                 text not null default 'implementacion'
                           check (estado in ('implementacion', 'prueba', 'activa',
                                             'morosa', 'restringida', 'cancelada')),

  -- §1.3 · El reloj de la prueba NO arranca al registrar la empresa.
  -- Ambas se rellenan al pulsar "Iniciar prueba" en el backoffice.
  prueba_desde           date,
  prueba_hasta           date,

  -- §6.1 · LA fecha. Todo el derecho de uso se resuelve contra ella.
  cubierto_hasta         date,

  renovacion_automatica  boolean not null default false,

  -- Soporta Mercado Pago y Wompi a la vez: cambiar de pasarela es añadir un
  -- adaptador, no rehacer el sistema.
  proveedor              text not null default 'manual'
                           check (proveedor in ('manual', 'wompi', 'mercadopago')),
  id_externo             text,                    -- payment_source_id / preapproval_id
  metodo_pago_resumen    text not null default '', -- "Visa ****4242"

  precio_congelado       numeric,
  sedes_facturadas       integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists suscripciones_cuenta_viva_uq
  on public.suscripciones (cuenta_id) where estado <> 'cancelada';

comment on column public.suscripciones.cubierto_hasta is
  'Último día con derecho de uso pagado. El pago anual de BATUT vive aquí: 2027-05-31.';

-- ----------------------------------------------------------------------------
-- 5. facturas_suscripcion
--
-- Sin el constraint "vence día 15" del modelo viejo, que era incompatible con
-- el corte a fin de mes (§3.6).
-- ----------------------------------------------------------------------------
create sequence if not exists public.factura_suscripcion_seq start 1000;

create table if not exists public.facturas_suscripcion (
  id                 uuid primary key default gen_random_uuid(),
  cuenta_id          uuid not null references public.cuentas(id)      on delete restrict,
  suscripcion_id     uuid          references public.suscripciones(id) on delete set null,
  numero             text not null unique,
  periodo_desde      date not null,
  periodo_hasta      date not null,
  detalle            jsonb not null default '[]'::jsonb,   -- desglose base + N locales
  subtotal           numeric not null default 0,
  iva                numeric not null default 0,
  total              numeric not null default 0,
  moneda             text not null default 'COP',
  fecha_emision      date not null default current_date,
  fecha_corte        date not null,
  fecha_limite_pago  date not null,
  estado             text not null default 'emitida'
                       check (estado in ('emitida', 'pagada', 'vencida', 'anulada')),
  pdf_url            text,
  dian_cufe          text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (periodo_hasta >= periodo_desde),
  check (total >= 0)
);

create index if not exists facturas_suscripcion_cuenta_idx on public.facturas_suscripcion (cuenta_id, fecha_corte desc);
create index if not exists facturas_suscripcion_estado_idx on public.facturas_suscripcion (estado, fecha_limite_pago);

-- ----------------------------------------------------------------------------
-- 6. pagos_suscripcion
--
-- proveedor_pago_id es ÚNICO: es la idempotencia. Un webhook reenviado diez
-- veces no puede cobrar diez veces (§4.6).
-- ----------------------------------------------------------------------------
create table if not exists public.pagos_suscripcion (
  id                 uuid primary key default gen_random_uuid(),
  factura_id         uuid          references public.facturas_suscripcion(id) on delete set null,
  cuenta_id          uuid not null references public.cuentas(id)              on delete restrict,
  monto              numeric not null,
  moneda             text not null default 'COP',
  fecha_pago         timestamptz not null default now(),
  canal              text not null default 'otro'
                       check (canal in ('tarjeta', 'pse', 'nequi', 'bancolombia',
                                        'efectivo', 'transferencia', 'daviplata', 'otro')),
  proveedor          text not null default 'manual'
                       check (proveedor in ('manual', 'wompi', 'mercadopago')),
  proveedor_pago_id  text not null,
  referencia         text not null default '',
  estado             text not null default 'confirmado'
                       check (estado in ('confirmado', 'revertido', 'pendiente_conciliar')),
  payload            jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (proveedor, proveedor_pago_id)
);

create index if not exists pagos_suscripcion_cuenta_idx on public.pagos_suscripcion (cuenta_id, fecha_pago desc);

-- ----------------------------------------------------------------------------
-- 7. pasarela_eventos — todo lo que manda la pasarela, crudo
--
-- El UNIQUE sobre evento_id es lo que garantiza la idempotencia, no un
-- "select ... if exists" previo (que tiene carrera).
-- ----------------------------------------------------------------------------
create table if not exists public.pasarela_eventos (
  id            uuid primary key default gen_random_uuid(),
  proveedor     text not null check (proveedor in ('wompi', 'mercadopago')),
  evento_id     text not null,
  tipo          text not null default '',
  payload       jsonb not null default '{}'::jsonb,
  recibido_at   timestamptz not null default now(),
  procesado_at  timestamptz,
  resultado     text,
  error         text,
  unique (proveedor, evento_id)
);

create index if not exists pasarela_eventos_recibido_idx on public.pasarela_eventos (recibido_at desc);

-- ----------------------------------------------------------------------------
-- 8. suscripcion_bitacora — quién hizo qué y cuándo
-- ----------------------------------------------------------------------------
create table if not exists public.suscripcion_bitacora (
  id             uuid primary key default gen_random_uuid(),
  cuenta_id      uuid          references public.cuentas(id)       on delete cascade,
  suscripcion_id uuid          references public.suscripciones(id) on delete cascade,
  tipo           text not null,
  detalle        jsonb not null default '{}'::jsonb,
  actor          text not null default '',
  created_at     timestamptz not null default now()
);

create index if not exists suscripcion_bitacora_cuenta_idx on public.suscripcion_bitacora (cuenta_id, created_at desc);

-- ============================================================================
-- 9. Funciones de dominio
-- ============================================================================

-- ¿A qué cuenta pertenece esta empresa?
create or replace function public.cuenta_de_empresa(p_empresa_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select ce.cuenta_id
  from public.cuenta_empresas ce
  where ce.empresa_id = p_empresa_id and ce.activo
  limit 1;
$$;

-- La cuenta del usuario que está haciendo la petición ahora mismo.
-- Usa current_empresa_id(), que sí contempla otros_usuarios y el switcher de
-- locales — a diferencia de get_my_empresa_id(), que es lo que rompía §3.11.
create or replace function public.mi_cuenta_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.cuenta_de_empresa(public.current_empresa_id());
$$;

-- ----------------------------------------------------------------------------
-- El monto, según las reglas de §1.1
--   total_mes = precio_mensual + max(0, sedes - 1 - locales_incluidos) * precio_local_adicional
--   anual     = mensual * 12 * (1 - descuento_anual_pct/100)
-- Comprobación: BATUT, 2 sedes -> max(0, 2-1-1)=0 -> $59.900/mes, $575.040/año
-- ----------------------------------------------------------------------------
create or replace function public.calcular_monto_cuenta(
  p_cuenta_id    uuid,
  p_periodicidad text default 'mensual'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan          public.planes%rowtype;
  v_sedes         integer;
  v_adicionales   integer;
  v_mensual       numeric;
  v_total         numeric;
  v_detalle       jsonb;
begin
  select p.* into v_plan
  from public.suscripciones s
  join public.planes p on p.id = s.plan_id
  where s.cuenta_id = p_cuenta_id and s.estado <> 'cancelada'
  limit 1;

  if not found then
    select * into v_plan from public.planes where id = 'pro';
  end if;

  select count(*) into v_sedes
  from public.cuenta_empresas
  where cuenta_id = p_cuenta_id and activo;

  v_sedes       := greatest(v_sedes, 1);
  v_adicionales := greatest(0, v_sedes - 1 - v_plan.locales_incluidos);
  v_mensual     := v_plan.precio_mensual + v_adicionales * v_plan.precio_local_adicional;

  v_detalle := jsonb_build_array(
    jsonb_build_object(
      'concepto', v_plan.nombre || ' — sede principal' ||
                  case when v_plan.locales_incluidos > 0
                       then ' + ' || v_plan.locales_incluidos || ' local incluido'
                       else '' end,
      'cantidad', 1,
      'valor_unitario', v_plan.precio_mensual,
      'total', v_plan.precio_mensual
    )
  );

  if v_adicionales > 0 then
    v_detalle := v_detalle || jsonb_build_array(
      jsonb_build_object(
        'concepto', 'Local adicional',
        'cantidad', v_adicionales,
        'valor_unitario', v_plan.precio_local_adicional,
        'total', v_adicionales * v_plan.precio_local_adicional
      )
    );
  end if;

  if lower(coalesce(p_periodicidad, 'mensual')) = 'anual' then
    v_total := round(v_mensual * 12 * (1 - v_plan.descuento_anual_pct / 100.0));
    v_detalle := v_detalle || jsonb_build_array(
      jsonb_build_object(
        'concepto', 'Pago anual — descuento ' || v_plan.descuento_anual_pct || '%',
        'cantidad', 12,
        'valor_unitario', v_mensual,
        'total', v_total - (v_mensual * 12)
      )
    );
  else
    v_total := v_mensual;
  end if;

  return jsonb_build_object(
    'plan_id',        v_plan.id,
    'sedes',          v_sedes,
    'adicionales',    v_adicionales,
    'mensual',        v_mensual,
    'periodicidad',   lower(coalesce(p_periodicidad, 'mensual')),
    'subtotal',       v_total,
    'iva',            round(v_total * v_plan.iva_porcentaje / 100.0),
    'total',          v_total + round(v_total * v_plan.iva_porcentaje / 100.0),
    'moneda',         'COP',
    'detalle',        v_detalle
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- ¿Esta empresa tiene derecho a usar el producto?
--
-- IMPORTANTE (§1.4): esta función SOLO RESPONDE. Nadie la llama todavía para
-- bloquear. Se conecta a los RPC de escritura en la Fase 6, y solo cuando
-- Andrés lo autorice.
-- ----------------------------------------------------------------------------
create or replace function public.cuenta_al_dia(p_empresa_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_cuenta_id uuid;
  v_tipo      text;
  v_hoy       date := (now() at time zone 'America/Bogota')::date;
  v_sus       public.suscripciones%rowtype;
  v_vencidas  integer;
begin
  v_cuenta_id := public.cuenta_de_empresa(p_empresa_id);

  -- Sin cuenta asignada todavía: se le da el beneficio de la duda.
  if v_cuenta_id is null then
    return true;
  end if;

  select tipo into v_tipo from public.cuentas where id = v_cuenta_id;

  -- Internas y cortesías nunca se restringen.
  if v_tipo in ('interna', 'cortesia') then
    return true;
  end if;

  select * into v_sus
  from public.suscripciones
  where cuenta_id = v_cuenta_id and estado <> 'cancelada'
  limit 1;

  if not found then
    return true;
  end if;

  -- En implementación no corre reloj de ningún tipo.
  if v_sus.estado = 'implementacion' then
    return true;
  end if;

  -- En prueba vigente.
  if v_sus.prueba_hasta is not null and v_sus.prueba_hasta >= v_hoy then
    return true;
  end if;

  -- Periodo pagado por delante (el caso del pago anual).
  if v_sus.cubierto_hasta is not null and v_sus.cubierto_hasta >= v_hoy then
    return true;
  end if;

  -- Última puerta: que no arrastre facturas vencidas sin pagar.
  select count(*) into v_vencidas
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta_id
    and estado in ('emitida', 'vencida')
    and fecha_limite_pago < v_hoy;

  return v_vencidas = 0;
end;
$$;

-- Numeración consecutiva real (§3.10: hoy la factura no tiene número).
create or replace function public.siguiente_numero_factura()
returns text
language sql
volatile
security definer
set search_path = public, pg_temp
as $$
  select 'AX-' || lpad(nextval('public.factura_suscripcion_seq')::text, 5, '0');
$$;

-- ----------------------------------------------------------------------------
-- El monto en letras — reemplaza amountInWordsEs() de facturacion.js:139,
-- que devolvía una constante fuera cual fuera el monto (§3.10).
-- ----------------------------------------------------------------------------
create or replace function public.monto_en_letras(p_monto numeric)
returns text
language plpgsql
immutable
as $$
declare
  n        bigint := floor(abs(coalesce(p_monto, 0)))::bigint;
  millones bigint;
  miles    bigint;
  resto    bigint;
  out      text := '';
begin
  if n = 0 then
    return 'CERO PESOS COLOMBIANOS';
  end if;

  millones := n / 1000000;
  miles    := (n % 1000000) / 1000;
  resto    := n % 1000;

  -- Apócope: antes de MIL y MILLONES, "UNO" se convierte en "UN"
  -- (ciento cincuenta y UN mil, no "ciento cincuenta y uno mil").
  if millones > 0 then
    out := out || case when millones = 1 then 'UN MILLÓN '
                      else regexp_replace(public.tres_cifras_en_letras(millones),
                                          'UNO$', 'UN') || ' MILLONES ' end;
  end if;

  if miles > 0 then
    out := out || case when miles = 1 then 'MIL '
                       else regexp_replace(public.tres_cifras_en_letras(miles),
                                           'UNO$', 'UN') || ' MIL ' end;
  end if;

  if resto > 0 then
    out := out || public.tres_cifras_en_letras(resto) || ' ';
  end if;

  return btrim(out) || ' PESOS COLOMBIANOS';
end;
$$;

create or replace function public.tres_cifras_en_letras(n bigint)
returns text
language plpgsql
immutable
as $$
declare
  unidades text[] := array['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE',
                           'DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISÉIS','DIECISIETE',
                           'DIECIOCHO','DIECINUEVE','VEINTE','VEINTIUNO','VEINTIDÓS','VEINTITRÉS',
                           'VEINTICUATRO','VEINTICINCO','VEINTISÉIS','VEINTISIETE','VEINTIOCHO','VEINTINUEVE'];
  decenas  text[] := array['','','','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
  centenas text[] := array['','CIENTO','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS',
                           'SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];
  c integer := (n / 100)::integer;
  d integer := ((n % 100) / 10)::integer;
  u integer := (n % 10)::integer;
  r text := '';
begin
  if n = 100 then return 'CIEN'; end if;

  if c > 0 then r := centenas[c + 1] || ' '; end if;

  if (n % 100) < 30 then
    if (n % 100) > 0 then r := r || unidades[(n % 100)::integer + 1]; end if;
  else
    r := r || decenas[d + 1];
    if u > 0 then r := r || ' Y ' || unidades[u + 1]; end if;
  end if;

  return btrim(r);
end;
$$;

-- ============================================================================
-- 10. RLS — desde el primer día
--
-- La regla: cada cuenta ve lo suyo desde CUALQUIERA de sus sedes; el
-- superadmin lo ve todo. Escritura, solo el superadmin o la clave de servicio
-- (las Edge Functions).
-- ============================================================================

alter table public.cuentas              enable row level security;
alter table public.cuenta_empresas      enable row level security;
alter table public.suscripciones        enable row level security;
alter table public.facturas_suscripcion enable row level security;
alter table public.pagos_suscripcion    enable row level security;
alter table public.pasarela_eventos     enable row level security;
alter table public.suscripcion_bitacora enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['cuentas','cuenta_empresas','suscripciones',
                           'facturas_suscripcion','pagos_suscripcion',
                           'pasarela_eventos','suscripcion_bitacora']
  loop
    execute format('drop policy if exists %I_lectura on public.%I', t, t);
    execute format('drop policy if exists %I_admin   on public.%I', t, t);
  end loop;
end $$;

create policy cuentas_lectura on public.cuentas for select to authenticated
  using (public.is_super_admin() or id = public.mi_cuenta_id());
create policy cuentas_admin on public.cuentas for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy cuenta_empresas_lectura on public.cuenta_empresas for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy cuenta_empresas_admin on public.cuenta_empresas for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy suscripciones_lectura on public.suscripciones for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy suscripciones_admin on public.suscripciones for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy facturas_suscripcion_lectura on public.facturas_suscripcion for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy facturas_suscripcion_admin on public.facturas_suscripcion for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy pagos_suscripcion_lectura on public.pagos_suscripcion for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy pagos_suscripcion_admin on public.pagos_suscripcion for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Los eventos crudos de la pasarela no los ve ningún cliente.
create policy pasarela_eventos_admin on public.pasarela_eventos for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

create policy suscripcion_bitacora_lectura on public.suscripcion_bitacora for select to authenticated
  using (public.is_super_admin() or cuenta_id = public.mi_cuenta_id());
create policy suscripcion_bitacora_admin on public.suscripcion_bitacora for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 11. Permisos
-- ----------------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

grant select on public.cuentas, public.cuenta_empresas, public.suscripciones,
                public.facturas_suscripcion, public.pagos_suscripcion,
                public.suscripcion_bitacora
  to authenticated;

grant all on public.cuentas, public.cuenta_empresas, public.suscripciones,
             public.facturas_suscripcion, public.pagos_suscripcion,
             public.pasarela_eventos, public.suscripcion_bitacora
  to service_role;

grant usage, select on sequence public.factura_suscripcion_seq to service_role;

grant execute on function public.cuenta_de_empresa(uuid)               to authenticated, service_role;
grant execute on function public.mi_cuenta_id()                        to authenticated, service_role;
grant execute on function public.calcular_monto_cuenta(uuid, text)     to authenticated, service_role;
grant execute on function public.cuenta_al_dia(uuid)                   to authenticated, service_role;
grant execute on function public.siguiente_numero_factura()            to service_role;
grant execute on function public.monto_en_letras(numeric)              to authenticated, service_role;
grant execute on function public.tres_cifras_en_letras(bigint)         to authenticated, service_role;

commit;

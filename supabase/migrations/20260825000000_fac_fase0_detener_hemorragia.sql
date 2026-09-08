-- ============================================================================
-- FACTURACIÓN · FASE 0 — Detener la hemorragia
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §7 Fase 0
--
-- Tres defectos activos que se corrigen aquí:
--
--   §3.3  El sistema se perdona la deuda solo.
--         billing_daily_enforcer() suspende poniendo plan_actual='free';
--         create_billing_cycles_for_period() lee ESE campo para calcular el
--         monto del mes siguiente -> el ciclo nuevo nace en $0 y
--         'paid_verified'. La deuda desaparece y el servicio vuelve.
--
--   §1.4  Nada puede bloquear a un cliente hasta que Andrés lo autorice.
--         El enforcer apagaba empresas (activa=false, activo=false). Se le
--         quita esa capacidad: a partir de aquí solo OBSERVA y anota.
--
--   §3.2  El único camino manual también está roto: facturacion.js sube el
--         comprobante al bucket comprobantes_pago, que no existe.
--
-- Nada de lo que hay aquí cambia la experiencia de ningún usuario final.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Pausar el generador de ciclos
--
-- Corre el día 1 de cada mes y es la mitad del bug §3.3: mientras plan_actual
-- siga degradado, cada corrida borra deuda. Se pausa, no se borra: la Fase 4
-- lo reemplaza por el emisor de facturas_suscripcion.
-- ----------------------------------------------------------------------------
-- Vía cron.alter_job, no UPDATE directo: cron.job no admite escritura directa
-- ni siquiera desde postgres.
select cron.alter_job(jobid, active := false)
from cron.job
where jobname = 'billing-crear-ciclos' and active;

-- ----------------------------------------------------------------------------
-- 2. Bitácora de lo que el enforcer HABRÍA hecho
--
-- El modo observación de §7 Fase 6 empieza aquí. En vez de suspender, el
-- enforcer escribe una fila por empresa y día. Cuando llegue el momento de
-- encender el corte de verdad, esta tabla es la evidencia de a quién habría
-- afectado y desde cuándo.
-- ----------------------------------------------------------------------------
create table if not exists public.billing_observaciones (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  fecha         date not null,
  periodo       text not null,
  accion        text not null check (accion in ('habria_suspendido', 'habria_marcado_mora')),
  monto         numeric not null default 0,
  dias_vencido  integer not null default 0,
  created_at    timestamptz not null default now(),
  unique (empresa_id, fecha, accion)
);

comment on table public.billing_observaciones is
  'Modo observación del corte de servicio: registra a quién se habría restringido, sin restringir. No la lee ninguna pantalla de cliente.';

alter table public.billing_observaciones enable row level security;

drop policy if exists billing_observaciones_superadmin on public.billing_observaciones;
create policy billing_observaciones_superadmin
  on public.billing_observaciones
  for all
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 3. Enforcer sin capacidad de bloquear ni de degradar
--
-- Cambios respecto a la versión anterior:
--   - YA NO escribe plan_actual='free'  (rompía el cálculo del mes siguiente)
--   - YA NO escribe activa=false / activo=false  (bloqueaba de verdad)
--   - En su lugar anota en billing_observaciones
--   - Sigue gestionando banners y estados del ciclo: eso es informativo
-- ----------------------------------------------------------------------------
create or replace function public.billing_daily_enforcer()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_today     date    := (now() at time zone 'America/Bogota')::date;
  v_periodo   text    := to_char(v_today, 'YYYY-MM');
  v_banner_days integer := 10;
  v_grace_days  integer := 5;
  v_past_due  integer := 0;
  v_suspended integer := 0;
  v_anotados  integer := 0;
begin
  -- Un ciclo pagado no arrastra banner ni marca de suspensión.
  update public.billing_cycles
  set banner_activo        = false,
      dias_restantes_cache = null,
      suspension_aplicada  = false,
      updated_at           = now()
  where periodo = v_periodo
    and estado  = 'paid_verified'
    and (banner_activo = true or suspension_aplicada = true or dias_restantes_cache is not null);

  -- Estado del ciclo del mes en curso.
  with c as (
    select id, empresa_id, (fecha_vencimiento - v_today) as dias_restantes
    from public.billing_cycles
    where periodo = v_periodo
      and estado not in ('paid_verified')
      and not (
        manual_override = true
        and (manual_override_until is null or manual_override_until >= now())
      )
  )
  update public.billing_cycles bc
  set dias_restantes_cache = c.dias_restantes,
      banner_activo        = (c.dias_restantes <= v_banner_days),
      estado = case
                 when c.dias_restantes < 0 and c.dias_restantes > -v_grace_days then 'past_due'
                 when c.dias_restantes <= -v_grace_days then 'suspended'
                 else bc.estado
               end,
      suspension_aplicada  = (c.dias_restantes <= -v_grace_days),
      updated_at           = now()
  from c
  where bc.id = c.id;

  -- ANTES: update empresas set plan_actual='free', activa=false, activo=false
  -- AHORA: solo se anota. Ni una empresa se toca.
  insert into public.billing_observaciones (empresa_id, fecha, periodo, accion, monto, dias_vencido)
  select bc.empresa_id,
         v_today,
         v_periodo,
         case when bc.suspension_aplicada then 'habria_suspendido' else 'habria_marcado_mora' end,
         bc.monto,
         greatest(0, v_today - bc.fecha_vencimiento)
  from public.billing_cycles bc
  where bc.periodo = v_periodo
    and bc.estado in ('past_due', 'suspended')
  on conflict (empresa_id, fecha, accion) do nothing;

  get diagnostics v_anotados = row_count;

  -- El banner informativo sí se mantiene: avisa, no bloquea.
  update public.empresas e
  set mostrar_anuncio_impago = true
  from public.billing_cycles bc
  where bc.empresa_id = e.id
    and bc.periodo = v_periodo
    and bc.banner_activo = true;

  update public.empresas e
  set mostrar_anuncio_impago = false
  from public.billing_cycles bc
  where bc.empresa_id = e.id
    and bc.periodo = v_periodo
    and bc.banner_activo = false
    and bc.estado in ('paid_verified', 'pending_payment', 'proof_submitted');

  select count(*) into v_past_due
  from public.billing_cycles where periodo = v_periodo and estado = 'past_due';

  select count(*) into v_suspended
  from public.billing_cycles where periodo = v_periodo and estado = 'suspended';

  return jsonb_build_object(
    'ok', true,
    'periodo', v_periodo,
    'past_due', v_past_due,
    'suspended', v_suspended,
    'anotados', v_anotados,
    'modo', 'observacion'
  );
end;
$function$;

comment on function public.billing_daily_enforcer() is
  'Modo observación desde 2026-08-25: actualiza banners y estados de ciclo, y anota en billing_observaciones a quién habría suspendido. NO degrada plan_actual ni desactiva empresas.';

-- ----------------------------------------------------------------------------
-- 4. Reparar el daño ya hecho
--
-- Cinco empresas quedaron con plan='pro' y plan_actual='free': facturando $0
-- mientras usan el producto. Se restituye la verdad.
-- ----------------------------------------------------------------------------
update public.empresas
set plan_actual = plan
where plan_actual is distinct from plan;

-- "Prueba Nuevo Cliente" quedó apagada por el enforcer, no por decisión de
-- nadie. Se reactiva: es una empresa interna de prueba y §1.4 dice que nada
-- puede quedar bloqueado.
update public.empresas
set activa = true,
    activo = true,
    mostrar_anuncio_impago = false
where id = 'c5540d52-2fab-4e99-a182-a18825724cf1';

-- El ciclo que la suspendió deja de estar marcado como suspensión aplicada.
update public.billing_cycles
set estado              = 'pending_payment',
    suspension_aplicada = false,
    banner_activo       = false,
    updated_at          = now()
where empresa_id = 'c5540d52-2fab-4e99-a182-a18825724cf1'
  and estado = 'suspended';

-- ----------------------------------------------------------------------------
-- 5. Dejar constancia fechada del pago anual de BATUT
--
-- Hoy ese pago no existe en ninguna tabla: sobrevive por accidente gracias al
-- bug §3.3, que le venía emitiendo ciclos de $0. Al corregir el bug, sin esta
-- evidencia el cron le facturaría y le marcaría mora pese a estar pagado hasta
-- mayo de 2027. La Fase 2 lo convierte en suscripción formal.
-- ----------------------------------------------------------------------------
insert into public.billing_events (empresa_id, billing_cycle_id, tipo_evento, payload_json, actor)
select e.id,
       null,
       'pago_anual_registrado',
       jsonb_build_object(
         'cuenta',            'BATUT',
         'concepto',          'Plan anual AXIOMA · 2 sedes (LE MERIDIEM + VIVA)',
         'fecha_pago',        '2026-05-31',
         'cubierto_desde',    '2026-06-01',
         'cubierto_hasta',    '2027-05-31',
         'monto',             575040,
         'moneda',            'COP',
         'canal',             'transferencia',
         'sedes_cubiertas',   jsonb_build_array(
                                'f37f6983-9d59-40c8-b0c1-5949b45743c6',
                                '5b5f990a-146f-4623-adfc-78459d11a4a3'
                              ),
         'registrado_por',    'Fase 0 · regularización histórica',
         'nota',              'Pago recibido fuera de la plataforma. Se formaliza como suscripción anual en la Fase 2.'
       ),
       'sistema:fase0'
from public.empresas e
where e.id = 'f37f6983-9d59-40c8-b0c1-5949b45743c6'
  and not exists (
    select 1 from public.billing_events be
    where be.empresa_id = e.id and be.tipo_evento = 'pago_anual_registrado'
  );

-- Y que ningún cron lo toque mientras tanto.
update public.billing_cycles
set manual_override       = true,
    manual_override_until = '2027-06-30'::timestamptz,
    banner_activo         = false,
    suspension_aplicada   = false,
    updated_at            = now()
where empresa_id in (
  'f37f6983-9d59-40c8-b0c1-5949b45743c6',
  '5b5f990a-146f-4623-adfc-78459d11a4a3'
);

-- ----------------------------------------------------------------------------
-- 6. El bucket de comprobantes (§3.2)
--
-- Privado. El cliente sube a  <empresa_id>/<archivo>  y solo ve lo suyo;
-- el superadmin ve todo.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comprobantes_pago',
  'comprobantes_pago',
  false,
  10485760,                                   -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists comprobantes_pago_subir      on storage.objects;
drop policy if exists comprobantes_pago_leer       on storage.objects;
drop policy if exists comprobantes_pago_superadmin on storage.objects;

-- La primera carpeta de la ruta es el empresa_id del que sube.
create policy comprobantes_pago_subir
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comprobantes_pago'
    and (storage.foldername(name))[1] = public.current_empresa_id()::text
  );

create policy comprobantes_pago_leer
  on storage.objects for select to authenticated
  using (
    bucket_id = 'comprobantes_pago'
    and (storage.foldername(name))[1] = public.current_empresa_id()::text
  );

create policy comprobantes_pago_superadmin
  on storage.objects for all to authenticated
  using (bucket_id = 'comprobantes_pago' and public.is_super_admin())
  with check (bucket_id = 'comprobantes_pago' and public.is_super_admin());

commit;

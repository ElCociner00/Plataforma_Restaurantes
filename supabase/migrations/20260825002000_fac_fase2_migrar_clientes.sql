-- ============================================================================
-- FACTURACIÓN · FASE 2 — Migrar lo que existe
--
-- Contexto: docs/2026-08-24_plan_facturacion_multitenant.md §7 Fase 2
--
-- Criterio de aceptación (del plan):
--   - BATUT ve UNA sola factura por sus dos sedes, con vigencia hasta mayo de
--     2027 y sin nada pendiente.
--   - BATUT Cartagena existe como cuenta, sin cobros y SIN cuenta regresiva:
--     su reloj de prueba arranca cuando Andrés pulse "Iniciar prueba".
--   - Las empresas de prueba no generan nada.
--
-- Idempotente: se puede reejecutar sin duplicar.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Retoque de monto_en_letras: VEINTIUNO -> VEINTIÚN antes de MIL
-- ----------------------------------------------------------------------------
-- Apócope ante MIL / MILLONES: "veintiuno" -> "veintiún", "uno" -> "un".
create or replace function public.apocope_mil(t text)
returns text
language sql
immutable
as $$
  select regexp_replace(regexp_replace(t, 'VEINTIUNO$', 'VEINTIÚN'), '(^|\s)UNO$', '\1UN');
$$;

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

  if millones > 0 then
    out := out || case when millones = 1 then 'UN MILLÓN '
                       else public.apocope_mil(public.tres_cifras_en_letras(millones)) || ' MILLONES ' end;
  end if;

  if miles > 0 then
    out := out || case when miles = 1 then 'MIL '
                       else public.apocope_mil(public.tres_cifras_en_letras(miles)) || ' MIL ' end;
  end if;

  if resto > 0 then
    out := out || public.tres_cifras_en_letras(resto) || ' ';
  end if;

  -- "UN MILLÓN DE PESOS", no "UN MILLÓN PESOS".
  if millones > 0 and miles = 0 and resto = 0 then
    return btrim(out) || ' DE PESOS COLOMBIANOS';
  end if;

  return btrim(out) || ' PESOS COLOMBIANOS';
end;
$$;

grant execute on function public.apocope_mil(text)        to authenticated, service_role;
grant execute on function public.monto_en_letras(numeric) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 1. Cuenta BATUT — el único cliente pagando hoy
--
-- Dos sedes, UNA factura (§3.7). Pagó el año el 31/05/2026: cubierto_hasta
-- 2027-05-31. Mientras esa fecha esté por delante, cuenta_al_dia() devuelve
-- true sin consultar factura alguna, y no se le emite nada.
-- ----------------------------------------------------------------------------
insert into public.cuentas (id, nombre, nit, ciudad, correo_facturacion, contacto_nombre, tipo, estado, notas)
values (
  '0a7e0000-0000-4000-8000-000000000001',
  'BATUT',
  '901973863',
  'Barranquilla',
  'gerenciabatut@gmail.com',
  'Gerencia BATUT',
  'cliente',
  'activa',
  'Pagó plan anual el 31/05/2026 por sus dos sedes. Cubierto hasta 2027-05-31.'
)
on conflict (id) do update
  set nombre = excluded.nombre,
      correo_facturacion = excluded.correo_facturacion,
      estado = excluded.estado,
      updated_at = now();

insert into public.cuenta_empresas (cuenta_id, empresa_id, es_principal, desde)
values
  ('0a7e0000-0000-4000-8000-000000000001', 'f37f6983-9d59-40c8-b0c1-5949b45743c6', true,  '2026-06-01'),
  ('0a7e0000-0000-4000-8000-000000000001', '5b5f990a-146f-4623-adfc-78459d11a4a3', false, '2026-06-16')
on conflict do nothing;

insert into public.suscripciones (
  id, cuenta_id, plan_id, periodicidad, estado,
  prueba_desde, prueba_hasta, cubierto_hasta,
  renovacion_automatica, proveedor, precio_congelado, sedes_facturadas
)
values (
  '0a7e0000-0000-4000-8000-0000000000a1',
  '0a7e0000-0000-4000-8000-000000000001',
  'pro', 'anual', 'activa',
  null, null,                              -- nunca tuvo prueba
  '2027-05-31',                            -- LA fecha
  true, 'manual', 575040, 2
)
on conflict (id) do update
  set cubierto_hasta = excluded.cubierto_hasta,
      estado         = excluded.estado,
      updated_at     = now();

-- La factura del año que ya pagó, con su pago asociado. Trazabilidad completa:
-- de aquí en adelante el pago anual está representado, no es un accidente.
insert into public.facturas_suscripcion (
  id, cuenta_id, suscripcion_id, numero,
  periodo_desde, periodo_hasta, detalle,
  subtotal, iva, total, moneda,
  fecha_emision, fecha_corte, fecha_limite_pago, estado
)
values (
  '0a7e0000-0000-4000-8000-0000000000f1',
  '0a7e0000-0000-4000-8000-000000000001',
  '0a7e0000-0000-4000-8000-0000000000a1',
  'AX-00001',
  '2026-06-01', '2027-05-31',
  jsonb_build_array(
    jsonb_build_object('concepto','Plan Profesional anual — sede principal + 1 local incluido',
                       'cantidad',12,'valor_unitario',59900,'total',718800),
    jsonb_build_object('concepto','Descuento pago anual 20%',
                       'cantidad',1,'valor_unitario',-143760,'total',-143760)
  ),
  575040, 0, 575040, 'COP',
  '2026-05-31', '2026-05-31', '2026-05-31', 'pagada'
)
on conflict (id) do nothing;

insert into public.pagos_suscripcion (
  factura_id, cuenta_id, monto, moneda, fecha_pago,
  canal, proveedor, proveedor_pago_id, referencia, estado, payload
)
values (
  '0a7e0000-0000-4000-8000-0000000000f1',
  '0a7e0000-0000-4000-8000-000000000001',
  575040, 'COP', '2026-05-31 12:00:00-05',
  'transferencia', 'manual', 'historico-batut-anual-2026',
  'AX-00001', 'confirmado',
  jsonb_build_object('origen','Regularización histórica Fase 2',
                     'nota','Pago recibido fuera de la plataforma antes de existir el circuito de cobro.')
)
on conflict (proveedor, proveedor_pago_id) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Cuenta BATUT Cartagena — empresa madre aparte, otro administrador
--
-- Estado `implementacion`: SIN reloj de prueba. La empresa se creó el 22/08 y
-- un reloj automático ya le habría consumido días sin haber usado el producto
-- (§1.3). prueba_desde y prueba_hasta quedan NULL a propósito.
-- ----------------------------------------------------------------------------
insert into public.cuentas (id, nombre, nit, ciudad, correo_facturacion, contacto_nombre, tipo, estado, notas)
values (
  '0a7e0000-0000-4000-8000-000000000002',
  'BATUT Cartagena',
  '1103110658',
  'Cartagena',
  'carlosfalrios@gmail.com',
  'Administrador BATUT Cartagena',
  'cliente',
  'implementacion',
  'En implementación desde el 22/08/2026. Los 15 días de prueba arrancan al pulsar "Iniciar prueba", no antes.'
)
on conflict (id) do update
  set correo_facturacion = excluded.correo_facturacion,
      estado = excluded.estado,
      updated_at = now();

insert into public.cuenta_empresas (cuenta_id, empresa_id, es_principal, desde)
values ('0a7e0000-0000-4000-8000-000000000002', 'bd1583bc-8009-48a1-ab6d-ca92932453f0', true, '2026-08-22')
on conflict do nothing;

insert into public.suscripciones (
  id, cuenta_id, plan_id, periodicidad, estado,
  prueba_desde, prueba_hasta, cubierto_hasta,
  renovacion_automatica, proveedor, precio_congelado, sedes_facturadas
)
values (
  '0a7e0000-0000-4000-8000-0000000000a2',
  '0a7e0000-0000-4000-8000-000000000002',
  'pro', 'mensual', 'implementacion',
  null, null, null,
  false, 'manual', 59900, 1
)
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Cuentas internas — nunca se les emite factura ni se les restringe
-- ----------------------------------------------------------------------------
insert into public.cuentas (id, nombre, nit, correo_facturacion, tipo, estado, notas)
values
  ('0a7e0000-0000-4000-8000-000000000010', 'Interna · Global Nexo (pruebas)', '900123456',
   'andreszamora4life@gmail.com', 'interna', 'activa',
   'Restaurante Prueba + su local Prueba Global Nexo 2. Banco de pruebas.'),
  ('0a7e0000-0000-4000-8000-000000000011', 'Interna · Prueba Nuevo Cliente', '900123500',
   'andreszamora4life@gmail.com', 'interna', 'activa',
   'Empresa de prueba. Quedó suspendida por el bug §3.3 y se reactivó en la Fase 0.'),
  ('0a7e0000-0000-4000-8000-000000000012', 'Interna · Global Nexo Shop S.A.S.', '901941016',
   'andreszamora4life@gmail.com', 'interna', 'activa',
   'Empresa propia.')
on conflict (id) do update set tipo = 'interna', updated_at = now();

insert into public.cuenta_empresas (cuenta_id, empresa_id, es_principal, desde)
values
  ('0a7e0000-0000-4000-8000-000000000010', 'b76d89f6-43ea-4a2f-a21b-b159f7d7b162', true,  '2026-01-31'),
  ('0a7e0000-0000-4000-8000-000000000010', '498b9fd6-0bbd-4d78-b573-033b4d43f6c1', false, '2026-06-11'),
  ('0a7e0000-0000-4000-8000-000000000011', 'c5540d52-2fab-4e99-a182-a18825724cf1', true,  '2026-05-12'),
  ('0a7e0000-0000-4000-8000-000000000012', '8f7fd35c-1e99-42cd-a76e-0f33743fa105', true,  '2026-08-22')
on conflict do nothing;

insert into public.suscripciones (cuenta_id, plan_id, periodicidad, estado, cubierto_hasta, proveedor, sedes_facturadas)
select c.id, 'pro', 'mensual', 'activa', '2099-12-31', 'manual',
       (select count(*) from public.cuenta_empresas ce where ce.cuenta_id = c.id and ce.activo)
from public.cuentas c
where c.tipo = 'interna'
  and not exists (select 1 from public.suscripciones s where s.cuenta_id = c.id);

-- ----------------------------------------------------------------------------
-- 4. Histórico: billing_cycles -> facturas_suscripcion, marcadas como cerradas
--
-- No se pierde trazabilidad. Se numeran aparte (AX-H-…) para no mezclarlas con
-- la numeración fiscal real que empieza en AX-01000.
-- ----------------------------------------------------------------------------
insert into public.facturas_suscripcion (
  cuenta_id, suscripcion_id, numero,
  periodo_desde, periodo_hasta, detalle,
  subtotal, iva, total, moneda,
  fecha_emision, fecha_corte, fecha_limite_pago, estado
)
select
  ce.cuenta_id,
  (select s.id from public.suscripciones s where s.cuenta_id = ce.cuenta_id limit 1),
  'AX-H-' || substr(replace(bc.id::text, '-', ''), 1, 10),
  bc.fecha_emision,
  (date_trunc('month', bc.fecha_emision) + interval '1 month - 1 day')::date,
  jsonb_build_object('origen', 'billing_cycles', 'periodo', bc.periodo, 'estado_original', bc.estado),
  bc.monto, 0, bc.monto, coalesce(bc.moneda, 'COP'),
  bc.fecha_emision, bc.fecha_vencimiento, bc.fecha_vencimiento,
  case when bc.estado = 'paid_verified' then 'pagada' else 'anulada' end
from public.billing_cycles bc
join public.cuenta_empresas ce on ce.empresa_id = bc.empresa_id and ce.activo
where not exists (
  select 1 from public.facturas_suscripcion f
  where f.numero = 'AX-H-' || substr(replace(bc.id::text, '-', ''), 1, 10)
);

-- ----------------------------------------------------------------------------
-- 5. Bitácora de la migración
-- ----------------------------------------------------------------------------
insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
select c.id,
       (select s.id from public.suscripciones s where s.cuenta_id = c.id limit 1),
       'migracion_fase2',
       jsonb_build_object(
         'cuenta', c.nombre,
         'tipo', c.tipo,
         'estado', c.estado,
         'sedes', (select count(*) from public.cuenta_empresas ce where ce.cuenta_id = c.id and ce.activo)
       ),
       'sistema:fase2'
from public.cuentas c
where not exists (
  select 1 from public.suscripcion_bitacora b
  where b.cuenta_id = c.id and b.tipo = 'migracion_fase2'
);

commit;

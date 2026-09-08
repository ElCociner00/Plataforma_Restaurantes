-- ============================================================================
-- Banco de pruebas de cobro — probar el ciclo Wompi de punta a punta con un
-- importe simbólico, sin tocar el precio comercial ni a un cliente real.
--
-- El problema que resuelve: para verificar
--     selección → checkout → pago → webhook → vigencia → activación
-- hace falta una factura real, con su referencia y su firma de integridad. Y
-- registrar_pago_confirmado() exige que el monto CUADRE con la factura (§4.4),
-- así que no vale pagar $1.000 contra una factura de $575.040: eso cae en
-- 'pendiente_conciliar' y no prueba nada.
--
-- La salida limpia es una cuenta aparte cuyas facturas SÍ valen $1.000. Ya
-- existía a medias ('AXIOMA · prueba de cobro'); aquí se formaliza y se blinda.
--
-- Tres candados, porque esto emite facturas:
--   1. La bandera vive en la CUENTA, no en un precio global. El plan sigue
--      costando $59.900.
--   2. Un trigger impide marcar como banco de pruebas cualquier cuenta que
--      tenga sedes activas. BATUT no puede caer aquí ni por error de dedo.
--   3. factura_de_prueba() solo la puede ejecutar service_role. Ningún
--      navegador la alcanza; la llama pago-iniciar tras comprobar superadmin.
-- ============================================================================

alter table public.cuentas
  add column if not exists es_banco_pruebas boolean not null default false;

comment on column public.cuentas.es_banco_pruebas is
  'Cuenta destinada a probar el ciclo de cobro con importes simbólicos. '
  'Nunca puede tener sedes activas: lo impide el trigger cuentas_banco_pruebas_guarda.';

-- ----------------------------------------------------------------------------
-- Candado 2 — una cuenta con sedes activas jamás es banco de pruebas.
-- No se puede expresar con CHECK porque mira otra tabla.
-- ----------------------------------------------------------------------------
create or replace function public.cuentas_banco_pruebas_guarda()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.es_banco_pruebas then
    if exists (select 1 from public.cuenta_empresas
                where cuenta_id = new.id and activo) then
      raise exception
        'La cuenta % tiene sedes activas: no puede ser banco de pruebas', new.nombre
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists cuentas_banco_pruebas_guarda on public.cuentas;
create trigger cuentas_banco_pruebas_guarda
  before insert or update of es_banco_pruebas on public.cuentas
  for each row execute function public.cuentas_banco_pruebas_guarda();

-- La cuenta que ya se venía usando para esto. Tiene 0 sedes, así que pasa.
update public.cuentas
   set es_banco_pruebas = true, updated_at = now()
 where nombre = 'AXIOMA · prueba de cobro'
   and not es_banco_pruebas;

-- ----------------------------------------------------------------------------
-- factura_de_prueba — emite (o reutiliza) una factura simbólica de la cuenta
-- banco de pruebas.
--
-- El periodo es de un solo día, hoy, para que el efecto sobre cubierto_hasta
-- sea inequívoco al comprobar que el webhook funcionó.
--
-- Reutiliza la factura viva del día en lugar de acumular una por cada intento:
-- misma idempotencia que emitir_factura_cuenta().
-- ----------------------------------------------------------------------------
create or replace function public.factura_de_prueba(p_monto numeric default 1000)
returns public.facturas_suscripcion
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_hoy      date := (now() at time zone 'America/Bogota')::date;
  v_cuenta   public.cuentas%rowtype;
  v_sus      public.suscripciones%rowtype;
  v_monto    numeric;
  v_factura  public.facturas_suscripcion%rowtype;
  v_secuencia integer;
begin
  -- Techo duro: esto emite facturas de verdad. Que nunca pueda usarse para
  -- colar un cobro grande ni para regalar un periodo largo.
  v_monto := round(coalesce(p_monto, 1000));
  if v_monto < 1000 or v_monto > 5000 then
    raise exception 'El importe de prueba debe estar entre $1.000 y $5.000 (recibido %)', v_monto
      using errcode = '22023';
  end if;

  select * into v_cuenta
  from public.cuentas
  where es_banco_pruebas
  order by created_at
  limit 1;

  if not found then
    raise exception 'No hay ninguna cuenta marcada como banco de pruebas'
      using errcode = '22023';
  end if;

  select * into v_sus
  from public.suscripciones
  where cuenta_id = v_cuenta.id and estado <> 'cancelada'
  limit 1;

  if not found then
    raise exception 'La cuenta de pruebas % no tiene suscripción activa', v_cuenta.nombre
      using errcode = '22023';
  end if;

  -- ¿Ya hay una factura de prueba viva por el mismo importe y periodo? Se
  -- reutiliza: pulsar el botón dos veces no debe dejar dos facturas.
  select * into v_factura
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta.id
    and periodo_desde = v_hoy and periodo_hasta = v_hoy
    and total = v_monto
    and estado in ('emitida', 'vencida')
  limit 1;

  if found then
    return v_factura;
  end if;

  -- Numeración propia: 'AX-TEST-…' no consume la serie comercial y salta a la
  -- vista en cualquier informe de contabilidad.
  select count(*) + 1 into v_secuencia
  from public.facturas_suscripcion
  where cuenta_id = v_cuenta.id and numero like 'AX-TEST-%';

  insert into public.facturas_suscripcion (
    cuenta_id, suscripcion_id, numero,
    periodo_desde, periodo_hasta, detalle,
    subtotal, iva, total, moneda,
    fecha_emision, fecha_corte, fecha_limite_pago, estado
  )
  values (
    v_cuenta.id, v_sus.id, 'AX-TEST-' || lpad(v_secuencia::text, 3, '0'),
    v_hoy, v_hoy,
    jsonb_build_array(jsonb_build_object(
      'concepto', 'Prueba técnica del ciclo de cobro — sin valor comercial',
      'cantidad', 1, 'valor_unitario', v_monto, 'total', v_monto
    )),
    v_monto, 0, v_monto, 'COP',
    v_hoy, v_hoy, v_hoy + 1, 'emitida'
  )
  returning * into v_factura;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_cuenta.id, v_sus.id, 'factura_emitida',
          jsonb_build_object('numero', v_factura.numero, 'total', v_monto,
                             'periodo', v_hoy::text, 'periodicidad', 'prueba'),
          'superadmin:banco_pruebas');

  return v_factura;
end;
$$;

-- Candado 3 — nadie con un JWT de navegador puede llamarla.
revoke all on function public.factura_de_prueba(numeric) from public, anon, authenticated;
grant execute on function public.factura_de_prueba(numeric) to service_role;

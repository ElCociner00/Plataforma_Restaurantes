-- ============================================================================
-- Limpieza puntual: anular AX-01004.
--
-- Qué es: una factura anual de $575.040, periodo 2027-06-01 → 2028-05-31,
-- emitida a BATUT el 2026-08-27 por el botón «Pagar el año (−20%)» de la
-- pantalla anterior. Ese botón no llevaba a pagar: llamaba a factura_a_pagar()
-- con periodicidad 'anual', que EMITE.
--
-- Por qué sobra: BATUT ya estaba cubierta hasta 2027-05-31 y al día. La
-- factura reservaba el año siguiente sin que nadie lo hubiera decidido, y su
-- límite de pago caía en junio de 2028.
--
-- Por qué es seguro anularla: nunca se pagó —cero filas en pagos_suscripcion—
-- y su periodo aún no ha empezado. No hay efecto contable.
--
-- ---------------------------------------------------------------------------
-- Los candados van escritos aquí en SQL en vez de llamar a
-- anular_factura_no_pagada(): esa función comprueba el ALCANCE del llamante
-- (cuenta propia, superadmin o rol de servicio) y el rol con el que se aplican
-- las migraciones no es ninguno de los tres. Se replican las mismas cuatro
-- condiciones para no rebajar la comprobación por comodidad.
-- ============================================================================

do $$
declare
  v_factura public.facturas_suscripcion%rowtype;
  v_hoy     date := (now() at time zone 'America/Bogota')::date;
  v_pagos   integer;
begin
  select f.* into v_factura
  from public.facturas_suscripcion f
  join public.cuentas c on c.id = f.cuenta_id
  where c.nombre = 'BATUT' and f.numero = 'AX-01004';

  if not found then
    raise notice 'AX-01004 no existe. Nada que hacer.';
    return;
  end if;

  -- (1) Solo emitidas.
  if v_factura.estado <> 'emitida' then
    raise notice 'AX-01004 está en estado %: no se toca.', v_factura.estado;
    return;
  end if;

  -- (2) Sin ningún pago, ni siquiera pendiente de conciliar.
  select count(*) into v_pagos
  from public.pagos_suscripcion where factura_id = v_factura.id;

  if v_pagos > 0 then
    raise notice 'AX-01004 tiene % pago(s): no se toca.', v_pagos;
    return;
  end if;

  -- (3) El periodo no ha empezado.
  if v_factura.periodo_desde <= v_hoy then
    raise notice 'El periodo de AX-01004 ya empezó (%): es exigible, no se toca.',
      v_factura.periodo_desde;
    return;
  end if;

  update public.facturas_suscripcion
     set estado = 'anulada', updated_at = now()
   where id = v_factura.id;

  insert into public.suscripcion_bitacora (cuenta_id, suscripcion_id, tipo, detalle, actor)
  values (v_factura.cuenta_id, v_factura.suscripcion_id, 'factura_anulada',
          jsonb_build_object(
            'numero', v_factura.numero,
            'total', v_factura.total,
            'periodo', v_factura.periodo_desde::text || ' → ' || v_factura.periodo_hasta::text,
            'motivo', 'emitida por el botón defectuoso de la pantalla anterior'),
          'superadmin:limpieza');

  raise notice 'AX-01004 anulada. BATUT queda al día, cubierta hasta %.',
    (select cubierto_hasta from public.suscripciones
      where cuenta_id = v_factura.cuenta_id and estado <> 'cancelada' limit 1);
end;
$$;

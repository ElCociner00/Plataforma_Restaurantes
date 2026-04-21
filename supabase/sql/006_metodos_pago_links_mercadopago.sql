-- 2026-04-20
-- Crea/actualiza métodos de pago globales para módulo de facturación.
-- Nota: se dejan con empresa_id = NULL porque aplican a toda la plataforma.

insert into public.metodos_pago (
  empresa_id,
  codigo,
  nombre,
  tipo,
  data_qr_o_url,
  instrucciones,
  activo,
  orden
)
values
  (
    null,
    'mercado_pago_puntual',
    'Mercado Pago - Pago puntual',
    'link_pago',
    'https://mpago.li/15d6BkC',
    'Usa este botón para realizar el pago puntual del mes actual.',
    true,
    10
  ),
  (
    null,
    'mercado_pago_suscripcion',
    'Mercado Pago - Suscripción mensual',
    'link_pago',
    'https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=418f65131d8f43c18f38b7e23615f55e',
    'Recomendado para cobro automático mensual y evitar pagos manuales.',
    true,
    20
  )
on conflict (codigo)
do update
set
  empresa_id = excluded.empresa_id,
  nombre = excluded.nombre,
  tipo = excluded.tipo,
  data_qr_o_url = excluded.data_qr_o_url,
  instrucciones = excluded.instrucciones,
  activo = excluded.activo,
  orden = excluded.orden,
  updated_at = now();

# Fase 3/4 - Operación y validación

## RPCs
Ejecutar `supabase/sql/002_billing_rpcs.sql` en SQL Editor con rol de servicio.

## Webhooks centralizados
Las rutas de n8n para facturación están en `js/webhooks.js`:
- `BILLING_DAILY_ENFORCER`
- `BILLING_NOTIFICACIONES_PAGOS`
- `BILLING_CREAR_CICLOS`

## Checklist de pruebas de permisos (RLS)
1. Usuario empresa:
   - puede listar sus `billing_cycles` y `payment_attempts`.
   - puede crear `payment_attempts` de su propia empresa.
2. Superadmin:
   - puede revisar pendientes en `facturacion/revision_pagos.html`.
   - puede aprobar/rechazar y ver eventos en `billing_events`.

## Checklist flujo completo
1. Empresa con ciclo del mes (`pending_payment`, `banner_activo=true`) visualiza banner y factura.
2. Empresa sube comprobante desde Facturación.
3. Superadmin aprueba/rechaza en Revisión de pagos.
4. Se actualiza estado en `billing_cycles` y se registra `billing_events`.
5. Si no hay pago a vencimiento, n8n llama `aplicar_suspension`.

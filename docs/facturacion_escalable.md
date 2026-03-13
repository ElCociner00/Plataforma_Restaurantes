# Propuesta: Facturación escalable y semi-automática (Supabase + n8n)

## 1) Diagnóstico rápido del estado actual

Hoy ya tienes una base importante:

- **Módulo de factura** por empresa (`js/facturacion.js`) con lectura desde Supabase y fallback opcional por webhook.
- **Banner de impago** (`js/anuncio_impago.js`) controlado por el campo `empresas.mostrar_anuncio_impago`.
- **Superadmin** para editar plan/estado/anuncio (`js/gestion_empresas.js`).
- **Bandeja de pagos por revisar** (`js/revision_pagos.js`) con aprobación/rechazo vía RPC `resolver_pago_revision`.

Esto ya permite un flujo manual asistido; lo que falta es convertirlo en un **ciclo automático con excepciones manuales**.

---

## 2) Objetivo funcional (como lo planteas)

1. Vencimiento universal el **día 15** de cada mes.
2. Banner impago:
   - Estado base: oculto.
   - Se activa automáticamente desde **10 días antes** (día 5).
   - Mensaje de cuenta regresiva: “faltan 10…1 días”, “vence hoy”, luego “atraso”.
3. Pago del cliente:
   - Redirección a pasarela externa (ya existe).
   - Cliente puede subir comprobante cuando no hay confirmación automática.
4. Backoffice superadmin:
   - Cola “pagos por revisar”.
   - Aprobar/rechazar.
   - Reanudar automático después de excepción.
5. Si no hay pago confirmado al corte:
   - Empresa pasa a modo lectura (plan `free` o flag de bloqueo).
6. Historial de pagos visible para cliente y para auditoría interna.
7. Notificaciones (email/webhook) en aprobación/rechazo.

---

## 3) Diseño recomendado: máquina de estados

Define un estado de facturación por empresa por período (`YYYY-MM`):

- `draft` → factura generada.
- `pending_payment` → pendiente de pago.
- `proof_submitted` → comprobante enviado.
- `paid_verified` → pago validado.
- `past_due` → vencido sin pago.
- `suspended` → servicio restringido.
- `grace_manual` (opcional) → excepción manual temporal.

**Regla clave**: no derives todo desde `plan`; usa tabla de ciclo y luego proyecta el resultado al plan/estado operativo.

---

## 4) Esquema de datos sugerido (Supabase)

> Mantén tablas actuales, pero agrega estas para trazabilidad sólida.

### 4.1 `billing_cycles`
Una fila por empresa por mes.

Campos recomendados:
- `id` (uuid)
- `empresa_id` (uuid)
- `periodo` (text `YYYY-MM`)
- `fecha_emision` (date)
- `fecha_vencimiento` (date, siempre día 15)
- `monto` (numeric)
- `moneda` (text, `COP`)
- `estado` (enum: estados anteriores)
- `dias_restantes_cache` (int, opcional)
- `banner_activo` (bool)
- `suspension_aplicada` (bool)
- `manual_override` (bool)
- `manual_override_until` (timestamptz, opcional)
- `created_at`, `updated_at`

Índices:
- único (`empresa_id`, `periodo`)
- índice por (`estado`, `fecha_vencimiento`)

### 4.2 `payment_attempts`
Intentos de pago / comprobantes.

Campos:
- `id` (uuid)
- `billing_cycle_id` (uuid)
- `empresa_id` (uuid)
- `canal` (`mercadopago_link`, `transferencia`, etc.)
- `referencia_externa` (text)
- `monto_reportado` (numeric)
- `fecha_reportada` (timestamptz)
- `comprobante_url` (storage path)
- `estado` (`pendiente`, `aprobado`, `rechazado`)
- `revisado_por` (uuid)
- `observaciones` (text)
- `created_at`, `updated_at`

### 4.3 `billing_events` (bitácora)
Todo cambio importante en timeline:
- `empresa_id`, `billing_cycle_id`, `tipo_evento`, `payload_json`, `actor`, `created_at`.

---

## 5) Automatizaciones (n8n + Supabase cron)

## 5.1 Job diario (00:05)
Workflow `billing_daily_enforcer`:

1. Consulta ciclos activos del mes.
2. Calcula `dias_restantes = fecha_vencimiento - hoy`.
3. Si `dias_restantes <= 10` y no pagado:
   - `banner_activo = true`
   - `empresas.mostrar_anuncio_impago = true`
4. Si `dias_restantes < 0` y no pagado y sin override:
   - `estado = past_due/suspended`
   - empresa a modo restringido (`plan_actual='free'` o `activa=false` según política)
5. Si `paid_verified`:
   - oculta banner
   - remueve restricciones

## 5.2 Webhook de “comprobante enviado”
Desde frontend:
- Inserta en `payment_attempts` (pendiente).
- Opcional: dispara webhook n8n para notificación inmediata a superadmin.

## 5.3 Webhook de “revisión superadmin”
Al aprobar/rechazar:
- Si aprueba:
  - `payment_attempts.estado='aprobado'`
  - `billing_cycles.estado='paid_verified'`
  - `banner_activo=false`
  - restaura servicio
- Si rechaza:
  - `payment_attempts.estado='rechazado'`
  - mantiene ciclo pendiente/vencido
  - envía correo al cliente con motivo

---

## 6) Ajustes en frontend actual (mínimos y progresivos)

1. `js/anuncio_impago.js`
   - Hoy calcula con `15 - hoy.getDate()`.
   - Mejor: leer `dias_restantes` y `banner_activo` desde `billing_cycles` para soportar zonas horarias, excepciones y cierres manuales.

2. `js/facturacion.js`
   - Agregar sección “Subir comprobante” (archivo + referencia + monto + fecha).
   - Guardar archivo en Supabase Storage (bucket privado) y registrar `payment_attempts`.

3. `js/revision_pagos.js`
   - Migrar de `pagos_en_revision` a vista compatible con `payment_attempts` + `billing_cycles`.
   - Mantener botones aprobar/rechazar, pero registrando observaciones.

4. `js/gestion_empresas.js`
   - Nuevo bloque de excepción manual:
     - “Pausa automática hasta fecha X”
     - “Forzar banner ON/OFF”
     - “Forzar suspensión ON/OFF”

---

## 7) Seguridad / RLS (clave)

- Cliente empresa:
  - puede leer solo sus `billing_cycles` y su historial de `payment_attempts`.
  - puede crear `payment_attempts` solo para su `empresa_id`.
  - **no** puede aprobar/rechazar.
- Superadmin:
  - acceso total a revisión y overrides.
- Edge Function / RPC:
  - transiciones críticas (aprobar pago, suspender servicio) en backend, no en frontend.

---

## 8) Plan de implementación por fases (recomendado)

### Fase 1 (rápida)
- Crear `billing_cycles`, `payment_attempts`, `billing_events`.
- Añadir upload de comprobante en facturación.
- Conectar revisión de pagos a estos datos.

### Fase 2
- Job diario automático (banner + suspensión + restauración).
- Emails transaccionales por estado.

### Fase 3
- Overrides avanzados y tablero de auditoría.
- Métricas: tasa de mora, tiempo de aprobación, recuperación.

---

## 9) Decisiones prácticas para tu caso

- Mantén tu pasarela externa como está (rápido de operar).
- Usa comprobante + revisión como puente mientras integras validación automática bancaria/API.
- Evita `localStorage` para estados críticos de facturación; solo UI efímera.
- Deja la “fuente de verdad” en Supabase; n8n como orquestador de eventos.

Con esto logras exactamente lo que buscas: **automático por defecto + intervención puntual de superadmin + retorno al automático sin fricción**.

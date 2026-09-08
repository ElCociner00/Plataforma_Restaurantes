# Integración Enkrato + Rappi V1

Fecha: 2026-08-29

Rama de trabajo: `feature/integracion-enkrato-rappi`

Estado: implementada y validada local/transaccionalmente; pendiente de autorización para activar recursos remotos.

## Objetivo

Incorporar Rappi como una integración aislada dentro de Enkrato, sin cambiar el contrato de autenticación, sesión, contexto multiempresa, encabezado global ni los módulos existentes. La V1 es de lectura: recibe webhooks, consulta operación y finanzas, concilia y expone evidencia; no acepta/cancela órdenes, no publica menús, no cambia tiendas/disponibilidad y no contabiliza automáticamente en Loggro.

## Arquitectura entregada

```text
Rappi DEV/PROD
  ├─ API Operational ────────┐
  ├─ API Financial ──────────┼─> Edge Functions Rappi ─> tablas rappi_* con RLS
  └─ Webhooks + HMAC ─> audit raw ─> cola ─> worker ────> normalización
                                                        ├─ R1 Operación
                                                        ├─ R2 Finanzas
                                                        └─ R3 Integración

Loggro permanece en una frontera independiente y bloqueada por configuración.
```

### R1 · Operación

- Resumen de órdenes, incidencias, pendientes financieros y tiendas.
- Filtros por ID, estado, tienda y periodo; paginación del lado servidor.
- Detalle por orden con productos sanitizados, eventos y tracking.
- Salud de tiendas mediante conectividad/ping y soporte de la última versión de menú.
- Solo lectura contra Rappi.

### R2 · Finanzas y conciliación

- Pagos paginados con periodo, estado, referencia y conceptos.
- Resumen exacto calculado en PostgreSQL, sin límite artificial de filas.
- Conciliación por orden entre valor operativo, financiero y contable.
- Reglas iniciales: orden completada sin pago después del corte, diferencia de valor, cancelada con movimiento contable, medio de pago diferente y rechazo contable.
- Evidencia descargable en JSON, exportación CSV y reporte imprimible/PDF con la leyenda “Reporte de conciliación generado por Enkrato”.
- Datos bancarios, cliente, teléfono, correo, dirección, documentos e identificaciones se eliminan antes de persistir el detalle financiero.
- La contabilización Loggro queda explícitamente en `BLOCKED_CONFIGURATION`; no existe envío automático.

### R3 · Integración

- Ambientes DEV y PROD separados.
- Credenciales Operational y Financial independientes, cifradas con AES-GCM.
- Tokens cifrados, cacheados y renovados con margen; un 401/403 fuerza una única renovación y reintento.
- URLs limitadas a HTTPS y hosts oficiales bajo `rappi.com` para impedir exfiltración de credenciales.
- Pruebas de autenticación Operational/Financial.
- Mapeo de tiendas Rappi a empresas/locales visibles en Enkrato.
- Sincronización manual por alcance y periodo, cola manual, historial y diagnóstico.
- Consulta y suscripción explícita de webhooks DEV. PROD permanece bloqueado para cambios automáticos.

## Webhooks

La lista permitida es cerrada y contiene exactamente:

1. `NEW_ORDER`
2. `ORDER_EVENT_CANCEL`
3. `ORDER_OTHER_EVENT`
4. `MENU_APPROVED`
5. `MENU_REJECTED`
6. `PING`
7. `STORE_CONNECTIVITY`
8. `ORDER_RT_TRACKING`

Flujo de recepción:

1. Ruta no predecible por configuración: `/rappi-webhook/{endpoint_key}/{event}`.
2. Límite de 2 MB aplicado mientras se lee el stream.
3. Validación de `Rappi-Signature` con HMAC-SHA256 sobre `timestamp + "." + raw_body`.
4. Ventana antireplay configurable (600 segundos por defecto).
5. Hash e idempotencia antes de encolar; duplicados responden OK sin reprocesarse.
6. Auditoría raw separada de las vistas de negocio.
7. Worker asíncrono con claim atómico `SKIP LOCKED`, máximo cinco intentos, backoff exponencial y estado `DEAD` revisable.

## Datos y seguridad

- 19 tablas nuevas `rappi_*`; la migración es aditiva y usa `ON DELETE RESTRICT`.
- Todas las tablas tienen RLS. Las tablas de credenciales, tokens y secretos de webhook no tienen políticas de lectura para usuarios y se revocan a `PUBLIC`, `anon` y `authenticated`.
- Las consultas de UI siempre resuelven contexto en servidor y filtran `empresa_id`.
- Los webhooks conservan auditoría raw solo para diagnóstico administrativo; R1/R2 nunca exponen ese cuerpo.
- Los secretos no se devuelven a la UI, no se guardan en `localStorage` y no están incluidos en este documento ni en el código.
- Las respuestas remotas de configuración se limpian de `secret`, `token`, `authorization` y `client_secret` antes de llegar al navegador.
- CORS y JWT se mantienen para las funciones de usuario. Webhook, worker y sync requieren configuración pública en el gateway, pero worker/sync validan `CRON_SECRET` o una sesión admin dentro de la función.

## Programación

La migración crea `programar_tareas_rappi_v1(...)`, disponible solo para `service_role`. No agenda nada por sí sola y no versiona secretos. Al activarse crea:

- `rappi-worker-v1`: cada minuto.
- sincronización Operational por empresa/ambiente: cada 15 minutos.
- sincronización Financial por empresa/ambiente: diaria a las 12:15 UTC.

`desprogramar_tareas_rappi_v1(...)` retira las tareas de una empresa/ambiente. El worker global se conserva mientras existan otras conexiones.

## Archivos principales

- `supabase/migrations/20260829000000_rappi_v1_core.sql`
- `supabase/functions/_shared/rappi/`
- `supabase/functions/rappi-webhook/index.ts`
- `supabase/functions/rappi-worker/index.ts`
- `supabase/functions/rappi-admin/index.ts`
- `supabase/functions/rappi-sync/index.ts`
- `supabase/functions/rappi-data/index.ts`
- `rappi/index.html`, `rappi/operacion.html`, `rappi/finanzas.html`, `rappi/integracion.html`
- `js/rappi/` y `css/rappi.css`
- `tools/test_rappi_frontend.mjs` y `tools/test_rappi_chrome.mjs`
- `configuracion/index.html` (solo se agregó el enlace al centro Rappi)

No se modificaron `js/header.js`, `js/router.js`, `js/session.js`, `js/supabase.js`, Login, Dashboard, Nómina ni Loggro.

## Validaciones realizadas

### Contrato real Rappi DEV

Las credenciales DEV suministradas se leyeron localmente sin imprimirlas ni copiarlas al repositorio.

- Login Operational: HTTP correcto, token Bearer y expiración válida.
- Tiendas: HTTP 200; se descubrió una tienda DEV.
- Órdenes del endpoint nuevo: HTTP 404 para este cliente DEV.
- Órdenes del endpoint legado: HTTP 200, lista vacía. Por esto `orders_base_url` se conserva separado y configurable.
- Menús en ambos dominios DEV: HTTP 200; una versión encontrada.
- Menú actual de la tienda: HTTP 200.
- Financial: no se pudo probar contra Rappi porque el material recibido no incluye credenciales Financial.
- Integrations Manager: Chrome llegó correctamente al login OAuth de Rappi, pero los campos reservados para usuario/contraseña del portal están vacíos en el plan; no se intentó el acceso ni se alteraron webhooks existentes.

Referencias de contrato: [Rappi Developer Portal](https://dev-portal.rappi.com/), [autenticación](https://dev-portal.rappi.com/en/api-reference/authentication/), [webhooks](https://dev-portal.rappi.com/en/api-reference/webhooks/) y [Financial](https://dev-portal.rappi.com/en/api-reference/financial/).

### Automatizadas

```text
deno check rappi-webhook rappi-worker rappi-admin rappi-sync rappi-data
  OK: 5/5 funciones

deno test supabase/functions/_shared/rappi/*_test.ts
  OK: 11 passed, 0 failed

node tools/test_rappi_frontend.mjs
  OK: 4 páginas, referencias válidas, 8 eventos exactos

node tools/test_rappi_chrome.mjs
  OK: 4 vistas desktop + R3 móvil 390x844, sin overflow horizontal
```

También se probó en Chrome que las cuatro rutas redirigen a `/inicio/` sin sesión.

La SQL completa se ejecutó contra el proyecto enlazado dentro de `BEGIN ... ROLLBACK`: terminó sin error, validando sintaxis y dependencias sin dejar cambios persistentes.

El chequeo global de las 26 Edge Functions existentes encontró dos fallos previos no relacionados y no modificados: falta `_shared/http.ts` para `alerta-manipulacion`, y `wompi-eventos` pasa `null` a un parámetro tipado como `string | undefined`. Se mantienen fuera de esta integración para no ampliar alcance ni alterar funcionalidad existente.

## Estado remoto y activación controlada

No se aplicó la migración, no se desplegaron Edge Functions, no se registraron webhooks remotos y no se hizo deploy de Firebase. Motivo: el proyecto Supabase enlazado es producción y el repositorio tiene **27 migraciones anteriores pendientes**; un `supabase db push` aplicaría todas ellas junto con Rappi.

Secuencia segura cuando se autorice la activación:

1. Revisar las 27 migraciones previas y definir si se aplican o se reparan en el historial. No ejecutar `db push` a ciegas.
2. Aplicar y registrar `20260829000000_rappi_v1_core.sql` mediante un procedimiento aislado aprobado.
3. Confirmar `MASTER_ENCRYPTION_KEY` (o el fallback existente `ENCRYPTION_KEY`) y `CRON_SECRET` en secretos Supabase.
4. Desplegar `rappi-webhook`, `rappi-worker` y `rappi-sync` con `--no-verify-jwt`; desplegar `rappi-admin` y `rappi-data` con verificación JWT.
5. Desde R3 guardar las credenciales DEV, ejecutar las dos pruebas y sincronizar Operational.
6. Suscribir los ocho webhooks DEV desde R3 con confirmación explícita y verificar una firma/entrega real.
7. Invocar `programar_tareas_rappi_v1(...)` desde un entorno seguro con `service_role`, sin escribir `CRON_SECRET` en SQL o logs.
8. Desplegar Hosting y probar R1/R2/R3 con una sesión admin y una sesión operativa.
9. Incorporar credenciales Financial y repetir la certificación R2.
10. Mantener PROD bloqueado hasta recibir dominios/credenciales productivos y aprobación de Rappi.

## Rollback

Rollback funcional, sin borrar datos:

1. Desprogramar por empresa/ambiente con `desprogramar_tareas_rappi_v1(...)`.
2. Deshabilitar la configuración remota de webhooks desde Rappi y marcar `rappi_webhook_configs.state = 'DISABLE'` mediante operación administrativa controlada.
3. Desplegar una versión anterior de Hosting y Edge Functions.
4. Conservar tablas/auditoría `rappi_*` para trazabilidad; no ejecutar `DROP` ni eliminación de filas.

Antes de cualquier retiro definitivo, exportar `rappi_webhook_events`, `rappi_orders`, `rappi_financial_*`, `rappi_reconciliation_records`, `rappi_sync_runs` y `rappi_integration_errors` por `empresa_id`.

## Pendientes externos legítimos

- Credenciales Rappi Financial y acceso al Integrations Manager para ejecutar Testing/retirar endpoints temporales.
- Dominios y credenciales Rappi PROD certificados.
- Reglas contables aprobadas (cuentas, impuestos, medios de pago, documentos y tratamiento por concepto) antes de conectar Loggro.
- Autorización de despliegue en Supabase/Firebase y decisión sobre las 27 migraciones antiguas pendientes.

Estos pendientes no se reemplazaron con supuestos; la operación Rappi queda funcional e independiente y la frontera contable permanece segura.

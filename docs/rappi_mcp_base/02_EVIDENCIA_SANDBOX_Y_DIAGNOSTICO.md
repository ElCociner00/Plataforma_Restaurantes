# Evidencia sandbox y diagnóstico

Fecha de las pruebas: 2026-08-30

Ambiente: Rappi DEV

Tienda sandbox: `900170987` — Batut

## 1. Estado general observado

- Autenticación Rappi: HTTP 200.
- Conexión Enkrato: `CONNECTED`.
- Tiendas descubiertas: 1.
- Tiendas mapeadas: 1.
- Webhooks activos: 8.
- Webhooks que recibieron al menos una solicitud: 8.
- Webhooks con firma válida en la primera ronda: 5.
- Órdenes visibles: 1.
- PING válido: sí.
- Tienda normalizada como `ONLINE`.
- Sincronizaciones operativas recientes: `SUCCEEDED`.

## 2. Resultado por evento en la primera ronda

| Evento | Llegó a Supabase | Firma válida | Resultado inicial |
|---|---:|---:|---|
| `MENU_APPROVED` | Sí | Sí | Correcto |
| `MENU_REJECTED` | Sí | Sí | Correcto |
| `ORDER_EVENT_CANCEL` | Sí | Sí | Correcto |
| `ORDER_OTHER_EVENT` | Sí | Sí | Correcto |
| `PING` | Sí | Sí | Correcto |
| `NEW_ORDER` | Sí | No | `SIGNATURE_MISMATCH` |
| `STORE_CONNECTIVITY` | Sí | No | `SIGNATURE_MISMATCH` |
| `ORDER_RT_TRACKING` | Sí | No | `SIGNATURE_MISMATCH` |

Esto demuestra que las tres URLs eran alcanzables y que Rappi sí ejecutó los POST. No fueron fallos de DNS, routing, mapeo de tienda, JSON ni worker: la recepción se detuvo deliberadamente antes de procesar porque el HMAC no coincidió.

## 3. Efectos operativos observados

Aunque el test de `STORE_CONNECTIVITY` falló por firma, la tienda aparece `ONLINE` porque `PING` sí llegó firmado correctamente y actualizó la salud.

La orden visible quedó en `CANCELLED` y tiene eventos normalizados `ORDER_EVENT_CANCEL` y `ORDER_OTHER_EVENT`. No tiene tracking persistido porque `ORDER_RT_TRACKING` fue rechazado antes de la cola.

La existencia de una orden no prueba por sí sola `NEW_ORDER`: también puede aparecer por sincronización periódica. La certificación de `NEW_ORDER` exige una fila de webhook con firma válida y un evento de orden asociado.

## 4. Corrección aplicada

Se ejecutó una reparación selectiva que:

1. conservó intactos los cinco webhooks sanos;
2. confirmó la URL Supabase de los tres eventos fallidos;
3. confirmó la tienda suscrita;
4. invocó `reset-secret` por evento;
5. cifró y reemplazó cada secreto local;
6. volvió a verificar URL y tienda contra Rappi.

Resultado de la reparación remota:

| Evento | Rotación | URL/tienda confirmadas |
|---|---:|---:|
| `NEW_ORDER` | Correcta | Sí |
| `STORE_CONNECTIVITY` | Correcta | Sí |
| `ORDER_RT_TRACKING` | Correcta | Sí |

Los errores históricos se conservan como evidencia. No deben marcarse resueltos hasta obtener una nueva firma válida.

También se corrigió el procesamiento posterior a HMAC usando los payloads oficiales:

- `STORE_CONNECTIVITY`: reconoce `external_store_id` y el booleano `enabled`;
- `ORDER_RT_TRACKING`: reconoce `eta_in_millis`, `lat`, `lng` y fechas `DD/MM/YYYY HH:mm:ss`;
- un webhook válido resuelve únicamente los incidentes de firma abiertos del mismo evento y conserva `resolved_at`.

Versiones desplegadas después de la corrección:

- `rappi-webhook` versión 5, activa;
- `rappi-worker` versión 4, activa.

## 5. Retest requerido

Volver a disparar en Rappi Integrations Manager, en este orden:

1. `NEW_ORDER`;
2. `STORE_CONNECTIVITY`;
3. `ORDER_RT_TRACKING`.

Esperar unos segundos entre eventos para distinguir timestamps.

Después ejecutar:

```powershell
node tools/run_rappi_dev_onboarding.mjs diagnose
```

Criterios de aceptación:

- `last_valid_signature_at` no nulo y posterior a la rotación en los tres eventos;
- `last_error_code` nulo;
- una orden creada o enriquecida por `NEW_ORDER`;
- un evento de conectividad persistido;
- al menos un registro de tracking en el detalle de la orden;
- ningún error nuevo `SIGNATURE_MISMATCH`.

## 6. Comandos reproducibles

Estado resumido:

```powershell
node tools/run_rappi_dev_onboarding.mjs verify
```

Diagnóstico por evento, sin payloads ni secretos:

```powershell
node tools/run_rappi_dev_onboarding.mjs diagnose
```

Reparación selectiva de los tres secretos:

```powershell
node tools/run_rappi_dev_onboarding.mjs repair-signatures
```

Comprobación directa de autenticación, tienda, suscripciones y endpoint:

```powershell
node tools/test_rappi_dev_credentials.mjs
```

## 7. Lectura de errores

| Código | Interpretación | Acción |
|---|---|---|
| `MALFORMED_SIGNATURE` | Header ausente o formato inesperado | Revisar encabezado recibido y contrato vigente |
| `TIMESTAMP_OUTSIDE_WINDOW` | Evento viejo o relojes desalineados | Revisar reloj/ventana y reintento del proveedor |
| `SIGNATURE_MISMATCH` | Secret o cuerpo firmado no coincide | Rotar solo el evento y retestar; nunca desactivar HMAC |
| `WEBHOOK_SECRET_MISSING` | No existe secreto cifrado | Rehacer suscripción antes de aceptar eventos |
| `INVALID_JSON` | Cuerpo firmado pero no parseable | Conservar hash y escalar con request ID |
| `QUEUE_ERROR` | Validó, pero no se pudo encolar | Reintentar internamente y revisar base de datos |
| `STORE_NOT_MAPPED` | Tienda válida sin tenant destino | Mapear antes de procesar órdenes |

## 8. Evidencia que debe conservarse para certificación

- fecha UTC y hora Colombia;
- ambiente;
- evento;
- HTTP retornado a Rappi;
- request/correlation ID, si Rappi lo entrega;
- `last_received_at` y `last_valid_signature_at`;
- estado de procesamiento;
- ID interno sanitizado de orden/tienda;
- captura del Integrations Manager sin credenciales;
- versión desplegada de la Edge Function.

No copiar firmas, secretos, tokens, payloads con clientes ni credenciales al documento.

## 9. Retest del 30 de agosto: causa definitiva

La rotación selectiva no cambió el resultado de las tres muestras del Integration Manager. Se compararon en backend, sin exponer claves, con el secreto actual del webhook y con el Client Secret operacional. Ninguna coincidió.

Chrome autenticado mostró que la cuenta conserva el alcance `DEFAULT(NOUSAR)` y solo ofrece `DEFAULT (NO USAR) (CO)`. El Client ID DEV entregado a Enkrato no aparece en el selector y las rutas de suscripción/muestra del portal responden `404 NOT FOUND` para ese Client ID. El probador estaba firmando desde un alcance diferente al configurado en Enkrato.

Regla reutilizable para el MCP: antes de una certificación, comparar el Client ID seleccionado en el portal con el Client ID del ambiente. Un `INVALID_SIGNATURE` no se corrige aceptando otro secreto; primero se demuestra qué alcance generó la firma.

## 10. Prueba controlada con secretos Enkrato

La acción DEV `test_webhooks`, protegida por rol admin y confirmación explícita, envió los tres contratos oficiales a los endpoints reales:

| Evento | HTTP | Cola/procesamiento | Evidencia funcional |
|---|---:|---:|---|
| `NEW_ORDER` | 200 | Procesado | Orden `ENKRATO-DEV-*`, total 1.500 |
| `STORE_CONNECTIVITY` | 200 | Procesado | Tienda `ONLINE` |
| `ORDER_RT_TRACKING` | 200 | Procesado | Tracking `ON_THE_WAY` |

Resultado conjunto: tres jobs tomados, tres procesados, cero reintentos y cero muertos. La orden verificada quedó `IN_DELIVERY`, con evento `NEW_ORDER` y un registro de tracking. Los ocho webhooks tienen al menos una firma válida y no quedaron incidentes abiertos.

Esto certifica el receptor, HMAC, persistencia, worker y lectura de Enkrato. La casilla externa pendiente es que Rappi asocie la cuenta del Integration Manager con el Client ID sandbox y la tienda `900170987`; luego se repiten las tres muestras desde el selector correcto.

Comandos actuales:

```powershell
# Compara las muestras problemáticas sin revelar secretos
node tools/run_rappi_dev_onboarding.mjs check-signatures

# Ejecuta orden, conectividad y tracking firmados; verifica los datos persistidos
node tools/run_rappi_dev_onboarding.mjs test-webhooks

# Resume salud, firmas y errores abiertos
node tools/run_rappi_dev_onboarding.mjs diagnose
```

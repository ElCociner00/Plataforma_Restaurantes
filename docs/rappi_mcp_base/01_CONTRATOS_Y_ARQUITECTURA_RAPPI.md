# Contratos y arquitectura Rappi

Fecha de verificación: 2026-08-30

## 1. Alcance comprobado

El conector validado usa la API v2 para restaurantes y cubre:

- autenticación Operational mediante client credentials;
- descubrimiento de tiendas;
- consulta y sincronización de órdenes;
- consulta y publicación de menú;
- ocho webhooks operativos;
- health check mediante `PING`;
- conectividad de tienda;
- tracking de órdenes;
- almacenamiento multiempresa, idempotente y auditable.

Rappi Financial está modelado, pero requiere credenciales Financial independientes y no debe considerarse certificado con las credenciales Operational.

## 2. Ambientes y hosts

### DEV verificado

| Uso | Host |
|---|---|
| Autenticación, tiendas y administración de webhooks | `https://api.dev.rappi.com` |
| Órdenes y menús del tenant probado | `https://microservices.dev.rappi.com` |

No se debe asumir que un solo host sirve todos los recursos. En el tenant de prueba, el endpoint de órdenes y los menús funcionales viven en `microservices.dev.rappi.com`.

### PROD

Los hosts y credenciales productivos deben ser entregados por Rappi durante certificación. La estructura del conector se conserva, pero las bases URL se configuran por ambiente y solo se aceptan hosts HTTPS oficiales bajo `rappi.com`.

Nunca permitir una URL arbitraria proporcionada por el usuario junto con credenciales: eso habilitaría exfiltración de tokens.

## 3. Autenticación

### Operational

```http
POST /restaurants/auth/v1/token/login/integrations
Content-Type: application/json

{
  "client_id": "<desde almacén cifrado>",
  "client_secret": "<desde almacén cifrado>"
}
```

La respuesta esperada contiene `access_token`, `token_type` y `expires_in`.

Las llamadas operativas usan:

```http
x-authorization: Bearer <access_token>
Accept: application/json
```

### Ciclo del token

1. Cifrar credenciales y token en reposo.
2. Guardar `expires_at` calculado con `expires_in`.
3. Reutilizar el token mientras falten más de diez minutos para vencer.
4. Evitar múltiples renovaciones simultáneas con una promesa/lock por conexión y alcance.
5. Ante 401 o 403, invalidar caché, renovar una sola vez y reintentar una vez.
6. No imprimir token, Client ID completo ni Client Secret.

### Financial

Usa credenciales y ruta separadas:

```text
/restaurants/auth/v1/token/login/finance/
```

No mezclar tokens Operational y Financial.

## 4. Endpoints observados

| Función | Método/ruta |
|---|---|
| Tiendas | `GET /api/v2/restaurants-integrations-public-api/stores-pa` |
| Órdenes | `GET /api/v2/restaurants-integrations-public-api/orders` sobre el host de microservicios DEV |
| Menú actual | `GET /api/v2/restaurants-integrations-public-api/menu/rappi/{storeId}` |
| Publicar menú | `POST /api/v2/restaurants-integrations-public-api/menu` |
| Consultar webhook | `GET /api/v2/restaurants-integrations-public-api/webhook/{EVENT}` |
| Crear webhook | `POST /api/v2/restaurants-integrations-public-api/webhook` |
| Agregar tiendas | `PUT .../webhook/{EVENT}/add-stores` |
| Cambiar URL | `PUT .../webhook/{EVENT}/change-url` |
| Rotar secreto | `PUT .../webhook/{EVENT}/reset-secret` |

La documentación oficial indica que `reset-secret` genera una clave nueva por evento y devuelve `event`, `stores` y `secret`. La clave devuelta debe cifrarse inmediatamente y nunca regresar al navegador.

## 5. Webhooks soportados

| Evento | Uso normalizado |
|---|---|
| `NEW_ORDER` | Crear o completar la orden operativa |
| `ORDER_EVENT_CANCEL` | Marcar cancelación sin reabrir estados terminales |
| `ORDER_OTHER_EVENT` | Actualizar eventos operativos adicionales |
| `MENU_APPROVED` | Marcar última versión de menú como aprobada |
| `MENU_REJECTED` | Marcar rechazo y habilitar soporte |
| `PING` | Health check y última señal de vida |
| `STORE_CONNECTIVITY` | Estado online/offline de la tienda |
| `ORDER_RT_TRACKING` | Ubicación, ETA y estado del repartidor |

La lista debe ser cerrada. Un evento desconocido se audita y se ignora sin ejecutar efectos de negocio.

## 6. Firma HMAC

Rappi envía el encabezado:

```text
Rappi-Signature: t=<timestamp>,sign=<hex_sha256>
```

Proceso correcto:

1. leer el cuerpo HTTP como bytes/texto original, antes de `JSON.parse`;
2. separar `t` y uno o más valores `sign`;
3. construir exactamente `t + "." + raw_body`;
4. calcular HMAC-SHA256 usando el secreto del evento;
5. comparar el hexadecimal en tiempo constante;
6. validar una ventana antireplay, diez minutos en la implementación actual;
7. solo entonces parsear, persistir y encolar.

No se debe recalcular la firma sobre `JSON.stringify(JSON.parse(body))`: cambia espacios, orden o representación y rompe la firma.

Rotación segura:

1. invocar `reset-secret` para un evento específico;
2. validar que la respuesta tenga un secreto no vacío;
3. cifrarlo con AES-GCM;
4. confirmar por GET que URL, estado y tiendas siguen correctos;
5. disparar un evento real y verificar `last_valid_signature_at`.

## 7. Recepción asíncrona

Ruta recomendada:

```text
POST /functions/v1/rappi-webhook/{endpoint_key}/{EVENT}
```

El `endpoint_key` aleatorio evita una ruta trivial, pero no reemplaza HMAC.

Flujo:

```text
Rappi
  -> límite de tamaño
  -> HMAC y antireplay
  -> idempotencia
  -> auditoría raw restringida
  -> cola
  -> respuesta 2xx rápida
  -> worker
  -> tablas normalizadas
```

La cola debe tener claim atómico, reintentos con backoff, límite de intentos y estado muerto revisable.

## 8. Idempotencia y estados

Prioridad para la llave idempotente:

1. `event_id`, `eventId` o `idempotency_key` del proveedor;
2. combinación evento + orden + tienda + fecha del proveedor;
3. hash SHA-256 del cuerpo como último componente.

Reglas de estado:

- una cancelación siempre normaliza a `CANCELLED`;
- un evento antiguo no reemplaza uno más reciente;
- una orden terminal no se reabre por un evento no terminal;
- `NEW_ORDER` normaliza inicialmente a `RECEIVED`;
- tracking puede mover la orden hacia entrega, pero no revertir un estado terminal.

## 9. Normalización de payloads

### Identificadores

Aceptar variantes conocidas:

- orden: `order_detail.order_id`, `order_id`, `orderId`;
- tienda: `store_id`, `storeId`, `order_detail.store_id`, `store.internal_id`, `store.integrationId`, `store.id`, `store.external_id`;
- fecha: `event_time`, `timestamp`, `updated_at`, `created_at` y campos equivalentes en `order_detail`.

### Tracking

Normalizar:

- `latitude` o `lat`;
- `longitude` o `lng`;
- `eta_type` o `etaType`;
- `courier_id` o `courierId`;
- `status` o `tracking_status`.

### Conectividad

La documentación vigente muestra para `STORE_CONNECTIVITY` campos como `external_store_id`, `enabled` y `message`. El normalizador debe aceptar además `online`, `is_online`, `connected`, `success`, `status`, `state` o `connectivity`.

`PING` sin estado explícito se interpreta como señal positiva si la firma es válida y el endpoint pudo responder 200 con:

```json
{ "status": "OK" }
```

## 10. Aislamiento y seguridad

- Una conexión por `empresa_id + environment`.
- Credenciales, tokens y secretos en tablas sin lectura para clientes.
- Mapeo explícito entre tienda Rappi y tenant interno.
- Toda consulta del MCP debe resolver el tenant desde la identidad autenticada; no confiar solo en un `empresa_id` enviado por el modelo.
- Sanitizar PII de clientes, direcciones, teléfonos, documentos y datos bancarios antes de exponer respuestas al MCP.
- Las herramientas de escritura deben exigir confirmación explícita y una llave de idempotencia.
- Registrar actor, herramienta, argumentos sanitizados, resultado y correlation ID.

## 11. Referencias oficiales

- Autenticación: https://dev-portal.rappi.com/en/api-reference/authentication/
- Administración de webhooks: https://dev-portal.rappi.com/en/api-reference/webhooks/
- Eventos y HMAC: https://dev-portal.rappi.com/es/webhook-events
- Órdenes: https://dev-portal.rappi.com/managing-user-orders/
- Menús: https://dev-portal.rappi.com/managing-store-menus/
- Disponibilidad: https://dev-portal.rappi.com/managing-availability/

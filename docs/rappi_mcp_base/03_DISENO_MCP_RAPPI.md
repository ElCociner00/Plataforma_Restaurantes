# Diseño propuesto para un MCP de Rappi

## 1. Propósito del producto

El MCP debe convertir la integración Rappi en capacidades seguras y reutilizables para asistentes: consultar operación, diagnosticar incidencias, preparar cambios y, en fases posteriores, ejecutar acciones aprobadas.

No debe ser un proxy genérico que permita llamar cualquier URL de Rappi. Cada herramienta tiene un contrato, permiso y efecto definido.

## 2. Separación de responsabilidades

```text
Cliente MCP
  -> autenticación del usuario
  -> resolución del tenant
  -> autorización por herramienta
  -> servicio Rappi multiempresa
  -> API Rappi / datos normalizados
  -> auditoría y respuesta sanitizada
```

El servidor MCP nunca debe recibir Client Secret en cada invocación. Las credenciales se registran mediante onboarding, se cifran y se referencian por conexión.

## 3. Herramientas de fase 1: solo lectura

### `rappi_connection_status`

Devuelve ambiente, estado, token vigente, tiendas mapeadas, última sincronización, salud de webhooks y errores abiertos.

### `rappi_list_stores`

Lista tiendas del alcance del usuario con nombre, conectividad, último PING, estado de menú y mapeo interno. No expone secretos ni IDs de otros tenants.

### `rappi_list_orders`

Argumentos sugeridos:

```json
{
  "connection_id": "uuid",
  "from": "YYYY-MM-DD",
  "to": "YYYY-MM-DD",
  "status": "RECEIVED|IN_PROGRESS|READY|IN_DELIVERY|COMPLETED|CANCELLED",
  "store_id": "uuid opcional",
  "search": "texto opcional",
  "page": 1,
  "page_size": 25
}
```

### `rappi_get_order`

Devuelve la orden sanitizada, productos, totales, eventos y tracking. Excluye nombre, teléfono, correo, dirección, documento y campos bancarios del consumidor.

### `rappi_get_menu_status`

Devuelve la versión conocida del menú, aprobación, cantidad de productos y última actualización.

### `rappi_diagnose_webhooks`

Devuelve por evento: estado, recepción, última firma válida, último error y host de destino. No devuelve URL completa si incluye una llave de endpoint.

### `rappi_get_incidents`

Agrupa incidentes operativos, de seguridad, sincronización y conciliación con acciones recomendadas.

## 4. Herramientas de fase 2: administración controlada

### `rappi_validate_credentials`

Prueba autenticación y descubrimiento de tiendas sin guardar credenciales salvo confirmación posterior.

### `rappi_onboard_connection`

Debe requerir confirmación explícita porque guarda credenciales, registra webhooks y programa tareas.

### `rappi_map_store`

Relaciona una tienda Rappi con un tenant/local visible. El servidor vuelve a validar el alcance; no confía en el modelo.

### `rappi_sync_now`

Sincroniza `stores`, `orders`, `menus` o `operational`. Debe devolver un `sync_run_id` para seguimiento.

### `rappi_rotate_webhook_secret`

Rota un solo evento o una lista cerrada. Debe confirmar URL/tienda y dejar el error histórico abierto hasta un evento válido.

## 5. Herramientas de fase 3: acciones operativas

Solo deben habilitarse después de certificación y pruebas específicas:

- aceptar/rechazar una orden;
- marcar lista para recoger;
- cambiar disponibilidad de producto;
- publicar menú;
- aplicar descuentos compatibles con Rappi Growth.

Requisitos obligatorios:

- permiso de escritura específico;
- confirmación humana para acciones de alto impacto;
- llave de idempotencia;
- previsualización del cambio;
- auditoría;
- límites de tasa;
- respuesta diferenciando aceptado por Rappi de aplicado efectivamente.

## 6. Recursos MCP

Recursos sugeridos:

```text
rappi://connections/{connection_id}/status
rappi://connections/{connection_id}/stores
rappi://connections/{connection_id}/orders/{order_id}
rappi://connections/{connection_id}/webhooks
rappi://connections/{connection_id}/incidents
rappi://docs/capabilities
```

Los recursos deben ser snapshots de lectura con timestamps, no canales para ejecutar acciones.

## 7. Prompts reutilizables

- “Resume la operación Rappi de hoy y señala órdenes estancadas”.
- “Diagnostica por qué una tienda aparece offline”.
- “Compara menú publicado, aprobado y stock actual”.
- “Prepara un informe de certificación de webhooks”.
- “Explica un incidente sin exponer información del consumidor”.

## 8. Modelo de permisos

Scopes sugeridos:

```text
rappi:read:connections
rappi:read:stores
rappi:read:orders
rappi:read:menus
rappi:read:incidents
rappi:admin:onboard
rappi:admin:webhooks
rappi:write:orders
rappi:write:menus
rappi:write:availability
```

Un rol administrativo de Enkrato no implica automáticamente todos los scopes de escritura del MCP.

## 9. Contrato común de respuesta

Éxito:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "environment": "DEV",
    "fetched_at": "ISO-8601",
    "correlation_id": "uuid",
    "source": "normalized|rappi_live"
  }
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "RAPPI_AUTH|RAPPI_RATE_LIMIT|RAPPI_TIMEOUT|NOT_AUTHORIZED",
    "message": "Mensaje seguro y accionable",
    "retryable": false
  },
  "meta": {
    "correlation_id": "uuid"
  }
}
```

Nunca devolver respuestas crudas del proveedor que puedan contener secretos o PII.

## 10. Observabilidad

Métricas mínimas:

- porcentaje de webhooks 2xx;
- porcentaje de firmas válidas por evento;
- latencia de recepción y procesamiento;
- edad del último PING por tienda;
- trabajos pendientes/retry/dead;
- renovaciones de token y fallos de autenticación;
- tasa 429 y 5xx por endpoint;
- sincronizaciones completas/parciales/fallidas;
- acciones de escritura por herramienta y actor.

## 11. Pruebas del MCP

1. Unitarias: HMAC, estados, payloads, PII, idempotencia y autorización.
2. Contrato: esquemas de entrada/salida de cada herramienta.
3. Integración DEV: credenciales, tiendas, webhooks y órdenes sandbox.
4. Multitenencia: usuario A nunca puede leer o mutar conexión B.
5. Replay: un mismo webhook no duplica efectos.
6. Fallos: timeout, 401, 403, 429, 5xx, firma inválida y cola caída.
7. Certificación: evidencia de cada evento y acción productiva habilitada.

## 12. Fases recomendadas

1. Publicar lectura y diagnóstico sobre datos normalizados.
2. Incorporar onboarding autogestionable y rotación de secretos.
3. Certificar acciones operativas una por una.
4. Añadir menús, disponibilidad y descuentos.
5. Añadir Financial solo con credenciales y reglas aprobadas.

La primera versión comercial debe privilegiar diagnóstico, visibilidad multiempresa y operación segura. Es útil sin otorgar al modelo permisos para modificar pedidos o catálogos.

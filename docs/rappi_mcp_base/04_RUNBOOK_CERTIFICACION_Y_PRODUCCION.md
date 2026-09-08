# Runbook de certificación y producción

## 1. Preparación DEV

- Credenciales Operational activas.
- Client ID y Client Secret en almacén cifrado.
- `MASTER_ENCRYPTION_KEY` y secreto de cron configurados en servidor.
- Tiendas descubiertas.
- Cada tienda mapeada a un tenant/local.
- Ocho webhooks registrados con HTTPS.
- Secretos HMAC cifrados por evento.
- Worker y sincronización programados.
- Interfaz/cliente MCP usando únicamente endpoints de servidor.

## 2. Prueba de autenticación

1. Obtener token.
2. Exigir `access_token` y `expires_in` válidos.
3. Consultar tiendas.
4. Confirmar que la tienda esperada pertenece al cliente.
5. No continuar con webhooks si la autenticación o el alcance fallan.

## 3. Certificación de webhooks

Probar por separado:

1. `NEW_ORDER`.
2. `ORDER_EVENT_CANCEL`.
3. `ORDER_OTHER_EVENT`.
4. `MENU_APPROVED`.
5. `MENU_REJECTED`.
6. `PING`.
7. `STORE_CONNECTIVITY`.
8. `ORDER_RT_TRACKING`.

Para cada uno conservar:

- timestamp Rappi;
- timestamp receptor;
- HTTP respondido;
- firma válida;
- estado de cola;
- efecto normalizado;
- versión desplegada;
- correlation ID.

No aprobar un evento únicamente porque el simulador muestre “enviado”: debe existir evidencia de firma y efecto.

## 4. Certificación de órdenes

1. Crear orden sandbox.
2. Verificar `NEW_ORDER` y productos/totales.
3. Ejecutar eventos de progreso disponibles.
4. Confirmar que un evento antiguo no revierte el estado.
5. Probar cancelación.
6. Confirmar idempotencia repitiendo el mismo evento.
7. Probar tracking y ETA.
8. Confirmar que la UI/MCP no expone PII.

## 5. Menú, stock y descuentos

Antes de habilitar escritura:

- validar tamaño y esquema del menú;
- usar SKUs estables;
- soportar respuesta de aprobación/rechazo;
- evitar publicaciones simultáneas;
- implementar disponibilidad con estado previo y confirmación;
- documentar cómo Rappi representa descuentos y totales;
- probar rollback de menú/stock.

Referencias:

- https://dev-portal.rappi.com/managing-store-menus/
- https://dev-portal.rappi.com/managing-availability/
- https://dev-portal.rappi.com/managing-user-orders/#order-totals-and-discounts

## 6. Paso de DEV a PROD

1. Obtener por canal seguro las bases URL y credenciales PROD.
2. Crear una conexión PROD separada; nunca sobrescribir DEV.
3. Validar que los hosts sean HTTPS oficiales de Rappi.
4. Autenticar y descubrir tiendas PROD.
5. Mapear tiendas antes de recibir órdenes.
6. Registrar URLs productivas estables.
7. Almacenar secretos HMAC devueltos por PROD.
8. Probar PING y un evento certificado de bajo riesgo.
9. Habilitar órdenes gradualmente.
10. Mantener Financial apagado hasta recibir credenciales propias.

Las rutas funcionales pueden conservar estructura, pero las bases URL, credenciales, tiendas y secretos siempre son independientes por ambiente.

## 7. Despliegue seguro

Orden recomendado:

1. migraciones aditivas;
2. Edge Functions/backend compatibles hacia atrás;
3. pruebas de salud;
4. configuración remota de webhooks;
5. frontend o cliente MCP;
6. evento canario;
7. monitoreo reforzado.

No cambiar simultáneamente URL y secreto de todos los eventos si basta reparar uno. Una rotación selectiva reduce el radio de impacto.

## 8. Alertas

| Condición | Severidad sugerida |
|---|---|
| PING ausente más de 5 minutos | Warning |
| Firma inválida | Critical de seguridad |
| Cola en retry creciente | Warning |
| Trabajo DEAD | Critical operativo |
| Token no renovable | Critical |
| Tasa 429 sostenida | Warning |
| Tienda offline | Warning/critical según duración |
| NEW_ORDER sin efecto normalizado | Critical |

## 9. Rollback

1. Detener acciones de escritura.
2. Deshabilitar webhooks afectados o cambiar su estado de forma controlada.
3. Desprogramar sincronizaciones de la conexión afectada.
4. Revertir backend/cliente a una versión compatible.
5. Conservar eventos, errores y órdenes para auditoría.
6. No borrar tablas ni eventos durante el incidente.
7. Rotar secretos si hubo exposición.

## 10. Checklist de salida

- [ ] 8/8 eventos recibidos.
- [ ] 8/8 firmas válidas después de la última rotación.
- [ ] 0 errores nuevos de firma.
- [ ] PING reciente.
- [ ] Conectividad normalizada.
- [ ] Orden creada por `NEW_ORDER`.
- [ ] Cancelación e idempotencia verificadas.
- [ ] Tracking persistido.
- [ ] Menú aprobado/rechazado probado.
- [ ] Pruebas multiempresa aprobadas.
- [ ] Secretos ausentes de Git, logs y respuestas.
- [ ] Métricas y alertas activas.
- [ ] Procedimiento de rollback ensayado.
- [ ] Aprobación/certificación Rappi registrada.

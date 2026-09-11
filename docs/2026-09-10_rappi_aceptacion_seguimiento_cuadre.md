# Rappi: aceptación automática, seguimiento de domicilios y cuadre diario

Fecha: 10–11 de septiembre de 2026
Rama: `feat/rappi-aceptacion-seguimiento-cuadre`

## Objetivo

Que un empleado sin acceso a Rappi pueda responder, por cada pedido, tres preguntas:

1. **¿Está pago?** Qué debe cobrar el repartidor y qué pagó el cliente dentro de Rappi.
2. **¿Dónde va?** Recibido, en preparación, listo, repartidor en tienda, en camino, llegó, entregado.
3. **¿Existe?** Confirmar con Rappi que un número de pedido es real antes de despachar.

Y que el administrador pueda cuadrar cada día lo que Rappi registró contra lo que se declaró en el cierre de turno. El caso que motivó esto fue un excliente que pagaba domicilios con transferencias falsas: todos creían que estaba pago y al conciliar el ingreso no existía.

## Causa raíz del "NEW_ORDER no funciona"

El webhook sí recibía `NEW_ORDER`, validaba la firma y guardaba la orden. El problema era posterior: **Enkrato nunca tomaba la orden**. Con webhooks activos, Rappi deja la orden en `SENT` y espera `PUT orders/{id}/take/{cookingTime}` durante 6 minutos. Si nadie la toma, pasa a `TIMEOUT` y **no envía ningún webhook** avisándolo. Por eso la orden 1676746142 aparecía "recibida" para siempre en Enkrato mientras en Rappi estaba vencida.

Había dos fallas más detrás de esa:

- Los nombres oficiales de los eventos de orden (`close_order`, `hand_to_domiciliary`, `domiciliary_in_store`, `arrive`…) no coincidían con las heurísticas de texto. Una orden entregada nunca llegaba a "Entregado".
- Rappi manda horas locales de Colombia sin zona, en dos formatos (`2026-09-10 20:43:54` y `2026-09-10T20:44:03`). El segundo se leía como UTC y quedaba corrido 5 horas.

## Qué cambió

### Backend (Edge Functions)

| Pieza | Cambio |
|---|---|
| `_shared/rappi/orders.ts` (nuevo) | `acceptOrder` hace el take con reintentos (429/5xx), clasifica la respuesta (200 aceptada, 400/409 ya no espera, otro = falla), actualiza de forma condicionada y deja evento `ENKRATO_ACCEPT`. `fetchOrderEvents` y `fetchSentOrders` para la red de seguridad. |
| `_shared/rappi/payload.ts` | Mapa `OFFICIAL_ORDER_STATUS` antes de las heurísticas; `replace_storekeeper` es informativo; `sanitizeEventInformation` conserva solo el nombre del repartidor (sin teléfono, foto ni documento); `parseDate` aplica -05:00 a ambos formatos. |
| `_shared/rappi/state.ts` | Un estado nunca retrocede; un avance gana aunque el reloj de Rappi esté atrasado; `NOT_ACCEPTED` (inferido por Enkrato) cede ante cualquier dato real de Rappi. |
| `rappi-webhook` | Tras encolar un evento de orden despierta al worker (`kick`) en segundo plano, para no esperar el cron de 1 minuto dentro de la ventana de 6. |
| `rappi-worker` | `NEW_ORDER` → guarda y acepta. Barrido cada minuto (con candado de 40 s por conexión): recupera órdenes en `SENT` que no llegaron por webhook, reintenta aceptaciones pendientes, consulta eventos de pedidos activos cada 2 min durante 12 h y marca `NOT_ACCEPTED` pasados 7 min sin eventos. |
| `rappi-data` | Acciones `board` (tablero del día en hora de Bogotá + pedidos activos arrastrados), `verify_order`, `accept_order` y `cuadre` (solo admin). |
| `rappi-admin` | Acción `store_settings` para el interruptor `auto_accept` por tienda. |
| `rappi-sync` | Libera corridas colgadas (>10 min), mejores mensajes de error y estado de aceptación en órdenes nuevas. |

### Base de datos

Migración `20260911012528_rappi_aceptacion_seguimiento_cuadre.sql`:

- `rappi_stores.auto_accept` (por defecto `true`).
- `rappi_orders`: `acceptance_status` (UNKNOWN/PENDING/ACCEPTED/MANUAL/FAILED), intentos, `accepted_at`, error, `courier_name`, `delivered_at`, `cancelled_at`, `cancel_event`, `last_provider_check_at`.
- `rappi_connections.last_order_sweep_at` (candado del barrido).
- RPC `rappi_cuadre_diario(empresa, desde, hasta)`, `SECURITY DEFINER` y ejecutable solo por `service_role`. Cruza pedidos Rappi por día de Bogotá con `rappi_sistema` / `rappi_real` de `v_turnos_pivote`.

### Frontend

- **Pedidos Rappi** (`rappi/operacion.html`): verificador de pedido por número, KPIs del día, lista con barra de avance que se refresca cada 30 s, y detalle con los veredictos "¿Está pago?" y "¿Dónde va?", repartidor asignado, botón "Aceptar ahora" cuando la aceptación falló, productos e historial.
- **Cuadre Rappi** (`rappi/cuadre.html`, solo admin): rango de fechas, totales, tabla por día que marca diferencias entre Rappi y el cierre, métodos de pago, CSV e impresión. Los días anteriores al primer pedido recibido por la integración se muestran **sin comparar**, para no marcar como sospechosos cierres de empresas que aún no tienen Rappi conectado.
- **Integración Rappi**: interruptor "Aceptar pedidos automáticamente" por tienda; al apagarlo pide confirmación.
- `js/rappi/veredictos.js`: lógica pura de pago/entrega/cancelación, con pruebas propias.

## Verificación

- Pruebas: `node tools/test_rappi_backend.mjs` (34/34), `node tools/test_rappi_veredictos.mjs`, `node tools/test_rappi_frontend.mjs`.
- **En vivo en DEV**: orden de simulador 1702645662 (agua $6.500, tarjeta) llegó a las 01:43:57 UTC y quedó aceptada a las 01:43:58. Rappi la muestra `TAKEN`.
- El barrido marcó la orden vieja 1676746142 como `NOT_ACCEPTED`, igual que el `TIMEOUT` que Rappi muestra.
- El sandbox no simula repartidores, así que el resto del ciclo (listo → repartidor en tienda → en camino → llegó → entregado) se probó con 5 eventos sintéticos sobre la misma orden, solo en la empresa de prueba.
- La UI se revisó con un banco de pruebas local (páginas reales con datos copiados de la base), porque no se puede iniciar sesión en la plataforma desde el agente.
- RPC del cuadre probado como `service_role` dentro de una transacción con `ROLLBACK`.

Versiones desplegadas: `rappi-worker` v8, `rappi-webhook` v8, `rappi-data` v8, `rappi-sync` v6, `rappi-admin` v12.

## Datos sintéticos que quedaron en DEV

En `rappi_webhook_events`, 5 filas con `idempotency_key` que empieza por `PRUEBA-ENKRATO-CICLO-1702645662-`, `signature_valid = false` y `selected_headers.synthetic = true`. Solo afectan a la empresa de prueba. Para borrarlas si se quiere:

```sql
delete from rappi_webhook_events where idempotency_key like 'PRUEBA-ENKRATO-CICLO-%';
```

(La orden 1702645662 quedaría en `COMPLETED` con los datos ya aplicados.)

## Límites conocidos

- Transferencias directas al restaurante (fuera de Rappi) no se pueden verificar con la API de Rappi; el veredicto de pago solo cubre pedidos hechos por la app.
- La API Financial sigue en espera; el cuadre usa los totales de las órdenes, no las liquidaciones.
- Producción Rappi sigue bloqueada hasta tener credenciales PROD.

## Decisiones pendientes

1. **Aceptación automática en producción.** Si el restaurante también usa la tablet de Rappi, dos sistemas aceptando la misma orden no rompe nada (la segunda recibe 400/409 y Enkrato lo registra como "ya no espera"), pero conviene decidir quién es el responsable. El interruptor por tienda lo permite.
2. Si el fraude fue por pedidos directos (WhatsApp/teléfono) pagados con transferencia, hace falta otro control (conciliación bancaria), no Rappi.

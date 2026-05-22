# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 5 parches

## 1) Objetivo de la petición
Corregir un error crítico de **coherencia de datos enviados** en el submódulo de detalle de Compras, donde en algunos casos el payload enviado no correspondía a la factura visualizada ni a sus productos seleccionados. Se implementa refuerzo para garantizar que el payload se construya desde un snapshot inmutable del detalle activo y se descarte cualquier respuesta asíncrona obsoleta.

## 2) Archivos implicados y tipo de modificación
1. `js/compras.js`
- **Tipo:** corrección funcional crítica (integridad de payload).
- **Objetivo:** asegurar consistencia 1:1 entre factura abierta en UI y datos enviados al webhook.
- **Qué hace explícitamente:**
  - añade `detailRequestToken` para invalidar respuestas asíncronas antiguas (evita mezclar detalle de otra factura),
  - añade `detalleSnapshot` para guardar filas de detalle activas e inmutables por factura abierta,
  - construye `items` de envío usando `snapshot + rowIndex` en lugar de depender solo del texto dinámico del DOM,
  - refuerza filtro del detalle para incluir únicamente filas que pertenezcan a `uuid`/`prefijo+consecutivo` de la factura activa,
  - conserva consolidación de filas duplicadas por producto y suma cantidades,
  - añade `factura_prefijo` y `factura_consecutivo` también en payload raíz para trazabilidad backend.

2. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_5_parches.md`
- **Tipo:** documentación incremental de parche.
- **Objetivo:** trazabilidad del quinto parche y plan de reversión/portado.

## 3) Notas de emergencia para revertir este parche
### Reversión puntual
1. En `js/compras.js`:
- remover variables `detalleSnapshot` y `detailRequestToken`.
- en `openDetalleFactura`, eliminar control por token y volver a flujo directo.
- en `btnEnviar`, volver a construir items sin snapshot (no recomendado, solo rollback).
- en `normalizeDetalleRows`, retirar filtro estricto por factura activa si se requiere volver al estado previo.

2. Validación tras reversión:
- abrir facturas en secuencia rápida y confirmar si reaparece mezcla de datos entre facturas.

### Reversión total
Aplicar instrucciones de parches previos/base para desmontar módulo Compras.

## 4) Convención de nombre
Se renombra con incremento de parche:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_5_parches.md`

## 5) Exportar a otro repositorio
Particularidad crítica del portado:
- replicar patrón de **token asíncrono + snapshot de detalle** para evitar race conditions.

Pasos de portado recomendados:
1. portar `detalleSnapshot` y `detailRequestToken`.
2. usar `rowIndex` en cada `<tr>` y mapear a snapshot al enviar.
3. filtrar detalle por identificadores de factura activa (`uuid` y fallback `prefijo+consecutivo`).
4. validar en QA con clicks rápidos entre facturas distintas y envío consecutivo.

## 6) Check de funcionamiento (logs)
- Integridad factura activa vs payload enviado: **funciona**.
- Prevención de mezcla por respuestas asíncronas antiguas: **funciona**.
- Consolidación de productos duplicados por nombre: **funciona**.
- Filtro BANCOLOMBIA/IMPUESTO/IVA: **funciona**.
- Envío `Enviar` con `usuario_id` y `sale_de_caja`: **funciona**.
- Envío `No corresponde` con `no_corresponde: true`: **funciona**.

## 7) Próximos parches
Siguiente ajuste incremental debe renombrarse a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_6_parches.md`

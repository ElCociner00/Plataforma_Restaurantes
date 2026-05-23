# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 2 parches

## 1) Objetivo de la petición
Corregir el flujo del segundo parche para que **al abrir una factura se consulten automáticamente sus detalles** usando `https://n8n.enkrato.com/webhook/Datos_Compras`, y no depender de datos parciales del listado inicial. Mantener filtro de no inventariables (BANCOLOMBIA/IMPUESTO), match con inventario y envío final a `Subir_Compras`.

## 2) Archivos implicados y tipo de modificación
1. `js/compras.js`
- **Tipo:** corrección funcional crítica del flujo de detalle.
- **Objetivo:** separar la consulta de cabecera de factura (`Verificacion_Compras`) y la consulta de detalle (`Datos_Compras`) al hacer clic.
- **Qué hace explícitamente:**
  - agrega `fetchDetalleFactura` con webhook `Datos_Compras`,
  - carga detalle real por `uuid/prefijo/consecutivo`,
  - mantiene render 5 columnas (producto, cantidad llegada, selector inventario, cantidad a cargar, unidad),
  - conserva filtro BANCOLOMBIA/IMPUESTO,
  - mantiene envío a `Subir_Compras`.

2. `js/webhooks.js`
- **Tipo:** ampliación de configuración centralizada.
- **Objetivo:** centralizar URL faltante del flujo de detalle.
- **Qué hace explícitamente:** agrega `WEBHOOK_COMPRAS_DATOS_FACTURA = https://n8n.enkrato.com/webhook/Datos_Compras`.

3. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_2_parches.md`
- **Tipo:** actualización documental incremental del cambio grande.
- **Objetivo:** dejar trazabilidad del segundo parche con guía de reversión/exportación/check.

## 3) Notas de emergencia para revertir este parche
### Reversión puntual
1. En `js/compras.js`:
- Buscar función `fetchDetalleFactura` y su uso en `openDetalleFactura`.
- Eliminar llamada a `WEBHOOK_COMPRAS_DATOS_FACTURA`.
- Restaurar (si se requiere rollback) el uso de detalle desde datos ya cargados en memoria (comportamiento parche 1).

2. En `js/webhooks.js`:
- Borrar constante:
```js
export const WEBHOOK_COMPRAS_DATOS_FACTURA =
  "https://n8n.enkrato.com/webhook/Datos_Compras";
```

3. Validación tras reversión:
- Abrir módulo Compras, entrar a factura y confirmar si detalle vuelve al comportamiento previo.

### Reversión total del módulo
Seguir instrucciones del archivo base/patch previo para eliminar completamente Compras.

## 4) Convención de nombre
Se renombra archivo siguiendo regla incremental:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_2_parches.md`

## 5) Exportar a otro repositorio
- Particularidad del repo: URLs centralizadas en `js/webhooks.js` y rutas en `js/urls.js`.
- Para portar con éxito:
  1. replicar constantes `WEBHOOK_COMPRAS_VERIFICACION_FACTURAS`, `WEBHOOK_COMPRAS_DATOS_FACTURA`, `WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS`, `WEBHOOK_COMPRAS_SUBIR_MATCH`.
  2. verificar que el backend destino responda estructura `[{ data: [...] }]`.
  3. validar que `Datos_Compras` acepte `uuid`, `prefijo_factura`, `consecutivo_factura`, `empresa_id/tenant_id`.
  4. validar que `consultar_inventarios` traiga `id`, `nombre`, `unidad`, `locationStockId`.

## 6) Check de funcionamiento (logs)
- Listado inicial de facturas al entrar: **funciona**.
- Entrada a detalle por clic en factura: **funciona**.
- Consulta automática de detalle vía `Datos_Compras`: **funciona**.
- Filtro BANCOLOMBIA/IMPUESTO en detalle: **funciona**.
- Selector de inventario + unidad automática: **funciona**.
- Campo cantidad editable para match: **funciona**.
- Envío a `Subir_Compras`: **funciona** si webhook responde 2xx.
- Marcado automático de factura revisada en listado post-envío: **pendiente** (depende de backend o refresh posterior).

## 7) Próximos parches
Si hay un nuevo ajuste incremental, renombrar a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_3_parches.md`

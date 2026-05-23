# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 1 parche

## 1) Objetivo de la petición
Implementar y corregir el módulo **Compras** para que:
- Cargue automáticamente al entrar las facturas desde `https://n8n.enkrato.com/webhook/Verificacion_Compras`.
- Muestre primero tarjetas/rows de facturas (pendientes/revisadas).
- Permita entrar al subflujo de detalle al seleccionar una factura.
- En el detalle haga match entre producto factura y producto inventario (con unidad y cantidad) y envíe a `https://n8n.enkrato.com/webhook/Subir_Compras`.

## 2) Archivos implicados y tipo de modificación

### Archivos modificados (parche)
1. `compras/index.html`
- **Tipo:** refactor de estructura de UI.
- **Objetivo:** quitar botón de consulta, mostrar facturas como pantalla principal y mover botón Enviar al submódulo detalle.
- **Qué hace explícitamente:**
  - elimina acción manual de consulta,
  - agrega vista detalle oculta por defecto,
  - deja botón `Enviar` dentro de detalle de factura.

2. `css/compras.css`
- **Tipo:** ajustes de layout y estados visuales.
- **Objetivo:** mantener diseño horizontal, adaptable a móviles sin desplazamiento horizontal global, y cards de facturas clicables.
- **Qué hace explícitamente:** estilos para tarjetas con estado `Pendiente/Revisada`, cabecera de detalle, tabla y botón de envío interno.

3. `js/compras.js`
- **Tipo:** refactor funcional completo del flujo.
- **Objetivo:** alinear comportamiento con requerimiento de 2 etapas (listado facturas -> detalle factura).
- **Qué hace explícitamente:**
  - auto-consulta facturas en `WEBHOOK_COMPRAS_VERIFICACION_FACTURAS` al entrar,
  - renderiza rows/cards de facturas,
  - abre detalle al clic en tarjeta,
  - consulta inventarios automáticamente al abrir detalle,
  - filtra productos `BANCOLOMBIA` e `IMPUESTO`,
  - renderiza 5 columnas solicitadas,
  - envía payload final a `Subir_Compras`.

4. `js/webhooks.js`
- **Tipo:** ampliación de configuración centralizada.
- **Objetivo:** registrar webhook faltante para la primera fase del módulo.
- **Qué hace explícitamente:** agrega `WEBHOOK_COMPRAS_VERIFICACION_FACTURAS` (`Verificacion_Compras`).

5. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_1_parche.md`
- **Tipo:** documentación incremental del mismo cambio mayor.
- **Objetivo:** dejar trazabilidad del parche posterior según regla de parches.

## 3) Notas de emergencia para revertir este parche

### Reversión mínima (volver al comportamiento previo del PR original)
1. En `js/webhooks.js`, borrar bloque:
```js
export const WEBHOOK_COMPRAS_VERIFICACION_FACTURAS =
  "https://n8n.enkrato.com/webhook/Verificacion_Compras";
```

2. En `js/compras.js`:
- Eliminar flujo `init()->fetchFacturas()->renderFacturas()` automático.
- Restaurar flujo basado en botón externo de consulta (si se desea volver exactamente al diseño anterior).
- Remover `openDetalleFactura` y navegación de submódulo si se desea interfaz plana.

3. En `compras/index.html`:
- Eliminar sección `#comprasDetalle`.
- Reponer controles globales (botones en parte superior) si se requiere rollback total visual.

4. En `css/compras.css`:
- Eliminar clases nuevas de este parche:
  - `.factura-card-head`, `.factura-tag.*`, `.compras-detalle-head`, `.compras-detalle-actions`.

### Reversión total del módulo Compras
Seguir además los pasos del documento base (eliminar ruta `APP_URLS.compras`, enlace en `header`, archivos nuevos, etc.).

## 4) Convención de nombre del documento
Se aplicó regla de parche en mismo archivo mayor renombrado a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_1_parche.md`

## 5) Exportar a otro repositorio (guía)

### Particularidad crítica de este repositorio
Este frontend centraliza:
- rutas en `js/urls.js`,
- navegación en `js/header.js`,
- endpoints en `js/webhooks.js`.

Para portar exitosamente, replicar esa centralización o mapearla en un archivo equivalente.

### Orden de portado recomendado
1. Portar `compras/index.html` y `css/compras.css`.
2. Portar `js/compras.js`.
3. Agregar webhook `Verificacion_Compras` + `consultar_inventarios` + `Subir_Compras` en archivo central de endpoints.
4. Validar contexto de empresa (`empresa_id/tenant_id`) para los 3 llamados.
5. Verificar integración de ruta `APP_URLS.compras` y enlace en header.

### Validaciones para compatibilidad funcional
- `Verificacion_Compras` debe devolver estructura con `data[]` y campos de factura.
- Deben existir filas de detalle con `Producto` y `Cantidad`; sin esto no habrá líneas inventariables en detalle.
- `consultar_inventarios` debe retornar `id`, `nombre`, `unidad`, `locationStockId`.
- Confirmar que no existan colisiones de IDs de DOM (`comprasFacturas`, `comprasDetalle`, `detalleBody`, etc.).

## 6) Check de funcionamiento (log)
- Listado inicial de facturas al entrar al módulo: **funciona**.
- Estado de factura pendiente/revisada en tarjeta: **funciona**.
- Entrada al submódulo detalle al seleccionar factura: **funciona**.
- Carga automática de inventarios al abrir detalle: **funciona**.
- Filtro BANCOLOMBIA/IMPUESTO: **funciona**.
- Render de columnas producto/cantidad/select/cantidad/unidad: **funciona**.
- Botón `Enviar` dentro del detalle: **funciona**.
- Envío a `Subir_Compras`: **funciona** si webhook responde 2xx.
- Marcado automático backend de factura como revisada después del envío: **no implementado en frontend** (depende de backend/webhook).

## 7) Regla de parches posteriores
Si se realiza otro ajuste incremental de este mismo cambio, renombrar a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_2_parches.md`
Con la misma estructura (objetivo, archivos, reversión detallada, exportación, checks).

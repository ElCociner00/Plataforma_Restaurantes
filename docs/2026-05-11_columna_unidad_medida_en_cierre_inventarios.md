# Objetivo
Agregar una columna visible de **Unidad de medida** en el módulo de **cierre inventarios**, ubicada entre **Stock** y **Stock actual**, usando el campo `unidad` que ya llega en la consulta del sistema. Esta columna es solo informativa (no editable).

## Archivos implicados y modificaciones

### 1) `cierre_inventarios/index.html`
- **Tipo de cambio:** ajuste de estructura de tabla (encabezados).
- **Qué se modificó:** se agregó el encabezado `Unidad de medida` entre `Stock` y `Stock actual`.
- **Objetivo explícito:** reflejar en UI la unidad asociada a la cantidad mostrada en stock.

### 2) `js/cierre_inventarios.js`
- **Tipo de cambio:** ajuste de render y normalización de datos en frontend.
- **Qué se modificó:**
  - Se agregó `normalizeUnidadMedida(unidad)` para mostrar la unidad en mayúsculas, sin tildes y sin caracteres especiales.
  - En `renderProductRows`, se agregó una celda/input de solo lectura para unidad.
  - En la consulta de stock (`btnConsultar`), se actualiza también la unidad cuando venga en la respuesta.
  - En la constancia visual (canvas/resumen), se agregó la columna `Unidad` para mantener consistencia con la tabla.
- **Objetivo explícito:** mostrar unidad de medida legible y estandarizada, sin alterar el flujo de cierre.

## Reversión de emergencia (rollback)

### Archivo: `cierre_inventarios/index.html`
1. Localizar la fila `<thead><tr>...` de la tabla de detalle de productos.
2. Eliminar `<th>Unidad de medida</th>`.
3. Dejar el orden original: `Producto | Stock | Stock actual | Restante`.

### Archivo: `js/cierre_inventarios.js`
1. Eliminar la función `normalizeUnidadMedida`.
2. En `renderProductRows`, eliminar bloque de creación de `unidadCell`/`unidadInput`.
3. En el objeto `productRows.set(...)`, quitar `unidadInput`.
4. En el bloque de consulta de stock, eliminar la línea que actualiza `row.unidadInput`.
5. En la sección de constancia visual:
   - Restaurar encabezados sin `Unidad`.
   - Restaurar ancho de columnas previo.
   - Eliminar `row.unidadInput` de las filas renderizadas.

## Guía para exportar este cambio a otro repositorio
1. Copiar exactamente los cambios de:
   - `cierre_inventarios/index.html`
   - `js/cierre_inventarios.js`
2. Verificar que el módulo de cierre inventarios construya filas desde datos de productos y que reciba `unidad` en el payload de consulta.
3. Verificar dependencias del repositorio destino:
   - El endpoint de consulta de stock debe incluir `unidad` por producto.
   - Si hay un archivo centralizador de URLs/webhooks, confirmar que la URL usada por cierre inventarios siga apuntando al origen correcto (este repositorio centraliza URLs en `js/webhooks.js`).
4. Validar en UI:
   - La nueva columna aparece entre stock y stock actual.
   - La unidad se visualiza en mayúsculas y limpia (sin caracteres especiales).
   - No se puede editar manualmente.
5. Validar constancia visual/resumen:
   - Debe aparecer también la columna de unidad para mantener trazabilidad del cierre.

## Checklist funcional (logs)
- ✅ cierre turno: sin cambios, funcional esperado.
- ✅ cierre inventario: ahora muestra **Unidad de medida** entre Stock y Stock actual.
- ✅ consulta stock en cierre inventario: mantiene comportamiento, suma visualización de unidad.
- ✅ subida de cierre inventario: sin cambios de payload obligatorios.
- ✅ login/dashboard/facturación/nómina: sin cambios directos en este ajuste.

## Notas
Este ajuste es ligero y no modifica reglas de negocio ni permisos, solo visualización/normalización de un dato ya existente (`unidad`).

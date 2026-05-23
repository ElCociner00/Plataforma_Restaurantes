# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 3 parches

## 1) Objetivo de la petición
Aplicar ajustes de usabilidad y semántica en el submódulo de detalle de Compras para:
- renombrar encabezados de columnas según operación real,
- mostrar la columna de medida como **Medida Sistema**,
- agregar botón **No corresponde** para marcar facturas revisadas de otra índole,
- ordenar las facturas por fecha desde la más reciente hacia la más antigua.

## 2) Archivos implicados y tipo de modificación
1. `compras/index.html`
- **Tipo:** ajuste de UI/labels.
- **Objetivo:** alinear nombres de columnas y añadir botón adicional de flujo.
- **Qué hace explícitamente:**
  - cambia encabezados a `Productos factura`, `Cantidad factura`, `Productos sistema`, `Cantidad Real`, `Medida Sistema`.
  - agrega botón `No corresponde` junto a `Enviar` dentro del detalle.

2. `js/compras.js`
- **Tipo:** ajuste funcional y de presentación.
- **Objetivo:** soportar nuevo flujo y ordenamiento requerido.
- **Qué hace explícitamente:**
  - ordena facturas por fecha descendente (reciente -> antigua),
  - inicializa y actualiza celda de medida con valor base `unidad` y valor real desde `inventario.unidad`,
  - agrega listener para botón `No corresponde` que envía al mismo webhook de envío con bandera `no_corresponde: true`.

3. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_3_parches.md`
- **Tipo:** documentación incremental del parche.
- **Objetivo:** trazabilidad, reversión y guía de portado.

## 3) Notas de emergencia para revertir este parche
### Reversión puntual
1. En `compras/index.html`:
- Revertir textos de `<th>` a los anteriores.
- Eliminar botón `id="noCorrespondeCompras"`.

2. En `js/compras.js`:
- Eliminar `btnNoCorresponde` y su listener completo.
- En `groupFacturas`, quitar `.sort(...)` para volver al orden original.
- En render de detalle, si se desea rollback visual total, devolver celda a comportamiento previo.

3. Validar tras reversión:
- Abrir detalle y comprobar que solo exista botón `Enviar`.
- Confirmar orden anterior de facturas.

### Reversión total del módulo
Aplicar pasos documentados en parches previos/base.

## 4) Convención de nombre
Se renombra archivo del cambio grande con incremento:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_3_parches.md`

## 5) Exportar a otro repositorio
Particularidad de este repo: centralización de rutas/webhooks en `js/urls.js` y `js/webhooks.js`.
Para portar este parche:
1. replicar ajustes HTML de encabezados y botón `No corresponde`.
2. portar lógica JS del listener `no_corresponde` y ordenamiento por fecha.
3. validar formato de fecha `dd/mm/yyyy` en listado; si backend entrega otro formato, adaptar parser de fecha.
4. comprobar que backend acepte payload con `no_corresponde: true` y `items: []`.

## 6) Check de funcionamiento (logs)
- Carga detalle por factura (Datos_Compras): **funciona**.
- Filtro BANCOLOMBIA/IMPUESTO: **funciona**.
- Encabezados actualizados de tabla: **funciona**.
- Columna `Medida Sistema` con valor base `unidad` y actualización desde inventario: **funciona**.
- Botón `Enviar` match normal: **funciona**.
- Botón `No corresponde` enviando al mismo webhook con bandera dedicada: **funciona**.
- Orden de facturas de más reciente a más antigua: **funciona** (si fecha viene en formato `dd/mm/yyyy`).

## 7) Próximos parches
Siguiente ajuste incremental deberá renombrar a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_4_parches.md`

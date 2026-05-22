# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 4 parches

## 1) Objetivo de la petición
Aplicar refuerzos de operación en el submódulo de Compras para mejorar claridad visual y robustez de datos:
- separación clara entre botones `No corresponde` y `Enviar` con `Enviar` al extremo derecho,
- filtro ampliado de no inventariables (`IVA`, `IMPUESTO`, `BANCOLOMBIA`),
- consolidación de productos repetidos por error de BD (mismo nombre, suma de cantidades),
- estado/mensajes de envío más visibles,
- agregar `usuario_id` y `sale_de_caja` al payload,
- agregar checklist opcional `sale_de_caja` en UI.

## 2) Archivos implicados y tipo de modificación
1. `compras/index.html`
- **Tipo:** ajuste UI estructural.
- **Objetivo:** añadir checklist opcional y mantener acciones agrupadas con mejor UX.
- **Qué hace explícitamente:** añade checkbox `saleDeCajaCompras` encima de acciones del detalle.

2. `css/compras.css`
- **Tipo:** ajuste visual y jerarquía de feedback.
- **Objetivo:** mejorar visibilidad de mensajes y separación notoria de botones.
- **Qué hace explícitamente:**
  - agrega estilos `status-info`, `status-success`, `status-error`,
  - agrega `gap` amplio y orden visual de botones con `Enviar` a la derecha,
  - agrega estilo del bloque checklist `sale_de_caja`.

3. `js/compras.js`
- **Tipo:** refactor funcional incremental.
- **Objetivo:** robustecer normalización y enriquecer payload.
- **Qué hace explícitamente:**
  - amplía exclusión de productos para incluir `IVA`,
  - agrupa productos duplicados por nombre normalizado y suma `Cantidad`,
  - agrega `usuario_id` y `sale_de_caja` en envíos `Enviar` y `No corresponde`,
  - mejora mensajes de estado con severidad (`info/success/error`) para mayor visibilidad.

4. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_4_parches.md`
- **Tipo:** documentación incremental.
- **Objetivo:** trazabilidad del cuarto parche con reversión y guía de portado.

## 3) Notas de emergencia para revertir este parche
### Reversión puntual
1. En `compras/index.html`:
- eliminar bloque checklist con `id="saleDeCajaCompras"`.

2. En `css/compras.css`:
- eliminar clases `status-*`, `.compras-detalle-checklist`, `.sale-caja-check`.
- revertir `gap/order` de `.compras-detalle-actions` si se desea volver a distribución anterior.

3. En `js/compras.js`:
- en `isIgnorableProduct`, remover condición `IVA`.
- en `normalizeDetalleRows`, eliminar consolidación por `Map` y volver a mapeo 1:1 de filas.
- en payload de `Enviar` y `No corresponde`, remover `usuario_id` y `sale_de_caja`.
- en `setStatus`, si se quiere rollback visual, volver a texto plano sin clases por severidad.

### Reversión total del módulo
Aplicar instrucciones de parches previos/base para desmontar Compras por completo.

## 4) Convención de nombre
Se renombra con incremento de parche:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_4_parches.md`

## 5) Exportar a otro repositorio
Particularidades clave:
- rutas centralizadas en `js/urls.js`,
- navegación en `js/header.js`,
- webhooks en `js/webhooks.js`.

Pasos de exportación:
1. portar `compras/index.html` y `css/compras.css` (incluyendo checklist y estilos de estado).
2. portar `js/compras.js` con:
   - normalización/filtro ampliado,
   - consolidación de productos duplicados,
   - payload con `usuario_id` y `sale_de_caja`.
3. validar que el sistema destino entregue `context.user.id` o `context.user.user_id`.
4. validar recepción backend de `sale_de_caja` (boolean) y `usuario_id`.
5. validar formato fecha `dd/mm/yyyy` para orden descendente.

## 6) Check de funcionamiento (logs)
- separación visual entre botones y `Enviar` a la derecha: **funciona**.
- checklist opcional `sale_de_caja`: **funciona**.
- filtro BANCOLOMBIA/IMPUESTO/IVA: **funciona**.
- consolidación de productos duplicados por nombre + suma cantidades: **funciona**.
- envío normal con `usuario_id` y `sale_de_caja`: **funciona**.
- envío `No corresponde` con `usuario_id`, `sale_de_caja` y `no_corresponde: true`: **funciona**.
- mensaje de éxito/error más visible: **funciona**.

## 7) Próximos parches
Si hay un nuevo ajuste incremental, renombrar a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_5_parches.md`

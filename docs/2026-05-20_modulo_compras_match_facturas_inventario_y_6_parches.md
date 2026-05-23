# 2026-05-20 · Módulo Compras con match entre facturas e inventario y 6 parches

## 1) Objetivo de la petición
Extender el payload enviado desde Compras para incluir también el precio de compra del producto inventariable (`precioCompra`) proveniente del webhook `consultar_inventarios`, manteniendo coherencia de factura activa y estructura previa.

## 2) Archivos implicados y tipo de modificación
1. `js/compras.js`
- **Tipo:** ajuste funcional de payload.
- **Objetivo:** incluir campo de costo de inventario en cada ítem enviado.
- **Qué hace explícitamente:** en el armado de `items` añade `precio_compra` tomado de `inv.precioCompra` (normalizado numéricamente).

2. `docs/2026-05-20_modulo_compras_match_facturas_inventario_y_6_parches.md`
- **Tipo:** documentación incremental del cambio grande.
- **Objetivo:** dejar trazabilidad del sexto parche, guía de reversión, portado y checklist.

## 3) Notas de emergencia para revertir este parche
### Reversión puntual
1. En `js/compras.js`, en el bloque donde se construye cada objeto de `items` dentro del botón `Enviar`, eliminar la línea:
```js
precio_compra: Number(inv?.precioCompra ?? 0)
```
2. Validar con un envío de prueba que el webhook vuelva a recibir el payload sin el campo adicional.

### Reversión total
Mantener procedimientos de parches previos para desmontar módulo Compras completo si aplica.

## 4) Convención de nombre
Renombre incremental aplicado:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_6_parches.md`

## 5) Exportar a otro repositorio
Particularidades:
- endpoints centralizados en `js/webhooks.js`.
- payload construido en `js/compras.js` al enviar.

Pasos:
1. portar línea de `precio_compra` en el armado de `items`.
2. confirmar que inventario destino incluya `precioCompra` en la respuesta de `consultar_inventarios`.
3. validar compatibilidad backend con nuevo campo (`precio_compra`) sin romper consumidores anteriores.

## 6) Check de funcionamiento (logs)
- Match normal de compras: **funciona**.
- Payload coherente con factura activa (snapshot+token): **funciona**.
- Inclusión `usuario_id` y `sale_de_caja`: **funciona**.
- Inclusión `precio_compra` por ítem desde inventario: **funciona**.
- Flujo `No corresponde`: **funciona** (sin items, comportamiento intacto).

## 7) Próximos parches
Si se agrega otro ajuste incremental, renombrar a:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_7_parches.md`

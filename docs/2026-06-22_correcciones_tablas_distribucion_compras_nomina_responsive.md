# 2026-06-22 - Correcciones de tablas, distribución de compras, nómina y responsive

## 1. Objetivo
Aplicar correcciones aisladas para mejorar la legibilidad visual, evitar columnas vacías en exportaciones/tablas, reforzar el flujo de distribución previa de facturas de compras y permitir ajustes manuales de cálculo en nómina sin modificar archivos críticos de login, sesión, contexto ni header.

## 2. Archivos implicados y modificaciones

### `js/compras.js`
- Se agregó `normalizeDistribucionStatus` para interpretar el campo nuevo `Distribuida`/`distribuida` de `Verificacion_Compras`.
- El módulo principal ahora muestra únicamente facturas pendientes de revisión con `Distribuida = 1`.
- La pestaña de distribución muestra facturas no revisadas/no rechazadas que todavía no están distribuidas.
- Al entrar a Compras se abre primero la vista de distribución para obligar la gestión previa antes del módulo principal.
- El botón `Actual` dejó de ser solo localStorage: ahora envía una señal real al mismo webhook de distribución.
- Webhook usado para hacerlo funcional en BD: `https://n8n.enkrato.com/webhook/compras/reasignar_local`, centralizado como `WEBHOOK_COMPRAS_REASIGNAR_LOCAL`.
- Payload clave para empresa actual: `accion: "mantener_empresa_actual"`, `tenant_id_destino: context.empresa_id`, `distribuida: 1`.

### `js/webhooks.js`
- Se documentó `WEBHOOKS.COMPRAS_REASIGNAR_LOCAL` dentro del catálogo centralizado de webhooks para dejar explícito el uso del endpoint de distribución de compras.

### `nomina/index.html`
- Se añadió un contenedor aislado `#nominaPayrollOverrides` dentro del comprobante de nómina para que `js/nomina.js` renderice controles web de ajuste de cálculo.

### `js/nomina.js`
- Se añadieron overrides en estado local para ingresos de nómina: cada grupo de horas puede usar otro origen de horas y un multiplicador propio.
- Se añadieron utilidades `filterEmptyColumns`/`hasMeaningfulCell` para eliminar columnas vacías en exportación Excel, protegiendo la columna Fecha para mantener trazabilidad.
- El cálculo web recalcula los valores de ingresos usando los overrides cuando hay tarifas válidas; si no hay tarifa se mantiene el fallback anterior.
- Se agregó render dinámico de controles de ajuste sin crear dependencias desde archivos existentes hacia archivos nuevos.

### `css/local_preselector.css`
- Se corrigió el contraste hover/focus de los botones de locales: al oscurecerse el fondo, `strong` y `span` pasan temporalmente a blanco.

### `css/compras.css`
- Se corrigió el contraste hover/focus de `Enviar a local` y `Actual`, incluyendo el botón verde de empresa actual.
- Se mejoró el aprovechamiento de ancho en escritorio y se añadió stack móvil para la tabla de detalle de compras, evitando scroll horizontal.
- Se reforzó el corte controlado de palabras/números con `overflow-wrap` e `hyphens` para evitar superposiciones.

### `css/nomina.css`
- Se añadió estilo para el panel de ajustes manuales de nómina.
- Se mejoró responsive del comprobante y tablas de nómina para móvil, reduciendo columnas forzadas y evitando desbordes.

### `css/mobile_native.css`
- Se reforzó la regla móvil global para tablas y contenedores (`tabla-wrap`, `table-wrap`, `factura-table-wrap`, `comprobante-col`) con `overflow-x: hidden` y `table-layout: fixed`.

## 3. Notas de emergencia para revertir

1. **Compras / Distribuida**
   - En `js/compras.js`, eliminar `normalizeDistribucionStatus` y quitar la propiedad `distribucionEstado` dentro de `groupFacturas`.
   - Restaurar el filtro de `renderFacturas` a la lógica previa: pestaña locales sin validar `distribucionEstado` y principal con `f.revisionEstado === 0`.
   - Revertir `marcarFacturaActual` para que solo ejecute `markFacturaActual(factura.key)` y `renderFacturas("locales")` sin llamada a webhook.
   - Si se revierte BD, retirar del workflow n8n la escritura de `Distribuida = 1` para `accion = "mantener_empresa_actual"`.

2. **Catálogo de webhook**
   - En `js/webhooks.js`, borrar el bloque `WEBHOOKS.COMPRAS_REASIGNAR_LOCAL` agregado al final. No borrar la constante `WEBHOOK_COMPRAS_REASIGNAR_LOCAL` porque ya existía y la usa compras.

3. **Nómina / Overrides**
   - En `nomina/index.html`, borrar el div `id="nominaPayrollOverrides"`.
   - En `js/nomina.js`, borrar `payrollOverrides` del objeto `state`, las constantes `PAYROLL_HOUR_FIELDS`, `getPayrollOverride`, `applyPayrollHourOverride`, `renderPayrollOverrideControls` y el listener de `#nominaPayrollOverrides`.
   - En `buildPayrollRowsFromEditableDetail`, cambiar las multiplicaciones para que vuelvan a usar `horas.diurnas`, `horas.nocturnas`, `horas.dominicales_diurnas` y `horas.dominicales_nocturnas` directamente.
   - Para Excel, si se requiere el estado anterior, reemplazar el bloque `detalleFiltered` por la construcción previa de `detalleHeaders` y `detalleRows` con todas las columnas.

4. **Estilos responsive/contraste**
   - En `css/local_preselector.css`, borrar el bloque final de `.local-option:hover strong/span` y retirar `background/color` del hover si se desea el comportamiento anterior.
   - En `css/compras.css`, borrar los bloques añadidos al final desde `.btn-factura-local-confirmar:hover`.
   - En `css/nomina.css`, borrar los bloques añadidos desde `.nomina-payroll-overrides`.
   - En `css/mobile_native.css`, borrar el bloque final añadido desde `body.mobile-native .tabla-wrap`.

## 4. Exportar a otro repositorio

1. Copiar los cambios de estos archivos en el mismo orden: `js/webhooks.js`, `js/compras.js`, `nomina/index.html`, `js/nomina.js`, `css/local_preselector.css`, `css/compras.css`, `css/nomina.css`, `css/mobile_native.css`.
2. Validar que el repositorio destino tenga un archivo central de URLs similar a `js/webhooks.js`; si no existe, crear/centralizar `WEBHOOK_COMPRAS_REASIGNAR_LOCAL = "https://n8n.enkrato.com/webhook/compras/reasignar_local"` y actualizar imports de compras.
3. Confirmar que el webhook `compras/reasignar_local` acepte ambas acciones:
   - `reasignar_local`: mueve o marca destino local.
   - `mantener_empresa_actual`: marca la factura de la empresa actual con `Distribuida = 1` sin mover tenant.
4. Confirmar que la respuesta de `Verificacion_Compras` incluya el campo `Distribuida` o `distribuida` y que el valor `1` signifique lista para el módulo principal.
5. En nómina, verificar que el HTML destino tenga un comprobante o panel donde colocar `#nominaPayrollOverrides`; si ya existe un sistema de overrides, integrar la función en ese panel en vez de duplicarla.
6. Revisar CSS destino: si ya hay reglas mobile globales, fusionar con cuidado para no duplicar `overflow-x` ni romper tablas que intencionalmente deban tener scroll técnico.

## 5. Check funcional para logs

- Selector inicial de locales: funciona; el hover/focus mantiene contraste con texto blanco.
- Compras distribución: funciona a nivel frontend; al entrar a Compras se muestra primero esta vista y las facturas sin `Distribuida = 1` quedan fuera del módulo principal.
- Compras empresa actual: funciona a nivel frontend enviando al webhook `https://n8n.enkrato.com/webhook/compras/reasignar_local` con `accion: "mantener_empresa_actual"`; requiere que n8n escriba `Distribuida = 1` en BD.
- Compras local destino: funciona manteniendo el webhook existente de reasignación.
- Nómina web: funciona con ajustes manuales de origen de horas y multiplicador local.
- Excel nómina: funciona con filtrado de columnas vacías en detalle, conservando Fecha.
- Responsive móvil: mejora aplicada en compras, nómina y reglas mobile globales; no se tocó login/sesión/contexto/header.
- Login, sesión, contexto y header: no modificados.

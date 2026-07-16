# 2026-07-16 — Ajustes de Nómina, detalle editable e Histórico Nómina

## 1. Objetivo de la petición
Aplicar una actualización aislada al módulo de Nómina para mejorar su experiencia visual y corregir cálculos operativos sin tocar archivos prohibidos de sesión, login, contexto ni header. La actualización elimina la ayuda/corte inicial de fechas, centra acciones, corrige auxiliares, reorganiza tablas, sustituye las columnas válidas por inicio/fin en 24H, integra apoyos como turnos normales, consolida propinas, marca duplicados para transporte y prepara el guardado por bloques para el submódulo Histórico Nómina.

## 2. Archivos implicados

### `nomina/index.html` — modificación estructural aislada
- Se eliminó el selector visual de `Corte` del bloque inicial para retirar la ayuda/guía de fechas imprecisa.
- Se actualizó la tabla `Detalles` para reemplazar las cuatro columnas de horas válidas por dos columnas: `Inicio válido` y `Fin válido`, con nota visual de formato 24H.
- Se añadió columna `Propinas` en Detalles para ver propinas que llegan desde los turnos.
- Se eliminó visualmente la sección `Parámetros cálculo`.
- Se movió la sección `Apoyos` inmediatamente debajo de `Detalles`.
- Se reubicaron `Parámetros` y `Parámetros tiempo` al final del comprobante, debajo de `Apoyos` y `Detalles cálculos`.

### `css/nomina.css` — modificación visual aislada
- Se centraron los botones principales de Nómina en escritorio y se apilaron en móvil.
- Se agregaron estilos para nota `24H`, filas duplicadas en rojo, filas duplicadas validadas en verde y filas de apoyo dentro del detalle.
- Se mantuvo el desplazamiento horizontal móvil para no romper tablas existentes.

### `js/nomina.js` — modificación funcional aislada del módulo
- Se cambió el cálculo de horas para usar `hora_inicio_valida` y `hora_fin_valida` cuando el admin las edite.
- Se reemplazó la edición de cuatro campos espejo de horas por edición de inicio/fin válido en formato 24H.
- Se corrigió el bug de auxiliares: ahora los campos auxiliares actualizan el estado en `change` y no re-renderizan por cada tecla.
- Se consolidó `Propinas` como concepto general, sumando propinas de turnos normales y apoyos.
- Se eliminó el concepto `Horas de apoyo` del resumen de ingresos; los apoyos se integran al detalle como turnos trabajados.
- Se marcaron filas duplicadas: por defecto no cuentan para auxilio de transporte (`incluidoTransporte = false`) y se ven rojas; si el admin las valida se ven verdes.
- Se separó la inclusión general del turno (`incluido`) de la inclusión para transporte (`incluidoTransporte`) para que duplicados no alteren indebidamente el subsidio diario.
- Se añadió envío por bloques al webhook `WEBHOOK_NOMINA_HISTORICO_GUARDAR` al descargar comprobante.

### `js/webhooks.js` — modificación de integración centralizada
- Se añadió la URL centralizada `WEBHOOK_NOMINA_HISTORICO_GUARDAR`.
- Se registró el webhook en el objeto `WEBHOOKS` indicando consumidor, método y propósito.

### `nomina/historico.html` — archivo creado
- Se creó un submódulo aislado `Histórico Nómina` preparado para renderizar nóminas guardadas.
- No se conectó al header porque la petición prohíbe tocar archivos vitales como header, sesión, login o contexto; la página queda disponible por ruta directa `nomina/historico.html` hasta que se autorice tocar navegación.

## 3. Notas de emergencia para revertir

### Revertir `nomina/index.html`
1. Restaurar el `<label>Corte ... id="nominaCorte" ...</label>` dentro de `.nomina-grid` si se necesita nuevamente selector visible.
2. En la tabla `Detalles`, reemplazar el encabezado actual con la versión anterior que incluía `Diurnas vál.`, `Nocturnas vál.`, `Dom. diurnas vál.` y `Dom. nocturnas vál.`.
3. Volver a insertar el bloque `Parámetros cálculo` que contenía `id="nominaParametrosCalculoBody"` si se requiere la relación manual de parámetros.
4. Mover el bloque `Apoyos` nuevamente al final, justo antes de `footer.comprobante-neto`, si se necesita el orden anterior.

### Revertir `css/nomina.css`
1. En `.nomina-actions`, retirar `justify-content: center`, `align-items: center` y `text-align: center` para volver a alineación izquierda.
2. Borrar las reglas finales: `.nomina-format-note`, `.nomina-row-duplicada`, `.nomina-row-validada`, `.nomina-row-apoyo small` y el ajuste móvil de `.nomina-actions`.
3. Retirar `.nomina-detalle-hora-valida` del selector de inputs si se vuelve a las cuatro columnas espejo.

### Revertir `js/nomina.js`
1. En `calculateDetalleTimes`, volver a usar `row.hora_inicio` y `row.hora_fin` directamente.
2. Restaurar la función anterior `getDetalleEditableValue` y su uso en `renderParametrosYDetalle` para volver a cuatro columnas espejo.
3. Eliminar `getValidShiftTime`, `buildDuplicateKey` y `markDuplicateDetailRows` si no se quiere marcado de duplicados.
4. En `calculateMoneyByDetail`, volver a calcular `diasTrabajados` con fechas únicas de `rowsIncluidas` si no se quiere validación manual de transporte.
5. En `buildPayrollRowsFromEditableDetail`, volver a crear los conceptos `Horas de apoyo` y `Propinas de apoyo` si se requiere diferenciarlos.
6. En el listener de Detalles, volver a modificar `row.incluido` desde `.nomina-detalle-validar` si el checkbox debe invalidar todo el turno y no solo transporte.
7. Volver de `auxiliaresPanel.addEventListener("change")` a `input` solo si se acepta de nuevo el re-render por tecla.
8. Eliminar `guardarHistoricoNomina` y devolver el listener de descarga a `descargarBtn?.addEventListener("click", descargarComprobante);` si no se usará histórico.

### Revertir `js/webhooks.js`
1. Borrar `WEBHOOK_NOMINA_HISTORICO_GUARDAR`.
2. Borrar el bloque `WEBHOOKS.NOMINA_HISTORICO_GUARDAR`.

### Revertir `nomina/historico.html`
- Borrar el archivo completo si no se desea mantener el submódulo aislado.

## 4. Exportar este cambio masivo a otro repositorio
1. Aplicar como bloque único los archivos `nomina/index.html`, `css/nomina.css`, `js/nomina.js`, `js/webhooks.js` y `nomina/historico.html`.
2. Confirmar que el repositorio destino centralice URLs en un archivo equivalente a `js/webhooks.js`; allí debe declararse `WEBHOOK_NOMINA_HISTORICO_GUARDAR` y registrarse en el catálogo de webhooks.
3. Verificar que `js/nomina.js` importe la URL desde ese archivo centralizado, no desde constantes locales duplicadas.
4. Validar que la respuesta del backend de nómina mantenga arreglos `parametros`, `detalle`, `apoyos`, `totales` y que las filas de detalle puedan traer `propina` o `propinas`.
5. Si otro repositorio ya tiene lógica para duplicados, priorizar una sola fuente: esta implementación usa `buildDuplicateKey()` y `markDuplicateDetailRows()` en `js/nomina.js`.
6. El guardado histórico envía bloques separados: `resumen`, `detalle`, `apoyos`, `parametros`, `parametros_tiempo`. El backend debe aceptar varias solicitudes por una misma nómina/periodo.
7. Si se autoriza navegación en el repo destino, conectar `nomina/historico.html` desde el acordeón o menú de Nómina del header. En este repositorio no se tocó `js/header.js` por la restricción explícita de no modificar header.

## 5. Check funcional para logs
- Nómina — consulta base: funciona con la estructura existente y mantiene fallback Supabase.
- Nómina — botones principales: funciona visualmente centrado en PC y móvil.
- Nómina — auxiliares: funciona sin perder foco por cada tecla; recalcula al confirmar/cambiar campo.
- Nómina — Detalles con inicio/fin válido: funciona para recalcular horas por DOM usando formato 24H.
- Nómina — Duplicados transporte: funciona visualmente en rojo por defecto y verde al validar para transporte.
- Nómina — Apoyos como turnos: funciona al integrarlos al detalle y al conteo de transporte si están incluidos.
- Nómina — Propinas: funciona como concepto único `Propinas` sumando turnos normales y apoyos.
- Nómina — Histórico guardado: frontend preparado y envía bloques; depende de que el webhook `nomina_historico_guardar` exista y responda correctamente.
- Histórico Nómina — render completo: pendiente de endpoint de lectura histórica del backend.
- Login/sesión/contexto/header: no modificados por seguridad de plataforma.

## 6. Parche posterior #1 (2026-07-16) — Correcciones de orden, corte, apoyos e histórico visible

### Objetivo del parche
Corregir observaciones posteriores a la actualización inicial de Nómina: restaurar el selector `Corte`, asegurar orden descendente por `Fecha`, eliminar filas fantasma de apoyo en la tabla Detalles, hacer evidente el recálculo de inicio/fin válido, exponer un acceso visible al borrador de Histórico Nómina sin tocar header, declarar explícitamente el webhook histórico y añadir selección múltiple de sedes/locales para consultas de nómina.

### Archivos modificados en este parche

#### `nomina/index.html`
- Se restauró el selector `Corte` en el bloque inicial con las opciones semanal, quincenal, mensual, trimestral, semestral y anual.
- Se agregó `nominaLocalesPanel` para renderizar checks de sedes/locales disponibles.
- Se agregó un enlace visible `Abrir Histórico Nómina` dentro del módulo Nómina. No se modificó `js/header.js` por la regla explícita de no tocar header.

#### `js/nomina.js`
- Se importa `listAvailableLocalContexts()` desde `session.js` para reutilizar una función existente de lectura de locales sin modificar sesión ni contexto.
- Se agregan `renderLocalesNomina()` y `getSelectedLocalesNomina()` para enviar al webhook `sedes`, `tenant_ids` y `sedes_nombres`.
- Se crea `buildApoyoDetailRows()` para que los apoyos sí cuenten en cálculos y transporte, pero sin renderizarse como filas fantasma en la tabla Detalles.
- `calculateMoneyByDetail()` calcula con turnos normales + apoyos ocultos, ordenados por fecha descendente.
- La tabla Detalles renderiza con `sortByDateDesc(state.detalleCalculo, "fecha")` y usa `data-detail-id` para que editar una fila ordenada actualice la fila correcta en estado.
- Se agrega listener `input` con debounce para `nomina-detalle-hora-valida`, haciendo que los cambios de inicio/fin válido recalculen visualmente sin esperar únicamente al evento `change`.

#### `css/nomina.css`
- Se agregaron estilos para el panel de sedes/locales y para el enlace al submódulo Histórico Nómina.

#### `nomina/historico.html`
- Se amplió el borrador del submódulo con filtros simples por empleado, periodo desde/hasta y sede.
- Se añadió una tabla base para selección futura de nóminas guardadas.
- Se dejó visible el webhook que nutre el histórico: `https://n8n.enkrato.com/webhook/nomina_historico_guardar`.

### Webhook histórico explícito
La información para nutrir Histórico Nómina se envía al webhook:

```text
https://n8n.enkrato.com/webhook/nomina_historico_guardar
```

Este endpoint está centralizado como `WEBHOOK_NOMINA_HISTORICO_GUARDAR` en `js/webhooks.js` y se consume desde `guardarHistoricoNomina()` en `js/nomina.js`. El envío ocurre al presionar `Descargar comprobante` y se manda por bloques: `resumen`, `detalle`, `apoyos`, `parametros` y `parametros_tiempo`.

### Reversión de emergencia del parche #1
1. En `nomina/index.html`, si se quiere retirar sedes, borrar el `<div class="nomina-locales-panel" id="nominaLocalesPanel" ...></div>` y el enlace `Abrir Histórico Nómina`.
2. En `nomina/index.html`, si se desea volver a ocultar `Corte`, borrar el `<label>Corte ... id="nominaCorte" ...</label>`.
3. En `js/nomina.js`, para retirar sedes, eliminar el import `listAvailableLocalContexts`, `localesPanel`, `state.localesNomina`, `renderLocalesNomina()`, `getSelectedLocalesNomina()`, el listener de `localesPanel` y las propiedades `sedes`, `tenant_ids`, `sedes_nombres` del payload.
4. En `js/nomina.js`, para volver a mostrar apoyos como filas de Detalles, retirar `buildApoyoDetailRows()` y volver a fusionar apoyos dentro de `state.detalleCalculo`; no recomendado porque provocaba filas fantasma.
5. En `js/nomina.js`, para retirar el recálculo en escritura, borrar el listener `input` con debounce de `.nomina-detalle-hora-valida`.
6. En `css/nomina.css`, borrar las reglas `.nomina-locales-panel`, `.nomina-locales-list`, `.nomina-local-option` y `.nomina-submodule-link`.
7. En `nomina/historico.html`, retirar los filtros y tabla si se desea volver al placeholder mínimo.

### Exportación del parche #1 a otro repositorio
- Migrar junto con el cambio principal: `nomina/index.html`, `js/nomina.js`, `css/nomina.css`, `js/webhooks.js`, `nomina/historico.html` y este documento.
- Verificar que el repo destino tenga una función equivalente a `listAvailableLocalContexts()` o adaptar `renderLocalesNomina()` para leer sedes desde su fuente de contexto/locales.
- Mantener la centralización de URLs: declarar `WEBHOOK_NOMINA_HISTORICO_GUARDAR` en el archivo central de webhooks del repo destino y usar esa constante en el módulo Nómina.
- Confirmar con backend que el payload de consulta acepte `sedes`, `tenant_ids` y `sedes_nombres`; si aún no se usan, deben ignorarse sin romper el flujo.
- Confirmar que el backend histórico acepte envíos repetidos por bloque para una misma nómina.

### Check funcional actualizado para logs
- Nómina — selector Corte: restaurado y funcional para recalcular fechas.
- Nómina — orden de Detalles: ordenado por `Fecha` descendente.
- Nómina — filas fantasma de Apoyo: corregido; apoyos cuentan en cálculo sin renderizarse como filas azules en Detalles.
- Nómina — Inicio/Fin válido 24H: recalcula con debounce durante edición y también en `change`.
- Nómina — selector de sedes: funciona visualmente y envía nombres + tenant IDs al webhook.
- Histórico Nómina — borrador visible: accesible desde enlace interno en Nómina y con filtros base; no se conectó al header por regla de no modificar header.
- Histórico Nómina — lectura de datos: pendiente de endpoint de consulta histórica.
- Login/sesión/contexto/header: no modificados.

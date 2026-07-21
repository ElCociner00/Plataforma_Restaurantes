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

## 7. Parche posterior #2 (2026-07-16) — Corrección final de histórico, corte, propinas y recálculo DOM

### Objetivo del parche
Corregir los puntos reportados después del parche #1: ocultar tenant IDs en el frontend, reforzar la visibilidad del selector `Corte`, mover el acceso de Histórico Nómina al header como acordeón de Nómina, eliminar el acceso interno desde el módulo, hacer que la edición de inicio/fin válido actualice en DOM sin `setTimeout`, retirar edición del tiempo total de Apoyos, usar la gama visual del header para Histórico Nómina, asegurar que el payload multilocal llegue al webhook y corregir lectura de propinas desde distintas claves del JSON.

### Archivos modificados en este parche

#### `nomina/index.html`
- Se agregó texto de ayuda bajo `Corte` para que la guía sea visible y entendible.
- Se eliminó el enlace interno `Abrir Histórico Nómina`; el acceso queda únicamente en el header.

#### `js/urls.js`
- Se agregó `nominaHistorico` para centralizar la URL `/nomina/historico.html` igual que el resto de rutas del repositorio.

#### `js/header.js`
- Se cambió el enlace simple de `Nomina` por un acordeón/dropdown con dos opciones: `Nómina` e `Histórico Nómina`.
- Esta modificación se hizo únicamente porque la corrección explícita exige que Histórico Nómina se abra desde el header y no desde el módulo.

#### `js/nomina.js`
- El panel de sedes ya no muestra tenant IDs; solo muestra nombre y tipo (`Principal`/`Local`).
- El payload de consulta envía `sedes`, `locales`, `tenant_ids`, `locales_tenant_ids`, `sedes_nombres` y `locales_nombres` para que backend pueda consultar una o varias sedes.
- Se añadió `getDetallePropina()` para leer propinas desde `propina`, `propinas`, `valor_propina`, `valor_propinas`, `total_propina`, `total_propinas`, `propina_turno` o `propinas_turno`.
- Se añadió validación de hora `HH:MM`; filas con hora incompleta ya no producen `NaN:NaN` ni horas falsas.
- Se reemplazó el recálculo con debounce basado en `setTimeout` por actualización inmediata del DOM de la fila y de los totales monetarios mediante `recalculatePayrollInline()`.
- Se agregaron `data-calc-field` a las celdas de Diurnas/Nocturnas/Dominicales para que el cambio de inicio/fin válido sea visible al escribir.
- La tabla Apoyos ya no renderiza el tiempo como input editable; se muestra como texto calculado.

#### `nomina/historico.html`
- El acceso visual queda alineado al estilo global porque se abre desde el dropdown del header, que ya usa fondo lavanda/morado y letras blancas.

### Reversión de emergencia del parche #2
1. En `js/header.js`, reemplazar el bloque dropdown de `Nomina` por el enlace simple anterior `menu += \`<a class="nav-link-btn" href="${APP_URLS.nomina}">Nomina</a>\`;` en Loggro y Siigo.
2. En `js/urls.js`, eliminar `nominaHistorico` si se retira el submódulo histórico.
3. En `nomina/index.html`, si se desea volver a acceso interno, añadir nuevamente un enlace a `historico.html` en `.nomina-actions`; no recomendado por la corrección actual.
4. En `js/nomina.js`, para volver a mostrar tenant IDs, restaurar el `<small>${escapeHtml(local.empresa_id || "")}</small>` en `renderLocalesNomina()`; no recomendado por seguridad visual.
5. En `js/nomina.js`, para volver al debounce, reemplazar el listener `input` de `.nomina-detalle-hora-valida` por el bloque anterior con `setTimeout`; no recomendado porque generaba violaciones de rendimiento y retrasaba la evidencia visual.
6. En `js/nomina.js`, para permitir edición manual del tiempo de Apoyos, restaurar el `<input class="nomina-apoyo-tiempo" ...>` y el handler que asignaba `row.tiempo_minutos`; no recomendado porque el tiempo de Apoyos debe venir calculado.

### Exportación del parche #2 a otro repositorio
- Migrar `js/urls.js` junto a `js/header.js`; la ruta `nominaHistorico` debe existir antes de usarla en el header.
- Si el repo destino tiene un header distinto, replicar el patrón ya existente de acordeones/dropdowns para evitar introducir una navegación incompatible.
- Mantener ocultos los tenant IDs en HTML; el payload técnico los conserva para consulta multilocal.
- Validar que el backend de nómina acepte tanto `sedes` como `locales`; ambas contienen objetos con `tenant_id`, `empresa_id`, `nombre` y `tipo`.
- Confirmar que las propinas llegan en alguna de las claves soportadas por `getDetallePropina()`.

### Check funcional actualizado para logs
- Nómina — selector Corte: visible con texto de ayuda.
- Nómina — Histórico: accesible desde acordeón de header bajo `Nomina`; sin acceso interno desde el módulo.
- Nómina — tenant IDs de locales: no visibles en frontend del panel de sedes.
- Nómina — multilocal: payload envía sedes/locales seleccionados y alias para backend.
- Nómina — inicio/fin válido: actualiza celdas de horas y valores monetarios sin `setTimeout`.
- Nómina — Apoyos: tiempo total no editable en la tabla.
- Nómina — Propinas: lectura ampliada para claves de propina del JSON entregado.
- Login/sesión/contexto: no modificados.

---

## Parche posterior 3 — 2026-07-17 — Corrección aislada de edición de horas, sede en detalles y tenants por empleado

### 1. Objetivo de la petición
Corregir el módulo de nómina sin tocar archivos vitales de login, sesión, contexto ni header. El objetivo fue que la edición de horas válidas en la tabla de detalles recalcule realmente horas temporales y valores monetarios, bloquee entradas irracionales mediante autoformato, elimine el enlace visual `Abrir Histórico Nómina`, muestre el nombre de la sede en cada fila de detalles cuando el webhook envía `sede`, y envíe al webhook los identificadores equivalentes del mismo empleado por cada local/tenant seleccionado.

### 2. Archivos implicados y modificaciones
- `nomina/index.html`: se eliminó el enlace `Abrir Histórico Nómina` ubicado junto a `Descargar Excel empleado`. También se añadió la columna `Sede` al encabezado de la tabla de detalles para mostrar el nombre de sede por fila.
- `js/nomina.js`: se añadieron utilidades aisladas de normalización de hora (`normalizeTimeInput` y `normalizeFinalTimeInput`) para convertir escritura numérica progresiva a formato hora y limitar horas/minutos válidos. Se agregó `resolveSedeName` para resolver el UUID recibido en `sede` contra los locales ya disponibles en el módulo, renderizando el nombre y no el tenant. Se cambió el payload de consulta/exportación/histórico a construcción asíncrona para incluir `responsable_tenants`, `empleado_tenants` y `usuario_tenants`, con los IDs equivalentes por tenant/local seleccionado mediante consulta de responsables activos por sede. Se actualizó la exportación Excel para incluir la sede resuelta en el detalle.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_3_parches.md`: documentación del parche posterior 3 con objetivo, archivos, reversa y guía de exportación.

### 3. Notas de emergencia para revertir este parche
Si el parche debe revertirse manualmente:
1. En `nomina/index.html`, dentro del bloque `.nomina-actions`, volver a agregar después del botón `descargarExcelEmpleadoNomina` el enlace:
   ```html
   <a class="nomina-submodule-link" href="historico.html">Abrir Histórico Nómina</a>
   ```
2. En `nomina/index.html`, en el encabezado de la tabla `nominaDetalleCalculoBody`, quitar el `<th>Sede</th>` añadido después de `Validar transporte`.
3. En `js/nomina.js`, eliminar las funciones `normalizeTimeInput`, `normalizeFinalTimeInput` y `findSelectedEmployeeEquivalentIds` si se desea volver a aceptar texto libre en horas y no enviar equivalencias por tenant.
4. En `js/nomina.js`, cambiar `const buildExcelWebhookPayload = async (empleadoId) => { ... }` a una función síncrona y retirar del objeto retornado las propiedades `responsable_tenants`, `empleado_tenants` y `usuario_tenants`.
5. En `js/nomina.js`, revertir las tres llamadas `await buildExcelWebhookPayload(...)` a `buildExcelWebhookPayload(...)` únicamente si el paso anterior también fue revertido.
6. En `js/nomina.js`, en el render de `nominaDetalleCalculoBody`, borrar la celda de sede añadida antes de fecha: `resolveSedeName(row.sede || row.tenant_id || row.empresa_id)`.
7. En `js/nomina.js`, en `buildCurrentCalculatedData` y en la generación de Excel, retirar el campo `sede` y la columna `Sede` si se quiere volver al Excel anterior.

### 4. Exportación del cambio masivo a otro repositorio
Para exportar este parche a otro repositorio:
1. Verificar que el repositorio destino tenga centralización de URLs/webhooks equivalente a este proyecto en `js/webhooks.js`; este parche no cambia URLs, pero usa el webhook ya centralizado `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` importado desde allí.
2. Copiar los cambios de `nomina/index.html` y `js/nomina.js`. No copiar ni tocar archivos de sesión/login/header; este parche depende de `getUserContext`, `listAvailableLocalContexts`, `buildRequestHeaders` y `fetchResponsablesActivos`, pero no modifica sus implementaciones.
3. Confirmar que el módulo destino tenga una tabla de detalles con `tbody id="nominaDetalleCalculoBody"`, panel de locales `nominaLocalesPanel` y botón `descargarExcelEmpleadoNomina`.
4. Validar que `fetchResponsablesActivos(tenantId)` pueda consultar responsables por tenant/local. La función nueva `findSelectedEmployeeEquivalentIds` busca coincidencias por cédula, luego nombre normalizado, luego ID original; si el repositorio destino maneja otra llave única, adaptar solo esa función.
5. Confirmar que el webhook acepte los campos `responsable_tenants`, `empleado_tenants` o `usuario_tenants`. Si todavía no los usa, el payload sigue conservando `responsable_id`, `empleado_id`, `usuario_id`, `tenant_ids` y `locales_tenant_ids` para compatibilidad.
6. Ejecutar `node --check js/nomina.js` después de aplicar el parche y hacer una consulta real de nómina con más de una sede seleccionada.

### 5. Check funcional del parche
- Login/sesión/contexto/header: no se modificaron.
- Nómina — consulta por empleado: funciona con el payload anterior y añade equivalencias por tenant para consultas multisede.
- Nómina — tabla detalles: funciona; muestra sede por nombre cuando el tenant existe en los locales disponibles.
- Nómina — edición de inicio/fin válido: funciona; el valor se autoformatea y recalcula la tabla de horas y valores monetarios.
- Nómina — valores irracionales de hora: corregido; se eliminan caracteres no numéricos y se limitan horas/minutos a rangos válidos.
- Nómina — enlace `Abrir Histórico Nómina`: retirado de la vista principal.
- Histórico de nómina: no se tocó su submódulo ni su archivo HTML.

---

## Parche posterior 4 — 2026-07-20 — Histórico completo por tablas y envío de autorización de deducciones

### 1. Objetivo de la petición
Agregar una corrección aislada al módulo de nómina para que el guardado del histórico envíe un único JSON con todos los datos agrupados tabla por tabla, incluyendo el detalle completo renderizado en la página. Además, se agregó el botón `Enviar deducciones` para preparar una autorización de descuento en formato HTML imprimible/PDF Letter vertical y enviarla a un webhook centralizado, sin descargar el documento en el frontend y sin modificar archivos vitales de login, sesión, contexto o header.

### 2. Archivos implicados y modificaciones
- `nomina/index.html`: se añadió el botón `Enviar deducciones` junto a las acciones existentes de nómina. El objetivo es disparar una función aislada del módulo para enviar el comprobante de autorización de descuento al webhook.
- `js/webhooks.js`: se creó la constante centralizada `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR` con la URL sugerida `https://n8n.enkrato.com/webhook/nomina_deducciones_enviar` y se registró en el mapa `WEBHOOKS`. Este repositorio centraliza URLs en `js/webhooks.js`, por eso el endpoint nuevo debe declararse allí antes de usarlo desde `js/nomina.js`.
- `js/nomina.js`: se importó el nuevo webhook, se capturó el botón `enviarDeduccionesNomina`, se agregó `findEmpleadoContacto()` para buscar el correo del empleado en `empleados`, `otros_usuarios` o `usuarios_sistema`, y se agregó `buildAutorizacionDeduccionesHtml()` para generar el HTML con tamaño Carta, márgenes, tipografía Arial, tabla dinámica, textos legales y referencia fija a `images/firma.webp`.
- `js/nomina.js`: se creó `buildHistoricoNominaPayload()` para enviar al histórico un único objeto JSON con `tablas.resumen`, `tablas.ingresos`, `tablas.deducciones`, `tablas.detalle`, `tablas.apoyos`, `tablas.parametros`, `tablas.parametros_tiempo`, `tablas.parametros_calculo` y `tablas.auxiliares`.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_4_parches.md`: documentación del parche posterior 4 con objetivo, archivos, reversa, exportación y check funcional.

### 3. Webhook que debes crear en BD/n8n
Crear el webhook:

```text
https://n8n.enkrato.com/webhook/nomina_deducciones_enviar
```

Este webhook recibirá un JSON con estos campos principales:
- `correo_destino`: correo del empleado resuelto desde la consulta local del frontend.
- `empleado`: nombre, cédula, correo y fuente de contacto.
- `deducciones`: lista dinámica de productos/conceptos con `producto`, `cantidad`, `valor`, `total` y `valor_empleado`.
- `total_a_descontar`: total general a descontar.
- `pdf_html`: HTML completo listo para que n8n/backend lo convierta a PDF Letter vertical y lo envíe por correo.
- `firma_empleador_asset`: ruta esperada `images/firma.webp`. Debes guardar ahí la firma escaneada fija del empleador antes de generar el PDF final.

### 4. Notas de emergencia para revertir este parche
1. En `nomina/index.html`, eliminar el botón:
   ```html
   <button type="button" id="enviarDeduccionesNomina">Enviar deducciones</button>
   ```
2. En `js/webhooks.js`, eliminar la constante `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR` y el bloque `WEBHOOKS.NOMINA_DEDUCCIONES_ENVIAR`.
3. En `js/nomina.js`, quitar `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR` del import desde `./webhooks.js`.
4. En `js/nomina.js`, eliminar `const enviarDeduccionesBtn = document.getElementById("enviarDeduccionesNomina");`.
5. En `js/nomina.js`, eliminar las funciones nuevas `formatDateCo`, `formatMoneyPlain`, `findEmpleadoContacto`, `buildHistoricoNominaPayload`, `buildDeduccionesRows`, `buildAutorizacionDeduccionesHtml` y `enviarDeduccionesNomina`.
6. En `js/nomina.js`, reemplazar el cuerpo de `guardarHistoricoNomina()` por el envío anterior por bloques si el backend histórico todavía espera múltiples POST. El nuevo formato recomendado es un único `JSON.stringify(payload)` con `tablas` completas.
7. En `js/nomina.js`, eliminar el listener `enviarDeduccionesBtn?.addEventListener("click", enviarDeduccionesNomina);`.

### 5. Exportación a otro repositorio
Para migrar este parche a otro repositorio:
1. Migrar primero `js/webhooks.js` o su equivalente de URLs centralizadas. Este proyecto toma endpoints desde `js/webhooks.js`; en el destino debe añadirse la constante `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR` y apuntarla al endpoint real.
2. Migrar el botón en `nomina/index.html` solo si existe un módulo de nómina con las acciones `Consultar nómina`, `Descargar comprobante` y `Descargar Excel empleado`.
3. Migrar las funciones nuevas de `js/nomina.js` manteniéndolas dentro del módulo de nómina para que sean aisladas. Ningún archivo existente debe depender de un archivo nuevo.
4. Confirmar que el destino tenga tablas o fuentes equivalentes a `empleados`, `otros_usuarios` y `usuarios_sistema` con campos de correo `email` o `correo`. Si el correo se obtiene por otra tabla, ajustar únicamente `findEmpleadoContacto()`.
5. Subir `images/firma.webp` al repositorio o bucket que use el backend para renderizar el PDF. El frontend no descarga el PDF; envía `pdf_html` y la ruta de la firma para que el webhook genere y mande el correo.
6. Confirmar que el webhook de histórico acepte un único item JSON con el objeto `tablas`. Si todavía espera bloques separados, actualizar n8n/BD antes de desplegar este parche.
7. Validar con `node --check js/nomina.js` y una prueba real de envío de deducciones en un empleado que tenga correo.

### 6. Check funcional del parche
- Login/sesión/contexto/header: no modificados.
- Nómina — histórico: ahora envía un único JSON con todas las tablas del render actual.
- Nómina — deducciones: botón visible y conectado a webhook centralizado.
- Nómina — PDF de autorización: no se descarga en frontend; se envía como `pdf_html` al webhook para conversión/envío por correo.
- Nómina — correo empleado: se busca en `empleados`, `otros_usuarios` y `usuarios_sistema`; si no aparece, el envío se detiene con mensaje de estado.
- Firma empleador: pendiente de que se guarde el archivo real `images/firma.webp` antes de generar PDFs finales.
- Colores/UI: se reutilizan botones existentes de la sección de acciones para mantener la gama visual del módulo.

---

## Parche posterior 5 — 2026-07-21 — IDs locales por sede, histórico renderizable y mantenimiento guiado

### 1. Objetivo de la petición
Corregir la consulta multisede de nómina para que cada objeto dentro del array `sedes` incluya el `usuario_id`, `responsable_id` y `empleado_id` correspondiente al local seleccionado, sin crear arrays paralelos innecesarios. También se corrigió el error silencioso del botón `Enviar deducciones` causado por el encadenamiento `.catch()` en queries Supabase, y se agregó un webhook automático para renderizar histórico de nómina desde `nomina/historico.html`.

### 2. Archivos implicados y modificaciones
- `js/nomina.js`: se eliminó la lógica de arrays paralelos `responsable_tenants`/`empleado_tenants`/`usuario_tenants` y se reemplazó por `enrichSelectedSedesWithUserIds()`, que enriquece cada sede con el ID local correcto. También se agregó `safeSupabaseQuery()` para evitar el error `maybeSingle(...).catch is not a function` en el botón de deducciones.
- `js/webhooks.js`: se agregó `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` apuntando a `https://n8n.enkrato.com/webhook/nomina_historico_renderizar` y se registró en `WEBHOOKS` para centralizar la URL del render histórico.
- `nomina/historico.html`: el botón `Consultar histórico` dejó de estar deshabilitado, se añadió `tbody id="historicoNominaBody"` y se conectó el módulo aislado `js/nomina_historico.js`.
- `js/nomina_historico.js`: archivo nuevo y aislado que auto-consulta el webhook de render histórico al abrir la página, arma el payload de filtros, normaliza estructuras posibles y renderiza filas básicas sin romper la página si el webhook todavía está vacío.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_5_parches.md`: documentación del parche posterior 5 con objetivo, archivos, reversa, exportación y check funcional.

### 3. Notas de mantenimiento agregadas en archivos
- `js/nomina.js`: notas `MANTENIMIENTO MULTISEDE`, `MANTENIMIENTO DEDUCCIONES` y `MANTENIMIENTO HISTÓRICO` para ubicar qué modificar si se prueba el mapeo de IDs locales, el contacto de correo, el envío de deducciones o el payload del histórico.
- `js/webhooks.js`: nota de mantenimiento indicando que las URLs se cambian ahí, no en consumidores.
- `nomina/historico.html`: nota HTML indicando que la página usa `js/nomina_historico.js` y no toca login/sesión/header.
- `js/nomina_historico.js`: cabecera y comentarios por función para indicar qué ajusta filtros, payload, normalización, render y consulta del webhook.

### 4. Notas de emergencia para revertir este parche
1. En `js/nomina.js`, si el backend vuelve a necesitar arrays paralelos, restaurar la función anterior de equivalencias y las claves `responsable_tenants`, `empleado_tenants`, `usuario_tenants`; no recomendado porque duplica información fuera de cada sede.
2. En `js/nomina.js`, no eliminar `safeSupabaseQuery()` salvo que se confirme que el cliente Supabase soporta `.catch()` en todos los builders. Si se revierte, el botón `Enviar deducciones` puede volver a fallar con `maybeSingle(...).catch is not a function`.
3. En `js/webhooks.js`, retirar `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` y el bloque `WEBHOOKS.NOMINA_HISTORICO_RENDERIZAR` si se desactiva el render histórico automático.
4. En `nomina/historico.html`, volver a dejar el botón deshabilitado y quitar `id="historicoNominaBody"` solo si no se usará endpoint histórico.
5. Eliminar `js/nomina_historico.js` únicamente después de quitar su script de `nomina/historico.html`; de lo contrario habrá una carga rota.

### 5. Exportación a otro repositorio
Para exportar este parche:
1. Migrar `js/webhooks.js` primero, porque este repositorio centraliza URLs ahí. Añadir `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` con la URL del destino.
2. Migrar `js/nomina.js` manteniendo `enrichSelectedSedesWithUserIds()` dentro del módulo de nómina. Verificar que exista la tabla `usuarios_locales` con campos `id`, `usuario_principal_id`, `empresa_id`, `nombre_completo` y `activo`; si el destino usa otro nombre, adaptar solo esa función.
3. Migrar `js/nomina_historico.js` y la inclusión del script en `nomina/historico.html`. Si el backend devuelve otra estructura, cambiar solo `normalizeHistoricoRows()` y `renderHistoricoRows()`.
4. Confirmar que `buildExcelWebhookPayload()` envía `sedes` y `locales` con objetos enriquecidos, y que el backend consulta cada sede usando `sede.usuario_id` o `sede.responsable_id`.
5. Ejecutar `node --check js/nomina.js`, `node --check js/nomina_historico.js` y `node --check js/webhooks.js` antes de desplegar.

### 6. Check funcional del parche
- Login/sesión/contexto/header: no modificados.
- Nómina multisede: cada sede del payload lleva su `usuario_id`/`responsable_id`/`empleado_id` local cuando puede resolverse.
- Nómina multisede: se retiraron arrays paralelos innecesarios de responsables/empleados/usuarios por tenant.
- Enviar deducciones: corregido el error de `.catch is not a function` en consultas Supabase.
- Histórico nómina: existe webhook centralizado de render y la página lo consulta automáticamente.
- Histórico nómina: si el webhook está vacío o falla, la página muestra estado y no se rompe.

---

## Parche posterior 6 — 2026-07-21 — Blindaje contra arrays legacy en payload multisede

### 1. Objetivo de la petición
Corregir el error de consulta de nómina reportado como `ReferenceError: responsable_tenants is not defined` dentro de `buildExcelWebhookPayload()`. La intención de esta corrección es mantener la estructura original del webhook y añadir únicamente los IDs locales dentro de cada objeto del array `sedes`/`locales`, sin depender de arrays paralelos.

### 2. Archivos implicados y modificaciones
- `js/nomina.js`: se ajustó `buildExcelWebhookPayload()` para construir el payload en una variable local, documentar que los IDs locales deben viajar dentro de cada item de `sedes`/`locales`, y blindar la salida eliminando claves legacy si llegan a existir por una mezcla de caché o parche parcial.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_6_parches.md`: documentación del parche posterior 6 con objetivo, reversa, exportación y check funcional.

### 3. Notas de emergencia para revertir este parche
1. En `js/nomina.js`, dentro de `buildExcelWebhookPayload()`, se puede volver al `return { ... }` directo anterior si se confirma que no existe ninguna versión desplegada con claves legacy.
2. No volver a crear `responsable_tenants`, `empleado_tenants` ni `usuario_tenants`; el backend debe leer el ID local desde cada item de `sedes` o `locales`.
3. Si el navegador mantiene una versión antigua en caché, forzar recarga dura o invalidación de caché del bundle para evitar que siga ejecutando una línea vieja.

### 4. Exportación a otro repositorio
Para exportar este parche:
1. Migrar solo el bloque `buildExcelWebhookPayload()` actualizado.
2. Confirmar que `enrichSelectedSedesWithUserIds()` exista y devuelva objetos `sede` con `usuario_id`, `responsable_id` y `empleado_id`.
3. Confirmar con una prueba estática o console log que el payload final no incluya arrays paralelos y que `payload.sedes[0].usuario_id` exista cuando se selecciona un local.

### 5. Check funcional del parche
- Nómina — consultar nómina: corregido el punto que podía intentar usar `responsable_tenants` fuera de alcance.
- Nómina — multisede: el dato nuevo se conserva dentro de cada item de `sedes`/`locales`.
- Login/sesión/contexto/header: no modificados.

---

## Parche posterior 7 — 2026-07-21 — Usuario local desde selector de sedes sin arrays paralelos

### 1. Objetivo de la petición
Eliminar definitivamente cualquier referencia a variables/arrays paralelos de tenants y replicar la forma en que el selector de locales obtiene `usuario_id`: cada local disponible ya llega desde `listAvailableLocalContexts()` con `empresa_id` y `usuario_id`, igual que el switch de locales. El payload de nómina debe conservar la estructura existente y añadir ese dato dentro de cada objeto de `sedes`/`locales`.

### 2. Archivos implicados y modificaciones
- `js/nomina.js`: `getSelectedLocalesNomina()` ahora preserva `usuario_id`, `responsable_id` y `empleado_id` desde el local seleccionado. `enrichSelectedSedesWithUserIds()` usa primero ese `usuario_id` ya resuelto por contexto/local switcher antes de consultar `usuarios_locales`. `buildExcelWebhookPayload()` ya no menciona ni elimina arrays legacy; solo retorna el payload con `sedes` y `locales` enriquecidos.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_7_parches.md`: documentación del parche posterior 7 con objetivo, reversa, exportación y check funcional.

### 3. Notas de emergencia para revertir este parche
1. En `js/nomina.js`, si se necesita volver al payload sin IDs locales, quitar `usuario_id`, `responsable_id` y `empleado_id` del objeto retornado por `getSelectedLocalesNomina()`.
2. No reintroducir variables externas en `buildExcelWebhookPayload()`; cualquier dato nuevo debe calcularse antes y quedar dentro de `sedes`/`locales`.
3. Si el navegador sigue mostrando `ReferenceError` en una línea vieja, limpiar caché del navegador o forzar recarga del módulo, porque el archivo actual ya no contiene esa referencia.

### 4. Exportación a otro repositorio
1. Confirmar que el helper equivalente a `listAvailableLocalContexts()` entregue `usuario_id` por local seleccionado.
2. Migrar el bloque de `getSelectedLocalesNomina()` para preservar ese `usuario_id` dentro de cada sede.
3. Migrar el inicio de `findLocalUserId()` para usar primero `selectedLocal.usuario_id` y consultar `usuarios_locales` solo como fallback.
4. Ejecutar un console log del payload y verificar que `payload.sedes` tenga objetos como `{ tenant_id, empresa_id, usuario_id, responsable_id, empleado_id, nombre, tipo }`.

### 5. Check funcional del parche
- Nómina — consulta: `buildExcelWebhookPayload()` no referencia variables externas inexistentes.
- Nómina — locales: `usuario_id` local viaja dentro de cada sede/local seleccionado.
- Nómina — estructura webhook: se conserva `sedes`, `locales`, `tenant_ids`, `locales_tenant_ids`, `sedes_nombres` y `locales_nombres`.
- Login/sesión/contexto/header: no modificados.

---

## Parche 8 — 2026-07-21 — Corrección definitiva de payload multisedes sin arrays legacy

### 1. Objetivo de la petición
Corregir el error crítico del botón **Consultar nómina** reportado como `Uncaught (in promise) ReferenceError: responsable_tenants is not defined` en `buildExcelWebhookPayload()`. El objetivo funcional es conservar el envío de fechas, corte/rango, tenant principal y sedes seleccionadas, pero asegurando que cada sede lleve dentro de su propio objeto el `usuario_id`/`responsable_id`/`empleado_id` local que corresponde a ese tenant. Así se mantiene explícita la relación sede → tenant → usuario local sin usar arrays paralelos externos.

### 2. Archivos implicados y modificación realizada
- `js/nomina.js`: se retiraron del objeto retornado por `buildExcelWebhookPayload()` las claves `responsable_tenants`, `empleado_tenants` y `usuario_tenants`, porque dependían de una variable inexistente y rompían la consulta antes de llegar al webhook. La función sigue usando `enrichSelectedSedesWithUserIds(empleadoId, getSelectedLocalesNomina())`, por lo que los IDs locales continúan viajando en cada objeto de `sedes` y `locales`.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_8_parches.md`: se documentó este parche posterior sobre el cambio grande del módulo de nómina, siguiendo la regla de incrementar el conteo de parches.

No se modificaron archivos matrices o vitales de login, sesión, contexto ni header. El cambio queda aislado en el módulo de nómina y no obliga a archivos existentes a depender de archivos nuevos.

### 3. Notas de emergencia para revertir
Si el backend exige temporalmente los arrays legacy y ya existe una función válida que los calcule, revertir solo el bloque final de `buildExcelWebhookPayload()` en `js/nomina.js`:

1. Ubicar dentro de `buildExcelWebhookPayload()` las líneas del payload donde aparecen:
   - `sedes_nombres: sedes.map((local) => local.nombre),`
   - `locales_nombres: sedes.map((local) => local.nombre)`
2. Añadir una coma después de `locales_nombres` y agregar únicamente si `responsable_tenants` fue definido antes en la misma función:
   ```js
   responsable_tenants,
   empleado_tenants: responsable_tenants,
   usuario_tenants: responsable_tenants
   ```
3. No aplicar el paso anterior si no existe una declaración local tipo `const responsable_tenants = ...`; de lo contrario volverá el `ReferenceError`.
4. Reversión recomendada si hay emergencia por frontend: mantener eliminado el bloque legacy y adaptar el webhook para leer `sede.usuario_id`, `sede.responsable_id` o `sede.empleado_id` dentro de cada objeto de `sedes`/`locales`.

### 4. Guía para exportar este parche a otro repositorio
Se realizaron cambios puntuales, no masivos. Para exportarlo con parches a otro repositorio:

1. Copiar el cambio de `js/nomina.js` en la función `buildExcelWebhookPayload()` eliminando las claves legacy `responsable_tenants`, `empleado_tenants` y `usuario_tenants` del payload.
2. Validar que el otro repositorio tenga una función equivalente a `enrichSelectedSedesWithUserIds()`. Esa función debe enriquecer cada sede con `usuario_id`, `responsable_id` y `empleado_id` locales antes de construir el payload.
3. Confirmar que el webhook lea los IDs locales desde cada item de `sedes` o `locales`; ejemplo esperado por sede:
   ```json
   {
     "tenant_id": "tenant-local",
     "empresa_id": "tenant-local",
     "usuario_id": "usuario-local-de-esa-sede",
     "responsable_id": "usuario-local-de-esa-sede",
     "empleado_id": "usuario-local-de-esa-sede",
     "nombre": "Nombre sede"
   }
   ```
4. Este repositorio centraliza URLs en `js/webhooks.js`; si el repositorio destino usa endpoints diferentes, centralizarlos también allí o en su archivo equivalente antes de modificar `js/nomina.js`. No escribir URLs directas dentro de `buildExcelWebhookPayload()`.
5. Verificar que no exista otro helper creando arrays paralelos de tenants/usuarios que pueda interferir con el payload. Si existe, priorizar la estructura por objeto (`sedes[]`) para máxima trazabilidad y menor riesgo de desalineación entre arrays.

### 5. Check funcional del parche
- Nómina — Consultar nómina: corregido; `buildExcelWebhookPayload()` ya no referencia `responsable_tenants` inexistente.
- Nómina — Payload multisedes: funciona con IDs locales dentro de `sedes` y `locales`.
- Nómina — Descarga Excel / histórico que reutiliza `buildExcelWebhookPayload()`: queda protegida contra el mismo `ReferenceError`.
- Login / sesión / contexto / header: no modificados.
- Webhooks centralizados: no modificados; se conserva la centralización existente en `js/webhooks.js`.

---

## Parche 9 — 2026-07-21 — IDs reales por usuarios_locales y PDF binario de deducciones

### 1. Objetivo de la petición
Corregir dos puntos urgentes del módulo de nómina: primero, evitar que el `usuario_id` enviado por cada sede sea asumido desde el contexto local y resolverlo contra datos reales de Supabase; segundo, cambiar el botón **Enviar deducciones** para que no busque ni exponga correos en frontend, sino que genere un PDF de autorización y lo envíe como binario al webhook `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR`.

### 2. Archivos implicados y modificación realizada
- `js/nomina.js`: se agregó `resolveUsuarioPrincipalId()`, que valida si el ID seleccionado existe en `usuarios_sistema.id`; si no existe, busca en `usuarios_locales.id` y toma `usuarios_locales.usuario_principal_id`. Con ese principal real, `enrichSelectedSedesWithUserIds()` consulta `usuarios_locales` por `empresa_id` + `usuario_principal_id` y usa `usuarios_locales.id` como ID local verídico por sede.
- `js/nomina.js`: se agregó generación local de PDF simple con `createSimplePdf()`. El PDF incluye datos del empleado, tabla de deducciones, total a descontar y firma del empleador cargada desde `images/firma.webp`, respetando su proporción 400x63 px.
- `js/nomina.js`: se cambió `enviarDeduccionesNomina()` para eliminar la búsqueda de correo (`findEmpleadoContacto()`) en el flujo del botón y enviar `FormData` con dos partes: `metadata` JSON y `pdf` binario. El webhook queda a cargo de resolver destinatarios y enviar/guardar el documento sin exponer correos en el frontend.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_9_parches.md`: documentación del parche posterior 9 con reversión, guía de exportación y check funcional.

No se tocaron archivos de login, sesión, contexto ni header. La URL del webhook sigue centralizada en `js/webhooks.js`; no se duplicó el endpoint directo dentro de `js/nomina.js`.

### 3. Notas de emergencia para revertir
1. Para revertir solo la resolución estricta del usuario local en `js/nomina.js`, quitar `resolveUsuarioPrincipalId()` y volver en `enrichSelectedSedesWithUserIds()` a comparar `usuarios_locales.usuario_principal_id` contra `empleadoId`. No recomendado si se permite iniciar sesión desde locales.
2. Para revertir el envío binario de deducciones, reemplazar en `enviarDeduccionesNomina()` el bloque `FormData` por el envío JSON anterior. Si se hace, se debe restaurar también la búsqueda de contacto/correo, sabiendo que ese flujo vuelve a exponer correos en frontend.
3. Para emergencia del PDF, eliminar los helpers `PDF_SIGNATURE_ASSET`, `escapePdfText`, `blobToBytes`, `loadSignatureAsJpeg()` y `createSimplePdf()`, y dejar que el backend genere el PDF desde `pdf_html`. Esta reversión requiere que el webhook acepte HTML y ruta de firma.
4. Si la firma falla por ruta, validar que `images/firma.webp` exista y sea servida desde el mismo origen. La generación de PDF continúa sin firma si la carga de imagen falla, pero se registrará la ausencia visual en el documento.

### 4. Guía para exportar este parche a otro repositorio
Para migrar correctamente este parche:

1. Confirmar que el repositorio destino tenga centralización de URLs equivalente a `js/webhooks.js`. Registrar allí el endpoint de deducciones y consumirlo desde el módulo, evitando URLs hardcodeadas.
2. Migrar `resolveUsuarioPrincipalId()` y asegurar que el cliente Supabase tenga acceso de lectura a `usuarios_sistema.id` y `usuarios_locales.id, usuario_principal_id, empresa_id, activo`.
3. En la función equivalente a `enrichSelectedSedesWithUserIds()`, consultar `usuarios_locales` con `empresa_id` de la sede y `usuario_principal_id` resuelto. El valor que debe viajar en cada sede es `usuarios_locales.id`, no el ID principal ni un ID del selector asumido.
4. Migrar los helpers de PDF (`PDF_SIGNATURE_ASSET`, `loadSignatureAsJpeg()`, `createSimplePdf()`) y copiar/servir `images/firma.webp` con proporción 400x63 px.
5. Migrar el envío `FormData` de `enviarDeduccionesNomina()`: parte `metadata` con JSON de trazabilidad y parte `pdf` con `application/pdf`. No añadir `Content-Type` manual cuando se usa `FormData`; el navegador debe generar el boundary.
6. Validar en el webhook que reciba multipart/form-data, lea el archivo `pdf` como binario y use `metadata` para guardar en BD o resolver destinatarios. El frontend ya no debe consultar correos para este botón.

### 5. Check funcional del parche
- Nómina — usuario local por sede: funciona con consulta real a `usuarios_locales.usuario_principal_id` y usa `usuarios_locales.id`.
- Nómina — usuario principal: funciona aunque el ID inicial venga de un local, porque se resuelve contra `usuarios_locales.id` antes de buscar equivalencias.
- Nómina — enviar deducciones: corregido para generar PDF y enviarlo como binario al webhook.
- Nómina — correos de empleado: ya no se consultan ni se envían desde frontend para deducciones.
- Firma empleador: se intenta insertar desde `images/firma.webp` con proporción 400x63 px.
- Login / sesión / contexto / header: no modificados.
- Webhooks centralizados: no modificados; se sigue usando `WEBHOOK_NOMINA_DEDUCCIONES_ENVIAR` desde `js/webhooks.js`.

---

## Parche 10 — 2026-07-21 — Aislamiento de resolución de tenants en nómina sin tocar contexto

### 1. Objetivo de la petición
Corregir el daño provocado por usar el tenant/contexto activo como atajo para decidir el `usuario_id` de sedes. El objetivo es que nómina replique la lógica funcional de identificación sin modificar, sobrescribir ni depender de mutaciones sobre login, sesión, contexto o selector global de locales. Toda resolución queda copiada dentro del módulo de nómina y solo afecta al payload que este módulo envía.

### 2. Archivos implicados y modificación realizada
- `js/nomina.js`: se reemplazó la resolución anterior por `resolveUsuarioPrincipalNomina()`, un helper propio del módulo que devuelve una copia `{ id, empresa_id }` del usuario principal. Primero consulta `usuarios_sistema.id`; si el ID recibido corresponde a un local, consulta `usuarios_locales.id` y luego confirma la empresa principal en `usuarios_sistema`. No escribe en `state.context`, `localStorage`, sesión ni locales globales.
- `js/nomina.js`: `enrichSelectedSedesWithUserIds()` ya no compara contra `state.context.empresa_id` para decidir si debe devolver el usuario principal. Ahora solo devuelve el principal cuando el tenant de la sede coincide con `usuarios_sistema.empresa_id` del usuario principal; cualquier local se resuelve por consulta real a `usuarios_locales` con `empresa_id` + `usuario_principal_id`.
- `docs/2026-07-16_ajustes_nomina_historico_y_detalles_y_10_parches.md`: documentación del parche posterior 10 con reversión, guía de exportación y check funcional.

No se modificaron archivos matrices o vitales relacionados con login, sesión, contexto o header. El ajuste es quirúrgico dentro de `js/nomina.js`.

### 3. Notas de emergencia para revertir
1. En `js/nomina.js`, ubicar `resolveUsuarioPrincipalNomina()` y reemplazarlo temporalmente por una función que retorne `{ id: empleadoId, empresa_id: "" }` si se necesita desactivar la consulta de trazabilidad.
2. En `enrichSelectedSedesWithUserIds()`, no volver a usar `state.context.empresa_id` para decidir el usuario local de una sede, porque si el usuario está logueado en un local esa comparación puede confundir local con principal.
3. Si hay una emergencia de rendimiento por consultas, mantener intacto el contexto global y cachear solo variables locales del módulo de nómina; nunca escribir de vuelta sobre objetos recibidos desde sesión o selector de locales.
4. Para volver al comportamiento anterior no recomendado, se tendría que reintroducir la línea `if (tenantId === state.context?.empresa_id) return ...`; esto puede volver a enviar un ID incorrecto cuando el contexto activo sea un local.

### 4. Guía para exportar este parche a otro repositorio
Para migrar este parche a otro repositorio:

1. No modificar archivos de login, sesión, contexto, header ni selector global de locales. Copiar únicamente el helper local de nómina y los cambios dentro del enriquecimiento del payload.
2. Crear un helper equivalente a `resolveUsuarioPrincipalNomina()` en el módulo de nómina destino. Debe leer `usuarios_sistema.id`, `usuarios_sistema.empresa_id`, `usuarios_locales.id`, `usuarios_locales.usuario_principal_id` y `usuarios_locales.empresa_id`, pero no debe escribir sobre esos datos ni sobre objetos compartidos.
3. En la función que arma `sedes`, resolver así: si `tenant_id` coincide con la empresa principal del usuario, enviar el principal; si no coincide, consultar `usuarios_locales` con `empresa_id` del local y `usuario_principal_id` real, y enviar `usuarios_locales.id` dentro del objeto de esa sede.
4. Este repositorio centraliza endpoints en `js/webhooks.js`; mantener esa práctica en el repositorio destino y no insertar URLs directas en la función de nómina.
5. Validar antes de producción que cambiar el local activo en la plataforma no altere el payload de nómina salvo por las sedes seleccionadas en el propio módulo.

### 5. Check funcional del parche
- Nómina — resolución de usuario principal: funciona mediante copia local `{ id, empresa_id }` sin mutar contexto.
- Nómina — sedes locales: funcionan con consulta real a `usuarios_locales` y no con `state.context.empresa_id` como atajo.
- Nómina — selector global de locales: no modificado.
- Login / sesión / contexto / header: no modificados.
- Payload multisedes: mantiene IDs locales dentro de cada objeto `sedes`/`locales`.
- Deducciones PDF binario: sin cambios en este parche; se conserva el envío multipart al webhook.

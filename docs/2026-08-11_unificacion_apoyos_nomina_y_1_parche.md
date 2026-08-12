# 2026-08-11 — Unificación de apoyos en nómina

## 1. Objetivo
Unificar los apoyos dentro de las tablas principales de Nómina para que se calculen como turnos comunes, diferenciándolos visualmente y por columna explícita. Además, corregir sábados para que no sean dominicales, mejorar el ingreso manual de horas válidas, separar turno válido del auxilio de transporte y mover propinas al extremo derecho.

## 2. Archivos implicados

### `js/nomina.js`
- Cambia `isWeekendPayrollDay()` para considerar dominical únicamente el domingo; el sábado queda como día normal de semana.
- Ajusta `buildApoyoDetailRows()` para transformar registros de apoyos al formato de detalle común, conservando `es_apoyo: true`.
- Cambia `normalizeTimeInput()` para interpretar entradas en el orden escrito: `455` => `04:55`, `415` => `04:15`, `1435` => `14:35`.
- La tabla Detalles ahora usa el check como `Turno válido`; al desmarcarlo se excluyen horas, valores y propinas de los cálculos.
- `calculateMoneyByDetail()` calcula auxilio de transporte por días únicos válidos, evitando doble auxilio cuando hay doble turno en una misma fecha.
- `renderDetallesCalculos()` añade tipo de turno, local, horario dinámico basado en inicio/fin válido y propinas.

### `nomina/index.html`
- Renombra `Validar transporte` a `Turno válido`.
- Añade columna `Tipo` en Detalles y Detalles cálculos.
- Añade columna `Local` y `Propinas` en Detalles cálculos.
- Mueve `Propinas` al final derecho de la tabla Detalles.
- Elimina el bloque visual de la tabla `Apoyos`; los datos siguen llegando desde BD/webhook pero se muestran integrados en Detalles.

### `css/nomina.css`
- Añade estilos aislados para distinguir filas normales (`nomina-row-turno`, verde) y apoyos (`nomina-row-apoyo`, lavanda/azul), siguiendo la gama visual existente.

## 3. Reversión de emergencia

### `js/nomina.js`
1. Para volver a tratar sábados como dominicales, cambiar `isWeekendPayrollDay()` a incluir `sábado` y `sabado`.
2. Para volver al parseo anterior de horas, restaurar en `normalizeTimeInput()` la separación antigua donde los primeros dos dígitos eran minutos y los últimos dígitos hora. No recomendado porque producía resultados como `455` => `05:45`.
3. Para volver a separar apoyos, retirar `...buildApoyoDetailRows()` de la asignación de `state.detalleCalculo` en `normalizeExcelPayrollForUi()` y restaurar la tabla `Apoyos` en `nomina/index.html`.
4. Para que el check vuelva a transporte, en el listener de `.nomina-detalle-validar` asignar nuevamente `row.incluidoTransporte = event.target.checked` y ajustar el encabezado a `Validar transporte`.
5. Para quitar columnas nuevas, revertir los encabezados de `nomina/index.html` y las celdas añadidas en el render de `nominaDetalleCalculoBody` y `renderDetallesCalculos()`.

### `nomina/index.html`
1. Restaurar el bloque `<div class="comprobante-table nomina-apoyos-panel nomina-wide-panel">` con `tbody id="nominaApoyosBody"` si se requiere la tabla separada.
2. Cambiar los encabezados de Detalles y Detalles cálculos al estado anterior, retirando `Tipo`, `Local` y la propina de Detalles cálculos.

### `css/nomina.css`
1. Borrar las reglas finales de `.nomina-row-turno`, `.nomina-row-apoyo`, `.nomina-row-apoyo strong` y `.nomina-row-turno strong` para volver a la visual neutra.

## 4. Exportación a otro repositorio
1. Copiar los cambios de `js/nomina.js`, `nomina/index.html` y `css/nomina.css` juntos, porque las columnas HTML deben coincidir con el render JS y los colores dependen del CSS.
2. Confirmar que el repositorio destino centralice URLs/webhooks como este proyecto; aquí no se cambiaron URLs, se sigue usando `js/webhooks.js` desde `js/nomina.js`.
3. Validar que el webhook entregue `detalle` y `apoyos` en la misma estructura esperada. La función `buildApoyoDetailRows()` adapta `fecha_turno`, `hora_inicio`, `hora_fin` y propinas de apoyo a filas comunes.
4. Verificar que no exista otro archivo que renderice `nominaDetalleCalculoBody` o `nominaDetallesCalculosBody`; si existe, aplicar primero la lógica de columnas ahí para evitar desfases visuales.
5. Ejecutar `node --check js/nomina.js` y hacer una consulta real de nómina con: sábado, domingo, doble turno en misma fecha, apoyo con propina y ajuste manual de hora válida.

## 5. Check funcional para logs
- Nómina — sábados: calculan como horas normales, no dominicales.
- Nómina — domingos: mantienen cálculo dominical.
- Nómina — apoyos: aparecen integrados en Detalles y Detalles cálculos con tipo explícito y color lavanda/azul.
- Nómina — turnos normales: aparecen con tipo explícito y color verde.
- Nómina — turno válido: al desactivar una fila se descuentan horas, dinero y propinas de esa fila.
- Nómina — auxilio de transporte: se calcula por fechas únicas válidas, no por cantidad de filas.
- Nómina — horas válidas: entradas como `455`, `415` y `1435` se normalizan a `04:55`, `04:15` y `14:35`.
- Nómina — comprobante PNG: sin cambios; deducciones legales no se agregaron al comprobante porque la tabla de Supabase todavía no existe.
- Login/sesión/contexto/header: no modificados.

---

# Parche posterior #1 — 2026-08-12 — Deducciones de ley, parámetros inline e histórico completo

## 1. Objetivo del parche
Completar el módulo de Nómina con deducciones de ley configurables en la interfaz, envío de metadatos completos al webhook de deducciones, actualización directa de parámetros desde Nómina, mejora visual del comprobante, enriquecimiento del histórico con locales/tipos de fila y acciones para borrar nóminas históricas.

## 2. Archivos implicados

### `js/nomina.js`
- Añade `deduccionesLey` al estado con Salud y Pensión activas al 4% por defecto.
- Calcula Salud y Pensión únicamente sobre el valor monetario de horas (`valor_diurnas`, `valor_nocturnas`, `valor_dominical_diurnas`, `valor_dominical_nocturnas`), excluyendo propinas y auxilio de transporte.
- Renderiza deducciones de ley como deducciones reales del comprobante final, con porcentaje editable y switch para activar/desactivar cada una.
- Excluye deducciones de ley del PDF/HTML de autorización de descuentos, porque ese documento solo aplica a deducciones auxiliares no contractuales.
- Añade `empleado_id`, `empleado_usuario_id` y `usuario_empleado_id` a la metadata enviada al webhook de deducciones.
- Añade `actualizarParametrosNomina()` y `buildParametrosNominaUpdatePayload()` para enviar los parámetros actuales y sus matches al webhook centralizado `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR`.
- Mejora el PNG del comprobante con lavanda, borde de marca y caja destacada del neto.
- Enriquecer el payload histórico con `locales`, `tipo_filas` y `deducciones_ley`.

### `nomina/index.html`
- Añade el botón `Actualizar parámetros de nómina` dentro de las acciones del módulo.

### `js/webhooks.js`
- Añade `WEBHOOK_NOMINA_HISTORICO_BORRAR` para solicitar borrado de una nómina histórica.
- Registra el nuevo webhook en el mapa `WEBHOOKS`.
- Declara que `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` también es usado por `js/nomina.js`.

### `nomina/historico.html`
- Añade columna `Acciones` para contener el botón de borrado por nómina.

### `js/nomina_historico.js`
- Importa `WEBHOOK_NOMINA_HISTORICO_BORRAR`.
- Resuelve el empleado por `empleado_id`, `usuario_id`, `responsable_id`, `responsable`, datos anidados o responsable en detalles.
- Renderiza todas las columnas recibidas en tablas históricas, no solo un resumen reducido.
- Muestra `Locales`, `Tipos de filas` y `Deducciones de ley` cuando llegan en el histórico.
- Agrega acción de borrado que envía señal al webhook y oculta el registro en frontend durante la sesión.

### `css/nomina.css`
- Añade personalización lavanda del comprobante web.
- Añade estilos para deducciones de ley y botón de borrado histórico.

## 3. Reversión de emergencia
1. En `js/nomina.js`, eliminar `deduccionesLey`, `getHorasPayrollBase()`, `buildDeduccionesLeyRows()` y la inclusión `...buildDeduccionesLeyRows(calculation)` dentro de `buildPayrollRowsFromEditableDetail()` para quitar Salud/Pensión.
2. En `js/nomina.js`, si el PDF de deducciones debe volver a incluir todo, cambiar `buildDeduccionesRows()` para no filtrar `item.fuente !== "ley"`.
3. En `js/nomina.js`, quitar `actualizarParametrosNomina()`, `buildParametrosNominaUpdatePayload()` y el listener de `actualizarParametrosBtn` si se desea volver a actualizar parámetros solo desde `configuracion/parametros_nomina.html`.
4. En `nomina/index.html`, borrar el botón `actualizarParametrosNomina`.
5. En `js/webhooks.js`, borrar `WEBHOOK_NOMINA_HISTORICO_BORRAR` y su entrada en `WEBHOOKS` si el backend de borrado no se usará.
6. En `nomina/historico.html`, retirar `<th>Acciones</th>`.
7. En `js/nomina_historico.js`, revertir el render de botón `.nomina-historico-delete`, `borrarNominaHistorica()` y la lógica de `ocultasSesion`.
8. En `css/nomina.css`, borrar los bloques de `.nomina-deduccion-ley-*`, `.nomina-law-switch`, `.nomina-historico-delete` y la personalización nueva de `.comprobante` si se desea volver al estilo plano.

## 4. Exportación a otro repositorio
1. Migrar juntos `js/nomina.js`, `nomina/index.html`, `css/nomina.css`, `js/nomina_historico.js`, `nomina/historico.html` y `js/webhooks.js`, porque el botón, los estilos, el cálculo y los webhooks se conectan entre sí.
2. Centralizar URLs en el destino igual que este repositorio: `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` y `WEBHOOK_NOMINA_HISTORICO_BORRAR` deben existir en el archivo central equivalente a `js/webhooks.js`.
3. Verificar que el webhook de parámetros acepte payload por lote (`parametros`, `parametros_tiempo`, `parametros_calculo`) o adaptar solo `buildParametrosNominaUpdatePayload()` al contrato del backend destino.
4. Verificar que el webhook de borrado acepte `nomina_id`, `id`, `empresa_id`, `tenant_id`, `empleado_id` y `fecha`.
5. Confirmar que histórico guarde y devuelva `tablas.detalle`, `tablas.locales`, `tablas.tipo_filas` y `tablas.deducciones_ley`; si el backend devuelve nombres distintos, ajustar únicamente `normalizeHistoricoRow()`.
6. Ejecutar `node --check js/nomina.js`, `node --check js/nomina_historico.js` y `node --check js/webhooks.js` tras migrar.

## 5. Check funcional para logs
- Nómina — Salud/Pensión: aparecen activas al 4% por defecto, editables y desactivables.
- Nómina — base de ley: calcula solo sobre valores de horas, sin propinas ni auxilio de transporte.
- Nómina — comprobante final: muestra deducciones de ley si están activas.
- Envío de deducciones: excluye deducciones de ley e incluye ID del empleado consultado.
- Parámetros desde Nómina: botón envía valores actuales y matches al webhook centralizado.
- Comprobante PNG: mantiene estructura y añade marca visual lavanda.
- Histórico — empleado: resuelve nombre desde IDs habituales y detalles.
- Histórico — detalle: renderiza tablas completas recibidas, locales, tipos de fila y deducciones de ley.
- Histórico — borrado: envía señal al webhook y oculta la nómina en la sesión.
- Login/sesión/contexto/header: no modificados.

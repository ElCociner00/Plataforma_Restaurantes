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

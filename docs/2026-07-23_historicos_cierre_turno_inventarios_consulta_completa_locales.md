# 2026-07-23 · Históricos de cierre turno e inventarios con consulta completa y soporte locales

## Objetivo
Corregir la carga incompleta y los errores en los módulos **Histórico cierre turno** e **Histórico cierre inventarios**, especialmente cuando el tenant activo es un local. La actualización hace consultas paginadas a Supabase, usa tablas gemelas para locales y consulta siempre el webhook auxiliar para completar faltantes sin bloquear la interfaz si una fuente falla.

## Archivos implicados

### `js/historico_cierre_turno.js` — modificado
- Añade paginación por bloques de 1000 filas para evitar límites de Supabase en `turnos_agrupados`.
- Detecta contexto local con `local_context` o diferencia entre `empresa_principal_id` y `empresa_id`.
- Cambia automáticamente la tabla directa a `turnos_agrupados_locales` y `cierres_turno_final_locales` cuando el contexto es local.
- Consulta siempre `WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS` y mezcla sus filas con Supabase por identidad del turno.
- Normaliza el formato del webhook auxiliar, incluyendo `variables_detalle`, `responsable`, `bolsa`, `caja_final` y `momento` desde `nombre_turno`.
- Excluye `nombre_turno` de columnas generales visibles y crea `momento` para evitar confusión visual.
- Sustituye filtros de número de turno, hora inicio y hora fin por `Periodo` y `Momento`.

### `cierre_turno/historico_cierre_turno.html` — modificado
- Elimina los filtros no usados `Número de turno`, `Hora inicio` y `Hora fin`.
- Agrega selector `Periodo` con opciones personalizado, hoy, semana actual y mes actual.
- Agrega selector `Momento` para filtrar mañana/tarde.

### `css/historico_cierre_turno.css` — modificado
- Mejora visual de la tabla histórica con encabezado degradado, filas alternadas, hover, sombra suave y controles más consistentes.
- Fuerza números, fechas y celdas de resumen a no partirse verticalmente.

### `js/historico_cierre_inventarios.js` — modificado
- Añade consulta paginada a Supabase para el histórico de inventarios.
- Detecta contexto local y usa `inventario_diario_resumen_locales` cuando aplica.
- Consulta siempre `WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS` y mezcla resultados con Supabase para completar datos disponibles.
- Reemplaza filtros horarios por `Periodo` y `Momento`.

### `cierre_inventarios/historico_cierre_inventarios.html` — modificado
- Elimina filtros `Hora inicio` y `Hora fin`.
- Agrega selector `Periodo` y selector `Momento`, manteniendo el filtro de producto.

## Reversión de emergencia

> Recomendación rápida: ejecutar `git revert <commit>` revierte todos los archivos de este cambio sin tocar login, sesión, contexto ni header.

### Revertir solo histórico cierre turno
1. En `js/historico_cierre_turno.js`, eliminar las constantes `SUPABASE_PAGE_SIZE`, `TURNO_TABLES`, `CIERRE_FINAL_TABLES`, `isLocalContext`, `getScopedTable`, `fetchAllSupabaseRows`, `mergeRowsByIdentity` y `fetchWebhookRows`.
2. Restaurar la consulta directa única a `.from("turnos_agrupados")` dentro de `loadInitialData()`.
3. Restaurar `.from("cierres_turno_final")` dentro de `enrichRowsWithCierreTurnoFinal()`.
4. Quitar la asignación `general.momento` dentro de `sanitizeRow()` y retirar `nombre_turno` de la lista de exclusión si se desea volver a mostrar esa columna.
5. En `cierre_turno/historico_cierre_turno.html`, volver a añadir los labels con IDs `filtroNumeroTurno`, `filtroHoraInicio` y `filtroHoraFin`, y eliminar `filtroPeriodo`/`filtroMomento`.
6. En `css/historico_cierre_turno.css`, borrar el bloque final marcado como `Parche histórico 2026-07-23`.

### Revertir solo histórico inventarios
1. En `js/historico_cierre_inventarios.js`, eliminar `buildRequestHeaders`, `WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS`, `SUPABASE_PAGE_SIZE`, `INVENTARIO_TABLES`, `isLocalContext`, `getScopedInventoryTable`, `fetchWithTimeout`, `fetchAllInventoryRows`, `fetchWebhookInventoryRows`, `getInventoryRowKey` y `mergeInventoryRows`.
2. Restaurar la consulta directa única a `.from("inventario_diario_resumen")` dentro de `loadData()`.
3. En `cierre_inventarios/historico_cierre_inventarios.html`, volver a añadir los filtros `filtroHoraInicio` y `filtroHoraFin`, y eliminar `filtroPeriodo`/`filtroMomento`.

## Guía para exportar este cambio a otro repositorio
1. Generar parche: `git format-patch -1 --stdout > historicos_locales_2026-07-23.patch`.
2. En el repositorio destino, aplicar: `git apply --check historicos_locales_2026-07-23.patch` y luego `git apply historicos_locales_2026-07-23.patch`.
3. Verificar que el destino centralice URLs en un archivo equivalente a `js/webhooks.js`. Este repositorio consume `WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS` y `WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS` desde ahí; si el destino usa otro archivo, mantener la centralización y cambiar solo los imports.
4. Verificar que existan tablas Supabase equivalentes:
   - Principal cierre turno: `turnos_agrupados`, `cierres_turno_final`.
   - Local cierre turno: `turnos_agrupados_locales`, `cierres_turno_final_locales`.
   - Principal inventarios: `inventario_diario_resumen`.
   - Local inventarios: `inventario_diario_resumen_locales` o adaptar el nombre en `INVENTARIO_TABLES` si el repositorio destino usa otro nombre.
5. Verificar que el contexto de sesión exponga `empresa_id` y, para locales, `local_context` o `empresa_principal_id` diferente de `empresa_id`.
6. Ejecutar validaciones: `node --check js/historico_cierre_turno.js`, `node --check js/historico_cierre_inventarios.js` y pruebas manuales con empresa principal + local.

## Check funcional para logs
- Cierre turno histórico: funciona con consulta paginada, tablas locales y fallback n8n combinado.
- Cierre inventarios histórico: funciona con consulta paginada, tabla local estimada `inventario_diario_resumen_locales` y fallback n8n combinado.
- Login / sesión / contexto / header: no fueron modificados.
- Visualización tabla cierre turno: mejorada; se evita quiebre vertical de fechas y valores monetarios.
- Riesgo conocido: si el histórico local de inventarios usa un nombre de tabla distinto a `inventario_diario_resumen_locales`, ajustar únicamente `INVENTARIO_TABLES.local`.

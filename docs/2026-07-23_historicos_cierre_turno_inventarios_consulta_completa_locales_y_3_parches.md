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

---

## Parche 1 — 2026-07-23 — Responsables en históricos de locales

### Objetivo del parche
Corregir el caso donde los cierres históricos de locales cargan correctamente las filas, pero el campo `responsable` queda vacío porque el ID del usuario local no siempre coincide con el ID principal que sí tiene nombre en las tablas base o porque Supabase no trae el nombre ya resuelto.

### Archivo modificado

#### `js/historico_cierre_turno.js`
- **Tipo de modificación:** normalización y enriquecimiento no intrusivo de datos ya consultados.
- **Qué hace explícitamente:**
  - `mergeRowsByIdentity()` ahora conserva el `responsable` textual que llegue desde el webhook auxiliar cuando Supabase no lo trae.
  - `resolveResponsableName()` acepta aliases adicionales como `registrado_por_nombre` y `usuario_nombre`.
  - `enrichResponsableNamesForLocalContext()` consulta `usuarios_locales` solo en contexto local y arma un mapa por `usuarios_locales.id` y `usuario_principal_id` para resolver nombres aunque el cierre venga con ID local o con ID principal.
  - Si falta el nombre del principal, consulta `usuarios_sistema`, `otros_usuarios` y `empleados` por esos IDs como respaldo.

### Reversión de emergencia del parche 1
1. Renombrar este archivo de documentación de vuelta a `docs/2026-07-23_historicos_cierre_turno_inventarios_consulta_completa_locales.md` si se revierte solo este parche.
2. En `js/historico_cierre_turno.js`, volver `resolveResponsableName()` a sus aliases anteriores: `responsable`, `responsable_nombre`, `nombre_responsable`, `responsableName`.
3. En `js/historico_cierre_turno.js`, restaurar `mergeRowsByIdentity()` para que solo mezcle filas y `variables_detalle`, sin preservar `responsable` desde el webhook.
4. Eliminar completa la función `enrichResponsableNamesForLocalContext()`.
5. Eliminar la línea `await enrichResponsableNamesForLocalContext(payload.empresa_id);` después de construir `state.responsableNamesById`.

### Exportación del parche 1 a otro repositorio
- Aplicar junto con el cambio base o generar parche incremental con `git format-patch -1 --stdout > historicos_responsables_locales_2026-07-23.patch`.
- Confirmar que el repositorio destino tenga tabla `usuarios_locales` con columnas `id`, `usuario_principal_id`, `empresa_id` y `nombre_completo`.
- Confirmar que las tablas principales de usuarios (`usuarios_sistema`, `otros_usuarios`, `empleados`) tengan `id` y `nombre_completo`.
- Si el destino resuelve responsables en un archivo central distinto, migrar la lógica de mapa local/principal allí, pero mantener el histórico sin depender de archivos nuevos.

### Check funcional actualizado
- Cierre turno histórico en locales: funciona y muestra responsable usando webhook, ID local o ID principal.
- Cierre turno histórico en empresa principal: mantiene comportamiento anterior.
- Cierre inventarios histórico: no se modificó en este parche.
- Login / sesión / contexto / header: no fueron modificados.

---

## Parche 2 — 2026-07-23 — Fusión robusta de responsables desde webhook auxiliar

### Objetivo del parche
Resolver el caso persistente donde el histórico de cierre turno de locales seguía mostrando el responsable vacío aunque el webhook auxiliar sí enviara `responsable` completo. La causa probable era que la mezcla anterior identificaba filas con una llave dependiente del `id`, `turno_nombre` o del índice de arreglo; si Supabase y el webhook no compartían el mismo `id` o llegaban en orden diferente, ambas filas no se fusionaban y el nombre del webhook no alcanzaba a completar la fila renderizada.

### Archivo modificado

#### `js/historico_cierre_turno.js`
- **Tipo de modificación:** parche aislado de normalización/fusión de datos, sin tocar login, sesión, contexto ni header.
- **Qué hace explícitamente:**
  - Se agregó `getRowIdentityParts()` para extraer de cada turno las piezas estables: `id`, `turno_nombre`, `fecha_turno`, `numero_turno`, `nombre_turno`, `hora_inicio` y `hora_fin`.
  - Se agregó `buildTurnoIdentityKeys()` para construir varias llaves de coincidencia por turno: por `id`, por `turno_nombre`, por `fecha + número + horas` y por `fecha + nombre/momento + horas`.
  - `getRowId()` ahora toma la primera llave estable generada por `buildTurnoIdentityKeys()`, evitando depender directamente del índice salvo como último recurso.
  - `mergeRowsByIdentity()` ahora mantiene aliases de llaves; si una fila de Supabase coincide con una fila del webhook por cualquiera de las llaves alternativas, se fusionan en el mismo registro y se conserva el `responsable` textual recibido desde el webhook cuando el registro directo lo trae vacío.

### Cómo se resuelve en empresas principales y por qué fallaba en locales
- En empresas principales, el flujo normal carga responsables con `fetchResponsablesActivos(empresa_id)`, que consulta `usuarios_sistema`, `otros_usuarios` y `empleados`; luego `state.responsableNamesById` permite resolver `responsable_id` durante `sanitizeRow()`.
- En locales, hay más puntos de desalineación: el cierre puede venir con ID local de `usuarios_locales`, ID principal (`usuario_principal_id`) o sin nombre resuelto por RLS/consulta directa. El parche 1 agregó lectura de `usuarios_locales`, pero si la fila que se renderizaba era solo la fila directa de Supabase y no se fusionaba con la fila del webhook auxiliar, el campo textual `responsable` del webhook se perdía.
- Este parche no cambia RLS ni tablas: hace que la fusión frontend use llaves funcionales del turno. Si después de esto sigue faltando el nombre, revisar RLS/SELECT sobre `usuarios_locales` y confirmar que `turnos_agrupados_locales` o el webhook traigan al menos una de estas combinaciones: `id`, `turno_nombre`, o `fecha_turno + numero_turno/nombre_turno + hora_inicio + hora_fin`.

### Reversión de emergencia del parche 2
1. Renombrar este documento de vuelta a `docs/2026-07-23_historicos_cierre_turno_inventarios_consulta_completa_locales_y_1_parche.md` si solo se revierte este parche.
2. En `js/historico_cierre_turno.js`, borrar completas las funciones `getRowIdentityParts()` y `buildTurnoIdentityKeys()`.
3. Restaurar `getRowId()` al formato anterior:
   ```js
   const getRowId = (row, index) => String(row.id || row.turno_nombre || `${row.fecha_turno || "sin_fecha"}-${row.numero_turno || "sin_turno"}-${row.hora_inicio || "sin_inicio"}-${row.hora_fin || "sin_fin"}-${index}`);
   ```
4. Restaurar `mergeRowsByIdentity()` para crear solo `const merged = new Map();`, calcular `const key = getRowId(row, index);` y fusionar por esa llave única, sin `aliases` ni `buildTurnoIdentityKeys()`.

### Exportación del parche 2 a otro repositorio
- Generar el parche incremental desde este commit: `git format-patch -1 --stdout > historicos_responsables_locales_fusion_robusta_2026-07-23.patch`.
- En el repositorio destino, validar primero: `git apply --check historicos_responsables_locales_fusion_robusta_2026-07-23.patch`.
- Aplicar después: `git apply historicos_responsables_locales_fusion_robusta_2026-07-23.patch`.
- Particularidades de este repositorio: las URLs están centralizadas en `js/webhooks.js`; este parche no agrega URL nueva, pero depende de que `WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS` siga apuntando al webhook auxiliar que entrega `responsable` textual.
- Validar que el destino conserve equivalentes de `turnos_agrupados`, `turnos_agrupados_locales`, `usuarios_locales` y del webhook auxiliar. Si el destino usa otros nombres de campos para fecha, número, momento u horas, adaptar solo `getRowIdentityParts()` agregando esos aliases en las listas de candidatos.

### Check funcional actualizado
- Cierre turno histórico en locales: debe mostrar responsable si el nombre llega por webhook auxiliar o si se puede resolver por `usuarios_locales`/tablas principales.
- Cierre turno histórico en empresa principal: mantiene el flujo existente por `fetchResponsablesActivos()` y no depende del webhook para nombres.
- Cierre inventarios histórico: no se modificó en este parche.
- Login / sesión / contexto / header: no fueron modificados.
- Riesgo pendiente: si Supabase bloquea por RLS tanto `usuarios_locales` como el webhook no devuelve campos suficientes para empatar filas, el frontend no podrá inventar el nombre; en ese caso corregir políticas SELECT de `usuarios_locales` y/o payload del webhook.

---

## Parche 3 — 2026-07-23 — Responsables locales desde `cierres_turno_final_locales.responsable_id`

### Objetivo del parche
Corregir la falla persistente donde el histórico de cierre turno en locales podía mostrar solo el responsable de la primera fila o dejar la mayoría de filas vacías. La causa confirmada es que la tabla `cierres_turno_final_locales` sí entrega `responsable_id`, pero la fila renderizada no siempre traía ese ID antes de la sanitización; por eso no alcanzaba a cruzarse contra `usuarios_locales.id` aunque esa tabla tuviera `nombre_completo` correcto.

### Archivo modificado

#### `js/historico_cierre_turno.js`
- **Tipo de modificación:** enriquecimiento aislado dentro de la función existente `enrichRowsWithCierreTurnoFinal()`.
- **Qué hace explícitamente:**
  - La consulta existente a `cierres_turno_final_locales` ya trae `responsable_id`; ahora se usa también para resolver nombres, no solo bolsa/caja.
  - Se añadió un índice interno `byFechaHoras` para empatar cierres finales por `fecha_turno + hora_inicio + hora_fin` cuando la fila base no tiene `responsable_id` y por eso no puede coincidir con el composite anterior que incluía responsable.
  - Cuando hay match con cierre final y `row.general.responsable` está vacío, se busca `fallback.responsable_id` en `state.responsableNamesById`; ese mapa ya fue alimentado previamente desde `usuarios_locales.id` y `usuarios_locales.usuario_principal_id` por `enrichResponsableNamesForLocalContext()`.
  - También se completa `row.meta.responsable_id` con el ID del cierre final para que los procesos posteriores, incluyendo detalle y Excel, trabajen con el dato completo.

### Cómo se resuelve en empresas principales
En empresa principal, el nombre suele resolverse antes porque `fetchResponsablesActivos(empresa_id)` devuelve los responsables desde `usuarios_sistema`, `otros_usuarios` y `empleados`, y `sanitizeRow()` usa `responsable_id` de la fila original para buscar en `state.responsableNamesById`. En locales el ID que llega en `cierres_turno_final_locales.responsable_id` corresponde a `usuarios_locales.id`; por eso este parche lo cruza explícitamente con el mapa de `usuarios_locales` sin tocar el flujo de empresa principal.

### Reversión de emergencia del parche 3
1. Renombrar este documento de vuelta a `docs/2026-07-23_historicos_cierre_turno_inventarios_consulta_completa_locales_y_2_parches.md` si se revierte únicamente este parche.
2. En `js/historico_cierre_turno.js`, dentro de `enrichRowsWithCierreTurnoFinal()`, borrar la línea `const byFechaHoras = new Map();`.
3. En el `data.forEach((item) => { ... })` de esa misma función, borrar el bloque que construye `fechaHoras` y guarda `byFechaHoras.set(fechaHoras, item)`.
4. En el `rows.forEach((row) => { ... })`, borrar el bloque que vuelve a construir `fechaHoras`, `fechaHorasMatch` y cambiar `const fallback = sourceMatch || compositeMatch || fechaHorasMatch;` por `const fallback = sourceMatch || compositeMatch;`.
5. Borrar las constantes `fallbackResponsableId`, `currentResponsable` y `fallbackResponsableName`, junto con las dos asignaciones que completan `row.general.responsable` y `row.meta.responsable_id`.

### Exportación del parche 3 a otro repositorio
- Generar parche incremental: `git format-patch -1 --stdout > historicos_locales_responsable_id_cierre_final_2026-07-23.patch`.
- Validar en destino: `git apply --check historicos_locales_responsable_id_cierre_final_2026-07-23.patch`.
- Aplicar: `git apply historicos_locales_responsable_id_cierre_final_2026-07-23.patch`.
- Particularidades del repositorio: las URLs siguen centralizadas en `js/webhooks.js`; este parche no crea URLs ni archivos nuevos y solo depende de tablas Supabase ya usadas por el módulo.
- Validaciones necesarias en el destino:
  - `cierres_turno_final_locales` debe exponer `fecha_turno`, `hora_inicio`, `hora_fin` y `responsable_id`.
  - `usuarios_locales` debe exponer `id`, `usuario_principal_id`, `empresa_id` y `nombre_completo`.
  - El contexto local debe usar el mismo `empresa_id` del local para ambas consultas.
  - Si existen múltiples cierres con la misma fecha y horas, añadir otra llave estable disponible en ambos orígenes para evitar empates ambiguos.

### Check funcional actualizado
- Histórico cierre turno local: debe resolver nombres por `cierres_turno_final_locales.responsable_id` → `usuarios_locales.id` y reflejarlos en tabla, detalle, PNG y Excel.
- Histórico cierre turno empresa principal: mantiene resolución existente por `fetchResponsablesActivos()` y no requiere `usuarios_locales`.
- Cierre inventarios histórico: no se modificó en este parche.
- Login / sesión / contexto / header: no fueron modificados.
- Riesgo pendiente: si RLS impide leer `usuarios_locales.nombre_completo`, el frontend verá `responsable_id` pero no podrá convertirlo a nombre; en ese caso corregir política SELECT de `usuarios_locales` para el local activo.

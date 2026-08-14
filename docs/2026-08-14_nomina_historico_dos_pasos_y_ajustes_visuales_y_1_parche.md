# 2026-08-14 - Nómina e histórico en dos pasos y ajustes visuales

## 1. Objetivo
Implementar mejoras aisladas en el módulo de Nómina y en Histórico Nómina sin tocar login, sesión, contexto, header ni matrices de navegación. El objetivo principal es evitar consultas repetidas por falta de feedback visual, ubicar la acción de parámetros junto a su tabla, corregir la legibilidad del comprobante PNG/interfaz, reforzar columnas equivalentes entre tablas y separar el histórico en vista resumida + detalle bajo demanda.

## 2. Archivos implicados y cambios

### `nomina/index.html`
- Se retiró el botón **Actualizar parámetros de nómina** del bloque superior de acciones.
- Se añadió el mismo botón dentro del `tfoot` de la tabla **Parámetros**, junto a **Añadir parámetro auxiliar**, para que su alcance sea intuitivo.
- No se modificó login, sesión, header ni contexto.

### `nomina/historico.html`
- La tabla de histórico pasó de 3 a 5 columnas: fecha, responsable, empresa/sede, periodo y acciones.
- El mensaje de estado inicial documenta que el listado usa `nomina_historico_consultar_vista` y que el detalle se consulta al seleccionar una fila.

### `js/webhooks.js`
- Se centralizó la nueva URL `WEBHOOK_NOMINA_HISTORICO_VISTA` con `https://n8n.enkrato.com/webhook/nomina_historico_consultar_vista`.
- Se mantiene `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` apuntando a `https://n8n.enkrato.com/webhook/nomina_historico_consultar` para el detalle completo.

### `js/nomina.js`
- Se agregó `setNominaLoading()` para deshabilitar temporalmente **Consultar nómina**, cambiar su texto a “Consultando...” y marcar el estado como cargando mientras responde el webhook/fallback.
- Se amplió el encabezado web y PNG del comprobante para mostrar nombre, cédula, cargo, periodo y fecha de exportación.
- Se preservan metadatos fieles de detalle al guardar histórico: `tipo_turno`, `es_apoyo`, `sede`, `sede_nombre` y `detalle_original` cuando exista.
- Se reforzó la tabla **Detalles cálculos** para que las columnas equivalentes **Tipo** y **Local/Sede** se vean en negrita como en **Detalles**.

### `js/nomina_historico.js`
- El listado inicial ahora usa `WEBHOOK_NOMINA_HISTORICO_VISTA` y normaliza filas resumen.
- Al seleccionar una nómina se envía `id`, `nomina_id` y `row_id` al webhook `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` para cargar el detalle completo bajo demanda.
- Se añadió caché por ID para no repetir la consulta de detalle si el usuario vuelve a abrir la misma nómina.
- La resolución de responsable compara varios posibles identificadores (`id`, `usuario_id`, `user_id`, `responsable_id`, `id_principal`, `usuario_principal_id`) para reducir casos de “responsable sin resolver”.

### `css/nomina.css`
- Se añadió spinner aislado para `#consultarNomina.is-loading`.
- Se añadió estilo `status.is-loading` con gama lavanda existente.
- Se creó `.nomina-param-actions` para ordenar acciones de parámetros.
- Se corrigió el ajuste de texto de Salud/Pensión evitando cortes verticales innecesarios.
- Se agregó `.nomina-col-identidad` para destacar Tipo y Sede/Local en cálculos.

## 3. Reversión de emergencia

1. `nomina/index.html`
   - Volver a añadir el botón `actualizarParametrosNomina` dentro de `.nomina-actions`.
   - Quitar el botón `actualizarParametrosNomina` dentro de `.nomina-param-actions` en el `tfoot` de Parámetros.

2. `nomina/historico.html`
   - Restaurar encabezado de tabla a `<th>Fecha</th><th>Empleado</th><th>Acciones</th>`.
   - Restaurar el `colspan` inicial del body a `3`.
   - Cambiar el estado inicial para mencionar únicamente `nomina_historico_consultar`.

3. `js/webhooks.js`
   - Eliminar la constante `WEBHOOK_NOMINA_HISTORICO_VISTA`.
   - Dejar solo `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` apuntando a `nomina_historico_consultar`.

4. `js/nomina.js`
   - Eliminar la función `setNominaLoading()`.
   - Borrar las llamadas a `setNominaLoading(true, ...)` y `setNominaLoading(false)` dentro de `consultarNomina()`.
   - Revertir el encabezado del comprobante para quitar cédula y fecha de exportación si el formato anterior fuera necesario.
   - En `buildHistoricoNominaPayload()`, restaurar `detalle` al mapeo anterior si el backend antiguo no acepta `es_apoyo`, `sede_nombre` o `detalle_original`.

5. `js/nomina_historico.js`
   - Cambiar la consulta de listado para volver a `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR`.
   - Eliminar `consultarDetalleHistorico()` y volver a renderizar directamente la fila ya recibida.
   - Restaurar la tabla de listado de 5 a 3 columnas.

6. `css/nomina.css`
   - Borrar el bloque final marcado como “Parche Nómina 2026-08-14”.

## 4. Exportar este cambio a otro repositorio

1. Generar parche desde este repo: `git format-patch -1 --stdout > nomina_historico_dos_pasos_2026-08-14.patch`.
2. En el repositorio destino validar: `git apply --check nomina_historico_dos_pasos_2026-08-14.patch`.
3. Aplicar: `git apply nomina_historico_dos_pasos_2026-08-14.patch`.
4. Verificar que el repositorio destino también centralice URLs en un archivo equivalente a `js/webhooks.js`; si usa otro nombre, crear allí las constantes equivalentes y ajustar imports.
5. Confirmar que los IDs HTML `consultarNomina`, `actualizarParametrosNomina`, `nominaParametrosBody`, `historicoNominaBody` y `historicoNominaDetallePanel` existan antes de copiar solo la lógica.
6. Validar que el backend acepte histórico en dos pasos: vista resumida por `nomina_historico_consultar_vista` y detalle por `nomina_historico_consultar` con `id`/`nomina_id`/`row_id`.
7. Si en el destino ya existe otro normalizador de nómina histórica, fusionar prioritariamente la separación vista/detalle y la preservación fiel de `detalle` para no perder apoyos o turnos normales.

## 5. Check funcional para logs

- Nómina / Consultar nómina: funciona con indicador visual y botón deshabilitado durante la espera.
- Nómina / Parámetros: funciona; el botón de actualización queda junto a la tabla Parámetros.
- Nómina / Comprobante PNG: funciona; muestra datos no monetarios y mejora la lectura del encabezado.
- Nómina / Deducciones Salud y Pensión: funciona; ya no deberían quebrarse letra por letra.
- Nómina / Detalles cálculos: funciona; Tipo y Local/Sede quedan destacados en negrita.
- Histórico Nómina / Vista resumida: funciona si responde `nomina_historico_consultar_vista`.
- Histórico Nómina / Detalle bajo demanda: funciona si responde `nomina_historico_consultar` por ID.
- Login, sesión, contexto y header: no modificados.

## 6. Parche posterior 1 — 2026-08-14 — Evidencia de vista histórica, filtros y payload de parámetros

### Objetivo del parche
Corregir observaciones posteriores a la implementación inicial: destacar también la sede en la tabla Detalles, hacer evidente que Histórico Nómina consulta automáticamente el webhook de vista resumida al entrar, convertir Sede en selector, reutilizar el botón existente como aplicador de filtros locales y alinear el payload de actualización rápida de parámetros con el módulo individual `parametros_nomina`.

### Archivos modificados en este parche
- `nomina/historico.html`: el campo Sede cambió de `input search` a `select`, y el botón cambió de “Consultar histórico” a “Aplicar filtros” para evitar confusión; la consulta real de vista se mantiene automática al entrar.
- `js/nomina_historico.js`: se importó `listAvailableLocalContexts`, se cargan sedes como opciones cerradas, se añadió `buildHistoricoVistaPayload()` para que la carga inicial envíe solo datos protocolarios al webhook `nomina_historico_consultar_vista`, y el botón ahora filtra localmente la data ya recibida.
- `js/nomina.js`: la celda Sede de la tabla Detalles queda resaltada en negrita; la actualización rápida de parámetros ahora envía un payload por parámetro con la misma estructura del módulo individual (`tenant_id`, `empresa_id`, `tiempo_id`, `tiempo`, `tiempo_nombre`, `tiempo_factor_conversion`, `concepto_id`, `concepto`, `concepto_nombre`, `valor`, `usuario_id`, `registrado_por`, `origen`, `timestamp`).
- `css/nomina.css`: se reutiliza `.nomina-col-identidad` para la Sede de Detalles, sin añadir estilos nuevos.

### Reversión de emergencia del parche 1
1. En `nomina/historico.html`, cambiar el `select id="historicoNominaSede"` por el input anterior si se requiere escritura libre, y restaurar el texto del botón a “Consultar histórico”.
2. En `js/nomina_historico.js`, quitar `listAvailableLocalContexts`, `cargarSedes()` y `buildHistoricoVistaPayload()`; volver a usar `buildHistoricoRequestPayload()` en la consulta de listado si se desea que cada click consulte backend.
3. En `js/nomina.js`, reemplazar `buildParametroNominaInlinePayloads()` y `validateParametroNominaInlinePayload()` por el builder de lote anterior si el backend vuelve a aceptar batch de parámetros.
4. En la fila de Detalles dentro de `renderParametrosYDetalle()`, quitar `class="nomina-col-identidad"` y `<strong>` del `<td>` de Sede si se desea regresar al estilo plano.

### Exportación incremental del parche 1
- Generar solo este parche: `git format-patch -1 --stdout > nomina_historico_dos_pasos_patch_1_2026-08-14.patch`.
- Validar en destino: `git apply --check nomina_historico_dos_pasos_patch_1_2026-08-14.patch`.
- Aplicar en destino: `git apply nomina_historico_dos_pasos_patch_1_2026-08-14.patch`.
- Verificar que el destino tenga un equivalente de `listAvailableLocalContexts`; si no existe, poblar el selector Sede desde el mecanismo local de sedes del repositorio destino antes de aplicar el filtro.
- Verificar que el endpoint de parámetros del destino espera el mismo contrato unitario del módulo individual; este parche deja de mandar batch y manda una solicitud por parámetro para coincidir con ese contrato.

### Check funcional del parche 1
- Sede en tabla Detalles: funciona, resaltada con la misma clase visual de identidad usada en cálculos.
- Histórico Nómina / entrada al módulo: funciona, la llamada automática usa `nomina_historico_consultar_vista` con payload protocolario sin filtros de UI.
- Histórico Nómina / botón: funciona como aplicador de filtros sobre las rows ya cargadas.
- Histórico Nómina / filtro Sede: funciona como selector cerrado para evitar errores de escritura.
- Parámetros Nómina / actualización rápida desde Nómina: funciona enviando payload unitario compatible con el módulo individual.

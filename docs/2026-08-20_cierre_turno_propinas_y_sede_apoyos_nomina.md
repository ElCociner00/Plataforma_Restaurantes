# 2026-08-20 — Cierre turno propinas y sede en apoyos de nómina

## 1. Objetivo de la petición

Corregir dos detalles aislados sin tocar archivos matrices de login, sesión, contexto o header:

1. **Nómina:** permitir que las filas moradas de apoyos usen el nuevo campo `sede` que llega en cada apoyo para resolver el nombre real del local o sede principal, evitando que se muestre siempre `Sede actual`.
2. **Cierre turno:** impedir que la distribución de propinas confunda la propina total del turno con la propina correspondiente al responsable. El total del turno debe conservarse como valor general para el PNG y para el envío del cierre; la propina del responsable se conserva aparte solo para el bloque de apoyos/propinas del PNG.
3. **Cierre turno:** añadir mini carga al botón `Consultar Loggro` para bloquear clics repetidos mientras espera respuesta del webhook.

## 2. Archivos implicados y modificaciones

### `js/nomina.js`

- **Tipo de modificación:** ajuste de normalización y renderizado de datos ya recibidos.
- **Objetivo:** usar el nuevo campo `sede` de cada apoyo sin cambiar la estructura existente de `detalle`, `parametros`, `totales` o `metadata`.
- **Qué hace explícitamente:**
  - En `buildApoyoDetailRows`, conserva `sede` desde `row.sede`, `row.tenant_id`, `row.empresa_id` o `row.local_id` y calcula `sede_nombre` con `resolveSedeName`.
  - En `normalizeExcelPayrollForUi`, aplica la misma normalización para los apoyos que llegan desde el webhook/excel.
  - En el render de apoyos y exportación Excel, añade una columna/valor de sede para que las filas de apoyo no dependan del fallback `Sede actual`.

### `js/apoyos.js`

- **Tipo de modificación:** corrección acotada de distribución de propinas.
- **Objetivo:** separar la propina total del turno de la propina asignada al responsable.
- **Qué hace explícitamente:**
  - Añade `rebalanceIfExceedsTotal`, que solo actúa si la suma distribuida excede el total de referencia; en ese caso ajusta proporcionalmente responsable y apoyos sin mostrar alertas especiales al usuario.
  - En `applyDistribucion`, escribe en el input general `propina` el total del turno (`total_propina_dia` si existe) y guarda la porción del responsable en `data-propina-responsable` del mismo input.
  - El botón `Confirmar apoyo` sigue dejando los campos de propina de apoyo en solo lectura y no cambia nombres ni diseño.

### `js/cierre_turno_png.js`

- **Tipo de modificación:** ajuste visual de fuente de datos para el PNG.
- **Objetivo:** que el resumen financiero del PNG muestre la propina total del turno, mientras la tabla de apoyos/responsable usa la propina distribuida del responsable.
- **Qué hace explícitamente:**
  - Lee `dataset.propinaResponsable` cuando existe para la fila del responsable en la sección `Apoyos y propinas`.
  - Mantiene `inputsSoloVista.propina.value` como propina general del turno para la fila financiera `Propina`.

### `js/cierre_turno.js`

- **Tipo de modificación:** feedback de carga aislado en el botón de consulta.
- **Objetivo:** evitar spam de consultas a BD/webhook cuando el usuario presiona varias veces `Consultar Loggro`.
- **Qué hace explícitamente:**
  - Añade `setConsultarLoading` dentro del módulo de cierre turno.
  - Al iniciar la consulta, deshabilita el botón, agrega clase `is-loading`, `aria-busy=true` y cambia el texto a `Consultando turno...`.
  - En validaciones fallidas, payload inválido, éxito o error, restaura el texto `Consultar Loggro` y habilita de nuevo el botón.

### `css/cierre_turno.css`

- **Tipo de modificación:** estilo visual aislado.
- **Objetivo:** copiar la mini carga usada en nómina respetando la gama actual.
- **Qué hace explícitamente:**
  - Añade estilos para `#consultarDatos.is-loading` y su spinner `::after`.
  - Usa opacidad, cursor de espera, borde blanco semitransparente y animación propia `cierre-turno-spin`.

## 3. Reversión de emergencia

> Revertir solo si se detecta una regresión directa en nómina o cierre turno. No tocar login, sesión, contexto, header ni `js/webhooks.js`.

### Revertir `js/nomina.js`

1. En `buildApoyoDetailRows`, borrar las líneas que asignan:
   - `sede: row.sede || row.tenant_id || row.empresa_id || row.local_id || ""`
   - `sede_nombre: row.sede_nombre || row.local_nombre || row.nombre_sede || resolveSedeName(...)`
2. En `normalizeExcelPayrollForUi`, borrar las mismas dos propiedades dentro del `map` de `state.apoyosDetalle`.
3. En `renderApoyos`, eliminar la celda `<td>` que imprime `row.sede_nombre || resolveSedeName(...)`.
4. En `descargarExcelEmpleado`, devolver `apoyosHeaders` a:
   - `[
     "fecha turno", "responsable turno", "apoyo", "tiempo", "hora inicio", "hora fin", "propina"
     ]`
5. En las filas del Excel de apoyos, quitar la celda de sede y en la fila `Sin apoyos` quitar una celda vacía.

### Revertir `js/apoyos.js`

1. Borrar la función `rebalanceIfExceedsTotal` completa.
2. En `reset`, eliminar `delete propinaInput.dataset.propinaResponsable;`.
3. En `applyDistribucion`, volver a construir `tipsById` directamente desde `detalleRows`.
4. Restaurar que `propinaInput.value` reciba `responsableTip` si se desea volver exactamente al comportamiento anterior. Esta reversión no es recomendada porque reproduce el bug reportado.
5. Borrar la línea que asigna `propinaInput.dataset.propinaResponsable = String(responsableTip);`.

### Revertir `js/cierre_turno_png.js`

1. En `descargarImagenResumenCierreTurno`, cambiar la lectura de `propinaResponsable` para que vuelva a usar solo:
   - `snapshotContext.inputsSoloVista?.propina?.value || "0"`
2. Esta reversión no es recomendada si `js/apoyos.js` conserva la separación total/responsable, porque el PNG volvería a mostrar el total también en la fila del responsable.

### Revertir `js/cierre_turno.js`

1. Borrar la función `setConsultarLoading`.
2. En el listener de `btnConsultar`, eliminar:
   - `if (btnConsultar.disabled) return;`
   - `setConsultarLoading(true, "Consultando turno...");`
3. En validaciones y payload inválido, borrar las llamadas a `setConsultarLoading(false);`.
4. Eliminar el bloque `finally { setConsultarLoading(false); }` del `try/catch` de consulta.

### Revertir `css/cierre_turno.css`

1. Borrar el bloque final agregado:
   - comentario `Parche 2026-08-20...`
   - `#consultarDatos.is-loading`
   - `#consultarDatos.is-loading::after`
   - `@keyframes cierre-turno-spin`

## 4. Guía para exportar este parche a otro repositorio

1. Generar el parche desde este repositorio:
   - `git diff -- js/nomina.js js/apoyos.js js/cierre_turno_png.js js/cierre_turno.js css/cierre_turno.css docs/2026-08-20_cierre_turno_propinas_y_sede_apoyos_nomina.md > cierre_turno_propinas_sede_nomina_2026-08-20.patch`
2. En el repositorio destino, validar que existan estos archivos con nombres equivalentes:
   - `js/nomina.js`
   - `js/apoyos.js`
   - `js/cierre_turno_png.js`
   - `js/cierre_turno.js`
   - `css/cierre_turno.css`
3. Particularidad de este repositorio:
   - Las URLs/webhooks están centralizadas en archivos como `js/webhooks.js` y `js/urls.js`. Este parche **no modifica URLs**; si el repositorio destino usa otros endpoints, centralizarlos primero en su archivo equivalente y mantener este parche consumiendo las referencias ya existentes.
4. Aplicar el parche:
   - `git apply cierre_turno_propinas_sede_nomina_2026-08-20.patch`
5. Validar sintaxis mínima:
   - `node --check js/nomina.js`
   - `node --check js/apoyos.js`
   - `node --check js/cierre_turno_png.js`
   - `node --check js/cierre_turno.js`
6. Validación funcional recomendada:
   - Consultar una nómina con apoyos donde cada apoyo incluya `sede` y comprobar que la fila morada resuelve el local correcto.
   - En cierre turno, consultar datos, confirmar apoyo, distribuir propinas y descargar PNG. La fila financiera `Propina` debe mostrar el total del turno y la sección `Apoyos y propinas` debe mostrar la porción correspondiente al responsable y a cada apoyo.
   - Presionar varias veces `Consultar Loggro`; mientras carga debe quedar deshabilitado con spinner.

## 5. Check funcional para logs

- **Cierre turno:** funciona con separación entre propina total del turno y propina del responsable; el botón `Consultar Loggro` queda bloqueado con mini carga durante la consulta.
- **PNG cierre turno:** funciona con propina general en el resumen financiero y propina distribuida del responsable en la tabla de apoyos.
- **Nómina:** funciona con resolución de sede para filas de apoyo usando el nuevo campo `sede`.
- **Histórico nómina:** no fue modificado en este parche.
- **Login / sesión / contexto / header:** no fueron modificados.
- **URLs centralizadas / webhooks:** no fueron modificados.

# 2026-06-22 - Cierre turno auxiliar manual directo a Supabase

## 1. Objetivo
Crear un módulo de contingencia llamado **Cierre turno auxiliar** para que el cierre de turno pueda seguir operando cuando n8n, Loggro u otros webhooks externos estén caídos. El módulo replica la pantalla de cierre de turno, elimina las consultas externas y permite diligenciar todo manualmente para guardar directo en Supabase en la tabla `public.cierres_turno_final`.

## 2. Archivos implicados

### `cierre_turno/auxiliar.html` — archivo creado
- Copia estructural de `cierre_turno/index.html` con título y encabezado de contingencia.
- No incluye los botones de consulta `Consultar Loggro` ni `Consultar gastos`.
- Usa el CSS existente `css/cierre_turno.css` para conservar la apariencia del módulo original.
- Carga `js/cierre_turno_auxiliar.js` en lugar de `js/cierre_turno.js`.

### `js/cierre_turno_auxiliar.js` — archivo creado
- Implementa la lógica aislada del cierre auxiliar sin webhooks n8n.
- Carga contexto y responsables desde Supabase mediante utilidades existentes (`getUserContext`, `fetchResponsablesActivos`, `supabase`).
- Convierte todos los campos financieros de sistema/real, propina, domicilios y gastos a campos manuales.
- Respeta la visibilidad configurada por administración en `cierre_turno_visibilidad` y `cierre_turno_extras_visibilidad`: campos ocultos se guardan como cero.
- Valida campos obligatorios visibles: sistema y real deben diligenciarse aunque el valor sea cero.
- Si todos los gastos visibles están en cero/vacíos, pregunta confirmación antes de guardar.
- Construye filas independientes con huellas globales compartidas (`empresa_id`, `fecha_turno`, `responsable_id`, `hora_inicio`, `hora_fin`, `registrado_por`, `domicilios_global`, `efectivo_apertura`, `propina_global`, `total_global`, `bolsa_global`, `caja_global`, `hora_llegada`) y las inserta en `cierres_turno_final`.
- Descarga la constancia PNG usando el módulo existente `descargarImagenResumenCierreTurno` para mantener el formato visual.
- Añade logs con prefijo `[cierre_turno_auxiliar]` para diagnosticar inicio, validaciones, número de filas y errores de Supabase.

### `js/urls.js` — modificación mínima
- Agrega `APP_URLS.cierreTurnoAuxiliar = buildAppPath("/cierre_turno/auxiliar.html")` para centralizar la URL del módulo, siguiendo la arquitectura del repositorio.

### `js/header.js` — modificación mínima solicitada para acceso
- En el dropdown de **Cierre de turno**, se dejan tres opciones en este orden:
  1. `Cierre turno`
  2. `Auxiliar`
  3. `Histórico`
- Esta fue la única modificación en header y se limitó a un enlace de navegación. No se tocó login, sesión ni contexto.

### `css/cierre_turno.css` — modificación visual pequeña
- Añade `.auxiliar-note` para marcar claramente que la pantalla está en modo contingencia.
- Añade estados visuales para `#status[data-type="success"]` y `#status[data-type="error"]`.

## 3. Emergencia / reversión detallada

1. **Quitar acceso desde header**
   - En `js/header.js`, dentro del dropdown `Cierre de turno`, eliminar el enlace `APP_URLS.cierreTurnoAuxiliar` y restaurar los nombres previos si se desea.
   - En `js/urls.js`, eliminar la línea `cierreTurnoAuxiliar: buildAppPath("/cierre_turno/auxiliar.html"),`.

2. **Desactivar el módulo auxiliar sin afectar cierre normal**
   - Borrar o renombrar `cierre_turno/auxiliar.html`.
   - Borrar o renombrar `js/cierre_turno_auxiliar.js`.
   - El cierre normal (`cierre_turno/index.html` + `js/cierre_turno.js`) no depende del auxiliar, por lo que seguirá igual.

3. **Revertir estilos**
   - En `css/cierre_turno.css`, borrar los bloques `.auxiliar-note`, `#status[data-type="success"]` y `#status[data-type="error"]` agregados al final.

4. **Si falla el guardado en Supabase**
   - Revisar consola del navegador y buscar logs `[cierre_turno_auxiliar] Supabase insert error`.
   - Validar RLS/permisos de `public.cierres_turno_final` para usuarios autenticados.
   - Validar que `responsable_id` exista en `usuarios_sistema.id` y que `empresa_id` exista en `empresas.id`, porque la tabla tiene foreign keys.
   - Validar que `puedeEnviarDatos(empresa_id, true)` no esté bloqueando por plan/solo lectura.

## 4. Exportar a otro repositorio

1. Copiar archivos creados:
   - `cierre_turno/auxiliar.html`
   - `js/cierre_turno_auxiliar.js`
2. Copiar modificaciones:
   - `js/urls.js`: agregar la ruta centralizada `cierreTurnoAuxiliar`.
   - `js/header.js`: agregar el enlace `Auxiliar` entre `Cierre turno` e `Histórico`.
   - `css/cierre_turno.css`: copiar los estilos finales `.auxiliar-note` y status.
3. Validar que el repositorio destino tenga equivalentes de:
   - `js/supabase.js`
   - `js/session.js`
   - `js/responsables.js`
   - `js/permisos.core.js`
   - `js/cierre_turno_png.js`
   - `js/input_utils.js`
4. Validar que exista la tabla `public.cierres_turno_final` con las columnas indicadas por el schema y que acepte insert desde el usuario autenticado.
5. Validar que el módulo normal use IDs de DOM equivalentes; el auxiliar depende de los mismos IDs para reutilizar la pantalla sin duplicar CSS ni PNG.
6. Si el destino no usa el archivo central de URLs `js/urls.js`, crear una constante o ruta equivalente y referenciarla desde el menú del header.

## 5. Check funcional para logs

- Cierre turno normal: no se modificó su JavaScript ni HTML; sigue operando como antes con n8n cuando esté disponible.
- Cierre turno auxiliar: funciona como contingencia manual; no consulta Loggro, no consulta gastos y guarda directo a Supabase.
- Supabase insert: preparado para insertar múltiples filas en `cierres_turno_final`; requiere RLS/foreign keys correctas en la base.
- PNG de constancia: reutiliza el formato existente de `cierre_turno_png.js`.
- Header: muestra las opciones `Cierre turno`, `Auxiliar`, `Histórico` en ese orden.
- Login/sesión/contexto: no fueron modificados.

## 6. Parche posterior 1 - 2026-06-22

### Objetivo del parche
Corregir el bloqueo de inicialización del módulo auxiliar, retirar textos innecesarios de contingencia en pantalla y asegurar que los campos manuales queden realmente editables para poder probar el flujo de guardado directo en Supabase.

### Cambios aplicados
- `cierre_turno/auxiliar.html`:
  - Se eliminó el texto visible `Modo manual de contingencia: no usa n8n ni consultas externas; guarda directamente en Supabase.`.
  - El botón `Verificar manual` fue renombrado a `Verificar`.
- `js/cierre_turno_auxiliar.js`:
  - Se corrigió la causa del error `elements.forEach is not a function`. El helper existente `enforceNumericInput` espera una colección de elementos, pero el auxiliar le estaba enviando inputs individuales al crear gastos y filas de apoyo. Se agregó `enforceOneNumericInput(element)` para envolver cada input en un arreglo antes de enviarlo al helper, incluyendo inputs existentes del DOM y los creados dinámicamente para gastos/apoyos.
  - Al corregirse ese error, la inicialización ya puede continuar hasta la carga de responsables y hasta la liberación de campos `readonly`, dejando sistema/real, propina, domicilios y gastos disponibles para llenado manual.

### Reversión del parche 1
- En `cierre_turno/auxiliar.html`, si se quisiera volver al estado anterior, reinsertar el párrafo `.auxiliar-note` bajo el `<h1>` y cambiar el texto del botón a `Verificar manual`.
- En `js/cierre_turno_auxiliar.js`, borrar `enforceOneNumericInput` y restaurar las llamadas individuales a `enforceNumericInput(input)`. No se recomienda porque reproduce el error de inicialización.

### Check funcional actualizado
- Cierre turno auxiliar: inicializa sin el error `elements.forEach is not a function`.
- Carga de responsables: vuelve a ejecutarse porque el init ya no se corta antes de llegar a `cargarResponsables()`.
- Campos manuales: sistema/real, propina, domicilios y gastos quedan editables después de inicializar.
- Botón de verificación: se muestra como `Verificar`.

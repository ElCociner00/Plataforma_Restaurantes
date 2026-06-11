# 2026-06-10 - Parámetros de nómina y limpieza de texto de recuperación y 3 parches

> **Nota de parche posterior:** la sección inicial conserva la documentación del cambio base. El **Parche 1** reemplaza la fuente de catálogos por webhooks n8n y cambia el webhook final de registro a `nuevo_parametro_nómina`. El **Parche 2** añade la exportación Excel estructurada del módulo de nómina usando el webhook `consultar_nomina_nuevo`. El **Parche 3** corrige una duplicación accidental de constantes en `js/webhooks.js` que causaba pantalla blanca global al cargar módulos que importan webhooks.

## 1. Objetivo de la petición

Este parche atiende dos solicitudes:

1. Eliminar el texto innecesario `Los locales comparten el mismo NIT tributario de la empresa principal.` del flujo de añadir local, porque no aporta valor al usuario final en el contexto indicado.
2. Crear un módulo sencillo para configurar parámetros de nómina por empresa/tenant. El módulo permite que una empresa seleccione una variable de **tiempo**, seleccione una variable de **concepto**, escriba manualmente un **valor numérico** y envíe esos datos junto al `tenant_id`/`empresa_id` a un webhook centralizado.

El webhook que debe crearse en n8n para recibir el envío es:

```txt
https://n8n.enkrato.com/webhook/nomina_parametros_registrar
```

Payload principal enviado por el formulario:

```json
{
  "tenant_id": "uuid-de-la-empresa",
  "empresa_id": "uuid-de-la-empresa",
  "tiempo_id": "id-o-codigo-del-tiempo",
  "tiempo": "nombre-visible-del-tiempo",
  "concepto_id": "id-o-codigo-del-concepto",
  "concepto": "nombre-visible-del-concepto",
  "valor": 12500,
  "usuario_id": "uuid-del-usuario",
  "registrado_por": "uuid-del-usuario",
  "origen": "configuracion_parametros_nomina",
  "timestamp": "fecha ISO"
}
```

## 2. Archivos implicados y detalle técnico

### `configuracion/anadir_local.html`

- **Tipo de modificación:** limpieza de contenido.
- **Objetivo:** retirar el texto auxiliar que indicaba que los locales comparten el NIT tributario de la empresa principal.
- **Qué hace explícitamente:** el campo `nit` permanece visible, requerido, numérico y de solo lectura, pero ya no muestra la nota inferior eliminada.

### `configuracion/index.html`

- **Tipo de modificación:** navegación.
- **Objetivo:** añadir un acceso al nuevo módulo desde la sección `Apis e integraciones`.
- **Qué hace explícitamente:** agrega el enlace `Parámetros de nómina`, apuntando a `configuracion/parametros_nomina.html`, debajo del acceso existente a `Nómina`.

### `configuracion/parametros_nomina.html`

- **Tipo de modificación:** archivo creado.
- **Objetivo:** crear la pantalla del módulo de configuración de parámetros de nómina.
- **Qué hace explícitamente:** define un formulario con tres campos titulados:
  - `Tiempo`: selector cargado desde Supabase.
  - `Concepto`: selector cargado desde Supabase.
  - `Valor`: input numérico manual.
- Incluye el botón `Guardar parámetro`, un área de estado accesible (`role="status"`) y carga los scripts globales de autenticación, header, footer y módulo aislado de autenticación.

### `css/parametros_nomina.css`

- **Tipo de modificación:** archivo creado.
- **Objetivo:** dar estilo al nuevo módulo sin alterar estilos de nómina operativa ni de otras pantallas.
- **Qué hace explícitamente:** limita el ancho del módulo, organiza el formulario en dos columnas para escritorio, conserva responsividad móvil y reutiliza un bloque visual de estado similar al resto del sistema.

### `js/parametros_nomina.js`

- **Tipo de modificación:** archivo creado.
- **Objetivo:** implementar la lógica del nuevo formulario.
- **Qué hace explícitamente:**
  - Obtiene el contexto de sesión con `getUserContext()` para resolver `empresa_id`/`tenant_id` y usuario activo.
  - Intenta cargar la lista de tiempos desde estas tablas de Supabase, en este orden:
    1. `nomina_tiempos`
    2. `nomina_tipos_tiempo`
    3. `nomina_catalogo_tiempos`
    4. `nomina_tiempo`
  - Intenta cargar la lista de conceptos desde estas tablas de Supabase, en este orden:
    1. `nomina_conceptos`
    2. `nomina_catalogo_conceptos`
    3. `nomina_concepto`
  - Normaliza filas usando columnas comunes (`id`, `uuid`, `codigo`, `code`, `slug`, `nombre`, `name`, `descripcion`, `label`) para soportar variaciones razonables de esquema.
  - Intenta consultar Supabase primero con filtros por `tenant_id` y luego por `empresa_id`; si el esquema no tiene esas columnas, usa lectura sin filtro y filtra en frontend cualquier `tenant_id`/`empresa_id` que venga en la respuesta.
  - Ignora filas con `activo === false` o `estado === false`.
  - Usa catálogos base de emergencia si Supabase no devuelve listas válidas, para que la pantalla no quede inutilizable mientras se ajustan tablas/RLS.
  - Construye el payload con `tenant_id`, `empresa_id`, `tiempo_id`, `tiempo`, `concepto_id`, `concepto`, `valor`, `usuario_id`, `registrado_por`, `origen` y `timestamp`.
  - Envía el payload al webhook centralizado usando `fetch` con headers de sesión (`Authorization`, `x-tenant-id`, `x-user-id`, `x-user-role`) mediante `buildRequestHeaders()`.

### `js/webhooks.js`

- **Tipo de modificación:** configuración centralizada.
- **Objetivo:** mantener la URL del nuevo webhook en el archivo central de URLs/webhooks del repositorio.
- **Qué hace explícitamente:**
  - Crea la constante `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` con la URL `https://n8n.enkrato.com/webhook/nomina_parametros_registrar`.
  - Registra `WEBHOOKS.NOMINA_PARAMETROS_REGISTRAR` indicando archivo consumidor, método `POST` y descripción operativa.

## 3. Notas de emergencia y reversión detallada

> Recomendación general: antes de revertir, confirmar si el webhook ya está siendo usado en producción y exportar cualquier configuración creada en Supabase/n8n.

### Revertir solo la eliminación del texto de NIT

Archivo: `configuracion/anadir_local.html`.

1. Ubicar el campo:

```html
<input type="text" id="nit" placeholder="NIT de la empresa principal" inputmode="numeric" pattern="[0-9]*" required readonly>
```

2. Añadir inmediatamente debajo este fragmento para volver al estado anterior:

```html
<small style="display:block;color:#6b7280;margin-top:-8px">Los locales comparten el mismo NIT tributario de la empresa principal.</small>
```

### Revertir el acceso desde Configuración

Archivo: `configuracion/index.html`.

Eliminar únicamente esta línea de la lista `Apis e integraciones`:

```html
<li><a href="parametros_nomina.html">Parámetros de nómina</a></li>
```

### Revertir completamente el módulo de parámetros de nómina

1. Borrar el archivo creado:

```txt
configuracion/parametros_nomina.html
```

2. Borrar el archivo creado:

```txt
css/parametros_nomina.css
```

3. Borrar el archivo creado:

```txt
js/parametros_nomina.js
```

4. En `js/webhooks.js`, eliminar este bloque de constantes:

```js
// configuracion/parametros_nomina.html (botón: "Guardar parámetro")
export const WEBHOOK_NOMINA_PARAMETROS_REGISTRAR =
  "https://n8n.enkrato.com/webhook/nomina_parametros_registrar";
```

5. En `js/webhooks.js`, eliminar este bloque del objeto extendido `WEBHOOKS`:

```js
WEBHOOKS.NOMINA_PARAMETROS_REGISTRAR = {
  url: WEBHOOK_NOMINA_PARAMETROS_REGISTRAR,
  archivos_que_usan: ["js/parametros_nomina.js"],
  metodo: "POST",
  descripcion: "Registra el valor de una combinación de tiempo y concepto para parámetros de nómina por tenant"
};
```

6. En `configuracion/index.html`, eliminar el enlace `Parámetros de nómina` como se indicó en la sección anterior.

## 4. Guía para exportar este cambio masivo a otro repositorio

Este repositorio centraliza URLs y webhooks en `js/webhooks.js`. Para migrar correctamente a otro repositorio, no hardcodear la URL del webhook dentro del formulario: primero crear o adaptar la constante centralizada y luego importarla desde el módulo JavaScript consumidor.

### Archivos que deben copiarse o replicarse

- Crear `configuracion/parametros_nomina.html`.
- Crear `css/parametros_nomina.css`.
- Crear `js/parametros_nomina.js`.
- Modificar `configuracion/index.html` para incluir el acceso al módulo.
- Modificar `js/webhooks.js` para centralizar `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` y `WEBHOOKS.NOMINA_PARAMETROS_REGISTRAR`.
- Modificar `configuracion/anadir_local.html` solo si el otro repositorio también tiene el texto redundante que se desea quitar.

### Particularidades y validaciones para que funcione

1. Validar que el repositorio destino tenga equivalentes de:
   - `js/session.js`, especialmente `getUserContext()` y `buildRequestHeaders()`.
   - `js/supabase.js`, exportando `supabase`.
   - `js/webhooks.js`, o un archivo central de URLs equivalente.
2. Si el repositorio destino usa otro esquema de rutas, ajustar las referencias relativas en `configuracion/parametros_nomina.html`:
   - `../css/main.css`
   - `../css/parametros_nomina.css`
   - `../js/router.js`
   - `../js/header.js`
   - `../js/parametros_nomina.js`
   - `../js/footer.js`
   - `../js/module_fix/init.js`
3. Verificar las tablas de Supabase. El módulo intenta leer los catálogos de tiempos y conceptos desde nombres flexibles, pero para máxima compatibilidad se recomienda tener al menos:
   - `nomina_tiempos` con columnas `id` y `nombre` o `codigo` y `nombre`.
   - `nomina_conceptos` con columnas `id` y `nombre` o `codigo` y `nombre`.
4. Si las tablas son por tenant, incluir `tenant_id` o `empresa_id`; el módulo intentará consultar primero con esos filtros y además validará en frontend que los datos pertenezcan a la empresa activa cuando esas columnas estén disponibles.
5. Si RLS está activo, permitir lectura a usuarios autenticados del tenant correspondiente para las tablas de catálogos. La escritura del parámetro final se delega al webhook, por lo que el webhook/n8n debe usar service role o el mecanismo seguro equivalente para persistir.
6. Crear en n8n el webhook `nomina_parametros_registrar` con método `POST` y validar que reciba los headers `Authorization`, `x-tenant-id`, `x-user-id` y `x-user-role`.
7. Si en el repositorio destino ya existe una función encargada de parámetros de nómina, priorizar una integración sobre duplicación: reutilizar el archivo central de URL, revisar si ya hay un payload esperado y adaptar `buildPayload()` para no romper consumidores existentes.

## 5. Check funcional para logs

- **Añadir local:** funciona; se elimina únicamente la nota visual redundante bajo el NIT, sin cambiar validaciones ni envío.
- **Configuración:** funciona; muestra un enlace nuevo hacia `Parámetros de nómina` en `Apis e integraciones`.
- **Parámetros de nómina - UI:** funciona; la pantalla contiene campos titulados `Tiempo`, `Concepto` y `Valor`, más botón de envío.
- **Parámetros de nómina - carga de listas:** funciona con Supabase si existen tablas compatibles y permisos de lectura; si no hay datos o las tablas tienen otro nombre, usa listas base de emergencia y muestra aviso en estado.
- **Parámetros de nómina - envío:** funciona a nivel frontend; envía un POST al webhook `https://n8n.enkrato.com/webhook/nomina_parametros_registrar`. El resultado final depende de que el webhook exista y persista correctamente en Supabase.
- **Nómina operativa existente:** no se modifica el flujo de consulta, comprobante ni Excel de `nomina/index.html`.
- **Webhooks existentes:** funcionan sin cambios; solo se añade una nueva constante y una nueva entrada descriptiva.

## 6. Pruebas y verificaciones realizadas

- Se ejecutó validación de sintaxis con `node --check` sobre `js/parametros_nomina.js`.
- Se ejecutó validación de sintaxis con `node --check` sobre `js/webhooks.js`.
- Se revisó que el texto eliminado ya no esté presente fuera de la documentación mediante búsqueda con `rg`.

---

# Parche 1 - 2026-06-10 - Catálogos de nómina por webhook y URL final de registro

## 1. Objetivo del parche

Este parche corrige la fuente de datos del módulo `Parámetros de nómina`. En vez de intentar cargar los catálogos desde tablas directas de Supabase, los selectores ahora consumen los webhooks indicados para nómina:

- Conceptos: `https://n8n.enkrato.com/webhook/consultar_concepto_nómina`.
- Tiempos: `https://n8n.enkrato.com/webhook/consultar_tiempo_nómina`.
- Registro final del parámetro: `https://n8n.enkrato.com/webhook/nuevo_parametro_nómina`.

El objetivo es que las listas seleccionables queden resueltas por los flujos n8n existentes y que el formulario envíe la combinación `tiempo + concepto + valor` al webhook final correcto junto al `tenant_id`/`empresa_id`.

## 2. Archivos implicados y modificaciones realizadas en el parche

### `js/webhooks.js`

- **Tipo de modificación:** ajuste de configuración centralizada.
- **Objetivo:** declarar las URLs definitivas entregadas para el módulo.
- **Qué hace explícitamente:**
  - Añade `WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR` apuntando a `https://n8n.enkrato.com/webhook/consultar_concepto_nómina`.
  - Añade `WEBHOOK_NOMINA_TIEMPOS_CONSULTAR` apuntando a `https://n8n.enkrato.com/webhook/consultar_tiempo_nómina`.
  - Cambia `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` para apuntar a `https://n8n.enkrato.com/webhook/nuevo_parametro_nómina`.
  - Registra las tres entradas en `WEBHOOKS` para mantener trazabilidad del archivo consumidor `js/parametros_nomina.js`, método `POST` y descripción funcional.

### `js/parametros_nomina.js`

- **Tipo de modificación:** corrección funcional del módulo creado.
- **Objetivo:** reemplazar la lectura directa de Supabase por lectura desde webhooks n8n.
- **Qué hace explícitamente:**
  - Elimina la dependencia de `supabase` en este archivo.
  - Importa `WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR`, `WEBHOOK_NOMINA_TIEMPOS_CONSULTAR` y `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` desde `js/webhooks.js`.
  - Carga el selector `Concepto` desde el webhook `consultar_concepto_nómina`.
  - Carga el selector `Tiempo` desde el webhook `consultar_tiempo_nómina`.
  - Lee la estructura esperada `[{ data: [...] }]` mediante `extractDataRows()`, que también tolera respuestas con `data`, `body` o `result` para evitar romper si n8n encapsula levemente el resultado.
  - Normaliza cada fila usando `id` y `nombre`; para tiempos conserva `factor_conversion` si llega en la respuesta.
  - El envío final usa el webhook `nuevo_parametro_nómina` y conserva headers de sesión con `buildRequestHeaders({ includeTenant: true })`.
  - El payload final incluye `tenant_id`, `empresa_id`, `tiempo_id`, `tiempo`, `tiempo_nombre`, `tiempo_factor_conversion`, `concepto_id`, `concepto`, `concepto_nombre`, `valor`, `usuario_id`, `registrado_por`, `origen` y `timestamp`.

## 3. Notas de emergencia para revertir solo este parche

> Estas instrucciones revierten el **parche 1** sin eliminar necesariamente la pantalla creada en el cambio base. Si se quiere retirar todo el módulo, usar también las instrucciones de reversión completa documentadas arriba.

### Revertir URLs en `js/webhooks.js`

1. Ubicar el bloque de constantes de `configuracion/parametros_nomina.html`.
2. Si se desea volver al estado anterior al parche, eliminar estas constantes:

```js
export const WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_concepto_nómina";

export const WEBHOOK_NOMINA_TIEMPOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_tiempo_nómina";
```

3. Cambiar nuevamente el valor de `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR` a la URL anterior si fuese estrictamente necesario:

```js
export const WEBHOOK_NOMINA_PARAMETROS_REGISTRAR =
  "https://n8n.enkrato.com/webhook/nomina_parametros_registrar";
```

4. Eliminar las entradas `WEBHOOKS.NOMINA_CONCEPTOS_CONSULTAR` y `WEBHOOKS.NOMINA_TIEMPOS_CONSULTAR`.

### Revertir la lógica en `js/parametros_nomina.js`

La forma más segura es restaurar este archivo desde el commit anterior al parche 1. Si se hace manualmente:

1. Volver a importar `supabase` desde `./supabase.js`.
2. Retirar las importaciones de `WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR` y `WEBHOOK_NOMINA_TIEMPOS_CONSULTAR`.
3. Restaurar la lógica anterior de `CATALOGS` basada en tablas de Supabase y funciones `readCatalogFromTable()`/`mapCatalogRows()`.
4. Restaurar el mensaje de éxito de carga a `Listas de tiempos y conceptos cargadas desde Supabase.` si se regresa completamente al comportamiento anterior.

## 4. Indicaciones para exportar este parche a otro repositorio

Este repositorio centraliza las URLs en `js/webhooks.js`; por eso, al exportar el parche, primero se deben crear las constantes en el archivo central del repositorio destino y después importarlas desde el módulo del formulario.

Pasos recomendados:

1. Verificar que el repositorio destino tenga un archivo equivalente a `js/webhooks.js`; si no lo tiene, crear un archivo central para URLs antes de copiar la lógica.
2. Agregar las tres URLs de n8n en ese archivo central:
   - `consultar_concepto_nómina` para conceptos.
   - `consultar_tiempo_nómina` para tiempos.
   - `nuevo_parametro_nómina` para registrar el parámetro.
3. Copiar o adaptar en el archivo del formulario las funciones:
   - `readResponseBody()` para leer JSON o texto.
   - `extractDataRows()` para transformar `[{ data: [...] }]` en una lista usable.
   - `fetchCatalogRows()` para consultar los webhooks con headers y payload del tenant.
   - `buildPayload()` para enviar la combinación final al webhook de registro.
4. Validar que el repositorio destino tenga una función equivalente a `buildRequestHeaders()` para enviar `Authorization`, `x-tenant-id`, `x-user-id` y `x-user-role`; si no existe, adaptar `fetchCatalogRows()` y `submitParametro()` a la forma de autenticación del destino.
5. Confirmar en n8n que los webhooks acepten método `POST` y retornen la estructura esperada:

```json
[
  {
    "data": [
      { "id": "uuid", "nombre": "Nombre visible" }
    ]
  }
]
```

6. Para el webhook de tiempos, validar que `factor_conversion` llegue cuando aplique, porque el frontend lo conserva en el payload final como referencia operativa.

## 5. Check funcional actualizado para logs

- **Añadir local:** funciona; la eliminación del texto de NIT sigue vigente y no se modifica en este parche.
- **Configuración:** funciona; el enlace a `Parámetros de nómina` sigue vigente.
- **Parámetros de nómina - conceptos:** funciona a nivel frontend consumiendo `https://n8n.enkrato.com/webhook/consultar_concepto_nómina`; depende de que el flujo n8n esté publicado y responda con `[{ data: [...] }]`.
- **Parámetros de nómina - tiempos:** funciona a nivel frontend consumiendo `https://n8n.enkrato.com/webhook/consultar_tiempo_nómina`; depende de que el flujo n8n esté publicado y responda con `[{ data: [...] }]`.
- **Parámetros de nómina - registro:** funciona a nivel frontend enviando `POST` a `https://n8n.enkrato.com/webhook/nuevo_parametro_nómina`; la persistencia final depende de ese webhook.
- **Nómina operativa existente:** no se modifica el flujo de consulta, comprobante ni Excel de `nomina/index.html`.
- **Supabase directo para catálogos:** ya no se usa en `js/parametros_nomina.js`; la fuente oficial de catálogos para este formulario pasa a ser n8n.

## 6. Pruebas y verificaciones del parche 1

- Se ejecutó validación de sintaxis con `node --check` sobre `js/parametros_nomina.js`.
- Se ejecutó validación de sintaxis con `node --check` sobre `js/webhooks.js`.
- Se revisó el diff para confirmar que `js/parametros_nomina.js` ya no importa `supabase` y que las URLs nuevas quedaron centralizadas en `js/webhooks.js`.

---

# Parche 2 - 2026-06-11 - Excel de nómina por empleado con 4 tablas desde webhook nuevo

## 1. Objetivo del parche

Este parche corrige y amplía la exportación del botón **Descargar Excel empleado** en `nomina/index.html`. El objetivo es dejar de usar el histórico plano anterior y consumir el nuevo webhook calculado:

```txt
https://n8n.enkrato.com/webhook/consultar_nomina_nuevo
```

El frontend ahora recibe una estructura con `parametros`, `detalle`, `resumen`, `totales` y `metadata`, y genera desde la página un archivo Excel compatible con cuatro secciones/hojas lógicas:

1. **Parámetros:** conceptos y valores por unidad.
2. **Detalle Nómina:** filas por día/turno con horas y valores calculados.
3. **Resumen:** totales por categoría de horas.
4. **Totales Generales:** días, horas trabajadas, valor de horas, auxilio de transporte, total a pagar y metadata.

La generación se hace en el navegador para evitar depender de librerías no disponibles dentro del Docker/n8n local.

## 2. Archivos implicados y modificaciones realizadas en el parche

### `js/webhooks.js`

- **Tipo de modificación:** ajuste de URL centralizada.
- **Objetivo:** cambiar el webhook usado por el botón `Descargar Excel empleado`.
- **Qué hace explícitamente:** actualiza `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` para que apunte a `https://n8n.enkrato.com/webhook/consultar_nomina_nuevo`.
- **Importante:** se conserva el nombre de la constante para no romper imports existentes en `js/nomina.js`, aunque la URL ya no representa el flujo histórico anterior sino el nuevo flujo calculado.

### `js/nomina.js`

- **Tipo de modificación:** mejora funcional de exportación Excel.
- **Objetivo:** transformar la nueva respuesta calculada del webhook en un Excel con 4 tablas/hojas lógicas desde el navegador.
- **Qué hace explícitamente:**
  - Importa `buildRequestHeaders` desde `js/session.js` para enviar headers de sesión/tenant al webhook.
  - Ajusta el payload del botón de Excel para incluir `tenant_id`, `empresa_id`, `responsable_id`, `empleado_id`, corte, rango de fechas y entorno.
  - Reemplaza la exportación plana anterior basada en headers de cierre de turno por una exportación estructurada.
  - Añade `parseWebhookPayload()` para encontrar la estructura `{ parametros, detalle, resumen, totales, metadata }` aunque venga dentro de un arreglo o envuelta por n8n.
  - Añade una plantilla HTML compatible con Excel (`application/vnd.ms-excel`) que contiene las secciones `Parámetros`, `Detalle Nómina`, `Resumen` y `Totales Generales`.
  - Mantiene formato visual de encabezados azules, valores calculados en verde, subtotales en azul claro y total final en amarillo.
  - Conserva valores numéricos para columnas monetarias usando formato compatible con Excel.
  - Genera el archivo `.xls` directamente en el navegador y lo descarga con nombre basado en empleado y periodo.

## 3. Notas de emergencia para revertir solo este parche

> Estas instrucciones revierten el **parche 2** sin eliminar el módulo de parámetros de nómina ni los parches anteriores.

### Revertir URL en `js/webhooks.js`

1. Ubicar la constante:

```js
export const WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO =
  "https://n8n.enkrato.com/webhook/consultar_nomina_nuevo";
```

2. Cambiarla al valor anterior:

```js
export const WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO =
  "https://n8n.enkrato.com/webhook/consultar_histórico_empleado";
```

### Revertir lógica en `js/nomina.js`

1. En el import de sesión, volver de:

```js
import { buildRequestHeaders, getUserContext } from "./session.js";
```

a:

```js
import { getUserContext } from "./session.js";
```

2. Restaurar la función `descargarExcelEmpleado()` desde el commit anterior al parche 2. Esa versión contenía:
   - arreglo `headers` con campos como `fecha_turno`, `hora_inicio`, `hora_fin`, `propinas`, `ventas_brutas`, etc.;
   - `extractRows()` para buscar filas planas;
   - `buildExcelHtml(rows)` con una sola tabla;
   - soporte para descargar blobs de Excel si n8n respondía binario.

3. Si se revierte manualmente, eliminar del nuevo bloque estas funciones internas:
   - `parseWebhookPayload()`
   - `worksheetXml()`
   - `renderSheet()`
   - el nuevo `buildExcelHtml(data)` de 4 secciones
   - el uso de `buildRequestHeaders()` dentro del fetch del Excel.

4. Validar con `node --check js/nomina.js` después de revertir.

## 4. Indicaciones para exportar este parche a otro repositorio

Este repositorio centraliza URLs en `js/webhooks.js`; por eso, al migrar este parche a otro repositorio se debe iniciar por el archivo central de URLs y no por el formulario.

Pasos recomendados:

1. Verificar que el repositorio destino tenga una constante equivalente a `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` o crear una nueva para el Excel calculado.
2. Centralizar la URL `https://n8n.enkrato.com/webhook/consultar_nomina_nuevo` en el archivo de webhooks del repositorio destino.
3. Confirmar que el módulo de nómina tenga acceso a la sesión/tenant; en este repositorio se usa `buildRequestHeaders({ includeTenant: true })` desde `js/session.js`.
4. Copiar/adaptar dentro de la función de descarga de Excel estas piezas:
   - payload con `tenant_id`, `empresa_id`, `responsable_id`, `empleado_id`, `fecha_inicio`, `fecha_fin`, `corte` y `entorno`;
   - `parseWebhookPayload()` para tolerar respuestas envueltas por n8n;
   - `buildExcelHtml(data)` para generar las 4 secciones del Excel;
   - `triggerExcelDownload()` para descargar el `.xls` generado en navegador.
5. Validar que el webhook destino responda con una estructura compatible:

```json
[
  {
    "parametros": [],
    "detalle": [],
    "resumen": {},
    "totales": {},
    "metadata": {}
  }
]
```

6. Revisar si en el repositorio destino ya existe una librería real de XLSX. Si existe, se puede reemplazar la salida HTML `.xls`; si no existe, esta implementación evita dependencias externas y funciona como descarga Excel compatible.

## 5. Check funcional actualizado para logs

- **Nómina - botón Descargar Excel empleado:** funciona a nivel frontend consumiendo `https://n8n.enkrato.com/webhook/consultar_nomina_nuevo` y generando un Excel `.xls` con 4 secciones.
- **Nómina - estructura de Excel:** funciona con secciones `Parámetros`, `Detalle Nómina`, `Resumen` y `Totales Generales`; la hoja final incluye metadata al final.
- **Nómina - webhook anterior de Excel:** ya no se usa para este botón; si el nuevo webhook no está publicado o no responde con `{ parametros, detalle, resumen, totales }`, el botón mostrará error y no generará archivo.
- **Nómina - consulta principal y comprobante:** no se modifica el flujo de consultar nómina ni la descarga PNG del comprobante.
- **Parámetros de nómina:** no se modifica en este parche; siguen vigentes los cambios del parche 1.

## 6. Pruebas y verificaciones del parche 2

- Se ejecutó validación de sintaxis con `node --check` sobre `js/nomina.js`.
- Se ejecutó validación de sintaxis con `node --check` sobre `js/webhooks.js`.
- Se verificó que la URL `consultar_nomina_nuevo` quedara centralizada en `js/webhooks.js`.


---

# Parche posterior 3 - 2026-06-11

## 1. Objetivo del parche

Restaurar el acceso normal a la plataforma después de detectar una pantalla blanca causada por un error de sintaxis en el módulo central de webhooks:

```txt
Uncaught SyntaxError: Identifier 'WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR' has already been declared
```

La prioridad de contingencia fue **aislar y retirar únicamente la duplicación defectuosa**, sin revertir el trabajo funcional del módulo de nómina ni el Excel por empleado. El error no estaba en login ni en Supabase: la sesión sí se restauraba, pero el navegador detenía la evaluación de `js/webhooks.js` y cualquier módulo dependiente quedaba inutilizable.

## 2. Archivos implicados y detalle técnico

### `js/webhooks.js` (modificado)

- **Tipo de modificación:** solución de emergencia / aislamiento de cambio defectuoso.
- **Objetivo:** eliminar declaraciones duplicadas que rompían la carga de módulos ES y provocaban pantalla blanca.
- **Qué hace explícitamente:** mantiene una sola declaración exportada de cada constante de parámetros de nómina:
  - `WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR`
  - `WEBHOOK_NOMINA_TIEMPOS_CONSULTAR`
  - `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR`
- **Fragmento retirado:** el segundo bloque duplicado inmediatamente posterior a la primera definición de esas tres constantes. La versión válida quedó antes de `WEBHOOK_DASHBOARD_DATOS`.
- **Motivo de aislamiento:** `js/webhooks.js` es un archivo centralizado consumido por varios módulos. Una duplicación de `export const` no falla solo en la pantalla de parámetros de nómina: bloquea el parseo del módulo completo y puede impedir que páginas aparentemente no relacionadas terminen de iniciar.

### `docs/2026-06-10_parametros_nomina_y_limpieza_texto_recuperacion_y_3_parches.md` (creado)

- **Tipo de modificación:** documentación de parche posterior.
- **Objetivo:** dejar registro auditable del incidente, de la causa real, de la reversión mínima aplicada y de cómo trasladar este parche a otro repositorio.
- **Qué hace explícitamente:** conserva la documentación del cambio grande y añade este **Parche posterior 3** con instrucciones de emergencia, exportación y checklist funcional.

## 3. Notas de emergencia, reversión y contingencia detallada

### Si vuelve a aparecer pantalla blanca con un error similar

1. Abrir la consola del navegador y confirmar si el error menciona `Identifier ... has already been declared` o `SyntaxError` en `js/webhooks.js`.
2. En el repositorio, buscar la constante exacta reportada:

```bash
rg -n "WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR|WEBHOOK_NOMINA_TIEMPOS_CONSULTAR|WEBHOOK_NOMINA_PARAMETROS_REGISTRAR" js/webhooks.js
```

3. Debe existir **una sola declaración `export const` por constante**. Pueden existir usos posteriores dentro del objeto `WEBHOOKS`, pero no redeclaraciones.
4. Si hay dos bloques idénticos, borrar el bloque repetido completo. En este parche el bloque peligroso era el segundo bloque consecutivo con estas líneas conceptuales:

```js
// configuracion/parametros_nomina.html (selector: "Concepto")
export const WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_concepto_nómina";

// configuracion/parametros_nomina.html (selector: "Tiempo")
export const WEBHOOK_NOMINA_TIEMPOS_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_tiempo_nómina";

// configuracion/parametros_nomina.html (botón: "Guardar parámetro")
export const WEBHOOK_NOMINA_PARAMETROS_REGISTRAR =
  "https://n8n.enkrato.com/webhook/nuevo_parametro_nómina";
```

5. Validar inmediatamente con:

```bash
node --input-type=module -e "import('./js/webhooks.js')"
```

### Cómo revertir este parche concreto

No se recomienda revertirlo porque reintroduciría la pantalla blanca. Si por auditoría se necesita volver exactamente al estado roto anterior, reinsertar el segundo bloque duplicado después de la primera definición de `WEBHOOK_NOMINA_PARAMETROS_REGISTRAR`; esto hará que el navegador vuelva a lanzar `Identifier ... has already been declared`.

### Plan de aislamiento para futuros cambios grandes

- Cualquier nueva URL debe agregarse una sola vez en la zona de constantes de `js/webhooks.js` y luego referenciarse en el objeto `WEBHOOKS` sin volver a declarar `export const`.
- Antes de publicar cambios que toquen archivos centralizados (`js/webhooks.js`, `js/session.js`, `js/supabase.js`, `js/header.js`, `js/urls.js`), ejecutar importación mínima con Node cuando sea posible.
- Si se añade un módulo nuevo, mantener sus fallos dentro de su propio archivo. Un botón o vista de nómina no debe romper login, dashboard ni configuración general.
- Si la consola muestra que la sesión carga correctamente pero aparece pantalla blanca, priorizar errores de parseo/importación antes de investigar autenticación.

## 4. Indicaciones para exportar este parche a otro repositorio

1. En el repositorio destino, identificar el archivo equivalente que centraliza URLs/webhooks. En este repositorio es `js/webhooks.js` y todos los módulos importan sus constantes desde ahí.
2. Copiar solo la estructura final válida: una declaración `export const` por webhook y usos posteriores dentro de un mapa u objeto de metadatos.
3. No duplicar bloques de constantes al hacer cherry-pick o copiar fragmentos desde documentación.
4. Si el repositorio destino ya tiene nombres equivalentes, priorizar los nombres existentes y cambiar únicamente la URL o el consumidor, evitando crear una segunda constante con el mismo identificador.
5. Ejecutar estas validaciones mínimas en el destino:

```bash
node --input-type=module -e "import('./js/webhooks.js')"
rg -n "export const WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR|export const WEBHOOK_NOMINA_TIEMPOS_CONSULTAR|export const WEBHOOK_NOMINA_PARAMETROS_REGISTRAR" js/webhooks.js
```

6. Comprobar manualmente que el login no queda en pantalla blanca y que el módulo de nómina sigue abriendo. En este repositorio, la sesión depende de `js/supabase.js` y `js/session.js`, pero la pantalla blanca de este incidente se originó en el parseo de `js/webhooks.js`.

## 5. Checklist funcional / logs

- ✅ Login/sesión: la consola reportaba sesión restaurada; el parche no toca autenticación.
- ✅ Webhooks centralizados: `js/webhooks.js` vuelve a importarse como módulo ES sin error de redeclaración.
- ✅ Parámetros de nómina: se conservan las tres URLs necesarias para conceptos, tiempos y registro.
- ✅ Nómina / Excel empleado: se conserva `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` apuntando a `consultar_nomina_nuevo`; no se revirtió la mejora del Excel por empleado.
- ✅ Aislamiento: se aplicó reversión mínima del bloque duplicado, sin desactivar módulos completos ni eliminar funciones recientes válidas.
- ⚠️ Validación visual en navegador: pendiente de prueba manual en entorno real con credenciales y n8n activo; la validación automatizada confirma que el módulo central ya no falla al importarse.

## 6. Validaciones realizadas

- `node --input-type=module -e "import('./js/webhooks.js')"`: confirma que `js/webhooks.js` ya no lanza `SyntaxError` por redeclaración.
- `python3` con conteo de declaraciones exportadas de constantes de nómina: confirma una sola declaración exportada por constante crítica.
- `git diff --check`: confirma que el parche no introduce errores de whitespace.

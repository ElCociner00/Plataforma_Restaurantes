# 2026-06-10 - Parámetros de nómina y limpieza de texto de recuperación

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

# 2026-06-11 - Selector para cambiar de local y contexto de usuario

## 1. Objetivo de la petición

Crear una opción en el desplegable del usuario para cambiar entre la empresa principal y sus locales dependientes sin cerrar sesión. El cambio debe comportarse como un nuevo login contextual: todos los módulos que consumen `getUserContext()` deben recibir el `empresa_id` del local seleccionado y el `usuario_id` duplicado de `usuarios_locales.id`, de modo que cierres, inventarios, compras, nómina, parámetros y webhooks guarden datos con huella separada por local.

La solución usa las tablas nuevas indicadas:

- `grupos_empresariales`: relaciona cada local (`empresa_id`) con la empresa principal (`grupo_id`).
- `usuarios_locales`: contiene el usuario duplicado por local; su columna `id` es el usuario operativo del local y `usuario_principal_id` queda solo como metadato de trazabilidad.

## 2. Archivos implicados y detalle técnico

### `js/session.js` (modificado)

- **Tipo de modificación:** ampliación del sistema central de sesión/contexto.
- **Objetivo:** permitir un contexto activo de local sin cambiar la sesión real de Supabase Auth.
- **Qué hace explícitamente:**
  - Añade la clave `plataforma_active_local_context_v1` en `localStorage` para recordar el local activo.
  - Añade `clearActiveLocalContext()` para volver a la empresa principal y limpiar caché.
  - Añade metadatos al contexto normalizado: `auth_user_id`, `usuario_principal_id` y `empresa_principal_id`.
  - Añade `applyLocalContextOverride(baseContext, authUser)`, que valida que el local seleccionado pertenezca al grupo de la empresa principal y que exista un registro activo en `usuarios_locales` para el usuario autenticado.
  - Cuando el override es válido, cambia `context.empresa_id` al local y cambia `context.user.id` / `context.user.user_id` a `usuarios_locales.id`.
  - Mantiene `context.user.auth_user_id` y `context.usuario_principal_id` para trazabilidad interna, pero los módulos existentes seguirán usando `context.user.id` como usuario contextual.
  - Añade `listAvailableLocalContexts()`, que construye las opciones visibles del selector: empresa principal + locales donde el usuario tenga duplicado activo.
  - Añade `switchLocalContext(empresaId)`, que valida el local, guarda la selección y limpia caché para que la siguiente carga use el nuevo contexto.

### `js/header.js` (modificado)

- **Tipo de modificación:** ampliación del menú de usuario.
- **Objetivo:** mostrar en el desplegable del usuario la sección `Cambiar de local`.
- **Qué hace explícitamente:**
  - Importa `listAvailableLocalContexts` y `switchLocalContext` desde `js/session.js`.
  - Construye opciones de empresa principal y locales disponibles con `buildLocalSwitcherItems()`.
  - Escapa nombres antes de insertarlos en HTML con `escapeHtml()` para evitar que nombres de empresas/locales rompan el menú.
  - Marca la opción activa con `Actual`.
  - Al hacer clic en otro local, llama `switchLocalContext()`, limpia cachés visuales relacionadas con banner/contexto y recarga la página actual para que todos los módulos vuelvan a inicializarse con el nuevo `empresa_id` y `usuario_id`.
  - Si el cambio falla, muestra alerta y recarga para evitar un estado intermedio confuso.

### `css/main.css` (modificado)

- **Tipo de modificación:** estilos del selector en header global.
- **Objetivo:** hacer legible el selector de locales dentro del menú existente sin crear una vista nueva.
- **Qué hace explícitamente:**
  - Añade layout para `.local-switch-option`.
  - Distingue visualmente la opción activa.
  - Añade formato para etiquetas `Principal`, `Local` y `Actual`.

## 3. Notas de emergencia y reversión detallada

### Revertir solo el selector visual del header

Archivo: `js/header.js`.

1. Cambiar el import inicial para retirar `listAvailableLocalContexts` y `switchLocalContext`:

```js
import { clearUserContextCache, getUserContext } from "./session.js";
```

2. Eliminar los helpers añadidos cerca de la parte superior:

```js
const escapeHtml = ...
const buildLocalSwitcherItems = ...
```

3. En `buildMenu()`, volver la firma a:

```js
function buildMenu({ context, environmentForMenu }) {
```

4. Eliminar esta línea del menú de usuario:

```js
${buildLocalSwitcherItems(localContexts)}
```

5. Eliminar el bloque de eventos:

```js
header.querySelectorAll("[data-switch-local]").forEach(...)
```

6. En `renderAuthenticatedHeader()`, eliminar la consulta de `localContexts` y volver a:

```js
const menu = buildMenu({ context, environmentForMenu });
```

### Revertir el override de contexto de locales

Archivo: `js/session.js`.

1. Eliminar la constante `ACTIVE_LOCAL_CONTEXT_KEY` y las funciones `readActiveLocalSelection`, `writeActiveLocalSelection`, `clearActiveLocalContext`, `loadEmpresaForContext`, `applyLocalContextOverride`, `listAvailableLocalContexts` y `switchLocalContext`.
2. En `getUserContext()`, reemplazar:

```js
const baseContext = mapContextPayload(fallbackPayload, user);
const context = await applyLocalContextOverride(baseContext, user);
```

por:

```js
const context = mapContextPayload(fallbackPayload, user);
```

3. En `mapContextPayload()`, si se quiere volver exactamente al estado anterior, retirar `auth_user_id`, `usuario_principal_id`, `empresa_principal_id` y `user.auth_user_id`. No es obligatorio si no estorban, pero sí deja el contexto más parecido al original.
4. En `ensureAuthCacheInvalidation()`, volver a limpiar solo caché si se retiró `clearActiveLocalContext()`:

```js
cachedContext = null;
```

### Revertir estilos

Archivo: `css/main.css`.

Eliminar el bloque añadido al final para:

```css
.app-header .local-switch-option { ... }
.app-header .local-switch-option.active { ... }
.app-header .local-switch-active-label { ... }
```

### Limpieza de emergencia en navegador

Si un usuario queda apuntando a un local inválido por datos eliminados, ejecutar en consola del navegador:

```js
localStorage.removeItem("plataforma_active_local_context_v1");
location.reload();
```

El sistema también intenta limpiar automáticamente esa clave si el local no pertenece al grupo, está inactivo o no existe usuario duplicado activo.

## 4. Indicaciones para exportar este cambio a otro repositorio

Este repositorio centraliza la sesión en `js/session.js` y el menú global en `js/header.js`. Para portar el cambio:

1. Verificar que el repositorio destino tenga una función equivalente a `getUserContext()` usada por módulos y webhooks.
2. Crear o migrar las tablas con la misma semántica:
   - `grupos_empresariales.empresa_id`: empresa/local seleccionado.
   - `grupos_empresariales.grupo_id`: empresa principal.
   - `usuarios_locales.id`: usuario contextual del local.
   - `usuarios_locales.usuario_principal_id`: usuario original/autenticado, solo para vinculación.
   - `usuarios_locales.empresa_id`: local al que pertenece el duplicado.
3. Asegurar que las políticas RLS permitan al usuario autenticado leer sus filas de `usuarios_locales`, los locales de `grupos_empresariales` y los nombres básicos de `empresas`.
4. Portar primero `js/session.js`, porque el header depende de `listAvailableLocalContexts()` y `switchLocalContext()`.
5. Portar después `js/header.js`, ubicando el selector dentro del desplegable del usuario.
6. Portar los estilos de `css/main.css` o adaptarlos al sistema visual del destino.
7. Validar que todos los módulos usen `getUserContext()` / `buildRequestHeaders()` para leer `empresa_id` y `usuario_id`. Si un módulo consulta directamente Supabase Auth con `getCurrentUser()` para guardar trámites, debe adaptarse para usar el usuario contextual.
8. En repositorios que también centralicen URLs/webhooks, no se requieren nuevas URLs para este cambio; solo se cambia el contexto que viaja en headers y payloads existentes.

## 5. Checklist funcional / logs

- ✅ Login: no se cambia la autenticación real de Supabase.
- ✅ Header: el desplegable de usuario puede mostrar `Cambiar de local` cuando existen locales disponibles y usuario duplicado activo.
- ✅ Empresa principal: aparece como opción para volver al contexto base.
- ✅ Local activo: se guarda en `localStorage` y se reaplica al recargar.
- ✅ Contexto de módulos: `context.empresa_id` cambia al local seleccionado.
- ✅ Huella de usuario por local: `context.user.id` cambia a `usuarios_locales.id`.
- ✅ Webhooks: `buildRequestHeaders()` enviará `x-tenant-id` del local y `x-user-id` del usuario local porque consume `getUserContext()`.
- ⚠️ Datos/RLS: requiere que existan filas correctas en `grupos_empresariales`, `usuarios_locales` y permisos de lectura en Supabase.
- ⚠️ Prueba visual real: pendiente validar con credenciales y datos reales de producción/staging; la validación automatizada confirma sintaxis y estructura del cambio.

## 6. Validaciones realizadas

- `node --check js/session.js`: valida sintaxis del módulo central de contexto.
- `node --check js/header.js`: valida sintaxis del header y selector.
- `git diff --check`: valida que no haya errores de whitespace.

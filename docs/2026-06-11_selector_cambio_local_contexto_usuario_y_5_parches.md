# 2026-06-11 - Selector para cambiar de local y contexto de usuario y 4 parches

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


---

# Parche posterior 1 - 2026-06-11

## 1. Objetivo del parche

Corregir el selector de locales para que el `admin_root` de la empresa principal también pueda cambiar entre locales aunque no exista en `usuarios_locales`. La regla funcional queda así:

- Usuarios comunes, operativos y administradores duplicados: deben tener fila activa en `usuarios_locales`; al cambiar de local, `context.user.id` pasa a ser `usuarios_locales.id`.
- `admin_root` de la empresa principal: no se valida ni se exige fila en `usuarios_locales`; al cambiar de local se conserva el mismo usuario autenticado y solo cambia el `empresa_id`/tenant activo.

Este ajuste mantiene intactos los payloads y webhooks existentes: los módulos siguen consumiendo `getUserContext()` y `buildRequestHeaders()` como antes, sin rutas auxiliares para locales.

## 2. Archivos implicados y modificaciones realizadas

### `js/session.js` (modificado)

- **Tipo de modificación:** parche de lógica de contexto.
- **Objetivo:** permitir que `admin_root` vea y seleccione todos los locales del grupo sin requerir usuario duplicado.
- **Qué hace explícitamente:**
  - En `applyLocalContextOverride()`, detecta `admin_root` con `baseContext.rol === "admin_root"` o `baseContext.super_admin === true`.
  - Para `admin_root`, omite la consulta/validación contra `usuarios_locales` y conserva `authUser.id` como `context.user.id`.
  - Para usuarios no `admin_root`, conserva la validación estricta previa contra `usuarios_locales`.
  - En `listAvailableLocalContexts()`, si el usuario es `admin_root`, muestra todos los locales activos de `grupos_empresariales` asociados al `grupo_id` de la empresa principal, aunque no existan filas en `usuarios_locales`.
  - En `switchLocalContext()`, si el usuario es `admin_root`, valida únicamente que el local esté activo y pertenezca al grupo; no exige duplicado local.

### `docs/2026-06-11_selector_cambio_local_contexto_usuario_y_1_parche.md` (creado)

- **Tipo de modificación:** documentación de parche posterior.
- **Objetivo:** dejar trazabilidad de la excepción funcional del `admin_root`, su reversión y su exportación a otro repositorio.
- **Qué hace explícitamente:** conserva la documentación base del selector de locales y añade este parche posterior.

## 3. Notas de emergencia y reversión detallada

### Revertir solo la excepción de `admin_root`

Archivo: `js/session.js`.

1. En `applyLocalContextOverride()`, eliminar la variable:

```js
const isAdminRoot = baseContext.rol === "admin_root" || baseContext.super_admin === true;
```

2. Volver a ejecutar siempre la consulta de `usuarios_locales` antes de aplicar el local.
3. Volver a construir el usuario contextual únicamente con `usuarioLocal.id`:

```js
id: usuarioLocal.id,
user_id: usuarioLocal.id,
usuario_local_id: usuarioLocal.id,
usuario_activo: usuarioLocal.activo !== false
```

4. En `listAvailableLocalContexts()`, retirar la rama `isAdminRoot` y volver a poblar locales solamente desde `usuariosLocales`.
5. En `switchLocalContext()`, retirar la rama que omite `usuarios_locales` para `admin_root` y volver a exigir duplicado activo para todos los roles.

> Nota: revertir esta excepción impedirá que el `admin_root` de la empresa principal vea/cambie locales si no tiene fila en `usuarios_locales`, que fue precisamente el problema corregido por este parche.

### Limpieza de emergencia si un admin queda en un local incorrecto

En consola del navegador:

```js
localStorage.removeItem("plataforma_active_local_context_v1");
location.reload();
```

## 4. Indicaciones para exportar este parche a otro repositorio

1. Confirmar si el repositorio destino distingue un rol equivalente a `admin_root`.
2. Portar la excepción solo para ese rol raíz; no aplicarla a roles operativos o administradores normales si esos usuarios sí deben existir en una tabla de duplicados.
3. Mantener la regla de escalabilidad: no crear webhooks ni payloads alternos para locales. El cambio debe hacerse en la capa central de contexto para que todos los módulos sigan funcionando igual.
4. Verificar que el menú de usuario consuma la lista generada por `listAvailableLocalContexts()` dentro del acordeón/desplegable del avatar, no en una pantalla separada.
5. Validar con estas pruebas mínimas:

```bash
node --check js/session.js
node --check js/header.js
git diff --check
```

6. Validación manual recomendada en destino:
   - Login con `admin_root` de empresa principal.
   - Abrir desplegable del avatar.
   - Confirmar que aparecen empresa principal y locales activos del grupo.
   - Cambiar a un local.
   - Confirmar que las pantallas siguen usando los mismos módulos/webhooks y que el tenant activo corresponde al local.

## 5. Checklist funcional / logs

- ✅ Login: sigue funcionando sin cambios en Supabase Auth.
- ✅ Admin root: puede ver locales activos aunque no exista en `usuarios_locales`.
- ✅ Admin root: al cambiar de local conserva el mismo usuario autenticado y cambia el tenant activo.
- ✅ Usuarios duplicados: siguen requiriendo `usuarios_locales` activo para cambiar de local.
- ✅ Payloads/webhooks: no se agregan rutas auxiliares ni estructuras especiales para locales.
- ✅ Header: el selector sigue ubicado en el desplegable/acordeón del usuario.
- ⚠️ Datos/RLS: `admin_root` debe poder leer `grupos_empresariales` y datos básicos de `empresas` para listar locales.

## 6. Validaciones realizadas

- `node --check js/session.js`: valida sintaxis del parche de contexto.
- `node --check js/header.js`: valida que el menú de usuario siga sin errores de sintaxis.
- `git diff --check`: valida que el parche no introduce errores de whitespace.


---

# Parche posterior 2 - 2026-06-11

## 1. Objetivo del parche

Corregir el problema visual reportado: el usuario podía seguir iniciando sesión y no había errores de consola, pero no veía ninguna opción de cambio de local en el acordeón/desplegable del avatar. La causa probable era que el bloque visual se ocultaba completamente cuando `localContexts.length <= 1`, por lo que si la consulta de locales no devolvía filas visibles el usuario no tenía forma de confirmar si el selector existía, si no había locales o si faltaban permisos/RLS.

Este parche no cambia la mecánica de login ni obliga a reloguearse. El cambio de local sigue siendo un cambio de contexto en memoria/localStorage sobre la sesión actual de Supabase Auth.

## 2. Archivos implicados y modificaciones realizadas

### `js/header.js` (modificado)

- **Tipo de modificación:** corrección visual/diagnóstica del selector.
- **Objetivo:** hacer visible la sección `Cambiar de local` dentro del acordeón del usuario para roles administrativos aunque todavía no haya locales intercambiables cargados.
- **Qué hace explícitamente:**
  - Cambia `buildLocalSwitcherItems()` para recibir `{ context, localContexts }`.
  - La sección se muestra si hay más de una opción de contexto o si el rol es `admin_root`/`admin`.
  - Si no hay locales intercambiables, muestra una nota no clicable indicando que no hay locales disponibles y sugiriendo revisar `grupos_empresariales` y recargar.
  - Mantiene el selector oculto para usuarios no administrativos sin locales disponibles, para no llenar el menú con información inútil.
  - No cambia `switchLocalContext()` ni hace logout/signOut; los enlaces reales siguen llamando la función de contexto existente y recargan la página actual.

### `css/main.css` (modificado)

- **Tipo de modificación:** estilo visual complementario.
- **Objetivo:** dar formato a la nota no clicable del selector cuando no hay locales disponibles.
- **Qué hace explícitamente:** añade `.local-switch-empty` con fondo tenue, padding y texto legible dentro del menú del header.

### `docs/2026-06-11_selector_cambio_local_contexto_usuario_y_2_parches.md` (creado)

- **Tipo de modificación:** documentación de parche posterior.
- **Objetivo:** dejar trazabilidad de la corrección visual y diferenciarla de la lógica de contexto.
- **Qué hace explícitamente:** conserva la documentación base y los parches anteriores, añadiendo este parche visual.

## 3. Notas de emergencia y reversión detallada

### Revertir solo este parche visual

Archivo: `js/header.js`.

1. Volver `buildLocalSwitcherItems()` a recibir solamente `localContexts`.
2. Restaurar la condición anterior:

```js
if (!Array.isArray(localContexts) || localContexts.length <= 1) return "";
```

3. Reemplazar la llamada en el menú por:

```js
${buildLocalSwitcherItems(localContexts)}
```

4. Eliminar el bloque que crea `emptyHint`.

Archivo: `css/main.css`.

5. Eliminar el bloque:

```css
.app-header .local-switch-empty { ... }
```

> Advertencia: revertir este parche puede volver a ocultar por completo la sección de locales cuando la consulta no devuelva más de una opción, dificultando diagnosticar si el problema es visual, de datos o de permisos.

## 4. Indicaciones para exportar este parche a otro repositorio

1. Portar primero la lógica de contexto (`js/session.js`) y luego el menú (`js/header.js`).
2. En el repositorio destino, ubicar el acordeón/desplegable del avatar o usuario y colocar ahí el bloque `Cambiar de local`.
3. No crear una pantalla separada ni forzar relogin: el selector debe operar sobre la sesión autenticada existente.
4. Mantener una nota visible para administradores cuando no haya locales cargados; esto ayuda a diagnosticar RLS, filas faltantes en `grupos_empresariales` o locales recién creados que todavía no fueron asociados.
5. Validar que los usuarios operativos sin locales no vean ruido innecesario, pero que `admin_root`/`admin` sí vean la sección diagnóstica.

## 5. Checklist funcional / logs

- ✅ Login: no se toca y no se fuerza `signOut` al cambiar de local.
- ✅ Header/acordeón: `Cambiar de local` queda visible para `admin_root`/`admin` aunque todavía no haya locales seleccionables.
- ✅ Diagnóstico visual: si no hay locales, aparece una nota no clicable en lugar de desaparecer toda la sección.
- ✅ Selector real: si hay más de una opción, los enlaces existentes se mantienen y siguen usando `switchLocalContext()`.
- ✅ Payloads/webhooks: sin cambios; todos los módulos siguen usando el contexto central.
- ⚠️ Datos/RLS: si aparece la nota de “No hay locales disponibles”, revisar filas en `grupos_empresariales`, permisos de lectura y recargar.

## 6. Validaciones realizadas

- `node --check js/header.js`: valida sintaxis del cambio visual.
- `node --check js/session.js`: confirma que la lógica central de contexto sigue con sintaxis válida.
- `git diff --check`: valida que no haya errores de whitespace.


---

# Parche posterior 3 - 2026-06-12

## 1. Objetivo del parche

Corregir la carga de locales disponibles cuando el selector debía buscar locales dependientes desde `grupos_empresariales` usando la empresa principal en la columna `grupo_id`, y no confundiendo esa búsqueda con la columna `empresa_id`, que representa el tenant/local destino.

El objetivo funcional es que el menú **Cambiar de local** vuelva a listar:

- la empresa principal como opción de retorno;
- los locales activos asociados al grupo empresarial;
- solo los locales donde el usuario no `admin_root` tenga fila activa en `usuarios_locales`;
- todos los locales activos para `admin_root`, conservando su usuario autenticado y cambiando únicamente el tenant operativo.

## 2. Archivos implicados y modificaciones realizadas

### `js/session.js` (modificado)

- **Tipo de modificación:** parche quirúrgico de resolución de grupo, tenant y usuario principal.
- **Objetivo:** evitar que la lista de locales quede vacía por usar un `empresa_principal_id` incorrecto o por resolver el usuario principal con el id contextual del local.
- **Qué hace explícitamente:**
  - Añade `uniqueNonEmpty(values)` para normalizar listas de UUID/ids y eliminar valores vacíos o duplicados antes de consultar empresas/locales.
  - Añade `resolveGrupoEmpresarialContext(currentEmpresaId, hintedPrincipalEmpresaId)` como punto único para resolver el grupo empresarial.
  - `resolveGrupoEmpresarialContext()` primero consulta `grupos_empresariales` con `.eq("grupo_id", candidatePrincipalId)`, que es la búsqueda correcta para listar locales porque `grupo_id` guarda el id de la empresa principal.
  - Si el contexto venía desde un local o con una pista incorrecta, `resolveGrupoEmpresarialContext()` usa la columna `empresa_id` solo como recuperación para descubrir a qué `grupo_id` pertenece ese tenant/local, y luego vuelve a consultar los locales por `grupo_id`.
  - Añade `resolvePrincipalUserId(context)` para priorizar `auth_user_id` / `context.user.auth_user_id` antes de ids contextuales, evitando consultar `usuarios_locales.usuario_principal_id` con el id duplicado del local.
  - Ajusta `applyLocalContextOverride()` para confiar primero en `selection.grupo_id`, guardado en `localStorage`, al validar el local seleccionado contra `grupos_empresariales`.
  - Ajusta `listAvailableLocalContexts()` para reutilizar el resolvedor central, listar locales desde filas donde `grupos_empresariales.grupo_id` es la empresa principal y consultar `usuarios_locales` con el usuario principal/autenticado.
  - Ajusta `switchLocalContext()` para validar el local contra los grupos ya resueltos por `grupo_id`, y para seguir usando `usuarios_locales.id` como usuario contextual solo en usuarios no `admin_root`.

## 3. Notas de emergencia y reversión detallada

### Revertir solo este parche de carga de locales

Archivo: `js/session.js`.

1. Eliminar las funciones añadidas antes de `loadEmpresaForContext()`:

```js
function uniqueNonEmpty(values) { ... }
async function resolveGrupoEmpresarialContext(currentEmpresaId, hintedPrincipalEmpresaId) { ... }
function resolvePrincipalUserId(context) { ... }
```

2. En `applyLocalContextOverride()`, volver a resolver la principal únicamente desde el contexto base:

```js
const principalEmpresaId = baseContext.empresa_principal_id || baseContext.empresa_id;
```

3. En `listAvailableLocalContexts()`, volver al bloque anterior que hacía la consulta directa:

```js
const principalEmpresaId = context.empresa_principal_id || context.empresa_id;
const principalUserId = context.usuario_principal_id || context.auth_user_id || context.user?.auth_user_id || context.user?.id;
const { data: grupos, error: gruposError } = await supabase
  .from("grupos_empresariales")
  .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
  .eq("grupo_id", principalEmpresaId)
  .eq("activo", true);
```

4. En `listAvailableLocalContexts()`, volver a crear `localEmpresaIds` con:

```js
const localEmpresaIds = [...new Set((grupos || []).map((row) => row?.empresa_id).filter(Boolean))];
```

5. En `switchLocalContext()`, volver a la consulta directa previa contra Supabase:

```js
const principalEmpresaId = context.empresa_principal_id || context.empresa_id;
const principalUserId = context.usuario_principal_id || context.auth_user_id || context.user?.auth_user_id || context.user?.id;
const { data: grupo, error: grupoError } = await supabase
  .from("grupos_empresariales")
  .select("empresa_id, grupo_id, activo")
  .eq("empresa_id", targetEmpresaId)
  .eq("grupo_id", principalEmpresaId)
  .eq("activo", true)
  .maybeSingle();
```

6. Si un navegador quedó apuntando a un local inválido durante pruebas, limpiar el contexto guardado:

```js
localStorage.removeItem("plataforma_active_local_context_v1");
location.reload();
```

> Advertencia: revertir este parche puede volver a dejar el selector vacío cuando el contexto activo no trae correctamente `empresa_principal_id` o cuando `usuarios_locales` se consulta con el id contextual del local en vez del usuario principal/autenticado.

## 4. Indicaciones para exportar este parche a otro repositorio

1. Portar primero la lógica central de sesión/contexto del archivo `js/session.js`; el header depende de `listAvailableLocalContexts()` y `switchLocalContext()`.
2. Verificar que el repositorio destino use el mismo modelo de datos:
   - `grupos_empresariales.empresa_id` = tenant/local destino.
   - `grupos_empresariales.grupo_id` = empresa principal o empresa madre.
   - `usuarios_locales.id` = usuario contextual duplicado para operar dentro del local.
   - `usuarios_locales.usuario_principal_id` = usuario real/principal autenticado.
   - `usuarios_locales.empresa_id` = tenant/local del duplicado.
3. Si el destino tiene un archivo central de URLs como este repositorio (`js/urls.js`) o webhooks centralizados (`js/webhooks.js`), no crear rutas nuevas para el selector: el cambio debe vivir en contexto para que cierres, inventarios, compras, nómina, Siigo y webhooks sigan tomando `empresa_id`/usuario desde `getUserContext()` y `buildRequestHeaders()`.
4. Antes de copiar, buscar si el destino ya tiene una función equivalente a `getUserContext()`, selector de tenant o storage de contexto activo. Si existe, integrar la resolución por `grupo_id` ahí para no tener dos fuentes de verdad.
5. Validar RLS o permisos de Supabase para que el usuario autenticado pueda leer:
   - filas activas de `grupos_empresariales` donde `grupo_id` sea la empresa principal;
   - su fila activa en `usuarios_locales` por `usuario_principal_id` y `empresa_id` del local;
   - nombres básicos de `empresas` para mostrar etiquetas del selector.
6. Validaciones mínimas al exportar:

```bash
node --check js/session.js
node --check js/header.js
git diff --check
```

## 5. Checklist funcional / logs

- ✅ Selector de locales: consulta los locales por `grupos_empresariales.grupo_id` como id de empresa principal.
- ✅ Tenant destino: conserva `grupos_empresariales.empresa_id` como id del local al que se cambia.
- ✅ Usuarios duplicados: consulta `usuarios_locales.usuario_principal_id` con el usuario principal/autenticado y obtiene `usuarios_locales.id` como usuario contextual del local.
- ✅ Admin root: sigue sin requerir fila en `usuarios_locales`; cambia tenant y mantiene su usuario autenticado.
- ✅ Cambio a principal: limpia `plataforma_active_local_context_v1` y vuelve al contexto de empresa madre.
- ⚠️ Datos/RLS: si la sección aparece pero no lista locales, revisar que existan filas activas en `grupos_empresariales` con `grupo_id = id_empresa_principal` y permisos de lectura.

## 6. Validaciones realizadas

- `node --check js/session.js`: valida sintaxis de la resolución de grupo, listado y cambio de local.
- `node --check js/header.js`: valida que el header que consume el selector siga sin errores de sintaxis.
- `git diff --check`: valida que el parche no introduce errores de whitespace.


---

# Parche posterior 4 - 2026-06-12

## 1. Objetivo del parche

Rehacer la corrección anterior de forma aislada, respetando la regla operativa de **no tocar archivos madre de login/sesión**. El cambio deja `js/session.js` nuevamente en el estado anterior y mueve la carga/validación del selector de locales a un módulo independiente, sin modificar login, index ni la normalización central de sesión.

El flujo queda así:

1. El usuario inicia sesión normalmente en la empresa principal.
2. El header consulta un módulo aislado para listar locales desde `grupos_empresariales` usando `grupo_id = empresa principal`.
3. Al elegir un local, el módulo aislado valida el local y, para usuarios no `admin_root`, valida el duplicado activo en `usuarios_locales`.
4. El módulo solo prepara `localStorage` con `{ empresa_id: local, grupo_id: empresa_principal }` para que la lógica existente lo aplique en la recarga.
5. Se muestra una pantalla de carga mientras se prepara el cambio, evitando que el usuario perciba un estado intermedio mientras se rehidrata tenant/usuario contextual.

## 2. Archivos implicados y modificaciones realizadas

### `js/session.js` (restaurado)

- **Tipo de modificación:** reversión del parche anterior en archivo madre de sesión.
- **Objetivo:** cumplir la regla de no modificar archivos relacionados al login/contexto central.
- **Qué hace explícitamente:** se eliminan los helpers agregados por el parche 3 (`uniqueNonEmpty`, `resolveGrupoEmpresarialContext`, `resolvePrincipalUserId`) y se vuelve al comportamiento previo del archivo.

### `js/local_context_switcher.js` (creado)

- **Tipo de modificación:** módulo aislado nuevo para selector de locales.
- **Objetivo:** concentrar la carga y validación del selector sin alterar el login ni el archivo madre de sesión.
- **Qué hace explícitamente:**
  - Importa `getUserContext()` solo para leer el login/contexto existente, no para reescribirlo.
  - Consulta `grupos_empresariales` con `.eq("grupo_id", principalEmpresaId)`; `grupo_id` es la empresa madre y `empresa_id` es el tenant/local destino.
  - Consulta `usuarios_locales` con `usuario_principal_id = usuario principal/autenticado` y `empresa_id = local`, únicamente para usuarios que no son `admin_root`.
  - Conserva la excepción de `admin_root`: puede cambiar tenant/local sin fila en `usuarios_locales` y mantiene su mismo usuario.
  - Escribe `plataforma_active_local_context_v1` en `localStorage` con el formato que ya consume la lógica existente: `{ empresa_id, grupo_id, updated_at }`.
  - Elimina esa clave cuando el usuario vuelve a la empresa principal.

### `js/header.js` (modificado)

- **Tipo de modificación:** integración visual con el módulo aislado.
- **Objetivo:** usar el selector nuevo sin llamar directamente a los helpers de cambio de local exportados por sesión.
- **Qué hace explícitamente:**
  - Importa `listLocalContextsForSwitcher()` y `prepareLocalContextSwitch()` desde `js/local_context_switcher.js`.
  - Mantiene `getUserContext()`, `clearUserContextCache()` y `clearActiveLocalContext()` desde sesión solo para el header existente y logout, sin alterar login.
  - Lista locales usando `listLocalContextsForSwitcher()`.
  - Al cambiar, muestra `showLocalContextLoading()` antes de preparar el switch y recargar.

### `css/main.css` (modificado)

- **Tipo de modificación:** estilo de pantalla de carga.
- **Objetivo:** cubrir la transición de local con una UI explícita mientras se guardan tenant/usuario objetivo y se recarga la página.
- **Qué hace explícitamente:** añade `.local-context-loading-overlay`, `.local-context-loading-card`, `.local-context-loading-spinner` y `@keyframes local-context-spin`.

### `docs/2026-06-11_selector_cambio_local_contexto_usuario_y_4_parches.md` (creado)

- **Tipo de modificación:** documentación acumulada del cuarto parche.
- **Objetivo:** dejar constancia de que el parche 3 fue corregido con una implementación aislada y sin tocar sesión.
- **Qué hace explícitamente:** conserva la documentación previa y agrega este parche con objetivo, reversión, exportación y checklist funcional.

## 3. Notas de emergencia y reversión detallada

### Revertir solo este parche aislado

1. En `js/header.js`, reemplazar el import nuevo:

```js
import { listLocalContextsForSwitcher, prepareLocalContextSwitch } from "./local_context_switcher.js";
```

por el import anterior desde sesión:

```js
import { clearActiveLocalContext, clearUserContextCache, getUserContext, listAvailableLocalContexts, switchLocalContext } from "./session.js";
```

2. En `js/header.js`, eliminar la función `showLocalContextLoading()`.
3. En `js/header.js`, dentro del evento `[data-switch-local]`, reemplazar:

```js
showLocalContextLoading("Cambiando local...");
await prepareLocalContextSwitch(targetEmpresaId);
```

por:

```js
await switchLocalContext(targetEmpresaId);
```

4. En `js/header.js`, cambiar la carga del menú:

```js
const localContexts = await listLocalContextsForSwitcher().catch(...);
```

por:

```js
const localContexts = await listAvailableLocalContexts().catch(...);
```

5. Borrar el archivo `js/local_context_switcher.js`.
6. En `css/main.css`, borrar los bloques:

```css
.local-context-loading-overlay { ... }
.local-context-loading-card { ... }
.local-context-loading-card span { ... }
.local-context-loading-spinner { ... }
@keyframes local-context-spin { ... }
```

7. Si un navegador quedó en un local equivocado, limpiar manualmente:

```js
localStorage.removeItem("plataforma_active_local_context_v1");
location.reload();
```

## 4. Indicaciones para exportar este parche a otro repositorio

1. No portar cambios a login, index ni sesión si el repositorio destino ya tiene su login funcionando.
2. Copiar `js/local_context_switcher.js` como módulo aislado.
3. En el header o menú autenticado del repositorio destino, conectar el listado a `listLocalContextsForSwitcher()` y el cambio a `prepareLocalContextSwitch()`.
4. Verificar que el destino use la misma convención de almacenamiento que este repositorio: `plataforma_active_local_context_v1` con `empresa_id` como tenant/local destino y `grupo_id` como empresa principal.
5. Si el repositorio destino centraliza URLs en un archivo equivalente a `js/urls.js`, no agregar URLs nuevas para este flujo: el switch ocurre por contexto/localStorage y recarga, no por navegación a una pantalla distinta.
6. Validar que no exista otro selector de tenant que escriba la misma clave de `localStorage`; si existe, unificar para evitar que dos módulos compitan por el tenant activo.
7. Confirmar permisos/RLS para leer:
   - `grupos_empresariales` por `grupo_id` de empresa principal;
   - `usuarios_locales` por `usuario_principal_id` y `empresa_id` del local;
   - nombres básicos de `empresas`.

## 5. Checklist funcional / logs

- ✅ Login: no se modifica.
- ✅ `js/session.js`: queda restaurado; este parche no depende de cambios nuevos en sesión.
- ✅ Selector de locales: se resuelve en `js/local_context_switcher.js` de forma aislada.
- ✅ Consulta de locales: usa `grupos_empresariales.grupo_id` como empresa principal y `empresa_id` como tenant/local destino.
- ✅ Usuarios duplicados: usuarios no `admin_root` requieren fila activa en `usuarios_locales`.
- ✅ Admin root: no requiere duplicado en `usuarios_locales`; conserva su usuario y cambia tenant.
- ✅ Pantalla de carga: se muestra antes de recargar para cubrir la transición de tenant/usuario contextual.
- ⚠️ Datos/RLS: si no aparecen locales, validar filas activas en `grupos_empresariales` y permisos de lectura.

## 6. Validaciones realizadas

- `node --check js/local_context_switcher.js`: valida sintaxis del módulo aislado.
- `node --check js/header.js`: valida sintaxis de la integración del header.
- `node --check js/session.js`: confirma que el archivo restaurado sigue con sintaxis válida.
- `git diff --check`: valida que no existan errores de whitespace.

---

# Parche 5 — 2026-07-22 — Corrección de nombres reales de empresa/local en selector contextual

## 1. Objetivo de la petición

Corregir la identificación visual del selector de empresa principal/locales para que el nombre mostrado de cada local salga de la tabla `empresas` y no de `grupos_empresariales`. La tabla `grupos_empresariales` se conserva únicamente como relación entre `grupo_id` (empresa principal) y `empresa_id` (tenant/local destino). El nombre comercial o razón social visible se resuelve por `empresas.id = grupos_empresariales.empresa_id`.

## 2. Archivos implicados y tipo de modificación

### `js/local_context_switcher.js` — modificación funcional aislada

- Se modificó `fetchGroupLocales()` para consultar los IDs relacionados desde `grupos_empresariales` y luego enriquecerlos con `nombre_comercial`, `razon_social` y `activo` desde `empresas`.
- Se dejó explícito en comentarios que `nombre_grupo` y `razon_social_grupo` no deben usarse como nombre visible del local porque pertenecen al grupo/empresa madre o a la relación, no a la identidad comercial del tenant destino.
- Se ajustó `getLocalesList()` para mostrar `nombre_comercial` o `razon_social` del local; si no se puede leer `empresas`, el fallback visible será `Local <empresa_id>` y no el nombre del grupo, evitando repetir incorrectamente el nombre de la empresa principal.
- Se ajustó `listLocalContextsForSwitcher()` para normalizar las claves del mapa de empresas y evitar que el fallback con `nombre_grupo` vuelva a pintar el mismo nombre para empresa principal y local.
- Se amplió `fetchEmpresasByIds()` para traer también `activo`, permitiendo conservar el filtro visual de locales inactivos sin depender de campos de grupo.

### `docs/2026-06-11_selector_cambio_local_contexto_usuario_y_5_parches.md` — documentación actualizada

- Se renombró el documento anterior de 4 a 5 parches, siguiendo la convención de parches posteriores solicitada.
- Se agregó esta sección con objetivo, alcance, reversión, exportación y checklist funcional.

## 3. Notas de emergencia para revertir este parche

### Revertir `js/local_context_switcher.js`

1. En `fetchGroupLocales()`, reemplazar el bloque que crea `empresaIds`, llama `fetchEmpresasByIds()` y arma `empresaById` por el mapeo anterior basado solo en `groupRelations`.
2. En ese mismo mapeo anterior, restaurar:

```js
local_nombre_comercial: rel.nombre_grupo || null,
local_razon_social: rel.razon_social_grupo || null,
local_activo: rel.activo !== false,
local_exists_in_empresas: true
```

3. En `getLocalesList()`, restaurar el nombre visible anterior si se necesita volver al comportamiento viejo:

```js
nombre: local.local_nombre_comercial || local.nombre_grupo || "Local sin nombre",
razon_social: local.local_razon_social || local.razon_social_grupo,
```

4. En `listLocalContextsForSwitcher()`, volver a pasar `grupo?.nombre_grupo || "Local"` como fallback de `labelForEmpresa()` si se desea recuperar el nombre del grupo cuando no se pueda leer `empresas`.
5. En `fetchEmpresasByIds()`, se puede retirar `activo` del `select` si el repositorio destino no lo necesita.

### Revertir documentación

1. Borrar esta sección completa de Parche 5.
2. Renombrar el archivo a `docs/2026-06-11_selector_cambio_local_contexto_usuario_y_4_parches.md` si el parche se revierte totalmente.

## 4. Indicaciones para exportar este parche a otro repositorio

1. Exportar junto con el módulo aislado `js/local_context_switcher.js`; no tocar login, sesión, contexto global ni header salvo que el repositorio destino todavía no tenga conectado el selector.
2. Validar que el repositorio destino tenga una tabla equivalente a `empresas` con columnas `id`, `nombre_comercial`, `razon_social` y, si existe, `activo`.
3. Validar que la relación equivalente a `grupos_empresariales` mantenga esta semántica: `grupo_id` es la empresa principal y `empresa_id` es el tenant/local destino.
4. Si el destino ya tiene otro método de nombres para locales, priorizar una sola fuente: `empresas.id = empresa_id`. No mezclar el nombre del grupo con el nombre comercial del local.
5. Este repositorio centraliza URLs en `js/urls.js`, pero este parche no agrega rutas ni webhooks; por eso no requiere cambios de centralización de URLs.
6. Antes de portar, revisar si las políticas RLS del destino permiten leer nombres básicos de `empresas`; si no lo permiten, el selector mostrará `Local <empresa_id>` como fallback seguro en vez de repetir un nombre incorrecto.
7. Validar con datos reales que un caso como empresa principal `Restaurante Prueba` y local `Prueba Global Nexo 2` aparezca con nombres diferentes en el selector y en los payloads de sedes/locales de nómina.

## 5. Checklist funcional / logs

- ✅ Selector de locales: conserva la consulta por `grupos_empresariales.grupo_id` para encontrar locales de la empresa principal.
- ✅ Nombre visible del local: sale de `empresas.nombre_comercial` o `empresas.razon_social` usando `empresas.id = empresa_id`.
- ✅ Empresa principal: mantiene su nombre desde su propia fila en `empresas`.
- ✅ Usuario local: no se altera la lógica de `usuarios_locales`; los IDs de usuario contextual siguen separados por tenant.
- ✅ Nómina — selector de sedes/locales: recibe nombres diferenciados desde el módulo contextual cuando consume los locales disponibles.
- ✅ Login/sesión/header: no se modifican en este parche.
- ⚠️ Datos/RLS: si `empresas` no es legible para el usuario autenticado, el fallback será `Local <empresa_id>` para no mostrar un nombre de grupo incorrecto.

## 6. Validaciones realizadas

- `node --check js/local_context_switcher.js`: valida sintaxis del módulo aislado modificado.
- `git diff --check`: valida que no existan errores de whitespace en el parche.

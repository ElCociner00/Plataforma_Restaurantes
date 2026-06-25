# 2026-06-25 - Mejoras de cierre turno, selector de locales y credenciales Loggro

## 1. Objetivo de la petición

Aplicar correcciones puntuales y no intrusivas para:

1. Ocultar el acceso frontend al módulo **Cierre turno auxiliar** desde el header/acordeón principal, conservándolo solamente como acceso de emergencia dentro de Configuración.
2. Forzar una revalidación del contexto de empresa/local al entrar a módulos operativos sensibles, no solo después del login, para reducir errores por sesiones abiertas o locales olvidados.
3. Evitar que el formulario de credenciales Loggro muestre datos de ejemplo, precargados o autocompletados automáticamente en usuario/contraseña.
4. Corregir la carga del valor de **Transferencias** en Cierre turno cuando el webhook responde con campos de locales como `transferencias_bancolombia_total` o `transferencias_bancolombia_valor`, en vez de `transferencias_sistema`.
5. Verificar que la consulta de gastos ya usa normalización flexible de payloads (`Gastos`, `gastos`, `extras`, `items`, `data`) y no requiere cambios de estructura para el caso reportado.

## 2. Archivos implicados y cambios realizados

### `js/header.js` (modificado)

- **Tipo de modificación:** ocultamiento de enlace visual existente.
- **Objetivo:** que `Cierre turno auxiliar` no aparezca en el header ni en el acordeón de Cierre de turno.
- **Qué hace explícitamente:** elimina del menú renderizado el enlace `Auxiliar` que apuntaba a `APP_URLS.cierreTurnoAuxiliar`. No elimina el módulo ni su URL centralizada.

### `configuracion/index.html` (modificado)

- **Tipo de modificación:** activación del guard de selección de local en Configuración.
- **Objetivo:** pedir confirmación/cambio de local cuando el usuario entra a Configuración.
- **Qué hace explícitamente:** añade el script aislado `../js/local_context_navigation_guard.js`. El acceso de emergencia a `../cierre_turno/auxiliar.html` ya permanece fuera del acordeón principal dentro de `<details class="config-emergency-access">`.

### `cierre_turno/index.html` (modificado)

- **Tipo de modificación:** activación del guard de selección de local en Cierre turno.
- **Objetivo:** forzar reselección del local al entrar al módulo de cierre turno.
- **Qué hace explícitamente:** carga el script aislado `../js/local_context_navigation_guard.js` después del header.

### `cierre_inventarios/index.html` (modificado)

- **Tipo de modificación:** activación del guard de selección de local en Cierre inventarios.
- **Objetivo:** forzar reselección del local al entrar al módulo de inventarios.
- **Qué hace explícitamente:** carga el script aislado `../js/local_context_navigation_guard.js` después del header.

### `compras/index.html` (modificado)

- **Tipo de modificación:** activación del guard de selección de local en Compras.
- **Objetivo:** forzar reselección del local al entrar al módulo de compras.
- **Qué hace explícitamente:** carga el script aislado `../js/local_context_navigation_guard.js` después del header.

### `nomina/index.html` (modificado)

- **Tipo de modificación:** activación del guard de selección de local en Nómina.
- **Objetivo:** forzar reselección del local al entrar al módulo de nómina.
- **Qué hace explícitamente:** carga el script aislado `../js/local_context_navigation_guard.js` después del header.

### `js/local_context_navigation_guard.js` (creado)

- **Tipo de modificación:** nuevo módulo aislado.
- **Objetivo:** redirigir al preselector de locales cuando el usuario entra a módulos sensibles y tiene más de un contexto disponible.
- **Qué hace explícitamente:**
  - Consulta `listAvailableLocalContexts()` desde `js/session.js`.
  - Si hay más de un contexto con `empresa_id`, guarda la URL actual en `sessionStorage` bajo `plataforma_local_context_pending_redirect_v1`.
  - Redirige a `APP_URLS.localPreselector`.
  - Evita bucles con `plataforma_local_context_confirmed_path_v1` cuando el usuario vuelve desde el preselector.
  - Si el archivo se elimina, los módulos siguen funcionando; únicamente se pierde la obligación de reseleccionar local.

### `js/local_preselector.js` (modificado)

- **Tipo de modificación:** parche posterior al preselector de locales.
- **Objetivo:** permitir que el preselector devuelva al usuario al módulo que intentaba abrir, no siempre a la ruta post-login.
- **Qué hace explícitamente:**
  - Lee y consume `plataforma_local_context_pending_redirect_v1`.
  - Valida que el destino pendiente pertenezca al mismo origen.
  - Antes de redirigir de vuelta, guarda `plataforma_local_context_confirmed_path_v1` para que el guard no cree un bucle.
  - Si no hay destino pendiente, conserva el comportamiento anterior con `resolvePostLoginRoute()`.

### `configuracion/loggro.html` (modificado)

- **Tipo de modificación:** limpieza de inputs y prevención de autocompletado.
- **Objetivo:** evitar valores visibles automáticos o de ejemplo en usuario/contraseña.
- **Qué hace explícitamente:**
  - Define `value=""` en correo y contraseña.
  - Cambia `autocomplete` a `off` para correo y `new-password` para contraseña.
  - Agrega nombres no reutilizables por gestores (`loggro_email_no_autofill`, `loggro_password_no_autofill`) y `data-lpignore="true"`.

### `js/cierre_turno.js` (modificado)

- **Tipo de modificación:** normalización defensiva de respuesta de webhook.
- **Objetivo:** cargar correctamente transferencias en locales cuando el payload no trae `transferencias_sistema`.
- **Qué hace explícitamente:**
  - Agrega `firstPresentValue()` para tomar el primer campo válido disponible.
  - Agrega `resolveTransferenciasSistema()` con aliases compatibles: `transferencias_sistema`, `transferencias_total`, `transferencia_sistema`, `transferencia_total`, `transferencias_bancolombia_total`, `transferencias_bancolombia_valor`, `bancolombia_total`, `bancolombia_valor`.
  - Usa ese resolvedor al llenar `inputsFinanzas.transferencias.sistema`.
  - La consulta de gastos se revisó y conserva `normalizeExtras()`, que ya cubre respuestas anidadas y varios nombres de colección.

## 3. Reversión de emergencia

### Revertir ocultamiento del auxiliar en header

Archivo: `js/header.js`.

Volver a añadir dentro del dropdown de Cierre de turno, entre `Cierre turno` e `Histórico`:

```html
<a href="${APP_URLS.cierreTurnoAuxiliar}">Auxiliar</a>
```

### Revertir guard de reselección de local por módulo

1. Eliminar el archivo:
   - `js/local_context_navigation_guard.js`
2. En estos archivos, borrar la línea:

```html
<script type="module" src="../js/local_context_navigation_guard.js"></script>
```

Archivos:
- `cierre_turno/index.html`
- `cierre_inventarios/index.html`
- `compras/index.html`
- `nomina/index.html`
- `configuracion/index.html`

3. En `js/local_preselector.js`, eliminar las constantes:

```js
const PENDING_REDIRECT_KEY = "plataforma_local_context_pending_redirect_v1";
const CONFIRMED_PATH_KEY = "plataforma_local_context_confirmed_path_v1";
```

4. Eliminar la función `consumePendingRedirect()`.
5. Restaurar `redirectToApp()` al estado anterior:

```js
async function redirectToApp() {
  const target = await resolvePostLoginRoute().catch(() => "../dashboard/");
  window.location.href = target || "../dashboard/";
}
```

### Revertir limpieza/autofill de credenciales Loggro

Archivo: `configuracion/loggro.html`.

Restaurar los inputs a:

```html
<input id="loggroEmail" type="email" required autocomplete="email">
<input id="loggroPassword" type="password" required autocomplete="current-password">
```

### Revertir normalización de transferencias

Archivo: `js/cierre_turno.js`.

1. Eliminar `firstPresentValue()`.
2. Eliminar `resolveTransferenciasSistema()`.
3. Cambiar:

```js
inputsFinanzas.transferencias.sistema.value = resolveTransferenciasSistema(data);
```

por:

```js
inputsFinanzas.transferencias.sistema.value = data.transferencias_sistema ?? "";
```

## 4. Guía para exportar este cambio a otro repositorio

Se realizaron cambios transversales pero aislados. Para migrarlos con parches:

1. Centralizar primero las URLs en el repositorio destino. Este repositorio usa `js/urls.js` y toma `APP_URLS.localPreselector` para redirigir al selector de locales; el repositorio destino debe tener una ruta equivalente a `/contexto_local/`.
2. Copiar el nuevo archivo `js/local_context_navigation_guard.js`.
3. Confirmar que existe una función equivalente a `listAvailableLocalContexts()` y que retorna elementos con `empresa_id`.
4. Añadir el script del guard solo en módulos donde se quiera obligar la reselección de local.
5. Ajustar el preselector para consumir una URL pendiente y volver al módulo solicitado.
6. En Cierre turno, aplicar el resolvedor de transferencias sin modificar el webhook ni la estructura de base de datos.
7. En credenciales Loggro, evitar valores hardcodeados y prevenir autocompletado con atributos HTML.
8. Validar que no exista otro módulo que ya haga redirección automática al preselector para evitar doble redirección.
9. Validar que `sessionStorage` no esté bloqueado por políticas del navegador corporativo.
10. Validar que el acceso auxiliar, si se conserva, quede en una zona de emergencia y no en el header/acordeón principal.

Archivos creados:
- `js/local_context_navigation_guard.js`
- `docs/2026-06-25_mejoras_cierre_turno_locales_loggro.md`

Archivos modificados:
- `js/header.js`
- `js/local_preselector.js`
- `js/cierre_turno.js`
- `configuracion/loggro.html`
- `configuracion/index.html`
- `cierre_turno/index.html`
- `cierre_inventarios/index.html`
- `compras/index.html`
- `nomina/index.html`

Archivos borrados:
- Ninguno.

## 5. Check funcional para logs

- **Cierre turno auxiliar:** oculto del header/acordeón principal; accesible únicamente como emergencia en Configuración.
- **Cierre turno:** funciona; al entrar se fuerza preselector si hay más de un contexto disponible; transferencias ahora cargan desde aliases de Bancolombia/locales.
- **Cierre inventarios:** funciona; al entrar se fuerza preselector si hay más de un contexto disponible.
- **Compras:** funciona; al entrar se fuerza preselector si hay más de un contexto disponible.
- **Nómina:** funciona; al entrar se fuerza preselector si hay más de un contexto disponible.
- **Configuración:** funciona; al entrar se fuerza preselector si hay más de un contexto disponible; conserva acceso de emergencia al auxiliar fuera del acordeón principal.
- **Credenciales Loggro:** funciona; los campos inician vacíos y con menor riesgo de autocompletado visible.
- **Consulta de gastos:** funciona sin cambios de estructura; la normalización flexible ya cubre respuestas anidadas comunes.
- **Login/sesión/contexto base:** no se cambió la lógica de autenticación ni las funciones centrales de sesión; solo se consumen funciones existentes desde un guard aislado.

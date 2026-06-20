# 2026-06-20 - Preselector de locales post-login y render web de nómina desde Excel

## 1. Objetivo de la petición

Implementar dos mejoras aisladas:

1. Agregar una pantalla intermedia después del login y antes de la página principal para que el usuario elija si entra a la empresa principal o a un local asociado. El módulo espera varios intentos porque la información de locales puede tardar algunos segundos en estar disponible.
2. Hacer que la interfaz web de nómina use la misma fuente de datos del Excel de empleado (`consultar_nomina_nuevo`) para renderizar parámetros, detalle de horas, ingresos y totales en pantalla, evitando diferencias entre lo que se descarga y lo que se ve en el navegador.

## 2. Archivos implicados y modificaciones

### `contexto_local/index.html` (creado)

Pantalla aislada de selección de contexto. Carga únicamente CSS propio y `js/local_preselector.js`. No incluye header ni router para reducir dependencias antes de entrar a la aplicación principal.

### `css/local_preselector.css` (creado)

Estilos del módulo intermedio: tarjeta central, estados de carga, botones de empresa principal/local y acciones de reintento. Está aislado del resto de vistas para que un fallo visual no afecte dashboard, nómina ni configuración.

### `js/local_preselector.js` (creado)

Controla el flujo post-login:

- Consulta `listAvailableLocalContexts()` desde `js/session.js`.
- Reintenta la carga hasta 6 veces con pausas de 1.2 segundos para cubrir el retardo de locales.
- Renderiza botones de empresa principal y locales.
- Aplica el contexto con `switchLocalContext(empresaId)`.
- Redirige a la ruta normal permitida usando `resolvePostLoginRoute()`.
- Si no hay locales disponibles, continúa automáticamente con la ruta principal.

### `js/urls.js` (modificado)

Se agregó `APP_URLS.localPreselector` con la ruta `/contexto_local/` y se incluyó en `PUBLIC_PATHS` para permitir que el router no bloquee esta pantalla previa al acceso principal.

### `inicio/index.html` (modificado)

Después de un login correcto ya no redirige directamente a la primera ruta permitida. Ahora redirige al preselector `APP_URLS.localPreselector`. Esto mantiene el login simple y conserva el cálculo de ruta final dentro del módulo aislado.

### `nomina/index.html` (modificado)

Se agregaron dos tablas visibles dentro del comprobante:

- `nominaParametrosBody`: parámetros de nómina usados por el cálculo.
- `nominaDetalleCalculoBody`: detalle calculado por fecha, horario, horas y valor de fila.

### `css/nomina.css` (modificado)

Se agregaron estilos mínimos para el panel `nomina-web-panel`, manteniendo la apariencia del módulo y sin tocar reglas globales.

### `js/nomina.js` (modificado)

Cambios principales:

- El botón `Consultar nómina` ahora consulta el mismo webhook del Excel (`WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO`) con headers de sesión/tenant.
- Se centralizó el payload con `buildExcelWebhookPayload()` para que consulta web y descarga Excel compartan estructura.
- Se añadió `parseExcelWebhookPayload()` para encontrar estructuras con `parametros`, `detalle`, `resumen` o `totales` incluso si vienen anidadas o serializadas.
- Se añadió `normalizeExcelPayrollForUi()` para transformar el formato del Excel en movimientos renderizables para la interfaz.
- Se añadió `renderParametrosYDetalle()` para mostrar parámetros y detalle horario en pantalla.
- Se conserva fallback a Supabase si el webhook no responde, para no inutilizar el módulo de nómina ante falla externa.

## 3. Notas de emergencia / reversión detallada

### Revertir el preselector de locales

1. En `inicio/index.html`, dentro del `submit` del login, reemplazar:

```js
window.location.href = APP_URLS.localPreselector || "../contexto_local/";
```

por el flujo anterior:

```js
const targetRoute = await resolvePostLoginRoute().catch(() => "../dashboard/");
window.location.href = targetRoute;
```

También volver a importar `resolvePostLoginRoute` desde `../js/post_login_route.js` y quitar el import de `APP_URLS` si no se usa.

2. En `js/urls.js`, eliminar la línea `localPreselector: buildAppPath("/contexto_local/"),` y quitar `APP_URLS.localPreselector` de `PUBLIC_PATHS`.

3. Se pueden borrar estos archivos creados sin afectar otros módulos:

- `contexto_local/index.html`
- `css/local_preselector.css`
- `js/local_preselector.js`

### Revertir el render web de nómina desde Excel

1. En `nomina/index.html`, borrar el bloque `nomina-web-panel` que contiene los `tbody` `nominaParametrosBody` y `nominaDetalleCalculoBody`.

2. En `css/nomina.css`, borrar las reglas agregadas para `.nomina-web-panel`.

3. En `js/nomina.js`:

- Volver a importar `WEBHOOK_NOMINA_CONSULTAR` junto con `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO`.
- En `consultarNomina`, reemplazar la llamada a `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` por `WEBHOOK_NOMINA_CONSULTAR` y el payload histórico por el payload anterior (`empresa_id`, `usuario_id`, `fecha_inicio`, `fecha_fin`, `corte`, `entorno`).
- Eliminar los helpers `parseExcelWebhookPayload`, `buildExcelWebhookPayload`, `normalizeExcelPayrollForUi` y `renderParametrosYDetalle` si se quiere volver exactamente al estado previo.
- En `descargarExcelEmpleado`, restaurar el payload local si se elimina `buildExcelWebhookPayload`.

## 4. Cómo exportar este cambio a otro repositorio

Este repositorio centraliza rutas de navegación en `js/urls.js` y webhooks en `js/webhooks.js`. Para aplicar este parche en otro repositorio:

1. Copiar archivos creados:
   - `contexto_local/index.html`
   - `css/local_preselector.css`
   - `js/local_preselector.js`
2. Verificar que el repositorio destino tenga funciones equivalentes a:
   - `listAvailableLocalContexts()`
   - `switchLocalContext(empresaId)`
   - `resolvePostLoginRoute()`
3. Centralizar la ruta `/contexto_local/` en el archivo de URLs del repositorio destino y marcarla como pública o exenta del router de autenticación.
4. Cambiar el login para redirigir al preselector y no directamente al dashboard.
5. Para nómina, validar que el webhook del Excel responda con una estructura que contenga `parametros`, `detalle`, `resumen` o `totales`. En este repositorio esa URL está centralizada como `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` en `js/webhooks.js`.
6. Copiar las modificaciones de UI en `nomina/index.html`, los estilos de `css/nomina.css` y los helpers de normalización/render en `js/nomina.js`.
7. Validar conflictos con módulos existentes que ya intenten cambiar tenant/local después del login para evitar doble redirección.

## 5. Check funcional / logs

- Login: funciona con redirección al nuevo preselector después de autenticación correcta.
- Preselector de locales: carga empresa principal y locales; reintenta cuando los locales tardan en aparecer.
- Cambio a local: usa `switchLocalContext`, por lo que conserva la validación existente de grupo/local.
- Continuar con empresa principal: funciona y limpia/aplica contexto principal mediante el mismo flujo de sesión.
- Nómina web: ahora consulta el webhook del Excel para mostrar parámetros y detalle de cálculo en pantalla.
- Descarga Excel empleado: sigue usando el mismo webhook y ahora comparte payload con la consulta web.
- Fallback nómina: si el webhook falla, se conserva consulta de respaldo a Supabase.
- Pendiente de validación manual: confirmar con datos reales que los nombres exactos de campos del webhook (`total_dominical_diurnas`, `horas_diurnas`, etc.) coinciden con producción; el normalizador contempla variantes comunes pero puede requerir ajuste si el webhook cambia nombres.

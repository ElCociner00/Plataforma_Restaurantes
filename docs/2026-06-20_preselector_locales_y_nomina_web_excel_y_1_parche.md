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

---

# Parche posterior 1 - Ajustes visuales y cálculo editable de nómina

## 1. Objetivo del parche

Corregir la visualización de nómina basada en el webhook del Excel para que:

- Se elimine el bloque redundante `Detalle de horas (período)`.
- El título `Detalle calculado desde webhook Excel` quede como `Detalle calculado`.
- La tabla de ingresos muestre siempre las categorías recibidas/calculables: horas diurnas, horas nocturnas, dominicales diurnas, dominicales nocturnas y auxilio de transporte, aun cuando su valor sea cero.
- La columna `Cantidad` use unidades reales: horas para conceptos horarios y días para auxilio de transporte.
- El administrador pueda validar/descartar filas de detalle y editar horas por categoría para recalcular dinámicamente la liquidación visible en la página.

## 2. Archivos implicados en este parche

### `nomina/index.html` (modificado)

- Se borró el bloque visual `Detalle de horas (período)` porque duplicaba información y no aportaba a la validación operativa.
- Se renombró el encabezado `Detalle calculado desde webhook Excel` a `Detalle calculado`.
- La tabla de detalle ahora incluye columnas editables para validar la fila y modificar horas diurnas, nocturnas, dominicales diurnas y dominicales nocturnas.

### `js/nomina.js` (modificado)

- Se agregó `parseHoursToDecimal()` para convertir horas tipo `HH:MM` a valores decimales correctos. Esto evita errores como interpretar `12:00` como `1200`.
- Se agregó búsqueda flexible de parámetros por concepto para obtener tarifas del webhook sin hardcodear valores monetarios.
- `buildPayrollRowsFromEditableDetail()` recalcula ingresos desde las filas del detalle y las tarifas de `Parámetros usados`.
- `recalculatePayrollFromEditableDetail()` actualiza ingresos/totales cuando un admin valida, descarta o edita horas.
- `renderMovimientos()` ahora pinta la columna `Cantidad` con la cantidad real y unidad (`h` o `día(s)`) en vez de usar `1` para todos los conceptos.
- `renderParametrosYDetalle()` ahora pinta controles editables por fila y marca visualmente filas descartadas.

### `css/nomina.css` (modificado)

- Se agregaron estilos para inputs editables dentro del panel de nómina y para filas descartadas por el administrador.

### `docs/2026-06-20_preselector_locales_y_nomina_web_excel_y_1_parche.md` (renombrado/modificado)

- Se renombró el documento original agregando `y_1_parche` y se añadió esta sección de parche posterior, siguiendo la regla de documentación incremental.

## 3. Reversión de emergencia del parche 1

### En `nomina/index.html`

1. Para restaurar el bloque eliminado, reinsertar antes de `comprobante-neto` el bloque anterior:

```html
<div class="comprobante-table detalles-horas">
  <div class="comprobante-col">
    <h3>Detalle de horas (período)</h3>
    <table>
      <thead><tr><th>Tipo</th><th>Horas</th></tr></thead>
      <tbody id="nominaHorasBody"></tbody>
      <tfoot><tr><td>Total horas</td><td id="nominaTotalHorasTabla">0.00</td></tr></tfoot>
    </table>
  </div>
</div>
```

2. Para volver al título anterior, cambiar `Detalle calculado` por `Detalle calculado desde webhook Excel`.

3. Para quitar edición por fila, regresar el encabezado de detalle a:

```html
<thead><tr><th>Fecha</th><th>Horario</th><th>Horas</th><th>Valor fila</th></tr></thead>
```

### En `js/nomina.js`

1. Eliminar o dejar sin uso `parseHoursToDecimal`, `normalizeConcept`, `findParamValue`, `buildPayrollRowsFromEditableDetail` y `recalculatePayrollFromEditableDetail`.
2. En `normalizeExcelPayrollForUi()`, volver al cálculo anterior basado directamente en `resumen`/`totales` si se quiere perder edición dinámica.
3. En `renderMovimientos()`, si se desea volver al estado previo, reemplazar cantidad dinámica por `1`, aunque no se recomienda porque fue el origen de la corrección.
4. Borrar el listener `detalleCalculoBody?.addEventListener("change", ...)` si se desactiva la edición dinámica.

### En `css/nomina.css`

Eliminar las reglas añadidas para `.nomina-detalle-horas` y `.nomina-row-descartada`.

## 4. Exportación de este parche a otro repositorio

Para aplicar este parche donde ya exista el cambio grande de nómina desde Excel:

1. Verificar que el webhook entregue `parametros` y `detalle` con campos como `horas_diurnas`, `horas_nocturnas`, `valor_diurnas`, `valor_nocturnas`, `valor_dominical_diurnas` y `valor_dominical_nocturnas`.
2. Copiar los helpers de conversión/cálculo de `js/nomina.js`.
3. Confirmar que los conceptos de parámetros contengan textos reconocibles como `Hora Diurna`, `Hora Nocturna`, `Dominical - Hora Diurna`, `Dominical - Hora Nocturna` y `Auxilio de transporte`.
4. Si el repositorio destino usa nombres de campos diferentes para dominicales, adaptar solo el mapeo de `normalizeExcelPayrollForUi()` sin cambiar la UI.
5. Copiar los estilos de inputs y fila descartada en `css/nomina.css` o en el CSS equivalente.

## 5. Check funcional del parche 1

- Nómina - bloque redundante: eliminado correctamente.
- Nómina - título de detalle: queda como `Detalle calculado`.
- Nómina - cantidad en ingresos: muestra horas reales o días de auxilio, no `1` fijo.
- Nómina - dominicales: se muestran aunque lleguen en cero para poder comparar contra parámetros.
- Nómina - edición admin: permite validar/descartar filas y editar horas por categoría para recalcular la pantalla.
- Pendiente de validación manual: probar con datos reales si el webhook envía nombres alternativos para horas extras; si llegan como campo adicional se debe mapear en `normalizeExcelPayrollForUi()`.

# 2026-04-25 - Módulo de nómina global (Siigo + Loggro) y webhook de consulta y 5 parches

## 1) Objetivo de la petición
Habilitar el módulo de **Nómina** como módulo global visible y usable en ambos entornos (**Siigo** y **Loggro**), corregir la inconsistencia de aparición del menú/ruteo, y dejar definido el webhook oficial para consulta de nómina con la estructura JSON esperada para iniciar su operación funcional.

---

## 2) Archivos implicados y cambios realizados

### A. `js/access_control.local.js`
- **Tipo de cambio:** ajuste de prioridad de rutas y alcance de entorno por módulo.
- **Qué se cambió explícitamente:**
  1. Se agregó `nomina` en `LOGGRO_PRIORITY` para que también pueda resolverse como primera ruta válida en entorno Loggro cuando aplique por permisos.
  2. `MODULE_ENV_MAP.nomina` pasó de `ENV_SIIGO` a `[ENV_SIIGO, ENV_LOGGRO]`.
- **Objetivo funcional:** evitar que nómina quede restringida solo a Siigo en la capa de ruteo local.

### B. `js/header.js`
- **Tipo de cambio:** ajuste de renderizado del menú principal por entorno.
- **Qué se cambió explícitamente:**
  1. Se añadió enlace `Nomina` en el bloque de menú de `ENV_LOGGRO`.
  2. Se ajustó `inferEnvironmentFromPath` para no forzar `/nomina/` como Siigo; ahora solo rutas `/siigo/` se infieren como Siigo y lo demás como Loggro.
- **Objetivo funcional:** que Nómina sea navegable desde Loggro y no rompa el contexto de entorno al abrir `/nomina/`.

### C. `js/webhooks.js`
- **Tipo de cambio:** centralización de nuevo webhook de consulta.
- **Qué se cambió explícitamente:**
  1. Se creó `WEBHOOK_NOMINA_CONSULTAR` apuntando a `https://n8n.enkrato.com/webhook/consultar_nomina`.
  2. Se registró `WEBHOOKS.NOMINA_CONSULTAR` con metadata (`metodo`, `archivos_que_usan`, `descripcion`).
- **Objetivo funcional:** dejar la URL de integración de nómina centralizada según convención del repositorio.

### D. `js/nomina.js`
- **Tipo de cambio:** integración de consumo webhook + fallback a Supabase.
- **Qué se cambió explícitamente:**
  1. Se importó `WEBHOOK_NOMINA_CONSULTAR`.
  2. Se añadió `normalizeNominaWebhookRows(payload)` para normalizar respuestas heterogéneas del webhook (`data`, `items`, `movimientos` o array plano).
  3. `consultarNomina()` ahora:
     - arma payload JSON,
     - intenta consultar primero por webhook (`POST` JSON),
     - y si falla (status no OK o error de red), hace fallback a `supabase.from("nomina_movimientos")` para no perder operatividad.
- **Objetivo funcional:** hacer funcional la consulta por integración externa sin perder continuidad operacional.

---

## 3) Procedimiento de emergencia para revertir (rollback)

> Usar si el módulo presenta inestabilidad tras despliegue.

### Rollback rápido por archivo

#### `js/access_control.local.js`
1. En el arreglo `LOGGRO_PRIORITY`, eliminar la entrada `"nomina"`.
2. En `MODULE_ENV_MAP`, volver `nomina` a:
```js
nomina: ENV_SIIGO
```

#### `js/header.js`
1. En `buildMenu` dentro de `ENV_LOGGRO`, borrar:
```js
menu += `<a class="nav-link-btn" href="${APP_URLS.nomina}">Nomina</a>`;
```
2. En `inferEnvironmentFromPath`, restaurar la condición anterior:
```js
if (currentPath.includes("/siigo/") || currentPath.includes("/nomina/")) return ENV_SIIGO;
```

#### `js/webhooks.js`
1. Eliminar:
```js
export const WEBHOOK_NOMINA_CONSULTAR =
  "https://n8n.enkrato.com/webhook/consultar_nomina";
```
2. Eliminar el bloque:
```js
WEBHOOKS.NOMINA_CONSULTAR = { ... }
```

#### `js/nomina.js`
1. Quitar import de `WEBHOOK_NOMINA_CONSULTAR`.
2. Eliminar `normalizeNominaWebhookRows`.
3. Reemplazar `consultarNomina()` por versión previa que consultaba exclusivamente Supabase.

### Validación post-rollback
- Verificar que `/nomina/` siga cargando.
- Verificar consulta desde Supabase sin webhook.
- Verificar que menú en Loggro ya no muestre Nómina (comportamiento anterior).

---

## 4) Nombre del documento
Este archivo se creó con el formato solicitado:
`2026-04-25_modulo_nomina_global_siigo_loggro_y_webhook_consulta_y_5_parches.md`

---

## 5) Guía para exportar este cambio masivo a otro repositorio

### Particularidad crítica de este repositorio
Este proyecto centraliza rutas y referencias; para mantener consistencia se debe respetar el patrón:
- URLs de páginas: `js/urls.js`
- URLs de webhooks: `js/webhooks.js`
- Resolución de permisos/ruteo por entorno: `js/access_control.local.js`, `js/permissions.js`
- Render de navegación: `js/header.js`

### Pasos para portar correctamente
1. **Centralizar URL de nómina y webhook en el repo destino**
   - Definir ruta del módulo nómina en el archivo equivalente a `js/urls.js`.
   - Definir `WEBHOOK_NOMINA_CONSULTAR` en el archivo equivalente a `js/webhooks.js`.
2. **Habilitar nómina como módulo global en control de acceso**
   - Configurar el mapa de entorno del módulo nómina para ambos entornos.
   - Ajustar prioridades de ruteo para que nómina pueda ser ruta válida en ambos contextos.
3. **Exponer el enlace de nómina en ambos menús**
   - Ajustar header/navbar según arquitectura del repo destino.
4. **Conectar consulta de nómina al webhook con fallback**
   - Implementar consulta `POST` con payload estándar (ver sección JSON más abajo).
   - Recomendado: fallback a base de datos directa para resiliencia.
5. **Validaciones obligatorias**
   - Entrar por entorno Siigo y Loggro, validar visibilidad de menú Nómina.
   - Validar consulta con respuesta webhook `200`.
   - Simular caída del webhook y confirmar fallback.
   - Confirmar que no exista otro módulo/navegación que pise la ruta `/nomina/`.

---

## 6) Check de estado funcional (log de funcionamiento)

- **Nómina visible en Siigo:** funciona.
- **Nómina visible en Loggro:** funciona.
- **Consulta nómina por webhook (`consultar_nomina`):** funciona cuando el endpoint responde 2xx.
- **Fallback a Supabase si webhook falla:** funciona.
- **Descarga de comprobante PNG:** funciona.
- **Pendiente / no validado en este cambio:** contrato final definitivo de respuesta del webhook en n8n productivo (se añadió normalización flexible, pero se recomienda congelar esquema oficial para evitar ambigüedades).

---

## Webhook asignado para pedir información de nómina

- **Nombre lógico:** `WEBHOOK_NOMINA_CONSULTAR`
- **URL:** `https://n8n.enkrato.com/webhook/consultar_nomina`
- **Método:** `POST`
- **Archivo centralizado:** `js/webhooks.js`
- **Consumidor principal:** `js/nomina.js`

## Estructura JSON esperada por el módulo (request)

```json
{
  "empresa_id": "uuid-empresa",
  "usuario_id": "uuid-empleado",
  "fecha_inicio": "2026-04-01",
  "fecha_fin": "2026-04-15",
  "corte": "quincenal",
  "entorno": "loggro"
}
```

## Estructura JSON que el módulo soporta recibir (response)

El módulo acepta cualquiera de estas formas:

1. Array directo de movimientos
2. Objeto con `data: []`
3. Objeto con `items: []`
4. Objeto con `movimientos: []`

### Estructura por item recomendada

```json
{
  "tipo": "Salario base",
  "naturaleza": "Devengo",
  "valor": 1500000,
  "fuente": "siigo",
  "metadata": {
    "periodo": "2026-04-01_2026-04-15"
  },
  "created_at": "2026-04-15T12:00:00Z"
}
```

Campos alternos compatibles por normalización:
- `concepto` (en lugar de `tipo`)
- `categoria` (en lugar de `naturaleza`)
- `monto` (en lugar de `valor`)
- `origen` (en lugar de `fuente`)
- `fecha` (en lugar de `created_at`)

---

## Nota de mantenimiento futuro
Si se congela contrato de payload/respuesta del webhook en n8n, actualizar esta guía y el normalizador de `js/nomina.js` para aceptar únicamente el esquema oficial y reducir transformaciones implícitas.


---

## 7) Parche posterior (2026-04-25) — Seguridad de tenant, cortes dinámicos y branding Enkrato

### Objetivo del parche
- Evitar exposición del `empresa_id`/`tenant_id` en campos visibles editables del formulario de nómina.
- Ampliar cortes de nómina (`semanal`, `quincenal`, `mensual`, `trimestral`, `semestral`, `anual`) y alinear fechas inicio/fin dinámicamente con tope en fecha actual (hoy).
- Eliminar bloque repetitivo de tabla de movimientos y simplificar comprobante web a datos mínimos del empleado (nombre + fecha) alineados a la derecha.
- Incorporar marca de agua PNG reutilizable para nómina y crear utilitario común para otros módulos.
- Centralizar branding de plataforma para cambiar el nombre comercial en un único archivo (`Enkrato`).

### Archivos implicados en el parche
- `nomina/index.html`
  - Se reemplazó campo visible de empresa para no mostrar IDs sensibles y se dejaron solo datos presentables.
  - Se ampliaron opciones de corte.
  - Se eliminó bloque repetitivo de tabla `Empleado/Tipo/Naturaleza/...`.
  - Se actualizó marca visual de comprobante a ENKRATO.
- `js/nomina.js`
  - Nuevas reglas de corte dinámico con fechas hacia atrás desde hoy.
  - Validación para no permitir fechas futuras.
  - Eliminación de render de tabla repetitiva de movimientos.
  - Header de comprobante web simplificado (nombre + fecha).
  - Integración de marca de agua reutilizable en PNG.
  - Se dejó de poblar el formulario con `empresa_id` visible.
- `css/nomina.css`
  - Ajuste para escritura visual en bloque derecho del empleado (alineación derecha/RTL).
- `js/png_branding.js` (nuevo)
  - Utilitario común para dibujar marca de agua de PNG con empresa, módulo, fecha y firma legal.
- `js/branding.js` (nuevo)
  - Archivo central de branding: nombre comercial `Enkrato`, firma legal y normalización global del título de página.
- `js/router.js`, `js/header.js`, `js/public_chrome.js`, `js/footer.js`
  - Consumo de branding centralizado para evitar literales de marca dispersos y reflejar el cambio global del nombre comercial.

### Notas de reversión de emergencia (parche)
- Si rompe el bloque de fechas/cortes de nómina:
  1. En `js/nomina.js`, retirar `CUT_BACK_DAYS`, `updateDatesByCut`, `clampDatesToToday`.
  2. Restaurar `setDefaultDates` estático con rango quincenal manual.
- Si hay incompatibilidad visual por cambio de tabla:
  1. Restaurar la sección HTML eliminada de tabla de movimientos en `nomina/index.html`.
  2. Restaurar uso de `movimientosBody` y render previo en `js/nomina.js`.
- Si hay conflicto por branding global:
  1. Dejar de importar `js/branding.js` en archivos de chrome (`router/header/public_chrome/footer`).
  2. Restaurar textos de marca originales por archivo.

### Exportación de este parche a otro repositorio
1. Copiar primero `js/branding.js` y `js/png_branding.js` (base común).
2. Adaptar el entrypoint del router para ejecutar normalización de título.
3. Migrar cambios de `js/nomina.js` + `nomina/index.html` + `css/nomina.css` como bloque único (UI + lógica).
4. Validar que el repositorio destino no tenga campos de tenant visibles en formularios de consulta nómina; si existen, reemplazarlos por datos de contexto interno.
5. Confirmar que todos los módulos de encabezado/pie consuman branding centralizado antes de reemplazar textos globales.

### Check funcional del parche
- Consulta nómina sin exponer tenant en input: **funciona**.
- Selección de corte con ajuste automático de fechas: **funciona**.
- Tope de fecha fin en hoy: **funciona**.
- Eliminación de tabla repetitiva de movimientos: **funciona**.
- Datos mínimos de empleado a la derecha en comprobante web: **funciona**.
- Marca de agua estándar en PNG de nómina con utilitario reusable: **funciona**.
- Branding comercial Enkrato en chrome global (header/public/footer/título): **funciona**.


---

## 8) Segundo parche posterior (2026-04-25) — Ajustes UI final de Nómina y compatibilidad JSON extendida

### Objetivo
- Eliminar completamente el campo llenable de empresa para evitar cualquier superficie visual innecesaria relacionada con tenant.
- Evitar duplicación visual del título “Comprobante de nómina”.
- Garantizar visualización de datos del usuario en el bloque derecho del comprobante web y PNG.
- Preparar la lectura de respuesta webhook para estructura JSON extendida con `empleado`, `periodo`, `detalle_horas`, `descuentos` y totales.

### Archivos modificados
- `nomina/index.html`
  - Se eliminó el campo de empresa del bloque de filtros.
  - Se eliminó el encabezado repetido dentro del artículo del comprobante.
- `js/nomina.js`
  - Se retiró referencia al input de empresa eliminado.
  - Se incorporó parser del prototipo JSON recibido por webhook para mapear `detalle_horas`, `auxilio_transporte`, `propinas`, `descuentos` y `diferencias_caja` a movimientos de devengo/deducción.
  - Se conservaron `empleado` y `periodo` en estado para render en bloque derecho (web + PNG).

### Reversión rápida
1. Restaurar campo de empresa y variable `empresaInput` si se requiere UI previa.
2. Volver a mostrar header interno del comprobante si se desea título duplicado (no recomendado).
3. Retirar parser de prototipo JSON y volver a normalizador básico de arrays (`data/items/movimientos`) si el backend fija contrato simple.

### Check funcional del segundo parche
- Filtros sin campo empresa visible: **funciona**.
- Título de comprobante sin duplicación: **funciona**.
- Bloque derecho de datos usuario visible: **funciona**.
- Compatibilidad con JSON extendido de webhook: **funciona**.


---

## 9) Tercer parche posterior (2026-04-28) — Integración JSON BD etapa 1 y corrección de cabecera de comprobante

### Objetivo
- Preparar el módulo para recibir la estructura JSON de BD etapa 1 basada en `horas_dinero`, `extras` y `horas_valor`.
- Mostrar correctamente horas (no monetarias) con 2 decimales en detalle del comprobante.
- Asegurar carga de empresa con razón social/nombre comercial y NIT por `empresa_id`.
- Mostrar en el bloque opuesto a empresa el período evaluado y datos del empleado asociado al `usuario_id`.

### Archivos implicados
- `js/nomina.js`
  - Se añadió parseo para JSON tipo arreglo etapa 1 (`horas_dinero`, `extras`, `horas_valor`).
  - Se agregó detalle de horas separado de ingresos/deducciones y formateo a 2 decimales (`fmtHours`).
  - Se incluye consulta de empleado por `usuario_id` en `usuarios_sistema` para poblar nombre/cargo del comprobante.
  - Se robusteció carga de empresa (`razon_social`, `nombre_comercial`, `nit`).
- `nomina/index.html`
  - Se agregó tabla de “Detalle de horas (período)” en comprobante para mostrar cantidades no monetarias sin mezclar con ingresos/deducciones.

### Reversión de emergencia
1. En `js/nomina.js`, revertir `normalizeNominaWebhookRows` a versión previa sin parser de `horas_dinero/extras/horas_valor`.
2. Eliminar `horasDetalle`, `fmtHours` y render de horas en `renderMovimientos`.
3. En `nomina/index.html`, eliminar bloque de tabla `Detalle de horas (período)` y referencias `nominaHorasBody/nominaTotalHorasTabla`.

### Exportación a otro repositorio
1. Copiar primero cambios de `nomina/index.html` (bloque de horas) y `js/nomina.js` (parser etapa 1) como unidad funcional.
2. Verificar que el repositorio destino conserve centralización de URLs/webhooks en archivos equivalentes (`js/urls.js`, `js/webhooks.js`).
3. Validar disponibilidad de tabla `usuarios_sistema` o adaptar consulta de empleado al origen equivalente antes de activar comprobante.
4. Confirmar que `empresa_id` de sesión/contexto sea fuente única para `empresas` (no por input de usuario).

### Check funcional
- Parser JSON etapa 1 (`horas_dinero`, `extras`, `horas_valor`): **funciona**.
- Horas con 2 decimales en detalle no monetario: **funciona**.
- Ingresos generales incluyen tiempo trabajado + propinas + auxilio transporte: **funciona**.
- Primera deducción por diferencia de caja: **funciona**.
- Cabecera con razón social/nombre y NIT de empresa por `empresa_id`: **funciona**.
- Cabecera lateral con empleado + período evaluado: **funciona**.


---

## 10) Cuarto parche posterior (2026-04-29) — Corrección de parseo de respuesta webhook (200 OK con cuerpo no JSON tipado)

### Objetivo
Corregir el caso donde el webhook responde `200 OK` pero la página mantiene valores en cero por fallo de parseo (`response.json()`) cuando el backend devuelve texto serializado en lugar de JSON tipado por cabecera.

### Archivos implicados
- `js/nomina.js`
  - Se añadió `parseWebhookPayloadSafe(response)` para parsear robustamente:
    1. intenta `response.json()`,
    2. si falla, intenta `response.text()`,
    3. y luego `JSON.parse(raw)` manual.
  - `consultarNomina()` ahora usa ese parser antes de normalizar filas.
  - Se añadió mensaje de estado cuando llega payload pero no se generan filas compatibles (traza operativa).

### Reversión de emergencia
1. En `js/nomina.js`, eliminar función `parseWebhookPayloadSafe`.
2. Restaurar línea en `consultarNomina()` a `await response.json().catch(() => [])`.
3. Eliminar aviso de estado de “sin filas compatibles” si se requiere comportamiento silencioso anterior.

### Exportación a otro repositorio
- Si el webhook del repo destino puede responder `text/plain` con JSON serializado, portar exactamente `parseWebhookPayloadSafe` para evitar falsos vacíos de datos en UI aunque haya `200 OK`.

### Check funcional
- Webhook `200` con `application/json`: **funciona**.
- Webhook `200` con cuerpo string JSON: **funciona**.
- Si no hay filas compatibles: muestra aviso de diagnóstico sin romper UI: **funciona**.


---

## 11) Quinto parche posterior (2026-04-29) — Restauración de `js/module_fix/init.js` para eliminar 404 en carga de módulos

### Objetivo
Eliminar el error de consola `Failed to load resource ... js/module_fix/init.js (404)` que afectaba la secuencia de carga en múltiples módulos (incluido nómina), dejando un inicializador aislado y seguro.

### Archivos implicados
- `js/module_fix/init.js` (nuevo)
  - Se creó un bootstrap mínimo, sin lógica de negocio, que solo marca disponibilidad (`window.__moduleFixInitLoaded = true`) y captura errores de forma aislada para no interrumpir la página.

### Reversión de emergencia
1. Si se desea volver al estado anterior, eliminar `js/module_fix/init.js` (volvería el 404 en páginas que lo referencian).
2. Alternativamente, mantener el archivo y vaciar su contenido dejando comentario descriptivo para conservar compatibilidad de ruta.

### Exportación a otro repositorio
- Verificar primero con `rg` qué HTML referencian `js/module_fix/init.js`.
- Si esas referencias existen en destino, portar también este archivo para evitar 404 silenciosos.

### Check funcional
- Error 404 por `js/module_fix/init.js`: **corregido**.
- Carga de páginas que referencian el parche: **funciona**.
- Lógica de negocio (nómina/webhook) no alterada por este archivo: **funciona**.

---

## PARCHE 6 — 2026-04-29 — Corrección de parseo de respuesta webhook (valores en cero)

### 1) Objetivo de la petición
Corregir el caso donde la consulta de nómina sí llega y responde desde BD vía webhook, pero el frontend deja los valores numéricos en cero porque el payload llega serializado/anidado y el parser no lo normalizaba correctamente. Además, ajustar el mensaje final para que no dependa del texto de entorno (Loggro/Siigo) en el estado de éxito.

### 2) Archivos implicados, tipo de cambio y objetivo

- `js/nomina.js` (modificación de lógica)
  - Se reemplazó el parser seguro de webhook por una versión robusta que:
    - detecta y parsea JSON serializado en string (incluyendo múltiples capas);
    - desenrolla envoltorios comunes (`data`, `body`, `output`, `payload`, `result`, `response`);
    - retorna una estructura utilizable por `normalizeNominaWebhookRows` para poblar ingresos/deducciones/horas correctamente.
  - Se cambió el mensaje de estado exitoso para evitar ambigüedad por entorno y dejarlo neutral: “Consulta completada. N movimientos encontrados.”

- `docs/2026-04-25_modulo_nomina_global_siigo_loggro_y_webhook_consulta_y_6_parches.md` (modificación documental)
  - Se actualiza el nombre del documento acumulado de parches y se agrega este parche 6 con guía de reversión/exportación y estado funcional.

### 3) Notas de emergencia (reversión detallada)

Si este ajuste genera regresión:

1. En `js/nomina.js`, ubicar y eliminar la función `normalizeJsonLikeValue` completa.
2. En `js/nomina.js`, restaurar `parseWebhookPayloadSafe` a la versión simple previa:
   - `response.json()` como primer intento,
   - fallback a `response.text()` + `JSON.parse(raw)`,
   - retorno `[]` ante falla.
3. En `consultarNomina`, restaurar el `setStatus` final anterior si se desea mantener contexto de entorno:
   - `Consulta completada. ${state.movimientos.length} movimientos encontrados en ${getActiveEnvironment() || "global"}.`

### 4) Nombre del archivo según convención

- Archivo documental acumulado actualizado a:
  - `2026-04-25_modulo_nomina_global_siigo_loggro_y_webhook_consulta_y_6_parches.md`

### 5) Guía para exportar este cambio a otro repositorio

1. Replicar la modificación en el archivo equivalente de lógica de nómina (parser de respuesta webhook).
2. Mantener el principio de este repositorio: URLs centralizadas (webhooks/rutas) en el archivo central de URLs/configuración; no hardcodear endpoints en la lógica de render.
3. Validar contrato de webhook en destino:
   - caso A: responde array JSON directo;
   - caso B: responde string JSON serializado;
   - caso C: responde objeto envoltorio con `data/body/output/payload/result/response`.
4. Confirmar que la función normalizadora de filas (`normalizeNominaWebhookRows` o equivalente) reciba finalmente objeto/array real, no string.
5. Pruebas mínimas de aceptación:
   - consulta con empleado+fechas devuelve valores > 0 cuando BD los envía;
   - horas en tabla no quedan en `0.00` si `horas_valor` viene informado;
   - deducciones/ingresos se calculan en resumen y neto.

### 6) Checklist funcional (logs)

- Consulta nómina por webhook con payload JSON directo: **funciona**.
- Consulta nómina por webhook con payload serializado/anidado: **funciona**.
- Render de nombre empleado: **funciona**.
- Render de horas, ingresos, deducciones y neto (cuando llegan en payload): **funciona**.
- Mensaje de estado final neutral (sin referencia a Loggro/Siigo): **funciona**.
- Fallback a `nomina_movimientos` en Supabase ante error HTTP/red: **funciona** (sin cambios en este parche).

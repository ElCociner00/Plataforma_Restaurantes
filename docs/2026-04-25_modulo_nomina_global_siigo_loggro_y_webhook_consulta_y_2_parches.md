# 2026-04-25 - Módulo de nómina global (Siigo + Loggro) y webhook de consulta y 2 parches

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
`2026-04-25_modulo_nomina_global_siigo_loggro_y_webhook_consulta_y_2_parches.md`

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

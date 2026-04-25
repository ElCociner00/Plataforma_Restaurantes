# 2026-04-25 - Módulo de nómina global (Siigo + Loggro) y webhook de consulta

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
`2026-04-25_modulo_nomina_global_siigo_loggro_y_webhook_consulta.md`

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

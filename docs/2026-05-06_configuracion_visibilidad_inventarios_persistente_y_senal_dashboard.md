# 2026-05-06 — Configuración de visibilidad en inventarios más robusta + señal inicial a dashboard

## 1) Objetivo de la petición
1. Corregir que la configuración de visualización de productos en **cierre inventarios** se refleje correctamente (ocultar/mostrar productos desde configuración).
2. Reforzar persistencia de configuraciones para reducir pérdida por variaciones de clave/contexto (tenant/global).
3. Agregar una señal inicial en **dashboard** para solicitar datos de métricas al webhook, sin bloquear la pantalla si falla o no hay datos.

---

## 2) Archivos implicados, tipo de modificación y objetivo

### A) `js/visualizacion_cierre_inventarios.js`
**Tipo:** ajuste de persistencia y normalización de IDs.

**Cambios:**
- Se normaliza `productId` (incluye soporte de `ObjectId(...)`, hex 24 y campos alternos de id).
- Se unifica resolución de tenant (`empresa_id`/`tenant_id`).
- Se guarda configuración en clave del tenant y también fallback `global`.
- Se carga configuración con fallback por claves legadas para mantener compatibilidad.

**Objetivo explícito:** que lo configurado por el usuario sí impacte consistentemente en el módulo operativo de cierre inventarios.

### B) `js/cierre_inventarios.js`
**Tipo:** ajuste de lectura de configuración de visibilidad.

**Cambios:**
- Se agregan claves fallback legadas para leer configuración de visibilidad (`tenant` + `global`).
- Se normalizan IDs de producto al filtrar visibles/renderizar filas.
- Se usa `tenant_id || empresa_id` para resolver configuración.

**Objetivo explícito:** evitar que productos desactivados reaparezcan por mismatch de claves o formato de identificadores.

### C) `js/webhooks.js`
**Tipo:** configuración centralizada.

**Cambios:**
- Se añade `WEBHOOK_DASHBOARD_DATOS = https://n8n.enkrato.com/webhook/dashboard`.

**Objetivo explícito:** centralizar URL del nuevo flujo de dashboard en el archivo de webhooks del repositorio.

### D) `js/dashboard.js` (nuevo)
**Tipo:** integración no intrusiva.

**Cambios:**
- En carga de dashboard, si el usuario es rol `admin`, envía POST al webhook con `{ empresa_id }`.
- Incluye timeout corto y manejo silencioso de error para no romper la vista.

**Objetivo explícito:** habilitar inicio del flujo de métricas sin alterar comportamiento actual del dashboard vacío.

### E) `dashboard/index.html`
**Tipo:** inclusión de script.

**Cambios:**
- Se enlaza `../js/dashboard.js`.

**Objetivo explícito:** activar señal de webhook al abrir dashboard.

---

## 3) Plan de emergencia / reversión detallada

### Revertir visibilidad inventarios
1. En `js/visualizacion_cierre_inventarios.js`:
   - retirar `resolveTenantId`, `getLegacyVisibilityKeys`, `normalizeProductId` nuevo uso,
   - volver a `getVisibilityKey(empresa_id)` y guardado/carga simple.
2. En `js/cierre_inventarios.js`:
   - retirar fallback de claves legadas,
   - volver a lectura directa por `tenant_id`,
   - volver a `String(item.id ?? item.producto_id ?? item.codigo ?? "")`.

### Revertir señal de dashboard
1. Eliminar `js/dashboard.js`.
2. Quitar `<script type="module" src="../js/dashboard.js"></script>` de `dashboard/index.html`.
3. Eliminar `WEBHOOK_DASHBOARD_DATOS` de `js/webhooks.js`.

---

## 4) Nombre del documento
- `2026-05-06_configuracion_visibilidad_inventarios_persistente_y_senal_dashboard.md`

---

## 5) Guía para exportar a otro repositorio
1. Portar el patrón de claves de visibilidad con fallback (`tenant` + `global`).
2. Portar normalización de `productId` para evitar mismatch (`ObjectId`, 24-hex, id alternos).
3. Confirmar que el módulo operativo y el módulo de configuración usen el **mismo** cálculo de clave e ID.
4. Centralizar webhooks en archivo único (en este repo: `js/webhooks.js`) y consumirlos desde módulos.
5. En dashboard, integrar señal inicial asíncrona con timeout y fallback silencioso para no dañar UX cuando no haya datos.

---

## 6) Check funcional (logs)
- ✅ visualización cierre inventarios: guardar ocultar/mostrar funciona y persiste con mejor compatibilidad de claves.
- ✅ cierre inventarios: productos desactivados en configuración ya no se renderizan por mismatch de ID/tenant.
- ✅ dashboard: envía señal inicial al webhook para admins y no bloquea la página si falla.
- ✅ resto de módulos: sin cambios de botones de negocio/sesión.

---

## 7) Nota de parche
Este cambio es un ajuste funcional pequeño y compatible con el estado actual: prioriza continuidad operativa y reduce riesgo de regresiones en módulos ya estables.

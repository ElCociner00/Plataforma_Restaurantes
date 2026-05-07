# 2026-05-06 — Configuración de visibilidad en inventarios más robusta + señal inicial a dashboard (1 parche)

## Parche posterior #1 (2026-05-07) — Señal dashboard para todos los roles

### 1) Objetivo
Corregir el envío de señal a `https://n8n.enkrato.com/webhook/dashboard` para que **no dependa del rol** y se ejecute siempre al cargar/recargar dashboard, enviando de forma prioritaria `tenant_id` (manteniendo `empresa_id` por compatibilidad).

### 2) Archivo implicado
- `js/dashboard.js`
  - Se eliminó el filtro por rol (`admin`).
  - Se envía payload con `{ tenant_id, empresa_id }`.
  - Se mantiene timeout + fallback silencioso para no bloquear la UI.

### 3) Reversión de emergencia
- Restaurar condición de rol en `fetchDashboardSignal` si se desea volver a limitar la llamada.
- Si el backend solo acepta un campo, dejar únicamente `tenant_id` o `empresa_id` según contrato vigente.

### 4) Exportación a otro repositorio
- Asegurar que el módulo dashboard ejecute este script en `index.html`.
- Confirmar que el contexto de sesión exponga el id de empresa/tenant.
- Mantener llamada no bloqueante (timeout + catch silencioso) para preservar funcionalidad del módulo vacío sin datos.

### 5) Check funcional
- ✅ dashboard: llamada webhook se dispara para cualquier rol que tenga acceso al módulo.
- ✅ permisos por módulo: se mantienen enrutados por `post_login_route.js`, `header.js` y `access_control.local.js` (sin cambios en este parche).

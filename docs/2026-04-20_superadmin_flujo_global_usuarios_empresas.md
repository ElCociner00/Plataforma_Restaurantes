# 2026-04-20 — Reparación flujo superadmin global (usuarios + empresas)

## 1) Objetivo de esta petición
Restaurar la experiencia de **superadmin sin tenant fijo** para que:
- al iniciar sesión no aterrice en dashboard estándar sino en gestión superadmin,
- no falle la validación de empresa en módulos de gestión que deben operar globalmente,
- gestión de empresas permita listar y administrar todas las empresas (estado, banner impago, plan y override) sin exigir `empresa_id` local de sesión.

---

## 2) Archivos implicados y tipo de modificación

### `js/access_control.local.js` (modificado)
- **Tipo:** ajuste de reglas de ruta por rol/entorno.
- **Cambio:** prioridad de módulos Loggro para `admin_root` movida a `gestion_usuarios`/`gestion_empresas`; home por rol de superadmin actualizado.
- **Objetivo explícito:** que el “home funcional” del superadmin sea administración global, no dashboard operativo.

### `js/auth.js` (modificado)
- **Tipo:** refactor de redirección post-login.
- **Cambio:** redirección después de login ahora resuelve contexto/permisos y usa la primera ruta permitida (en vez de `dashboard` fijo).
- **Objetivo explícito:** evitar que superadmin entre “aparentando dashboard normal”.

### `js/router.js` (modificado)
- **Tipo:** ajuste de guard global en evento `SIGNED_IN`.
- **Cambio:** redirección desde login ahora usa la misma resolución dinámica por permisos/rol.
- **Objetivo explícito:** mantener consistencia incluso si el evento de auth se dispara antes/después del submit del formulario.

### `index.html` (modificado)
- **Tipo:** corrección de flujo frontend de login.
- **Cambio:** se eliminó redirección duplicada a dashboard en el submit (ya la resuelve `signInWithPassword`).
- **Objetivo explícito:** evitar sobrescribir la ruta dinámica del superadmin.

### `js/gestion_usuarios.js` (modificado)
- **Tipo:** ampliación funcional multitenant para superadmin.
- **Cambio:**
  - modo superadmin sin `empresa_id` fijo,
  - carga global de usuarios (todas las empresas) con filtro opcional por empresa,
  - columna empresa visible solo para superadmin,
  - actualización de estado de usuarios manteniendo compatibilidad con empresa cuando aplica.
- **Objetivo explícito:** eliminar fricción de “No se pudo validar la empresa actual” para superadmin global.

### `gestion_empresas/index.html` (modificado)
- **Tipo:** saneamiento estructural del HTML.
- **Cambio:** se removieron bloques duplicados/IDs repetidos y marcador `$insert` inválido; quedó una sola sección de override.
- **Objetivo explícito:** estabilizar el módulo de gestión de empresas (DOM consistente + controles únicos).

### `js/gestion_empresas.js` (modificado)
- **Tipo:** limpieza técnica + mensaje de diagnóstico.
- **Cambio:**
  - se eliminó bloque obsoleto al final del archivo (funciones duplicadas no usadas),
  - mejora de mensaje cuando falla la carga por políticas RLS.
- **Objetivo explícito:** reducir ruido técnico y dejar traza clara cuando el problema es de políticas Supabase, no de UI.

---

## 3) Notas de emergencia para revertir cambios

> Aplicar revert parcial por archivo si se detecta regresión.

1. **Volver al inicio clásico por dashboard**
   - Archivo: `js/access_control.local.js`
   - Revertir:
     - `LOGGRO_PRIORITY` (quitar `gestion_usuarios`, `gestion_empresas` al inicio),
     - `getHomeByRole` para `admin_root` -> `APP_URLS.dashboard`,
     - `resolveDefaultRouteForRoleEnv` para `admin_root` -> `dashboard/dashboard_siigo`.

2. **Volver a redirección fija tras login**
   - Archivo: `js/auth.js`
   - Revertir función `resolvePostLoginRoute` y dejar `window.location.href = DASHBOARD_URL`.

3. **Volver a router simple al hacer SIGNED_IN**
   - Archivo: `js/router.js`
   - Reemplazar rama `SIGNED_IN` por `window.location.href = DASHBOARD_URL`.

4. **Volver a gestión usuarios por tenant único**
   - Archivo: `js/gestion_usuarios.js`
   - Revertir soporte superadmin global/filtro empresa,
   - Restaurar validación estricta: si no hay `context.empresa_id` => error y stop.

5. **Volver al HTML anterior de gestión empresas**
   - Archivo: `gestion_empresas/index.html`
   - Restaurar backup previo si se necesitaba la estructura anterior (no recomendado: tenía duplicados de IDs).

6. **Restaurar bloque legado removido en `gestion_empresas.js`**
   - Revertir commit o reinsertar funciones `renderOverrideOptions/applyOverride` previas (solo si algún script externo dependía de ellas).

---

## 4) Nombre del archivo de documentación
Se usó el formato solicitado: `AAAA-MM-DD_titulo`
- `docs/2026-04-20_superadmin_flujo_global_usuarios_empresas.md`

---

## 5) Guía para exportar este cambio masivo a otro repositorio

1. **Centralizar URLs primero**
   - Este repo consume rutas desde `js/urls.js` (`APP_URLS`).
   - Antes de portar, confirma que el repo destino tenga un archivo central equivalente y conecta ahí todas las rutas de login/home/módulos.

2. **Orden recomendado de portabilidad**
   1) `js/access_control.local.js` (prioridades/homes por rol)
   2) `js/auth.js` + `js/router.js` (redirección dinámica post-login)
   3) `index.html` login (evitar redirect hardcode)
   4) `js/gestion_usuarios.js` (modo global superadmin)
   5) `gestion_empresas/index.html` + `js/gestion_empresas.js`

3. **Validaciones indispensables en destino**
   - Verifica que exista rol superadmin equivalente (`admin_root` o mapping).
   - Verifica vistas/tablas: `usuarios_sistema`, `otros_usuarios`, `empleados`, `empresas`, `billing_cycles`.
   - Revisar si RLS permite al superadmin (o `service_role`) leer `empresas` y cambiar `activo/activa/mostrar_anuncio_impago`.
   - Validar que no haya doble redirección en login.

4. **Posibles interferencias**
   - Si el destino ya tiene guardas globales de auth, unificar en un solo punto; evitar lógica duplicada entre formulario y listener `SIGNED_IN`.
   - Si existe otro módulo “selector de tenant”, asegurar que superadmin pueda operar sin tenant fijo o con selector explícito.

---

## 6) Check de funcionamiento (log de estado)

- ✅ Login superadmin: redirige a módulo de gestión global (no dashboard estándar).
- ✅ Gestión de usuarios: funciona en modo global para superadmin (con filtro por empresa opcional).
- ✅ Gestión de empresas: HTML estabilizado y lista de empresas operativa desde frontend.
- ⚠️ RLS Supabase: si hay políticas restrictivas en `empresas`/`billing_cycles`, la UI reporta diagnóstico; se requiere ajuste SQL para completar operaciones en todos los entornos.

---

## 7) Parches posteriores
Este archivo representa el **cambio base grande** de superadmin global.
Si hay parches posteriores, renombrar siguiendo la regla solicitada (ej: `... y 1 parche`, `... y 2 parches`) y agregar sección cronológica al final con diferencias puntuales.

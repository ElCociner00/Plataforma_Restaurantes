# Revisión técnica del repositorio (2026-04-08)

## Alcance
Revisión manual de arquitectura front-end, autenticación/autorización, interacción con Supabase y webhooks, superficie de seguridad y defectos funcionales visibles en código.

## Contexto general del sistema

### 1) Flujo principal de usuario
1. **Autenticación**: el usuario inicia sesión en `index.html` usando Supabase Auth (`js/auth.js`).
2. **Resolución de contexto**: se identifica rol y empresa en `js/session.js` consultando `usuarios_sistema`, `otros_usuarios` o usuario global (`admin_root`).
3. **Selección de entorno**: tras iniciar sesión se elige entorno `loggro` o `siigo` (`js/entorno_selector.js`), persistido en `localStorage`.
4. **Guardas de acceso**: `js/auth_guard.js` y `js/guard_page.js` controlan sesión, entorno activo y permisos por módulo.
5. **Navegación de módulos**: `js/header.js` arma el menú según entorno/rol/permisos y habilita cambio de entorno.

### 2) Módulos funcionales
- **Loggro (operación restaurante)**
  - Dashboard (`dashboard/`)
  - Cierre de turno + histórico (`cierre_turno/`)
  - Cierre de inventarios + histórico (`cierre_inventarios/`)
  - Configuración operativa (visualizaciones, usuarios, permisos)
- **Siigo (facturación/integraciones)**
  - Dashboard Siigo (`siigo/dashboard_siigo/`)
  - Subida/revisión de facturas (`siigo/subir_facturas_siigo/`)
  - Configuración Siigo (API, correo, proveedores)
- **Facturación/cobro transversal**
  - Estado de ciclo de facturación, comprobantes, historial y revisión de pagos (`facturacion/` + `js/revision_pagos.js` + `js/gestion_empresas.js`).

### 3) Cómo interactúan los módulos con el usuario
- El usuario percibe una app multipágina con menú superior dinámico.
- La autorización se aplica tanto al entrar a página (`guardPage`) como al renderizar opciones de navegación.
- Gran parte de operaciones de escritura pasan por **webhooks n8n** (`js/webhooks.js`) y lecturas directas por Supabase.
- Existen mecanismos de estado temporal en navegador (`localStorage/sessionStorage`) para entorno activo, visibilidad de columnas, caches de UI y datos de pre-registro.

## Hallazgos detectados

### Hallazgo A — Error crítico de ejecución en revisión de pagos (corregido)
Se encontraron declaraciones duplicadas de `setStatus`, `fmtMoney` y `escapeHtml` en `js/revision_pagos.js`, lo que produce `SyntaxError: Identifier has already been declared` al importar el módulo.

**Acción aplicada:** se eliminaron las declaraciones duplicadas dejando una única implementación utilitaria.

### Hallazgo B — Riesgo XSS almacenado en módulo de permisos (corregido)
En `js/permisos.js` se interpolaban `empleado.nombre` y `empleado.rol` directamente en `innerHTML` sin escape previo.

**Acción aplicada:** se agregó `escapeHtml` y se usa al renderizar nombre/rol en la tabla.

### Hallazgo C — Exposición de secretos operativos (pendiente)
`js/supabase.js` contiene URL y `anon key` embebidos en cliente. La `anon key` es pública por diseño en Supabase, pero igual conviene centralizar por entorno para evitar errores de despliegue y facilitar rotación.

### Hallazgo D — Super admin hardcodeado por email/id (pendiente)
La elevación de privilegios contempla `SUPER_ADMIN_EMAIL` y `SUPER_ADMIN_ID` hardcodeados en `js/session.js` y `js/permisos.core.js`.

**Riesgo:** dependencia de credenciales estáticas en frontend. Recomendado mover validación a backend (claims JWT o tabla segura) y minimizar lógica de privilegio en cliente.

### Hallazgo E — Uso intensivo de `innerHTML` (pendiente, parcialmente mitigado)
Múltiples módulos usan `innerHTML` para renderizado dinámico. Aunque en varios sitios ya hay `escapeHtml`, la superficie de ataque sigue amplia. Conviene migrar gradualmente a `textContent`/`createElement` o plantilla con escape automático.

## Recomendaciones priorizadas
1. **Alta prioridad**: validar que `revision_pagos` carga correctamente en entorno real y añadir validación CI de importación de módulos.
2. **Alta prioridad**: auditoría completa de interpolaciones en `innerHTML` (todas las pantallas con datos de usuario o BD).
3. **Media**: mover decisión de super-admin a backend con metadata/claims firmados.
4. **Media**: introducir configuración por entorno (`dev/stage/prod`) para endpoints y llaves públicas.
5. **Media**: añadir pruebas smoke E2E de login, guardas de página y permisos por rol.

## Checks ejecutados en esta revisión
- Búsqueda de superficies sensibles (`fetch`, `innerHTML`, `localStorage`, auth/keys) mediante `rg`.
- Verificación de importación del módulo conflictivo con Node para confirmar el `SyntaxError`.
- Revisión manual de flujos de autenticación, guardas, navegación, permisos y facturación.

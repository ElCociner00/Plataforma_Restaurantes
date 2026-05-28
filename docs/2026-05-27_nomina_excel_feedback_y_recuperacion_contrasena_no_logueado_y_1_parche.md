# Objetivo
Corregir dos frentes: (1) exportación de Excel y feedback visible en nómina, y (2) recuperación/cambio de contraseña cuando el usuario no está logueado, agregando validación por cédula/NIT para solicitar un nuevo enlace válido.

## Archivos implicados y cambios

### `js/nomina.js`
- **Tipo**: modificación de lógica de parsing/validación de exportación.
- **Qué se cambió**:
  - Se robusteció `extractRows` para aceptar respuestas donde el webhook devuelve un **objeto único** exportable (no solo arrays).
  - Se agregó `isExportableRow` para validar que la fila tenga al menos una columna del Excel esperado.
  - Se añadió validación de rango de fechas antes de exportar, con mensaje visible en estado.
- **Objetivo explícito**: evitar falsos negativos “sin filas exportables” cuando sí llega data útil desde webhook y mejorar feedback en UI.

### `configuracion/contrasena.html`
- **Tipo**: modificación de interfaz.
- **Qué se cambió**:
  - Se agregó bloque de validación de identidad con campo **Cédula o NIT** y botón **Verificar**.
- **Objetivo explícito**: dar una ruta visible para usuarios no logueados cuando el enlace de recuperación llega vencido/inválido.

### `js/contrasena_reset_page.js`
- **Tipo**: refactor + nueva lógica de fallback.
- **Qué se cambió**:
  - Se dejó de mostrar error de enlace inválido al entrar “de inmediato” y se cambió por guía de uso.
  - Se agregó flujo de verificación por cédula/NIT:
    1. Buscar en `otros_usuarios.cedula` y usar `correo`.
    2. Si no aparece, buscar en `empleados.cedula`, luego `usuarios_sistema.nombre_completo` para encontrar `correo`.
    3. Con ese correo, solicitar nuevo correo de recuperación (`sendRecoveryForEmail`).
  - `ensureRecoverySession` ahora intenta primero sesión activa (`getSession`) para soportar caso logueado y después tokens recovery.
  - Se agregaron validaciones de contraseña mínima y mensajes de error/estado en frontend.
- **Objetivo explícito**: evitar bloqueo por token inválido para no logueados, sin depender de consola.

## Reversión de emergencia (paso a paso)

1. **Nómina (Excel)**
   - En `js/nomina.js`, dentro de `descargarExcelEmpleado`, eliminar:
     - `isExportableRow`.
     - rama `if (isExportableRow(node)) return [node];`.
     - validación previa de fechas antes de “Solicitando histórico del empleado...”.
   - Dejar `extractRows` solo para arrays como antes.

2. **Pantalla de contraseña**
   - En `configuracion/contrasena.html`, eliminar bloque `#identityBlock` y `#identityHint`.
   - Dejar solo el formulario de nueva contraseña.

3. **Lógica de recuperación**
   - En `js/contrasena_reset_page.js` eliminar:
     - referencias a `sendRecoveryForEmail`.
     - funciones `maskEmail`, `resolveEmailByCedula`, `toggleIdentityByToken`.
     - listener de `verificarCedulaBtn`.
     - validación de largo mínimo (si se quiere volver exacto al estado previo).
   - Restaurar comportamiento original de mostrar error inmediato al no tener tokens.

## Guía para portar este parche a otro repositorio

1. Replicar UI en la página de recuperación:
   - Campo cédula/NIT + botón verificar + hint de estado.
2. Replicar consultas de identidad:
   - `otros_usuarios.cedula -> correo`.
   - fallback `empleados.cedula -> empleados.nombre_completo -> usuarios_sistema.nombre_completo -> correo`.
3. Reutilizar el método existente de recovery de Supabase (`resetPasswordForEmail`) para generar enlace válido.
4. Mantener centralización de URLs del repo destino (equivalente al archivo central de URLs en este repositorio) para evitar hardcodes.
5. En nómina, validar compatibilidad con respuesta del webhook:
   - soportar array y objeto único.
   - validar columnas esperadas del Excel.

## Particularidades de este repositorio
- Existe centralización de endpoints/URLs (`js/urls.js` y módulos relacionados). Verificar que cualquier repo destino tenga patrón equivalente antes de portar.
- Nómina usa webhook + fallback de normalización; cualquier parser nuevo debe convivir con payloads heterogéneos.

## Check funcional (estado del parche)
- **Nómina / Descargar Excel empleado**: funciona para array y objeto exportable; muestra mensaje de estado en UI.
- **Nómina / Validaciones visibles**: funciona (empleado requerido y fechas requeridas para exportación).
- **Recuperación no logueado**: funciona con verificación por cédula/NIT para reenviar enlace.
- **Cambio de contraseña**: funciona con sesión existente o con tokens de recovery válidos.
- **Pendiente conocido**: si no existe correo asociado al match de cédula/NIT en BD, se informa error y requiere corrección de datos maestros.

---

# Parche posterior 1 - 2026-05-28

## Objetivo del parche
Corregir la cadena de verificación de recuperación de contraseña para que no muera después de consultar `otros_usuarios`, migrar Loggro al nuevo formato de credenciales y agregar el nuevo módulo Credibanco dentro de **Configuración > Apis e integraciones**.

## Archivos implicados y cambios del parche

### `js/contrasena_reset_page.js`
- **Tipo**: corrección de lógica de fallback.
- **Qué se cambió**:
  - `otros_usuarios` ahora se consulta por `cedula` usando solo campos propios (`id`, `nombre_completo`, `cedula`) y no intenta leer `correo` directamente desde esa tabla.
  - Si hay coincidencia en `otros_usuarios`, se resuelve el correo en `usuarios_sistema` por `id` y luego por `nombre_completo`.
  - Si no hay coincidencia o no hay correo resoluble desde `otros_usuarios`, el proceso continúa a `empleados.cedula` y luego a `usuarios_sistema.nombre_completo`.
  - Se agregan pasos visibles en el `hint` para saber en qué etapa quedó la validación.
- **Objetivo explícito**: evitar que el flujo se detenga en `otros_usuarios` cuando no corresponde a ese tipo de usuario o cuando el correo está centralizado en `usuarios_sistema`.

### `configuracion/loggro.html`
- **Tipo**: migración de formulario.
- **Qué se cambió**:
  - Se reemplazaron campos Token/URL por Correo de Loggro y Contraseña de Loggro.
  - Se agregó botón de ojito para mostrar/ocultar contraseña.
- **Objetivo explícito**: alinear el módulo Loggro con el formato actualizado del repositorio de pruebas.

### `css/loggro.css`
- **Tipo**: ajuste visual reutilizable.
- **Qué se cambió**:
  - Se centró el formulario/campos y se añadieron estilos para `.password-wrap` y `.btn-ojito`.
- **Objetivo explícito**: soportar el nuevo campo de contraseña de Loggro y reutilizar el formato visual en Credibanco.

### `js/loggro.js`
- **Tipo**: migración de payload.
- **Qué se cambió**:
  - El payload ahora envía `plataforma: "loggro"`, `url: "loggro.com"`, `correo` y `password`.
  - Mantiene `empresa_id`, `tenant_id`, `usuario_id`, `registrado_por` y `timestamp`.
  - Sigue usando `WEBHOOK_REGISTRO_CREDENCIALES`, apuntando a `https://n8n.enkrato.com/webhook/registro_credenciales`.
- **Objetivo explícito**: guardar credenciales con la nueva estructura definida para Loggro.

### `configuracion/credibanco.html`
- **Tipo**: nuevo módulo.
- **Qué hace**:
  - Formulario para Client ID y Client Secret.
  - Usa el mismo patrón visual/guardias/scripts que Loggro.
- **Objetivo explícito**: habilitar registro de credenciales Credibanco desde Configuración.

### `js/credibanco.js`
- **Tipo**: nuevo módulo funcional.
- **Qué hace**:
  - Lee contexto de sesión/tenant.
  - Envía `client_id`, `client_secret`, `tenant_id`, `empresa_id`, `usuario_id`, `registrado_por`, `timestamp` y `plataforma: "credibanco"`.
  - POST a `WEBHOOK_REGISTRAR_CREDIBANCO`.
- **Objetivo explícito**: registrar Credibanco contra `https://n8n.enkrato.com/webhook/registrar_credibanco`.

### `js/webhooks.js`
- **Tipo**: centralización de URL.
- **Qué se cambió**:
  - Se agregó `WEBHOOK_REGISTRAR_CREDIBANCO`.
- **Objetivo explícito**: evitar hardcodear la URL de Credibanco fuera del centralizador de webhooks.

### `configuracion/index.html`
- **Tipo**: navegación.
- **Qué se cambió**:
  - Se agregó enlace `Credibanco` dentro de **Apis e integraciones**.
- **Objetivo explícito**: permitir acceso al nuevo módulo desde Configuración.

### `js/urls.js`
- **Tipo**: centralización de rutas internas.
- **Qué se cambió**:
  - Se agregó `APP_URLS.credibanco`.
- **Objetivo explícito**: dejar la ruta disponible en el centralizador de URLs del repositorio.

## Reversión de emergencia del parche 1

1. **Recuperación de contraseña**
   - En `js/contrasena_reset_page.js`, revertir la función `resolveEmailByCedula` y helpers `firstRowByCedula` / `firstUsuarioSistemaBy` si se quiere volver al fallback anterior.
   - Si el problema es solo visual, conservar la lógica y ajustar únicamente los mensajes `setHint` / `setEstado`.

2. **Loggro**
   - En `configuracion/loggro.html`, restaurar los campos `loggroToken` y `loggroUrl`.
   - En `js/loggro.js`, restaurar referencias a `tokenInput` y `urlInput` y volver a payload `{ token, url }`.
   - En `css/loggro.css`, se pueden dejar los estilos nuevos porque no rompen el formulario anterior; si se desea limpieza total, eliminar `.password-wrap`, `.btn-ojito` y el centrado añadido.

3. **Credibanco**
   - Borrar `configuracion/credibanco.html` y `js/credibanco.js`.
   - Quitar `WEBHOOK_REGISTRAR_CREDIBANCO` de `js/webhooks.js`.
   - Quitar el enlace `Credibanco` de `configuracion/index.html`.
   - Quitar `credibanco` de `APP_URLS` en `js/urls.js`.

## Guía para portar el parche 1 a otro repositorio

1. Verificar que el repo destino centralice endpoints como este repo en `js/webhooks.js`; si no, crear una constante equivalente para `registrar_credibanco`.
2. Verificar que el repo destino centralice rutas internas como este repo en `js/urls.js`; agregar ruta `credibanco` si existe centralizador.
3. Portar primero el CSS común (`css/loggro.css`) para que Loggro y Credibanco compartan formato.
4. Portar `configuracion/loggro.html` + `js/loggro.js` y validar que el webhook acepte `correo`/`password`.
5. Portar `configuracion/credibanco.html` + `js/credibanco.js` y validar que el webhook acepte `client_id`/`client_secret`/`tenant_id`.
6. En recuperación de contraseña, confirmar nombres exactos de columnas:
   - `otros_usuarios.cedula`, `otros_usuarios.id`, `otros_usuarios.nombre_completo`.
   - `empleados.cedula`, `empleados.nombre_completo`.
   - `usuarios_sistema.id`, `usuarios_sistema.nombre_completo`, `usuarios_sistema.correo`.

## Check funcional del parche 1
- **Recuperación no logueado**: corregido para continuar de `otros_usuarios` a `empleados` cuando no hay match/correo resoluble.
- **Loggro**: actualizado a correo/contraseña y endpoint `registro_credenciales`.
- **Credibanco**: creado y enlazado desde Configuración > Apis e integraciones.
- **Centralización**: Credibanco quedó en `js/webhooks.js` y `js/urls.js`.
- **Pendiente operativo**: la actualización de contraseña sigue dependiendo de un token válido de Supabase Auth; la verificación por cédula/NIT reenvía el enlace correcto y no debe crear tokens arbitrarios en frontend por seguridad.

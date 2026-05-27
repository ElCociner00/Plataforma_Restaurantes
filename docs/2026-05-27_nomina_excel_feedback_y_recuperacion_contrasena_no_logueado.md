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

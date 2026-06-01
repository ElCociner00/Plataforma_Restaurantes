# 2026-06-01 - Parche Excel nómina y módulo Añadir local

## 1. Objetivo de la petición

Corregir dos puntos operativos detectados después del último despliegue:

1. Ajustar la descarga de **Excel empleado** en nómina para que:
   - El archivo tenga un nombre presentable basado en el empleado consultado y el periodo.
   - Exporte todas las filas devueltas por el webhook aunque lleguen dentro de estructuras anidadas como `[{ data: [...] }]`.
   - Deje la columna de comentarios al final del Excel.
2. Crear un nuevo módulo autenticado **Añadir local** accesible desde el menú de usuario del header para registrar una sede/local dependiente de una empresa existente, dejando URLs y webhooks recomendados para conectar posteriormente el flujo real de BD/tenant/duplicación de usuarios.

## 2. Archivos implicados, modificaciones y objetivo de cada cambio

### `js/nomina.js` (modificado)

- **Tipo de modificación:** parche de exportación de Excel empleado.
- **Objetivo:** corregir el nombre del archivo y la extracción de filas históricas.
- **Qué hace explícitamente:**
  - Busca el empleado seleccionado en `state.responsables` para construir el nombre del archivo.
  - Genera el nombre como `Empleado_YYYY-MM-DD_a_YYYY-MM-DD.xls`, sanitizando caracteres no seguros.
  - Reordena columnas para que `comentarios` quede al final.
  - Agrega alias para comentarios: `comentarios`, `comentario`, `observaciones`, `observacion`.
  - Cambia `extractRows` para recorrer recursivamente objetos y arreglos anidados, evitando que respuestas tipo `[{ data: [...] }]` exporten solo una fila o ninguna.
  - Aplica el mismo nombre presentable tanto si el webhook responde JSON/HTML transformado localmente como si responde blob Excel directo.

### `configuracion/anadir_local.html` (creado)

- **Tipo de modificación:** nueva pantalla autenticada.
- **Objetivo:** registrar una sede/local dependiente de la empresa activa.
- **Qué hace explícitamente:**
  - Replica la idea del formulario de `registro/index.html`, pero dentro de configuración y con contexto autenticado.
  - Solicita nombre comercial del local, razón social/sede, NIT o identificador tributario y correo administrativo.
  - Exige confirmación de autorización/políticas.
  - Carga `router.js` y `header.js`, por lo que queda protegido por sesión.
  - Carga `js/anadir_local.js` para ejecutar el flujo recomendado de verificación/registro.

### `configuracion/anadir_local_usuario.html` (creado)

- **Tipo de modificación:** nueva pantalla autenticada de segundo paso.
- **Objetivo:** dejar preparado el paso posterior al registro del local, equivalente al flujo de usuario administrador del registro público, pero orientado a futuro tenant/duplicación de usuarios.
- **Qué hace explícitamente:**
  - Solicita nombre, correo y contraseña temporal/inicial.
  - Usa datos del local guardados en `sessionStorage` por el paso anterior.
  - Queda lista para que el webhook de BD duplique usuarios de la empresa matriz hacia el nuevo tenant.

### `js/anadir_local.js` (creado)

- **Tipo de modificación:** nuevo controlador frontend.
- **Objetivo:** coordinar el registro de local dependiente.
- **Qué hace explícitamente:**
  - Resuelve `getUserContext()` para obtener `empresa_matriz_id` y usuario solicitante.
  - Bloquea el formulario si el usuario no tiene rol `admin` o `admin_root`.
  - Valida NIT/código como numéricos con `enforceNumericInput`.
  - Envía código al webhook recomendado `WEBHOOK_CREAR_CODIGO_VERIFICACION_LOCAL`.
  - Verifica código con `WEBHOOK_VERIFICAR_CODIGO_LOCAL`.
  - Registra el local con `WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE`.
  - Guarda `local_dependiente_nit`, `local_dependiente_correo` y opcionalmente `local_dependiente_empresa_id` en `sessionStorage`.
  - Redirige al segundo paso `APP_URLS.anadirLocalUsuario`.

### `js/anadir_local_usuario.js` (creado)

- **Tipo de modificación:** nuevo controlador frontend.
- **Objetivo:** preparar el segundo paso del flujo de nuevo local.
- **Qué hace explícitamente:**
  - Resuelve contexto de sesión, exige empresa activa y limita el acceso a roles `admin` o `admin_root`.
  - Lee `local_dependiente_nit`, `local_dependiente_correo` y `local_dependiente_empresa_id` desde `sessionStorage`.
  - Prellena/sugiere el correo administrativo del local.
  - Envía payload a `WEBHOOK_DUPLICAR_USUARIOS_LOCAL` con datos de local, empresa matriz, usuario solicitante y administrador inicial.
  - Limpia `sessionStorage` si el webhook responde éxito.

### `js/urls.js` (modificado)

- **Tipo de modificación:** rutas centralizadas nuevas.
- **Objetivo:** que el módulo use el mapa central de URLs del repositorio.
- **Qué hace explícitamente:**
  - Añade `APP_URLS.anadirLocal` con `/configuracion/anadir_local.html`.
  - Añade `APP_URLS.anadirLocalUsuario` con `/configuracion/anadir_local_usuario.html`.

### `js/webhooks.js` (modificado)

- **Tipo de modificación:** URLs recomendadas nuevas.
- **Objetivo:** dejar rutas de n8n únicas y semánticas, sin repetir las existentes del registro público.
- **Qué hace explícitamente:**
  - Recomienda `https://n8n.enkrato.com/webhook/locales/crear_codigo_verificacion`.
  - Recomienda `https://n8n.enkrato.com/webhook/locales/verificar_codigo`.
  - Recomienda `https://n8n.enkrato.com/webhook/locales/registrar_local_dependiente`.
  - Recomienda `https://n8n.enkrato.com/webhook/locales/duplicar_usuarios`.

### `js/header.js` (modificado)

- **Tipo de modificación:** navegación.
- **Objetivo:** exponer el nuevo módulo desde el acordeón/menú de usuario del header.
- **Qué hace explícitamente:**
  - Añade enlace `Añadir local` dentro del dropdown de usuario para roles `admin_root` y `admin`.
  - Mantiene las opciones existentes: Gestión usuarios, Configuración, cambio de entorno Siigo/Loggro y Salir.

## 3. Notas de emergencia para revertir estos cambios

### Revertir solo el Excel de nómina

1. En `js/nomina.js`, ubicar la función `descargarExcelEmpleado`.
2. Restaurar el arreglo de `headers` anterior si se requiere el orden viejo:

```js
const headers = [
  "fecha_turno", "hora_inicio", "hora_fin", "Momento", "comentarios", "domicilios",
  "efectivo_inicial", "propinas", "ventas_brutas", "bolsas", "caja_final", "diferencia_caja"
];
```

3. Restaurar `extractRows` a la lógica anterior solo si se confirma que el webhook ya no devuelve anidados. No se recomienda porque volvería a fallar con `[{ data: [...] }]`.
4. Cambiar `link.download = buildExcelFilename();` por el nombre anterior si se necesita rollback exacto:

```js
link.download = `historico_empleado_${empleadoId}_${fechaInicioInput.value || "inicio"}_${fechaFinInput.value || "fin"}.xls`;
```

### Revertir el módulo Añadir local

1. Eliminar los archivos creados:
   - `configuracion/anadir_local.html`
   - `configuracion/anadir_local_usuario.html`
   - `js/anadir_local.js`
   - `js/anadir_local_usuario.js`
2. En `js/urls.js`, borrar:

```js
anadirLocal: buildAppPath("/configuracion/anadir_local.html"),
anadirLocalUsuario: buildAppPath("/configuracion/anadir_local_usuario.html"),
```

3. En `js/webhooks.js`, borrar las constantes:
   - `WEBHOOK_CREAR_CODIGO_VERIFICACION_LOCAL`
   - `WEBHOOK_VERIFICAR_CODIGO_LOCAL`
   - `WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE`
   - `WEBHOOK_DUPLICAR_USUARIOS_LOCAL`
4. En `js/header.js`, retirar el fragmento:

```html
<a href="${APP_URLS.anadirLocal}">Añadir local</a>
```

5. Limpiar cualquier dato temporal del navegador si quedó un flujo incompleto:

```js
sessionStorage.removeItem("local_dependiente_nit");
sessionStorage.removeItem("local_dependiente_correo");
sessionStorage.removeItem("local_dependiente_empresa_id");
```

## 4. Indicaciones para exportar este cambio a otro repositorio

Este repositorio centraliza rutas en `js/urls.js` y webhooks en `js/webhooks.js`. Para portar este parche correctamente:

1. Copiar primero los controladores:
   - `js/anadir_local.js`
   - `js/anadir_local_usuario.js`
2. Copiar las vistas:
   - `configuracion/anadir_local.html`
   - `configuracion/anadir_local_usuario.html`
3. Registrar rutas equivalentes en el archivo central del destino:

```js
anadirLocal: buildAppPath("/configuracion/anadir_local.html"),
anadirLocalUsuario: buildAppPath("/configuracion/anadir_local_usuario.html"),
```

4. Registrar webhooks equivalentes, priorizando nombres semánticos y no reutilizando los del registro público:

```js
WEBHOOK_CREAR_CODIGO_VERIFICACION_LOCAL
WEBHOOK_VERIFICAR_CODIGO_LOCAL
WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE
WEBHOOK_DUPLICAR_USUARIOS_LOCAL
```

5. Añadir el enlace en el header o menú autenticado del repo destino. Si el destino tiene permisos granulares, crear un permiso `anadir_local` o limitar por rol administrador.
6. Portar el bloque corregido de `descargarExcelEmpleado` en `js/nomina.js`, verificando que el destino también reciba respuestas anidadas tipo `[{ data: [...] }]`.
7. Validar que el destino tenga `getUserContext`, `enforceNumericInput`, `APP_URLS` y el patrón de `sessionStorage`. Si no existen, adaptar esos conectores antes de copiar.

## 5. Checklist funcional / logs

- ✅ Nómina / Excel empleado: nombre de archivo ahora usa empleado y periodo.
- ✅ Nómina / Excel empleado: extractor recursivo soporta `[{ data: [...] }]` y otras estructuras anidadas.
- ✅ Nómina / Excel empleado: columna `comentarios` queda al final.
- ✅ Header: `Añadir local` aparece en el menú de usuario para administradores.
- ✅ Añadir local: pantalla creada y protegida por router/header autenticado más validación de rol admin/admin_root.
- ✅ Añadir local: webhooks recomendados quedaron centralizados y no repiten los del registro público.
- ⚠️ Añadir local / BD: los webhooks son rutas recomendadas pendientes de implementar/conectar en n8n y BD.
- ⚠️ Duplicación de usuarios por tenant: el frontend deja el payload listo, pero la lógica real depende del flujo futuro en BD/n8n.

## 6. Validaciones realizadas

- `node --check` sobre `js/nomina.js`, `js/anadir_local.js`, `js/anadir_local_usuario.js`, `js/urls.js`, `js/webhooks.js` y `js/header.js`.
- Parseo HTML con `HTMLParser` sobre las dos nuevas vistas de configuración.
- Prueba local de lógica equivalente para confirmar que `[{ data: [...] }]` produce todas las filas exportables.
- `git diff --check` sin errores de whitespace.

---

# Parche posterior 1 - 2026-06-01

## 1. Objetivo del parche

Atender correcciones posteriores al parche inicial de Excel nómina y Añadir local:

1. Cambiar la recuperación de contraseña para usuario no logueado: la verificación de cédula/NIT ya no consulta tablas frontend, sino que envía el identificador a `https://n8n.enkrato.com/webhook/verificar_nit_cedula` y usa `data.ok` para decidir si puede emitir token de recuperación.
2. Ajustar Añadir local para reutilizar los webhooks existentes de envío y verificación de código del registro público, manteniendo solo webhooks nuevos para registrar local y preparar duplicación de usuarios.
3. Forzar que el local use el mismo NIT de la empresa principal, cargándolo desde `empresas` y dejándolo de solo lectura.
4. Mejorar el nombre del Excel empleado para evitar nombres con extensiones/dominios como `.com`.

## 2. Archivos implicados y modificaciones realizadas

### `js/contrasena_reset_page.js` (modificado)

- **Tipo:** refactor de verificación de identidad no logueada.
- **Objetivo:** mover la validación de cédula/NIT al webhook externo definido por el usuario.
- **Qué hace explícitamente:**
  - Elimina el flujo frontend que buscaba en `otros_usuarios`, `empleados` y `usuarios_sistema`.
  - Envía `identificador`, `cedula_o_nit`, `cedula`, `nit` y `origen` a `WEBHOOK_VERIFICAR_NIT_CEDULA`.
  - Si `data.ok !== true`, no emite token y muestra mensaje de rechazo.
  - Si `data.ok === true`, intenta tomar correo/login desde `email`, `correo`, `correo_usuario`, `correo_login`, `login`, `usuario.email`, `usuario.correo`, `data.email`, `data.correo` o `data.login`.
  - Si hay correo, llama `sendRecoveryForEmail(email)` para emitir token de Supabase.
  - Si el webhook aprueba pero no devuelve correo/login, muestra una instrucción clara para que n8n devuelva ese dato.
  - Después de actualizar contraseña redirige a `APP_URLS.login`, respetando que el login ahora está en `/inicio/`.

### `js/webhooks.js` (modificado)

- **Tipo:** ajuste de constantes centralizadas.
- **Objetivo:** centralizar el nuevo webhook de validación y corregir los webhooks de Añadir local.
- **Qué hace explícitamente:**
  - Agrega `WEBHOOK_VERIFICAR_NIT_CEDULA = "https://n8n.enkrato.com/webhook/verificar_nit_cedula"`.
  - Elimina las constantes exclusivas de envío/verificación de código de local porque ese flujo reutiliza `WEBHOOK_CREAR_CODIGO_VERIFICACION` y `WEBHOOK_VERIFICAR_CODIGO`.
  - Mantiene `WEBHOOK_REGISTRO_LOCAL_DEPENDIENTE` y `WEBHOOK_DUPLICAR_USUARIOS_LOCAL` porque esos sí son flujos nuevos.

### `js/anadir_local.js` (modificado)

- **Tipo:** corrección funcional del módulo Añadir local.
- **Objetivo:** reutilizar webhooks de código existentes y garantizar que el local use el NIT de la empresa principal.
- **Qué hace explícitamente:**
  - Importa `WEBHOOK_CREAR_CODIGO_VERIFICACION` y `WEBHOOK_VERIFICAR_CODIGO` en lugar de webhooks de código exclusivos de local.
  - Consulta `empresas` por `context.empresa_id` para obtener `nit` de la empresa principal.
  - Rellena `nitInput` con ese NIT, lo marca como `readOnly` y usa ese valor en el payload `datosLocal.nit`.
  - Bloquea el flujo si no puede cargar el NIT de la empresa matriz.

### `configuracion/anadir_local.html` (modificado)

- **Tipo:** ajuste de UI.
- **Objetivo:** evitar que el usuario escriba un NIT diferente para un local.
- **Qué hace explícitamente:**
  - Cambia el placeholder a `NIT de la empresa principal`.
  - Marca el campo como `readonly`.
  - Añade nota indicando que los locales comparten el mismo NIT tributario de la empresa principal.

### `js/nomina.js` (modificado)

- **Tipo:** mejora de nombre de archivo.
- **Objetivo:** evitar nombres impresentables como `admin_normal.com_2025-12-02_a_2026-06-01.xls`.
- **Qué hace explícitamente:**
  - Agrega `removeEmailDomainNoise` para convertir `@` a `_` y eliminar sufijos finales `.com`, `.co`, `.net`, `.org`, `.edu`, `.es`.
  - Cambia `normalizeFilePart` para convertir puntos internos a `_`.
  - El nombre del empleado en el archivo ahora se construye con `stripDomain: true`, por lo que `admin_normal.com` queda como `admin_normal`.

## 3. Notas de emergencia para revertir este parche

### Revertir recuperación de contraseña por webhook

1. En `js/contrasena_reset_page.js`, restaurar el flujo anterior de consultas a Supabase (`firstRowByCedula`, `firstUsuarioSistemaBy`, `resolveEmailByCedula`).
2. Quitar imports añadidos:

```js
import { APP_URLS } from "./urls.js";
import { WEBHOOK_VERIFICAR_NIT_CEDULA } from "./webhooks.js";
import { enforceNumericInput } from "./input_utils.js";
```

3. En `js/webhooks.js`, borrar:

```js
export const WEBHOOK_VERIFICAR_NIT_CEDULA =
  "https://n8n.enkrato.com/webhook/verificar_nit_cedula";
```

### Revertir NIT compartido y webhooks reutilizados en Añadir local

1. En `js/anadir_local.js`, volver a importar webhooks exclusivos de local si se decide crear flujos separados para código.
2. En `configuracion/anadir_local.html`, quitar `readonly` del input `nit` si se decide permitir NIT propio.
3. En `js/anadir_local.js`, quitar la consulta a `empresas` y volver a usar `nitInput.value.trim()` directamente.

### Revertir mejora de nombre Excel

1. En `js/nomina.js`, dentro de `descargarExcelEmpleado`, quitar `removeEmailDomainNoise`.
2. Volver a llamar `normalizeFilePart(empleadoNombre, "empleado")` sin `{ stripDomain: true }`.

## 4. Indicaciones para exportar este parche a otro repositorio

1. Portar primero `js/webhooks.js` o el archivo equivalente de webhooks centralizados:
   - Agregar `WEBHOOK_VERIFICAR_NIT_CEDULA`.
   - Reutilizar webhooks existentes de crear/verificar código para Añadir local.
   - Mantener webhooks nuevos solo para registro local y duplicación de usuarios.
2. Portar `js/contrasena_reset_page.js` verificando que el repositorio destino tenga:
   - `sendRecoveryForEmail`.
   - `APP_URLS.login` o ruta central equivalente.
   - `enforceNumericInput` o una validación local equivalente.
3. Portar `js/anadir_local.js` verificando que exista tabla/consulta de empresa matriz con campo `nit`.
4. Portar `configuracion/anadir_local.html` para que el input `nit` quede `readonly`.
5. Portar la mejora de `js/nomina.js` dentro de `descargarExcelEmpleado`, especialmente `removeEmailDomainNoise` y `normalizeFilePart(..., { stripDomain: true })`.

## 5. Checklist funcional / logs del parche 1

- ✅ Recuperación no logueada: ahora verifica cédula/NIT por webhook `verificar_nit_cedula`.
- ✅ Recuperación no logueada: solo emite token si `data.ok === true` y hay correo/login en la respuesta.
- ✅ Recuperación no logueada: redirige a `APP_URLS.login` después de cambiar contraseña.
- ✅ Añadir local: envío y verificación de código reutilizan webhooks públicos existentes.
- ✅ Añadir local: el NIT se carga desde empresa principal y queda de solo lectura.
- ✅ Excel nómina: nombres tipo `admin_normal.com` se normalizan a `admin_normal` antes del periodo.
- ⚠️ Recuperación no logueada: si n8n responde `ok: true` sin correo/login, el frontend no puede emitir token y muestra instrucción para devolver ese dato.

## 6. Validaciones realizadas para el parche 1

- `node --check` sobre `js/contrasena_reset_page.js`, `js/anadir_local.js`, `js/nomina.js`, `js/webhooks.js` y archivos relacionados.
- Prueba local Node de normalización de nombre Excel (`admin_normal.com` → `admin_normal`).
- Parseo HTML de `configuracion/anadir_local.html`.
- `git diff --check` sin errores de whitespace.

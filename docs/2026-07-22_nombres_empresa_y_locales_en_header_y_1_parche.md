# 2026-07-22 - Nombres de empresa y locales en header y 1 parche

## 1. Objetivo

Aplicar un parche posterior al ajuste de nombres de empresa/local para corregir la duplicación visual en selectores de cambio de local, especialmente en el preselector con `localPreselectorList`, sin hardcodear IDs ni nombres de clientes.

El objetivo puntual es que:

- La empresa principal se identifique por `empresas.id = grupos_empresariales.grupo_id`.
- Cada local se identifique por `empresas.id = grupos_empresariales.empresa_id`.
- El nombre visible de cada opción venga de `empresas.nombre_comercial`, usando `razon_social` o el nombre de grupo solo como fallback.
- El `usuario_id` de un local venga de `usuarios_locales.id` cuando exista el duplicado del usuario principal para ese tenant/local.

## 2. Archivos implicados y modificaciones

### `js/header.js` (revertido respecto al intento anterior)

- **Tipo de modificación:** reversión de la modificación previa intrusiva.
- **Objetivo:** respetar la regla de no dejar cambios directos en el header para este parche.
- **Qué hace explícitamente:** vuelve al comportamiento previo del header y deja que el menú consuma los contextos correctos entregados por `js/local_context_switcher.js`.

### `js/session.js` (revertido respecto al intento anterior)

- **Tipo de modificación:** reversión de la modificación previa intrusiva.
- **Objetivo:** no modificar el archivo central de sesión/contexto para resolver un problema visual y operativo del selector.
- **Qué hace explícitamente:** retira los campos agregados al contexto global en el intento anterior y mantiene la sesión con su contrato previo.

### `js/local_context_switcher.js` (modificado)

- **Tipo de modificación:** corrección aislada del switcher de locales.
- **Objetivo:** construir contextos de empresa principal/local con nombres e IDs de usuario verídicos.
- **Qué hace explícitamente:**
  - Consulta `empresas` por los IDs visibles (`grupo_id` para principal y `empresa_id` para locales) para obtener `nombre_comercial` / `razon_social`.
  - Consulta `usuarios_locales` también para `admin_root`, no solo para otros roles, para poder usar el duplicado real del usuario local cuando existe.
  - En locales, usa `usuarios_locales.id` como `usuario_id` si hay coincidencia por `usuario_principal_id` + `empresa_id`; si no existe duplicado, conserva fallback al usuario principal para no bloquear el selector.
  - Mantiene fallback a `grupos_empresariales` si la consulta secundaria a `empresas` falla por RLS o por otra limitación.

### `js/local_preselector.js` (modificado)

- **Tipo de modificación:** cambio de fuente de datos del preselector DOM.
- **Objetivo:** que el submódulo que renderiza `#localPreselectorList` use la misma lista corregida que el header, sin depender de `js/session.js`.
- **Qué hace explícitamente:**
  - Importa `listLocalContextsForSwitcher()` y `prepareLocalContextSwitch()` desde `js/local_context_switcher.js`.
  - Renderiza las opciones del preselector con los nombres resueltos desde `empresas`.
  - Al escoger un local, prepara la selección con el mecanismo aislado del switcher y luego continúa el flujo normal de redirección.

## 3. Notas de emergencia para revertir

### Revertir `js/local_preselector.js`

1. Cambiar el import superior por el anterior:
   ```js
   import { listAvailableLocalContexts, switchLocalContext } from "./session.js";
   ```
2. En `chooseContext()`, reemplazar:
   ```js
   await prepareLocalContextSwitch(empresaId);
   ```
   por:
   ```js
   await switchLocalContext(empresaId);
   ```
3. En `loadContexts()` y en el botón continuar, reemplazar:
   ```js
   listLocalContextsForSwitcher()
   ```
   por:
   ```js
   listAvailableLocalContexts()
   ```

### Revertir `js/local_context_switcher.js`

1. En `listLocalContextsForSwitcher()`, volver a evitar la consulta de `usuarios_locales` para `admin_root`:
   ```js
   const usuariosLocales = adminRoot
     ? []
     : await fetchUsuariosLocales({ principalUserId, localEmpresaIds });
   ```
2. Eliminar el `Map` `usuarioLocalByEmpresaId` y volver a construir `rowsForMenu` con `id: principalUserId` para `admin_root`.
3. Si se desea volver al fallback anterior de nombres, cambiar `fetchEmpresasByIds()` para que retorne `[]` siempre. No recomendado porque reproduce nombres duplicados cuando `grupos_empresariales.nombre_grupo` contiene el nombre de la principal.

### Revertir `js/header.js` y `js/session.js`

No hay una reversión adicional necesaria para este parche porque ambos archivos se devuelven al comportamiento anterior al intento intrusivo.

## 4. Guía para exportar el parche a otro repositorio

Este repositorio centraliza:

- Rutas en `js/urls.js`; este parche no agrega rutas ni URLs.
- Sesión y headers de requests en `js/session.js`; este parche evita depender de cambios nuevos allí.
- Selector aislado de locales en `js/local_context_switcher.js`.
- Preselector DOM en `js/local_preselector.js`.

Para portar el parche:

1. Verificar que el repositorio destino tenga `empresas.id`, `empresas.nombre_comercial` y `empresas.razon_social`.
2. Verificar que `grupos_empresariales.empresa_id` apunte al tenant/local y `grupos_empresariales.grupo_id` apunte a la empresa principal.
3. Verificar que `usuarios_locales.usuario_principal_id` sea el ID del usuario principal de `usuarios_sistema.id`, y que `usuarios_locales.empresa_id` sea el tenant/local.
4. Portar `js/local_context_switcher.js` primero, porque ahí queda centralizada la resolución correcta de nombres y usuario local duplicado.
5. Portar `js/local_preselector.js` después, cambiando su fuente desde sesión al switcher aislado.
6. No modificar `js/urls.js` salvo que el repositorio destino tenga rutas distintas para el preselector.
7. Validar en consola que `listLocalContextsForSwitcher()` devuelva objetos con:
   - Principal: `tipo: "principal"`, `empresa_id` igual al ID de `empresas` principal, `nombre` tomado de `empresas.nombre_comercial`.
   - Local: `tipo: "local"`, `empresa_id` igual a `grupos_empresariales.empresa_id`, `nombre` tomado de `empresas.nombre_comercial`, `usuario_id` tomado de `usuarios_locales.id` cuando exista.

## 5. Check funcional del parche

- Preselector `localPreselectorList`: corregido para consumir nombres desde el switcher aislado.
- Header switcher: corregido desde la fuente `listLocalContextsForSwitcher()` sin tocar el render del header.
- Nombres empresa/local: funcionan si RLS permite leer `empresas`; si no, queda fallback no bloqueante.
- Usuario local duplicado: se usa `usuarios_locales.id` cuando existe coincidencia por usuario principal y empresa/local.
- Login: no modificado.
- Sesión/contexto central: revertido al estado previo al intento anterior.
- URLs centralizadas: no modificadas.
- Webhooks: no modificados.

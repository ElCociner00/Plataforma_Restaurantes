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

---

## Parche posterior #2 — 2026-07-22 — Blindaje visual para no exponer tenant IDs en locales de nómina

## 1. Objetivo de la petición
Corregir de forma urgente la exposición visual de `tenant_id` / `empresa_id` en el selector de locales del header, el preselector y el submódulo de selección de locales de nómina. El objetivo es que clientes y usuarios finales vean nombres comerciales o razones sociales y no UUIDs técnicos, manteniendo los IDs solo en payloads internos necesarios para operar el sistema.

## 2. Archivos implicados y modificación realizada

### `js/local_context_switcher.js` (modificado)

- **Tipo de modificación:** refuerzo aislado de sanitización de etiquetas visibles.
- **Objetivo:** evitar que los fallbacks visibles del switcher construyan textos con `empresa_id` / `tenant_id` cuando no se logra resolver un nombre desde `empresas`.
- **Qué hace explícitamente:**
  - Agrega detección de UUID con `UUID_PATTERN` e `isUuidLike()`.
  - Cambia los fallbacks de `getLocalesList()` para usar `Local sin nombre` / `Local sin razón social` en vez de `Local ${empresa_id}`.
  - Cambia `labelForEmpresa()` para preferir `empresas.nombre_comercial` o `empresas.razon_social`, aceptar un fallback funcional cuando no sea UUID y reemplazar cualquier UUID por `Local sin nombre`.
  - Conserva el flujo existente de resolución desde `empresas`; no introduce dependencias desde archivos vitales hacia archivos nuevos.

### `js/nomina.js` (modificado)

- **Tipo de modificación:** blindaje visual y de payload descriptivo en el módulo de nómina.
- **Objetivo:** impedir que el panel `Locales / sedes a consultar` y la columna de sede en detalles muestren UUIDs cuando la fuente traiga `nombre` degradado a `empresa_id`.
- **Qué hace explícitamente:**
  - Agrega `UUID_PATTERN`, `isUuidLike()` y `visibleSedeName()` como helpers locales del módulo.
  - `renderLocalesNomina()` ahora renderiza `visibleSedeName(local)`; si `local.nombre` parece UUID, muestra `Empresa principal` o `Local sin nombre` según el tipo.
  - `resolveSedeName()` usa el mismo blindaje para filas de detalle que llegan con `sede`, `tenant_id` o `empresa_id`.
  - `getSelectedLocalesNomina()` mantiene `tenant_id` y `empresa_id` en el objeto técnico para el webhook, pero el campo descriptivo `nombre` ya no cae a UUID.

### Archivos no modificados por regla de seguridad

- `js/header.js`: no se tocó el render del header; el header queda protegido por consumir la lista ya sanitizada desde `js/local_context_switcher.js`.
- `js/session.js`: no se tocó el contexto central ni la sesión. El blindaje adicional de nómina se hace dentro de `js/nomina.js` porque ese módulo consume `listAvailableLocalContexts()` de sesión y debe proteger su propia UI sin volver intrusivo el cambio.
- Login, sesión, contexto, header y URLs centralizadas: no fueron modificados en este parche.

## 3. Notas de emergencia para revertir

### Revertir `js/local_context_switcher.js`

1. Eliminar estas líneas superiores si se desea retirar la detección de UUID:
   ```js
   const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
   const isUuidLike = (value) => UUID_PATTERN.test(normalizeId(value));
   ```
2. En `getLocalesList()`, revertir los fallbacks si se necesita comportamiento anterior:
   ```js
   nombre: local.local_nombre_comercial || local.local_razon_social || `Local ${local.empresa_id}`,
   razon_social: local.local_razon_social || local.local_nombre_comercial || `Local ${local.empresa_id}`,
   ```
   No recomendado, porque vuelve a exponer IDs técnicos.
3. En `labelForEmpresa()`, reemplazar el bloque sanitizado por:
   ```js
   return String(empresa?.nombre_comercial || empresa?.razon_social || fallback || `Local ${empresaId}`).trim();
   ```
   No recomendado por el mismo riesgo visual.

### Revertir `js/nomina.js`

1. Eliminar los helpers locales `UUID_PATTERN`, `isUuidLike()` y `visibleSedeName()`.
2. En `resolveSedeName()`, volver a:
   ```js
   return found?.nombre || "Sede sin nombre";
   ```
3. En `renderLocalesNomina()`, eliminar `const localLabel = ...` y volver a mostrar:
   ```js
   ${escapeHtml(local.nombre || local.empresa_id || "Sede")}
   ```
   No recomendado, porque reabre la exposición visual de `empresa_id`.
4. En `getSelectedLocalesNomina()`, volver a:
   ```js
   nombre: local.nombre || local.empresa_id || "Sede",
   ```
   No recomendado si logs/webhook visibles pueden ser consultados por usuarios no técnicos.

## 4. Guía para exportar este parche a otro repositorio

Se realizaron cambios puntuales de blindaje visual. Para exportarlos a otro repositorio:

1. Verificar primero si el repositorio destino ya tiene un archivo equivalente a `js/local_context_switcher.js`. Ese archivo debe ser la fuente prioritaria para resolver nombres de principal/local desde `empresas.id -> nombre_comercial / razon_social`.
2. Portar la detección de UUID (`UUID_PATTERN`, `isUuidLike`) en el helper que arma las opciones del switcher, y reemplazar cualquier fallback visible tipo `Local ${empresa_id}` por textos genéricos no sensibles como `Local sin nombre`.
3. Verificar que el repositorio destino tenga un módulo equivalente a `js/nomina.js` con panel de sedes/locales. Añadir un helper local como `visibleSedeName()` para que la UI nunca pinte UUIDs aunque la fuente falle.
4. Mantener `tenant_id` y `empresa_id` en payloads técnicos del webhook si son necesarios para consultas multisede; el cambio solo evita mostrarlos en interfaz o nombres descriptivos.
5. Este repositorio centraliza rutas en `js/urls.js` y webhooks en `js/webhooks.js`; este parche no añade URLs ni endpoints. Si el repositorio destino centraliza URLs en otro archivo, no crear URLs directas en los módulos de nómina o switcher.
6. Validar que no exista otro render alterno del selector de locales que use `empresa_id` como texto visible. Si existe, aplicar el mismo patrón: resolver por `empresas` y sanitizar UUIDs antes de pintar HTML.

## 5. Check funcional del parche

- Header switcher: protegido desde la fuente `listLocalContextsForSwitcher()`; no debería mostrar UUID cuando falte nombre.
- Preselector de locales: protegido al consumir la misma fuente sanitizada del switcher.
- Nómina — panel `Locales / sedes a consultar`: protegido; muestra nombre real o fallback genérico, no `tenant_id`.
- Nómina — detalles con sede: protegido; `resolveSedeName()` no devuelve UUID como nombre visible.
- Nómina — payload técnico multisede: conserva `tenant_id` y `empresa_id` para backend, pero el campo `nombre` descriptivo se sanitiza.
- Login: no modificado.
- Sesión/contexto central: no modificado.
- Header: no modificado.
- URLs y webhooks centralizados: no modificados.

---

## Parche posterior #3 — 2026-07-22 — Nombre real obligatorio y selección local estable

## 1. Objetivo de la petición
Corregir el parche anterior porque el fallback `Local sin nombre` no era una solución aceptable: los locales existen como empresas y su nombre debe resolverse desde `empresas.nombre_comercial` o `empresas.razon_social`. Además, asegurar que al elegir un local no se vuelva al contexto de empresa principal por caché de sesión o por no resolver el usuario local real para `admin_root`.

## 2. Archivos implicados y modificación realizada

### `js/local_context_switcher.js` (modificado)

- **Tipo de modificación:** corrección funcional aislada del switcher de locales.
- **Objetivo:** usar el nombre real del local ya enriquecido desde `empresas` y no caer a `grupos_empresariales.nombre_grupo` ni a textos que indiquen que el local no tiene nombre.
- **Qué hace explícitamente:**
  - `getLocalesList()` deja de usar `Local sin nombre` y usa `Nombre no disponible` únicamente como contingencia extrema no basada en IDs.
  - `listLocalContextsForSwitcher()` pasa como fallback del local `grupo.local_nombre_comercial || grupo.local_razon_social`, valores que fueron cargados desde `empresas` en `fetchGroupLocales()`.
  - `labelForEmpresa()` mantiene prioridad absoluta por `empresas.nombre_comercial` y `empresas.razon_social`; si recibe un UUID como fallback, lo reemplaza por `Nombre no disponible` para no exponer IDs.
  - `switchToLocal()` y `prepareLocalContextSwitch()` ahora intentan resolver `usuarios_locales.id` también para `admin_root`, no solo para roles no admin. Esto mantiene el cambio de usuario local real cuando existe duplicado por tenant/local.

### `js/local_preselector.js` (modificado)

- **Tipo de modificación:** corrección de estabilidad del cambio de contexto.
- **Objetivo:** evitar que después de seleccionar un local el flujo continúe usando el contexto principal cacheado.
- **Qué hace explícitamente:**
  - Importa `clearUserContextCache()` desde `js/session.js`, que ya es una utilidad existente y no un archivo nuevo.
  - Después de `prepareLocalContextSwitch(empresaId)`, limpia la caché de contexto antes de resolver la ruta de entrada a la app.
  - Mantiene el preselector dependiente del switcher aislado y no agrega lógica nueva dentro de `js/session.js` ni `js/header.js`.

### `js/nomina.js` (modificado)

- **Tipo de modificación:** ajuste de texto de contingencia del blindaje visual.
- **Objetivo:** retirar la etiqueta incorrecta `Local sin nombre` del módulo de nómina.
- **Qué hace explícitamente:**
  - `visibleSedeName()` ahora usa `Nombre no disponible` como contingencia si un dato llega vacío o con forma de UUID.
  - `resolveSedeName()` devuelve `Sede no disponible` si no encuentra coincidencia, evitando mostrar IDs técnicos en detalles.
  - El payload técnico conserva `tenant_id`/`empresa_id`; el campo descriptivo `nombre` no cae a UUID.

### Archivos no modificados por regla de seguridad

- `js/header.js`: no se modificó. El header consume `listLocalContextsForSwitcher()` y queda corregido por la fuente.
- `js/session.js`: no se modificó. Solo se reutiliza su función pública existente `clearUserContextCache()` desde el preselector.
- Login, sesión central, contexto central, URLs y webhooks: no fueron modificados.

## 3. Notas de emergencia para revertir

### Revertir `js/local_context_switcher.js`

1. En `listLocalContextsForSwitcher()`, si hay que volver al comportamiento inmediatamente anterior, cambiar:
   ```js
   nombre: labelForEmpresa(row.empresa_id, grupo?.local_nombre_comercial || grupo?.local_razon_social || ""),
   ```
   por:
   ```js
   nombre: labelForEmpresa(row.empresa_id),
   ```
   No recomendado porque puede perder el nombre real ya obtenido desde `empresas` por `fetchGroupLocales()`.
2. En `prepareLocalContextSwitch()` y `switchToLocal()`, si hay que volver a no resolver usuario local para `admin_root`, envolver de nuevo la búsqueda con:
   ```js
   if (!esAdmin) {
     const usuarioLocal = await getLocalUserForTenant(principalUserId, targetEmpresaId);
     if (usuarioLocal) usuarioId = usuarioLocal.id;
   }
   ```
   No recomendado, porque reproduce el caso donde `admin_root` no usa el duplicado real del local.
3. No restaurar fallbacks tipo `Local ${empresa_id}` ni `empresa_id`, porque vuelven a exponer IDs técnicos en UI.

### Revertir `js/local_preselector.js`

1. Quitar el import:
   ```js
   import { clearUserContextCache } from "./session.js";
   ```
2. Quitar la línea posterior a `prepareLocalContextSwitch(empresaId)`:
   ```js
   clearUserContextCache();
   ```
   No recomendado si el preselector vuelve a resolver rutas con contexto cacheado de la empresa principal.

### Revertir `js/nomina.js`

1. Si se quiere volver al texto anterior, reemplazar `Nombre no disponible` por `Local sin nombre` en el helper `visibleSedeName()`.
2. Si se quiere volver al comportamiento inseguro, reemplazar `visibleSedeName(local, "Nombre no disponible")` por `local.nombre || local.empresa_id || "Sede"`. No recomendado porque reexpone `empresa_id`.

## 4. Guía para exportar este parche a otro repositorio

1. Portar primero la lógica de `fetchGroupLocales()` y `listLocalContextsForSwitcher()` para que la relación `grupos_empresariales.grupo_id -> grupos_empresariales.empresa_id` se use solo como relación, y el nombre visible salga de `empresas.id = empresa_id`.
2. Verificar que el repositorio destino no esté usando `grupos_empresariales.nombre_grupo` como nombre del local. Esa columna describe el grupo/empresa principal y no debe pintar la sede local.
3. Portar el cambio de `prepareLocalContextSwitch()` y `switchToLocal()` para consultar `usuarios_locales` también cuando el rol sea `admin_root`; si existe duplicado, debe viajar `usuarios_locales.id`.
4. En el preselector equivalente, limpiar caché de contexto después de escribir la selección local y antes de resolver rutas o redirecciones. En este repositorio se usa `clearUserContextCache()` desde `js/session.js`.
5. En el módulo equivalente a nómina, sanitizar nombres visibles con un helper local: si el nombre está vacío o parece UUID, mostrar una contingencia no sensible y registrar el caso para revisar permisos/RLS de `empresas`.
6. Este repositorio centraliza rutas en `js/urls.js` y webhooks en `js/webhooks.js`; este parche no añade URLs ni endpoints. Si el repositorio destino usa otro archivo centralizador, mantener ahí cualquier ruta y no hardcodear URLs en switcher o nómina.

## 5. Check funcional del parche

- Header switcher: debe mostrar nombres desde `empresas.nombre_comercial` / `empresas.razon_social` entregados por `listLocalContextsForSwitcher()`.
- Preselector de locales: debe mantener el contexto local seleccionado porque limpia caché antes de redirigir.
- Cambio a local como `admin_root`: debe usar `usuarios_locales.id` cuando existe duplicado real.
- Nombres de local: no se deben tomar de `grupos_empresariales.nombre_grupo` como etiqueta visible del local.
- IDs técnicos: no deben mostrarse como nombres visibles; se conservan solo para payloads y atributos técnicos.
- Nómina — panel de sedes: no muestra `tenant_id`/`empresa_id` como texto visible.
- Login: no modificado.
- Sesión/contexto central: no modificado.
- Header: no modificado.
- URLs y webhooks centralizados: no modificados.

---

## Parche posterior #4 — 2026-07-22 — Consulta individual a empresas para nombres de locales

## 1. Objetivo de la petición
Corregir definitivamente el caso donde el selector ya cambia correctamente `empresa_id` y `usuario_id`, pero el nombre visible del local queda en una contingencia como `Nombre no disponible`. La intención es resolver el nombre del local con una consulta directa, separada y verificable a `empresas` usando exactamente el `empresa_id` del local, igual que se hace para la empresa principal.

## 2. Archivos implicados y modificación realizada

### `js/local_context_switcher.js` (modificado)

- **Tipo de modificación:** refuerzo de consulta de datos maestros de empresa/local, aislado en el switcher.
- **Objetivo:** que los nombres visibles del header, selector y preselector salgan de `empresas.nombre_comercial` o `empresas.razon_social` aun cuando la consulta agrupada `.in()` no devuelva el local.
- **Qué hace explícitamente:**
  - Agrega `fetchEmpresaById(empresaId)`, que consulta `empresas` con `.eq("id", empresaId).maybeSingle()` para obtener `id`, `nombre_comercial`, `razon_social` y `activo`.
  - Cambia `fetchEmpresasByIds()` para intentar primero la carga agrupada y luego consultar individualmente cada ID faltante.
  - Mantiene el orden original de IDs al retornar empresas resueltas, para que los mapas de nombres sigan coincidiendo con principal/local.
  - Registra advertencias solo si después de ambos intentos todavía falta algún ID, lo que apunta a un problema de RLS, permisos o datos faltantes en `empresas`.

### Archivos no modificados por regla de seguridad

- `js/header.js`: no se modificó; el header se actualiza porque consume `listLocalContextsForSwitcher()`.
- `js/session.js`: no se modificó; no se alteró el contexto central.
- `js/local_preselector.js`: no se modificó en este parche; sigue consumiendo el switcher y limpiando caché como quedó en el parche #3.
- `js/nomina.js`: no se modificó en este parche; el problema de nombre se resuelve desde la fuente compartida del switcher.
- Login, rutas centralizadas y webhooks: no fueron modificados.

## 3. Notas de emergencia para revertir

### Revertir `js/local_context_switcher.js`

1. Eliminar la función completa:
   ```js
   async function fetchEmpresaById(empresaId) { ... }
   ```
2. En `fetchEmpresasByIds()`, volver al bloque anterior que hacía una sola consulta:
   ```js
   const { data, error } = await supabase
     .from("empresas")
     .select("id, nombre_comercial, razon_social, activo")
     .in("id", ids);
   ```
3. Eliminar el bloque que calcula `missingIds`, ejecuta `Promise.all(missingIds.map(...))` y registra `unresolvedIds`.
4. No recomendado: esa reversión puede reproducir el caso donde la consulta agrupada no devuelve el local y el nombre visible cae a contingencia.

## 4. Guía para exportar este parche a otro repositorio

1. Identificar el helper que resuelve nombres de empresa/local. En este repositorio es `fetchEmpresasByIds()` dentro de `js/local_context_switcher.js`.
2. Agregar una consulta individual equivalente a `fetchEmpresaById(empresaId)` usando la tabla maestra `empresas` y el filtro exacto `id = empresaId`.
3. Mantener la consulta agrupada como optimización, pero nunca depender solo de `.in()` si el selector puede quedar sin nombre; cualquier ID faltante debe consultarse individualmente.
4. Validar que `grupos_empresariales` se use únicamente para relación (`grupo_id` principal, `empresa_id` local) y que el nombre visible salga de `empresas.nombre_comercial` / `empresas.razon_social`.
5. Si el repositorio destino tiene RLS, verificar políticas de lectura para `empresas.id`, `empresas.nombre_comercial` y `empresas.razon_social` tanto para empresa principal como para locales relacionados.
6. Este repositorio centraliza rutas en `js/urls.js` y webhooks en `js/webhooks.js`; este parche no añade endpoints ni cambia URLs.

## 5. Check funcional del parche

- Header switcher: debe mostrar el nombre real del local después de consultar `empresas` por ID individual si la consulta agrupada no lo trajo.
- Preselector de locales: debe recibir los mismos nombres reales desde `listLocalContextsForSwitcher()`.
- Cambio de contexto local: se conserva funcional; no se toca la lógica de selección ni la caché en este parche.
- Usuario local: se conserva funcional; sigue usando `usuarios_locales.id` cuando existe.
- Nombres de local: deben salir de `empresas.nombre_comercial` / `empresas.razon_social`, no de `grupos_empresariales.nombre_grupo`.
- IDs técnicos: se conservan internamente, no como nombre visible.
- Login: no modificado.
- Sesión/contexto central: no modificado.
- Header: no modificado.
- URLs y webhooks centralizados: no modificados.

# 2026-07-22 — Recuperación del switcher de locales y fallback RLS de superadmin

## 1. Objetivo de la petición
Restaurar el selector de empresa principal/locales sin depender de una consulta secundaria a `empresas` que puede fallar por RLS, y ajustar la recuperación RLS para que el superadmin se valide contra `system_users`, tabla aislada donde realmente vive ese usuario global.

## 2. Archivos implicados y modificación realizada
- `js/local_context_switcher.js`: `fetchGroupLocales()` ya no consulta `empresas` para decidir si un local existe antes de mostrarlo. Usa las relaciones activas de `grupos_empresariales` y sus nombres (`nombre_grupo`, `razon_social_grupo`) como fuente suficiente para construir el selector. Esto evita que un 400/RLS de `empresas` oculte locales válidos y deje solo un contexto disponible.
- `js/local_context_switcher.js`: `fetchEmpresasByIds()` queda como fallback no intrusivo que retorna `[]`; el menú usa el nombre del grupo cuando no hay lectura de `empresas`. No muta sesión, contexto ni localStorage.
- `js/header.js`: `obtenerNombreEmpresa()` ahora recibe fallback desde `context.nombre` y lo usa antes de consultar `empresas`, evitando un request 400 innecesario cuando la política de `empresas` está en recuperación.
- `js/session.js`: se agregó un fallback mínimo en `applyLocalContextOverride()` para que un fallo de lectura en `empresas` no borre la selección activa del local; además `listAvailableLocalContexts()` deja de depender de una consulta secundaria a `empresas` para nombrar/mostrar locales, usando `grupos_empresariales` como fuente de continuidad.
- `supabase/sql/006_rls_policy_recovery_no_es_superadmin.sql`: `public.current_user_is_admin_root()` ahora valida primero contra `system_users.correo` usando el email del JWT, y conserva `usuarios_sistema.rol = 'admin_root'` solo como respaldo.
- `docs/2026-07-22_recuperacion_switcher_locales_y_rls_superadmin.md`: documentación del parche con reversión, exportación y check funcional.

Se tocó `js/header.js` únicamente por el fallback mínimo del nombre de empresa. Se tocó `js/session.js` de forma quirúrgica para evitar que una política rota de `empresas` borre el contexto activo o esconda locales; no se cambió login ni auth.

## 3. Notas de emergencia para revertir
1. En `js/local_context_switcher.js`, si se restaura la lectura de `empresas`, no volver a filtrar locales cuando esa consulta falle o retorne 0 por RLS. El selector debe conservar las filas activas de `grupos_empresariales`.
2. En `js/header.js`, revertir `obtenerNombreEmpresa(empresaId, fallback)` a un solo parámetro únicamente si la política `empresas` ya está estable y no genera 400.
3. En `js/session.js`, si se quiere volver al comportamiento anterior, restaurar la exigencia de `loadEmpresaForContext(selection.empresa_id)` y la consulta de nombres a `empresas`; no recomendado mientras RLS esté en recuperación porque vuelve a limpiar el local seleccionado.
4. En `supabase/sql/006_rls_policy_recovery_no_es_superadmin.sql`, si el proyecto no usa `system_users.correo`, reemplazar el primer `exists` de la función por la condición real del superadmin aislado.
5. Si el selector muestra duplicados, revisar que `grupos_empresariales` no tenga dos filas activas para el mismo `empresa_id` + `grupo_id`.

## 4. Guía para exportar a otro repositorio
1. Migrar primero el fallback del switcher: construir la lista con `grupos_empresariales` y no bloquearla por una consulta secundaria a `empresas`.
2. Mantener la empresa principal como primer item del array de contextos, y agregar locales después usando `empresa_id` de cada relación activa.
3. En el header, usar el nombre disponible del contexto como fallback antes de consultar la tabla de empresas.
4. Si el proyecto tiene superadmin aislado, adaptar `public.current_user_is_admin_root()` para leer esa tabla aislada y no una columna inexistente como `es_superadmin`.
5. Mantener el fallback de sesión aislado: no escribir datos derivados a Supabase ni cambiar auth; solo usarlo para construir contexto frontend mientras RLS de `empresas` se recupera.
6. Mantener URLs y keys centralizadas; este cambio no requiere modificar `js/config.js`.

## 5. Check funcional para logs
- Header — selector de locales: debe mostrar empresa principal y cada local activo de `grupos_empresariales` aunque `empresas` esté limitada por RLS.
- Cambio a empresa principal: debe estar disponible porque el item principal siempre se conserva en `listLocalContextsForSwitcher()`.
- Cambio a local: debe usar `prepareLocalContextSwitch()` y la relación activa de `grupos_empresariales`.
- Supabase superadmin: el helper SQL usa `system_users.correo` como fuente primaria.
- Login/auth: no modificados.
- Sesión/contexto local: fallback mínimo aplicado para no borrar la selección por fallo de `empresas`.
- Responsables/empleados: deberían volver a cargar cuando el contexto pueda volver a empresa principal y cuando RLS permita leer sus tablas base.

# 2026-07-21 — Recuperación de políticas RLS Supabase por `es_superadmin`

## 1. Objetivo de la petición
Identificar y corregir el error global posterior al cambio de políticas RLS en Supabase: `column "es_superadmin" does not exist`. Ese error ocurre antes de que el frontend reciba datos y por eso fallan módulos como cierre de turno, nómina, responsables, empleados, empresas y facturación.

## 2. Diagnóstico técnico
Los `400 (Bad Request)` en tablas diferentes (`usuarios_sistema`, `otros_usuarios`, `empleados`, `empresas`, `billing_cycles`) indican que una o varias políticas RLS quedaron con una condición que referencia `es_superadmin` como si fuera una columna de esas tablas. PostgreSQL evalúa la política durante cada `select`; si la columna no existe en la tabla consultada, toda la consulta falla con código `42703`.

La anon public key no permite ejecutar DDL ni corregir políticas. La solución debe ejecutarse desde Supabase SQL Editor, CLI con credenciales de owner, o un canal con `service_role`/owner autorizado.

## 3. Archivos implicados y modificación realizada
- `supabase/sql/006_rls_policy_recovery_no_es_superadmin.sql`: script SQL de recuperación. Crea la función `public.current_user_is_admin_root()`, lista políticas que todavía contienen `es_superadmin`, entrega salida de diagnóstico y agrega plantillas `select` para las tablas reportadas en consola.
- `docs/2026-07-21_recuperacion_politicas_rls_supabase.md`: documentación del incidente, causa probable, pasos de ejecución, reversión y check funcional.

No se modificaron archivos matrices del frontend como login, sesión, contexto o header. Tampoco se cambió la URL ni la anon key de Supabase en `js/config.js`, porque el problema mostrado es de políticas/SQL, no de URL.

## 4. Pasos para aplicar en Supabase
1. Abrir Supabase Dashboard del proyecto `ivgzwgyjyqfunheaesxx`.
2. Ir a **SQL Editor**.
3. Ejecutar `supabase/sql/006_rls_policy_recovery_no_es_superadmin.sql`.
4. Revisar el primer resultado del diagnóstico: toda política que muestre `es_superadmin` debe corregirse reemplazando esa referencia por `public.current_user_is_admin_root()` o por la condición real de rol que use el proyecto.
5. Ejecutar de nuevo el bloque final de verificación. Debe devolver 0 filas con `es_superadmin`.
6. Recargar la plataforma y validar que carguen contexto, responsables, empleados, empresas y ciclos de facturación.

## 5. Notas de emergencia para revertir
- Si la función `public.current_user_is_admin_root()` causa conflicto, ejecutar:
  ```sql
  drop function if exists public.current_user_is_admin_root();
  ```
- Si alguna plantilla de política creada no aplica a tu modelo, eliminarla con:
  ```sql
  drop policy if exists usuarios_sistema_select_self_empresa_admin on public.usuarios_sistema;
  drop policy if exists otros_usuarios_select_empresa_admin on public.otros_usuarios;
  drop policy if exists empleados_select_empresa_admin on public.empleados;
  drop policy if exists empresas_select_contexto_admin on public.empresas;
  drop policy if exists billing_cycles_select_empresa_admin on public.billing_cycles;
  ```
- No crear una columna `es_superadmin` en todas las tablas como solución rápida. Eso ocultaría el error pero duplicaría permisos y podría abrir datos indebidamente.

## 6. Guía para exportar a otro repositorio/proyecto Supabase
1. Confirmar que el proyecto destino usa `usuarios_sistema.rol = 'admin_root'` para superadmin.
2. Copiar `supabase/sql/006_rls_policy_recovery_no_es_superadmin.sql`.
3. Ejecutar primero solo el diagnóstico de `pg_policies` para encontrar políticas rotas.
4. Reemplazar referencias a columnas inexistentes como `es_superadmin` por una función centralizada (`public.current_user_is_admin_root()`) o por una condición explícita sobre `usuarios_sistema`.
5. Mantener endpoints y llaves centralizadas en el archivo equivalente a `js/config.js`; no hacer cambios de frontend si el error es `42703` de política.
6. Validar tablas base: `usuarios_sistema`, `otros_usuarios`, `empleados`, `empresas`, `billing_cycles`.

## 7. Check funcional para logs
- Supabase RLS — diagnóstico: pendiente de ejecutar en SQL Editor; debe mostrar qué políticas contienen `es_superadmin`.
- Supabase RLS — corrección: funciona cuando la verificación final retorna 0 políticas con `es_superadmin`.
- Contexto/login: no modificado en código.
- Nómina/responsables/empleados: deberían volver a cargar cuando las políticas de `usuarios_sistema`, `otros_usuarios` y `empleados` dejen de fallar.
- Empresas/facturación/plan: deberían volver a cargar cuando las políticas de `empresas` y `billing_cycles` dejen de fallar.

# Fase D · Limpieza de los webhooks n8n muertos (y 1 parche)

**Fecha:** 2026-08-22 · **Rama:** `master` · **Base:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`)

---

## 1 · Objetivo

Dejar el frontend en condiciones de sobrevivir a la desconexión de n8n.

Antes de esta fase, `js/webhooks.js` declaraba 46 constantes `WEBHOOK_*` más una
declarada dentro de `js/apoyos.js`. Doce de esas rutas ya no tienen backend
detrás y no van a tenerlo. Sin este trabajo, cada pantalla que las usaba se
quedaba con el botón activo: el usuario rellenaba el formulario, pulsaba, y se
quedaba mirando un «Guardando…» hasta que el navegador agotaba el timeout.

Tres cosas en una sola fase:

1. **Cortar las llamadas muertas** y hacer que las pantallas afectadas lo digan
   en vez de colgarse.
2. **Reimplementar `duplicar_usuarios`**, el único de los doce que sí hacía
   falta conservar, como RPC de Postgres + Edge Function.
3. **Sustituir los webhooks de facturación por `pg_cron`**, aprovechando que las
   funciones SQL que aquellos flujos disparaban ya existían en la base.

## 2 · Los doce webhooks muertos

| Ruta n8n | Motivo | Reemplazo |
|---|---|---|
| `cargar_facturas_correo` | Módulo Siigo descontinuado | Ninguno |
| `subir_factura_siigo` | Módulo Siigo descontinuado | Ninguno |
| `corregir_factura_inconveniente` | Módulo Siigo descontinuado | Ninguno |
| `siigo_proveedores_listar` | Módulo Siigo descontinuado | Ninguno |
| `siigo_proveedores_registrar` | Módulo Siigo descontinuado | Ninguno |
| `billing_daily_enforcer` | Solo disparaba una función SQL existente | `pg_cron` → `billing-enforcer-diario` |
| `crear_ciclos_mensuales` | Solo disparaba una función SQL existente | `pg_cron` → `billing-crear-ciclos` |
| `notificaciones_pagos` | Notificación accesoria | Ninguno: el estado ya queda en `payment_attempts` |
| `verificar_pagos` | Recibía el comprobante por segunda vez | Ninguno: ya está en Storage y en `payment_attempts` |
| `registrar_credibanco` | Integración descontinuada | Ninguno |
| `dashboard` | Telemetría sin consumidor | Ninguno |
| `verificar_nit_cedula` | Recuperación de contraseña en desuso | Supabase Auth |

**Nota sobre `duplicar_usuarios`:** era el decimotercero de la lista original de
candidatos, pero **no** se descontinúa. Se reimplementa (sección 4).

**Nota sobre `api_integraciones_siigo.js`:** esta pantalla no aparece en la tabla
porque no usa una URL muerta. Guardaba las credenciales de Siigo reutilizando la
ruta genérica `registro_credenciales`, que sigue viva porque la usa Loggro. Lo
descontinuado es el módulo, no la ruta, así que se bloquea por
`MODULOS_DESCONTINUADOS.siigo` y no por `WEBHOOKS_MUERTOS`.

## 3 · Mecanismo de corte

Una sola fuente de verdad en [js/webhooks.js](../js/webhooks.js):

- `WEBHOOKS_MUERTOS` — mapa `url → motivo`.
- `MODULOS_DESCONTINUADOS` — pantallas muertas que usaban una ruta viva.
- `motivoObsoleto(url)` — devuelve el motivo, o cadena vacía si sigue viva.
- `webhookVigente(url)` — `true` si merece la pena hacer la llamada.

Las constantes `WEBHOOK_*` siguen exportadas **a propósito**: borrarlas rompería
los `import` de los módulos consumidores sin ganar nada. Lo que se corta es la
llamada.

El helper nuevo [js/modulo_descontinuado.js](../js/modulo_descontinuado.js)
expone `avisarModuloDescontinuado({ motivo, status, formularios, controles })`,
que escribe el motivo en el elemento de estado y deshabilita los controles.

`webhookVigente()` también reconoce el host de ejemplo `tu-n8n-instancia.com`,
que quedó copiado en tres constantes y **nunca existió**. Dos de las guardas que
ya había en el código comprobaban ese host a mano; ahora usan el helper.

## 4 · Reimplementación de `duplicar_usuarios`

**Dónde está el original.** No existe ningún archivo llamado
`duplicar_usuarios` en `Flujos N8N/`, y buscarlo por `path` de webhook tampoco
lo encuentra. Su lógica vive en
`Registro/Registro_Primer_Usuario_Local_Dups.txt`, que arranca con
`executeWorkflowTrigger` en lugar de con un nodo Webhook: el webhook lo
invocaba como sub-workflow. Se localizó **después** de escribir la primera
versión de esta fase; el parche 1 (sección 12) recoge las diferencias.

Qué hacía: al registrar un local dependiente, replicaba los usuarios de la
empresa madre en `usuarios_locales`, de modo que cada local tuviera su propia
fila (`id` distinto) apuntando al mismo `usuario_principal_id`.

Reparto nuevo, en dos piezas:

- **RPC `public.duplicar_usuarios_local(p_local_empresa_id, p_matriz_empresa_id)`**
  — hace la réplica. Es `SECURITY DEFINER` porque la política
  `usuarios_locales_insert` solo deja insertar a `is_super_admin()`, y quien
  registra un local es un admin normal. Por eso valida el alcance a mano:
  rol de servicio, o bien `app_es_admin()` **y** `app_puede_ver_empresa()` sobre
  ambas empresas, **y** que el vínculo exista de verdad en
  `grupos_empresariales`. Es idempotente gracias a
  `uq_usuarios_locales_principal_empresa` (Fase A).
- **Edge Function `local-usuarios-duplicar`** — crea el administrador del local
  (Auth + `usuarios_sistema` + `usuarios_locales`) y llama al RPC. Acepta el
  mismo payload que el webhook, sin cambios en el contrato.

El webhook de n8n estaba **abierto**: cualquiera con la URL podía crear
administradores. La Edge Function va con `verify_jwt = true` y exige rol admin.

Si `local_empresa_id` no llega (la respuesta antigua de n8n no siempre lo
traía), la función lo resuelve por `local_nit`, buscando **solo** entre los
locales de esa madre para que el NIT no sirva de sonda contra otras empresas.

## 5 · Facturación por `pg_cron`

Los flujos de n8n `billing_daily_enforcer` y `crear_ciclos_mensuales` no
calculaban nada: eran un Schedule Trigger y un HTTP Request que llamaban a
funciones que **ya existen** en `20240101000000_init.sql`. Se programan dentro
de la base y desaparece el salto de red.

| Tarea | Cron (UTC) | Hora Colombia | Ejecuta |
|---|---|---|---|
| `billing-crear-ciclos` | `5 5 1 * *` | 00:05 del día 1 | `create_billing_cycles_for_period(NULL)` |
| `billing-enforcer-diario` | `0 14 * * *` | 09:00 diario | `billing_daily_enforcer()` |

Ambas funciones son ejecutables desde el cron: `billing_daily_enforcer()` no
comprueba usuario, y `create_billing_cycles_for_period()` solo exige superadmin
cuando `auth.uid()` **no** es nulo, cosa que desde `pg_cron` no ocurre.

## 6 · Archivos tocados

**Nuevos**

| Archivo | Qué es |
|---|---|
| `supabase/migrations/20260822200000_fase_d_webhooks_muertos.sql` | RPC + las dos tareas de cron |
| `supabase/migrations/20260822203000_fase_d_parche_marcador_duplicado.sql` | Parche 1: marcador `duplicado_local` |
| `supabase/functions/local-usuarios-duplicar/index.ts` | Reemplazo del webhook de duplicación |
| `js/modulo_descontinuado.js` | Helper de degradación de pantalla |
| `docs/2026-08-22_limpieza_webhooks_muertos_fase_d.md` | Este documento |

**Modificados**

| Archivo | Cambio |
|---|---|
| `supabase/config.toml` | Declara `local-usuarios-duplicar` con `verify_jwt = true` |
| `js/webhooks.js` | `WEBHOOKS_MUERTOS`, `MODULOS_DESCONTINUADOS`, `motivoObsoleto`, `webhookVigente`; marca `[MUERTO]` en 8 constantes |
| `js/anadir_local_usuario.js` | `fetch` → `supabase.functions.invoke("local-usuarios-duplicar")` |
| `js/dashboard.js` | Se queda sin la señal de telemetría; el archivo se conserva porque el HTML lo carga |
| `js/credibanco.js` | Formulario bloqueado al cargar + guarda en el submit |
| `js/api_integraciones_siigo.js` | Formulario bloqueado por `MODULOS_DESCONTINUADOS.siigo` |
| `js/proveedores_siigo.js` | No autocarga, botones deshabilitados, guarda en las dos funciones de red |
| `js/subir_facturas_siigo.js` | Guarda en `fetchJson` y `fetchWebhookSignal` + aviso al cargar |
| `js/contrasena_reset_page.js` | Se bloquea **solo** el atajo por cédula/NIT; el cambio de contraseña por enlace sigue intacto |
| `js/revision_pagos.js` | La notificación se omite con un `console.info` |
| `js/gestion_empresas.js` | La guarda del host de ejemplo pasa a `webhookVigente()` |
| `js/facturacion.js` | Guardas en la fuente opcional de factura y en el envío del comprobante |

## 7 · Reversión de emergencia

### 7.1 Base de datos

Ejecutar en este orden, línea por línea:

```sql
SELECT cron.unschedule('billing-enforcer-diario');
SELECT cron.unschedule('billing-crear-ciclos');
DROP FUNCTION IF EXISTS public.duplicar_usuarios_local(uuid, uuid);
```

Nada de eso borra datos. Las filas que la función haya insertado en
`usuarios_locales` permanecen. Para deshacer también esas filas, y **solo** si
se conoce el id del local afectado:

```sql
DELETE FROM public.usuarios_locales
WHERE empresa_id = '<id-del-local>' AND "añadido_por" = 'duplicado_local';
```

Esa condición deja intactos al administrador del local y a cualquier usuario
añadido a mano después. **Corregida por el parche 1**: la primera versión de
este documento decía `"añadido_por" <> ''`, que habría borrado también al
administrador del local.

### 7.2 Edge Function

```bash
supabase functions delete local-usuarios-duplicar --project-ref tgkvcvnwwnrlyhbqmhaf
```

Y quitar de `supabase/config.toml` el bloque `[functions.local-usuarios-duplicar]`
(6 líneas, incluidos los dos comentarios que lo preceden).

### 7.3 Frontend

Todo el frontend de esta fase se revierte con un solo comando, porque ningún
archivo tocado aquí cambió por otro motivo en el mismo commit:

```bash
git checkout <commit-anterior> -- \
  Plataforma_Restaurantes-main/js/webhooks.js \
  Plataforma_Restaurantes-main/js/anadir_local_usuario.js \
  Plataforma_Restaurantes-main/js/dashboard.js \
  Plataforma_Restaurantes-main/js/credibanco.js \
  Plataforma_Restaurantes-main/js/api_integraciones_siigo.js \
  Plataforma_Restaurantes-main/js/proveedores_siigo.js \
  Plataforma_Restaurantes-main/js/subir_facturas_siigo.js \
  Plataforma_Restaurantes-main/js/contrasena_reset_page.js \
  Plataforma_Restaurantes-main/js/revision_pagos.js \
  Plataforma_Restaurantes-main/js/gestion_empresas.js \
  Plataforma_Restaurantes-main/js/facturacion.js

rm Plataforma_Restaurantes-main/js/modulo_descontinuado.js
```

Para revertir **una sola pantalla** sin tocar las demás, basta con quitar la
entrada correspondiente de `WEBHOOKS_MUERTOS` en `js/webhooks.js`: los guardas
consultan ese mapa en tiempo de ejecución, así que la llamada vuelve a hacerse
sin editar el módulo consumidor. La excepción es `js/dashboard.js`, cuyo `fetch`
sí se eliminó y hay que recuperarlo del historial.

## 8 · Exportación a otro repositorio

Los archivos de esta fase son autocontenidos salvo por cuatro dependencias, que
hay que llevarse antes:

1. `supabase/migrations/20260822130000_fase_a_cimientos.sql` — de ahí salen
   `app_es_admin()`, `app_puede_ver_empresa()`, `app_grupo_de()` y el índice
   `uq_usuarios_locales_principal_empresa`, sin el cual el `ON CONFLICT` del RPC
   falla en tiempo de ejecución.
2. `supabase/migrations/20260822164500_fase_b_parche2_rol_servicio.sql` — de ahí
   sale `app_es_rol_servicio()`.
3. `supabase/functions/_shared/` completo — `tenant.ts`, `errores.ts`,
   `usuarios.ts`, `cors.ts`.
4. `js/supabase.js` y `js/session.js` — el cliente y el contexto de usuario.

Orden de aplicación en el repositorio destino:

```bash
# 1. Migraciones, en orden cronológico de nombre de archivo
supabase db push --linked

# 2. Edge Function
supabase functions deploy local-usuarios-duplicar --project-ref <ref-destino>

# 3. Frontend: copiar js/webhooks.js, js/modulo_descontinuado.js y los
#    9 módulos consumidores modificados
```

`WEBHOOKS_MUERTOS` contiene URLs absolutas de `n8n.enkrato.com`. En un
repositorio con otro host de n8n hay que reescribir las claves del mapa, o el
corte no se aplicará y las pantallas volverán a colgarse.

## 9 · Checklist de funcionalidad para logs

Qué debe aparecer, y dónde, cuando cada pieza funciona.

### 9.1 Consola del navegador

| Pantalla | Mensaje esperado |
|---|---|
| `dashboard/index.html` | `[dashboard] Señal de métricas desactivada: El envío de métricas del dashboard fue descontinuado.` |
| `configuracion/credibanco.html` | `[modulo-descontinuado] La integración con Credibanco fue descontinuada.` |
| `siigo/configuracion_siigo/api_integraciones_siigo.html` | `[modulo-descontinuado] El módulo Siigo fue descontinuado.` |
| `siigo/configuracion_siigo/proveedores_siigo.html` | `[modulo-descontinuado] El módulo Siigo fue descontinuado.` |
| `siigo/subir_facturas_siigo/index.html` | `[modulo-descontinuado] El módulo Siigo fue descontinuado.` |
| `configuracion/contrasena.html` | `[contrasena_reset] Verificación por cédula/NIT desactivada: …` |
| `facturacion` (al aprobar/rechazar un pago) | `[revision_pagos] Notificación omitida: …` |

**Señal de que algo va mal:** cualquier error de red contra `n8n.enkrato.com` en
la pestaña Network. Después de esta fase no debería salir ni uno solo desde esas
pantallas.

### 9.2 Logs de la Edge Function

`supabase functions logs local-usuarios-duplicar --project-ref tgkvcvnwwnrlyhbqmhaf`

| Situación | Línea esperada |
|---|---|
| Alta correcta | `[local-usuarios-duplicar] local <uuid>: N usuarios duplicados desde <uuid>` |
| Reintento de la misma pantalla | La misma línea con `0 usuarios duplicados` (el RPC es idempotente) |
| Sin JWT | El gateway responde 401 sin llegar a ejecutar la función: **no** habrá línea de log |
| Usuario sin rol admin | `SIN_PERMISOS` con 403 |
| Local que no cuelga de esa madre | `FUERA_DE_ALCANCE` con 403 |

### 9.3 Tareas de cron

```sql
-- Que las dos tareas estén programadas y activas
SELECT jobname, schedule, active FROM cron.job
WHERE jobname IN ('billing-enforcer-diario', 'billing-crear-ciclos');

-- Últimas ejecuciones y su resultado
SELECT j.jobname, r.status, r.return_message, r.start_time
FROM cron.job_run_details r
JOIN cron.job j ON j.jobid = r.jobid
WHERE j.jobname LIKE 'billing-%'
ORDER BY r.start_time DESC
LIMIT 10;
```

`status` debe ser `succeeded`. `billing-enforcer-diario` devuelve un `jsonb` con
los contadores de ciclos vencidos y suspendidos; `billing-crear-ciclos` devuelve
el número de ciclos creados, que en un mes sin altas nuevas puede ser 0
legítimamente.

### 9.4 Comprobación del RPC

```sql
-- Debe existir y ser SECURITY DEFINER
SELECT proname, prosecdef FROM pg_proc
WHERE proname = 'duplicar_usuarios_local';

-- anon NO debe poder ejecutarla
SELECT has_function_privilege('anon',
  'public.duplicar_usuarios_local(uuid,uuid)', 'EXECUTE');   -- false
SELECT has_function_privilege('authenticated',
  'public.duplicar_usuarios_local(uuid,uuid)', 'EXECUTE');   -- true
```

## 10 · Verificaciones ya superadas

- `deno check` limpio sobre `local-usuarios-duplicar`.
- Comprobación de sintaxis con `node --check` sobre los 11 módulos JS tocados:
  11/11 correctos.
- Comprobación de que todo símbolo importado existe en su módulo de origen, en
  los 80+ archivos de `js/`: **0 imports rotos**.
- Rastreo de llamadas: no queda ningún `fetch` sin guarda contra una de las doce
  rutas muertas.
- Migraciones aplicadas con `supabase db push --linked`: las dos, sin error.
- Edge Function desplegada y **ACTIVE**, con `verify_jwt = true`. El proyecto
  pasa de 14 a 15 funciones.
- Humo en vivo contra la función desplegada:
  `OPTIONS` → 204 con `Access-Control-Allow-Origin: https://restaurantes.enkrato.com`;
  `POST` sin cabecera → 401 `UNAUTHORIZED_NO_AUTH_HEADER`;
  `POST` con JWT falso → 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`.

## 11 · Pendiente

- Prueba del alta completa de un local con una sesión real. Como está descrito
  en el documento de traspaso, desde esta máquina **no** se puede acuñar un JWT
  de usuario (el Auth Admin API devuelve 403 de Cloudflare), así que el happy
  path tendrá que verificarse desde el navegador o desde el entorno local de
  Supabase.
- Comprobar la primera ejecución real de `billing-crear-ciclos`, que no llegará
  hasta el día 1 del mes siguiente. `billing-enforcer-diario` corre cada día a
  las 09:00 hora Colombia, así que su primera traza aparece antes.

## 12 · Parche 1 · Marcador de fila duplicada

Migración `20260822203000_fase_d_parche_marcador_duplicado.sql`, aplicada.

Al aparecer `Registro/Registro_Primer_Usuario_Local_Dups.txt` se pudo comparar
la reconstrucción con el original. Coincidía en la secuencia completa —crear la
cuenta en Auth, resolver el local, insertar en `usuarios_sistema` con rol
`admin_root`, leer los usuarios de la madre, replicarlos en
`usuarios_locales`— salvo en dos detalles, ambos corregidos:

1. **`añadido_por = 'duplicado_local'`.** El nodo `Create a row1` escribía ese
   marcador literal en cada fila replicada, no el correo de quien registraba el
   local. No es cosmético: es lo único que distingue una fila creada por la
   duplicación de una creada a mano, y por tanto lo único que permite deshacer
   una duplicación sin barrer usuarios legítimos. La instrucción de reversión de
   la sección 7.1 depende de él y quedó corregida.

2. **Desempate por `correo_empresa`.** El original resolvía el local por NIT
   (`Get a row`) y a continuación filtraba por
   `correo_empresa == local_correo` (`Filter`). La Edge Function ahora aplica
   ese mismo desempate cuando el payload trae `local_correo`: dos locales de la
   misma madre pueden compartir NIT, y sin el filtro la consulta devolvería dos
   filas y fallaría.

El resto de la reconstrucción se mantuvo tal cual. Las diferencias deliberadas
respecto al original siguen en pie: la Edge Function exige JWT y rol admin
(el webhook estaba abierto), valida el vínculo con la madre en dos capas, y
revierte la cuenta de Auth si el `INSERT` posterior falla.

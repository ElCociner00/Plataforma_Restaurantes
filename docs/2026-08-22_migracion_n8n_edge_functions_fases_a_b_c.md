# 2026-08-22 · Migración n8n → Edge Functions · Fases A, B y C

Continuación de `2026-08-22_plan_migracion_n8n_a_edge_functions.md`, cuyo plan
aprobó el usuario. Este documento recoge lo **ejecutado y verificado**.

Proyecto destino: **`tgkvcvnwwnrlyhbqmhaf` — «Enkrato Google»** (la copia).
Producción (`ivgzwgyjyqfunheaesxx`) **no se tocó** en ningún momento.

---

## 1 · Objetivo

Reemplazar los 37 flujos de n8n por Edge Functions y funciones de base de datos,
con tres exigencias del usuario:

1. La función de **credenciales** por delante de todo, porque de ella dependen
   todos los módulos.
2. **Cero datos hardcodeados**: multi-tenant real, cada empresa con sus propias
   credenciales.
3. Verificar que **cada pieza funciona**, no solo que compila.

---

## 2 · Archivos creados y modificados

### 2.1 Migraciones de base de datos (7, todas aplicadas)

| Archivo | Qué hace |
|---|---|
| `supabase/migrations/20260822130000_fase_a_cimientos.sql` | Funciones `app_*` de contexto · corrección de 4 políticas con fuga entre empresas · políticas RLS para las 7 tablas en deny-all · índices únicos · vista `inventario_diario_resumen` · tablas `compras_facturas` y `compras_facturas_lineas` · guarda de tenant en `obtener_historico_inventarios` |
| `20260822160000_fase_b_storage_y_cron.sql` | Bucket privado `nomina-pdf` · `pg_cron` + `pg_net` · `programar_refresco_loggro()` · vista `estado_integraciones` |
| `20260822163000_fase_b_parche_permiso_cron.sql` | Parche: permitir programar desde el rol de servicio |
| `20260822164500_fase_b_parche2_rol_servicio.sql` | Parche: `app_es_rol_servicio()` — `current_user` no sirve dentro de `SECURITY DEFINER` |
| `20260822170000_fase_b_parche3_unico_credenciales.sql` | Parche: índice único **total** en `credenciales_plataforma` |
| `20260822180000_fase_c_rpc_cierre_turno.sql` | `subir_cierre_turno()` transaccional · `historico_cierre_turno()` · `guardar_parametros_nomina()` |
| `20260822190000_fase_c_parche_vista_integraciones.sql` | Parche: cerrar el acceso anónimo a `estado_integraciones` |

### 2.2 Módulos compartidos de Edge Functions (`supabase/functions/_shared/`)

| Archivo | Qué hace |
|---|---|
| `tenant.ts` 🆕 | `resolverContexto()`. Colapsa los dos ejes que n8n duplicaba a mano: superadmin (`system_users`) y local vs empresa suelta (`grupos_empresariales`). **La empresa sale del JWT; el cuerpo solo manda si el llamante es superadmin.** |
| `loggro.ts` 🆕 | Cliente de Loggro/pirpos con credenciales **por empresa**: caché en memoria → caché en base → login. Descifra la contraseña, cachea el token, reintenta una vez ante 401/403. |
| `errores.ts` 🆕 | Errores y respuestas uniformes. El detalle interno va al log, nunca al navegador. |
| `fechas.ts` 🆕 | El desfase de −5 h de Colombia, en un solo sitio en vez de repartido por catorce expresiones dentro de URLs. |
| `ventas.ts` 🆕 | Agregación de ventas por medio de pago, comisiones y `filtrarPorNegocio()`. |
| `usuarios.ts` 🆕 | Alta en `auth.users` y **reversión** si falla un paso posterior. |
| `correo.ts` 🆕 | Envío agnóstico de proveedor: `resend`, `smtp` o `relay`. |
| `cors.ts`, `crypto.ts` | Ya existían. Sin cambios. |

### 2.3 Edge Functions (14 desplegadas)

| Función | Reemplaza | Nodos n8n |
|---|---|---|
| `guardar-credenciales` ♻️ | `Registro_Credenciales_loggro` | 37 |
| `consultar-credenciales` ♻️ | (parte del mismo) | — |
| `consultar-ventas` ♻️ | `consultar_ventas` | 17 |
| `consultar-gastos` 🆕 | `consultar_gastos` + `Cargar_Gastos` + `Cargar_Gastos_Catalogo` | 11+24+24 |
| `consultar-inventarios` 🆕 | `Inventarios` + `Llamar_Inventarios` | 10+20 |
| `consultar-propina-apoyos` 🆕 | `Consultar_Propina_Apoyos` | 34 |
| `cierre-inventarios-subir` 🆕 | `inventarios/subir_cierre` | 14 |
| `compras-subir` 🆕 | `subir_compras` | 37 |
| `compras-importar` 🆕 | (pieza nueva: vuelca el Google Sheet) | — |
| `registro-empleados` ♻️ | `Registro_Empleados` | 24 |
| `registro-otros-usuarios` 🆕 | `Registro_Admins_y_Revisores` | 20 |
| `registro-local` 🆕 | `Registro_Nueva_Empresa_Local` + `Registro_Primer_Usuario_Local_Dups` | 6+10 |
| `nomina-enviar-correo` 🆕 | `Nómina/Enviar_Correo` | 10 |
| `cron-refrescar-token-loggro` 🆕 | `Reinicio_Credenciales_loggro` | 14 |

### 2.4 Otros archivos

| Archivo | Cambio |
|---|---|
| `supabase/config.toml` | Reescrito: 14 funciones declaradas. **`registro-empleados` pasó de `verify_jwt = false` a `true`** — antes cualquiera con la URL podía crear cuentas. |
| `js/config.js` | `publishableKey` actualizada; la anterior era de otro proyecto y devolvía «Invalid API key». Ningún archivo la consume hoy, pero era una trampa. |

---

## 3 · Cómo se garantiza el multi-tenant

### 3.1 En las Edge Functions

`resolverContexto()` es la única puerta de entrada. Devuelve:

```
empresaId · empresaPropiaId · esSuperadmin · esAdmin · esLocal · grupoId
empresasVisibles[] · t{cierres,apoyos,turnos,usuarios} · clienteUsuario · clienteAdmin
```

Reglas que impone:

1. `empresaId` sale de `auth.getUser()` → `usuarios_sistema.id = auth.uid()`.
2. El `empresa_id` del cuerpo **solo** se acepta si el llamante está en
   `system_users`, y aun así se valida contra el alcance.
3. Un usuario de grupo puede operar sobre otra empresa de su grupo, nunca fuera.
4. El cliente se construye con clave anónima + JWT del usuario, así que el RLS
   sigue aplicando. `service_role` solo en lo que RLS no puede hacer.

### 3.2 En la base de datos

`app_empresas_visibles()` replica exactamente la misma regla en SQL, para que la
comprobación de TypeScript y la de las políticas RLS nunca se contradigan.

### 3.3 Frente a Loggro

Las credenciales viven en `integraciones_credenciales`, una fila por
`(empresa_id, plataforma)`, **cifradas con AES-GCM**. La URL del API también es
por empresa. Y dentro de la respuesta del proveedor se filtra por
`businessId` contra `plataforma_tenant_id`, que es lo que impide que un local
vea las ventas de otro bajo la misma cuenta.

---

## 4 · Verificación realizada

No es una revisión de escritorio: todo lo de abajo se ejecutó de verdad.

### 4.1 Compilación

`deno check` sobre las 14 funciones (Deno 2.9.5) → **14/14 sin errores**.

### 4.2 Auditoría estática (script `auditar.py`)

- **0 secretos hardcodeados** en 23 archivos: ni uuid de empresa real, ni correo
  de cuenta Loggro, ni contraseña, ni JWT, ni ref de proyecto, ni URL de n8n.
- **14/14 funciones** acotan el tenant por `resolverContexto()` (o, el cron,
  por `CRON_SECRET`).
- **7/7 comprobaciones** del módulo de credenciales: lee de base, filtra por
  empresa, descifra, exige llave maestra sin valor de respaldo, URL por empresa,
  reintento tras 401.

### 4.3 Contra la base de datos real

| Comprobación | Resultado |
|---|---|
| 7 migraciones aplicadas | ✅ |
| Tablas, vistas y funciones nuevas responden por PostgREST | ✅ |
| `estado_integraciones` e `inventario_diario_resumen` denegadas a anónimo | ✅ 401 |
| `subir_cierre_turno`, `historico_cierre_turno`, `guardar_parametros_nomina` rechazan anónimo | ✅ |
| Tarea `refrescar-token-loggro` programada cada 4 h | ✅ activa |

### 4.4 Contra las Edge Functions desplegadas

14/14: preflight `OPTIONS` → 204 con el origen correcto; POST sin JWT → 401;
POST con JWT inválido → 401 del gateway (`verify_jwt = true`); el cron rechaza
sin `x-cron-secret`.

### 4.5 Contra el API real de Loggro (api.pirpos.com)

Esta es la parte que descubrió los fallos de verdad:

| Comprobación | Resultado |
|---|---|
| Login con las credenciales reales de las 4 empresas | ✅ HTTP 200 las 4 |
| Cron completo: descifra, hace login y persiste token | ✅ **4 renovados, 0 fallidos** |
| Segunda ejecución: no repite el login | ✅ **4 vigentes, 0 renovados** |
| Caducidad forzada → renueva desde credenciales **cifradas** | ✅ 4 renovados |
| Agregación de ventas sobre 40 facturas reales de un turno | ✅ los 6 canales cuadran con `total_general_valor` (1 578 600) |
| Normalización de gastos sobre 30 gastos reales | ✅ 4 tipos agrupados, 4/4 con nombre resuelto |
| Normalización de inventario sobre 164 productos reales | ✅ 97 con stock, 97/97 con `locationStockId` |

### 4.6 Cifrado de credenciales

Las 4 contraseñas que estaban **en texto plano** en la copia quedaron cifradas
(AES-GCM, prefijo `enc:`), con verificación de ida y vuelta antes de escribir
cada fila. Relectura final: **4/4 legibles** con la llave maestra.

---

## 5 · Fallos encontrados y corregidos

### 5.1 En el código heredado

| Hallazgo | Gravedad | Estado |
|---|---|---|
| 4 políticas RLS con la tautología `ge.empresa_id = ge.empresa_id`: cualquier usuario de un grupo podía leer los cierres de **cualquier** empresa | **Crítico** | Corregido |
| `obtener_historico_inventarios()` es `SECURITY DEFINER` y aceptaba `p_empresa_id` del cliente **sin comprobar el tenant** | **Crítico** | Corregido |
| `registro-empleados` desplegada con `verify_jwt = false` | **Crítico** | Corregido |
| 7 tablas con RLS activo y cero políticas (`historico_nomina`, `apoyos_turno`…) | Alto | Corregido |
| `sql/009` concedía permisos comparando `rol = 'administrador'`, valor que **no existe** en los datos (los roles reales son `admin_root`, `admin`, `revisor`) | Alto | Corregido |
| `credenciales_plataforma` sin restricción de unicidad | Medio | Corregido |
| `js/config.js` con `publishableKey` de otro proyecto | Bajo | Corregido |

### 5.2 En mi propio código, detectados al verificar

| Hallazgo | Cómo se detectó | Estado |
|---|---|---|
| El token de Loggro está en `tokenCurrent`, no en `token` ni `access_token`. Mi código habría fallado con «LOGGRO_SIN_TOKEN» en la primera llamada real | Login real contra api.pirpos.com | Corregido |
| El id de negocio está en `business._id`. Yo usaba la reclamación `sub` del JWT, que contiene el id del **usuario**: el filtro no habría coincidido nunca y habría devuelto cero ventas | Inspección de la respuesta real | Corregido |
| `/Ingredients` hereda el catálogo del negocio padre: filtrar por negocio dejaba **1 producto de 164** | Prueba sobre datos reales | Corregido (no se filtra) |
| `/expenses` marca el negocio en `business._id` (objeto), no en `businessId` (cadena) | Prueba sobre datos reales | Corregido |
| El importe de la factura es `total`; `value` y `deliveryCost` no existen | Volcado de claves reales | Corregido |
| Índice único **parcial** no sirve como destino de `ON CONFLICT`: el cron decía «renovado» pero el token no se guardaba | `token_expira_en` quedaba en NULL | Corregido (índice total) |
| `current_user` dentro de `SECURITY DEFINER` devuelve el propietario, no el rol de la petición | La programación del cron se rechazaba a sí misma | Corregido (`app_es_rol_servicio()`) |
| `estado_integraciones` era legible por anónimos | Barrido final de verificación | Corregido |
| `nomina-enviar-correo` validaba el cuerpo antes que la sesión (400 en vez de 401) | Barrido final de verificación | Corregido |

---

## 6 · Comportamientos heredados que se conservan a propósito

Ninguno se ha «arreglado» por su cuenta, porque cambiarlos altera cifras ya
liquidadas. Los tres tienen interruptor.

| Comportamiento | Interruptor |
|---|---|
| El 4 por mil sobre la propina **nunca se aplicó** en producción: el medio de pago real es «Transferencias Bancolombia» (plural) y la lista de n8n comparaba «transferencia_bancolombia» (singular). El 2,5 % del datáfono sí se aplicaba | `PROPINA_4X1000_TRANSFERENCIAS=true` |
| Todos los apoyos reciben el tramo horario **del turno**, no el suyo propio: n8n leía `registro.hora_inicio`, que en el payload del frontend es la hora del turno. El tramo real viaja en `rango_hora_inicio_simple` | `APOYOS_USAR_RANGO_PROPIO=true` |
| El inventario no se filtra por negocio | `FILTRAR_INVENTARIO_POR_NEGOCIO=true` |

---

## 7 · Estado por módulo (para logs)

- **Credenciales:** funciona. Verificado de extremo a extremo contra Loggro real, con las 4 empresas y credenciales cifradas.
- **Cierre de turno · ventas:** funciona. Agregación verificada sobre 40 facturas reales; los 6 canales cuadran.
- **Cierre de turno · gastos:** funciona. Verificado sobre 30 gastos reales.
- **Cierre de turno · guardar:** desplegado y rechaza anónimos. **Falta prueba con sesión real.**
- **Propina de apoyos:** desplegado, lógica replicada del nodo original. **Falta prueba con sesión real.**
- **Inventarios · consultar:** funciona. Verificado sobre 164 productos reales.
- **Inventarios · subir cierre:** desplegado. **Falta prueba con sesión real.**
- **Compras:** desplegado, pero **sin datos**: falta ejecutar `compras-importar` con el volcado del Sheet.
- **Registro (empleados, otros usuarios, locales):** desplegado. **Falta prueba con sesión real.**
- **Nómina · enviar correo:** desplegado, pero **inactivo** hasta configurar el proveedor de correo.
- **Nómina · cálculo:** **no migrado.** Ver punto 9.
- **Cron de token:** funciona. Ejecutado 3 veces, 4/4 empresas correctas.

---

## 8 · Qué falta y por qué

### 8.1 Correo (bloqueado por ti)

`_shared/correo.ts` admite `resend`, `smtp` y `relay`. No pude conectar tu cuenta
porque el flujo OAuth necesita una sesión interactiva. Para activarlo:

```bash
supabase secrets set \
  CORREO_PROVEEDOR=smtp \
  CORREO_REMITENTE="Enkrato <tu-correo@dominio.com>" \
  SMTP_HOST=smtp.gmail.com SMTP_PORT=465 \
  SMTP_USUARIO="tu-correo@dominio.com" \
  SMTP_PASSWORD="contraseña-de-aplicación" \
  --project-ref tgkvcvnwwnrlyhbqmhaf
```

Mientras no esté, `nomina-enviar-correo` responde 412 con un mensaje claro y los
registros de usuario se completan igual, solo que sin correo de bienvenida.

### 8.2 Datos de compras

Las tablas existen y `compras-importar` acepta las filas con los encabezados
exactos de las hojas 1 y 3. Falta exportar el Sheet y llamarla.

### 8.3 Cálculo de nómina — **deliberadamente no migrado**

`Nómina_Nuevo.txt` son 51 nodos que combinan `turnos_agrupados`,
`parametros_nomina`, `dimensiones_tiempo`, `dimensiones_concepto` y
`apoyos_turno` con una fórmula que no está documentada en ningún sitio. No la
migré porque reconstruirla a ojo sería **inventar la fórmula con la que se paga
a la gente**. Necesito que me indiques la regla de cálculo, o autorización
explícita para deducirla de los datos históricos de `historico_nomina` y
contrastarla contigo antes de activarla.

### 8.4 Reconexión del frontend

El frontend sigue llamando a `https://n8n.enkrato.com/webhook/...` desde
`js/webhooks.js`, salvo `consultar-ventas` y las de credenciales, que ya usan
`supabase.functions.invoke`. **No hice ese cambio masivo** porque no puedo
probar la interfaz en el navegador desde aquí y un fallo silencioso en 20 puntos
de llamada es peor que el estado actual. Es la Fase H del plan.

### 8.5 Prueba con sesión de usuario real

El API de administración de Auth responde 403 (Cloudflare) desde esta máquina,
así que no pude emitir un JWT de usuario para probar el camino feliz completo.
Lo verificable sin sesión está verificado; el resto necesita que abras la
aplicación con un usuario real.

---

## 9 · Riesgos abiertos que requieren decisión tuya

1. **Rotar las contraseñas de Loggro.** `gerenciabatut@gmail.com` y
   `loggro-test@example.invalid` están en claro dentro de
   `Flujos N8N/Loggro/Cierre_Turno/consultar_ventas.txt`, versionado en git.
2. **Rotar la `service_role` de producción.** El JWT completo de
   `ivgzwgyjyqfunheaesxx` está en claro en `Registro_Empleados.txt` y
   `Registro_Admins_y_Revisores.txt`. Da control total sobre la base real.
3. **Dos empresas comparten cuenta de Loggro.** `498b9fd6` y `5b5f990a` usan la
   misma (`business` 66be890a…), y `b76d89f6` y `f37f6983` otra
   (`business` 64cc0e34…). Con esa configuración **verán exactamente las mismas
   ventas**. El código aísla correctamente por `businessId`, pero si esas
   parejas deben tener cifras distintas, cada una necesita su propia cuenta.
4. **Guardar la llave maestra.** Está en
   `…/scratchpad/secretos.env`. Si se pierde, las credenciales cifradas dejan de
   poder leerse y hay que volver a introducirlas.

---

## 10 · Reversión

### 10.1 Edge Functions

```bash
supabase functions delete <nombre> --project-ref tgkvcvnwwnrlyhbqmhaf
```

El código anterior de `consultar-ventas`, `registro-empleados`,
`guardar-credenciales` y `consultar-credenciales` está en el commit `eaa8d3f`:

```bash
git checkout eaa8d3f -- Plataforma_Restaurantes-main/supabase/functions/
git checkout eaa8d3f -- Plataforma_Restaurantes-main/supabase/config.toml
```

Las 10 funciones nuevas y los 7 módulos de `_shared/` no existían antes: basta
con borrar sus carpetas.

### 10.2 Base de datos

Todo es aditivo. Para deshacer, por fases y en orden inverso:

```sql
-- Fase C
DROP FUNCTION IF EXISTS public.subir_cierre_turno(jsonb);
DROP FUNCTION IF EXISTS public.historico_cierre_turno(uuid, date, date, integer);
DROP FUNCTION IF EXISTS public.guardar_parametros_nomina(jsonb);
DROP INDEX IF EXISTS public.uq_parametros_nomina_empresa_dimensiones;

-- Fase B
SELECT cron.unschedule('refrescar-token-loggro');
DROP VIEW IF EXISTS public.estado_integraciones;
DROP FUNCTION IF EXISTS public.programar_refresco_loggro(text, text, text);
DROP FUNCTION IF EXISTS public.estado_tareas_programadas();
DROP FUNCTION IF EXISTS public.app_es_rol_servicio();
DROP INDEX IF EXISTS public.uq_credenciales_plataforma_empresa;

-- Fase A · políticas nuevas
DROP POLICY IF EXISTS "historico_nomina_tenant"                ON public.historico_nomina;
DROP POLICY IF EXISTS "apoyos_turno_tenant"                    ON public.apoyos_turno;
DROP POLICY IF EXISTS "gastos_costos_tenant"                   ON public.gastos_costos;
DROP POLICY IF EXISTS "empresa_configuracion_nomina_tenant"    ON public.empresa_configuracion_nomina;
DROP POLICY IF EXISTS "historial_facturacion_select_tenant"    ON public.historial_facturacion;
DROP POLICY IF EXISTS "integracion_credibanco_admin"           ON public.integracion_credibanco;
DROP POLICY IF EXISTS "loggro_refrescar_token_sin_lectura"     ON public.loggro_refrescar_token;
DROP POLICY IF EXISTS "cierres_turno_final_tenant"             ON public.cierres_turno_final;
DROP POLICY IF EXISTS "cierres_inventario_tenant"              ON public.cierres_inventario;
DROP VIEW IF EXISTS public.inventario_diario_resumen;
```

> **Aviso sobre la Fase A.** Restaurar las políticas originales de
> `cierres_turno_final` y `cierres_inventario` **reabre la fuga entre empresas**
> descrita en 5.1. Si hay que revertir, revierte lo demás y deja esas dos.

Las tablas `compras_facturas` y `compras_facturas_lineas` y el bucket
`nomina-pdf` se pueden dejar: están vacíos y no estorban.

### 10.3 Credenciales cifradas

El cifrado es reversible con la llave maestra, y `decryptText()` acepta texto
plano, así que revertir el código no rompe nada. Para volver a texto plano
haría falta ejecutar el proceso inverso; **no se recomienda**.

---

## 11 · Exportar estos cambios a otro repositorio

Este repositorio centraliza URLs en `js/urls.js` y `js/webhooks.js`, y la
configuración de Supabase en `js/config.js`. Para llevar esto a otro repositorio:

1. **Copia** `supabase/functions/` completa (incluido `_shared/`),
   `supabase/migrations/2026082213*` a `2026082219*` y `supabase/config.toml`.
2. **Antes de desplegar**, comprueba que el proyecto destino tiene las tablas
   `empresas`, `usuarios_sistema`, `usuarios_locales`, `grupos_empresariales`,
   `system_users`, `integraciones_credenciales` y `credenciales_plataforma`.
   Los módulos de `_shared/` dependen de esos nombres.
3. **Enlaza y aplica**:
   ```bash
   supabase link --project-ref <ref-destino>
   supabase db push --linked
   supabase secrets set --env-file <tu-env>
   supabase functions deploy
   ```
4. **Secretos obligatorios**: `MASTER_ENCRYPTION_KEY` (mínimo 16 caracteres,
   sin ella las funciones fallan a propósito) y `CRON_SECRET`.
   Opcionales con valor por defecto sensato: `LOGGRO_API_URL`,
   `LOGGRO_TOKEN_TTL_MIN`, `LOGGRO_TIMEOUT_MS`, `ALLOWED_ORIGINS`.
5. **Comprueba si ya hay algo que haga lo mismo.** Si el repositorio destino
   tiene una función de credenciales propia, no la dupliques: `loggro.ts` espera
   leer de `integraciones_credenciales` y cachear en `credenciales_plataforma`,
   y dos escritores sobre esas tablas se pisarían.
6. **Orígenes CORS**: `_shared/cors.ts` trae una lista blanca fija más lo que
   añada `ALLOWED_ORIGINS`. Si el dominio cambia, actualízalo o el navegador
   bloqueará el preflight.
7. **Frontend**: las funciones se invocan con `supabase.functions.invoke(...)`,
   que ya adjunta el JWT. No uses `fetch` directo contra la URL de la función:
   perderías la cabecera `Authorization` y recibirías 401.

# Traspaso de contexto — Migración n8n → Supabase Edge Functions

**Corte:** 2026-08-22 · **Rama:** `master` · **Último commit:** `eaa8d3f`

Documento de arranque para una ventana de conversación nueva. Contiene todo lo
necesario para retomar sin releer el historial.

> ⚠️ `ESTADO_PROYECTO.md` (raíz) está **desactualizado**: menciona el proyecto
> Supabase antiguo `ivgzwgyjyqfunheaesxx` y la regla «prohibido tocar la base de
> datos», ambas superadas. Este documento manda sobre aquel.

---

## 1 · Objetivo del trabajo

Desconectar por completo n8n y reemplazar sus **37 flujos** por Edge Functions
de Supabase + funciones SQL + `pg_cron`, sobre la base de datos **«Enkrato
Google»**, que es una copia de producción.

Requisitos que fijó el usuario:

- Multi-tenant real: varias empresas registradas, cada una accede solo a sus
  datos. Cada Edge Function debe ser dinámica, sin nada hardcodeado.
- La función de **credenciales es la pieza crítica**: de ella depende el resto
  de módulos.
- **Sí** se puede modificar y agregar tablas/columnas en la copia.
  **No** se puede inventar datos ni eliminar tablas existentes.
- Avanzar por fases completas, verificando por función entera, no por cambio
  pequeño.

---

## 2 · Entorno

| Dato | Valor |
|---|---|
| Proyecto Supabase (copia editable) | `tgkvcvnwwnrlyhbqmhaf` — «Enkrato Google» |
| URL | `https://tgkvcvnwwnrlyhbqmhaf.supabase.co` |
| Proyecto antiguo (producción, NO tocar) | `ivgzwgyjyqfunheaesxx` |
| Frontend | HTML + CSS + JS plano, sin build, GitHub Pages en `restaurantes.enkrato.com` |
| API externa | Loggro / pirpos — `https://api.pirpos.com` |
| Zona horaria | Colombia UTC-5, centralizada en `_shared/fechas.ts` |

**Notas de entorno aprendidas a golpes:**

- La clave `sb_secret_...` la rechazan PostgREST y el Auth Admin API. Hay que
  usar el **service_role JWT legacy**.
- El Auth Admin API devuelve **403 (Cloudflare)** desde esta máquina, así que no
  se puede acuñar un JWT de usuario. **No es posible probar el happy path
  completo con sesión desde aquí.** Las pruebas se hicieron con service_role +
  llamadas reales a la API de Loggro.
- La CLI de Supabase no tiene ejecutor de SQL arbitrario: la verificación de
  migraciones se hace vía PostgREST.
- Los heredocs de bash se comen las barras invertidas → para scripts Python usar
  la herramienta Write y rutas Windows (el Python de Windows no lee rutas
  `/c/...`).

---

## 3 · Reglas del proyecto vigentes

`.agents/rules/migracion-google.md`

1. ~~Prohibido DDL en producción~~ → **relajada** por el usuario para la copia.
2. Las Edge Functions se desarrollan en local.
3. Paso a paso; no modificar archivos por cuenta propia hasta que se pida la fase.

`.agents/rules/documentacion.md` — **cada cambio se documenta** en `docs/` con
nombre `AAAA-MM-DD_titulo.md` e incluye: objetivo, archivos tocados,
instrucciones de reversión de emergencia línea por línea, guía de exportación a
otro repositorio y checklist de funcionalidad para logs. Los parches se **añaden
al mismo archivo** y este se renombra con el sufijo `y N parches`.

---

## 4 · Lo que YA ESTÁ HECHO Y VERIFICADO

### 4.1 Migraciones aplicadas (7, todas con `supabase db push --linked`)

| Archivo | Contenido |
|---|---|
| `20260822130000_fase_a_cimientos.sql` | Helpers `app_es_superadmin()`, `app_empresa_id()`, `app_es_local()`, `app_grupo_de()`, `app_empresas_visibles()`, `app_puede_ver_empresa()`, `app_es_admin()`. Corrige 4 políticas rotas. RLS para 7 tablas sin políticas. Columnas nuevas en `credenciales_plataforma` e `integraciones_credenciales`. Vista `inventario_diario_resumen`. Tablas `compras_facturas` y `compras_facturas_lineas`. |
| `20260822160000_fase_b_storage_y_cron.sql` | Bucket `nomina-pdf`, `pg_cron` + `pg_net`, `programar_refresco_loggro()`, `estado_tareas_programadas()`, vista `estado_integraciones`. |
| `20260822163000_fase_b_parche_permiso_cron.sql` | Intento 1 de permitir service_role (usaba `current_user`, no sirvió). |
| `20260822164500_fase_b_parche2_rol_servicio.sql` | `app_es_rol_servicio()` leyendo `request.jwt.claims`. |
| `20260822170000_fase_b_parche3_unico_credenciales.sql` | Índice único **TOTAL** `uq_credenciales_plataforma_empresa`. |
| `20260822180000_fase_c_rpc_cierre_turno.sql` | RPC `subir_cierre_turno(jsonb)`, `historico_cierre_turno(...)`, `guardar_parametros_nomina(jsonb)`. |
| `20260822190000_fase_c_parche_vista_integraciones.sql` | Cierra `estado_integraciones` e `inventario_diario_resumen` al acceso anónimo. |

### 4.2 Módulos compartidos — `supabase/functions/_shared/`

| Archivo | Qué expone |
|---|---|
| `tenant.ts` 🆕 | `resolverContexto(req, empresaSolicitada?)` → `Contexto` con `authUserId, correo, empresaId, empresaPropiaId, rol, esSuperadmin, esAdmin, esLocal, grupoId, empresasVisibles[], t{...}, clienteUsuario, clienteAdmin`. Además `clienteConJwt`, `clienteServicio`, `cabeceraAuth`, `tablasPara`, `exigirAdmin`. **Invariante: el `empresa_id` del cuerpo solo se honra para superadmins y siempre se valida contra el alcance.** |
| `loggro.ts` 🆕 | `obtenerSesionLoggro(admin, empresaId, {forzarRenovacion})`, `iniciarSesion`, `pedirLoggro`, `comoLista`, `limpiarCache`. Caché de 3 niveles: memoria del isolate → `credenciales_plataforma.token` → login. |
| `errores.ts` 🆕 | `ErrorFuncion`, `errores.*`, `responderError`, `leerCuerpo`, `envObligatorio`. |
| `fechas.ts` 🆕 | `instanteLocal`, `inicioDelDia`, `finDelDia`, `rangoTurno`, `rangoRelativo`, `hoyLocal`, `esFechaValida`. `DESFASE_HORAS = -5`. |
| `ventas.ts` 🆕 | `CANALES`, `claveMetodo`, `propinaConComision`, `resumirVentas`, `negocioDe`, `filtrarPorNegocio`. |
| `usuarios.ts` 🆕 | `crearCuentaAuth`, `deshacerCuentaAuth`, `exigirEmpresaActiva`, `exigirCedulaLibre`. |
| `correo.ts` 🆕 | `enviarCorreo`, `proveedorConfigurado`, `plantilla`. Backends `resend` \| `smtp` (import dinámico de denomailer) \| `relay`. |
| `cors.ts`, `crypto.ts` | Preexistentes, sin cambios. |

### 4.3 Edge Functions desplegadas (14)

`guardar-credenciales` · `consultar-credenciales` · `consultar-ventas` ·
`consultar-gastos` · `consultar-inventarios` · `consultar-propina-apoyos` ·
`cierre-inventarios-subir` · `compras-subir` · `compras-importar` ·
`registro-empleados` · `registro-otros-usuarios` · `registro-local` ·
`nomina-enviar-correo` · `cron-refrescar-token-loggro`

`supabase/config.toml` las declara todas con `verify_jwt = true`, salvo el cron
(`false`, protegido con la cabecera `x-cron-secret` contra `CRON_SECRET`).

### 4.4 Verificaciones superadas

- `deno check` limpio 14/14.
- Auditoría estática `auditar.py`: **0 secretos hardcodeados** en 23 archivos,
  14/14 funciones con alcance de tenant, 7/7 comprobaciones del núcleo de
  credenciales.
- Humo en vivo 14/14: `OPTIONS` → 204 con CORS correcto; `POST` sin JWT → 401;
  JWT falso → 401 del gateway; el cron rechaza sin `x-cron-secret`.
- **Contra `api.pirpos.com` de verdad:** login OK en las 4 empresas; el cron
  corrió 3 veces (4 renovados / 0 fallidos → 4 vigentes / 0 renovados →
  expiración forzada → 4 renovados); agregación de ventas sobre **40 facturas
  reales** cuadra al peso (6 canales = `total_general_valor` = 1 578 600); 30
  gastos reales en 4 tipos; 164 productos, 97 con stock, 97/97 con
  `locationStockId`.
- **Credenciales cifradas:** las 4 contraseñas en texto plano de
  `integraciones_credenciales` quedaron cifradas con AES-GCM (prefijo `enc:`),
  con round-trip verificado antes de cada escritura.
- **Cron activo:** `refrescar-token-loggro`, `0 */4 * * *`.

### 4.5 Defectos heredados encontrados y corregidos

1. **4 políticas RLS con la tautología `ge.empresa_id = ge.empresa_id`** en
   `cierres_turno_final` y `cierres_inventario`: cualquier usuario de un grupo
   podía leer los cierres de **cualquier** empresa. Corregido.
2. `obtener_historico_inventarios()` era `SECURITY DEFINER` y aceptaba
   `p_empresa_id` del cliente sin comprobar el tenant. Corregido.
3. `registro-empleados` estaba desplegada con `verify_jwt = false`: cualquiera
   con la URL podía crear cuentas. Corregido.
4. 7 tablas con RLS activo y **cero políticas** (`historico_nomina`,
   `apoyos_turno`, `gastos_costos`, `empresa_configuracion_nomina`,
   `historial_facturacion`, `integracion_credibanco`, `loggro_refrescar_token`).
5. `sql/009` comparaba `rol = 'administrador'`, valor que **no existe** (los
   roles reales son `admin_root`, `admin`, `revisor`).
6. `js/config.js` tenía la `publishableKey` de **otro proyecto**. Corregida a
   `sb_publishable_pjP9JOVNeQnGseLvshx2Xw_E3jKI85R`.
7. `estado_integraciones` era legible por usuarios anónimos.

### 4.6 Errores propios que solo aparecieron probando contra la API real

Guardar esta lista: son trampas de la API de Loggro.

- El token viene en **`tokenCurrent`**, no en `token` ni `access_token`.
- El id del negocio está en **`business._id`**; el `sub` del JWT es el id del
  **usuario**, no del negocio.
- `/Ingredients` hereda el catálogo del padre: filtrar por negocio dejaba
  **1 producto de 164**. Se decidió no filtrar (bandera
  `FILTRAR_INVENTARIO_POR_NEGOCIO`).
- `/expenses` marca el negocio como objeto `business._id`, no como string
  `businessId`.
- El importe de la factura es `total`; `value` y `deliveryCost` no existen.
- **Un índice único parcial no sirve como destino de `ON CONFLICT`**: el cron
  reportaba «renovado» mientras `token_expira_en` seguía en NULL.
- **`current_user` dentro de `SECURITY DEFINER` devuelve el dueño de la
  función**, no el rol de la petición.

---

## 5 · Decisiones del usuario que desbloquearon el cierre

- **Módulo Siigo descontinuado**, junto con sus **9 webhooks** (5 propios + 4 de
  facturación y cobros).
- **Credibanco, Dashboard y Recuperación de contraseña**: flujos ya en desuso.
- **`duplicar_usuarios`**: duplicaba los usuarios en una tabla de la BD para que
  cada local de una empresa tuviera un usuario con id distinto. **Sí hay que
  reimplementarlo.**
- Instrucción textual: *«haz los cambios ya que no romperán nada»*.
- Correo: *«si tú puedes hacer la opción de Resend hazlo, te doy ese permiso, si
  no puedes dime qué debo hacer en mi Hostinger»*.

**Corrección importante de un informe anterior:** se escribió que la nómina no
se migró «porque la fórmula no está documentada». **Es falso.** El nodo
`Nómina_Nuevo` dice literalmente `// ❌ ELIMINADO: TODOS los cálculos
monetarios`: n8n solo devuelve datos crudos. **La fórmula vive en
`js/nomina.js`** (clasificación diurno/nocturno/dominical en las líneas 364-392,
emparejamiento de conceptos en 420-423, deducciones y neto más abajo).

---

## 6 · LO QUE FALTA — por orden de arranque

### 6.1 Correo (bloqueado por el usuario)

Verificado con `nslookup`: el DNS de `enkrato.com` lo gestiona **Hostinger**
(`dns.hostinger.com`) y **no tiene registros MX** → el dominio no tiene correo
activo hoy. `restaurantes.enkrato.com` apunta a GitHub Pages (`nsone.net`).

**No puedo crear la cuenta de Resend**: exige registro con confirmación por
correo, aceptación de términos y datos de facturación. Sin navegador ni cuenta.

Dos caminos; ambos terminan en un solo `supabase secrets set`:

| Camino | Qué hace el usuario | Variables a fijar |
|---|---|---|
| **Hostinger (recomendado)** | hPanel → Correos → activar plan en `enkrato.com` → crear `no-responder@enkrato.com` | `CORREO_PROVEEDOR=smtp`, `CORREO_REMITENTE`, `SMTP_HOST=smtp.hostinger.com`, `SMTP_PORT=465`, `SMTP_USUARIO`, `SMTP_PASSWORD` |
| **Resend** | Registrarse en resend.com → añadir SPF, DKIM y MX en el DNS de Hostinger → copiar API key | `CORREO_PROVEEDOR=resend`, `CORREO_REMITENTE`, `RESEND_API_KEY` |

El código ya soporta ambos: `_shared/correo.ts` conmuta por `CORREO_PROVEEDOR`.
No hay que tocar `nomina-enviar-correo`.

### 6.2 Limpieza de webhooks muertos — **no depende del usuario, se puede hacer ya**

`js/webhooks.js` tiene **47 constantes `WEBHOOK_*`** y 49 referencias en total.

- Marcar como obsoletas las **12 muertas** (9 de Siigo/facturación + Credibanco
  + Dashboard + Recuperación de contraseña) y hacer que sus páginas consumidoras
  degraden con elegancia en vez de colgarse contra n8n.
- **Hallazgo que ahorra trabajo:** `public.billing_daily_enforcer()`,
  `public.create_billing_cycles_for_period(p_periodo text)` y
  `public.resolver_pago_revision(...)` **ya existen como funciones SQL** en
  `20240101000000_init.sql`. Los webhooks de facturación de n8n solo las
  disparaban → se reemplazan con **2 tareas `pg_cron`**, sin necesidad de los
  flujos exportados.
- **Reimplementar `duplicar_usuarios`** como RPC sobre `usuarios_locales`,
  aprovechando el índice único de la Fase A. El consumidor es
  `js/anadir_local_usuario.js`: llama a `WEBHOOK_DUPLICAR_USUARIOS_LOCAL` con un
  `fetch` plano (~línea 86), protegido por `canManageLocals` (rol `admin` o
  `admin_root`), y lee de `sessionStorage` las claves `local_dependiente_nit`,
  `local_dependiente_correo`, `local_dependiente_empresa_id`. Al terminar las
  limpia y redirige a `APP_URLS.configuracion`. **Queda pendiente leer el objeto
  `payload` completo (~línea 81) antes de diseñar el reemplazo.**

### 6.3 Fase E — RPC de nómina

Crear `consultar_nomina(p_empresa_id, p_empleado_id, p_desde, p_hasta)` que
devuelva `Tabla_Parametros.Datos[]`, `Tabla_Datos.Rows[]` y
`Tabla_Apoyos.Datos[]`. **No hace falta pedirle la fórmula al usuario**: está en
`js/nomina.js`. Validar contra n8n con 2-3 empleados ya liquidados.

### 6.4 Fase F — Reconexión del frontend, en 7 entregas

Orden: gastos/inventarios (solo lectura) → históricos → propina apoyos → subida
de cierres → registro → nómina → compras.

> **Regla crítica:** usar `supabase.functions.invoke(...)`, **nunca** `fetch`
> plano. Con `fetch` se pierde la cabecera `Authorization` y el gateway responde
> 401.

### 6.5 Otros pendientes

- Importar los datos de la hoja «Automatización Facturas» con `compras-importar`.
- **El usuario debe rotar**: las dos contraseñas de Loggro y el `service_role`
  JWT de producción — están **en texto plano** en los archivos versionados
  `Flujos N8N/*.txt`.
- El usuario debe copiar `MASTER_ENCRYPTION_KEY` a un gestor de contraseñas. Ya
  está en los secrets de Supabase; la copia del scratchpad es solo un respaldo
  temporal.

---

## 7 · Documentos de referencia

| Archivo | Contenido |
|---|---|
| `docs/2026-08-22_plan_migracion_n8n_a_edge_functions.md` | Análisis de los 37 flujos y el plan completo. |
| `docs/2026-08-22_migracion_n8n_edge_functions_fases_a_b_c.md` | Todo lo ejecutado y verificado en las fases A/B/C, con reversión. |
| `docs/2026-08-22_plan_cierre_n8n_correo_y_nomina.md` | Plan de correo, nómina y reconexión del frontend; corrección de nómina y estado de módulos. |
| `ESTADO_PROYECTO.md` | ⚠️ Desactualizado (proyecto Supabase antiguo). |

---

## 8 · Estado de git

Rama `master`, último commit `eaa8d3f` («Respaldo seguro tras aplicar Fase 0»).
**63 rutas sin commitear**, entre ellas todo lo nuevo: `supabase/functions/`,
`supabase/migrations/`, `supabase/config.toml`, `.agents/rules/documentacion.md`,
`ESTADO_PROYECTO.md` y los 3 documentos del 2026-08-22. Los `.css` modificados
vienen de una fase anterior de diseño.

**Nada de esto está respaldado en un commit.** Conviene hacerlo antes de seguir.

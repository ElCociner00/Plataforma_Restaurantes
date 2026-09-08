# 2026-08-22 · Plan de migración de los 37 flujos n8n a Supabase Edge Functions

## 1 · Objetivo de esta petición

Revisar y entender **los 37 flujos** de la carpeta `Flujos N8N/`, contrastarlos
contra el esquema real de la base de datos copiada (`Enkrato Google`), y producir
un plan de reemplazo ejecutable que:

- defina **qué Edge Function** reemplaza a cada flujo (o si no hace falta ninguna),
- determine **qué tablas, vistas, índices y políticas RLS hay que crear o alterar**,
- garantice que **cada función es multi-tenant dinámica**: la empresa nunca se
  acepta del cliente, se deduce del JWT.

Este documento **no modifica código ni base de datos**. Es el plan previo.

---

## 2 · Archivos analizados

37 archivos `.txt` (903 KB de JSON de n8n) bajo `Flujos N8N/`:

| Carpeta | Archivos |
|---|---|
| `Loggro/Cierre_Turno/` | 4 |
| `Loggro/Pedir_Datos/` | 10 |
| `Loggro/compras/` | 4 |
| `Loggro/inventarios/` | 2 |
| `Nómina/` | 6 |
| `Registro/` | 9 |
| `Verificación/` | 2 |

Contrastados contra:

- `Plataforma_Restaurantes-main/supabase/migrations/20240101000000_init.sql` (3 844 líneas, 36 tablas + 8 vistas)
- `Plataforma_Restaurantes-main/supabase/sql/002…009_*.sql`
- `Plataforma_Restaurantes-main/supabase/functions/` (4 funciones ya existentes)
- `Plataforma_Restaurantes-main/js/` (frontend que consume los webhooks)

---

## 3 · Hallazgos que corrigen el plan original

Estos ocho puntos cambian decisiones del plan que traías. Están verificados
contra los archivos, no supuestos.

### 3.1 El módulo Compras **no vive en Supabase, vive en Google Sheets**

`Datos_Compra`, `Llamar_Facturas` y `Reasignar_Local` estaban clasificados como
«Código Simple / Supabase». En realidad **los tres nodos de datos son
`n8n-nodes-base.googleSheets`** sobre el documento **«Automatización Facturas»**.
`subir_compras` también lee y escribe ese Sheet (6 nodos de Sheets).

**No existe ninguna tabla de facturas de compra en el esquema.** Las tablas
`facturas_empresas`, `facturacion` e `historial_facturacion` son de la
facturación **del SaaS al cliente**, no de facturas de proveedor.

> **Consecuencia:** Compras no es una migración de código, es una **migración de
> datos**. Hay que crear la tabla y volcar el Sheet antes de tocar las funciones.

### 3.2 Dos flujos son **cron**, no petición/respuesta

`Reinicio_Credenciales_loggro` y `Verificación_Usuarios_Local_Dups` arrancan con
`scheduleTrigger`. No son llamables desde el frontend y no pueden ser «Código
Simple» en el navegador. Van como **pg_cron → Edge Function** (o, en el segundo
caso, se eliminan con una restricción `UNIQUE`, ver 5.4).

### 3.3 `verificar.txt` no toca la base de datos

Son 3 nodos: `webhook → code → respond`. Cálculo puro de diferencias entre
ingresos, egresos y gastos. **No necesita Edge Function ni RPC**: es aritmética
que puede vivir en el frontend, o en una función SQL `IMMUTABLE` si se quiere
blindar la fórmula.

### 3.4 `histórico_cierre_inventarios` lee una vista **que no existe**

El flujo consulta `inventario_diario_resumen`. Esa relación **no aparece en el
esquema copiado**. Lo más cercano que existe es `cierres_inventario_agrupado` y
`vista_cierres_inventario`. Hay que crear la vista o reapuntar la consulta.

### 3.5 Siete tablas tienen **RLS activo y CERO políticas**

n8n funcionaba porque usaba la `service_role`, que ignora RLS. Una Edge Function
que use el **JWT del usuario** (que es lo correcto) devolverá **0 filas**:

| Tabla | La usa el flujo |
|---|---|
| `historico_nomina` | `Guardar_Nómina`, `Histórico Nómina`, `Histórico Nómina vista`, `Borrar_Nómina` |
| `apoyos_turno` | `subir_cierre` (turno), `Nómina_Nuevo` |
| `loggro_refrescar_token` | `Registro_Credenciales_loggro`, `Reinicio_Credenciales_loggro` |
| `gastos_costos` | — (huérfana) |
| `empresa_configuracion_nomina` | — (huérfana) |
| `historial_facturacion` | — (facturación SaaS) |
| `integracion_credibanco` | — (integración aparte) |

> **Consecuencia:** escribir estas políticas es requisito **bloqueante** de los
> módulos Nómina y Cierre de turno.

### 3.6 La API de Loggro es `api.pirpos.com`, no `api.loggro.com/v1`

El README de `consultar-ventas` asumía `https://api.loggro.com/v1` y decía que
«el repositorio no contiene documentación de la API real». **Los flujos sí la
contienen.** Contrato real extraído:

| Verbo | Endpoint | Parámetros | Uso |
|---|---|---|---|
| `POST` | `https://api.pirpos.com/login` | body `{email, password}` → `token` | Autenticación |
| `GET` | `/invoices` | `status=Pagada&dateInit=&dateEnd=` | Ventas, propinas |
| `GET` | `/expenses` | `dateInit=&dateEnd=` | Gastos |
| `GET` | `/Ingredients` | `dateInit=&dateEnd=` | Inventarios / stock |
| `POST` | `/inventories` | body con movimientos | Subir compras e inventario |

Cabeceras: `accept: application/json`, `authorization: Bearer <token>`.
Las fechas se envían en ISO con desfase manual de **+5 h** (Colombia, UTC-5)
aplicado en el propio n8n — hay que replicarlo o corregirlo a `America/Bogota`.

### 3.7 Credenciales de Loggro **en texto plano y hardcodeadas por empresa**

En `Loggro/Cierre_Turno/consultar_ventas.txt` hay dos nodos con cuentas
literales embebidas en el JSON:

- nodo `Token - todos los batut` → cuenta `gerenciabatut@gmail.com`
- nodo `Token - BATUT SIPS AND BITES BAR` → cuenta `loggro-test@example.invalid`

Ambos con la contraseña escrita en claro dentro del archivo. Además, la tabla
`loggro_refrescar_token` guarda `usuario` y `contraseña` **sin cifrar**.

> **Acción independiente de la migración: rotar ambas contraseñas de Loggro.**
> Están en un archivo versionado en git. Se dan por comprometidas.
>
> Además, este *hardcoding* por nombre de empresa es exactamente lo contrario al
> requisito de multi-tenant dinámico. Desaparece con `integraciones_credenciales`.

### 3.8 Ojo: hay **dos** proyectos Supabase enlazados en el repositorio

| Ruta | Project ref | Nombre | Qué es |
|---|---|---|---|
| `Migración_Google/supabase/.temp/` | `ivgzwgyjyqfunheaesxx` | «Bases de datos» | **PRODUCCIÓN** |
| `Plataforma_Restaurantes-main/supabase/.temp/` | `tgkvcvnwwnrlyhbqmhaf` | **«Enkrato Google»** | la copia, la correcta |

`js/config.js` ya apunta a `tgkvcvnwwnrlyhbqmhaf` ✅. Los flujos n8n apuntan a
`ivgzwgyjyqfunheaesxx` en sus llamadas al Admin API.

> **Riesgo:** ejecutar `supabase db push` desde la raíz del proyecto impacta
> **producción**. Todo comando debe llevar `--project-ref tgkvcvnwwnrlyhbqmhaf`
> explícito, o ejecutarse desde `Plataforma_Restaurantes-main/`.
> Recomendación: borrar `Migración_Google/supabase/.temp/` para eliminar la trampa.

---

## 4 · El modelo multi-tenant real (esto es la clave de todo)

Casi todos los flujos parecen tener el doble de nodos de los necesarios. La razón
es que **cada flujo está duplicado a mano para dos ejes independientes**:

### Eje 1 — ¿Es superadmin de plataforma?

```
Webhook → Get a row (system_users) → If → …
```

`system_users` tiene solo `(id, nombre, correo, created_at)` — **no tiene
`empresa_id`**. Es la lista blanca de superadministradores de Enkrato. Si el
correo del solicitante está ahí, la rama «verdadera» pasa por un nodo
`Edit Fields` que **inyecta el `empresa_id` que vino en el body**. Si no está,
se usa el `empresa_id` propio del usuario.

### Eje 2 — ¿Es empresa suelta o local dentro de un grupo?

```
… → Get a row (grupos_empresariales) → If → rama A | rama B
```

| | Empresa individual | Local de grupo |
|---|---|---|
| Cierres de turno | `cierres_turno_final` | `cierres_turno_final_locales` |
| Apoyos | `apoyos_turno` | `apoyos_turno_locales` |
| Vista agrupada | `turnos_agrupados` | `turnos_agrupados_locales` |
| Usuarios | `usuarios_sistema` | `usuarios_locales` |

### Cómo colapsa en Edge Functions

Los dos ejes se resuelven **una sola vez** en un helper compartido, y el resto
del código deja de estar duplicado:

```ts
// supabase/functions/_shared/tenant.ts
export type Contexto = {
  authUserId: string;
  empresaId: string;        // NUNCA viene del body salvo superadmin
  esSuperadmin: boolean;
  esLocal: boolean;
  grupoId: string | null;
  empresasVisibles: string[];
  t: {                       // nombres de tabla ya resueltos
    cierres: "cierres_turno_final" | "cierres_turno_final_locales";
    apoyos:  "apoyos_turno"        | "apoyos_turno_locales";
    turnos:  "turnos_agrupados"    | "turnos_agrupados_locales";
    usuarios:"usuarios_sistema"    | "usuarios_locales";
  };
};
```

Reglas que impone el helper:

1. `empresaId` sale de `auth.getUser()` → `usuarios_sistema.id = auth.uid()`.
   El cuerpo de la petición **no puede elegir empresa**.
2. La única excepción es superadmin: si `auth.email()` está en `system_users`,
   se acepta `body.empresa_id` — y **solo entonces**.
3. El cliente Supabase se construye con **anon key + JWT del usuario**, nunca
   con `service_role`, salvo las tres funciones marcadas como privilegiadas
   en 6.4. Así el RLS sigue siendo la segunda barrera.

Esto ya está aplicado en `functions/consultar-ventas/index.ts`; el helper solo
extrae ese patrón para reutilizarlo.

---

## 5 · Cambios necesarios en la base de datos «Enkrato Google»

> Ninguno borra tablas ni inventa datos. Son adiciones y políticas.

### 5.1 Funciones SQL de contexto (nuevas)

```sql
app_empresa_id()        -- empresa del JWT actual
app_es_superadmin()     -- ¿auth.email() ∈ system_users?
app_es_local(uuid)      -- ¿la empresa pertenece a un grupo?
app_empresas_visibles() -- empresa propia + locales del grupo (setof uuid)
```

Todas `SECURITY DEFINER`, `STABLE`, `search_path = public`. Sirven tanto al
helper de TypeScript como a las políticas RLS, evitando duplicar la regla.

### 5.2 Políticas RLS faltantes (bloqueante)

Escribir políticas `SELECT/INSERT/UPDATE/DELETE` sobre las 7 tablas de 3.5,
usando `empresa_id IN (SELECT app_empresas_visibles())`.

Prioridad: `historico_nomina` y `apoyos_turno` primero — sin ellas, Nómina y
Cierre de turno no funcionan.

### 5.3 Tabla nueva: `compras_facturas`

Reemplaza el Sheet «Automatización Facturas». Columnas a derivar de las columnas
reales del Sheet (**pendiente de exportar; ver 8.1**), más lo que exigen los flujos:

```
id uuid pk · empresa_id uuid not null · proveedor text · nit_proveedor text
numero_factura text · fecha date · subtotal numeric · iva numeric · total numeric
estado text        -- pendiente | validada | subida | reasignada
local_asignado uuid references empresas(id)
items jsonb        -- líneas de la factura
subida_loggro_at timestamptz · subida_por uuid
created_at timestamptz default now()
unique (empresa_id, proveedor, numero_factura)
```

Con RLS por `empresa_id` desde el primer día.

### 5.4 Índices y restricciones nuevos

| Objeto | Motivo |
|---|---|
| `unique (empresa_id, plataforma)` en `credenciales_plataforma` | hoy permite duplicados; el flujo `Registro_Credenciales_loggro` hace un `get`+`if`+`create/update` manual precisamente por esto |
| `unique (empresa_id, usuario_principal_id)` en `usuarios_locales` | **elimina por completo** el cron `Verificación_Usuarios_Local_Dups`: la base impide el duplicado en vez de barrerlo cada N minutos |
| `credenciales_plataforma += token_expira_en timestamptz` | permite refrescar el token solo cuando toca, en lugar de refrescar todo cada vez |
| `integraciones_credenciales += activo boolean default true` | desactivar una integración sin borrar la fila |

### 5.5 Vista nueva: `inventario_diario_resumen`

Sobre `cierres_inventario`, con `security_invoker='on'` (igual que
`turnos_agrupados`), reproduciendo la forma que espera
`js/historico_cierre_inventarios.js`.

### 5.6 Cifrado de credenciales

`sql/009` ya creó `integraciones_credenciales` y copió las credenciales desde
`loggro_refrescar_token` — **pero las copió en claro**. `functions/_shared/crypto.ts`
ya implementa AES-GCM con prefijo `enc:`. Falta:

1. Un `MASTER_ENCRYPTION_KEY` en `supabase secrets`.
2. Una pasada única que cifre las filas existentes.
3. Que `guardar-credenciales` cifre siempre al escribir.

### 5.7 Storage

Bucket privado `nomina-pdf` para `Nómina/Enviar_Correo`, que hoy recibe el PDF
como binario en el webhook (nodo `extractFromFile`).

---

## 6 · Mapa flujo → reemplazo

Leyenda: **EF** = Edge Function · **RPC** = función Postgres + `supabase.rpc()`
desde el frontend · **Directo** = `supabase.from()` con RLS · **Cron** = pg_cron
· **∅** = no requiere backend.

### 6.1 Verificación (2 flujos) — ya resuelto

| Flujo | Reemplazo | Estado |
|---|---|---|
| `Codigo_de_Verificación_Gmail` | ∅ Google OAuth | ✅ Fase 1 hecha |
| `Verificar_Codigo_Gmail` | ∅ Google OAuth | ✅ Fase 1 hecha |

### 6.2 Registro (9 flujos → 5 piezas)

| Flujo | Webhook n8n | Reemplazo | Estado |
|---|---|---|---|
| `Registro_Nueva_Empresa` | `registro` | **RPC** `registrar_empresa_self_service` | ⚠️ `sql/008` escrito, **sin confirmar ejecución** |
| `Registro_Primer_Usuario` | `registro_usuario` | **EF** `registro-primer-usuario` (Admin API + correo) | 🆕 |
| `Registro_Primer_Usuario_Local_Dups` | *(sub-workflow)* | se fusiona en la anterior con `esLocal` | 🆕 |
| `Registro_Nueva_Empresa_Local` | `locales/registrar_local_dependiente` | **EF** `registro-local` | 🆕 |
| `Registro_Empleados` | `registro_empleados` | **EF** `registro-empleados` | ✅ existe — revisar contra 4 |
| `Registro_Admins_y_Revisores` | `registro_admins_y_revisores` | **EF** `registro-otros-usuarios` | 🆕 |
| `Registro_Credenciales_loggro` | `registro_credenciales` | **EF** `guardar-credenciales` + `consultar-credenciales` | ✅ existen — añadir cifrado y validación contra `/login` |
| `Reinicio_Credenciales_loggro` | *(schedule)* | **Cron** `cron-refrescar-token-loggro` | 🆕 |
| `Verificación_Usuarios_Local_Dups` | *(schedule)* | **∅** — sustituido por `UNIQUE` (5.4) | 🆕 |

> Los 4 flujos de registro que crean usuarios llaman a
> `/auth/v1/admin/users` → requieren `service_role`. Son EF obligatorias, y son
> las únicas que pueden llevar esa clave.

### 6.3 Loggro — Cierre de turno (4 flujos)

| Flujo | Webhook | Reemplazo | Estado |
|---|---|---|---|
| `consultar_ventas` | `consultar_datos_cierre` | **EF** `consultar-ventas` | ⚠️ existe pero apunta a la API equivocada (3.6) — reescribir |
| `consultar_gastos` | `consultar_gastos` | **EF** `consultar-gastos` | 🆕 |
| `subir_cierre` | `subir_cierre` | **RPC** `subir_cierre_turno(jsonb)` | 🆕 |
| `verificar` | `verificar_cierre` | **∅** cálculo puro (3.3) | 🆕 |

> `subir_cierre` tiene 25 nodos que son 4 bucles `splitInBatches` insertando fila
> a fila en 4 tablas. Una sola RPC transaccional con `jsonb_to_recordset` lo
> reemplaza entero, y además lo hace **atómico** — hoy, si falla a mitad, quedan
> cierres a medias.

### 6.4 Loggro — Pedir datos (10 flujos → 8 piezas)

| Flujo | Webhook | Reemplazo | Nota |
|---|---|---|---|
| `Cargar_Gastos` | `consultar_gastos_visualizacion` | **EF** `consultar-gastos` (`modo:"visualizacion"`) | fusionable con 6.3 |
| `Cargar_Gastos_Catalogo` | `consultar_gastos_catalogo` | **EF** `consultar-gastos` (`modo:"catalogo"`) | fusionable |
| `Consultar_Propina_Apoyos` | `consultar_propina_apoyo` | **EF** `consultar-propina-apoyos` | 34 nodos, el más complejo |
| `Llamar_Inventarios` | `consultar_inventarios_ingredientes` | **EF** `consultar-inventarios` | fusionable con 6.5 |
| `Llamar_Responsables` | `listar_responsables` | **Directo** | RLS sobre `usuarios_sistema`/`usuarios_locales` |
| `Conceptos_Nómina` | `consultar_concepto_nómina` | **Directo** | `dimensiones_concepto` |
| `Tiempo_Nómina` | `consultar_tiempo_nómina` | **Directo** | `dimensiones_tiempo` |
| `Parametros_Nómina` | `nuevo_parametro_nómina` | **RPC** `guardar_parametros_nomina` | hoy es get+if+create/update → un `upsert` |
| `histórico_cierre_turno` | `cierre_turno_historico` | **RPC** `historico_cierre_turno()` | usa las vistas de 4 |
| `histórico_cierre_inventarios` | `cierre_inventarios_historico` | **RPC** + **vista nueva** (3.4) | bloqueado por 5.5 |

### 6.5 Loggro — Inventarios (2 flujos)

| Flujo | Webhook | Reemplazo |
|---|---|---|
| `Inventarios` | `consultar_inventarios` | **EF** `consultar-inventarios` |
| `subir_cierre` | `cierre_inventarios_subir` | **EF** `cierre-inventarios-subir` (escribe BD + `POST /inventories`) |

### 6.6 Loggro — Compras (4 flujos) — bloqueado por la migración del Sheet

| Flujo | Webhook | Reemplazo |
|---|---|---|
| `Llamar_Facturas` | `Verificacion_Compras` | **Directo** sobre `compras_facturas` |
| `Datos_Compra` | `Datos_Compras` | **Directo** sobre `compras_facturas` |
| `Reasignar_Local` | `compras/reasignar_local` | **RPC** `reasignar_factura_local` |
| `subir_compras` | `Subir_Compras` | **EF** `compras-subir` (`POST /inventories` + marca estado) |

### 6.7 Nómina (6 flujos)

| Flujo | Webhook | Reemplazo | Nota |
|---|---|---|---|
| `Nómina_Nuevo` | `consultar_nomina_nuevo` | **RPC** `calcular_nomina(...)` | 51 nodos; hoy son ~15 viajes de red secuenciales, en SQL es una consulta |
| `Guardar_Nómina` | `nomina_historico_guardar` | **RPC** `guardar_nomina(jsonb)` | |
| `Histórico Nómina` | `nomina_historico_consultar` | **Directo** | requiere RLS de 5.2 |
| `Histórico Nómina vista` | `nomina_historico_consultar_vista` | **Directo** | requiere RLS de 5.2 |
| `Borrar_Nómina` | `nomina_historico_borrar` | **Directo** `.delete()` | requiere RLS de 5.2 |
| `Enviar_Correo` | `nomina_deducciones_enviar` | **EF** `nomina-enviar-correo` | PDF + Storage + Admin API + SMTP |

### 6.8 Recuento

| Categoría | Cantidad |
|---|---|
| Edge Functions nuevas | **11** |
| Edge Functions existentes a revisar/reescribir | **4** |
| RPC nuevas | **8** |
| Consultas directas con RLS | **6** |
| Cron | **1** |
| Eliminados sin reemplazo | **4** |

**37 flujos → 15 Edge Functions + 8 RPC.** La reducción sale de colapsar las
ramas duplicadas del apartado 4 y de fusionar los tres flujos de gastos.

---

## 7 · Fases de ejecución propuestas

Estrictamente en este orden: cada fase desbloquea la siguiente.

| Fase | Contenido | Desbloquea |
|---|---|---|
| **A · Cimientos BD** | 5.1 funciones de contexto · 5.2 políticas RLS · 5.4 índices · 5.5 vista · ejecutar `sql/008` pendiente | todo lo demás |
| **B · Núcleo compartido** | `_shared/tenant.ts` · `_shared/loggro.ts` (cliente pirpos + caché de token) · `_shared/respuestas.ts` · `MASTER_ENCRYPTION_KEY` + cifrado de credenciales (5.6) | C–F |
| **C · Loggro lectura** | `consultar-ventas` (reescritura) · `consultar-gastos` · `consultar-inventarios` · `consultar-propina-apoyos` | Cierre de turno |
| **D · Loggro escritura** | RPC `subir_cierre_turno` · `cierre-inventarios-subir` · cron de token | Cierre de turno completo |
| **E · Nómina** | 6 piezas de 6.7 + bucket `nomina-pdf` | Nómina completa |
| **F · Registro** | 5 piezas de 6.2 | Alta de clientes sin n8n |
| **G · Compras** | migrar el Sheet → `compras_facturas` (5.3) · 4 piezas de 6.6 | Compras |
| **H · Corte** | apagar los webhooks de n8n uno a uno, verificando el frontend | fin |

Fase G va al final a propósito: es la única que depende de un volcado de datos
externo, y es la que más puede tardar por causas ajenas al código.

---

## 8 · Decisiones que necesito de ti antes de la Fase A

### 8.1 El Sheet «Automatización Facturas»

Necesito **la fila de encabezados y 3–5 filas de ejemplo** (anonimizadas si
quieres) para definir las columnas reales de `compras_facturas`. Sin eso
inventaría el esquema, y eso está prohibido.

### 8.2 Alcance de las credenciales de Loggro — decisión pendiente desde `ESTADO_PROYECTO.md`

Los flujos confirman que **cada empresa tiene su propia cuenta de Loggro**
(hay dos cuentas distintas hardcodeadas solo para el grupo Batut). Por tanto:

> Confirmo la lectura: **las credenciales van por empresa en
> `integraciones_credenciales`, cifradas — no en variables de entorno de
> plataforma.** Esto cierra la decisión abierta 5.1 de `ESTADO_PROYECTO.md`.

Solo necesito tu visto bueno para darla por cerrada.

### 8.3 Envío de correo

Los flujos usan el nodo Gmail de n8n con una cuenta conectada por OAuth. Las
Edge Functions no pueden reutilizar esa conexión. Opciones:

1. **Resend / SendGrid** — clave de API en `supabase secrets`, dominio propio.
2. **SMTP de Gmail** con contraseña de aplicación — más frágil, límites bajos.
3. **Auth Hooks de Supabase** — solo sirve para los correos de bienvenida, no
   para el PDF de nómina.

Recomiendo **Resend** con `notificaciones@enkrato.com`.

### 8.4 Confirmación del proyecto destino

Confirma que **`tgkvcvnwwnrlyhbqmhaf` («Enkrato Google»)** es la copia sobre la
que puedo trabajar, y si autorizas borrar `Migración_Google/supabase/.temp/`
para que ningún comando pueda alcanzar producción por accidente (3.8).

---

## 9 · Estado de verificación

| Punto | Estado |
|---|---|
| 37 flujos parseados y su topología extraída | ✅ verificado |
| Tablas y vistas contrastadas contra `init.sql` | ✅ verificado |
| `inventario_diario_resumen` inexistente | ✅ verificado (0 coincidencias) |
| 7 tablas con RLS sin políticas | ✅ verificado (36 RLS / 29 tablas con política) |
| Contrato real de la API pirpos | ✅ extraído de los nodos HTTP |
| Módulo Compras sobre Google Sheets | ✅ verificado (6 nodos `googleSheets`) |
| Columnas reales del Sheet de facturas | ❌ **falta** — ver 8.1 |
| Esquema de `compras_facturas` | ⏸ bloqueado por 8.1 |
| Nada modificado en código ni en BD | ✅ este documento es solo plan |

---

## 10 · Reversión

Este documento **no aplica cambios**. No hay nada que revertir.

A partir de la Fase A, cada fase entregará su propio archivo de parche en
`docs/` siguiendo la regla del proyecto, con el `DROP POLICY` / `DROP FUNCTION`
/ `git revert` correspondiente detallado línea a línea.

Regla de oro para todas las fases: **ningún script llevará `DROP TABLE`,
`TRUNCATE` ni `DELETE` sobre tablas existentes.** Solo `CREATE`, `ALTER … ADD`
y `CREATE POLICY`.

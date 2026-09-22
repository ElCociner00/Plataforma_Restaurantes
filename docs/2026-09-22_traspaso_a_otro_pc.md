# Traspaso a otro PC / otra cuenta — corte del 2026-09-22

Documento de traspaso. Sirve para retomar el trabajo en una sesión nueva, en
otro computador y con otra cuenta de Claude, sin reconstruir el contexto.

**`ESTADO_PROYECTO.md` (raíz del repo) está desactualizado** — es del
2026-08-22 y describe el proyecto Supabase anterior (`ivgzwgyjyqfunheaesxx`).
Ese proyecto ya no es el que usa Enkrato. Este documento lo reemplaza como
fuente de verdad del estado actual.

---

## 0 · Lo primero que hay que hacer en el PC nuevo

1. Clonar `https://github.com/ElCociner00/Plataforma_Restaurantes.git`.
2. Copiar `entorno/.env` (ver §4) — **no está en git**, hay que traerlo aparte
   (USB, gestor de contraseñas, o pegarlo a mano desde este documento y las
   fuentes que cita).
3. Iniciar sesión en el CLI de Supabase con la cuenta que tenga acceso al
   proyecto `tgkvcvnwwnrlyhbqmhaf` (organización **Proyecto Plataforma**).
4. Confirmar que el remoto de git es el correcto: `git remote -v`.
5. No hace falta `npm install`: no hay `package.json` ni build. Es HTML/CSS/JS
   plano servido tal cual por Firebase Hosting.

---

## 1 · Qué es el proyecto

- **Producto:** Enkrato, SaaS de operación para restaurantes (cierres de
  turno, nómina, compras, facturación, integración con Rappi y con Loggro).
- **Dominio:** `restaurantes.enkrato.com`.
- **Hosting:** Firebase Hosting, proyecto `plataforma-restaurantes-8f561`.
  Despliega solo, en cada push a `main`, vía GitHub Actions
  (`.github/workflows/firebase-hosting-merge.yml`). El secreto que autoriza
  ese despliegue (`FIREBASE_SERVICE_ACCOUNT_PLATAFORMA_RESTAURANTES_8F561`)
  vive en **GitHub → Settings → Secrets and variables → Actions** del repo,
  no en ningún archivo local.
- **Stack:** HTML + CSS + JS plano, módulos ES nativos (`<script type="module">`),
  sin build ni framework.
- **Backend:** Supabase.
  - Project ref: `tgkvcvnwwnrlyhbqmhaf`
  - Nombre: "Enkrato Google", organización "Proyecto Plataforma" (plan Free)
  - URL: `https://tgkvcvnwwnrlyhbqmhaf.supabase.co`
  - Región: us-east-2
- **Repo:** `https://github.com/ElCociner00/Plataforma_Restaurantes` (rama
  única de trabajo: `main`; ramas `feat/*`/`fix/*` se abren para cambios
  grandes y se mergean).
- **Colaboración:** el repo lo trabajan Santiago y su hermano desde PCs
  distintos. Las reglas de coordinación viven en
  `C:\Users\Zamora\Enkrato\colaboracion\CLAUDE.md` y `COORDINATION.md` — esa
  carpeta **no es un repo git**, así que esas notas no viajan solas al PC
  nuevo; hay que copiarlas a mano si se van a seguir usando.

---

## 2 · Qué se hizo en esta sesión (2026-09-21 → 22)

En orden:

1. **Homologación Rappi DEV completada: 14/15.** Solo falta el
   auto-onboarding, bloqueado porque Rappi tiene que registrar un
   `redirect_uri` y entregar un `client_id` de Partners que aún no llegó.
2. **Módulo de menú autogestionable** (`rappi/menu.html` +
   `js/rappi/menu.js` + Edge Function `rappi-menu`): categorías, grupos de
   opciones, productos con foto, importar el menú vigente desde Rappi y
   publicar (reemplaza el menú completo en Rappi, como exige su API).
   Verificado en vivo contra la tienda 900170987 (Batut, DEV): 42 productos,
   428 opciones, copia exacta de lo que Rappi ya tenía — publicado y
   **aprobado**.
3. **Rediseño de Integración Rappi** (`rappi/integracion.html` +
   `js/rappi/integracion.js`): checklist estilo homologación con botones
   "Probar" y luces verdes, en vez de pedir JSON.
4. **Vulnerabilidades de tenant encontradas y corregidas** en `rappi-menu`:
   ids sin validar como UUID interpolados en filtros PostgREST, una empresa
   podía referenciar/borrar la imagen de otra, ids ajenos aceptados en
   updates que no encontraban fila. Todas corregidas y verificadas (intento
   cruzado devuelve `IMAGEN_AJENA` / `403`).
5. **Incidente de login (2026-09-21 tarde-noche).** Los usuarios no podían
   entrar aunque la contraseña fuera correcta. Ver §3 para el detalle — quedó
   resuelto, pero vale la pena leerlo porque el diagnóstico fue largo y con
   un par de callejones sin salida que no hay que repetir.

Todo está commiteado y pusheado a `origin/main` (`git status` limpio al
cierre de esta sesión). Nada quedó a medias sin subir.

---

## 3 · El incidente de login — qué pasó y qué NO era

Para que nadie pierda tiempo persiguiendo hipótesis ya descartadas.

**Síntoma:** con contraseña correcta y cuenta activa, la app volvía al login
en bucle. Consola: `PGRST303 — JWT issued at future`.

**Lo que se descartó, con evidencia, y por qué no hay que volver a mirarlo:**

- ❌ **No fue ningún commit de esta sesión.** Se revisó el diff completo
  desde antes del incidente; nada toca autenticación.
- ❌ **No fue desfase de reloj entre servicios de Supabase.** Se midió: el
  reloj de Postgres, el de Auth y el del servicio de datos (PostgREST)
  coincidían al segundo. Esta fue la hipótesis que más tiempo hizo perder.
- ❌ **No fue la migración a llaves JWT asimétricas (ES256).** Se verificó
  en el panel (Settings → JWT Keys) que esa llave lleva rotada **un mes**,
  no horas. Además PostgREST solo emite `PGRST303` *después* de verificar la
  firma con éxito, así que las llaves nunca fueron el problema.

**Qué era en realidad:** el servicio PostgREST del proyecto tenía un
problema interno (no reproducido públicamente, sin causa raíz confirmada por
Supabase) que le hacía rechazar tokens recién emitidos como "del futuro".
**Se resolvió reiniciando el proyecto** desde Supabase → Project Settings →
General → **Restart project** (esa acción no borra nada; es distinta de
*Pause project*, que si vacía el proyecto y no se usó). Verificado con un
token pedido directo a la API, sin pasar por el navegador: antes del
reinicio, `401 PGRST303`; después, `200` con los datos correctos.

**Lo que sí quedó bien y vale la pena conservar** (en `js/session.js` y
`js/router.js`, ya en `main`): un fallo transitorio del servidor ya no cierra
la sesión del usuario ni le dice que su cuenta no existe. Si algo así se
repite, se ve un mensaje honesto con botón de reintentar, no un rebote al
login.

---

## 4 · Credenciales — qué se puede llevar tal cual y qué hay que copiar a mano

**No existe un `.env` en este repo para copiar.** El archivo está en
`.gitignore` (correcto: nunca debe subirse a git) y en este PC tampoco hay
uno guardado en disco — las herramientas que lo usan
(`tools/run_rappi_dev_onboarding.mjs`, etc.) lo leen bajo demanda y el que se
usó en sesiones anteriores no quedó persistido en ningún archivo que yo haya
tocado.

Lo que sigue es la reconstrucción completa de qué necesita el proyecto y de
dónde sacar cada valor. **Ningún secreto real está escrito en este
documento** — los que yo no puedo leer (contraseñas, tokens, llaves privadas)
quedan marcados como `<< copiar de la fuente indicada >>`.

### 4.1 — `entorno/.env` (variables locales, para los scripts de `tools/`)

Plantilla ya escrita en [`entorno/.env`](../entorno/.env) junto a este
documento (mismo commit). Son valores que solo usan los scripts de
diagnóstico corridos a mano, no la app en producción.

### 4.2 — Secretos de las Edge Functions (Supabase)

Estos **no viven en ningún archivo**, ni en este repo ni en ningún `.env`
que haya existido en este PC: son secretos de Supabase (`supabase secrets
set`), guardados cifrados server-side. Ni el MCP de Supabase ni el dashboard
muestran su valor una vez guardados — solo se pueden **sobrescribir**, no
leer. Si el PC nuevo va a desplegar Edge Functions, necesita que alguien con
acceso al panel de Supabase (Project Settings → Edge Functions → Secrets)
los copie, o que Santiago se los pase por un canal seguro (no por chat).

Lista completa de los que el código realmente usa (extraída de
`Deno.env.get(...)` en `supabase/functions/`, así que está garantizado que
no falta ninguno):

```
ALLOWED_ORIGINS
COMPRAS_MAX_FILAS
CORREO_PROVEEDOR
CORREO_RELAY_TOKEN
CORREO_RELAY_URL
CORREO_REMITENTE
CRON_SECRET
ENCRYPTION_KEY
FILTRAR_INVENTARIO_POR_NEGOCIO
GASTOS_DIAS_ADELANTE
GASTOS_DIAS_ATRAS
LOGGRO_API_URL
LOGGRO_DEBUG
LOGGRO_LOGIN_PATH
LOGGRO_MAPEO_METODOS
LOGGRO_TIMEOUT_MS
LOGGRO_TIPO_AJUSTE
LOGGRO_TIPO_COMPRA
LOGGRO_TOKEN_TTL_MIN
LOGGRO_VENTANA_RENOVACION_H
MASTER_ENCRYPTION_KEY        # cifra client_id/secret de Rappi y tokens guardados en BD
NOMINA_BUCKET
NOMINA_MAX_PDF_MB
PAGO_PRUEBA_ACTIVA
RAPPI_CRON_SECRET
RAPPI_FINANCIAL_FEATURE_ENABLED
RAPPI_PARTNERS_REDIRECT_URI
RAPPI_TIMEOUT_MS
RAPPI_WEBHOOK_TOLERANCE_SECONDS
RESEND_API_KEY
ROL_EMPLEADO
SMTP_HOST
SMTP_PASSWORD
SMTP_PORT
SMTP_USUARIO
SUPABASE_ANON_KEY             # Supabase la inyecta sola, no hace falta setearla
SUPABASE_SERVICE_ROLE_KEY     # Supabase la inyecta sola, no hace falta setearla
SUPABASE_URL                  # Supabase la inyecta sola, no hace falta setearla
WOMPI_EVENTS_SECRET
WOMPI_PRIVATE_KEY
WOMPI_PUBLIC_KEY
WOMPI_REDIRECT_URL
WOMPI_TEST_INTEGRITY_SECRET
WOMPI_TEST_PUBLIC_KEY
ZONA_HORARIA_DESFASE
```

**La más crítica es `MASTER_ENCRYPTION_KEY`** (también aceptada como
`ENCRYPTION_KEY` por compatibilidad): si se pierde o se cambia sin
reencriptar, todas las credenciales de Rappi guardadas en
`rappi_connection_secrets` y los tokens en `rappi_tokens` quedan
ilegibles — hay que volver a pegar el `client_id`/`client_secret` de Rappi
desde cero. No la regeneres a menos que sea intencional.

### 4.3 — Credenciales de terceros y dónde viven (no en archivos)

| Qué | Dónde está guardado hoy | Nota |
|---|---|---|
| Rappi (DEV) `client_id` / `client_secret` | Cifrados en Supabase, tabla `rappi_connection_secrets` (vía `MASTER_ENCRYPTION_KEY`) | Se pegaron una vez desde `rappi/integracion.html`; para recuperarlos hay que pedírselos a Rappi de nuevo o tener el secreto de cifrado y leer la tabla |
| Loggro (Pirpos) — credenciales de restobar.loggro.com | Las tiene Santiago; **no se han tecleado nunca desde una sesión de Claude** (regla de seguridad de este proyecto: nunca se piden ni se escriben contraseñas por el asistente) | Rotarlas si se compartieron por chat en algún momento |
| Wompi | Secretos en Edge Function env vars (tabla de 4.2) | — |
| SMTP / Resend | Secretos en Edge Function env vars | — |
| Cuenta de Supabase con acceso al proyecto | Gestión de accesos de la organización en supabase.com | El PC nuevo, con otra cuenta, necesita que Santiago lo invite a la organización **Proyecto Plataforma** |
| Firebase / despliegue | `FIREBASE_SERVICE_ACCOUNT_PLATAFORMA_RESTAURANTES_8F561` en GitHub Actions Secrets | No hace falta tocarlo si el PC nuevo solo hace push a `main`: el pipeline ya está configurado |
| `pg_dump` / conexión directa a Postgres | Contraseña de la base, en Supabase → Project Settings → Database | **Rótala** si en algún momento se pegó en un chat (ver §5) |

### 4.4 — Lo único que SÍ es público y va tal cual en el código

Esto no es secreto, está pensado para vivir en el frontend
(`js/config.js`), y no hace falta reemplazarlo:

```js
SUPABASE_CONFIG.url         = "https://tgkvcvnwwnrlyhbqmhaf.supabase.co"
SUPABASE_CONFIG.anonKey     = (la anon key actual, ya en js/config.js)
SUPABASE_CONFIG.publishableKey = "sb_publishable_pjP9JOVNeQnGseLvshx2Xw_E3jKI85R"
```

---

## 5 · Seguridad — rotar antes de seguir

Durante esta sesión se pegaron en el chat, en texto plano:

- Una contraseña de la base de datos de Supabase (`db.tgkvcvnwwnrlyhbqmhaf...`).
- Una cadena de conexión completa con contraseña a **otro** proyecto Supabase
  (`ivgzwgyjyqfunheaesxx`, el legacy que menciona `ESTADO_PROYECTO.md`).

**Ambas deben rotarse** antes de dar el proyecto por trasladado:
Supabase → Project Settings → Database → *Reset database password*, en cada
uno de los dos proyectos si el legacy sigue vivo.

---

## 6 · Qué funciona / qué no, verificado hoy

**Funciona y está verificado en producción/DEV:**
- Login (tras el reinicio del §3).
- Homologación Rappi DEV: 14/15.
- Menú de Rappi: import, publicación, aislamiento por tenant — probado con
  datos reales de Batut.
- Aceptar/rechazar pedido manual, código de entrega (handoff), switch de
  tienda abierta/cerrada, estado de menú en vivo.
- Despliegue automático a Firebase en cada push a `main`.

**Pendiente, no roto — solo incompleto:**
- Auto-onboarding de Rappi (15/15): esperando `redirect_uri` registrado y
  `client_id` de Partners por parte de Rappi.
- Webhook `STORE_PROVISIONING_STATUS`: devuelve 404, ligado al punto
  anterior.
- Etapa 2 de Rappi→Loggro (botón "Subir a Loggro"): diseñada y documentada
  en la skill `rappi-a-loggro`, no implementada todavía.

**No se tocó nada de:** nómina, facturación, cierre de turno, inventarios,
compras — fuera de alcance de esta sesión, sin cambios.

---

## 7 · Dónde seguir leyendo

- `C:\Users\Zamora\.claude\skills\rappi-integracion\SKILL.md` — método de
  homologación, verdades del sandbox DEV, reglas de seguridad del módulo de
  menú.
- `C:\Users\Zamora\.claude\skills\rappi-a-loggro\SKILL.md` — contrato
  verificado de Loggro y el plan de la etapa 2.
- Memoria persistente (`C:\Users\Zamora\.claude\projects\...\memory\`):
  `enkrato-proyecto-referencias.md`, `rappi-integracion-estado.md`,
  `rappi-loggro-etapa2.md` — esta memoria es local a esta cuenta/PC y **no
  viaja sola** al PC nuevo; si la cuenta nueva es distinta, hay que
  reconstruirla a mano o copiar los archivos.
- `docs/rappi-api/INDEX.md` — mapa de la API de Rappi.

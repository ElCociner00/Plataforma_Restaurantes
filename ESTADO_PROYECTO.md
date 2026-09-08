# Estado del proyecto Enkrato — corte del 2026-08-22

Documento de traspaso. Sirve para retomar el trabajo en una sesión nueva sin
tener que reconstruir el contexto.

---

## 0 · Reglas permanentes del proyecto

Estas reglas las fijó el usuario y siguen vigentes en toda sesión futura:

1. **PROHIBIDO TOCAR LA BASE DE DATOS.** Nada de `DROP`, `ALTER`, `TRUNCATE`,
   `DELETE`, `UPDATE` sobre tablas de Supabase. Las tablas y registros actuales
   permanecen 100 % intactos. Los cambios son de código: HTML, CSS, JS y
   archivos locales.
2. **Cero rompimiento.** No se alteran `id`, `name` ni etiquetas `<script>` de
   los elementos que conectan con JavaScript.
3. **Credenciales fuera del código.** Todo secreto se lee de variables de
   entorno (`Deno.env.get(...)`), nunca escrito en el repositorio.
4. **Eficiencia.** No reanalizar el proyecto entero. Ir directo a los archivos
   involucrados y verificar solo esos y sus dependencias directas.

> Nota: la restricción original de «solo diseño, nada de lógica» quedó ampliada
> por el usuario a partir de la Fase 1: sí se puede modificar lógica JS.

---

## 1 · Qué es el proyecto

- **Producto:** Enkrato, SaaS de operación para restaurantes.
- **Dominio:** `restaurantes.enkrato.com` (GitHub Pages).
- **Stack:** HTML + CSS + JS plano. **No hay** `package.json`, ni build, ni
  Tailwind. Los estilos se resuelven con variables CSS.
- **Backend:** Supabase.
  - URL: `https://ivgzwgyjyqfunheaesxx.supabase.co`
  - Project ref: `ivgzwgyjyqfunheaesxx`
  - Clave publicable (pública, va en el frontend):
    `sb_publishable_6GQt0KEvMHiMuhi6ZPu8dQ_tQOhsF7D`
- **Orden de la cascada CSS:** `variables.css` → `main.css` → hoja de la página
  → `mobile_native.css` (esta última la inyecta `js/mobile_shell.js` en
  tiempo de ejecución, así que carga de última).

---

## 2 · Fases completadas

### Fase 0 — Sistema de diseño
`css/variables.css` con 112 tokens. Patrón de uso en todo el proyecto:
`var(--token, #respaldo)`.

### Fase 1 — Login con Google
OAuth de Google operativo.

### Fase 2 — Registro sin n8n
Migrado de webhook n8n a `supabase-js`, terminando en un RPC
`SECURITY DEFINER` para evitar empresas huérfanas.

**Pendiente:** el script `supabase/sql/008_rpc_registrar_empresa_self_service.sql`
**aún no está confirmado como ejecutado** en Supabase.

### Rediseño de la landing (`index.html` raíz)
- Reescrita completa. Se eliminaron `<canvas id="automaton-canvas">`, el fondo
  de Unsplash y el parallax.
- Estructura nueva: capa `.ambient` de degradado fijo, `.site-header` pegajoso,
  hero a dos columnas con una tarjeta `.hero-panel` de ejemplo de cierre de
  turno, secciones `.band`, `.site-footer` con 7 enlaces legales.
- IDs preservados: `contenido`, `heroTitle`, `por-que-nosotros`, `whyTitle`,
  `benefitsTitle`, `closeTitle`.
- `css/landing.css` reescrito sobre tokens (379 → ~716 líneas). Se le borró su
  `:root` oscuro paralelo.
- `js/landing.js` sigue en disco pero **ya no lo referencia ningún HTML**;
  lleva un comentario `OBSOLETO` al inicio explicando por qué.

### Rediseño del resto de páginas
- `css/main.css` (534 → ~790 líneas) es el archivo de mayor palanca: lo cargan
  las 48 vistas.
- 517 valores hex fijos reemplazados por tokens en 28 hojas de página.
- Total real medido con `difflib`: 31 hojas, +1055 / −773 líneas.

### Corrección 1 — Fondos de tarjetas
El barrido de paleta mapeó todo `#fff` a `--ek-surface`, dejando tarjetas
blancas dentro de contenedores blancos. Se corrigieron **45 reglas de tarjetas
anidadas** dándoles un tinte de fondo.

### Corrección 2 — Cabecera oscura
Tokens de cabecera invertidos en `variables.css`:

```css
--ek-header-bg: #3b2a5e;
--ek-header-ink: #ffffff;
--ek-header-ink-muted: #ddd0f5;
--ek-header-border: #2c1f47;
--ek-header-active: #ffffff;
```

Antes de aplicarlo hubo que **desacoplar `landing.css`**, que consumía
`--ek-header-border`, `--ek-header-ink` y `--ek-header-ink-muted` para su
propia cabecera blanca; se cambiaron a `--ek-line`, `--ek-ink` y `--ek-muted`
(mismos valores resueltos, cero cambio visual).

---

## 3 · Módulo 4 — Edge Function `consultar-ventas` (entregado, sin desplegar)

### Archivos creados

| Archivo | Qué es |
|---|---|
| `supabase/functions/_shared/cors.ts` | Lista blanca de orígenes, `corsHeaders()`, `json()` |
| `supabase/functions/consultar-ventas/index.ts` | La función, ~450 líneas, 6 secciones |
| `supabase/functions/consultar-ventas/README.md` | Comandos, tabla de variables, contrato, errores |
| `supabase/functions/consultar-ventas/deno.json` | Reescrito: solo `functions-js` y `supabase-js` |
| `supabase/config.toml` | `verify_jwt` corregido de `false` a **`true`** |

### Decisiones de seguridad tomadas

- **La empresa NO se acepta del cliente.** Se deduce del JWT
  (`auth.getUser()` → `usuarios_sistema`). Si viniera del navegador, un usuario
  podría pedir las ventas de otra empresa.
- Cliente construido con **clave anónima + token del usuario**, nunca con
  `service_role`: el RLS sigue aplicando.
- `verify_jwt = true`: el gateway rechaza peticiones sin JWT antes de ejecutar
  código. La CLI lo generó en `false`.
- El andamio de la CLI usaba `withSupabase({auth:["publishable","secret"]})`,
  que valida **claves de API, no JWT de usuario**. Se reemplazó por
  `Deno.serve` + `createClient` + `auth.getUser()` explícitos.

### Verificación estática (script `check_fn.py`, todo en verde)

- Sintaxis balanceada: `index.ts` 75/75 llaves, 161/161 paréntesis, 17/17 corchetes.
- **Cero** verbos de escritura (`insert`/`update`/`upsert`/`delete`/`rpc`).
- Exactamente 1 `.select(`, sobre `usuarios_sistema`.
- `service_role` aparece solo en un comentario que dice que NO se usa.
- Ningún JWT, clave anónima ni credencial literal.
- 11/11 variables de entorno documentadas, 9/9 chequeos de seguridad,
  7/7 campos del contrato coincidiendo con `js/cierre_turno.js`.

> Deno **no está instalado** en esta máquina. La verificación fue estática; la
> primera compilación real ocurre al desplegar.

### Contrato de salida

Idéntico al que ya lee `js/cierre_turno.js`, para poder sustituir el webhook de
n8n sin tocar el frontend: `efectivo_sistema`, `datafono_sistema`,
`rappi_sistema`, `nequi_sistema`, `transferencias_sistema`,
`bono_regalo_sistema`, `propina`, más `ok`, `consulta{}` y `message`.
`_crudo` solo aparece con `LOGGRO_DEBUG=true`.

---

## 4 · Lo que sigue — acciones del usuario

### 4.1 Guardar las credenciales de Loggro

```bash
supabase secrets set \
  LOGGRO_API_URL="https://api.loggro.com/v1" \
  LOGGRO_USUARIO="el-correo-de-la-cuenta-loggro" \
  LOGGRO_PASSWORD="la-contrasena-de-loggro" \
  --project-ref ivgzwgyjyqfunheaesxx
```

`SUPABASE_URL` y `SUPABASE_ANON_KEY` **no se configuran**: Supabase las inyecta
sola y el prefijo `SUPABASE_` está reservado.

### 4.2 Desplegar

```bash
supabase functions deploy consultar-ventas --project-ref ivgzwgyjyqfunheaesxx
```

### 4.3 Ejecutar el SQL pendiente de la Fase 2

`supabase/sql/008_rpc_registrar_empresa_self_service.sql`

---

## 5 · Decisiones abiertas

### 5.1 Alcance de las credenciales de Loggro — **bloquea el uso real**

Las variables de entorno son **de plataforma**: una sola cuenta de Loggro para
todo Enkrato. Pero `js/loggro.js` guarda hoy usuario y contraseña **por
empresa** (cada restaurante los mete en `configuracion/loggro.html`).

Si cada cliente tiene su propia cuenta de Loggro, un secreto global no sirve.
El punto de extensión ya está aislado: `obtenerCredenciales(empresaId)` recibe
el `empresaId` aunque hoy no lo use. Solo hay que cambiar esa función para que
lea las credenciales de la base y las descifre.

### 5.2 Contrato real de la API de Loggro

El repositorio no contiene documentación de la API real. Las rutas van por
variable de entorno a propósito y los nombres de campo son listas de
candidatos. Para descubrir los reales:

```bash
supabase secrets set LOGGRO_DEBUG=true --project-ref ivgzwgyjyqfunheaesxx
# leer `_crudo` en la respuesta, ajustar normalizarVentas() en la sección 3
supabase secrets set LOGGRO_DEBUG=false --project-ref ivgzwgyjyqfunheaesxx
```

---

## 6 · Trabajo ofrecido y no iniciado

Esperando la palabra del usuario:

- Devolver más presencia a tarjetas y sombras.
- Patrón alternativo «página gris, tarjetas blancas elevadas» (una línea sobre
  `.main`).
- 9 chips de estado planos donde el borde es igual al fondo.
- Unificar tipografías en las páginas de aplicación (hoy no cargan Google
  Fonts a propósito: pantallas de cocina).
- El dashboard es un esqueleto: `js/dashboard.js` tiene 26 líneas y solo
  dispara un webhook. No hay nada que diseñar todavía.
- 38 archivos con títulos `AXIOMA` que `applyBrandingToDocumentTitle()`
  reescribe en tiempo de ejecución.
- Diferidos de la Fase 2: persistencia del consentimiento legal, posible
  eliminación de las dos políticas `INSERT` de `007`, limpieza de filas
  huérfanas en `empresas` (esto último **requiere autorización explícita**, va
  contra la Directiva Cero).

# 2026-08-23 · Seguridad del despliegue + arreglo del histórico — ejecutado

> **Estado: hecho y verificado en producción.** Este documento recoge el
> diagnóstico, los cambios aplicados y las pruebas que los respaldan.
> Sustituye a `2026-08-23_plan_correccion_historico_cierre_turno_no_abre.md`,
> eliminado para no dejar dos versiones del mismo análisis.

---

## 1. Qué se arregló

### 1.1 · Fuga de datos en el sitio publicado (crítico)

El despliegue anterior publicaba el repositorio entero, porque `firebase.json`
declaraba `"public": "."` con un `ignore` que solo excluía `firebase.json`, los
archivos ocultos y `node_modules`. Quedaban accesibles por URL, sin
autenticación:

| URL | Antes | Ahora |
|---|---|---|
| `/supabase/migrations/20260822000001_data_dump.sql` | **200** — 5,3 MB de volcado PostgreSQL | **404** |
| `/supabase/functions/consultar-ventas/index.ts` | 200 — código de las Edge Functions | **404** |
| `/supabase/config.toml` | 200 | **404** |
| `/n8n_nomina.json`, `/n8n_subir_cierre_nodes.json` | 200 | **404** |
| `/ESTADO_PROYECTO.md`, `/README.md`, `/CNAME` | 200 | **404** |
| `/docs/*.md` | Se habrían publicado en el siguiente deploy | **404** |

El volcado contenía datos de más de 30 tablas: `credenciales_plataforma`,
`integraciones_credenciales`, `integracion_credibanco`,
`loggro_refrescar_token`, `usuarios_sistema`, `empleados`, `facturacion`,
`historico_nomina`, `empresas`, `cierres_turno_final`… y 546 correos de personas
reales.

Decisión tomada: **no se rotan credenciales**, porque el sitio llevaba menos de
10 minutos publicado y el dominio no se había compartido con nadie.

El despliegue pasó de **376 archivos a 165**.

### 1.2 · La página del histórico no abría en local

`http://127.0.0.1:5500/cierre_turno/historico_cierre_turno` → 404.

Ni la carpeta ni el enlace tenían nada que ver:

- El archivo existe y git confirma que se añadió una vez en `eaa8d3f` y nunca se
  borró, movió ni renombró. Nunca fue una carpeta.
- Verificador sobre las 50 páginas HTML: 0 enlaces rotos. Las 47 rutas de
  `APP_URLS`: las 47 resuelven. Ningún código recorta `.html` ni reescribe la URL.
- La causa era el servidor: en el 5500 corría `python -m http.server`, que sirve
  nombres de archivo exactos y no prueba a añadir `.html`. El mensaje "Nothing
  matches the given URI" es literalmente su página de error.

### 1.3 · Caché que retrasaba los cambios hasta una hora

Producción servía **todo** con `Cache-Control: max-age=3600`, incluidos
`index.html`, `main.css` y `config.js`. Como los assets se enlazan sin `?v=`,
tras cada deploy los clientes seguían viendo la versión vieja.

---

## 2. Cambios aplicados

### 2.1 · `firebase.json` — reescrito

```json
{
  "hosting": {
    "public": ".",
    "cleanUrls": true,
    "trailingSlash": false,
    "ignore": [
      "firebase.json", "**/.*", "**/node_modules/**",
      "supabase/**", "docs/**", "tools/**",
      "**/*.md", "n8n_*.json", "CNAME"
    ],
    "headers": [
      { "source": "**", "headers": [
        { "key": "Cache-Control", "value": "no-cache" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "SAMEORIGIN" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
      ]},
      { "source": "**/*.@(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2)",
        "headers": [{ "key": "Cache-Control", "value": "public, max-age=604800" }] }
    ]
  }
}
```

- **`ignore`** cierra la fuga.
- **`Cache-Control: no-cache`** no significa "no guardes", sino "guarda pero
  revalida". El navegador manda `If-None-Match` y Firebase responde `304` si no
  cambió: coste mínimo y los clientes ven cada deploy al instante. Imágenes y
  tipografías sí se cachean una semana.
- **Cabeceras de seguridad**: `nosniff`, `SAMEORIGIN` y `Referrer-Policy`.
- **`cleanUrls`** ya estaba en tu configuración, pero **nunca se había
  desplegado**: antes de hoy, `/cierre_turno/historico_cierre_turno` también
  daba 404 en producción. Ahora está activo de verdad.

### 2.2 · `tools/servidor_local.py` — nuevo

Reemplaza a `python -m http.server`. Extiende el mismo módulo con dos añadidos:

1. Resuelve rutas sin extensión, igual que el `cleanUrls` de Firebase, para que
   local y producción se comporten igual.
2. Manda `Cache-Control: no-store`, así los cambios en CSS y JS se ven al
   recargar sin forzar `Ctrl+F5`.

Además fija la raíz a la carpeta del sitio, se lance desde donde se lance.

```powershell
python .\tools\servidor_local.py 5500
```

Va en el `ignore` de Firebase: es solo para desarrollo.

### 2.3 · Enlaces rotos por activar `cleanUrls` — corregidos

Al activar `cleanUrls`, las páginas `index.html` pasan a servirse **sin** su
carpeta: `configuracion/index.html` se sirve en `/configuracion`. Eso cambia la
base de las rutas relativas y rompía los enlaces hermanos escritos como
`href="gestion_usuarios.html"`, que pasaban a apuntar a `/gestion_usuarios.html`.

Afectaba a 12 enlaces en dos archivos. Corregidos con un prefijo que funciona
**con y sin barra final**, y también bajo un `base path` como el de GitHub Pages:

| Archivo | Antes | Ahora |
|---|---|---|
| `configuracion/index.html` (9 enlaces) | `href="loggro.html"` | `href="../configuracion/loggro.html"` |
| `siigo/configuracion_siigo/index.html` (3 enlaces) | `href="proveedores_siigo.html"` | `href="../../siigo/configuracion_siigo/proveedores_siigo.html"` |

El truco es subir tantos niveles como profundidad tenga la página y volver a
bajar por la ruta completa: al subir por encima de la raíz, el navegador se
queda en la raíz, así que la ruta resuelve igual en los dos casos.

---

## 3. Verificación

Todo lo siguiente se ejecutó contra el sitio ya desplegado y contra el servidor
local nuevo.

| Prueba | Resultado |
|---|---|
| Archivos de la fuga (volcado, `.ts`, `config.toml`, JSON de n8n, `.md`) | **404** en los 10 comprobados |
| `/cierre_turno/historico_cierre_turno` en producción | **200** |
| `/cierre_turno/historico_cierre_turno.html` | **301** → versión limpia |
| Barrido de **las 50 páginas** del sitio en producción | **50 · 200, 0 fallos** |
| **387 referencias relativas** (`href`/`src`) de las 50 páginas, resueltas contra su URL limpia | **0 fallos** |
| Barrido de las 50 páginas en local | **50 · 200, 0 fallos** |
| Cabeceras en producción | `no-cache` + `nosniff` + `SAMEORIGIN` + `Referrer-Policy`; imágenes con `max-age=604800` |
| Página del histórico ejecutada en Chrome headless (local y producción) | Sin excepciones JS, sin peticiones fallidas; termina en el login porque el perfil de prueba no tiene sesión |
| Intentos de *path traversal* contra el servidor local | 404, sin salirse de la raíz |

### Comandos para repetir la verificación

```bash
S=https://plataforma-restaurantes-8f561.web.app
curl -s -o /dev/null -w "%{http_code}\n" -I $S/supabase/migrations/20260822000001_data_dump.sql  # 404
curl -s -o /dev/null -w "%{http_code}\n" -I $S/cierre_turno/historico_cierre_turno               # 200
curl -s -I $S/js/config.js | grep -i cache-control                                                # no-cache
```

---

## 4. Pendiente

Nada de esto bloquea nada; queda a tu criterio.

| # | Asunto | Detalle |
|---|---|---|
| **P1** | **Qué base de datos usa producción** | `js/config.js` apunta a `tgkvcvnwwnrlyhbqmhaf` (copia "Enkrato Google"). La original es `ivgzwgyjyqfunheaesxx`. **No toqué ese archivo**: el sitio ya estaba desplegado con ese mismo valor, así que el deploy no cambió de base a nadie. Si producción debe ir contra la otra, hay que cambiarlo y volver a desplegar |
| **P2** | `libro_descuadres` sin permisos | No está en `access_control.local.js`, `permissions.js` ni `permisos.js`, a diferencia de `auditoria_turnos`. El header ya lo enlaza para admin: es un módulo que no se puede conceder ni revocar |
| **P3** | Import muerto | `buildRequestHeaders` quedó sin uso en [js/historico_cierre_turno.js:33](../js/historico_cierre_turno.js#L33) |
| **P4** | Favicon | No existe ninguno: todas las páginas registran un `404 /favicon.ico` |
| **P5** | Commit | Los cambios están en el árbol de trabajo, sin commitear: `firebase.json`, `tools/servidor_local.py`, `configuracion/index.html`, `siigo/configuracion_siigo/index.html` |
| **P6** | `restaurantes.enkrato.com` | El dominio del `CNAME` no responde. Si Firebase es el sitio definitivo, conviene apuntar ahí el dominio |

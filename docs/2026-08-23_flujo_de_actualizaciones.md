# Flujo de actualizaciones — cómo se sube un cambio a producción

Documento de referencia. Última revisión: 2026-08-23.

## 1. Cómo funcionan los despliegues de Firebase Hosting

**La pregunta de fondo: ¿se vuelve a subir el proyecto entero?**
Sí y no, y la diferencia importa.

- **Cada despliegue publica una instantánea completa del sitio.** No existe el
  "subir solo un archivo". Firebase crea una *versión* nueva con la lista
  completa de archivos y luego cambia el sitio a esa versión.
- **Pero por la red solo viaja lo que cambió.** La CLI calcula el hash de cada
  archivo, le pregunta a Firebase cuáles no tiene y sube únicamente esos. Si
  tocas un CSS, se sube ese CSS aunque la versión publicada siga teniendo los
  165 archivos.

Tres consecuencias prácticas:

1. **El cambio es atómico.** Nadie ve el sitio a medias: se pasa de la versión
   vieja a la nueva de golpe.
2. **Lo que dejas de incluir, desaparece.** Así se cerró la fuga del volcado de
   la base de datos: no hubo que borrar nada a mano, bastó con excluirlo del
   siguiente deploy.
3. **Se puede volver atrás sin tocar código.** Consola de Firebase → Hosting →
   historial de versiones → *Roll back*. Inmediato.

**El despliegue no toca la base de datos.** Solo sube archivos estáticos. Los
cambios en Supabase (tablas, Edge Functions) son otro proceso, con la CLI de
Supabase.

**El despliegue tampoco hace commit.** Git y Firebase son independientes: puedes
desplegar sin commitear y commitear sin desplegar. Conviene hacer las dos cosas,
pero son pasos separados.

## 2. El comando

Desde `Plataforma_Restaurantes-main`:

```powershell
npx --yes firebase-tools deploy --only hosting --project plataforma-restaurantes-8f561
```

Por qué es así:

- `firebase-tools` no está instalado globalmente; se usa vía `npx`.
- No hay `.firebaserc` en el repo, así que `--project` es obligatorio. Si
  quieres poder escribir solo `firebase deploy`, se puede crear ese archivo:
  dímelo y lo hago.

### Antes de desplegar algo arriesgado

Puedes publicar en un canal de vista previa: una URL temporal, separada de
producción, que caduca sola.

```powershell
npx --yes firebase-tools hosting:channel:deploy prueba --project plataforma-restaurantes-8f561
```

Devuelve una URL propia. Producción no se entera.

## 3. Qué se sube y qué no

`firebase.json` excluye estas rutas del despliegue:

```
supabase/**      docs/**      tools/**
**/*.md          n8n_*.json   CNAME
firebase.json    **/.*        **/node_modules/**
```

Es lo que impide volver a publicar el volcado de la base de datos, el código de
las Edge Functions o la documentación interna.

**Cuidado al añadir contenido nuevo:** si creas un archivo que encaje en esos
patrones, no se publicará. En la práctica solo afecta a los `.md`: si algún día
quieres publicar uno como página, hay que sacarlo de la lista.

## 4. Dos trampas de este proyecto

### 4.1 · Enlaces hermanos en un `index.html`

Con `cleanUrls`, `configuracion/index.html` se sirve en `/configuracion`, **sin
barra final**. Eso cambia la base de las rutas relativas a `/`, así que un
enlace escrito como `href="loggro.html"` apunta a `/loggro.html` y da 404.

Solo pasa en los `index.html`. Una página que es un archivo
(`nomina/historico_detalle.html` → `/nomina/historico_detalle`) conserva su
carpeta y sus enlaces hermanos funcionan.

**Cómo escribirlos bien:** sube tantos niveles como profundidad tenga la página
y baja por la ruta completa desde la raíz del sitio.

```html
<!-- en configuracion/index.html -->
<a href="../configuracion/loggro.html">Loggro</a>

<!-- en siigo/configuracion_siigo/index.html -->
<a href="../../siigo/configuracion_siigo/proveedores_siigo.html">Proveedores</a>
```

Al subir por encima de la raíz el navegador se queda en la raíz, así que
resuelve igual con y sin barra final.

### 4.2 · Verificar contra la URL real, no contra el disco

Un revisor de enlaces sobre los archivos no detecta el problema anterior: en
disco el archivo existe. Hay que resolver cada `href` contra la **URL publicada**
de la página y pedirla por HTTP.

## 5. El ciclo de trabajo

```
1. Cambias algo en local
2. Levantas el servidor:  python .\tools\servidor_local.py 5500
3. Lo pruebas en http://127.0.0.1:5500/...
4. Despliegas
5. Verificas en https://plataforma-restaurantes-8f561.web.app/...
6. Commit en git
```

La caché ya no estorba: en local el servidor manda `no-store` y en producción
`no-cache`, así que ni tú ni los clientes veréis una versión vieja.

## 6. Cómo pedírmelo

No hace falta una fórmula exacta, pero cuanto más claro el destino, mejor. Lo
único que de verdad necesito saber es **si el cambio se queda en local o sale a
producción**.

| Lo que quieres | Cómo decirlo |
|---|---|
| Cambiar algo y verlo solo en local | "Haz X. Solo en local, no despliegues." |
| Cambiar algo y publicarlo | "Haz X y súbelo a producción." |
| Publicar algo ya hecho | "Sube la actualización." |
| Probar sin arriesgar producción | "Haz X y súbelo a un canal de vista previa." |
| Deshacer un despliegue | "Haz rollback a la versión anterior." |

Cuando dices **"súbelo a producción"** o **"sube la actualización"**, yo hago
siempre esta secuencia completa, sin que tengas que pedirla:

1. Aplico el cambio.
2. Lo valido en local contra el servidor de desarrollo.
3. Despliego.
4. Verifico en la URL de producción que la página responde y que no rompí nada
   más.
5. Te informo de lo que quedó, y de cualquier cosa que se rompiera por el
   camino.

Lo que **no** haré sin que me lo pidas: desplegar (si no lo dices, el cambio se
queda en local), hacer commit o push a git, y tocar `js/config.js`.

## 7. Datos de producción

| | |
|---|---|
| Proyecto Firebase | `plataforma-restaurantes-8f561` |
| URL | `https://plataforma-restaurantes-8f561.web.app` |
| Base de datos | `tgkvcvnwwnrlyhbqmhaf` — "Enkrato Google" |
| Cuenta que despliega | `santiagoelchameluco@gmail.com` |
| Consola | https://console.firebase.google.com/project/plataforma-restaurantes-8f561/hosting/sites |

El dominio `restaurantes.enkrato.com` del archivo `CNAME` no responde. Si quieres
usarlo con Firebase, hay que darlo de alta como dominio personalizado en la
consola de Hosting y cambiar el DNS.

# 2026-05-30 - Landing pública y login en `/inicio/`

## 1. Objetivo de la petición

Convertir el dominio puro `https://restaurantes.enkrato.com/` en una página pública tipo hero/landing para presentar el MVP de Enkrato, manteniendo intacta la funcionalidad de autenticación al mover la pantalla de inicio de sesión a `https://restaurantes.enkrato.com/inicio/`.

La landing debe comunicar la propuesta de valor de Enkrato para restaurantes, tiendas y distribuidoras, incluir una sección de problema-solución, beneficios operativos y un llamado a registro de primera empresa.

## 2. Archivos implicados y modificaciones realizadas

### `index.html` (modificado completamente)

- **Tipo de modificación:** reemplazo de la vista raíz.
- **Objetivo:** dejar la raíz del dominio como landing pública.
- **Qué hace explícitamente:**
  - Renderiza una hero section para Enkrato en el dominio raíz.
  - Muestra el mensaje principal `Medir, Controlar, Analizar y Mejorar`.
  - Incluye texto comercial orientado a control operativo, módulos útiles y crecimiento.
  - Añade botón principal `Empodérate de tu negocio` apuntando a `./registro/index.html`.
  - Añade botón secundario y enlace superior `Iniciar sesión` apuntando a `./inicio/`.
  - Añade sección `¿Por qué elegir Enkrato?` con enfoque problema-solución.
  - Añade sección de beneficios: ahorro de tiempo, menos errores operativos, decisiones con evidencia y menos estrés para el equipo.
  - Carga `css/landing.css` y `js/landing.js`.

### `inicio/index.html` (creado)

- **Tipo de modificación:** creación de nueva ruta pública de login a partir del antiguo `index.html`.
- **Objetivo:** conservar la pantalla de inicio de sesión y sus dependencias en `/inicio/`.
- **Qué hace explícitamente:**
  - Mantiene el formulario `loginForm`.
  - Mantiene `signInWithPassword` desde `js/auth.js`.
  - Mantiene `sendRecoveryForEmail` desde `js/contrasena.js`.
  - Mantiene `resolvePostLoginRoute` desde `js/post_login_route.js`.
  - Ajusta rutas relativas por estar ahora dentro de la carpeta `inicio/`:
    - CSS: `../css/main.css` y `../css/login.css`.
    - JS: `../js/auth.js`, `../js/contrasena.js`, `../js/post_login_route.js`, `../js/public_chrome.js`, `../js/footer.js`.
    - Registro: `../registro/index.html`.
  - Conserva la redirección post-login dinámica y no fuerza un destino fijo, salvo fallback a `../dashboard/` si falla el resolver.

### `css/landing.css` (creado)

- **Tipo de modificación:** nueva hoja de estilos para landing pública.
- **Objetivo:** aislar el diseño comercial del login y no contaminar los estilos globales de formularios/módulos internos.
- **Qué hace explícitamente:**
  - Define variables visuales para paleta morada/magenta/dorada.
  - Estiliza hero full-screen con imagen de fondo, overlay, layout de texto a la izquierda y CTA.
  - Estiliza header público de landing con logo, enlace a login y efecto glass.
  - Estiliza secciones de problema-solución y beneficios.
  - Agrega responsive para pantallas móviles.
  - Respeta `prefers-reduced-motion` para reducir animaciones en usuarios que lo pidan desde el sistema.

### `js/landing.js` (creado)

- **Tipo de modificación:** nuevo script de interacción visual para landing pública.
- **Objetivo:** portar la idea del canvas de autómata celular de la plantilla sin afectar el login ni módulos autenticados.
- **Qué hace explícitamente:**
  - Inicializa el canvas `automaton-canvas`.
  - Genera una cuadrícula tipo autómata celular.
  - Permite chispas visuales al hacer clic sobre la hero, ignorando clics sobre enlaces para no romper navegación.
  - Reinicia el canvas en resize.
  - Pausa animación cuando la pestaña queda oculta.
  - Aplica parallax suave al contenido principal en mousemove.
  - Respeta `prefers-reduced-motion` para evitar animación permanente si el usuario lo prefiere.

### `js/urls.js` (modificado)

- **Tipo de modificación:** ajuste de ruta centralizada.
- **Objetivo:** mover la URL canónica del login desde `/index.html` hacia `/inicio/` sin romper dependencias globales.
- **Qué hace explícitamente:**
  - Cambia `APP_URLS.login` a `buildAppPath("/inicio/")`.
  - Mantiene `APP_URLS.root` como `/`, ahora usado como landing pública.
  - Mantiene `PUBLIC_PATHS` incluyendo raíz, login, registro de empresa y registro de usuario.

## 3. Notas de emergencia para revertir cambios

> Antes de revertir, guardar una copia de los archivos actuales si la landing ya fue publicada y está funcionando.

### Revertir la raíz para que vuelva a ser login

1. Copiar el contenido de `inicio/index.html` sobre `index.html`.
2. Ajustar rutas relativas en el nuevo `index.html` porque volvería a estar en la raíz:
   - Cambiar `../css/main.css` por `css/main.css`.
   - Cambiar `../css/login.css` por `css/login.css`.
   - Cambiar `../js/auth.js` por `./js/auth.js`.
   - Cambiar `../js/contrasena.js` por `./js/contrasena.js`.
   - Cambiar `../js/post_login_route.js` por `./js/post_login_route.js`.
   - Cambiar `../registro/index.html` por `./registro/index.html`.
   - Cambiar `../js/public_chrome.js` por `js/public_chrome.js`.
   - Cambiar `../js/footer.js` por `js/footer.js`.
3. En `js/urls.js`, cambiar:

```js
login: buildAppPath("/inicio/"),
```

por:

```js
login: buildAppPath("/index.html"),
```

4. Validar que el login cargue en `/` y que cierre de sesión vuelva a `/index.html`.
5. Opcionalmente borrar los archivos creados para landing si ya no se usarán:
   - `css/landing.css`
   - `js/landing.js`
   - carpeta `inicio/`

### Revertir solo el cambio visual de landing y conservar login en `/inicio/`

1. Mantener `inicio/index.html` y `js/urls.js` como están.
2. Reemplazar únicamente `index.html` por una landing anterior o una página simple con enlaces a `/inicio/` y `/registro/index.html`.
3. Si la nueva landing no usa canvas, borrar del HTML estas referencias:
   - `<canvas id="automaton-canvas" aria-hidden="true"></canvas>`
   - `<script type="module" src="js/landing.js"></script>`
4. Si no se usa el CSS nuevo, borrar:
   - `<link rel="stylesheet" href="css/landing.css">`

## 4. Indicaciones para exportar este cambio masivo a otro repositorio

Este repositorio centraliza rutas en `js/urls.js`; por eso, al portar el cambio a otro repositorio debe priorizarse la URL canónica del login antes de copiar vistas.

### Archivos a copiar como bloque funcional

1. `index.html`
2. `inicio/index.html`
3. `css/landing.css`
4. `js/landing.js`
5. Cambio equivalente en el archivo central de rutas del repositorio destino.

### Particularidades y validaciones para el repositorio destino

- Verificar si el repositorio destino también usa un archivo central de URLs como `js/urls.js`.
  - Si existe, agregar o actualizar la ruta de login a `/inicio/`.
  - Si no existe, buscar redirecciones hardcodeadas a `/index.html` y cambiarlas a `/inicio/`.
- Confirmar que el router o middleware de autenticación tenga como rutas públicas:
  - `/`
  - `/inicio/`
  - `/registro/index.html`
  - `/registro/usuario.html`, si aplica.
- Copiar primero `inicio/index.html` y ajustar rutas relativas según la profundidad de carpetas del destino.
- Copiar después `index.html`, `css/landing.css` y `js/landing.js`.
- Verificar que el botón de registro apunte al formulario correcto de primera empresa.
- Verificar que cierre de sesión use la ruta centralizada de login y no una cadena hardcodeada antigua.
- Si el destino no usa GitHub Pages ni base path heredado, conservar rutas absolutas o relativas limpias. Si usa subcarpeta tipo `/Plataforma_Restaurantes`, adaptar la función equivalente a `buildAppPath` antes de probar navegación.

## 5. Checklist funcional / logs

- ✅ Landing en `/`: creada y enlaza a registro de empresa.
- ✅ CTA `Empodérate de tu negocio`: apunta a `./registro/index.html`.
- ✅ Enlace `Iniciar sesión` en landing: apunta a `./inicio/`.
- ✅ Login en `/inicio/`: conserva formulario, recuperación de contraseña y redirección post-login dinámica.
- ✅ URL central de login: actualizada en `js/urls.js` a `/inicio/`.
- ✅ Rutas públicas: raíz y login siguen incluidas en `PUBLIC_PATHS`.
- ✅ Cierre de sesión: seguirá usando `APP_URLS.login`, por lo que redirige a `/inicio/`.
- ⚠️ Captura visual: se intentó generar con Playwright vía `npx`, pero el registry respondió `403 Forbidden`; no se pudo instalar/ejecutar navegador headless en este entorno.

## 6. Validaciones realizadas

- `python3` con `HTMLParser` sobre `index.html` e `inicio/index.html`.
- `node --check js/landing.js`.
- `node --check js/urls.js`.
- `node --check js/auth.js`.
- `node --check js/router.js`.
- Script de comprobación textual para confirmar hero, login movido y URL centralizada.
- Intento de captura con `npx --yes playwright@1.53.0 screenshot ...`, bloqueado por `403 Forbidden` del registry.

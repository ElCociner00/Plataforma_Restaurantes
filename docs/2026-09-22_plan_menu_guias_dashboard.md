# Plan de ejecución — Enkrato: cuenta Rappi de Batut, reforma del módulo de Menú, módulo de Guías y Dashboard de Rappi

> **Para el agente que ejecute esto.** Este documento lo escribió otro agente que
> ya investigó el código, la base de datos y la API real de Rappi. **Todo lo que
> está en la sección «Hechos verificados» ya fue comprobado contra el sistema
> real** — no lo vuelvas a derivar, no lo pongas en duda sin evidencia nueva, y
> no gastes tokens re-explorando lo que aquí ya está resuelto.
>
> Léelo entero antes de tocar un solo archivo.

---

## 0 · Reglas innegociables

Estas reglas las fija el dueño del proyecto (Santiago). No son sugerencias.
Violar cualquiera de ellas es peor que no hacer la tarea.

### 0.1 — La funcionalidad manda sobre la elegancia

Este es un SaaS **en producción con clientes reales operando ahora mismo**
(restaurantes Batut). Si tienes que elegir entre "más limpio" y "sigue
funcionando", eliges **sigue funcionando**, siempre, sin excepción.

**No refactorices nada que no te haya pedido este plan.** Aunque veas código
que te parezca mejorable. Aunque "solo sea un momento". Aunque estés seguro.

### 0.2 — Archivos matrices: no se tocan

Estos archivos son el esqueleto del que cuelga toda la plataforma. Un cambio
aquí rompe módulos que ni siquiera estás mirando:

| Archivo | Por qué no se toca |
|---|---|
| `js/session.js` | Resuelve el contexto multi-tenant de **todos** los módulos |
| `js/router.js` | Protege **todas** las páginas; un error aquí deja a todos fuera |
| `js/supabase.js` | Cliente único de Supabase, adaptador de almacenamiento de sesión |
| `js/auth.js` | Login, logout, recuperación de contraseña |
| `js/header.js` | Cabecera y menú de navegación de toda la app |
| `js/config.js` | URL y llaves del proyecto Supabase |
| `js/urls.js` | Registro central de rutas |
| `supabase/functions/_shared/*` | Tenant, errores, CORS y cliente Rappi compartidos por **todas** las Edge Functions |

**Excepciones permitidas por este plan, y solo estas:**
- `js/urls.js`: **añadir** entradas nuevas al objeto `APP_URLS` (Fase 2 y 3). Solo añadir, nunca modificar ni borrar las existentes.
- `js/header.js`: **añadir** un enlace nuevo al menú (Fase 2). Una línea, dentro del bloque de navegación ya existente.

Si crees que necesitas tocar cualquier otro de esos archivos: **para y
pregúntale a Santiago.** No lo decidas tú.

### 0.3 — La base de datos: aditivo, nunca destructivo

- **Prohibido** `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, y cualquier `DELETE`
  o `UPDATE` masivo que no esté escrito explícitamente en este plan.
- Las migraciones nuevas son **aditivas**: `CREATE TABLE`, `ADD COLUMN` con
  valor por defecto, `CREATE INDEX`, `ADD CONSTRAINT ... NOT VALID`.
- **Nunca reescribas una migración ya aplicada.** Si algo de una migración
  anterior está mal, se corrige con una migración **nueva** encima.
- Toda tabla nueva lleva `empresa_id`, RLS activo y política o revocación
  explícita. Copia el patrón de
  `supabase/migrations/20260921120000_rappi_menu_autogestionado.sql`.

### 0.4 — Cambios de configuración de la plataforma: prohibidos

**No toques nada en el panel de Supabase.** Ni llaves JWT, ni reinicios, ni
pausas, ni configuración de Auth, ni políticas de proyecto. Tu trabajo es
código y migraciones aditivas. Si crees que el problema está en la
infraestructura, **para y reporta**, no actúes.

> **Contexto que evita que repitas un error caro.** El 2026-09-21 el login se
> cayó durante horas. Se persiguieron dos hipótesis equivocadas (desfase de
> reloj entre servicios; migración de llaves JWT) y se estuvo a punto de
> *pausar* el proyecto, que habría empeorado la caída. La causa real fue un
> fallo interno del servicio PostgREST del proyecto, y se resolvió con
> **Restart project** desde el panel — una acción que solo Santiago debe
> ejecutar. **Ningún commit causó aquello**, y tampoco lo habría arreglado
> revertir código. Moraleja para ti: cuando algo falla del lado del servidor,
> reproduce el fallo **fuera del navegador** (con `node` y `fetch` directo)
> antes de culpar al código o de tocar configuración.

### 0.5 — Cómo se trabaja

1. **Una fase a la vez.** Al terminar cada fase **te detienes** y le reportas
   a Santiago qué hiciste y cómo verificarlo. No arranques la siguiente sin
   su visto bueno.
2. **Commits chicos, en español, explicando el porqué** (no el qué). Mira
   `git log` para el estilo. Cada commit que cierre algo útil se pushea.
3. **Despliegue:** el frontend se publica solo con `git push origin main`
   (GitHub Actions → Firebase, 2-4 min). Las Edge Functions se despliegan
   aparte por MCP de Supabase.
4. **Al desplegar una Edge Function, manda el archivo tal como está en disco**,
   junto con **todas** sus dependencias de `_shared/`. Ya pasó una vez que se
   desplegó una versión de memoria con constantes sin declarar y tumbó la
   función. `node --check` solo valida sintaxis, no símbolos.
5. **No inventes datos de prueba en tablas de producción.** Si necesitas
   probar, usa la empresa `Restaurante Prueba`
   (`b76d89f6-43ea-4a2f-a21b-b159f7d7b162`) y limpia lo que crees.

---

## 1 · Contexto: por qué se hace este trabajo

El módulo de Menú de Rappi se construyó en un solo día, a contrarreloj, para
una reunión con Rappi. Funciona técnicamente —publica el menú y Rappi lo
aprueba— pero es **inusable para un cliente real**:

- Los productos se listan como filas de Excel, todos revueltos. En la app de
  Rappi están **agrupados por sección** (Special Shakes, Fitness, Hot Drinks…).
  Si Enkrato los muestra distinto, el cliente no reconoce su propio menú.
- Al crear un producto **no puede elegir en qué sección va**, ni en qué orden,
  ni cuántos toppings se pueden escoger. Esos parámetros existen en Rappi pero
  el formulario no los expone.
- Hay un bloque «Grupos de opciones» suelto abajo que ni Santiago entiende qué
  es ni para qué sirve.
- Hay un botón «Traer mi menú de Rappi» que no debería existir: el menú local
  y el de Rappi **nunca deberían diferir**.

Además faltan dos cosas que el producto necesita:

- **Documentación de uso** para los clientes (y para el propio Santiago, que
  no siempre puede hablar con cada restaurante).
- **Datos de Rappi en el dashboard.** Hoy el dashboard cruza Loggro contra lo
  que el empleado registra a mano. Rappi es una tercera fuente, directa y
  fiable, que todavía no se explota.

**Resultado esperado:** que un dueño de restaurante entre al módulo de Menú,
reconozca su carta tal como la ve en Rappi, cambie un precio o un topping sin
preguntarle nada a nadie, y publique con confianza.

---

## 2 · Hechos verificados (no los vuelvas a investigar)

### 2.1 — Entorno

| Cosa | Valor |
|---|---|
| Repo | `https://github.com/ElCociner00/Plataforma_Restaurantes`, rama `main` |
| Supabase | proyecto `tgkvcvnwwnrlyhbqmhaf` ("Enkrato Google"), plan Free, us-east-2 |
| Hosting | Firebase `plataforma-restaurantes-8f561`, deploy automático en push a `main` |
| Dominio | `restaurantes.enkrato.com` |
| Stack | HTML + CSS + JS plano, módulos ES nativos. **No hay build, ni npm, ni framework.** |
| Gráficas | Chart.js (ya usada en `js/dashboard.js`) |

Lee `docs/2026-09-22_traspaso_a_otro_pc.md` para el estado general del
proyecto. `ESTADO_PROYECTO.md` (raíz) **está obsoleto**, es de otro proyecto
Supabase; ignóralo.

### 2.2 — Multi-tenant: cómo se separan los datos

Esto es central para la Fase 0 y para la Fase 3. Está implementado en
`supabase/functions/_shared/tenant.ts` y **no hay que tocarlo**:

- Cada **local** es una `empresa` propia.
- `grupos_empresariales` relaciona local → matriz (`empresa_id` = local,
  `grupo_id` = matriz).
- `app_empresas_visibles()` y `ctx.empresasVisibles` dan el alcance: una
  matriz ve sus locales; un local se ve a sí mismo, a su matriz y a sus
  hermanos; una empresa suelta solo se ve a sí misma.

En las tablas de Rappi:

| Columna | Significado |
|---|---|
| `rappi_connections.empresa_id` | Empresa **dueña de la cuenta de Rappi** (quien tiene las credenciales) |
| `rappi_stores.empresa_id` | Igual que la de la conexión |
| `rappi_stores.enkrato_empresa_id` | **La empresa/local concreto al que pertenece esa tienda.** Esta es la llave de segregación |
| `rappi_orders.empresa_id` | Lo escribe `rappi-sync` copiando `store.enkrato_empresa_id` |

O sea: **el mecanismo para que Meridiem vea lo suyo y Viva lo suyo ya existe.**
Es `enkrato_empresa_id` por tienda. Lo que falta está en §3.4.

### 2.3 — Empresas Batut en la base

| Empresa | id | Relación |
|---|---|---|
| BATUT LE MERIDIEM | `f37f6983-9d59-40c8-b0c1-5949b45743c6` | **Matriz** (BATUTCO SAS) |
| BATUT VIVA | `5b5f990a-146f-4623-adfc-78459d11a4a3` | **Local** de LE MERIDIEM |
| BATUT Cartagena | `bd1583bc-8009-48a1-ab6d-ca92932453f0` | Empresa suelta, **otro dueño** (Carlos Daniel Falcon Rios) |
| Restaurante Prueba | `b76d89f6-43ea-4a2f-a21b-b159f7d7b162` | Entorno de pruebas de Santiago |

Santiago confirmó: **la cuenta de Rappi de la tienda `900170987` es de BATUT
LE MERIDIEM**, no de Cartagena. Meridiem + Viva son un grupo; Cartagena es
otro negocio aparte.

En Rappi se pueden tener cuentas por tienda/local: hay una para Meridiem y
otra para Viva. **Turbo no es otra tienda**, es un servicio de entrega más
rápida que se paga aparte y ya se distingue por
`rappi_orders.delivery_operation_type` (`turbo` / `regular`).

### 2.4 — Estado actual de la conexión Rappi (antes de la Fase 0)

```
rappi_connections: 1 fila — DEV, CONNECTED
  empresa_id = b76d89f6 (Restaurante Prueba)
rappi_stores: 1 fila — "Batut", rappi_store_id 900170987, active
  empresa_id = b76d89f6 · enkrato_empresa_id = b76d89f6
rappi_orders: 20 pedidos (todos de prueba, 2026-09-11 a 09-16), 6 cancelados, 2 turbo
rappi_menu_*: catálogo importado bajo empresa_id = b76d89f6
```

### 2.5 — El contrato REAL de Rappi para el menú ⭐

**Esto es lo más valioso del documento.** Se obtuvo analizando
`C:\Users\Zamora\Downloads\deepseek_json_20260917_58cd4c.json`, que es el
último menú de Batut que Rappi **aceptó y aprobó** (50 productos, 473
toppings). Es el modelo a replicar, literal.

Estructura raíz: `{ "storeId": "...", "items": [...] }`

**Producto (`type: "PRODUCT"`)** — campos exactos, ni uno más:

```json
{
  "name": "Cheesecake de arandanos",
  "description": "Shake sabor a arándanos… Vaso 22oz.",
  "price": 28900,
  "sku": "TEST-SPECIAL-CHEESECAKE-ARANDANOS",
  "type": "PRODUCT",
  "sortingPosition": 1,
  "category": {
    "id": "TEST-SPECIAL-SHAKES",
    "name": "Special Shakes",
    "sortingPosition": 1
  },
  "children": [ /* toppings */ ]
}
```

**Topping (`type: "TOPPING"`, dentro de `children`)**:

```json
{
  "name": "Leche Klim FIT",
  "description": "Leche Klim FIT",
  "price": 3500,
  "sku": "TEST-SPECIAL-TOPPING-LECHE-KLIM",
  "type": "TOPPING",
  "sortingPosition": 1,
  "maxLimit": 2,
  "category": {
    "id": "TEST-SPECIAL-TOPPINGS",
    "name": "Elige tus toppings",
    "minQty": 1,
    "maxQty": 2,
    "sortingPosition": 1
  }
}
```

**Las siete reglas que se deducen, y que hoy incumplimos:**

1. **`category` del producto = la sección del menú.** Eso es lo que agrupa los
   productos en la app de Rappi. Ese es el parámetro que Santiago no sabía
   cuál era. Lleva **solo** `id`, `name`, `sortingPosition`. **No lleva
   `minQty` ni `maxQty`.**
2. **`category.id` es un texto estable y con significado** (`TEST-SPECIAL-SHAKES`),
   no un número opaco.
3. **`sortingPosition` empieza en 1** y en los productos **reinicia dentro de
   cada categoría**. Verificado: Special Shakes 1..15, Classics 1..7, Fitness
   1..4, Iced Teas 1..5, Healthy Snacks 1..10, Hot Drinks 1..6, Aguas 1,
   Sandwichs & Waffles 1..2.
4. **El producto NO lleva `maxLimit`.** Solo los toppings.
5. **`minQty`/`maxQty` viven en la `category` del topping**, es decir, son
   propiedad **del grupo dentro de ese producto**: cuántas opciones de ese
   grupo debe/puede elegir el cliente. Valores reales vistos: `1/1` y `1/2`.
6. **`maxLimit` del topping** = cuántas unidades de **ese topping concreto**
   puede llevar (valores reales: 1 y 2). Es distinto de `maxQty`.
7. **Cada grupo de opciones tiene un `id` único por producto.** "Elige tus
   toppings" aparece en ~20 productos y cada vez con id distinto:
   `TEST-SPECIAL-TOPPINGS`, `TEST-FRUTOS-TOPPINGS`, `TEST-PB-TOPPINGS`…
   **Verificado: ningún id de grupo se comparte entre productos.**

**Otros hechos del menú real:**
- 20 de los 50 productos **no tienen `children`**. Un producto sin opciones es
  perfectamente válido.
- **Ningún producto trae `imageUrl`.** La imagen es opcional.
- Máximo de toppings en un solo producto: 24.
- 8 categorías con `sortingPosition` 1..8.

### 2.6 — Qué hace hoy nuestro código, y en qué difiere

En `supabase/functions/rappi-menu/index.ts`, función `construirItems`
(línea ~402):

| Línea | Hoy | Debe ser |
|---|---|---|
| 407 | `category.id = String(1000 + i)` — número opaco | Texto estable derivado del nombre de la sección |
| 407 | `sortingPosition: i` (base 0) | Base 1 |
| 423-424 | `minQty: 0, maxQty: 0` en la categoría del producto | **Quitar**: Rappi no los lleva ahí |
| 425 | `sortingPosition` de categoría base 0 | Base 1 |
| 436 | `id: idGrupo.get(...)` — id global `2000+i` | Id único **por producto + grupo** |
| 440 | `sortingPosition: posGrupo` base 0 | Base 1 |
| 443 | `sortingPosition: posOpcion` base 0 | Base 1 |
| 444 | `maxLimit: 1` fijo | Configurable por opción (1..N) |
| 447 | `sortingPosition: indice` global en todo el menú | Base 1 y **reiniciando por categoría** |
| 448 | `maxLimit: 1` en el producto | **Quitar** |
| — | `description: ""` en toppings | Repetir el nombre, como hace Rappi |

### 2.7 — Frontend del menú, tal como está

- `rappi/menu.html` — 3 secciones: «Publicar en Rappi», tabla «Productos»
  (7 columnas planas), tabla «Grupos de opciones». Dos `<dialog>`:
  `#product-dialog` y `#group-dialog`.
- `js/rappi/menu.js` — 309 líneas. `render()` (línea 52) pinta las dos tablas
  planas. El formulario de producto **no** tiene campos de orden, ni de
  min/max, ni de sección más allá de un `<select>` de categoría.
- Edge Function `rappi-menu` v5, acciones: `catalogo`, `guardar_categoria`,
  `borrar_categoria`, `guardar_grupo`, `borrar_grupo`, `guardar_producto`,
  `borrar_producto`, `publicar`, `importar`.
- Tablas: `rappi_menu_categorias`, `rappi_menu_grupos`, `rappi_menu_opciones`,
  `rappi_menu_productos`, `rappi_menu_producto_grupos`, `rappi_menu_versions`,
  `rappi_menu_consecutivos`.

---

## 3 · FASE 0 — Pasar la cuenta de Rappi a BATUT LE MERIDIEM

**Objetivo:** que la tienda `900170987` y todo lo que cuelga de ella dejen de
pertenecer a `Restaurante Prueba` y pasen a `BATUT LE MERIDIEM`
(`f37f6983-9d59-40c8-b0c1-5949b45743c6`).

Santiago pidió explícitamente: **una sola empresa a la vez**, no las dos,
porque tener la misma tienda activa en dos empresas duplicaría los datos que
llegan de Rappi. Después de esta fase, Restaurante Prueba se queda **sin**
conexión Rappi, y así se deja hasta nuevo aviso.

### 3.1 — Ojo: `map_store` no alcanza

Existe la acción `map_store` en `rappi-admin` (línea ~748) que cambia
`enkrato_empresa_id`. **No basta**, porque:

- La **conexión** (`rappi_connections.empresa_id`) seguiría siendo de
  Restaurante Prueba, y `getConnection()` la busca por `ctx.empresaId`. Un
  admin de Batut abriría el módulo y vería "Configura primero las credenciales".
- `map_store` exige `ctx.empresasVisibles.includes(target)`, y el admin de
  Restaurante Prueba **no ve** las empresas Batut (son grupos distintos). Solo
  un superadmin podría.

### 3.2 — Migración, en una sola transacción

Escribe una migración con `apply_migration` (nombre sugerido:
`rappi_cuenta_a_batut_meridiem`). **Antes de ejecutarla, haz un respaldo** —
en plan Free no hay respaldos automáticos; el script está en
`C:\Users\Zamora\Enkrato\respaldos\respaldar_supabase.sh` y **lo corre
Santiago**, no tú (lleva la contraseña de la base).

Mueve, en este orden, de `b76d89f6-…` a `f37f6983-…`:

1. `rappi_connections.empresa_id`
2. `rappi_stores.empresa_id` y `rappi_stores.enkrato_empresa_id`
3. `rappi_orders.empresa_id` (los 20 pedidos de prueba)
4. `rappi_menu_versions.empresa_id`
5. Catálogo del menú: `rappi_menu_categorias`, `rappi_menu_grupos`,
   `rappi_menu_opciones`, `rappi_menu_productos`, `rappi_menu_consecutivos`
   (`rappi_menu_producto_grupos` no tiene `empresa_id`; cuelga de los productos
   y se arrastra sola)
6. Cualquier otra tabla `rappi_*` con `empresa_id` poblado para esa empresa:
   revísalo con una consulta antes, no lo asumas.

**Condiciona cada `UPDATE` a `empresa_id = 'b76d89f6-…'`** para no arrastrar
datos de otras empresas. `rappi_connection_secrets`, `rappi_tokens`,
`rappi_webhook_configs` y `rappi_webhook_secrets` cuelgan de `connection_id`,
así que se mueven solas — **verifícalo, no lo supongas**.

### 3.3 — Verificación de la Fase 0

- Consulta que confirme: 0 filas `rappi_*` con `empresa_id = b76d89f6`, y las
  mismas cantidades bajo `f37f6983`.
- Con la sesión de `gerenciabatut@gmail.com` (admin_root de Batut) el módulo
  de Rappi debe cargar la tienda y el menú.
- Con la sesión de `admin@prueba.com` el módulo debe decir que no hay conexión
  configurada — eso es lo correcto ahora.
- Los webhooks siguen apuntando a la misma URL: no hace falta re-suscribir.

### 3.4 — Preparar el terreno multi-local (sin romper nada)

Santiago quiere que, a futuro, Meridiem vea lo de Meridiem, Viva lo de Viva, y
**la matriz vea ambos**. El mecanismo (`enkrato_empresa_id`) ya existe, pero
las consultas usan `ctx.empresaId` (una sola empresa) en vez del alcance:

```js
.or(`empresa_id.eq.${ctx.empresaId},enkrato_empresa_id.eq.${ctx.empresaId}`)
```

Aparece en `rappi-menu/index.ts:127`, `rappi-operaciones/index.ts:418`,
`rappi-data/index.ts:78,376`.

**En esta fase NO lo cambies.** Hoy hay una sola tienda y cambiarlo ahora es
riesgo sin beneficio. Déjalo anotado: cuando Viva tenga su propia tienda
Rappi, hay que pasar de `ctx.empresaId` a `ctx.empresasVisibles` **solo en
lectura** (listados y dashboard), nunca en escritura, y filtrar por tienda en
la interfaz. Repórtaselo a Santiago al cerrar la fase.

### ⛔ Detente aquí y reporta.

---

## 4 · FASE 1 — Reforma del módulo de Menú

El grueso del trabajo. Santiago lo resumió así: *«casi todo lo que digo es más
visual que técnico, no es tocar tanto código sino cómo se ve y se entiende»*.
Respeta eso: **la mayor parte del cambio es presentación y formulario.** El
backend cambia poco, y lo que cambia es para ajustarse al contrato real de §2.5.

### 4.1 — Modelo mental que debe transmitir la interfaz

Hoy la pantalla obliga al cliente a entender tres conceptos sueltos
(productos, categorías, grupos de opciones) sin decirle cómo se relacionan.
El modelo correcto, en palabras de restaurante:

> Mi carta está dividida en **secciones** (Shakes Especiales, Snacks…).
> Dentro de cada sección hay **productos**.
> Un producto puede tener **preguntas que se le hacen al cliente** al pedirlo
> («Elige tus toppings», «Base», «Extra de proteína»), y cada pregunta tiene
> **respuestas posibles** con su precio.

Usa ese vocabulario en la interfaz. **No escribas «grupo de opciones» ni
«topping» ni «SKU» en ningún texto visible.** Propuesta de nombres:
- sección → **«Sección del menú»**
- grupo de opciones → **«Pregunta al cliente»** o **«Opciones del producto»**
- opción/topping → **«Respuesta»** u **«Opción»**
- `minQty`/`maxQty` → «¿Cuántas puede elegir? De ___ a ___»
- `maxLimit` → «¿Puede repetir la misma opción? Hasta ___ veces»

### 4.2 — Pantalla de Productos: agrupada, no tabla plana

Reemplaza la tabla de `#products-body` por **secciones acordeón**, en el mismo
orden en que Rappi las muestra:

```
▼ Special Shakes                                    15 productos   [↑ ↓]
    [foto] Cheesecake de arandanos      $28.900   3 preguntas  ●activo  [editar]
    [foto] Cheesecake de pistacho       $28.900   2 preguntas  ●activo  [editar]
    …
    + Añadir producto a esta sección
▶ Classics Shakes                                    7 productos   [↑ ↓]
▶ Fitness                                            4 productos   [↑ ↓]
```

Requisitos:
- Cada sección se pliega/despliega. Abiertas por defecto si hay ≤ 3 secciones.
- Orden de secciones y de productos dentro de cada sección **editable**, con
  botones ↑ ↓ (no arrastrar: es más fácil de hacer bien y funciona en móvil).
  Ese orden es el que va a `sortingPosition`.
- Botón «Añadir producto» **dentro de cada sección**, para que la sección
  quede preseleccionada.
- Que se vea la foto, el precio, cuántas preguntas tiene y si está a la venta.
- Responsive: en móvil, tarjetas en vez de filas.
- **Elimina la tabla suelta «Grupos de opciones».** Las preguntas se editan
  dentro del producto (§4.4).

### 4.3 — Secciones del menú: gestión propia

Hace falta poder crear, renombrar, reordenar y borrar secciones. Ponlo en una
barra discreta encima del listado o en un diálogo «Organizar secciones».
Reglas:
- No se puede borrar una sección con productos dentro (avísalo y ofrece mover
  los productos a otra).
- Al crear una sección, su `sortingPosition` va al final.

### 4.4 — Formulario de producto: completo

El diálogo `#product-dialog` debe pasar a tener:

**Datos del producto**
- Nombre *(ya existe)*
- Descripción *(ya existe)* — recuérdale que es lo que lee el cliente en Rappi
- Precio *(ya existe)*
- **Sección del menú** — `<select>` de secciones + opción «crear nueva»
- Foto *(ya existe)* — dejar claro que es opcional (Rappi acepta productos sin
  foto; 50 de 50 del menú real de Batut van sin imagen)
- Se vende sí/no *(ya existe)*

**Preguntas al cliente** — bloque nuevo, lo más importante que falta

Dentro del propio formulario del producto, una lista de preguntas. Cada una:

- Nombre de la pregunta (ej. «Elige tus toppings»)
- **«¿Cuántas puede elegir?» → mínimo [1] máximo [2]** ← `minQty`/`maxQty`,
  lo que Santiago pidió explícitamente
- Orden de la pregunta dentro del producto (↑ ↓)
- Lista de opciones, cada una con: nombre, precio adicional, activa sí/no,
  orden, y **«hasta ___ veces»** (`maxLimit`, por defecto 1)
- Botón «Usar una pregunta que ya tengo» → copia una pregunta de otro producto
  como punto de partida. **Copia, no referencia**: así el cliente la puede
  ajustar sin afectar a los demás productos, que es exactamente como funciona
  Rappi (§2.5, regla 7).

**Validaciones, con mensajes en lenguaje de restaurante:**
- Precio > 0 («Rappi rechaza los productos en $0»)
- Máximo 50 opciones por producto *(ya existe)*
- `minQty` ≤ `maxQty` ≤ número de opciones activas de esa pregunta
- Una pregunta sin opciones no se envía a Rappi (avísalo, no falles en silencio)

### 4.5 — Sincronización con Rappi: el menú local nunca difiere

Santiago fue explícito: *«el menú local siempre debería ser el de Rappi y
nunca deberían ser diferentes»*. Implementa esto:

**a) Al entrar al módulo, traer el menú de Rappi automáticamente.**
Se elimina el botón «Traer mi menú de Rappi». La llamada se hace sola al
cargar la página.

**b) Si hay cambios locales sin publicar, no los pises.**
Necesitas saber si el catálogo local tiene cambios pendientes. Añade
(migración aditiva) una tabla o columna de estado por empresa+tienda, p. ej.
`rappi_menu_estado(empresa_id, store_id, hash_publicado, hash_local,
actualizado_en)`. Al guardar cualquier cosa se recalcula `hash_local`; al
publicar con éxito, `hash_publicado = hash_local`. Reutiliza `sha256Hex()`
que ya está en `rappi-menu/index.ts`.

- Si `hash_local == hash_publicado` → el traído de Rappi reemplaza el local
  sin preguntar (están sincronizados, no se pierde nada).
- Si difieren → **no reemplaces**. Muestra un aviso claro arriba:
  «Tienes cambios sin publicar. Publícalos para que Rappi los muestre, o
  descártalos y vuelve a traer el menú de Rappi.» con los dos botones.

**c) Aviso al salir con cambios sin publicar.**
`beforeunload` + interceptar la navegación interna: «Tienes cambios sin
publicar en tu menú. Si sales ahora, Rappi seguirá mostrando el menú
anterior.» → [Publicar ahora] [Salir sin publicar] [Cancelar].

**d) El indicador de estado siempre visible.**
Una franja fija arriba: «Sincronizado con Rappi» (verde) / «Cambios sin
publicar» (ámbar) / «En revisión por Rappi» (azul). Reutiliza `statusBadge()`
de `js/rappi/core.js`.

> **Cuidado, esto importa:** publicar **reemplaza el menú completo** en Rappi.
> Por eso la publicación **siempre** manda todos los productos activos, nunca
> un delta. Eso ya está bien resuelto en `publicar()`; no lo cambies. Lo que
> hay que garantizar es que el catálogo local esté completo antes de publicar
> — de ahí que el traído automático y el control de cambios sean críticos.

### 4.6 — Backend: ajustar `construirItems` al contrato real

En `supabase/functions/rappi-menu/index.ts`, aplica exactamente la tabla de
§2.6. Los puntos que más cuidado piden:

- **`sortingPosition` base 1 y reiniciando por categoría** en productos.
- **Id de categoría estable**: deriva un slug del nombre
  (`Special Shakes` → `SEC-SPECIAL-SHAKES`), en mayúsculas, sin acentos, con
  guiones. Debe ser **estable entre publicaciones** — si cambia, Rappi trata
  la sección como nueva. Guárdalo en una columna nueva
  `rappi_menu_categorias.rappi_category_id` (migración aditiva) y genéralo una
  sola vez al crear la sección.
- **Id de grupo único por producto**: `${producto.sku}-${slug(grupo.nombre)}`.
- **Quita** `minQty`/`maxQty` de la categoría del producto y `maxLimit` del
  producto.
- **`description` del topping** = su propio nombre.
- `maxLimit` del topping sale de la nueva columna
  `rappi_menu_opciones.max_limit` (migración aditiva, `default 1`).
- `min_qty`/`max_qty` pasan a ser **por producto+grupo**, no globales del
  grupo. La forma menos invasiva: columnas `min_qty`/`max_qty` en
  `rappi_menu_producto_grupos` (aditivas, con default copiado del grupo), y
  que `construirItems` lea de ahí con *fallback* al valor del grupo.
  **No borres las columnas del grupo**: quedan como valor por defecto al
  copiar una pregunta.

### 4.7 — El importador debe leer lo que el contrato dice

`importar()` (línea ~494) hoy pierde información. Ajústalo para que traiga
también: `sortingPosition` de producto y de categoría, `minQty`/`maxQty` por
producto+grupo, y `maxLimit` por opción. El deduplicado por firma de contenido
que ya existe **está bien y resuelve un bug real** (antes fusionaba grupos
distintos con el mismo nombre y borraba toppings): no lo quites.

### 4.8 — Verificación de la Fase 1

Obligatorio, en este orden:

1. `node --experimental-transform-types --check` sobre el archivo de la función.
2. `node tools/test_rappi_frontend.mjs` y `node tools/test_rappi_backend.mjs`
   — deben seguir pasando (34/34 en el backend).
3. **Prueba de fidelidad contra el JSON real.** Escribe un script temporal que
   cargue `deepseek_json_20260917_58cd4c.json`, lo importe al catálogo de una
   empresa de pruebas, reconstruya el payload con `construirItems` y **compare
   campo por campo** con el JSON original. Deben coincidir: número de
   productos, de toppings, `sortingPosition` de cada uno, `minQty`/`maxQty`,
   `maxLimit`, y la agrupación por categoría. Esta prueba es la que demuestra
   que replicamos a Rappi. Bórrala del repo al terminar o déjala en `tools/`
   si quedó limpia.
4. Publicar a DEV y confirmar que Rappi responde 2xx y que
   `menu_status` termina en aprobado.
5. Revisar la pantalla a 375 px de ancho (móvil) — no debe haber scroll
   horizontal.

### ⛔ Detente aquí y reporta.

---

## 5 · FASE 2 — Módulo de Guías

**Objetivo:** que el cliente aprenda a usar cada módulo sin llamar a Santiago.

### 5.1 — Alcance

Página nueva `guias/index.html` + `js/guias.js` + entrada en `APP_URLS`
(`guias: buildAppPath("/guias/")`) y un enlace en el menú de `js/header.js`.

**Contenido en archivos Markdown estáticos** dentro de `guias/contenido/`,
cargados con `fetch` y renderizados con un conversor mínimo propio (títulos,
negrita, listas, imágenes, bloques de aviso). **No metas una librería de
Markdown**: el proyecto no tiene build ni dependencias y no vamos a empezar
ahora por una guía.

Guías mínimas, una por módulo:
- Cierre de turno · Inventarios · Compras · Nómina · Facturación
- Rappi: operación (pedidos), menú, integración
- Configuración y usuarios

Cada guía: para qué sirve, cuándo se usa, paso a paso con capturas, y errores
comunes. **Escríbelas en el tono del producto: para un dueño de restaurante,
no para un programador.** Si no tienes capturas, deja el hueco marcado con un
comentario claro; no inventes imágenes.

### 5.2 — Detalle que hace la diferencia

En cada módulo, un enlace «¿Cómo funciona esto?» que abra la guía de **ese**
módulo. Empieza por el módulo de Menú de Rappi, que es el que más lo necesita.

### ⛔ Detente aquí y reporta.

---

## 6 · FASE 3 — Datos de Rappi en el Dashboard

**Objetivo:** hoy el dashboard cruza Loggro contra lo que el empleado registra
a mano. Rappi es una fuente directa que no se está usando.

### 6.1 — Qué hay disponible

`rappi_orders` tiene 40 columnas, todas ya pobladas por `rappi-sync` y
`rappi-webhook`. Métricas que salen sin inventar nada:

| Métrica | Columnas |
|---|---|
| Ventas por día/semana | `total_order`, `total_to_pay`, `provider_created_at` |
| Pedidos por hora del día | `provider_created_at` |
| Turbo vs regular | `delivery_operation_type` |
| Tasa de cancelación y motivos | `cancelled_at`, `cancel_event`, `rappi_status` |
| Tiempo hasta aceptar | `provider_created_at` → `accepted_at` |
| Tiempo hasta entregar | `accepted_at` → `delivered_at` |
| Productos más vendidos | `items` (jsonb) |
| Propinas | `tip_amount` |
| Descuentos asumidos | `total_discounts` |
| Fallos de aceptación automática | `acceptance_status`, `acceptance_attempts`, `acceptance_error` |
| Tienda caída | `rappi_store_connectivity_events` |

### 6.2 — Cómo integrarlo

- **Una pestaña nueva «Rappi»** en `dashboard/index.html`, siguiendo el patrón
  de las cuatro que ya existen (`setupTabs()`, `reloadActiveTab()`,
  `loadTab*()` en `js/dashboard.js`). Chart.js ya está cargado.
- Los datos se leen con **una acción nueva en la Edge Function `rappi-data`**,
  no con consultas sueltas desde el navegador. Sigue el patrón de las acciones
  que ya tiene.
- Respeta los filtros de rango de fecha y sede que ya existen
  (`getRangoSeleccionado()`, `getSedeSeleccionada()`).
- **Segregación por local:** filtra por `rappi_orders.empresa_id`. Si la
  empresa es matriz, permite ver el consolidado y desglosar por local — ahí sí
  usa `ctx.empresasVisibles`, **solo para lectura** (ver §3.4).

### 6.3 — Advertencia honesta

Hoy hay **20 pedidos, todos de prueba, del 11 al 16 de septiembre**, y 6 están
cancelados. Las gráficas se van a ver vacías o absurdas hasta que Rappi esté en
producción. **Eso no es un bug.** Maneja el caso vacío con un mensaje digno
(«Todavía no hay pedidos de Rappi en este periodo») en vez de gráficas rotas, y
no ajustes la lógica para que "se vea bonito" con datos de prueba.

### ⛔ Detente aquí y reporta.

---

## 7 · Verificación general (al cerrar cualquier fase)

```bash
node tools/test_rappi_frontend.mjs     # frontend Rappi
node tools/test_rappi_backend.mjs      # 34/34 pruebas Rappi
node --experimental-transform-types --check supabase/functions/<fn>/index.ts
git status                             # nada sin commitear
```

Además, **prueba el login** después de cada despliegue. Es el punto único de
fallo de toda la plataforma y lo que más caro cuesta romper. Con una sesión
real: entrar, ver el dashboard, entrar al módulo tocado, salir.

---

## 8 · Lo que NO debes hacer

- ❌ Refactorizar `session.js`, `router.js`, `supabase.js`, `auth.js` ni
  `_shared/*`. Ni "de paso", ni "un momentito".
- ❌ Reescribir migraciones ya aplicadas.
- ❌ Tocar configuración del proyecto Supabase (llaves, reinicios, Auth).
- ❌ Borrar o vaciar tablas.
- ❌ Meter dependencias, npm, bundler o framework. El proyecto es HTML/CSS/JS
  plano **a propósito**.
- ❌ Cambiar `id`, `name` o etiquetas `<script>` que ya conectan con JS.
- ❌ Publicar un menú a Rappi sin haber comparado antes contra lo que Rappi
  tiene. Ya pasó una vez que un importador defectuoso iba a borrar 174
  toppings de un cliente real; se frenó justo a tiempo comparando.
- ❌ Seguir a la siguiente fase sin que Santiago revise la anterior.
- ❌ Asumir que una hipótesis es correcta porque encaja. **Mídela.** Si no
  puedes medirla, dilo en vez de afirmarla.

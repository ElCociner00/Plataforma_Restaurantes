# 2026-04-20 — Reparación flujo superadmin global (usuarios + empresas)

## 1) Objetivo de esta petición
Restaurar la experiencia de **superadmin sin tenant fijo** para que:
- al iniciar sesión no aterrice en dashboard estándar sino en gestión superadmin,
- no falle la validación de empresa en módulos de gestión que deben operar globalmente,
- gestión de empresas permita listar y administrar todas las empresas (estado, banner impago, plan y override) sin exigir `empresa_id` local de sesión.

---

## 2) Archivos implicados y tipo de modificación

### `js/access_control.local.js` (modificado)
- **Tipo:** ajuste de reglas de ruta por rol/entorno.
- **Cambio:** prioridad de módulos Loggro para `admin_root` movida a `gestion_usuarios`/`gestion_empresas`; home por rol de superadmin actualizado.
- **Objetivo explícito:** que el “home funcional” del superadmin sea administración global, no dashboard operativo.

### `js/auth.js` (modificado)
- **Tipo:** refactor de redirección post-login.
- **Cambio:** redirección después de login ahora resuelve contexto/permisos y usa la primera ruta permitida (en vez de `dashboard` fijo).
- **Objetivo explícito:** evitar que superadmin entre “aparentando dashboard normal”.

### `js/router.js` (modificado)
- **Tipo:** ajuste de guard global en evento `SIGNED_IN`.
- **Cambio:** redirección desde login ahora usa la misma resolución dinámica por permisos/rol.
- **Objetivo explícito:** mantener consistencia incluso si el evento de auth se dispara antes/después del submit del formulario.

### `index.html` (modificado)
- **Tipo:** corrección de flujo frontend de login.
- **Cambio:** se eliminó redirección duplicada a dashboard en el submit (ya la resuelve `signInWithPassword`).
- **Objetivo explícito:** evitar sobrescribir la ruta dinámica del superadmin.

### `js/gestion_usuarios.js` (modificado)
- **Tipo:** ampliación funcional multitenant para superadmin.
- **Cambio:**
  - modo superadmin sin `empresa_id` fijo,
  - carga global de usuarios (todas las empresas) con filtro opcional por empresa,
  - columna empresa visible solo para superadmin,
  - actualización de estado de usuarios manteniendo compatibilidad con empresa cuando aplica.
- **Objetivo explícito:** eliminar fricción de “No se pudo validar la empresa actual” para superadmin global.

### `gestion_empresas/index.html` (modificado)
- **Tipo:** saneamiento estructural del HTML.
- **Cambio:** se removieron bloques duplicados/IDs repetidos y marcador `$insert` inválido; quedó una sola sección de override.
- **Objetivo explícito:** estabilizar el módulo de gestión de empresas (DOM consistente + controles únicos).

### `js/gestion_empresas.js` (modificado)
- **Tipo:** limpieza técnica + mensaje de diagnóstico.
- **Cambio:**
  - se eliminó bloque obsoleto al final del archivo (funciones duplicadas no usadas),
  - mejora de mensaje cuando falla la carga por políticas RLS.
- **Objetivo explícito:** reducir ruido técnico y dejar traza clara cuando el problema es de políticas Supabase, no de UI.

---

## 3) Notas de emergencia para revertir cambios

> Aplicar revert parcial por archivo si se detecta regresión.

1. **Volver al inicio clásico por dashboard**
   - Archivo: `js/access_control.local.js`
   - Revertir:
     - `LOGGRO_PRIORITY` (quitar `gestion_usuarios`, `gestion_empresas` al inicio),
     - `getHomeByRole` para `admin_root` -> `APP_URLS.dashboard`,
     - `resolveDefaultRouteForRoleEnv` para `admin_root` -> `dashboard/dashboard_siigo`.

2. **Volver a redirección fija tras login**
   - Archivo: `js/auth.js`
   - Revertir función `resolvePostLoginRoute` y dejar `window.location.href = DASHBOARD_URL`.

3. **Volver a router simple al hacer SIGNED_IN**
   - Archivo: `js/router.js`
   - Reemplazar rama `SIGNED_IN` por `window.location.href = DASHBOARD_URL`.

4. **Volver a gestión usuarios por tenant único**
   - Archivo: `js/gestion_usuarios.js`
   - Revertir soporte superadmin global/filtro empresa,
   - Restaurar validación estricta: si no hay `context.empresa_id` => error y stop.

5. **Volver al HTML anterior de gestión empresas**
   - Archivo: `gestion_empresas/index.html`
   - Restaurar backup previo si se necesitaba la estructura anterior (no recomendado: tenía duplicados de IDs).

6. **Restaurar bloque legado removido en `gestion_empresas.js`**
   - Revertir commit o reinsertar funciones `renderOverrideOptions/applyOverride` previas (solo si algún script externo dependía de ellas).

---

## 4) Nombre del archivo de documentación
Se usó el formato solicitado: `AAAA-MM-DD_titulo`
- `docs/2026-04-20_superadmin_flujo_global_usuarios_empresas.md`

---

## 5) Guía para exportar este cambio masivo a otro repositorio

1. **Centralizar URLs primero**
   - Este repo consume rutas desde `js/urls.js` (`APP_URLS`).
   - Antes de portar, confirma que el repo destino tenga un archivo central equivalente y conecta ahí todas las rutas de login/home/módulos.

2. **Orden recomendado de portabilidad**
   1) `js/access_control.local.js` (prioridades/homes por rol)
   2) `js/auth.js` + `js/router.js` (redirección dinámica post-login)
   3) `index.html` login (evitar redirect hardcode)
   4) `js/gestion_usuarios.js` (modo global superadmin)
   5) `gestion_empresas/index.html` + `js/gestion_empresas.js`

3. **Validaciones indispensables en destino**
   - Verifica que exista rol superadmin equivalente (`admin_root` o mapping).
   - Verifica vistas/tablas: `usuarios_sistema`, `otros_usuarios`, `empleados`, `empresas`, `billing_cycles`.
   - Revisar si RLS permite al superadmin (o `service_role`) leer `empresas` y cambiar `activo/activa/mostrar_anuncio_impago`.
   - Validar que no haya doble redirección en login.

4. **Posibles interferencias**
   - Si el destino ya tiene guardas globales de auth, unificar en un solo punto; evitar lógica duplicada entre formulario y listener `SIGNED_IN`.
   - Si existe otro módulo “selector de tenant”, asegurar que superadmin pueda operar sin tenant fijo o con selector explícito.

---

## 6) Check de funcionamiento (log de estado)

- ✅ Login superadmin: redirige a módulo de gestión global (no dashboard estándar).
- ✅ Gestión de usuarios: funciona en modo global para superadmin (con filtro por empresa opcional).
- ✅ Gestión de empresas: HTML estabilizado y lista de empresas operativa desde frontend.
- ⚠️ RLS Supabase: si hay políticas restrictivas en `empresas`/`billing_cycles`, la UI reporta diagnóstico; se requiere ajuste SQL para completar operaciones en todos los entornos.

---

## 7) Parches posteriores
Este archivo representa el **cambio base grande** de superadmin global.
Si hay parches posteriores, renombrar siguiendo la regla solicitada (ej: `... y 1 parche`, `... y 2 parches`) y agregar sección cronológica al final con diferencias puntuales.


---

## Parche 1 — 2026-04-20 (módulo principal superadmin: gestión de empresas resumida)

### Objetivo del parche
Dejar **Gestión de empresas** como módulo principal del superadmin con vista resumida, clara y enfocada en operación diaria:
- encender/apagar negocio,
- mostrar/ocultar banner impago,
- cambiar plan,
- monitorear deuda y fechas clave.

### Archivos tocados en este parche
- `gestion_empresas/index.html`  
  **Tipo:** simplificación de interfaz.  
  **Qué hace:** elimina panel de override y deja tabla corta enfocada en acciones principales.

- `js/gestion_empresas.js`  
  **Tipo:** ajuste funcional UI.  
  **Qué hace:** render compacto por empresa, mantiene switches de estado/banner y cambio de plan, remueve lógica de override del flujo principal.

- `css/gestion_empresas.css`  
  **Tipo:** ajuste visual.  
  **Qué hace:** estilos orientados a lectura rápida de tabla resumida.

- `js/access_control.local.js`  
  **Tipo:** navegación por rol.  
  **Qué hace:** `admin_root` aterriza primero en `gestion_empresas`.

### Emergencia / reversión de este parche
1. Restaurar prioridad anterior (`gestion_usuarios` primero) en `js/access_control.local.js`.
2. Reponer panel de override en `gestion_empresas/index.html` si se requiere esa operación avanzada en la misma pantalla.
3. Reinsertar función `applyManualOverride` y elementos asociados en `js/gestion_empresas.js` si el equipo necesita volver a controlar overrides desde esta vista.
4. Restaurar estilos previos en `css/gestion_empresas.css` si se requiere tabla extendida.

### Exportación a otro repositorio (específico de este parche)
- Replicar primero rutas centrales en `js/urls.js`.
- Verificar que el módulo destino tenga switches con acciones equivalentes para `activo/activa` y `mostrar_anuncio_impago`.
- Confirmar conexión con `billing_cycles` para sincronía de estado del banner/suspensión.
- Si el destino usa otra capa para overrides, mantener esa funcionalidad fuera de la vista principal para conservar simplicidad.

### Check (logs de estado de este parche)
- ✅ Módulo principal superadmin: ahora es gestión de empresas.
- ✅ Tabla de empresas: resumida y fácil de leer.
- ✅ Switch estado negocio: funciona.
- ✅ Switch banner impago: funciona.
- ✅ Cambio de plan: funciona.
- ⚠️ Override manual avanzado: se removió de esta vista principal (si se requiere, mover a pantalla secundaria).


---

## Parche 2 — 2026-04-20 (facturación: links Mercado Pago desde `metodos_pago`)

### Objetivo del parche
Desacoplar los links de pago de facturación del código hardcodeado para administrarlos desde base de datos sin caídas del sistema.

### Ubicación de configuración de facturación (identificación)
- Front principal: `js/facturacion.js` (render de factura y botones de pago).
- Config/fallback de links: `js/billing_config.js`.
- Vista: `facturacion/index.html`.
- Estilos: `css/facturacion.css`.

### Archivos tocados
- `js/facturacion.js`  
  **Tipo:** integración datos + UI.  
  **Qué hace:** lee métodos globales desde `public.metodos_pago` (`empresa_id is null`) usando `codigo` y `data_qr_o_url`, con fallback seguro si falla la consulta.

- `js/billing_config.js`  
  **Tipo:** configuración.  
  **Qué hace:** define códigos esperados (`mercado_pago_puntual`, `mercado_pago_suscripcion`) y URLs fallback.

- `css/facturacion.css`  
  **Tipo:** estilos UI.  
  **Qué hace:** agrega layout para dos botones (pago puntual + suscripción) y nota de recomendación para suscribirse.

- `supabase/sql/006_metodos_pago_links_mercadopago.sql`  
  **Tipo:** semilla SQL idempotente (upsert).  
  **Qué hace:** crea/actualiza dos rows globales de Mercado Pago en `metodos_pago`.

### SQL aplicado/portable
Ver archivo `supabase/sql/006_metodos_pago_links_mercadopago.sql`.

### Emergencia / reversión de este parche
1. En `js/facturacion.js`, reemplazar lectura de `metodos_pago` por URL fija si fuera necesario.
2. En `js/billing_config.js`, volver a exportar solo un link de pago fijo.
3. En `css/facturacion.css`, quitar bloques `.factura-payment-actions`, `.btn-pago-alt`, `.factura-payment-note`.
4. En BD, desactivar (`activo=false`) las filas `mercado_pago_puntual` y `mercado_pago_suscripcion` si se requiere rollback sin borrar histórico.

### Exportación a otro repositorio
- Copiar el SQL y ejecutarlo en Supabase antes de desplegar front.
- Verificar existencia de tabla `metodos_pago` con columnas `codigo`, `data_qr_o_url`, `activo`, `orden`, `empresa_id`.
- Mantener códigos idénticos en front y BD (`mercado_pago_puntual`, `mercado_pago_suscripcion`) para evitar desalineación.
- Si el repositorio destino ya usa una tabla de configuración central, mapear esos códigos allí y conservar fallback en front.

### Check (logs de estado)
- ✅ Facturación carga botón de pago puntual desde `metodos_pago`.
- ✅ Facturación carga botón de suscripción desde `metodos_pago`.
- ✅ Si falla consulta a `metodos_pago`, usa fallback y la pantalla no cae.
- ✅ Se muestra texto recomendando suscripción automática.


---

## Parche 3 — 2026-04-20 (fix header global + evitar flash en gestión empresas)

### Objetivo del parche
Corregir regresión donde el header no cargaba (usuarios normales y superadmin) y eliminar el parpadeo de pantalla de gestión empresas para usuarios no superadmin.

### Causa detectada
- Se introdujo acoplamiento circular entre autenticación/contexto al resolver ruta post-login dentro de `auth.js`.
- `gestion_empresas` quedaba visible brevemente porque `router.js` mostraba el `body` antes de validar rol superadmin.

### Archivos tocados
- `js/auth.js`  
  **Tipo:** desacople.  
  **Qué hace:** vuelve a función de login sin resolver contexto/permisos dentro del módulo de auth.

- `js/post_login_route.js` (nuevo)  
  **Tipo:** encapsulación.  
  **Qué hace:** centraliza resolución dinámica de ruta post-login usando contexto/permisos sin contaminar `auth.js`.

- `index.html`  
  **Tipo:** flujo login.  
  **Qué hace:** después de `signInWithPassword`, resuelve ruta con `resolvePostLoginRoute` y redirige.

- `js/router.js`  
  **Tipo:** guard de sesión.  
  **Qué hace:** reutiliza `resolvePostLoginRoute` y agrega opción `data-defer-reveal="true"` para no mostrar el body de páginas con guard de rol adicional.

- `gestion_empresas/index.html`  
  **Tipo:** control de visibilidad.  
  **Qué hace:** activa `data-defer-reveal="true"` para bloquear render prematuro.

- `js/gestion_empresas.js`  
  **Tipo:** control de revelado.  
  **Qué hace:** muestra la página solo tras validar `esSuperAdmin()`.

### Emergencia / reversión
1. Si algo falla, quitar `data-defer-reveal` de `gestion_empresas/index.html` para volver al reveal inmediato.
2. En `router.js`, reemplazar lógica de `deferReveal` por `revealPage()` directo.
3. Volver a redirección fija en login si el motor de permisos de ruta no está disponible temporalmente.

### Check (logs de estado)
- ✅ Header vuelve a cargar para usuarios normales.
- ✅ Header vuelve a cargar para superadmin.
- ✅ Se elimina parpadeo de gestión empresas en usuarios sin permiso.
- ✅ Redirección post-login sigue dinámica y aislada de `auth.js`.


---

## Parche 4 — 2026-04-20 (aislamiento header/anuncio impago + desacople de billing_config)

### Objetivo del parche
Evitar que una falla de `anuncio_impago` rompa la carga del `header` y desacoplar `anuncio_impago` de `billing_config` para aislar responsabilidades.

### Problema detectado
- `anuncio_impago.js` importaba `BILLING_PAYMENT_URL` desde `billing_config.js`.
- Tras refactor de facturación, ese export dejó de existir y el import rompía el árbol de módulos.
- Como `header.js` importaba `anuncio_impago.js` de forma directa, el header también fallaba al cargar.

### Archivos tocados
- `js/header.js`  
  **Tipo:** aislamiento defensivo.  
  **Qué hace:** reemplaza import estático de `anuncio_impago` por carga dinámica segura (`import()` con fallback), de forma que el header no depende de la salud de ese módulo para renderizar.

- `js/anuncio_impago.js`  
  **Tipo:** desacople funcional.  
  **Qué hace:** deja de importar `billing_config.js`; ahora resuelve su link de pago propio por `metodos_pago` (código puntual) con fallback local.

- `js/anuncio_impago_config.js` (nuevo)  
  **Tipo:** configuración aislada.  
  **Qué hace:** centraliza código de método de pago impago y URL fallback del módulo impago.

### Emergencia / reversión
1. Si se requiere rollback rápido, volver al import estático en `header.js` y retirar wrappers `safe*`.
2. Si la consulta a `metodos_pago` de impago falla de forma recurrente, forzar temporalmente solo fallback en `anuncio_impago.js`.
3. Si se quiere comportamiento previo total, reintroducir `BILLING_PAYMENT_URL` en `billing_config.js` (compatibilidad legado).

### Exportación a otro repositorio
- Copiar `js/anuncio_impago_config.js` junto con cambios de `header.js` y `anuncio_impago.js`.
- Verificar tabla `metodos_pago` disponible con fila `mercado_pago_puntual` activa.
- Confirmar que rutas de carga dinámica de módulos (`import("./anuncio_impago.js")`) se respeten en el bundler/servidor del destino.

### Check (logs de estado)
- ✅ Header carga aunque `anuncio_impago` falle.
- ✅ `anuncio_impago` queda separado de `billing_config`.
- ✅ Link de pago de impago se resuelve por módulo propio con fallback local.
- ✅ Error en impago se vuelve aislado y no bloquea navegación principal.


---

## Parche 5 — 2026-04-21 (apoyos: consulta webhook de propina y reparto automático aislado)

### Objetivo del parche
Separar la lógica de propina de apoyos en un archivo dedicado y evitar edición manual de propina por apoyo cuando el valor viene del sistema.

### Archivos tocados
- `js/apoyos.js` (nuevo)  
  **Tipo:** módulo aislado de lógica.  
  **Qué hace:**
  1) consulta webhook `https://n8n.enkrato.com/webhook/consultar_propina_apoyo`,
  2) recibe valor de propina de apoyos,
  3) resta del total de propina del turno,
  4) reparte ese total entre apoyos + responsable de turno,
  5) bloquea inputs de propina de apoyos para que queden automáticos.

- `js/cierre_turno.js`  
  **Tipo:** integración mínima.  
  **Qué hace:** integra el manager aislado de apoyos y dispara reset cuando se limpia formulario o se vuelve a consultar Loggro.

- `cierre_turno/index.html`  
  **Tipo:** UI mínima.  
  **Qué hace:** agrega botón `Consultar propina` y mensaje guía en bloque de apoyos.

- `css/cierre_turno.css`  
  **Tipo:** estilos UI.  
  **Qué hace:** añade estilos para contenedor del botón y nota de consulta.

### Payload/response simple para consumo en página
Respuesta esperada (simple):
```json
{
  "header": "propina_apoyos",
  "valor": 3000
}
```
También se contemplan claves alternativas (`propina_apoyos`, `propina`, `valor`, etc.) para robustez.

### Regla de reparto aplicada
Si `propina_turno_total = 10000`, `propina_apoyos = 3000`, `apoyos = 2`:
- se descuenta 3000 del total,
- esos 3000 se dividen entre 3 personas (2 apoyos + responsable),
- cada uno recibe 1000,
- responsable queda con 8000,
- cada apoyo con 1000.

### Emergencia / reversión
1. Quitar import e integración de `initApoyosPropinaManager` en `js/cierre_turno.js`.
2. Eliminar botón `consultarPropinaApoyos` del HTML.
3. Volver a edición manual de propinas por apoyo (quitar bloqueo readonly en flujo).

### Exportación a otro repositorio
- Copiar `js/apoyos.js` + integración mínima en `js/cierre_turno.js`.
- Añadir en la vista el botón de consulta y nota.
- Verificar disponibilidad del webhook y formato de respuesta.
- Ajustar columnas/estilos de apoyos en CSS si la maqueta destino difiere.

### Check (logs de estado)
- ✅ Consulta de propina de apoyos aislada en módulo propio.
- ✅ Botón visible junto al bloque inicial de apoyos.
- ✅ Reparto automático aplicado sin exceder propina total del turno.
- ✅ Inputs de propina de apoyos quedan bloqueados tras consulta.
- ⚠️ Si cambian datos de apoyos, se obliga a reconsultar para recalcular.


---

## Parche 6 — 2026-04-21 (apoyos: propina inhabilitada manual + 3 nuevos campos de rango)

### Objetivo del parche
Ajustar el flujo de apoyos para:
1) mantener propina de apoyos inhabilitada manualmente,
2) agregar 3 campos nuevos al payload de apoyos para el webhook,
3) dejar guía de cómo evolucionar a reparto compuesto por periodos distintos.

### Archivos implicados
- `js/cierre_turno.js`  
  **Tipo:** payload + validaciones + UI runtime.  
  **Cambios:**
  - propina de cada apoyo se renderiza `readonly` (automática),
  - validación de apoyos deja de exigir propina manual,
  - payload agrega:
    - `rango_hora_inicio_simple` (HH:mm),
    - `rango_hora_fin_simple` (HH:mm),
    - `rango_fecha_hora_inicio` (YYYY-MM-DD HH:mm).

- `js/apoyos.js`  
  **Tipo:** lógica aislada de reparto.  
  **Cambios:**
  - fuerza propina de apoyos como `readonly` en todo momento,
  - observa cambios dinámicos de filas para re-aplicar bloqueo,
  - mantiene reset/reconsulta sin habilitar edición manual.

- `docs/2026-04-21_superadmin_flujo_global_usuarios_empresas_y_6_parches.md`  
  **Tipo:** documentación operativa.

### Qué hacer si hay apoyos en periodos distintos (reparto compuesto)
Para escenarios más exigentes, migrar de reparto igualitario a **reparto ponderado por tiempo**:
1. calcular minutos de cada apoyo por su propio rango,
2. sumar minutos de apoyos + minutos del responsable (segmento afectado),
3. distribuir `propina_apoyos` proporcional a minutos,
4. ajustar residuales por redondeo en responsable para cuadrar total.

> Regla sugerida: `asignacion_persona = floor((minutos_persona / minutos_totales) * propina_apoyos)` y residual al responsable.

### Emergencia / reversión
1. Si se necesita volver a captura manual, quitar `readonly` del input propina en `createApoyoRow` y remover enforcement en `js/apoyos.js`.
2. Si el webhook no consume los nuevos campos, mantenerlos en payload (compatibles) o desactivarlos temporalmente en `buildApoyoPayload`.

### Check (logs de estado)
- ✅ Propina de apoyos queda inhabilitada para edición manual.
- ✅ Reparto automático sigue funcionando con webhook.
- ✅ Se envían 3 campos nuevos de hora/rango para apoyos.
- ⚠️ Reparto compuesto por periodos distintos queda recomendado para fase siguiente (no rompimos el reparto simple actual).

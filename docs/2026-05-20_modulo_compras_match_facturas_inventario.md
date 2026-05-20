# 2026-05-20 · Módulo Compras con match entre facturas e inventario

## 1) Objetivo de la petición
Implementar un nuevo módulo **Compras** accesible desde el header (ubicado entre **Cierre inventarios** y **Nómina**) para visualizar productos inventariables provenientes de facturas, permitir el match manual con productos de inventario de Loggro y enviar el resultado al webhook de carga masiva.

## 2) Archivos implicados y tipo de modificación

### Archivos creados
1. `compras/index.html`
   - **Tipo:** nuevo archivo/página.
   - **Objetivo:** renderizar módulo Compras con acciones (consultar/enviar), estado y listado de facturas en tarjetas.
   - **Qué hace:** carga router, header y footer global; monta el contenedor principal y referencia `js/compras.js` + `css/compras.css`.

2. `css/compras.css`
   - **Tipo:** nuevo stylesheet.
   - **Objetivo:** dar layout horizontal tipo tabla sin overflow horizontal en móvil.
   - **Qué hace:** define cards por factura, tabla de 5 columnas (producto factura, cantidad, selector inventario, cantidad a cargar, unidad), adaptación responsive.

3. `js/compras.js`
   - **Tipo:** nuevo módulo funcional.
   - **Objetivo:** orquestar consulta de inventarios, parseo de facturas, match manual y envío final.
   - **Qué hace explícitamente:**
     - Consulta inventarios en `https://n8n.enkrato.com/webhook/consultar_inventarios`.
     - Lee facturas desde `sessionStorage` llave `compras_facturas_cache_{empresa_id}` (estructura tipo arreglo con `data`).
     - Filtra filas con productos que contengan `BANCOLOMBIA` o `IMPUESTO`.
     - Agrupa por `uuid` para generar cards por factura.
     - Renderiza tabla con 5 columnas y selector enlazado a unidad de medida de inventario.
     - Envía payload final a `https://n8n.enkrato.com/webhook/Subir_Compras`.

### Archivos modificados
4. `js/urls.js`
   - **Tipo:** configuración de rutas.
   - **Objetivo:** centralizar la URL de acceso del módulo Compras.
   - **Qué hace:** agrega `APP_URLS.compras = /compras/`.

5. `js/header.js`
   - **Tipo:** navegación global.
   - **Objetivo:** exponer acceso a Compras desde el menú principal en entorno Loggro.
   - **Qué hace:** agrega botón `Compras` entre bloque de Cierre Inventarios y botón Nómina.

6. `js/webhooks.js`
   - **Tipo:** configuración centralizada de webhooks.
   - **Objetivo:** evitar hardcode disperso de endpoints del módulo Compras.
   - **Qué hace:** agrega constantes:
     - `WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS`
     - `WEBHOOK_COMPRAS_SUBIR_MATCH`

## 3) Notas de emergencia para revertir cambios

> Objetivo: volver al estado anterior sin módulo Compras.

### Paso A: remover navegación
- En `js/header.js`, buscar la línea que inserta:
```js
menu += `<a class="nav-link-btn" href="${APP_URLS.compras}">Compras</a>`;
```
- **Acción de reversión:** eliminar esa línea.

### Paso B: remover ruta centralizada
- En `js/urls.js`, ubicar:
```js
compras: buildAppPath("/compras/"),
```
- **Acción de reversión:** eliminar esa propiedad del objeto `APP_URLS`.

### Paso C: remover webhooks del módulo
- En `js/webhooks.js`, ubicar y eliminar este bloque:
```js
export const WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS = ".../consultar_inventarios";
export const WEBHOOK_COMPRAS_SUBIR_MATCH = ".../Subir_Compras";
```

### Paso D: remover archivos nuevos
- Eliminar:
  - `compras/index.html`
  - `css/compras.css`
  - `js/compras.js`

### Paso E: validación post-reversión
1. Abrir plataforma y validar que header no muestre “Compras”.
2. Navegar módulos existentes (cierre inventarios, nómina) y comprobar que funcionan sin errores de import.

## 4) Convención de nombre del documento
Este archivo se nombró siguiendo la regla: `AAAA-MM-DD + resumen`:
- `2026-05-20_modulo_compras_match_facturas_inventario.md`

## 5) Guía para exportar este cambio a otro repositorio (parches)

### 5.1 Particularidad clave de este repositorio
Este proyecto **centraliza rutas y endpoints** en archivos globales:
- Rutas frontend: `js/urls.js`
- Navegación header: `js/header.js`
- Webhooks: `js/webhooks.js`

Si el repositorio destino no tiene esta arquitectura, primero crear una capa equivalente de centralización antes de portar `js/compras.js`.

### 5.2 Orden recomendado de portado
1. Crear página y estilos:
   - `compras/index.html`
   - `css/compras.css`
2. Crear lógica:
   - `js/compras.js`
3. Integrar rutas:
   - añadir `compras` en `APP_URLS`.
4. Integrar menú:
   - insertar enlace en header en el orden funcional solicitado.
5. Integrar endpoints:
   - agregar constantes de webhooks en configuración central.

### 5.3 Validaciones necesarias en destino
- Confirmar que existe mecanismo de contexto de empresa (`empresa_id`) similar a `getUserContext`.
- Confirmar CORS habilitado para:
  - `consultar_inventarios`
  - `Subir_Compras`
- Confirmar estructura de facturas compatible con parseo actual (`data`, `Producto`, `Cantidad`, `uuid`, etc.).
- Confirmar que no exista otra función de match que colisione con IDs de DOM (`consultarCompras`, `enviarCompras`, `comprasFacturas`, etc.).

### 5.4 Flujo de conexión entre archivos
- `compras/index.html` monta UI.
- `js/compras.js` resuelve contexto de sesión, consulta inventario y procesa facturas.
- `js/webhooks.js` define endpoints consumidos por `js/compras.js`.
- `js/urls.js` publica `APP_URLS.compras` para navegación consistente.
- `js/header.js` presenta el acceso al usuario.

## 6) Check de funcionamiento (log de estado)
- **Header > enlace Compras:** funciona.
- **Render de módulo Compras:** funciona.
- **Consulta de inventario (webhook consultar_inventarios):** funciona bajo disponibilidad del webhook.
- **Filtro BANCOLOMBIA/IMPUESTO:** funciona.
- **Agrupación por factura (uuid):** funciona.
- **Selector match + autollenado de unidad:** funciona.
- **Envío final a Subir_Compras:** funciona (si endpoint responde 2xx).
- **Carga automática de facturas desde backend dedicado:** **no implementada** (actualmente se espera `sessionStorage` con llave por empresa).

## 7) Regla para parches posteriores
Si este cambio recibe parches, **no crear archivo nuevo**: editar este mismo documento y renombrarlo con sufijo incremental:
- `2026-05-20_modulo_compras_match_facturas_inventario_y_1_parche.md`
- `..._y_2_parches.md`
Incluyendo en cada parche:
1) objetivo del parche,
2) archivos tocados,
3) plan de reversión por líneas/bloques,
4) validaciones funcionales post-parche.

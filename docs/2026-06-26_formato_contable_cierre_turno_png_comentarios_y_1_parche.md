# 2026-06-26 - Formato contable visual en cierre turno y comentarios en PNG

## 1. Objetivo de la petición

Aplicar mejoras exclusivamente visuales en **Cierre turno** sin cambiar los cálculos, payloads ni la lógica de envío:

1. Mostrar los campos de valores de sistema, valores manuales y diferencias con formato contable colombiano: símbolo `$`, miles separados con punto y decimales con coma.
2. Incluir en la constancia PNG descargada al subir el cierre el comentario escrito por el usuario.
3. Si el usuario no deja comentario, mostrar la nota `Sin comentario del usuario.` dentro del PNG.

## 2. Archivos implicados y cambios realizados

### `cierre_turno/index.html` (modificado)

- **Tipo de modificación:** conexión visual aislada.
- **Objetivo:** cargar los nuevos recursos visuales solo en la pantalla de Cierre turno.
- **Qué hace explícitamente:** añade `../css/cierre_turno_contabilidad.css` y `../js/cierre_turno_contabilidad_visual.js` después de los recursos existentes del módulo. Si estos archivos se eliminan, el cierre sigue funcionando; solo se pierde la presentación contable visual.

### `css/cierre_turno_contabilidad.css` (creado)

- **Tipo de modificación:** estilos visuales aislados.
- **Objetivo:** permitir que el valor real del `<input>` permanezca intacto mientras se muestra encima una capa con formato contable.
- **Qué hace explícitamente:**
  - Crea `.cierre-money-visual-wrap` como contenedor relativo.
  - Oculta visualmente el texto nativo del input con `color: transparent`, conservando el caret.
  - Muestra `.cierre-money-visual-value` como capa no interactiva (`pointer-events: none`) con el valor formateado.

### `js/cierre_turno_contabilidad_visual.js` (creado)

- **Tipo de modificación:** script visual aislado.
- **Objetivo:** formatear en pantalla los inputs financieros sin modificar sus valores reales.
- **Qué hace explícitamente:**
  - Localiza los inputs de sistema, real/manual, diferencias, propina y domicilios por ID.
  - Envuelve cada input en un contenedor visual y añade una capa con el valor formateado.
  - Usa `Intl.NumberFormat("es-CO", { style: "currency", currency: "COP" })` para representar `$`, puntos de miles y coma decimal.
  - Sincroniza la capa visual por eventos `input`, `change`, `blur` y un intervalo liviano para cubrir valores asignados programáticamente por consultas.
  - No escribe de vuelta en los inputs; los cálculos y payloads siguen leyendo los números originales.

### `js/cierre_turno.js` (modificado mínimamente)

- **Tipo de modificación:** paso de dato visual hacia el generador PNG.
- **Objetivo:** entregar al módulo de PNG el comentario que ya existe en el formulario.
- **Qué hace explícitamente:** agrega `comentarioUsuario: comentarios?.value || ""` dentro de `meta` al llamar `descargarImagenResumenCierreTurno(...)`. No cambia validaciones, cálculos ni envío.

### `js/cierre_turno_png.js` (modificado)

- **Tipo de modificación:** mejora visual del PNG.
- **Objetivo:** pintar el comentario del usuario en la constancia descargada.
- **Qué hace explícitamente:**
  - Normaliza el comentario recibido por `meta.comentarioUsuario`.
  - Si está vacío, usa `Sin comentario del usuario.`.
  - Aumenta la altura base estimada para reservar espacio.
  - Añade una sección `Comentario del usuario` dentro del canvas y pinta hasta tres líneas con recorte visual si es muy largo.

## 3. Reversión de emergencia

### Revertir formato contable visual en pantalla

1. En `cierre_turno/index.html`, eliminar:

```html
<link rel="stylesheet" href="../css/cierre_turno_contabilidad.css">
```

2. En `cierre_turno/index.html`, eliminar:

```html
<script type="module" src="../js/cierre_turno_contabilidad_visual.js"></script>
```

3. Borrar los archivos:

- `css/cierre_turno_contabilidad.css`
- `js/cierre_turno_contabilidad_visual.js`

Con esto los inputs vuelven a verse como números planos, sin tocar datos ni lógica.

### Revertir comentario en PNG

1. En `js/cierre_turno.js`, dentro del objeto `meta` de `descargarImagenResumen`, eliminar la línea:

```js
comentarioUsuario: comentarios?.value || ""
```

2. En `js/cierre_turno_png.js`, eliminar:

```js
const comentarioUsuario = String(meta.comentarioUsuario || "").trim() || "Sin comentario del usuario.";
```

3. En `js/cierre_turno_png.js`, quitar `comentarioSectionHeight` y volver a dejar `baseContentHeight` sin sumar esa sección.
4. En `js/cierre_turno_png.js`, eliminar el bloque `drawWrappedText(...)` y el bloque que pinta `Comentario del usuario`.

## 4. Guía para exportar este cambio a otro repositorio

Se realizaron cambios visuales aislados. Para exportarlos a otro repositorio:

1. Copiar `css/cierre_turno_contabilidad.css` y `js/cierre_turno_contabilidad_visual.js`.
2. Confirmar que el módulo destino usa IDs equivalentes para inputs financieros (`efectivo_sistema`, `efectivo_real`, `efectivo_diferencia`, etc.). Si cambian los IDs, ajustar únicamente el arreglo `MONEY_INPUT_IDS`.
3. Agregar el `<link>` y el `<script>` en la vista de Cierre turno del repositorio destino.
4. Verificar que el script visual no modifique `.value`; debe limitarse a pintar una capa encima del input.
5. Para el PNG, confirmar que existe una llamada con objeto `meta` hacia el generador de constancia. Añadir ahí `comentarioUsuario` usando el textarea existente.
6. En el generador PNG, agregar la sección visual de comentario y reservar altura suficiente para no montar textos sobre apoyos o sello.
7. Este repositorio centraliza URLs en `js/urls.js`, pero este cambio no añade nuevas rutas ni webhooks. En un repositorio destino no hace falta tocar el centralizador de URLs para esta mejora.

Archivos creados:
- `css/cierre_turno_contabilidad.css`
- `js/cierre_turno_contabilidad_visual.js`
- `docs/2026-06-26_formato_contable_cierre_turno_png_comentarios.md`

Archivos modificados:
- `cierre_turno/index.html`
- `js/cierre_turno.js`
- `js/cierre_turno_png.js`

Archivos borrados:
- Ninguno.

## 5. Check funcional para logs

- **Cierre turno / cálculos:** funciona; los valores reales de inputs no se transforman, solo se muestran con capa visual.
- **Cierre turno / consulta Loggro:** funciona sin cambios de webhook ni payload.
- **Cierre turno / manuales y diferencias:** funcionan; se ven en formato contable mientras el valor base sigue numérico.
- **PNG de constancia:** funciona; incluye comentario del usuario o `Sin comentario del usuario.` si está vacío.
- **Login, sesión, contexto y header:** no se tocaron en este parche.
- **Cierre inventarios, Compras, Nómina y Configuración:** no se modificaron en este parche.


---

# Parche posterior 1 - 2026-06-28 - Decimales de BD con punto sin perder propina

## Objetivo del parche

Corregir la capa visual contable para que interprete correctamente los valores que vienen de base de datos con punto decimal internacional, por ejemplo `1000.01`, y los muestre como `1.000,01` en formato colombiano. El objetivo principal es evitar que valores como propina se oculten, se interpreten como cero o se vean con un formato extraño.

## Archivo modificado

### `js/cierre_turno_contabilidad_visual.js`

- **Tipo de modificación:** corrección visual defensiva.
- **Objetivo:** diferenciar separadores decimales reales de separadores de miles ya formateados.
- **Qué hace explícitamente:**
  - Si el valor trae punto y coma, usa el último separador como decimal y el otro como miles.
  - Si el valor trae solo coma, la interpreta como decimal colombiano y elimina puntos de miles si existen.
  - Si el valor trae solo punto, lo interpreta como decimal internacional de BD, no como miles.
  - Mantiene el valor original del input intacto; solo cambia la conversión de la capa visual.

## Reversión de emergencia del parche

En `js/cierre_turno_contabilidad_visual.js`, restaurar la versión anterior de `parseMoneyValue(value)`:

```js
function parseMoneyValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/[^0-9,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}
```

> Nota: revertir este parche puede volver a interpretar mal algunos decimales con punto provenientes de BD.

## Guía de exportación del parche

1. Copiar la versión nueva de `parseMoneyValue(value)` al repositorio destino.
2. Validar estos casos visuales antes de publicar:
   - `1000.01` debe verse como `$ 1.000,01`.
   - `35338.274999999994` debe verse como `$ 35.338,27`.
   - `1000` debe verse como `$ 1.000,00`.
   - `1.000,01` debe conservarse como `$ 1.000,01`.
3. Confirmar que ningún cálculo consume el texto visual; los cálculos deben seguir usando `.value` original del input.

## Check funcional del parche

- **Propina consultada desde BD:** funciona; los puntos decimales se interpretan como decimales, no como miles.
- **Valores enteros sin separadores:** funcionan; se les agregan puntos de miles solo en la capa visual.
- **Valores ya formateados en estilo colombiano:** funcionan; se normalizan para mostrarse como COP.
- **Lógica de cierre turno:** no cambia; solo se modifica el parser visual.

# Cierre de turno · números superpuestos en la columna "Diferencias"

**Fecha:** 2026-08-23 · **Ámbito:** `cierre_turno/index.html`, `css/cierre_turno.css`,
`css/cierre_turno_contabilidad.css`
**Estado:** **aplicado y verificado en Chrome headless.** Falta la confirmación en tu
navegador (Ctrl+F5 y pulsar Verificar).

---

## 1. Qué se veía

Al pulsar **Verificar**, los seis campos de la columna *Diferencias* mostraban dos cifras
pisadas una encima de la otra: `-$ 465.698,00` con `-465698` encima, en rojo y en negrita.
Los campos de *Sistema* y *Real* se veían bien. Solo fallaban los de diferencia, y solo
después de Verificar.

## 2. Por qué pasaba

Los campos de dinero no muestran su propio contenido. `js/cierre_turno_contabilidad_visual.js`
envuelve cada `<input>` en un `<span class="cierre-money-visual-wrap">` y le añade al lado un
`<span class="cierre-money-visual-value">` posicionado **encima** del campo (`position:absolute;
inset:0`). El `<input>` guarda el número crudo y se pinta transparente; el `<span>` pinta el
número formateado en pesos. Dos textos en el mismo sitio, uno invisible:

| Elemento | Contenido | Color |
|---|---|---|
| `<input id="efectivo_diferencia">` | `-465698` | `transparent` |
| `<span class="cierre-money-visual-value">` | `-$ 465.698,00` | el que toque (`--ek-ink`, `--ek-bad-700`…) |

El montaje entero dependía de una sola declaración: `color: transparent` sobre el `<input>`.
**Cualquier regla que le devolviera un color visible al input hacía aparecer el número crudo
debajo del formateado.** El detonante era Verificar: es ahí donde `js/cierre_turno.js:1773-1776`
añade `.diff-faltante` / `.diff-sobrante` / `.diff-ok` al input. Antes de Verificar esas clases
no están puestas, y por eso el campo se veía bien hasta ese momento.

Detalle que hacía el estropicio más visible: las clases de veredicto también llevan
`font-weight: 600`, así que el texto que asomaba salía en negrita mientras el formateado iba en
regular. Por eso se leía como un borrón y no como una cifra duplicada limpia.

## 3. Evidencia

Reproducción aislada en Chrome headless con el CSS y el JS reales del repo (misma rejilla,
mismos ids, mismos valores de la captura):

1. **Con el CSS que había en disco al abrir el caso** → se veía correcto. Estilos calculados
   del input: `color: rgba(0,0,0,0)` y `-webkit-text-fill-color: rgba(0,0,0,0)`. Un solo span
   por campo.
2. **Quitando el `transparent` de las clases de veredicto** → resultado idéntico a la captura
   reportada, incluido el `$ 1,00` naranja con un `1` encima en Nequi.

Mecanismo confirmado.

### Por qué el navegador seguía mostrándolo

Fechas de modificación al abrir el caso:

```
cierre_turno/index.html      2026-08-23 07:58   <- aquí vive el ?v=
css/cierre_turno.css         2026-08-23 18:02   <- cambió 10 h después
```

El token `?v=20260823c` no se subió al editar el CSS por la tarde: **la misma URL sirvió hoy
varios contenidos distintos**, así que el navegador se quedó con la versión intermedia (la que
sí pintaba el input) mientras en disco ya estaba la buena.

### Hallazgo colateral: el campo de apertura salía vacío

`#efectivo_apertura_diferencia` (tarjeta *Efectivo de apertura → Diferencia*) también recibe
las clases de veredicto (`js/cierre_turno.js:335-364`), pero **no** está en `MONEY_INPUT_IDS`:
no tiene capa de formato encima, así que muestra su propio texto. El
`color: transparent !important` que blindaba a los otros seis lo dejaba **completamente en
blanco**: recuadro rojo, nota "Recibiste de menos" debajo y ninguna cifra. Verificado en
headless. Queda arreglado con lo mismo.

## 4. Qué se cambió

### `css/cierre_turno_contabilidad.css` — blindaje del campo

```css
.cierre-money-visual-wrap > input {
  color: transparent;
  -webkit-text-fill-color: transparent;   /* nuevo */
  caret-color: var(--ek-ink, #0f172a);
}
```

El navegador pinta el texto de un `<input>` con `-webkit-text-fill-color`, que por defecto
sigue a `color`. Fijándola aquí, ninguna regla de estado puede resucitar el número crudo
**aunque le gane a `color` en la cascada con `!important`**. Es la defensa que faltaba, y
ahora vive en un solo sitio en lugar de repetirse en cada estado.

### `css/cierre_turno.css` — bloque del veredicto

- Fuera los tres `color: transparent !important`. Ya no hacen falta (lo cubre el blindaje) y
  eran justo lo que dejaba invisible el campo de apertura.
- El `color` del input vuelve a ser el color del veredicto. Solo lo ve el campo de apertura;
  en los seis con overlay el texto sigue oculto por el `-webkit-text-fill-color`.
- Fuera los tres `!important` de los selectores del `<span>`. En su lugar, una clase más en el
  selector: `input.diff-input.diff-faltante + …`, que sube la especificidad a (0,4,1).
- `font-weight: 600` y `font-variant-numeric: tabular-nums` **repetidos sobre el `<span>`**.

Sobre esto último, corrijo lo que decía el plan: el selector del span y
`.cierre-money-visual-wrap > input[readonly] + .cierre-money-visual-value` **empataban** a
(0,3,1) —un selector de atributo pesa lo mismo que una clase—, y en el empate ganaba el
segundo por orden de carga. Al quitar el `!important` sin más, el veredicto perdía el color y
salía gris. Por eso la clase extra en el selector.

Y sobre el peso: `font-weight: 600` estaba puesto **sobre el input**, que es invisible. El span
lleva `font: inherit` y hereda del wrapper, no del campo, así que el veredicto se veía en peso
normal aunque el CSS pidiera semibold. Ahora sí sale en semibold.

### `cierre_turno/index.html` — tokens de caché

Los cuatro assets del módulo pasan a `?v=20260823d`, incluido
`js/cierre_turno_contabilidad_visual.js`, que iba **sin versión ninguna**. El comentario del
`<head>` ahora dice que el token sube en cada guardado, no una vez al día, que es exactamente
donde se torció esto.

## 5. Verificación hecha

En Chrome headless, con la rejilla financiera y la tarjeta de apertura reales:

| Comprobación | Resultado |
|---|---|
| Faltante / sobrante / cuadrado | Una sola cifra formateada, en `--ek-bad-700` / `--ek-warn-700` / `--ek-ok-700` |
| Peso de la cifra del veredicto | `font-weight: 600` calculado sobre el span (antes 400) |
| Texto del input en los seis campos | `-webkit-text-fill-color: rgba(0,0,0,0)` en los tres estados |
| **Prueba de regresión**: se inyecta `.diff-input.diff-faltante { color: #991b1b !important }` | No se dobla nada. El blindaje aguanta |
| Apertura → Diferencia | `-5000` visible en rojo (antes: recuadro vacío) |

## 6. Pendiente de tu confirmación

Abrir `cierre_turno/`, **Ctrl+F5**, y pulsar Verificar con un turno que descuadre. Esperado:
una sola cifra por campo, formateada en pesos, en semibold y con el color del veredicto.

## 7. Lo que queda anotado, sin tocar

- **Formato del campo de apertura.** `#efectivo_apertura_diferencia` muestra `-5000`, no
  `-$ 5.000,00`, porque no está en `MONEY_INPUT_IDS`. Es una inconsistencia visual anterior a
  esto y meterlo en la lista es una decisión aparte (afectaría también a `efectivo_apertura`,
  que sí se escribe a mano).
- **`.snapshot-locked input:disabled`** (`css/cierre_turno.css:532-540`) pisa con `!important`
  el `background-color` del veredicto: tras descargar la constancia, los campos pierden el
  tinte rojo/ámbar. Las cifras **no** se doblan (comprobado). Si el tinte debe conservarse en
  ese estado, se excluye `.diff-input` de esa regla.
- **`setInterval(sync, 300)`** en `js/cierre_turno_contabilidad_visual.js:110`: sondeo
  permanente para captar los valores que el JS escribe por código. Sustituible por un
  `window.syncMoneyVisuals()` llamado desde `cierre_turno.js`. No afecta a este fallo.
- **Higiene de caché.** El `?v=` a mano se olvida justo el día que más se edita. Un pre-commit
  que reescriba los tokens de los assets tocados con el hash corto del contenido lo quitaría de
  en medio para todas las páginas, no solo esta.

## 8. Qué NO hacer

**No** formatear escribiendo el valor ya formateado en `input.value` para quitarse la capa
visual de encima. Ese `value` se envía tal cual al backend en `js/cierre_turno.js:1835-1840`
(`efectivo_diferencia`, `datafono_diferencia`, …) y lo leen `toNumberValue` y el constructor
del payload. Cambiarlo mueve el fallo de lo visual a los datos, que es mucho peor.

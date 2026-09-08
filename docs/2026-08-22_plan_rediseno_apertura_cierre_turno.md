# Plan · Rediseño del bloque de apertura y arreglo de iconos · Cierre de turno

**Fecha:** 2026-08-22 · **Estado:** aprobado y **ejecutado** el 2026-08-23

Alcance: `cierre_turno/index.html`, `cierre_turno/auxiliar.html`,
`css/cierre_turno.css`, `css/main.css` (una línea) y `js/cierre_turno.js`.
No se toca la base de datos ni ninguna Edge Function.

---

## 0 · Lo primero: rompí siete reglas de CSS que no tenían nada que ver

Antes de hablar de diseño hay que decir esto, porque explica buena parte de lo
que se ve mal ahora mismo.

Al quitar los estilos viejos del bloque de apertura borré un rango del archivo
por posición en vez de por regla, y ese rango se llevó por delante **el grid
financiero entero**:

| Regla borrada | Qué hacía |
|---|---|
| `.finanzas-grid` | Las 4 columnas de Datos Financieros |
| `.finanzas-row` | `display: contents`, lo que mete cada fila en el grid padre |
| `.finanzas-row.is-hidden` | Ocultar canales desactivados por configuración |
| `.col-title` | **Centrar** Sistema / Real / Diferencias |
| `.row-title` | Etiquetas Efectivo, Datáfono, Rappi… |
| `.diff-cell` | Columna de diferencia con su nota debajo |
| `.diff-input` | Borde base sobre el que se apoyan `.diff-faltante/-sobrante/-ok` |
| `.input-span-3` | Campo que ocupa tres columnas |

Son 7 reglas más un ajuste responsive. Sin ellas, Datos Financieros deja de ser
una rejilla y los indicadores de faltante/sobrante pierden su base.

**La captura que enviaste todavía muestra el grid funcionando**, así que el
navegador estaba sirviendo la hoja anterior desde caché. El archivo en disco
está peor de lo que se ve en esa imagen.

**Paso 1, antes que cualquier otra cosa:** restaurar esas 7 reglas tal cual
estaban, copiándolas del commit `eaa8d3f`, y comprobar que el listado de
selectores del archivo vuelve a coincidir con el de origen salvo los cambios
buscados. Es reversión pura, sin criterio propio de por medio.

---

## 1 · Lo que pediste, y una restricción que hay que respetar

| Lo que pediste | Cómo se resuelve |
|---|---|
| Que vaya **abajo**, no dentro de «Datos del turno» | Vuelve a su sitio original: entre «Datos del turno» y Bolsa/Caja |
| **Horizontal**, `- - -`, no en columna | Tres tarjetas independientes en una rejilla de 3 columnas |
| Orden: apertura → caja anterior → diferencia | Ese orden exacto |
| Que **no quite espacio** a lo que ya estaba | «Datos del turno» recupera sus 2 tarjetas a ancho completo |
| `efectivo_apertura` **editable** | Sigue siendo el único editable de los tres |

**La restricción es real y la verifiqué en el código.** `#efectivo_apertura` no
es un campo decorativo:

- [js/cierre_turno.js:1507](../js/cierre_turno.js#L1507) — sin él, «Consultar
  Loggro» se niega a consultar.
- [js/cierre_turno.js:369](../js/cierre_turno.js#L369) — entra en
  `getEfectivoSistemaBruto()`: apertura + ventas Loggro. Es la base del efectivo
  del sistema y por tanto de toda la conciliación.

Ponerlo en solo lectura habría roto las dos cosas. Se queda editable.

Comprobado además que **ningún** punto del JS llega a este campo recorriendo el
DOM (`closest`, `parentElement`): todas las referencias son por `id`. Moverlo de
sitio es seguro.

---

## 2 · La maqueta

```
h4  Datos del turno
┌────────────────────────┐  ┌────────────────────────┐
│ Hora de llegada        │  │ Duración del turno     │
└────────────────────────┘  └────────────────────────┘

h4  Efectivo de apertura
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ Lo que       │  │ Caja del     │  │ Diferencia   │
│ recibiste    │  │ turno ant.   │  │              │
│ [ editable ] │  │ [ solo lect ]│  │ [ solo lect ]│
│ Cuéntala y   │  │ Caja del     │  │ Cuadra       │
│ escríbela    │  │ 21/08 turno 1│  │              │
└──────────────┘  └──────────────┘  └──────────────┘

Bolsa   Caja
```

Tres tarjetas hermanas, mismo peso visual, misma anchura. La lectura va de
izquierda a derecha como una frase: *esto recibí · esto debía haber · esto
sobra o falta*.

### Por qué así

**Reutiliza `.turno-datos-card`, no inventa nada.** Mismo borde, mismo radio,
mismo fondo `--ek-surface-2` que las dos tarjetas de arriba. La página no gana
un lenguaje visual nuevo, que es justo lo que hacía que el bloque anterior se
viera pegado con cinta.

**El estado se lee sin leer.** La regla `input[readonly]` que ya existe en
[css/cierre_turno.css:272](../css/cierre_turno.css#L272) pinta los campos de
solo lectura en lila claro y los editables en blanco. El único campo blanco de
la fila es exactamente el único que hay que rellenar. Eso es diseño gratis: ya
estaba en la hoja, solo hay que dejar de pelearme con él.

**Un título por tarjeta, corto y en una línea.** Los títulos largos de la
versión anterior se partían en dos líneas de forma distinta en cada tarjeta y
por eso los campos quedaban a alturas diferentes. Con títulos de una línea
desaparece el `min-height` que tuve que meter para compensar, y con él el
apelmazamiento.

**Aire.** Rejilla de 3 columnas con `gap` de 16 px y `margin-top` de 16 px
sobre el bloque, igual que la separación que ya usan las secciones de arriba.
Nada de anchos fijos: `minmax(0, 1fr)` reparte por igual y no deja hueco muerto
a la derecha.

**Móvil.** Por debajo de 720 px pasan a una columna. Es el mismo punto de corte
que ya usa `.turno-datos-grid`, no uno nuevo.

---

## 3 · La diferencia debe usar el sistema que la página ya tiene

Esto es lo que menos me gusta de lo que entregué y merece la pena cambiarlo.

Inventé una clase `.tiene-descuadre` que pinta el campo de rojo. Pero la página
**ya tiene** un lenguaje para exactamente esto, y es mejor: las clases
`.diff-faltante`, `.diff-sobrante` y `.diff-ok`, que dibujan un icono SVG
incrustado dentro del campo —flecha abajo, flecha arriba, tic— con los colores
semánticos de `variables.css`.

Es el mismo indicador que ve la persona en las siete filas de Datos Financieros.
Si el descuadre de apertura se señala igual, no hay nada nuevo que aprender.

**Propuesta:** borrar `.tiene-descuadre` y aplicar en su lugar
`.diff-input` + `.diff-faltante / .diff-sobrante / .diff-ok`, con la misma
lógica que [js/cierre_turno.js:1179](../js/cierre_turno.js#L1179).

Tolerancia cero, como decidiste: `> 0` sobrante, `< 0` faltante, `= 0` ok.
Se conserva la nota de texto debajo («Recibiste de más» / «de menos» /
«Cuadra»).

Un detalle: esos iconos no dependen del CDN de Phosphor, van incrustados como
data URI. Si el CDN cae, el veredicto se sigue viendo.

---

## 4 · Los iconos

Tienes razón en las dos cosas.

### La lupa

Puse `ph-info` a 17 px con `opacity: .85` sobre lila. Queda casi invisible, y
además cambié el símbolo sin que me lo pidieras: era una lupa y sigue habiendo
motivos para que lo sea.

**Propuesta:** `ph-info` a **18 px**, color `--ek-plum-600` y **sin opacidad**.
Un icono de ayuda tiene que verse; si molesta, el problema es que sobra, no que
deba estar medio borrado.

Dos decisiones tuyas aquí, en la sección 7.

### El botón circular

Sigue igual porque solo arreglé la mitad del problema. El repaso completo:

1. Era el glifo de texto `↻` (U+21BB), con su propia caja y línea base dentro
   de la fuente. Ya sustituido por `ph-arrows-clockwise`. **Hecho.**
2. Heredaba `padding: 11px 16px` de la regla global de `button`. **Hecho.**
3. **Sin hacer:** el icono queda a 15 px dentro de un círculo de 24 px. Demasiado
   pequeño, y por eso se sigue viendo raro. Pasa a **círculo de 26 px con icono
   de 16 px** —proporción ~0,6, la que usa Phosphor en sus propios ejemplos— y
   `stroke` en `--ek-plum-600`, que es el color de acción de la página.
4. **Sin revisar:** hay una tercera lupa suelta entre los botones
   [Verificar] [Subir cierre], en
   [cierre_turno/index.html:122](../cierre_turno/index.html#L122). Esa estaba
   posicionada en absoluto **sin ningún ancestro posicionado**, o sea contra un
   contenedor cualquiera de más arriba. Ya no lo está, pero visualmente sigue
   siendo un icono huérfano en una fila de botones. Propongo moverlo junto al
   botón «Subir cierre», que es a lo que se refiere.

---

## 5 · «Datos Financieros» descentrado

Confirmado, y **esto no viene de los cambios de estos días**: está así en el
commit `eaa8d3f` («Respaldo seguro tras aplicar Fase 0»). Producción corre
código anterior, por eso allí se ve centrado.

La causa son dos reglas de `main.css` con **la misma especificidad**, así que
gana la última:

- `.main h1, .main h2 { text-align: center }` — línea 180
- `.bloque > h2, .panel > h2 { text-align: left }` — línea 688

Afecta a **todos** los `.bloque > h2` del proyecto, que según el propio
comentario del archivo son 31 sitios. No es un problema de esta página.

**Recomendación:** quitar `text-align: left` de la línea 688. Un cambio, una
línea, y todos los títulos de sección vuelven a como los conoces.

Dicho esto, y ya que me pides criterio de diseño: **el centrado no es la mejor
opción para títulos de sección dentro de un formulario largo.** El ojo baja por
el borde izquierdo buscando dónde empieza cada bloque, y un título centrado
rompe esa columna de anclaje. Lo habitual es `h1` centrado —es el título de la
página— y `h2` de sección alineados a la izquierda, que es justo lo que hace hoy
el código.

Como lo que se ve ahora es una mezcla de los dos criterios, hay que elegir uno.
Decisión tuya en la sección 7. Si eliges volver a centrar, lo hago global para
que no queden dos páginas distintas.

---

## 6 · Verificación antes de dar nada por bueno

No repito comprobaciones que ya pasé, pero esta vez la lista incluye lo que
se me escapó:

1. **Diferencia de selectores contra `eaa8d3f`.** Listar los selectores del CSS
   antes y después y comparar. Lo único que puede faltar es lo que se quita a
   propósito; lo único nuevo, lo que se añade a propósito. Esta comprobación es
   exactamente la que habría cazado el borrado de la sección 0.
2. **Llaves balanceadas** en el CSS y **etiquetas cerradas** en los dos HTML.
3. **`node --check`** sobre `js/cierre_turno.js`.
4. **Los 7 `id` una sola vez** en cada HTML.
5. **Recorrido de la lógica del formulario**, campo por campo, verificando que
   siguen enganchados:
   - «Consultar Loggro» exige apertura y jornada
   - `getEfectivoSistemaBruto()` suma apertura + ventas
   - `limpiarCamposDatos()` vacía apertura y su tarjeta
   - `controlesBloqueables` bloquea apertura al enviar
   - el `input` de apertura recalcula la diferencia
   - `buildTurnoPayload()` y el RPC siguen mandando `numero_turno`
6. **`auxiliar.html`**, que comparte hoja de estilos: comprobar que ningún
   cambio la deja apuntando a clases que ya no existen. Ese fue el fallo de
   ayer, en pequeño.

---

## 7 · Lo que necesito que decidas

**A · Títulos de las tres tarjetas.** Recomiendo la primera: entra en una línea,
y con la tarjeta ya titulada «Efectivo de apertura» arriba, repetir esas dos
palabras dentro no aporta.

1. `Lo que recibiste` · `Caja del turno anterior` · `Diferencia`
2. `Efectivo de apertura` · `Caja del turno anterior` · `Diferencia de caja`

**B · La lupa de «Efectivo real».** Recomiendo la primera: el símbolo estándar
para «esto tiene una explicación» es la ⓘ, no una lupa, que sugiere buscar.

1. `ph-info` (ⓘ), bien visible
2. `ph-magnifying-glass` (🔍), como estaba antes

**C · Títulos de sección.** Recomiendo la primera, por lo que explico en la
sección 5.

1. Dejarlos a la izquierda y no tocar `main.css`
2. Volver a centrarlos en todo el proyecto (una línea, 31 secciones afectadas)

---

## 8 · Orden de ejecución

1. Restaurar las 7 reglas borradas · **bloqueante**
2. Verificar que el grid financiero vuelve a funcionar
3. Mover el bloque de apertura abajo y montar las tres tarjetas
4. Cambiar `.tiene-descuadre` por `.diff-faltante/-sobrante/-ok`
5. Terminar los iconos
6. `main.css`, solo si eliges centrar
7. Verificación completa de la sección 6 y reporte

Los pasos 3, 4 y 5 son independientes entre sí y pueden ir en paralelo una vez
hecho el 2. El 1 y el 2 son consecutivos y van primero.

**Reversión:** todo el cambio vive en 4 archivos y ninguno tiene estado. Volver
atrás es `git checkout eaa8d3f -- <los 4 archivos>`.


---

## 9 · Resultado de la ejecución · 2026-08-23

Ejecutado con las opciones recomendadas en la sección 7: **A1** (`Lo que
recibiste` · `Caja del turno anterior` · `Diferencia`), **B1** (`ph-info`) y
**C1** (títulos de sección a la izquierda, `main.css` sin tocar).

### Un hallazgo nuevo: el veredicto de conciliación no se pintaba nunca

Al pasar la diferencia de apertura al indicador nativo, comprobé que ese
indicador **no funcionaba en ninguna de las siete filas** de Datos Financieros.

Dos reglas en conflicto:

| Selector | Especificidad | Qué declara |
|---|---|---|
| `input[readonly]` | **(0,1,1)** | `background` (atajo) y `border-color` |
| `.diff-faltante` | (0,1,0) | `background-image`, `background-color`, `border-color`, `color` |

Los siete campos de diferencia son `readonly`, así que ganaba `input[readonly]`;
y como usa el **atajo** `background`, además reseteaba `background-image` a
`none`. Los iconos de faltante / sobrante / correcto y sus colores no llegaban
a dibujarse jamás.

Arreglado calificando las tres reglas con `.diff-input`, clase que los siete
campos ya llevaban: `.diff-input.diff-faltante` es **(0,2,0)** y gana sin
necesidad de `!important`.

Es un arreglo que va más allá del bloque de apertura, pero era condición para
que la sección 3 de este plan funcionara, y devuelve la señal visual de la
conciliación a toda la página.

### Verificaciones superadas

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Selectores del CSS frente a `eaa8d3f` | Solo faltan `.apertura-grid` y `.apertura-note`, retiradas a propósito; solo sobran `#numeroTurno`, `.apertura-cards`, `.apertura-card` y `.jornada-aviso` |
| 2 | Llaves del CSS | 100 / 100 |
| 2 | `<div>`, `<label>`, `<section>`, `<select>` en ambos HTML | Balanceados |
| 3 | `node --check js/cierre_turno.js` | Correcto |
| 4 | Los 8 `id` del bloque | Una sola vez cada uno |
| 5 | Lógica del formulario | Los 6 enganches verificados uno a uno |
| 6 | `auxiliar.html` | Ninguna clase sin estilo, en ninguno de los dos HTML |
| — | Glifos de texto sueltos | Cero |
| — | Imports de `js/` | 0 rotos |

La comprobación 1 es la que faltaba ayer y la que habría cazado el borrado de
la sección 0.

### Pendiente de tu criterio

Este documento se contradecía: la sección 5 recomendaba **centrar** los títulos
de sección y la sección 7 recomendaba **dejarlos a la izquierda**. Ejecuté la
sección 7, que es la de decisiones. Si prefieres el centrado, es una línea:
quitar `text-align: left` de `css/main.css:688`, con efecto en las 31 secciones
del proyecto.

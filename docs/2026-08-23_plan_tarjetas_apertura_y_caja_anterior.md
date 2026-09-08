# Plan — Tarjetas de efectivo de apertura y carga de la caja del turno anterior

**Fecha:** 23/08/2026
**Archivos implicados:** `cierre_turno/index.html`, `cierre_turno/auxiliar.html`,
`css/cierre_turno.css`, `js/cierre_turno.js`, `js/cierre_turno_auxiliar.js`
**Estado:** **fases 1 a 4 ejecutadas el 23/08/2026.** Falta la verificación en
navegador (fase 5), que solo puede hacer Andrés.

---

## 1. Diagnóstico

Los dos síntomas —tarjetas apiladas en vertical y caja del turno anterior
vacía— **no son dos problemas: son el mismo**. El navegador está sirviendo
`cierre_turno.css` y `cierre_turno.js` desde su caché, en la versión anterior
al rediseño. El HTML sí es el nuevo.

### Prueba

| Archivo | Versión en el commit (la que está cacheada) | Versión en el árbol de trabajo |
|---|---|---|
| `cierre_turno/index.html` | `.apertura-grid`, `.apertura-note`, sin `#numeroTurno` | `.apertura-cards` + 3 `.apertura-card`, con `#numeroTurno` |
| `css/cierre_turno.css` | define `.apertura-grid` (línea 57). **No conoce `.apertura-cards`** | define `.apertura-cards` / `.apertura-card` (línea 651) |
| `js/cierre_turno.js` | **0 apariciones** de `efectivo_apertura_esperado` | función `cargarEfectivoAperturaEsperado()` (línea 335), llamada desde el botón (línea 1528) |

El pantallazo que enviaste muestra el HTML nuevo: aparece el selector
«Turno 2 · Tarde» y el bloque «Efectivo de apertura», que en el commit no
existen. Es decir: **el documento es nuevo y sus hojas de estilo y sus scripts
son viejos.**

### Por qué eso produce exactamente lo que se ve

Si el CSS cargado no tiene ninguna regla para `.apertura-cards`, ese `<div>`
es un bloque normal: los tres hijos se apilan a todo lo ancho, uno debajo de
otro. Y dentro de cada tarjeta, sin `.apertura-card { display: flex;
flex-direction: column }`, el `<input>` y el `<small>` son elementos en línea
y se colocan lado a lado. Eso es literalmente el pantallazo: tres bloques
apilados, y en cada uno la nota al costado derecho del campo en vez de debajo.

Si el JS cargado no tiene `cargarEfectivoAperturaEsperado()`, el botón
«Consultar Loggro» hace su consulta de ventas y nada más. La tarjeta «Caja del
turno anterior» se queda con su texto inicial, «Se carga al consultar Loggro»,
para siempre.

### Por qué el HTML se actualiza y el CSS no

El navegador revalida el documento que navega, pero reutiliza los subrecursos
(`<link>`, `<script>`) desde caché sin volver a preguntar mientras no expire su
`max-age`. Como ninguno de esos enlaces lleva versión en la URL, la URL nunca
cambia y la caché nunca se invalida.

**Esto explica por qué has pedido lo mismo varias veces:** el arreglo estaba en
el archivo cada una de esas veces, pero no llegaba a tu pantalla.

### Respuesta directa a tus dos preguntas

- **«¿No has hecho que el botón llame una función de consulta?»** Sí está
  hecho: `js/cierre_turno.js:1528`, dentro del `click` de «Consultar Loggro»,
  en el mismo `Promise.all` que la consulta de ventas.
- **«¿Puedes colocar esa consulta en el mismo botón para no hacer más
  botones?»** Ya está en ese mismo botón. **No hace falta ningún botón nuevo.**
  Lo que falta es que ese código llegue al navegador y que, cuando falle, lo
  diga en vez de callarse.

---

## 2. Fase 1 — Cortar la causa raíz: versionar los assets

Sin esto, cualquier arreglo posterior puede volver a no verse y volvemos al
mismo punto.

**Cambios:**

1. En `cierre_turno/index.html`, añadir un token de versión a los tres
   recursos propios de la página:
   - `../css/cierre_turno.css?v=20260823`
   - `../css/cierre_turno_contabilidad.css?v=20260823`
   - `../js/cierre_turno.js?v=20260823`
2. Lo mismo en `cierre_turno/auxiliar.html` para `../css/cierre_turno.css` y
   `../js/cierre_turno_auxiliar.js`.

No se tocan `variables.css`, `main.css`, `router.js`, `header.js` ni
`footer.js`: son compartidos por todo el proyecto, y versionarlos aquí sin
versionarlos en las 31 secciones crea una inconsistencia peor que el problema.
Queda anotado como tarea aparte si vuelve a pasar en otra pantalla.

**Regla de trabajo a partir de ahora:** cada vez que se modifique el CSS o el
JS de una pantalla, se sube el token de fecha en el `<link>`/`<script>` de esa
pantalla, en el mismo cambio. Es una línea y ahorra la ronda de «no lo veo».

**Verificación:** DevTools → Network → recargar. La petición debe aparecer como
`cierre_turno.css?v=20260823` con estado `200`, no `200 (disk cache)`.

---

## 3. Fase 2 — Que las tarjetas no puedan desmembrarse

La regla actual es:

```css
.apertura-cards {
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
```

`auto-fit` **decide solo** cuántas columnas caben. Con el gap de 12 px hacen
falta 624 px para las tres; hoy hay unos 660 px disponibles, así que entran por
36 px de margen. Cualquier cambio de padding, una ventana algo más estrecha o
un zoom del navegador tira una tarjeta a la fila siguiente sin avisar. Eso es
exactamente «desmembrarse»: el layout se reorganiza a espaldas del diseño.

**Cambio:** columnas fijas, y un único punto de corte explícito.

```css
.apertura-cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));   /* siempre 3 */
  align-items: stretch;
  gap: var(--ek-sp-3, 12px);
  margin-bottom: var(--ek-sp-3, 12px);
}

@media (max-width: 768px) {
  .apertura-cards { grid-template-columns: 1fr; }     /* móvil: apiladas a propósito */
}
```

`minmax(0, 1fr)` en vez de `1fr` es lo que impide que un contenido ancho —una
cifra larga, una etiqueta como «Caja del 20/08/2026 turno 2»— ensanche su
columna y descuadre las otras dos.

El punto de corte de 768 px es el que el archivo ya usa para los apoyos; no se
inventa uno nuevo.

**Verificación obligatoria (lección ya pagada):** después de tocar el CSS,
comparar el listado de selectores contra la versión anterior:

```
git diff css/cierre_turno.css | grep '^[-+][^-+]' | grep '{'
```

No debe desaparecer ningún selector salvo la regla vieja de `.apertura-cards`.

---

## 4. Fase 3 — Que el fallo de la consulta sea visible

Hoy, si la consulta de la caja anterior falla, no se distingue de «no hay turno
anterior», porque el error se traga en dos sitios:

- `js/cierre_turno.js:1528` — `cargarEfectivoAperturaEsperado().catch(() => {})`
- `js/cierre_turno.js:344` — mensaje genérico «No se pudo cargar la caja
  anterior», sin el motivo.

**Cambios:**

1. La nota bajo «Caja del turno anterior» pasa a distinguir tres estados
   claramente distintos:
   - cargada → `Caja del 20/08/2026 turno 2` (la etiqueta que ya devuelve el RPC)
   - sin datos → `Sin cierre anterior registrado`
   - fallo → `No se pudo cargar la caja anterior`, **más un `console.error` con
     el objeto de error completo**, para poder diagnosticar en un minuto en vez
     de a ciegas.
2. Sustituir `.catch(() => {})` por un `catch` que escriba ese estado de fallo,
   en lugar de descartar la excepción en silencio.
3. En el `change` del selector de jornada (`seleccionarJornada`, línea 272)
   llamar también a `limpiarEfectivoApertura()`. Hoy solo lo hace el `change`
   de la fecha, pero la caja heredada depende de `numero_turno` tanto como de
   la fecha: cambiar de Turno 1 a Turno 2 después de consultar deja en pantalla
   una cifra que ya no corresponde.

**Lo que NO se toca:** el orden de control. La validación de
`js/cierre_turno.js:1507` seguirá exigiendo el efectivo de apertura **antes**
de dejar consultar Loggro. La persona declara lo que contó sin saber cuánto
debería haber; solo después el sistema revela el esperado. Si se mostrara al
abrir, bastaría con copiar la cifra y el control no mediría nada.

Tampoco se toca el RPC `efectivo_apertura_esperado(date, smallint, uuid)` ni
ninguna migración: la firma del servidor y la llamada del cliente coinciden, y
las migraciones están aplicadas y verificadas.

---

## 5. Fase 4 — `auxiliar.html` tiene las tarjetas pero no la consulta

`cierre_turno/auxiliar.html:71` pinta las mismas tres tarjetas, pero
`js/cierre_turno_auxiliar.js` **no tiene ninguna referencia** a
`efectivo_apertura_esperado`. En esa pantalla, «Caja del turno anterior» se
queda vacía siempre, haga lo que haga la persona.

Esto se cruza con el pendiente ya identificado: `cierre_turno_auxiliar.js:459`
inserta directo en `cierres_turno_final` sin pasar por el RPC
`subir_cierre_turno`, así que no pone `numero_turno`, no es idempotente y no
genera el efectivo de apertura. Son la misma decisión.

**Decisión de Andrés (23/08/2026): opción C.** El auxiliar fue algo provisional
de una caída de servidores y ya no se usa. Se elimina.

**Ejecutado:**

- Borrados `cierre_turno/auxiliar.html` y `js/cierre_turno_auxiliar.js`.
- Retirado el bloque «Accesos de emergencia» de `configuracion/index.html`, que
  era su única puerta de entrada.
- Retirada la entrada `cierreTurnoAuxiliar` de `js/urls.js` (estaba declarada y
  no la usaba nadie).
- Retiradas las reglas huérfanas `.auxiliar-note` de `css/cierre_turno.css` y
  `.config-emergency-access` de `css/configuracion.css`.
- Corregido el comentario de `css/cierre_turno.css:127`, que citaba el JS
  borrado.

**Consecuencia que interesa:** esto desbloquea el pendiente del índice único.
`cierre_turno_auxiliar.js:459` era la vía que insertaba directo en
`cierres_turno_final` sin `numero_turno`, sin idempotencia y sin efectivo de
apertura. Al desaparecer, el único camino de entrada es el RPC
`subir_cierre_turno`. Queda pendiente solo el otro bloqueo: los 10 días con
registros heredados de `turnos_sospechosos`.

---

## 6. Fase 5 — Verificación de cierre

Se da por buena la entrega solo con esta lista completa:

**Visual**
- [ ] Un `Ctrl+F5` una sola vez. En Network, `cierre_turno.css?v=20260823` responde `200`, no `disk cache`.
- [ ] Las tres tarjetas en una sola fila, del mismo ancho, a 1280 px.
- [ ] Iguales a 1024 px y a 900 px (aquí es donde antes se rompía).
- [ ] A 768 px o menos, apiladas: eso es deliberado, no un fallo.
- [ ] Dentro de cada tarjeta: título, campo debajo, nota debajo del campo. La nota nunca al costado.
- [ ] Ninguna tarjeta más alta que las otras con los tres campos llenos.

**Funcional**
- [ ] Con una fecha y jornada que **sí** tienen cierre anterior: al pulsar Consultar Loggro, la caja se rellena y la nota dice `Caja del DD/MM/AAAA turno N`.
- [ ] La «Diferencia» se calcula y se colorea: falta, sobra o cuadra.
- [ ] Con una fecha sin cierre anterior: nota `Sin cierre anterior registrado` y campo vacío, sin error.
- [ ] Cambiar la jornada después de consultar borra la caja anterior y la diferencia.
- [ ] Sin efectivo de apertura escrito, Consultar Loggro sigue rechazando la consulta con su aviso.
- [ ] La consulta de ventas de Loggro sigue funcionando igual que antes: no se toca su rama del `Promise.all`.

**Regresión**
- [ ] `git diff css/cierre_turno.css` no elimina ningún selector salvo la regla vieja de `.apertura-cards`.
- [ ] `cierre_turno/auxiliar.html` sigue renderizando sin errores en consola.

---

## 7. La regla de la caja anterior: qué hace el RPC exactamente

Andrés la enunció así: *«que me traiga la caja del último turno cerrado en el
día que se selecciona, y si no hay, la del día anterior»*.

**El RPC ya hace exactamente eso.** El corazón de
`efectivo_apertura_esperado` es:

```sql
WHERE empresa_id = v_empresa
  AND (fecha_turno, COALESCE(numero_turno, 1)) < (p_fecha, p_numero)
ORDER BY fecha_turno DESC, numero_turno DESC
LIMIT 1
```

Es una comparación de tuplas: devuelve el último turno cerrado **estrictamente
anterior** al par (fecha, turno) seleccionado. Si hay un turno previo ese mismo
día, ese gana; si no lo hay, baja al último del día anterior. Coincide con la
regla.

### El matiz que puede estar detrás de la confusión

En el pantallazo estaba seleccionado **21/08/2026 · Turno 2 · Tarde**, y el
cierre que Andrés dice que existe en el 21/08 es «el de la noche».

Si ese cierre de la noche **es** el turno 2 del 21/08, el RPC lo excluye a
propósito: es el turno que se está cerrando, y nadie hereda su propia caja. En
ese caso buscaría el turno 1 del 21/08 y, si tampoco existe, el último del
20/08. El resultado sería correcto aunque no sea el que se esperaba a primera
vista.

Esto solo se puede confirmar mirando los datos. Desde aquí no se puede
consultar la base: el conector de Supabase no está autorizado en esta sesión y
la CLI no tiene ejecutor de SQL arbitrario. En cuanto cargue el JS nuevo, el
`console.error` añadido en la fase 3 dirá con qué `p_fecha` y `p_numero` se
preguntó y qué devolvió.

---

## 8. Qué necesito de ti

1. **La verificación de la fase 5** en tu navegador, con un `Ctrl+F5` primero.
2. **Cómo estás abriendo la página**: Live Server de VS Code, `file://` directo,
   o la URL publicada. Si fuera la publicada, el token de versión no basta por
   sí solo, porque ahí lo que se sirve es lo commiteado y estos cambios todavía
   no lo están; y ahí entra el cuidado conocido con el push, que cambiaría de
   base a los clientes reales.

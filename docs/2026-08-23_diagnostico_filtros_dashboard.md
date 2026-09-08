# Diagnóstico: «los filtros no filtran y no veo el botón»

**Fecha:** 2026-08-23 · **Estado:** SOLO DIAGNÓSTICO. No he cambiado nada.

---

## Resumen honesto

Dos síntomas, dos respuestas muy distintas:

| Síntoma | Veredicto |
|---|---|
| «El botón no lo veo» | **Culpa mía, pero no es un fallo: ese botón no existe todavía.** No lo he construido. |
| «Los filtros no filtran, solo sale 114 millones» | **No he logrado reproducirlo.** Todo lo que puedo medir da correcto. Necesito dos datos de tu navegador. |

---

## 1 · El botón: no existe, y la confusión es mía

El interruptor «Efectivo neto / bruto» de la dona lo dejamos para la **fase 5**.
Yo respondí «sí se puede» y acto seguido apliqué la fase 1, y entiendo que
quedara la impresión de que iba incluido. **No lo construí.** No hay nada roto
ahí: no hay nada que ver todavía.

Lo mismo aplica al filtro de período con atajos y a la sección de ventas por
responsable: son las fases 2 y 3, tampoco están hechas.

**Lo único que cambié en la fase 1** fue quitar la tabla «Turnos Recientes» y
poner en su lugar una tabla **«Ventas por día»**, al final de la pestaña Ventas
y Turnos. Si esa tabla tampoco te aparece, entonces sí tenemos un problema de
carga y es justo el dato que necesito (ver punto 4).

---

## 2 · Lo que verifiqué, con resultados

### 2.1 · La base filtra bien

Llamé a `dashboard_ventas` con tu cuenta, variando sede y mes:

| Caso | Ventas |
|---|---:|
| Agosto · todas las sedes | 114.883.698 |
| Agosto · BATUT VIVA | **44.180.359** |
| Agosto · BATUT LE MERIDIEM | **70.703.339** |
| Julio · todas | 118.006.572 |
| Mayo · todas | 84.630.525 |

Las dos sedes suman exactamente el total. **El filtrado por sede y por mes
funciona en la base.**

`dashboard_sedes()` también responde bien: devuelve BATUT LE MERIDIEM
(principal) y BATUT VIVA (local).

### 2.2 · El JavaScript también

Monté un simulador que ejecuta `dashboard.js` con un DOM y un Supabase
falsos, y reproduje tus gestos:

```
1. Tras cargar:      ["dashboard_sedes","dashboard_conciliacion"]
   Mes por defecto:  2026-08
   Listeners en filtroSede: 1
   Listeners en filtroMes:  1

2. Al cambiar la SEDE:
   dashboard_ventas  p_desde=2026-08-01  p_hasta=2026-08-31
                     p_empresa_id=5b5f990a-…   <- la sede elegida

3. Al cambiar el MES:
   dashboard_ventas  p_desde=2026-05-01  p_hasta=2026-05-31
                     p_empresa_id=5b5f990a-…   <- conserva la sede
```

Los dos filtros disparan la recarga y mandan los parámetros correctos. **El
cableado no está roto.**

### 2.3 · Mi edición no dejó nada suelto

- El módulo parsea como ES module.
- Los 17 módulos que carga la página resuelven todos sus imports.
- No quedó ninguna referencia a la variable `turnos` que retiré.
- La plantilla del `innerHTML` cierra correctamente.
- `renderTablaVentasPorDia` probada con datos reales: sin `undefined`, sin
  `NaN`, con estado vacío correcto.

### 2.4 · El servidor entrega la versión nueva

```
Last-Modified: Sun, 23 Aug 2026 21:40:21 GMT   <- mi edición
Content-Length: 23590
Revalidación con If-Modified-Since -> 304
```

El archivo que sirve el 5500 **es el actual**. No hay Service Worker en el
proyecto que pueda interceptar la caché.

Un detalle que sí encontré: **el proceso que ocupa el 5500 no es el que yo
arranqué.** El mío escuchaba solo en `127.0.0.1` y el sistema avisó de que se
detuvo. El que está ahora es otro `python.exe` (PID 5620) escuchando en
`0.0.0.0`. Sirve el mismo contenido correcto —lo comprobé— pero conviene saberlo
por si tienes un segundo servidor levantado de antes.

---

## 3 · Qué queda como causa probable

Descartados el backend, el JavaScript y el servidor, quedan dos:

**a) El navegador sigue usando el módulo viejo.** Los `<script>` de este
proyecto se enlazan **sin `?v=`**. Con `Ctrl+F5` debería bastar, pero los
módulos ES se cachean de forma más terca que un script normal, y no sería la
primera vez en este proyecto que un arreglo «no aparece» por esto.

**b) Estoy entendiendo mal el síntoma.** Por ejemplo, si «no filtra» significa
que la gráfica cambia pero la tarjeta no, o que solo falla al elegir una sede
concreta, eso apunta a otro sitio distinto y lo miro ahí.

---

## 4 · Lo que necesito de ti (dos minutos)

Con la pestaña **Ventas y Turnos** abierta, pulsa `F12`:

1. **Pestaña «Console»:** ¿hay algo en rojo? Cópiamelo tal cual.
2. **Pestaña «Network»:** filtra por `dashboard`. Cambia la sede en el
   desplegable y dime:
   - ¿aparece una petición nueva a `dashboard_ventas`?
   - si la abres, en «Response», ¿qué `total_ventas` trae?

Y una pregunta directa: **al final de la pestaña Ventas y Turnos, ¿ves una tabla
titulada «Ventas por día»?** Sí o no. Esa respuesta sola descarta o confirma la
causa (a).

---

## 5 · La solución que propongo en cualquier caso

Independiente de lo anterior, propongo **versionar los assets del dashboard**:

```html
<script type="module" src="../js/dashboard.js?v=20260823"></script>
```

Es una línea por archivo. Elimina para siempre esta duda —«¿lo estoy viendo o
es la versión vieja?»— que ya nos costó tiempo antes. Se aplica solo a las
páginas del dashboard, no toca el resto del proyecto.

Si prefieres algo aún más simple mientras probamos: abrir el dashboard en una
ventana de incógnito. No comparte caché con tu sesión normal y descarta (a) sin
tocar código, aunque tendrás que iniciar sesión de nuevo.

---

## 6 · Qué NO voy a hacer sin tu visto bueno

Nada. No he tocado la base, ni el JavaScript, ni el HTML desde la fase 1. Lo de
arriba son mediciones, no cambios.

Cuando me des los dos datos del punto 4, sé exactamente dónde mirar.

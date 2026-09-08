# Plan de ampliación de los tableros

**Fecha:** 2026-08-23 · **Estado:** PENDIENTE DE TU VISTO BUENO. Nada aplicado.
**Premisa:** lo que hay funciona. Todo lo de aquí es **aditivo**; ninguna parte
modifica lo que ya está verificado.

---

## 0 · Primero, la dona: qué quería decir y por qué quizá no hay que tocarla

Me expliqué mal. **No propongo meter los gastos en la dona.** Los gastos son
gastos y van en la pestaña de Gastos.

El problema es otro. Recuerda lo que encontramos: el efectivo se guarda **ya
descontado de los gastos**.

```
efectivo_sistema = apertura + efectivo de Loggro − gastos del turno
```

Así que la porción «Efectivo» de la dona no muestra *el efectivo que entró*,
muestra *el efectivo que quedó después de pagar gastos*. Por eso las porciones
no suman la cifra de «Ventas Totales» de arriba: le faltan los 19,5 M que se
pagaron de la caja.

Mi propuesta era mostrar el efectivo **como entró**, deshaciendo el descuento:

```
efectivo_bruto = efectivo_sistema + gastos_turno
```

Eso no añade los gastos a la dona: **devuelve el efectivo a su valor real**. El
gasto sigue siendo gasto y sigue sin aparecer ahí.

### Tres opciones, elige la que prefieras

| | Qué se hace | Ventaja | Inconveniente |
|---|---|---|---|
| **A** | Mostrar el efectivo bruto | La dona suma el total. Es «cuánto entró por cada medio de pago», que es lo que uno espera | Cambia una cifra que hoy ya ves |
| **B** | Dejarlo y renombrar la porción a «Efectivo (neto de gastos)» | Cero riesgo, honesto | La dona sigue sin sumar el total |
| **C** | No tocar nada | — | Quien sume la dona a mano va a creer que falta dinero |

**Recomiendo la A.** Pero es tu negocio y tu criterio: si prefieres ver el
efectivo que quedó en caja, la B es perfectamente defendible.

---

## 1 · ¿Tablero anual nuevo, o ampliar el filtro actual?

**Recomendación: ampliar el filtro. No hacer un tablero nuevo.**

### La razón, medida

Los RPC **ya aceptan cualquier rango de fechas**. No es una suposición: llamé a
`dashboard_ventas('2026-01-01','2026-12-31')` tal como está hoy y respondió:

```
ventas del año:       548.339.548
puntos en la gráfica: 178
```

Funciona ya. **Lo único que limita el tablero a un mes es el `<input
type="month">` del HTML**, no el backend.

Un tablero anual aparte significaría duplicar la pestaña, sus gráficas y su
mantenimiento, para obtener algo que las funciones actuales ya devuelven. Cada
arreglo futuro habría que hacerlo dos veces — el mismo error que estamos
desmontando en las tablas gemelas.

### Lo que sí hay que resolver: la granularidad

178 puntos ya aprietan una gráfica de líneas. Un año completo de operación
serían ~365. Ilegible.

La solución no es limitar el rango, es agrupar según el rango:

| Rango elegido | Agrupación de la gráfica |
|---|---|
| Hasta 31 días | Por día |
| 32 a 120 días | Por semana |
| Más de 120 días | Por mes |

Automático, sin que tengas que elegir nada. Con un selector manual al lado por
si quieres forzar otra vista.

### Cómo quedaría el filtro

Sustituir el selector de mes por un selector de periodo con atajos:

```
[ Este mes ▾ ]   Este mes · Mes anterior · Últimos 3 meses
                 Últimos 6 meses · Este año · Personalizado…
```

«Personalizado» abre dos fechas. **Todas las pestañas heredan el filtro**, así
que Conciliación también gana la vista anual sin trabajo extra.

---

## 2 · Nueva sección: Ventas por empleado

### Lo que se puede medir, y una advertencia que importa

Los datos existen: cada turno tiene `responsable_id` y `total_global`. Probé la
consulta sobre julio y sale limpia.

**Pero hay que llamarlo por su nombre.** Lo que se mide es *las ventas del turno
que esa persona tuvo a cargo*, no *las ventas que esa persona hizo*. En un
restaurante vende el equipo entero; el responsable es quien cerró el turno.

Si la pantalla dice «quién vende más», se está creando un incentivo sobre una
métrica que la persona no controla del todo. Sugiero titularla **«Ventas por
responsable de turno»**. Es menos vistoso y mucho más defendible cuando alguien
lo discuta.

### El detalle de diseño que cambia el resultado

Ordenar por venta total mide sobre todo **quién trabajó más turnos**. Julio 2026,
datos reales:

| Responsable | Turnos | Venta total | Venta por turno | Puesto por total | Puesto por promedio |
|---|---:|---:|---:|:---:|:---:|
| Wendy Molina Beltran | 16 | 24.956.219 | 1.559.764 | **1.º** | 2.º |
| Carolina Estrada | 20 | 23.483.147 | 1.174.157 | 2.º | 4.º |
| Tatiana Salas | 16 | 21.708.430 | 1.356.777 | 3.º | 3.º |
| **Saray de la Hoz** | 12 | 19.140.719 | **1.595.060** | 4.º | **1.º** |
| SEBASTIAN PERTUZ | 16 | 18.097.912 | 1.131.120 | 5.º | 5.º |
| Daily Chavez | 8 | 5.627.509 | 703.439 | 6.º | 7.º |
| Valeria Rivero | 5 | 4.992.636 | 998.527 | 7.º | 6.º |

**Saray es cuarta por total y primera por promedio.** Hizo 12 turnos, no 20. Con
el ranking por total, la persona que más rinde por turno queda fuera del podio.

**Por eso la tabla debe traer las dos columnas y la gráfica un conmutador**
«Total / Por turno». Sin eso, la pantalla responde mal la pregunta que le
haces.

### Cómo quedaría

- **Filtros:** hereda el periodo y la sede del filtro global. Al elegir una
  sede, salen sus responsables.
- **Gráfica de barras horizontales**, ordenada de mayor a menor, con el
  conmutador Total / Por turno.
- **Tabla debajo** con las mismas filas: responsable, turnos, venta total,
  venta por turno, y % sobre el total del periodo.
- El primero y el último resaltados, que es lo que pediste ver de un vistazo.

### Backend

Una función nueva, `dashboard_ventas_responsable(p_desde, p_hasta,
p_empresa_id)`, calcada de `dashboard_ventas` en seguridad: `app_es_admin()`,
arreglo de empresas visibles, `= ANY(...)` para que use el índice, y
`app_nombre_responsable()` para el nombre. **No toca nada existente.**

---

## 3 · Fuera «Turnos Recientes», entra «Ventas por día»

Quitar esa tabla es gratis. Y lo que pides en su lugar **ya está calculado**:
`dashboard_ventas` devuelve el bloque `evolucion` con una fila por día, que hoy
solo alimenta la gráfica.

Así que la tabla nueva no necesita **ni una consulta más**: se pinta con datos
que ya viajan al navegador.

Columnas: fecha, día de la semana, turnos, venta del día y % sobre el periodo.
Ordenable, con el mejor y el peor día marcados. Cuando el rango sea largo, la
tabla agrupa igual que la gráfica (semana o mes), para que ambas cuenten lo
mismo.

---

## 4 · Lo que sugiero añadir para que quede profesional

Cuatro cosas baratas que marcan la diferencia:

1. **Comparación con el periodo anterior.** Cada tarjeta con su variación:
   «$114.883.698 · ▼ 2,6 % vs. julio». Un número solo no dice si vas bien; la
   variación sí. Se calcula llamando al mismo RPC con el rango anterior.
2. **Exportar a Excel.** Ya hay precedente en el proyecto: el Libro de
   Descuadres exporta con `XLSX`. Reutilizar ese mismo camino en las tablas
   nuevas.
3. **Estados vacíos de verdad.** Hoy, si un mes no tiene turnos, las gráficas
   salen en blanco sin explicar nada. Un mensaje claro evita que parezca
   averiado — que es exactamente lo que nos pasó al principio.
4. **Totales al pie de cada tabla.** Para poder cuadrar la tabla contra la
   tarjeta de arriba sin sumar a mano.

Y una que **no** recomiendo por ahora: gráficas comparando sedes entre sí. Con
dos sedes aporta poco y hay que decidir cómo tratar las que llevan distinto
tiempo abiertas (BATUT VIVA solo tiene datos desde el 29 de junio, así que
cualquier comparación directa la dejaría mal parada sin motivo).

---

## 5 · Orden de trabajo propuesto

De menor a mayor riesgo. Cada fase deja el tablero funcionando.

| Fase | Qué | Backend | Riesgo |
|---|---|---|---|
| **1** | Quitar «Turnos Recientes» y poner la tabla de ventas por día | Ninguno | Nulo |
| **2** | Filtro de periodo con atajos + granularidad automática | 1 parámetro nuevo en `dashboard_ventas` y `dashboard_conciliacion` | Bajo |
| **3** | Sección de ventas por responsable | 1 función nueva | Bajo |
| **4** | Comparación con periodo anterior, exportar, estados vacíos, totales | Ninguno | Nulo |
| **5** | La dona, según lo que decidas en el punto 0 | Ninguno o mínimo | Nulo |

La fase 1 se puede hacer hoy mismo y ya se nota. La 2 es la que más valor da por
esfuerzo: con ella tienes la vista anual, la mensual y cualquier rango, en las
tres pestañas a la vez.

**Sobre el parámetro de granularidad de la fase 2:** se añade con valor por
defecto (`p_granularidad text DEFAULT 'auto'`), así que las llamadas actuales
siguen funcionando exactamente igual. No se rompe nada.

---

## 6 · Decisiones

1. **La dona:** ¿opción A (efectivo bruto), B (renombrar) o C (dejarla)?
2. **El anual:** ¿confirmas ampliar el filtro en vez de crear un tablero nuevo?
3. **El ranking de empleados:** ¿lo titulamos «Ventas por responsable de turno»
   y mostramos total **y** promedio por turno?
4. **¿Arranco por la fase 1**, que no toca backend?

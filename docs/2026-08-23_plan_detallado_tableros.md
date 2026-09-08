# Plan detallado · Los cinco tableros

**Fecha:** 2026-08-23 · **Base:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`) · **Estado:** propuesta, sin ejecutar

Sustituye a las secciones 2, 3, 5, 6 y 10 del plan del 22 de agosto
(`2026-08-22_plan_sistema_dashboards.md`), que se escribieron sobre una base sin
depurar. Todas las cifras de este documento se midieron hoy, después de la
depuración, contra la base real.

---

## 1 · Qué cambió desde el plan del 22 de agosto

Cuatro premisas de aquel plan ya no valen. Conviene decirlo primero porque cada
una simplifica el trabajo.

**La deduplicación en las vistas ya no hace falta.** El plan de ayer dedicaba
toda su sección 9 a deducir el «último envío» con `DISTINCT ON … ORDER BY
created_at DESC`, porque el 24 % de los turnos tenía filas repetidas. Esas filas
ya no están: se archivaron en `cierres_turno_historico` y ahora un índice único
sobre `(empresa_id, fecha_turno, numero_turno, variable, categoria)` impide que
vuelvan. Las vistas de los tableros leen la tabla tal cual.

Queda **una excepción**: `gasto_extra` está fuera de ese índice, porque una
misma categoría podría necesitar varias filas. Hoy no las hay —una fila por
categoría en los 412 turnos con gastos— pero la vista debe protegerse igual con
`DISTINCT ON (turno, categoria) ORDER BY created_at DESC`. Es una línea, y evita
que un turno con gastos duplicados infle el margen sin que nadie lo note.

**La clave del turno cambió.** Era
`(empresa_id, fecha_turno, hora_inicio, responsable_id)`; ahora es
`(empresa_id, fecha_turno, numero_turno)`, con `numero_turno` en 1, 2 o 3 y
`NOT NULL`. Todas las vistas agrupan por esa clave, que es estable y no depende
de un texto de hora.

**El efectivo de apertura ya existe.** La Fase 4 lo reconstruyó para los 413
turnos, sin una sola excepción. Eso habilita la conciliación del efectivo entre
turnos —lo que la Parte III del plan de ayer dejaba pendiente— y ya hay una
vista, `descuadres_apertura`, que compara la caja que dejó el turno anterior
contra la apertura que declaró el siguiente.

**Los números son otros.** Donde el plan de ayer decía 8 917 filas y 350 turnos,
hoy hay 6 057 filas y 313 turnos en la tabla base. Las cifras de venta de aquel
plan estaban infladas por los duplicados.

---

## 2 · Los datos que hay hoy

Medido el 2026-08-23 sobre la base ya depurada.

| Tabla | Filas | Turnos | Periodo | Última escritura |
|---|---:|---:|---|---|
| `cierres_turno_final` | 6 057 | 313 | 2026-02-12 → 08-21 | 2026-08-22 |
| `cierres_turno_final_locales` | 1 745 | 100 | 2026-06-29 → 08-21 | 2026-08-22 |
| `apoyos_turno` (+ locales) | 102 | 100 | 2026-04-18 → 08-21 | activa |
| `gastos_costos` | 1 323 | — | 2026-03-05 → **06-06** | **2026-06-06** |
| `cierres_inventario` | 441 | — | 2026-02-12 → **05-16** | **2026-05-16** |

**413 turnos en 218 días de operación**, entre la empresa madre y su local.

### 2.1 · Dos fuentes están congeladas

Esto es lo más importante que encontré al preparar el plan, y cambia el orden de
entrega.

`cierres_inventario` no recibe una fila desde el 16 de mayo, hace tres meses. La
tubería **no está rota**: la Edge Function `cierre-inventarios-subir` existe y
funciona, se migró ayer. Simplemente nadie ha hecho un cierre de inventario
desde entonces. Un tablero construido sobre esto retrata mayo.

`gastos_costos` no recibe una fila desde el 6 de junio, y aquí sí hay un
problema de fontanería: **ningún archivo del proyecto escribe en esa tabla.** No
hay Edge Function, no hay módulo, no hay webhook vivo. Los 1 323 registros son
una carga puntual de marzo a junio que nadie mantiene. Como fuente de un tablero
es una foto vieja que nunca se va a actualizar sola.

La consecuencia práctica: de los cinco tableros, **tres se alimentan de datos
vivos** (conciliación, ventas, gastos de turno) y **dos de datos congelados**
(estructura de costos, inventario). Los tres primeros se construyen ya; los
otros dos merecen una decisión tuya antes de invertir en ellos —está en la
sección 10.

### 2.2 · Dos canales de pago nunca se usan

De los seis canales que el formulario captura, `nequi` y `bono_regalo` suman
**cero pesos en los 413 turnos**, tanto en sistema como en real. No es que
cuadren: es que nunca se usan.

En los tableros ocupan espacio y ensucian la lectura —un canal siempre en cero
parece un fallo del tablero, no un hecho del negocio—. La propuesta es
**ocultarlos automáticamente**: la vista los calcula igual, pero la pantalla
solo pinta los canales con movimiento en el rango consultado. Si mañana empiezan
a usar Nequi, aparece solo con que llegue el primer peso, sin tocar código.

---

## 3 · El criterio de «día completo», explicado

Esta es la parte que quedó confusa. La explico desde el problema, no desde la
fórmula.

### 3.1 · El problema

Un tablero de ventas tiene que responder «¿cuánto vendemos al día?». La
respuesta obvia —sumar las ventas y dividir entre los días— es falsa si en
algunos días falta un cierre.

Hay **25 días con un solo turno**. En unos, ese único turno es toda la verdad:
una sola persona cubrió el día entero, como el domingo 08/03. En otros, alguien
trabajó el turno de la mañana y nunca subió su cierre: el día tuvo dos turnos
pero la base solo conoce uno.

Los dos casos se ven **idénticos** en la base: una fila de turno, una fecha, un
responsable. Nada distingue «solo hubo un turno» de «falta un turno».

Si se meten todos al promedio, el promedio baja sin motivo. Medido hoy:

| Cómo se calcula | Promedio por día |
|---|---:|
| Contando los 218 días | $2 515 454 |
| Contando solo los días completos | $2 650 080 |

**$134 626 al día de diferencia, un 5 % del promedio.** Un tablero que diga
$2 515 454 está mintiendo por defecto, y sobre esa cifra se toman decisiones de
compras y de personal.

### 3.2 · Cómo distinguirlos

Si la base no lo dice, hay que preguntárselo a las ventas. Un día al que le
falta media jornada vende bastante menos que un día igual con la jornada
completa.

Comparo cada día de un solo turno contra **la venta habitual de ese mismo día de
la semana en esa misma sede** —la mediana de los jueves completos, de los
domingos completos, etc.—. El resultado se lee solo:

- Domingo 08/03, un turno, **134 %** de lo que vende un domingo normal. No falta
  nada; vendió más que un domingo con dos turnos.
- Jueves 12/02, un turno, **28 %** de lo que vende un jueves normal. Faltan dos
  tercios del día.

Uso el día de la semana y no el promedio general porque un domingo y un martes
no venden lo mismo; compararlos contra la misma vara marcaría todos los martes
como incompletos.

### 3.3 · Por qué el corte por porcentaje no debe decidir solo

Aquí está la parte débil de lo que te propuse ayer, y prefiero decirla que
defenderla. Los cortes «85 % y 65 %» los elegí yo. No salen de ninguna regla del
negocio, y en la frontera se equivocan.

El caso concreto: el domingo 22/02 vendió el **82 %** de un domingo normal y
cubrió de 08:00 a 22:00, catorce horas. Por las horas está claramente completo;
por el porcentaje cae tres puntos por debajo del corte y quedaría marcado como
dudoso. La fórmula sola se equivoca en ese día.

### 3.4 · Lo que propongo en su lugar

**Que el porcentaje sugiera y una persona decida.** Son 25 días; revisarlos es
trabajo de diez minutos, una sola vez.

Una tabla pequeña, `dias_operacion_estado`, con la sede, la fecha, el estado
(`completo` / `falta_turno`) y quién lo marcó. El tablero de ventas muestra los
días de un solo turno pendientes de revisar, con el porcentaje al lado como
sugerencia y dos botones. Marcado el día, deja de ser una estimación y pasa a
ser un dato.

Ventajas sobre la regla automática:

- No hay números mágicos que nadie pueda justificar.
- Los días de frontera —el 22/02— los resuelve quien conoce la operación.
- Los días futuros con un solo turno entran a una **cola de pendientes**, así que
  el problema se atiende cuando ocurre, no seis meses después.
- Cuando la cola está vacía, el promedio del tablero es exacto, sin asteriscos.

Mientras un día esté sin revisar, el tablero lo cuenta como completo y avisa con
un aviso discreto: «3 días sin revisar; el promedio puede estar subestimado».
Nunca esconde ventas reales.

### 3.5 · Punto de partida de la revisión

Para que no arranque en blanco, la migración deja precargada la sugerencia
calculada hoy sobre los 25 días de un turno:

| Sugerencia | Días | Qué son |
|---|---:|---|
| Completo (≥ 85 % de lo normal) | 2 | Una persona cubrió el día entero |
| Dudoso (65–85 %) | 5 | Hay que mirarlos: aquí está el 22/02 |
| Falta turno (< 65 %) | 18 | Del 28 % al 63 %: falta media jornada |

Ninguno queda marcado en firme por la migración. Los 25 entran a la cola con su
sugerencia, y el estado en firme lo pone un administrador.

---

## 4 · Cimientos comunes · Fase 1

Nada de esto se ve en pantalla, pero los cinco tableros dependen de ello.

### 4.1 · `v_turnos_lineas`

`UNION ALL` de `cierres_turno_final` y `cierres_turno_final_locales`, con una
columna `es_local` y el nombre comercial de la sede resuelto. Sin esta vista,
cada consulta tendría que duplicar la lógica y cualquier tablero que se olvide
de la tabla gemela deja fuera 1 745 filas.

Aplica el `DISTINCT ON` de `gasto_extra` descrito en la sección 1.

### 4.2 · `v_turnos_pivote`

Una fila por turno. Convierte las ~19 filas de cada turno en columnas:

- Los seis canales × dos categorías: `efectivo_sistema`, `efectivo_real`, …
- Los seis descuadres ya restados: `efectivo_dif = efectivo_real − efectivo_sistema`
- `descuadre_total` y el booleano `cuadrado` (`descuadre_total = 0`, en `numeric`,
  sin coma flotante, así que la igualdad es exacta)
- Los globales tomados con `MAX`, nunca con `SUM`: `total_global`,
  `propina_global`, `domicilios_global`, `bolsa_global`, `caja_global`
- `apertura_sistema` y `apertura_real`
- `gastos_turno`, suma de las líneas de `gasto_extra`
- `hora_llegada` y `hora_inicio` normalizadas a `time` (sección 6.3)

**La trampa que más daño haría:** `total_global` se repite idéntico en cada fila
del turno. Sumarlo multiplica la venta por diecinueve. En esta vista se toma con
`MAX` una sola vez y ningún tablero vuelve a tocar la columna cruda.

### 4.3 · `v_dias_operacion`

Una fila por sede y día: número de turnos, venta, la mediana de su día de la
semana, el porcentaje contra esa mediana, el estado revisado si lo hay y la
sugerencia si no. Es la vista que alimenta la cola de la sección 3.4 y la que
usan los promedios diarios de todos los tableros.

### 4.4 · Alcance por sede

Ya está resuelto y no hay que escribir nada nuevo: `app_es_admin()` distingue
administrador de operativo, y `app_empresas_visibles()` devuelve las sedes del
usuario. Los RPC van en `SECURITY INVOKER`, de modo que el RLS que ya existe
sigue aplicando aunque una comprobación fallara.

`dashboard_sedes()` devuelve las sedes que el usuario puede filtrar, para poblar
el selector. Con una sola sede visible, el selector no se pinta.

### 4.5 · Verificación de la fase

- `v_turnos_pivote` devuelve **413 filas**.
- La suma de `total_global` da **$548 369 048**.
- Los 413 turnos tienen apertura: `count(apertura_real) = 413`.
- Un usuario `operativo` recibe **cero filas** de todas las vistas.
- `v_dias_operacion` devuelve **218 días**, de los cuales **25** con un turno.

---

## 5 · Tablero 1 · Conciliación de caja

**La pregunta:** ¿el dinero que reporta la persona coincide con el que registra
Loggro, y si no, dónde y con quién se pierde?

Es el tablero que justifica la plataforma, y va primero.

### 5.1 · Qué es un descuadre, y qué no es

Antes de las cifras, la definición, porque de ella depende que el tablero se
lea bien.

**Un descuadre no tiene nada que ver con que las ventas suban o bajen.** No
compara un día contra otro ni un turno contra otro. Compara **dos medidas del
mismo turno**, tomadas por dos vías distintas, que deberían dar idéntico
resultado.

El propio formulario ya lo hace: la sección «Datos Financieros» tiene tres
columnas —Sistema, Real y **Diferencias**— y calcula la resta en pantalla
mientras la persona llena el cierre. El concepto ya existe en la operación; el
tablero solo lo acumula.

Para el efectivo, tal como lo calcula `js/cierre_turno.js`:

```
sistema = efectivo de apertura + ventas en efectivo según Loggro − gastos extras
real    = bolsa + caja  (el dinero que se contó físicamente)
```

Es un arqueo de caja. Si el turno empezó con $250 000, Loggro registró $800 000
de ventas en efectivo y se pagaron $50 000 de gastos, en la caja tiene que haber
$1 000 000. Si hay $980 000, faltan $20 000. Eso es el descuadre. Que ese día se
vendiera mucho o poco es irrelevante: la resta cuadra igual.

Conviene notar que los gastos **sí** se restan del lado sistema. Lo verifiqué en
el código porque, de no ser así, cada gasto pagado en efectivo aparecería como
un descuadre falso y toda la métrica sería un artefacto.

### 5.2 · Todo descuadre entra al tablero; solo lo imposible se aparta

Corrijo aquí un planteamiento equivocado que hice antes. Propuse tratar las
diferencias pequeñas como ruido que no había que alertar. **Eso está mal.** Un
faltante de $330 es un vuelto mal dado, y un sobrante de $330 es dinero que
alguien cobró y no registró. Las dos cosas pasaron de verdad en el mostrador.
El tablero está para retratar la operación, no para maquillarla, así que
**todas las diferencias se muestran y todas suman**.

Lo que sí cambia es que el tamaño se lea, porque un error de $330 y uno de
$40 000 no son el mismo problema ni se corrigen igual. La distribución del
descuadre de efectivo:

| Diferencia | Turnos | Sobra | Falta | Monto acumulado |
|---|---:|---:|---:|---:|
| Cuadra exacto | 189 | — | — | $0 |
| Hasta $1 000 | 119 | 89 | 30 | **$39 481** |
| $1 000 – $10 000 | 70 | 49 | 21 | $274 381 |
| $10 000 – $50 000 | 31 | 14 | 17 | $676 469 |
| $50 000 – $200 000 | 3 | 2 | 1 | $277 430 |
| Más de $200 000 | **1** | 1 | 0 | **$4 435 945** |

Dos cosas saltan a la vista.

**Los 119 turnos de la segunda fila son calderilla.** Entre los 119 suman
$39 481: unos $330 por turno. Eso no es un error de nadie, es redondeo de
monedas. Contarlos como «turno descuadrado» es lo que hunde el porcentaje.

**Un solo turno concentra el 78 % de todo el descuadre de efectivo.** El del
22 de julio, jornada 2, con `efectivo_sistema = −$4 143 945`. Un efectivo
negativo es imposible por definición, así que no es un descuadre: es un dato
malo. La causa está en el mismo turno: un `gasto_extra` de insumos por
**$4 367 845**, en un día que vendió $2 257 851. Ese único gasto es el 45 % de
todo lo que se ha gastado en insumos en la historia de la base. O es una compra
grande mal clasificada como gasto de turno, o le sobra un dígito.

Recalculado con esto a la vista:

| Criterio | Turnos que cuadran | Porcentaje |
|---|---:|---:|
| Exacto, al peso | 175 | 42,4 % |
| Con margen de $1 000 | 286 | **69,2 %** |
| Con margen de $10 000 | 357 | 86,4 % |

**La tolerancia cero del 22 de agosto se mantiene, y es lo correcto.** Un turno
cuadra o no cuadra. Los tramos de arriba no son umbrales que perdonen nada: son
una forma de leer la misma cifra, igual que en un informe de ventas se separan
los tickets grandes de los pequeños sin dejar de sumarlos todos.

La única excepción es aritmética, no de criterio. **Un valor imposible no es un
descuadre: es un dato roto.** El turno del 22/07 tiene `efectivo_sistema =
−$4 143 945`, y un efectivo negativo no existe en ninguna operación. Meterlo en
un total no retrata la realidad, la borra: ese único turno pesa más que los 237
descuadres legítimos juntos, y arrastraría cualquier promedio, ranking o serie
que lo incluyera.

La regla, entonces, es de dos líneas: **todo descuadre suma; los valores
aritméticamente imposibles se apartan a una lista de corrección** y el tablero
dice en pantalla cuántos hay. No se esconden —se muestran donde se pueden
arreglar, que es lo útil—.

Aplicado al turno completo, los seis canales juntos:

| | Turnos | Bruto | Neto |
|---|---:|---:|---:|
| Cuadran exacto | 175 | $0 | $0 |
| Con diferencia hasta $1 000 | 111 | $36 753 | +$20 049 |
| Con diferencia mayor | 126 | $4 390 823 | +$2 170 241 |
| **Operación medible** | **412** | **$4 427 576** | **+$2 190 290** |
| Apartado por dato roto | 1 | ($4 435 945) | — |

**El titular del tablero es: 237 de 412 turnos cerraron descuadrados (57,5 %),
por $4 427 576.** De ese dinero, sobran $2 190 290 netos. Esa es la operación
real, sin maquillar y sin el dato roto contaminándola.

### 5.3 · Lo que hay que mostrar

**Cuatro tarjetas arriba:**

| Tarjeta | Valor hoy | Cómo se calcula |
|---|---:|---|
| Turnos descuadrados | **237 de 412** (57,5 %) | `count(*) FILTER (WHERE NOT cuadrado)` |
| Descuadre acumulado | **$4 427 576** | `sum(abs(dif))` de los seis canales |
| Sentido | **sobran $2 190 290** | `sum(dif)`: positivo = sobra dinero |
| Datos por corregir | **1** | apartados por valor imposible (5.2) |

La cuarta tarjeta es un enlace, no una cifra muerta: lleva a la lista de turnos
apartados para arreglarlos.

Bruto y neto se muestran juntos a propósito. El bruto mide el desorden; el neto,
hacia dónde se inclina. Que el neto sea positivo significa que en la caja
aparece **más** dinero del que Loggro registró, que es un problema distinto —y
normalmente peor— que si faltara.

**Descuadre por canal**, barras horizontales. Los datos de hoy:

| Canal | Turnos descuadrados | Bruto | Neto |
|---|---:|---:|---:|
| Efectivo | 224 de 413 | $5 703 706 | +$4 520 384 |
| Datáfono | 37 | $1 960 637 | +$1 374 543 |
| Transferencias | 15 | $714 078 | +$246 208 |
| Rappi | 3 | $485 100 | +$485 100 |
| Nequi | 0 | $0 | $0 |
| Bono regalo | 0 | $0 | $0 |

Esta tabla ya dice dónde está el problema: **el efectivo concentra el 64 % del
descuadre y afecta a más de la mitad de los turnos.** Los canales electrónicos
—donde el dinero no pasa por las manos de nadie— casi siempre cuadran. Es
exactamente el patrón que uno esperaría, y es la primera vez que se puede medir.

**Serie diaria del descuadre**, línea, para ver si mejora o empeora. Con
selector de canal, porque la serie del efectivo y la del datáfono cuentan
historias distintas.

**Ranking de responsables**, tabla ordenable. Por decisión del 22 de agosto,
la columna que ordena por defecto es **la frecuencia**, no el monto: quien
descuadra treinta turnos por poco dinero es un problema mayor que quien
descuadró uno por mucho. Columnas: responsable, turnos, turnos descuadrados,
porcentaje, bruto, neto.

**Descuadre de apertura**, tabla. Compara la caja que dejó el turno anterior
contra la apertura que declaró el siguiente. La vista `descuadres_apertura` ya
existe y solo hay que pintarla. Detecta un tipo de fuga que ningún canal
individual revela: dinero que desaparece **entre** dos turnos.

**Distribución por tamaño**, barras. Los tramos de la tabla de 5.2, para
distinguir de un vistazo si el mes se fue en muchos errores chicos —vueltos, y
eso se corrige entrenando— o en pocos grandes, que se corrigen mirando turnos
concretos. Es la lectura que las tarjetas no dan.

**El libro de descuadres**, y esta es la pieza principal del tablero, no el
cierre decorativo. Una tabla plana, una fila por turno descuadrado, ordenada por
fecha descendente:

| Fecha | Jornada | Sede | Responsable | Venta | Efect. | Datáfono | Rappi | Transf. | Total dif. |

Con las diferencias en cada canal, en positivo o negativo, y coloreadas por
signo. Filtros por sede, responsable, jornada, rango de fechas y tramo de
tamaño; ordenable por cualquier columna; enlace al cierre en el histórico; y
descarga a Excel, porque este es el listado que alguien va a querer llevarse
para revisar turno por turno con la persona.

Va aquí y no al final porque es lo que un administrador realmente hace con este
tablero: las gráficas dicen que hay un problema, la lista dice **dónde**. Hoy
tendría 237 filas.

**Los apartados**, tabla corta al final, con los turnos de valor imposible y el
motivo. Hoy tiene una fila. Cuando esté vacía, la sección no se pinta.

### 5.4 · Fuente y forma

`v_turnos_pivote`, filtrada por rango de fechas y sede. Un solo RPC,
`dashboard_conciliacion(p_desde, p_hasta, p_empresa_id)`, devuelve un `jsonb`
con las cuatro tarjetas, el desglose por canal, la serie y el ranking. Una
llamada por carga de pantalla.

### 5.5 · Verificación

- El bruto por canal reproduce la tabla de 5.3 sobre todo el periodo.
- Los tramos de 5.2 suman 413 turnos y $8 863 521 de bruto: ningún turno se
  cuenta dos veces ni se pierde por el camino.
- El libro de descuadres tiene 237 filas y su columna de totales suma
  $4 427 576, igual que la segunda tarjeta.
- El turno del 22/07 aparece en «datos por corregir» y **no** en el ranking de
  responsables.
- Nequi y bono regalo no se pintan (regla de la sección 2.2).
- Filtrando por una sede, los totales de las dos sedes suman el total global.

---

## 6 · Tablero 2 · Ventas y turnos

**La pregunta:** ¿cuánto vendemos, por qué canal, y cómo trabaja cada turno?

### 6.1 · Lo que hay que mostrar

**Tarjetas:** venta del periodo (**$548 369 048** en todo el histórico), venta
media por día completo (**$2 650 080**), venta media por turno, propina
(**$9 858 160**) y domicilios (**$9 188 150**).

La venta media por día usa `v_dias_operacion` y respeta la revisión de la
sección 3. Junto a la cifra, el aviso de días sin revisar cuando los haya.

**Serie de venta diaria**, con media móvil de 7 días encima. La media móvil
importa más que la serie cruda: un negocio de restaurante tiene un ciclo semanal
fuerte y la serie sola parece un electrocardiograma.

**Mix por canal en el tiempo**, área apilada, con los valores `sistema` —que son
lo que Loggro registró, la venta de verdad—. Hoy: datáfono $205 M, Rappi $123 M,
efectivo $118 M, transferencias $84 M. Que Rappi supere al efectivo es un hecho
del negocio que nadie ha visto todavía en una gráfica.

**Venta por día de la semana**, barras. Es la misma vara que usa el criterio de
la sección 3, así que verla explícita ayuda a entender por qué un día se marcó
incompleto.

**Comparativa de jornadas**, barras: mañana contra tarde contra noche, en venta,
número de turnos y venta media. Ahora que `numero_turno` es una columna de
verdad, esta comparación es directa; antes era imposible.

**Turnos por responsable**, tabla: turnos, venta, venta media por turno,
propina. Sin juicios de valor —el ranking de descuadres vive en el tablero 1—.

**Puntualidad.** `hora_llegada` está informada en **401 de 413 turnos**, y
difiere de `hora_inicio` en todos ellos, así que la métrica tiene contenido
real. Muestra el retraso medio por responsable y la distribución.

Con una salvedad técnica que hay que resolver en la vista, no en la pantalla:
`hora_inicio` viene en formato 24 horas (`07:24`) y `hora_llegada` en formato
12 horas con sufijo (`07:24 AM`). Son dos formatos de texto distintos en la
misma tabla. `v_turnos_pivote` los normaliza a `time` una sola vez; si cada
tablero lo hiciera por su cuenta, tarde o temprano uno leería «02:30 PM» como
las dos y media de la madrugada.

### 6.2 · Fuente y forma

`v_turnos_pivote` y `v_dias_operacion`. RPC `dashboard_ventas(p_desde, p_hasta,
p_empresa_id)`. La cola de días por revisar va en un RPC aparte,
`dashboard_dias_pendientes()`, con su pareja de escritura
`marcar_dia_operacion(p_empresa_id, p_fecha, p_estado)`, restringida a
administradores.

### 6.3 · Verificación

- La venta del periodo completo da $548 369 048.
- La suma de las ventas por jornada iguala la venta total.
- Ninguna cifra de venta se obtiene con `SUM(total_global)` sobre líneas: la
  prueba es que el total no sea diecinueve veces mayor de lo esperado.
- Un turno de las 2:30 PM aparece por la tarde, no de madrugada.

---

## 7 · Tablero 3 · Gastos de turno y margen

**La pregunta:** ¿cuánto se gasta durante la operación y qué queda de la venta?

Este tablero se parte en dos partes con destinos distintos, por lo dicho en 2.1.

### 7.1 · Parte viva: los gastos del turno

Los `gasto_extra` llegan con cada cierre y están al día: **$19 548 562** en 412
turnos. Esto se construye ya.

**Tarjetas:** gasto total, gasto medio por turno, y **gasto sobre venta: 3,6 %**,
que es la métrica de rentabilidad operativa que hoy nadie mira.

**Gasto por categoría**, barras. Los datos de hoy:

| Categoría | Turnos | Monto |
|---|---:|---:|
| Insumos | 412 | $9 755 562 |
| Domicilios a clientes | 411 | $7 057 150 |
| Domicilios operativos | 410 | $2 040 500 |
| Aseo | 303 | $395 450 |
| General | 295 | $174 900 |
| Insumos especiales | 114 | $108 200 |

**Evolución mensual del gasto sobre venta**, línea. Un porcentaje que sube mes a
mes es la señal temprana de que algo se está descontrolando, y se ve antes en el
porcentaje que en el monto.

**Domicilios: coste contra cobrado.** `domicilios_global` es lo que se cobró al
cliente; la categoría `domicilios_clientes` es lo que costó. Hoy: $9 188 150
cobrados contra $7 057 150 de coste. El margen del domicilio, medido por primera
vez.

**Una limpieza previa que hay que hacer.** Hay dos categorías con una sola fila
cada una, `operativo` ($8 900) y `cliente` ($7 900), que casi con seguridad son
`domicilios_operativos` y `domicilios_clientes` mal escritas. Y `arriendo` (6
filas) y `desechables` (63) suman cero pesos: son categorías que el formulario
ofrece y nadie usa. Antes de pintar la gráfica conviene corregir las dos
primeras y decidir si las otras dos siguen en el formulario. Son cuatro filas de
SQL y evitan una leyenda con seis categorías vacías.

### 7.2 · Parte congelada: la estructura de costos

`gastos_costos` tiene nómina, arriendo, luz, marketing y administrativos: es lo
que faltaría para pasar del margen operativo al margen real. Pero está congelada
en el 6 de junio y **ningún archivo del proyecto escribe en ella**.

Construir un tablero sobre esto sería pintar marzo–junio para siempre. Antes hay
que decidir quién la alimenta, y esa es una decisión tuya: está en la sección 10.

Si se decide alimentarla, el tablero añade: gasto por tipo con evolución
mensual, margen real sobre venta, y peso de la nómina sobre la venta. Si no, la
parte 7.1 se entrega sola y este tablero se queda en «gastos de turno», sin la
palabra margen en el título.

### 7.3 · Verificación

- El gasto total da $19 548 562 y el gasto sobre venta 3,6 %.
- La suma por categorías iguala el total.
- Ningún turno aporta dos filas de la misma categoría (el `DISTINCT ON` de 4.1).

---

## 8 · Tablero 4 · Inventario y mermas

**La pregunta:** ¿qué producto se pierde y con quién?

441 registros, 39 productos, 35 con inconsistencia (7,9 %). Los faltantes se
concentran en pocos productos: Red Velvet & Chocolate Cookie (10), Rúgula (10),
Vaso Gold 22 oz (9).

**Contenido:** porcentaje de cierres con inconsistencia y su tendencia,
productos que más se pierden, inconsistencias por responsable, y la lista de
cierres con faltante.

**Dos limitaciones, y hay que decirlas antes de construirlo:**

La primera es de datos: no hay costo unitario por producto en la base, así que
la merma se expresa en unidades. «Diez Red Velvet» no se puede convertir en
pesos, y en pesos es como se decide si vale la pena hacer algo. Añadir un costo
por producto es una decisión de negocio con trabajo de carga detrás, no un
cambio técnico.

La segunda es de vigencia: **la última fila es del 16 de mayo.** El tablero
retrataría un trimestre que ya pasó. La tubería funciona —la Edge Function se
migró ayer y está viva—, así que basta con que se retomen los cierres de
inventario para que el tablero cobre sentido. Mientras tanto, construirlo es
trabajo que no se mira.

Por eso va el último, y solo si decides retomar los cierres de inventario.

---

## 9 · Tablero 5 · Plataforma (solo superadmin)

**La pregunta:** ¿cómo va el negocio de la plataforma?

Empresas por plan, ciclos de facturación, pagos pendientes de revisión y
empresas en mora. Fuente: `billing_cycles` (19 filas), `payment_attempts`,
`empresas`.

Es el único tablero que no mira la operación de un restaurante sino la salud
comercial de la plataforma, y el único restringido a superadmin. Va después de
los tres vivos porque con 19 ciclos de facturación aporta poco todavía, pero es
barato: no necesita vistas nuevas.

---

## 10 · Lo que decido yo y lo que solo puedes saber tú

### 10.1 · Decidido, no hace falta que contestes

**Todo descuadre entra al tablero, con tolerancia cero.** Sección 5.2. No hay
umbral que perdone diferencias pequeñas; los tramos por tamaño son una forma de
leer, no de filtrar.

**Los valores imposibles se apartan.** Solo lo aritméticamente imposible —un
efectivo de sistema negativo—, y a una lista visible de corrección, no a la
basura.

**Los días de un solo turno van a una cola de revisión.** Sección 3.4. El
porcentaje sugiere, un administrador confirma. Es lo que evita inventar un
criterio que la operación no tiene.

**El orden es conciliación, ventas y gastos de turno.** Conciliación primero
porque responde la pregunta que la plataforma promete responder, y porque el
57,5 % de turnos descuadrados dice que hay algo que mirar hoy.

**El libro de descuadres es la pieza central del tablero 1**, no un anexo.

### 10.2 · Lo que necesito de ti

Tres cosas, y ninguna la puedo sacar de la base porque no están ahí.

**1 · La estructura de costos (`gastos_costos`).** Nadie la alimenta. Tres
salidas: (a) un módulo para cargarla desde la plataforma, (b) traerla de Loggro
con una Edge Function como se hizo con ventas y gastos, o (c) dejarla fuera y
que el tablero 3 sea solo de gastos de turno. Sin esto no hay margen real, solo
margen operativo.

**2 · Los cierres de inventario.** Llevan tres meses parados. ¿Se van a retomar?
Si sí, el tablero 4 se construye y espera datos. Si no, no lo construyo.

**3 · El gasto del 22 de julio.** Ese `gasto_extra` de insumos por $4 367 845 en
un día que vendió $2 257 851 ¿es una compra grande mal clasificada como gasto de
turno, o le sobra un dígito? Es lo único que no puedo deducir. Mientras no se
resuelva, el turno queda en la lista de apartados y el tablero funciona igual.

---

## 11 · Orden de entrega propuesto

| # | Fase | Contenido | Depende de |
|---|---|---|---|
| 1 | Cimientos | `v_turnos_lineas`, `v_turnos_pivote`, `v_dias_operacion`, `dashboard_sedes()`, tabla de revisión de días | — |
| 2 | Conciliación | Tablero 1 completo | 1 |
| 3 | Ventas y turnos | Tablero 2 y la cola de días por revisar | 1 |
| 4 | Gastos de turno | Tablero 3 parte 7.1, más la limpieza de categorías | 1 |
| 5 | Estructura de costos | Tablero 3 parte 7.2 | Decisión 10.2 · 1 |
| 6 | Inventario | Tablero 4 | Decisión 10.2 · 2 |
| 7 | Plataforma | Tablero 5, solo superadmin | 1 |

La fase 1 es obligatoria antes que cualquier otra. De la 2 a la 4 pueden
reordenarse. Las fases 5 y 6 dependen de decisiones, no de código.

**Frontend:** `dashboard/index.html` y `js/dashboard.js`, que hoy está vacío
tras la limpieza de webhooks. Una pantalla con pestañas, una por tablero, para
no multiplicar archivos ni entradas de menú. Gráficas con Chart.js por CDN,
igual que ya se cargan los iconos Phosphor desde unpkg: sin build, coherente con
el resto del proyecto. Los CSS y JS se enlazan con `?v=` desde el primer día
—los assets del proyecto no se versionan y eso ya ha costado tiempo antes—.

**Permisos:** el módulo ya existe en el menú y en los mapas de permisos. Solo hay
que restringirlo a administradores, con las tres capas de siempre: comprobación
en el RPC, RLS por debajo y ocultación en el router.

---

## 12 · Lo que sigue sin poder hacerse

Conviene decirlo para que nadie lo espere:

- **Tablero de nómina.** Tres registros en `historico_nomina`. Se puede construir
  cuando haya uso real.
- **Merma en pesos.** Falta el costo unitario por producto.
- **Margen por plato.** No existe la relación venta-producto en la base. Loggro
  la tiene, pero habría que traerla.
- **Comparativa entre empresas.** Solo hay una empresa madre y su local
  registrando turnos. Los tableros se diseñan para que la comparativa aparezca
  sola cuando haya una segunda, pero hoy no hay nada que comparar.

---

## 13 · Notas para quien ejecute este plan

Cosas del entorno que no se deducen leyendo el código y que han costado tiempo
antes. Van aquí porque la ejecución puede hacerla otra persona u otro modelo.

**Sobre qué base se trabaja.** Todo esto va contra la copia «Enkrato Google»
(`tgkvcvnwwnrlyhbqmhaf`), **nunca contra producción**. Se permite DDL aditivo
sobre la copia; no se toca la base de producción.

**Cuidado con publicar.** El `config.js` publicado apunta a producción y el de
trabajo apunta a la copia. **Un push a GitHub Pages cambiaría de base a los
clientes reales.** No publicar sin revisar ese archivo.

**Cómo consultar la base.** El conector MCP de Supabase no está autorizado en
este entorno. Lo que sí funciona:

```
supabase db query --linked --file <archivo.sql>
supabase db push  --linked --yes
```

La salida del `query` es JSON muy verboso; conviene pasarla por un formateador.

**Convención de migraciones.** `supabase/migrations/AAAAMMDDHHMMSS_fase_N_asunto.sql`.
Las últimas aplicadas llegan hasta `20260823150000_fase_10_...`; las de tableros
siguen desde ahí. **Cada migración cierra con un bloque de aserciones**
(`DO $$ ... RAISE EXCEPTION`) que compara el resultado contra lo esperado. No es
adorno: en la Fase 6 una aserción abortó un push que habría borrado 168
combinaciones de datos por una división entera mal puesta. Mantener el patrón.

**Los assets no se versionan solos.** Los `<link>` y `<script>` del proyecto se
enlazan sin `?v=`, así que el navegador sirve la versión vieja y el arreglo
parece no aplicarse. Todo CSS/JS nuevo o modificado lleva `?v=AAAAMMDD` desde el
primer día, y tras tocar `js/header.js` hay que avisar de un Ctrl+F5.

**Respaldos vivos.** Las tablas `zz_backup_20260823_*` guardan el estado previo
a la depuración. Se pueden borrar cuando la depuración esté aceptada; hasta
entonces, son la red de seguridad para cualquier reconciliación.

**Permisos.** No hay que inventar nada: `app_es_admin()` y
`app_empresas_visibles()` ya existen y funcionan. Los RPC de tableros van en
`SECURITY INVOKER` para que el RLS del usuario siga aplicando.

**Contexto previo.** La depuración que dejó la base en el estado descrito aquí
está documentada en `2026-08-23_ejecucion_depuracion_turnos_y_auditoria.md`, y
el plan original de tableros en `2026-08-22_plan_sistema_dashboards.md`, cuyas
secciones 2, 3, 5, 6 y 10 quedan sustituidas por este documento.

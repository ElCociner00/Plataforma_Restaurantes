# Auditoría de duplicados y anatomía de la brecha del 3,4 %

**Fecha:** 2026-08-23 · **Base:** copia «Enkrato Google»
**Estado:** auditoría en solo lectura. Después se aplicaron dos arreglos
aprobados (fase 16) — ver «Estado tras aplicar» abajo.

---

## Estado tras aplicar (migración `20260823210000_fase_16`)

Aprobados y aplicados. Ningún registro alterado, solo `CREATE OR REPLACE VIEW`:

| Arreglo | Antes | Después |
|---|---|---|
| `DISTINCT ON` deja pasar los gastos | 1.893 líneas · 19.498.162 | **2.016 líneas · 19.548.562** |
| H1: valor más reciente en vez de `MAX` | 2026-06-10 T1 = 1.185.400 | **1.155.900** |

Efecto en el contraste mensual: seis de los siete meses siguen en diferencia
cero. **Junio pasa a −29.500** frente a `turnos_agrupados`, y es lo correcto: el
pivote ya toma el total corregido y es esa tabla la que conserva el valor
obsoleto. Queda anotado que la ruta de escritura de `turnos_agrupados` arrastra
el mismo defecto.

Sin tocar, por decisión de Andrés: el turno del 2026-07-22 (C1) y el del
2026-05-18, que se resuelven desde el Libro de Descuadres. La dona sigue
pendiente de decisión.

---

## Resumen

| Pregunta | Respuesta |
|---|---|
| ¿Quedan turnos duplicados por mover al histórico? | **No. Cero.** Y ya no pueden reaparecer. |
| ¿Queda algo pendiente de auditar? | **Un turno** con el envío incompleto: 2026-05-18 T2 |
| ¿De dónde sale la brecha del 3,4 %? | **No es venta faltante:** son los gastos del turno, ya descontados del efectivo (76 %), más un dato corrupto (24 %) |
| ¿Se están perdiendo datos? | **Sí, pero no los que buscábamos:** la vista descarta 123 líneas de gasto legítimas |

Y un hallazgo que no esperaba: **el descuadre de julio está inflado 80 veces**
por un solo valor imposible. Detalle en C1.

---

# Parte 1 · Auditoría de duplicados

## 1.1 · No queda ninguno

Apliqué el **mismo criterio** de la fase 6, sin cambiarle una coma: contar las
filas por `(variable, categoría)` de los seis canales, excluyendo `gasto_extra`
y `efectivo_apertura`; es duplicado si `max(n) > 1` y `min(n) = max(n)`.

**Resultado: 0 turnos**, en las dos tablas.

## 1.2 · Y ya no pueden volver a aparecer

No es que estén limpios por ahora: la fase 9 dejó un **índice único** en las dos
tablas sobre `(empresa_id, fecha_turno, numero_turno, variable, categoria)`, y
comprobé que **ambos están válidos**. Postgres rechaza el segundo envío antes de
insertarlo. El problema está cerrado a nivel de base, no de código.

## 1.3 · Estado del histórico

3.728 filas en 138 lotes:

| Motivo | Lotes | Filas |
|---|---:|---:|
| `DUP_EXACTO` | 83 | 2.629 |
| `DATOS_PRUEBA` | 37 | 712 |
| `DUP_CORREGIDO` | 10 | 268 |
| `DUP_JORNADA` | 6 | 116 |
| `ENVIO_TRUNCADO` | 1 | 2 |
| `FILA_HUERFANA` | 1 | 1 |

## 1.4 · Lo único pendiente: un turno incompleto

Barrí las dos tablas buscando turnos que no tuvieran los 6 canales con sus
líneas `sistema` y `real`. Aparece **uno solo**:

**2026-05-18, turno 2, sede principal** — tiene 4 canales de 6, con 4 líneas
`sistema` y 4 `real` en vez de 6 y 6.

La fase 6 había anotado dos casos así (18/05 T2 y 19/08 T2). **El de agosto ya
está completo**: 6 canales, 12 líneas. La fase 8 lo resolvió. Queda el de mayo.

No es un duplicado, así que no va al histórico: es un envío que se cortó y le
faltan datos. Aparece otra vez en la Parte 2 como el residuo más grande de toda
la base.

## 1.5 · Hallazgo nuevo: la vista descarta 123 líneas de gasto

Al revisar las repeticiones encontré 123 líneas repetidas sobre 7.802. Fui a
ver si eran duplicados que se escaparon, y son otra cosa: **todas son
`gasto_extra`**, en 80 grupos.

Y son **legítimas**. Un turno puede tener dos gastos de insumos en la misma
categoría, y la base lo permite a propósito: el índice único es **parcial**,
lleva `WHERE variable <> 'gasto_extra'` justamente para no bloquearlas.

El problema es que `v_turnos_lineas` sí las deduplica:

```sql
SELECT DISTINCT ON (empresa_id, fecha_turno, numero_turno, variable, categoria) *
```

Ese `DISTINCT ON` no distingue: para los canales es correcto, para los gastos
borra los legítimos. Medido:

| | En las tablas | Lo que ve la vista | Se pierde |
|---|---:|---:|---:|
| Filas de `gasto_extra` | 2.016 | 1.893 | **123** |
| Suma de gastos | 19.548.562 | 19.498.162 | **50.400** |

**Impacto hoy: ninguno en lo que ya verificamos.** Ni `dashboard_conciliacion`
ni `dashboard_ventas` usan las columnas de gasto, así que las ventas y el
descuadre que cuadraron al peso siguen bien. Pero la pestaña «Gastos de Turno»
nacería con un 0,26 % de menos, y `gastos_turno` ya está expuesto en el pivote
para quien lo use.

**Arreglo:** que el `DISTINCT ON` no toque `gasto_extra` — deduplicar solo las
filas de canal y traer las de gasto tal cual.

---

# Parte 2 · Anatomía de la brecha del 3,4 %

La brecha total es **18.400.843** sobre 548.369.048. Se descompone en tres, y
solo una parte es suciedad.

Dato previo que orienta todo: de 413 turnos, en **315 el total declarado es
mayor** que la suma de canales, en 98 son iguales y **en ninguno es menor**. Una
brecha que nunca cambia de signo no es ruido: es un ajuste sistemático. Resultó
ser el descuento de gastos sobre el efectivo (C2).

## C1 · Un solo dato corrupto — 4.495.945 (24,4 % de la brecha)

**2026-07-22, turno 2, sede principal:**

| | Valor |
|---|---:|
| `efectivo` categoría `sistema` | **−4.143.945** |
| `efectivo` categoría `real` | 292.000 |

Un efectivo negativo de cuatro millones no existe. Es el único turno de los 413
con algún canal negativo.

### Lo grave no es la brecha, es lo que le hace a Conciliación

Ese valor entra en `efectivo_dif = real − sistema`, así que produce un descuadre
falso de +4.435.945:

| Julio 2026 | Descuadre total | Diferencia de efectivo | Turnos descuadrados |
|---|---:|---:|---:|
| Como se ve hoy | **4.380.908** | 4.452.756 | 37 |
| Sin ese turno | **−55.037** | 16.811 | 36 |

**El tablero está diciendo que julio tuvo 4,4 millones de descuadre cuando en
realidad estuvo prácticamente cuadrado.** El 99 % de esa cifra sale de un solo
registro corrupto. Esto no lo introdujeron los arreglos del dashboard: el dato
lleva ahí desde el 23 de julio.

Nota: las **ventas** de julio no están afectadas, porque `total_ventas` sale de
`total_global` y no de los canales. El daño está en Conciliación y en la dona de
canales, donde el efectivo aparece 4,1 millones por debajo.

## C2 y C3 · CORRECCIÓN — no es venta faltante, son los gastos del turno

> Mi lectura anterior de este apartado era **incorrecta**. Escribí que los
> domicilios eran venta y que excluirlos sería un error. Andrés corrigió que los
> domicilios son un gasto, y al verificarlo en el código la explicación resultó
> ser otra y mejor.

### El mecanismo

En `js/cierre_turno.js`, el efectivo que se guarda como `sistema` puede ir en
dos modos, y el neto es el que descuenta los gastos:

```js
getEfectivoSistemaBruto() = efectivo_apertura + efectivo_de_Loggro
getEfectivoSistemaNeto()  = getEfectivoSistemaBruto() - getTotalGastosExtras()
```

Es decir: **el efectivo almacenado ya viene descontado de los gastos pagados de
la caja durante el turno.** `total_global` es la venta bruta que reporta el
sistema. La suma de canales queda corta exactamente por los gastos.

La brecha no es dinero que falte ni venta sin registrar: **es el gasto del
turno, ya restado del efectivo.**

### La prueba

| Fórmula | Turnos que cuadran exacto | Residuo sobre 548 M |
|---|---:|---:|
| **`total = canales + gastos del turno`** | **366 de 412 (89 %)** | **−1.147.719 (−0,2 %)** |
| `total = canales + domicilios` | 240 de 412 (58 %) | 4.770.748 |
| `total = canales` | 98 de 412 | 13.904.898 |

Domicilios cuadraba en más de la mitad de los turnos solo porque es el gasto más
grande: 9,1 M de los 19,5 M totales. Era una correlación, no la causa.

Con la fórmula correcta el residuo cae a **−0,2 %** y encima cambia de signo, que
es lo que se espera de un ajuste bien identificado. Los 46 turnos que no cuadran
son candidatos a haberse guardado en modo «bruto», donde no hay descuento.

### Consecuencia para la dona

Añadir domicilios a la dona —lo que propuse antes— **habría sido un error**: son
gastos, no un medio de pago.

Lo correcto es al revés: la porción de efectivo de la dona está **artificialmente
baja** porque lleva los gastos ya restados. Se arregla mostrando el efectivo
bruto, que es derivable sin datos nuevos:

```
efectivo_bruto = efectivo_sistema + gastos_turno
```

Con eso la dona suma la cifra de «Ventas Totales» y deja de parecer un
descuadre, sin inventar ninguna categoría.

# Parte 3 · Qué corregir y qué no

Respondiendo directo a tu pregunta de si son datos sucios que no debemos meter
en las gráficas:

| Componente | ¿Sucio? | Qué hacer |
|---|---|---|
| **C1** · efectivo −4.143.945 | **Sí, inequívoco** | Corregir o archivar. Hoy está falseando el descuadre de julio 80 veces. |
| **C2/C3** · gastos del turno 13,9 M | **No** | No es venta faltante: es gasto ya descontado del efectivo. Se arregla mostrando el efectivo bruto en la dona. |
| 2026-05-18 T2 incompleto | Incompleto, no sucio | Decidir: completar el envío o archivarlo como `ENVIO_TRUNCADO`, igual que se hizo con el de agosto. |
| 123 líneas de gasto | **No, se están perdiendo** | Arreglar el `DISTINCT ON` de la vista. |

Lo importante: **de los 18,4 millones de brecha, solo 4,5 son basura.** Los
otros 13,9 son los gastos del turno, ya descontados del efectivo por diseño. No
hay nada que excluir de las gráficas: hay que mostrar el efectivo bruto para que
la dona cuadre con el total.

---

# Parte 4 · Decisiones que necesito

Ordenadas por lo que más pesa:

1. **C1 — el turno del 2026-07-22.** Es lo más urgente: hoy Conciliación miente
   sobre julio. ¿Lo archivo al histórico con un motivo nuevo tipo
   `VALOR_IMPOSIBLE`, o prefieres corregir el valor a mano si sabes cuál era el
   efectivo real?
2. **Las 123 líneas de gasto.** ¿Arreglo el `DISTINCT ON` para que no toque
   `gasto_extra`? Es `CREATE OR REPLACE VIEW`, no mueve datos.
3. **2026-05-18 T2.** ¿Se completa o se archiva como truncado?
4. **La dona.** ¿Cambio la porción de efectivo por `efectivo_sistema +
   gastos_turno` (el bruto)? Con eso suma el total sin inventar categorías.
   Quedan 46 turnos que no siguen la fórmula y habría que mirarlos aparte.
5. **H1 del informe anterior** (`MAX(total_global)` en vez del valor más
   reciente) sigue pendiente. Conviene hacerlo en la misma pasada que el punto
   2, porque es la misma vista.

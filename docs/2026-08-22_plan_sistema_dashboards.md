# Plan · Sistema de dashboards e integridad de turnos

**Fecha:** 2026-08-22 · **Base:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`) · **Estado:** propuesta, sin ejecutar

Dos trabajos que resultaron ser el mismo: construir los tableros (secciones
1-11), arreglar la causa de los turnos duplicados que esos tableros
destaparon (sección 12) y cerrar el agujero del efectivo entre turnos
(sección 13). Todas las cifras salen de contar el dump real, no
son estimaciones.

---

## 1 · Qué datos hay realmente

| Tabla | Filas | Periodo cubierto | Sirve para |
|---|---:|---|---|
| `cierres_turno_final` | 8 917 | 2026-02-12 → 2026-08-21 | Conciliación, ventas, gastos de turno |
| `cierres_turno_final_locales` | 1 701 | mismo | Lo mismo, para locales |
| `gastos_costos` | 1 323 | 2026-03-05 → 2026-06-06 | Estructura de costos |
| `cierres_inventario` | 441 | 2026-02-12 → 2026-05-16 | Mermas e inconsistencias |
| `apoyos_turno` (+41 locales) | 99 | — | Horas de apoyo y propina |
| `billing_cycles` | 19 | — | Salud comercial (superadmin) |
| `historico_nomina` | 3 | — | **Insuficiente** |

Esas 8 917 filas de `cierres_turno_final` son **350 turnos** de **2 empresas**.
La tabla no guarda un turno por fila: guarda una fila por *variable* medida.

### 1.1 · La estructura que manda sobre todo el diseño

`cierres_turno_final` es un modelo entidad-valor. Cada turno produce ~25 filas:

| `variable` | Filas | `categoria` |
|---|---:|---|
| `gasto_extra` | 2 775 | general, insumos, domicilios_clientes, domicilios_operativos, aseo, desechables, insumos_especiales, arriendo |
| `efectivo` | 1 024 | `sistema` / `real` |
| `datafono` | 1 022 | `sistema` / `real` |
| `rappi` | 1 022 | `sistema` / `real` |
| `nequi` | 1 022 | `sistema` / `real` |
| `transferencias` | 1 020 | `sistema` / `real` |
| `bono_regalo` | 1 020 | `sistema` / `real` |

**Aquí está el valor.** Cada canal se registra dos veces: lo que dice Loggro
(`sistema`) y lo que reporta la persona del turno (`real`). La resta entre esas
dos cifras es el descuadre de caja, que es exactamente el problema que la
plataforma existe para resolver. 3 065 pares listos para comparar.

### 1.2 · Estructura de costos, ya medida

De `gastos_costos`, montos reales del periodo marzo–junio:

| Tipo de gasto | Registros | Monto |
|---|---:|---:|
| Nómina | 52 | $31 907 826 |
| Administrativos | 22 | $15 795 041 |
| Arriendo | 4 | $11 372 121 |
| Insumos (no proteínas, no desechables) | 160 | $11 017 324 |
| Marketing | 5 | $6 800 000 |
| Domicilios a clientes | 878 | $5 225 616 |
| Luz | 4 | $4 672 722 |
| Plásticos y desechables | 6 | $2 045 934 |

Los 878 registros de domicilios son el detalle más fino que hay: permiten
coste por domicilio y compararlo con lo cobrado.

### 1.3 · Inventario

441 registros, 39 productos, **35 con inconsistencia (7,9 %)**. La tabla marca
`Inconsistencia`, `Cantidad Faltante` y `Responsable Inconsistencia`.
Los faltantes se concentran: *Red Velvet & Chocolate Cookie* (10),
*Rúgula* (10), *Vaso Gold 22 oz* (9).

---

## 2 · Los tableros

### Tablero 1 · Conciliación de caja — **el que justifica el módulo**

- Descuadre neto del periodo: Σ(`real` − `sistema`), total y por canal
- Porcentaje de turnos que cierran descuadrados
- Serie diaria del descuadre, para ver si mejora o empeora
- Ranking de responsables por descuadre acumulado y por frecuencia
- Lista de turnos fuera de un umbral configurable, con enlace al cierre

Fuente: `cierres_turno_final`, 3 065 pares sistema/real.

### Tablero 2 · Ventas y turnos

- Venta por día y por semana (`total_global`)
- Mix por canal, y cómo se mueve en el tiempo
- Propina y domicilios (`propina_global`, `domicilios_global`)
- Puntualidad: `hora_llegada` contra `hora_inicio`
- Turnos por responsable

### Tablero 3 · Gastos y margen operativo

- Gasto por tipo, con evolución mensual
- Gastos extra del turno por categoría (2 775 registros)
- Gasto sobre venta, en porcentaje — la métrica de rentabilidad
- Domicilios: coste contra lo cobrado

### Tablero 4 · Inventario y mermas

- Porcentaje de cierres con inconsistencia, y su tendencia
- Productos que más se pierden
- Inconsistencias por responsable
- **Limitación:** no hay costo unitario en la base, así que la merma se
  expresa en unidades, no en pesos. Añadir un costo por producto es una
  decisión de negocio, no técnica.

### Tablero 5 · Plataforma (solo superadmin)

Empresas por plan, ciclos de facturación, pagos pendientes de revisión y
empresas en mora. Fuente: `billing_cycles`, `payment_attempts`, `empresas`.

---

## 3 · Arquitectura

**No hacen falta Edge Functions.** Los datos ya viven en Supabase y no hay que
llamar a ningún sistema externo: bastan vistas SQL, RPC y el RLS que ya existe.
Menos piezas que mantener y una fuente de verdad menos.

Tres capas:

1. **Vistas de unificación** — `v_turnos_unificado` y `v_apoyos_unificado`,
   que hacen `UNION ALL` de las tablas base y sus gemelas `_locales`, añadiendo
   una columna `es_local`. Sin esto, cada consulta del dashboard tendría que
   duplicar la lógica.
2. **Vista de pivote** — `v_turnos_pivote`, que convierte las ~25 filas de cada
   turno en una sola fila con columnas `efectivo_sistema`, `efectivo_real`,
   `datafono_sistema`… y los seis descuadres ya calculados.
3. **RPC por tablero** — `dashboard_conciliacion(p_desde, p_hasta, p_empresa_id)`
   y sus hermanas, en `SECURITY INVOKER` para que el RLS del usuario siga
   aplicando. Devuelven `jsonb` listo para pintar.

Con 8 917 filas no hace falta materializar nada. Si el volumen creciera diez
veces, la vista de pivote sería la primera candidata a vista materializada con
refresco por `pg_cron`.

**Frontend:** `js/dashboard.js`, que hoy está vacío tras la limpieza de
webhooks. Gráficas con Chart.js por CDN, igual que ya se cargan los iconos
Phosphor desde unpkg. Sin build, coherente con el resto del proyecto.

---

## 4 · Permisos

Lo pedido —solo `admin` y `admin_root`— **ya está resuelto**: la función
`app_es_admin()` de la Fase A devuelve verdadero para `admin_root`, `admin` y
superadmin, y falso para el resto.

Hoy hay 20 usuarios: 13 `operativo`, 6 `admin_root`, 1 `admin`. Es decir, 13 de
20 no deben ver nada de esto.

Tres capas de defensa, en este orden:

1. **RPC**: primera línea de cada función, `IF NOT public.app_es_admin() THEN RAISE`.
2. **RLS**: los RPC van en `SECURITY INVOKER`, así que aunque la comprobación
   fallara, el usuario solo vería las filas de su propia empresa.
3. **Frontend**: el router esconde el enlace y redirige si un operativo entra
   por URL. Es comodidad, no seguridad — la seguridad son las dos capas de
   arriba.

---

## 5 · Trampas del modelo de datos

Cinco cosas que romperían las cifras si se pasan por alto:

1. **`total_global` se repite en cada fila del turno.** Sumarlo multiplica la
   venta por 25. Hay que tomar `MAX` por turno, nunca `SUM`. Vale igual para
   `propina_global`, `bolsa_global`, `caja_global`, `efectivo_apertura` y
   `domicilios_global`.
2. **Un turno se identifica por** `(empresa_id, fecha_turno, hora_inicio, responsable_id)`.
   No hay columna de turno; esa combinación es la clave real.
3. **Las tablas `_locales` son un universo paralelo.** Un dashboard que consulte
   solo la tabla base deja fuera 1 701 filas.
4. **Los periodos no coinciden.** Turnos llegan hasta agosto, gastos hasta
   junio, inventario hasta mayo. Cualquier gráfica que cruce las tres fuentes
   debe declarar el rango efectivo o mostrará caídas a cero que no son reales.
5. **`gastos_costos` solo tiene datos de un local**, BATUT SIPS AND BITES BAR.
   Comparar locales por gasto no es posible todavía.

---

## 6 · Fases de entrega

| # | Fase | Contenido | Depende de |
|---|---|---|---|
| 1 | Cimientos | Las tres vistas, el RPC de permisos, migración y verificación | — |
| 2 | Conciliación | Tablero 1 completo, con su RPC y su pantalla | 1 |
| 3 | Ventas y turnos | Tablero 2 | 1 |
| 4 | Gastos y margen | Tablero 3 | 1 |
| 5 | Inventario | Tablero 4 | 1 |
| 6 | Plataforma | Tablero 5, solo superadmin | 1 |

La fase 1 es la única obligatoria antes que las demás; de la 2 a la 6 pueden
reordenarse según lo que resulte más útil. La 2 va primero porque es la que
contesta la pregunta que la plataforma promete responder.

Cada fase se cierra con su documento en `docs/`, según la regla del proyecto.

---

## 7 · Lo que todavía no se puede hacer

Conviene decirlo antes de empezar, para que nadie lo espere:

- **Dashboard de nómina.** Solo hay 3 registros en `historico_nomina`. Se puede
  construir cuando se acumule uso real.
- **Merma en pesos.** Falta el costo unitario por producto.
- **Margen por producto o por plato.** No existe la relación venta-producto en
  la base; Loggro la tiene, pero habría que traerla.
- **Comparativa entre empresas.** Solo 2 de las 6 empresas registran turnos.

---

## 8 · Decisiones tomadas (2026-08-22)

### 8.1 · Tolerancia cero al descuadre

**Un descuadre es toda resta distinta de cero.** Si la caja da −1 o +1, el turno
está descuadrado. Todo debe cuadrar al final.

Consecuencias sobre el diseño:

- No hay umbral configurable ni parámetro de tolerancia. Un turno cuadra o no.
- La métrica principal del tablero 1 pasa a ser **el porcentaje de turnos que
  cuadran**, no el monto promedio de desviación.
- El ranking de responsables pesa más por **frecuencia** que por monto: alguien
  que descuadra 30 turnos por poco dinero es un problema mayor que quien
  descuadró uno solo por mucho.
- La comparación se hace en `numeric`, no en coma flotante, así que `= 0` es
  exacto y no hay falsos positivos por redondeo.

### 8.2 · Filtro por sede

El administrador puede **filtrar por sede o verlas juntas**, pero solo las suyas.
La regla de alcance, pensada para cuando haya muchas empresas registradas:

| Quién | Qué sedes ve |
|---|---|
| Superadmin | Todas |
| Admin de empresa madre | La madre y todos sus locales |
| Admin de un local | Solo su local |
| Operativo | Ninguna: no entra al módulo |

Nota: `app_empresas_visibles()` (Fase A) le da a un local acceso también a sus
**hermanos**. Para los tableros se usa un alcance más estricto —un local ve solo
lo suyo— porque aquí se cruzan cifras de dinero. Si se prefiere lo contrario, es
un cambio de una línea en `app_sedes_dashboard()`.

---

## 9 · Hallazgo que obliga a deduplicar

Al validar la clave del turno apareció un problema de datos que habría falseado
todos los tableros.

**La clave del turno** es `(empresa_id, fecha_turno, hora_inicio, responsable_id)`
y da 356 turnos. Pero esa combinación **no es única por variable**: hay grupos
con 2, 3, y hasta 16 filas de la misma variable y categoría.

| Medida | Valor |
|---|---:|
| Turnos con filas repetidas | **85 de 356 (24 %)** |
| Grupos afectados | 1 010 |
| Repeticiones con el mismo valor | 989 (97 %) |
| Repeticiones con valor distinto | 21 |
| `total_global` inconsistente dentro del turno | 3 turnos |

**El impacto de no tratarlo**, medido sobre `efectivo` / `sistema`:

| Cálculo | Resultado |
|---|---:|
| Sumando todas las filas | $133 003 949 |
| Quedándose con el último registro | $92 025 571 |
| **Inflación** | **$40 978 378 (45 % de más)** |

### 9.1 · Por qué no se pueden separar los envíos por tiempo

Las filas repetidas **no forman lotes distinguibles**. En un turno de ejemplo,
sus 51 filas entraron entre las 19:37:02 y las 19:37:11, segundo a segundo y sin
ningún hueco. Es la huella del flujo n8n `subir_cierre.txt`, que insertaba fila a
fila dentro de bucles `splitInBatches`. No hay forma de decir «esto es el segundo
envío» mirando solo la marca de tiempo.

### 9.2 · Regla adoptada

- **Canales y globales** (`efectivo`, `datafono`, `rappi`, `nequi`,
  `transferencias`, `bono_regalo`, `propina`, `domicilios`, `bolsa`, `caja`):
  se toma **el registro más reciente** de cada combinación
  turno + variable + categoría, con `DISTINCT ON … ORDER BY created_at DESC`.
  Es correcto porque semánticamente solo puede existir un valor por canal y
  categoría en un turno. En el 97 % de los casos el valor es idéntico, así que
  la regla solo decide en los 21 restantes, donde lo último registrado es la
  corrección buena.
- **`gasto_extra`**: **la misma regla**. Verificado en
  `Loggro/Cierre_Turno/consultar_gastos.txt`, nodo `Code in JavaScript`
  («Agrupar y sumar gastos por ID»): el flujo **suma los gastos por tipo** antes
  de devolverlos al formulario. Dos domicilios de $5 000 a distinta hora son
  gastos distintos en Loggro, pero llegan al cierre como una sola cifra de
  $10 000 en la categoría domicilios.

  Comprobado contra los datos: en los 271 turnos sin reenvío hay **1 267 casos
  con una sola fila** por turno y categoría; en los turnos con reenvío **no hay
  ni un solo caso** de fila única. Confirma que lo normal es una fila por
  categoría y que las repeticiones son reenvíos.

### 9.3 · Esto además es un defecto operativo

Un 24 % de turnos con filas repetidas apunta a que **el botón de subir cierre
admite envíos repetidos**. El RPC `subir_cierre_turno()` de la Fase C tampoco es
idempotente: reenviar el mismo turno vuelve a insertar todo.

Merece corregirse por separado del módulo de tableros, con un índice único sobre
turno + variable + categoría y un `ON CONFLICT DO UPDATE`. Mientras tanto, la
deduplicación de la vista deja los tableros correctos aunque el origen siga
ensuciándose.

---

## 10 · Alcance de la Fase 1

1. `app_sedes_dashboard()` — el alcance de la tabla 8.2.
2. `v_turnos_lineas` — unión de la tabla base y su gemela `_locales`, con
   `es_local`, y la deduplicación de 9.2 aplicada.
3. `v_turnos_pivote` — una fila por turno con los seis canales en columnas, los
   seis descuadres calculados, los globales tomados con `MAX` y el booleano
   `cuadrado`.
4. `dashboard_sedes()` — devuelve las sedes que el usuario puede filtrar, para
   poblar el selector.

Verificación de cierre: que `v_turnos_pivote` devuelva 356 turnos, que el
efectivo del sistema sume $92 025 571 y no $133 003 949, y que un usuario
`operativo` reciba cero filas.

---

## 11 · Sin decisiones pendientes

Las tres cuestiones abiertas quedaron resueltas el 2026-08-22: tolerancia cero
(8.1), filtro por sede con alcance estricto (8.2) y deduplicación uniforme de
toda la tabla (9.2). La Fase 1 puede escribirse tal como está descrita en la
sección 10.

Queda **fuera de este plan**, como trabajo aparte, el defecto operativo de 9.3:
el botón de subir cierre admite reenvíos y el RPC `subir_cierre_turno()` no es
idempotente.

---

# Parte II · Integridad de turnos

## 12 · El problema

Un turno se puede subir varias veces y la base lo acepta sin protestar. Eso
produjo el 24 % de turnos con filas repetidas de la sección 9, y obliga a
deduplicar en cada consulta. Arreglar el origen es mejor que seguir limpiando
la salida.

### 12.1 · Lo que dicen los datos

| Medida | Valor |
|---|---:|
| BATUT LE MERIDIEM | 319 turnos |
| Restaurante Prueba | 37 turnos |
| Fechas con 2 turnos (lo esperado) | 145 |
| Fechas con 1 turno | 34 |
| **Fechas con 3 turnos** | **8** |
| **Fechas con 4 turnos** | **2** |

Distribución de la hora de inicio: 186 turnos empiezan antes de las 12:00, 155
a las 14:30 o después, y **15 caen entre las 12:00 y las 14:29**.

**Un corte automático a las 14:30 clasifica mal 14 de los 145 días.** La hora de
inicio no basta para saber a qué jornada pertenece un cierre — justo el caso de
la persona del turno de mañana que cierra a las 15:10 porque se extendió
atendiendo clientes. Por eso dejar el horario libre fue la decisión correcta, y
por eso la solución no puede ser volverlo restrictivo.

### 12.1.1 · Los 10 días sospechosos, ya identificados

| Fecha | Registros | Horas de inicio |
|---|---:|---|
| 2026-03-02 | 4 | 06:25, 06:30, 08:30, 14:30 |
| 2026-08-01 | 4 | 07:30, 11:30, 11:30, 15:00 |
| 2026-04-16 | 3 | 05:56, 06:08, 10:11 |
| 2026-04-17 | 3 | 06:30, **06:30**, 08:00 |
| 2026-04-08 | 3 | 07:54, 15:13, **15:13** |
| 2026-05-30 | 3 | 07:27, 15:10, **15:10** |
| 2026-06-18 | 3 | 07:39, **07:39**, 14:59 |
| 2026-08-10 | 3 | 08:04, **08:04**, 14:34 |
| 2026-08-15 | 3 | 07:43, 12:50, 16:13 |
| 2026-08-20 | 3 | 08:08, 08:09, 15:22 |

Seis de ellos tienen **dos cierres a la misma hora exacta**, y otros tres tienen
horas casi idénticas. Son el mismo turno subido dos veces con el responsable o
la hora ligeramente distintos: precisamente lo que la clave nueva elimina. El
único caso que parece un día real de tres jornadas es el 2026-08-15
(07:43 / 12:50 / 16:13), y habrá que revisarlo a mano.

### 12.2 · Métodos evaluados

| Método | Qué resuelve | Por qué no basta solo |
|---|---|---|
| **A. Clave natural + selector de jornada** | El turno queda identificado por sede + fecha + jornada, sin depender de la hora | Ninguna pega: es la base de la solución |
| **B. Token de idempotencia** | El doble clic y el reintento por red lenta | No impide resubir el mismo turno mañana |
| **C. Detección por solapamiento de horas** | Turnos que se pisan | Ambiguo con horarios que se desbordan |
| **D. Turno abierto / cerrado** | Modelo más riguroso | Cambia el flujo: hoy el cierre se sube entero al final |
| **E. Historial de versiones** | Conserva la evidencia de las correcciones | Por sí solo no evita el duplicado |

**Solución adoptada: A + B + E.**

### 12.3 · A · La jornada como parte de la identidad

Dos botones en el formulario, `Turno 1 · Mañana` y `Turno 2 · Tarde`. La hora
sigue siendo libre. La identidad del turno pasa a ser:

```
(empresa_id, fecha_turno, numero_turno)
```

Lo importante es lo que **desaparece** de la clave: `hora_inicio` y
`responsable_id`. Hoy forman parte de ella, y por eso el mismo turno subido con
la hora corregida, o por otra persona, cuenta como turno distinto. Eso explica 9
de los 10 días de la tabla anterior.

`numero_turno` se define como `smallint` con `CHECK (numero_turno IN (1,2,3))`.
Hoy no hay terceras jornadas, pero admitir el 3 desde ahora cuesta nada y evita
rehacer la clave si alguna sede abre turno de noche.

### 12.4 · B · Identificador de envío

El navegador genera un identificador al abrir el formulario. Si llegan dos
peticiones con el mismo, la segunda no hace nada y devuelve el resultado de la
primera. Cubre el doble clic y el reintento por red lenta, que es lo que explica
los 989 reenvíos idénticos de la sección 9.

### 12.5 · E · Historial en tabla aparte

**Tu propuesta es mejor que la mía y la adopto.** Yo había planteado marcar las
filas viejas con una columna `reemplazado_en` y dejarlas donde están. Mover la
versión anterior a una tabla histórica es superior por cuatro razones:

1. La tabla de trabajo se queda solo con el turno definitivo, que es lo que se
   consulta el 99 % del tiempo.
2. El índice único puede ser **total** en vez de parcial. No es un detalle
   menor: la lección del parche 3 de la Fase B fue que **un índice único parcial
   no sirve como destino de `ON CONFLICT`**, y ese error costó un cron que
   reportaba éxito sin hacer nada.
3. Los tableros no necesitan filtrar nada: leen la tabla y ya.
4. El histórico crece por separado y nunca estorba a la operación diaria.

**¿Es pesado?** No. Hoy la tabla tiene 8 917 filas; el histórico crecería a un
ritmo de decenas de filas por sobrescritura. Mover una versión es un `INSERT` +
`DELETE` dentro de la misma transacción, sobre unas 25 filas. Es imperceptible.

Tablas nuevas: `cierres_turno_historico` y `apoyos_turno_historico`, con las
mismas columnas que su original más:

| Columna | Contenido |
|---|---|
| `reemplazado_en` | Fecha y hora de la sobrescritura |
| `reemplazado_por` | Usuario que la hizo |
| `reemplazado_por_correo` | Su correo, para que el histórico se lea sin cruzar tablas |
| `motivo` | Texto opcional que escriba quien sobrescribe |

Por qué insisto en esto: es un sistema de arqueo de caja. Si alguien sube un
cierre con un descuadre y lo reemplaza por uno cuadrado, sin histórico **no
queda ningún rastro de que existió el primero**, y la función que arregla el
problema se convierte en la forma más limpia de tapar un faltante. De los
reenvíos actuales, 21 cambiaron valores: esos son justo los que interesa poder
revisar.

### 12.6 · Cambios en la base

1. Columna `numero_turno` en `cierres_turno_final`,
   `cierres_turno_final_locales`, `apoyos_turno` y `apoyos_turno_locales`.
2. Columna `token_envio` (texto, nulo permitido) para la idempotencia.
3. Tablas `cierres_turno_historico` y `apoyos_turno_historico`.
4. **Índice único total** sobre
   `(empresa_id, fecha_turno, numero_turno, variable, categoria)`.
   Es la garantía de verdad: aunque falle el formulario, la base no admite dos
   versiones vigentes del mismo dato.
5. `subir_cierre_turno()` pasa a ser idempotente y transaccional: comprueba el
   token, comprueba si el turno existe, aplica los permisos de 12.8, mueve la
   versión anterior al histórico y luego inserta la nueva.
6. Función `turno_existente(empresa, fecha, numero)` para que el formulario
   avise antes de que la persona rellene todo.

### 12.7 · Cambios en el formulario

- Dos botones de jornada, obligatorios, junto a la fecha.
- **Aviso temprano:** al elegir fecha y jornada, si ese turno ya existe se avisa
  ahí mismo, indicando quién lo subió y cuándo — antes de rellenar el resto.
- **Confirmación al enviar:** un diálogo que exige aceptar el reemplazo. Sin esa
  aceptación, el backend rechaza.
- El botón se bloquea mientras el envío está en curso.

### 12.8 · Quién puede sobrescribir

| Rol | Qué puede sobrescribir |
|---|---|
| `operativo` | Solo turnos **del día en curso** |
| `admin` y `admin_root` | Cualquier turno, cualquier día |

La comprobación va dentro del RPC, comparando `fecha_turno` con la fecha actual
de Colombia (`hoyLocal()` de `_shared/fechas.ts`, ya centralizado). Toda
sobrescritura queda registrada en el histórico con su autor, sea del rol que sea.

### 12.9 · Los 356 turnos que ya existen

Regla de numeración, según tu criterio: **el turno 1 es el primer cierre subido
del día y el turno 2 el segundo, sin importar la hora.** Se ordena por el
`created_at` más antiguo de cada turno.

Comprobado contra los datos: en **143 de los 145** días con dos turnos, ese
orden coincide con el orden por hora de inicio. En **2 días** la persona del
turno de mañana subió su cierre después que la de la tarde, así que quedarían
numerados al revés. Son pocos y quedan listados para revisión manual en lugar
de forzar una excepción automática.

Los 10 días con tres o cuatro registros se numeran igual, y los que reciban un 3
o un 4 quedan marcados como pendientes de análisis, tal como pediste. Ninguna
fila se borra en este paso.

---

# Parte III · Conciliación del efectivo entre turnos

## 13 · El problema

Un caso real: la caja abrió con 120 000. Al cerrar el turno 1, la persona
registró 140 000. Al abrir el turno 2, la siguiente declaró haber recibido
160 000. **Alguien contó mal 20 000, y hoy el sistema no tiene dónde dejarlo
registrado.** El dinero desaparece entre dos turnos sin que quede rastro de en
cuál de los dos se perdió la cuenta.

### 13.1 · Cómo funciona el efectivo hoy

Rastreado en `js/cierre_turno.js` — respondiendo a tu pregunta, **las cuentas se
hacen hoy en el navegador, no en la base**:

| Concepto | Cómo se calcula | Línea |
|---|---|---|
| Efectivo real | `bolsa` + `caja` | 214-216 |
| Efectivo sistema (bruto) | `efectivo_apertura` + ventas en efectivo de Loggro | 219-221 |
| Efectivo sistema (neto) | el bruto menos los gastos extra | 223 |

O sea: `efectivo_apertura` **ya existe** como columna y como campo del
formulario, y lo escribe la persona a mano. Lo que falta es con qué comparar ese
número.

### 13.2 · Los tres campos

**Una tarjeta más, igual que las demás.** Las tarjetas del formulario ya tienen
dos columnas, *sistema* y *real*. El efectivo de apertura encaja como una más:

| Columna de la tarjeta | Qué contiene | Quién lo pone |
|---|---|---|
| Sistema | La caja con la que cerró el turno anterior | El sistema, automáticamente |
| Real | Lo que la persona contó al recibir | Quien cierra el turno |
| Diferencia | Real − Sistema | Calculado |

Eso permite guardarlo **sin columnas nuevas**, usando el mismo modelo
entidad-valor que ya usan los seis canales:

```
variable = 'efectivo_apertura'   categoria = 'sistema'
variable = 'efectivo_apertura'   categoria = 'real'
```

Dos ventajas sobre añadir columnas:

1. La vista de pivote de la Fase 5 lo recoge sin tocar una línea, y el tablero
   de conciliación lo trata como un canal más. Sin código especial.
2. La columna `efectivo_apertura` que ya existe **se deja intacta**, así que
   ningún cálculo ni pantalla actual se rompe.

En el ejemplo: sistema 140 000, real 160 000, diferencia **+20 000**. El turno
queda marcado y se sabe entre qué dos personas ocurrió.

### 13.3 · De dónde sale el valor esperado

El turno anterior es **el cierre inmediatamente anterior de la misma sede**,
ordenando por `(fecha_turno, numero_turno)`. Para el turno 1 del 21/08 es el
turno 2 del 20/08, como planteaste. Si no existe turno anterior —la primera vez
que una sede opera, o tras una pausa— no hay nada que comparar: el esperado
queda igual al declarado y la diferencia en cero.

**Qué parte del efectivo pasa al turno siguiente: la caja.** Al cerrar, el
efectivo se reparte entre `bolsa` y `caja`, y su suma es el efectivo real del
turno. La **bolsa es el dinero que se retira** del local; la **caja es lo que
queda** para quien entra después.

Por tanto:

```
efectivo_apertura_esperado = caja_global del turno anterior de esa sede
```

`bolsa_global` no interviene en el cálculo.

### 13.4 · Dónde se calcula la diferencia

**Recomendación: en el RPC, no en el navegador.** El valor esperado se busca en
la base en el momento de guardar y la resta se hace ahí mismo. Dos razones:

1. Un dato que sale del navegador se puede alterar. Si la diferencia de caja se
   calculara en el cliente, quien tuviera que justificar un faltante podría
   enviarla en cero.
2. El resto de cálculos del formulario seguirán en el navegador como hasta
   ahora, para que la persona vea las cifras mientras escribe. Esto es distinto:
   es un dato de control, y los datos de control se calculan del lado seguro.

### 13.4.1 · Cuándo se carga el valor esperado

Se carga **al pulsar «Consultar Loggro»**, aprovechando el botón que ya existe.
No hace falta añadir ninguno.

Técnicamente es sencillo: el manejador de ese botón ya llama a
`consultar-ventas`; se le suma una llamada al RPC `efectivo_turno_anterior()`
lanzada **en paralelo** con `Promise.all`, de modo que no añade espera. Se
mantienen como dos llamadas separadas a propósito: `consultar-ventas` habla con
Loggro y el RPC lee la base, y mezclarlas haría que un fallo de Loggro impidiera
ver el efectivo del turno anterior.

**Y hay una razón de control para que sea justo ese botón, no otro momento.**
La validación actual (js/cierre_turno.js:1357) ya exige que el efectivo de
apertura esté escrito **antes** de poder consultar. Es decir, la persona declara
lo que contó sin saber todavía cuánto debería haber, y solo después el sistema
revela el esperado.

Si el esperado se mostrara al abrir el formulario, bastaría con copiarlo para
que la diferencia diera cero siempre, y el control no mediría nada. El orden que
impone el botón protege el dato por sí solo: **primero se cuenta, después se
compara.** Conviene no cambiar ese orden en el futuro sin tenerlo presente.

Tras la consulta, el formulario muestra el esperado en un campo de solo lectura
junto a la diferencia, para que quien cierra vea el descuadre en el momento y
pueda dejarlo comentado.

### 13.5 · Los datos que ya existen: se pueden reconstruir

El plan decía inicialmente rellenar el histórico con ceros. **No hace falta.**

Comprobado contra los datos: `caja_global` tiene valor en los 319 turnos de
BATUT LE MERIDIEM (de 19 600 a 535 500), y `efectivo_apertura` guarda lo que
declaró cada persona. Con esos dos datos la diferencia se calcula hacia atrás
sin inventar nada.

De hecho la cadena ya se cumple en la práctica. Últimos cierres de agosto:

| Fecha | Hora | Caja del anterior | Apertura declarada | Diferencia |
|---|---|---:|---:|---:|
| 19/08 | 14:53 | 333 150 | 334 500 | **+1 350** |
| 20/08 | 08:09 | 289 500 | 289 500 | 0 |
| 20/08 | 08:08 | 286 900 | 289 500 | **+2 600** |
| 20/08 | 15:22 | 286 900 | 286 900 | 0 |
| 21/08 | 07:35 | 262 500 | 262 500 | 0 |
| 21/08 | 14:42 | 170 700 | 170 700 | 0 |

El **+1 350 del 19 de agosto** es exactamente el descuadre que se quiere
capturar, y ya estaba en la base sin que nadie lo mirara.

**Condición:** la reconstrucción debe hacerse **después** del backfill de la
Fase 2. Los turnos duplicados rompen la cadena —el +2 600 del 20/08 cae en uno
de los días con tres registros— y producían diferencias que no son reales.

Resultado: el módulo arranca con seis meses de histórico real en lugar de una
columna de ceros.

### 13.6 · Lo que esto habilita

Una vez recogido, el dato entra solo en el tablero de conciliación: turnos con
diferencia de apertura, ranking de personas por diferencias acumuladas, y si las
diferencias se concentran en una entrega concreta entre dos turnos. Es la misma
pregunta que ya responde el tablero 1, pero para el dinero que cambia de manos
entre dos personas en vez del que pasa por la caja registradora.

---

# Parte IV · Orden de ejecución

Primero las tablas, después los tableros. Cada fase cierra con su verificación.

| # | Fase | Qué incluye |
|---|---|---|
| 1 | **Jornada e idempotencia** | `numero_turno`, `token_envio`, índice único, tablas de histórico |
| 2 | **Backfill de turnos** | Numerar los 356 turnos existentes; listar los sospechosos |
| 3 | **RPC y formulario de cierre** | `subir_cierre_turno()` idempotente, permisos de sobrescritura, botones de jornada y avisos |
| 4 | **Efectivo de apertura** | La tarjeta nueva, el cálculo en el RPC, la carga desde «Consultar Loggro» y la reconstrucción del histórico |
| 5 | **Cimientos de tableros** | Lo descrito en la sección 10 |
| 6-10 | **Los cinco tableros** | En el orden de la sección 6 |

Las fases 1 a 4 arreglan el origen de los datos; a partir de la 5, los tableros
se construyen ya sobre una clave estable. Hacerlo al revés obligaría a rehacer
las vistas cuando cambiara la clave del turno.

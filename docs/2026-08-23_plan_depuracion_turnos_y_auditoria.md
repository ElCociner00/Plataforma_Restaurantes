# Plan · Depuración de cierres de turno y pantalla de auditoría

**Fecha:** 2026-08-23 · **Base analizada:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`)
**Estado:** propuesta, pendiente de aprobación · **Bloquea a:** el sistema de dashboards

Continúa [2026-08-22_ejecucion_fases_1_a_4_turnos.md](2026-08-22_ejecucion_fases_1_a_4_turnos.md).
Numeración de fases correlativa: aquella ejecución cerró la Fase 4, esta arranca en la 5.

---

## 1 · Respuesta a la primera pregunta: ¿existe la tabla histórica?

**Sí, y con la columna de observaciones ya prevista.** La creó
`20260822210000_fase_1_jornada_e_historico.sql` y está aplicada en la base.
Verificado hoy contra el servidor:

| Objeto | Estado |
|---|---|
| `public.cierres_turno_historico` | Existe · **0 filas** |
| `public.apoyos_turno_historico` | Existe · **0 filas** |
| Columna `observaciones` | Existe en ambas, `text NOT NULL DEFAULT ''` |
| Columnas de trazabilidad | `reemplazado_en`, `reemplazado_por`, `reemplazado_por_correo`, `motivo`, `origen` |
| RLS | Activo · lectura solo `admin`/`admin_root` de su empresa |
| `subir_cierre_turno()` | Ya archiva en lugar de borrar al sobrescribir |

Está vacía porque se creó anteayer y desde entonces nadie ha sobrescrito un
turno. El mecanismo funciona; lo que no existe todavía es lo que hace falta
para lo que se pide ahora, y está en la sección 3.

---

## 2 · Diagnóstico de la base

Todas las cifras salen de consultas hechas hoy sobre la base de trabajo.

### 2.1 · Volumen actual

| Tabla | Filas | Turnos | Rango |
|---|---:|---:|---|
| `cierres_turno_final` | 9 629 | 356 | 12/02 – 21/08 |
| `cierres_turno_final_locales` | 1 901 | 100 | 29/06 – 21/08 |
| `apoyos_turno` | 99 | 69 | 18/04 – 21/08 |
| `apoyos_turno_locales` | 41 | 34 | 04/07 – 21/08 |

Por sede: **BATUT LE MERIDIEM** 8 848 filas en 167 días, **BATUT VIVA**
1 901 en 51 días, **Restaurante Prueba** 781 en 22 días.

### 2.2 · El problema, medido

Un cierre normal inserta **una fila por canal y categoría** (efectivo,
datáfono, rappi, nequi, transferencias, bono_regalo × sistema/real) más las
filas de gastos y el par de efectivo de apertura. Cuando alguien pulsó
«Enviar» dos veces, **todo el bloque se insertó otra vez, dentro del mismo
turno**.

Se detecta contando las copias de las variables de canal: cada envío deja
exactamente una. Esa cuenta es coherente en 94 de los 95 turnos afectados, lo
que confirma que el patrón es real y no una coincidencia.

| Envíos del mismo turno | Turnos (`final`) | Turnos (`locales`) |
|---:|---:|---:|
| 1 (correcto) | 271 | 90 |
| 2 | 58 | 8 |
| 3 | 13 | 1 |
| 4 | 4 | — |
| 5 | 1 | — |
| 6 | 4 | — |
| 7 | 2 | — |
| 9 | 1 | — |
| **16** | 1 | — |
| Incoherente (envío truncado) | 1 | 1 |

El récord es el **07/03 turno 1 de BATUT LE MERIDIEM: 16 envíos, 290 filas**
donde deberían haber 19.

### 2.3 · Cuánto dinero infla

Sumando la categoría `real` de los canales, tal como está hoy frente a lo que
queda al dejar un solo envío por turno:

| Tabla | Hoy | Real | Inflado |
|---|---:|---:|---:|
| `cierres_turno_final` | $685 401 410 | $483 426 372 | **+$201 975 038 (+41,8 %)** |
| `cierres_turno_final_locales` | $121 781 327 | $106 615 625 | **+$15 165 702 (+14,2 %)** |

Desglose de `final`: datáfono +43,7 %, efectivo +42,4 %, rappi +42,1 %,
transferencias +36,9 %.

**Cualquier tablero construido sobre estos datos hoy mostraría cifras infladas
casi un 42 %.** Por eso esta depuración va antes que los dashboards.

### 2.4 · Qué se mueve al histórico

| Tabla | Filas hoy | Tras depurar | **Se mueven** | Turnos tocados |
|---|---:|---:|---:|---:|
| `cierres_turno_final` | 9 629 | 6 882 | **2 747** | 85 |
| `cierres_turno_final_locales` | 1 901 | 1 746 | **155** | 9 |
| **Total** | 11 530 | 8 628 | **2 902 (25 %)** | 94 |

Más 19 grupos de apoyos duplicados y 5 apoyos sin jornada asignada.

### 2.5 · Los envíos repetidos: idénticos y correcciones

De los 94 turnos, **83 tienen todos los envíos idénticos** (doble clic puro) y
**11 divergen**: alguien reenvió el cierre con un dato corregido. En los once,
**el último envío es siempre la corrección**, y en varios el error de partida
es evidente:

| Turno | Qué cambió |
|---|---|
| 25/07 T2 | datáfono real `77 667` → `772 667` (dígito perdido) |
| 26/05 T1 | seis envíos iguales y el séptimo corrige efectivo y transferencias |
| 10/05 T1 | rappi `634 900` → `543 100`, transferencias `112 500` → `204 300` |
| 11/05 T1 | datáfono `257 200` → `297 200` |
| 20/05 T1 | rappi y transferencias intercambiados |
| 16/06 T2 · 06/07 T1 · 07/07 T1 · 10/06 T1 · 02/08 T2 | ajustes de una sola cifra |

**Regla propuesta: gana el último envío completo.** Es lo que ya hace
`subir_cierre_turno()` desde la Fase 3, así que el pasado queda con el mismo
criterio que el presente.

### 2.6 · Días con más de dos jornadas

Diez días. Analizados uno a uno:

**Duplicados claros — la jornada sobra entera:**

| Día | Sede | Qué pasa |
|---|---|---|
| 08/04 | MERIDIEM | T2 y T3 idénticos (15:13–21:20, $1 279 664), subidos con 1 min de diferencia → **sobra T3** |
| 30/05 | MERIDIEM | T2 y T3 mismo importe, solo cambia la hora de fin (21:18 → 21:42) → **sobra T2** |
| 18/06 | MERIDIEM | T1 y T2 idénticos (07:39–14:45) → **sobra T2**, T3 pasa a ser T2 |
| 10/08 | MERIDIEM | T1 y T2 idénticos (08:04–14:30) → **sobra T2**, T3 pasa a ser T2 |
| 20/08 | MERIDIEM | T1 y T2 mismo real, distinto sistema y hora de fin ampliada → **sobra T1** (T2 es la corrección), T3 pasa a ser T2 |
| 01/08 | MERIDIEM | T2 y T3 idénticos (11:30–15:00) → **sobra T3**; quedan tres jornadas reales (ver 6.2) |

**No son duplicados — el día tuvo tres jornadas de verdad:**

| Día | Sede | Franjas |
|---|---|---|
| 15/08 | MERIDIEM | 07:43–13:00 · 12:50–16:07 · 16:13–22:47, importes distintos |
| 01/08 | MERIDIEM | 07:30–11:02 · 11:30–15:00 · 15:00–21:53 (tras quitar el duplicado) |

**Datos de prueba:** 02/03 (4 jornadas), 16/04 (3) y 17/04 (3), todos de
Restaurante Prueba.

### 2.7 · Casos sueltos

- **MERIDIEM 18/05 T2 — envío truncado.** Se cortó a la mitad: hay efectivo,
  datáfono, rappi y nequi; faltan transferencias, bono_regalo y los gastos. El
  reintento también se cortó. **No es un duplicado: es un turno incompleto.**
  No se puede reconstruir sin el dato original.
- **BATUT VIVA 19/08 T2 — fila huérfana.** El cierre entró completo el 20/08 a
  las 02:01; **17 horas después apareció una fila suelta** `efectivo/sistema
  261 200`. Basura, al histórico.
- **5 apoyos sin `numero_turno`** (2 en `apoyos_turno`, 3 en
  `apoyos_turno_locales`): no encontraron turno con el que emparejarse.

### 2.8 · Días con una sola jornada

**36 días** tienen un solo turno: 23 en MERIDIEM, 2 en VIVA, 11 en Prueba. No
son un error de datos —no hay nada duplicado que quitar— sino **turnos que
nadie subió**. Casi todos son de tarde (falta el de mañana) o al revés. Cuatro
cubren el día entero en un solo turno: 22/02 08:00–22:00, 08/03 07:30–23:34,
18/02 14:30–23:59 y 15/04 02:11–14:11.

Se listan como hallazgo. **No se inventa nada**: los dashboards tendrán que
tratarlos como días incompletos y la pantalla nueva los dejará a la vista.

### 2.9 · Un fallo que estorba a los dashboards

La vista `turnos_agrupados` —la que alimenta la pantalla de Histórico— **no
usa la columna `numero_turno`**: calcula la suya con
`dense_rank() OVER (... ORDER BY hora_inicio)`.

Consecuencia: el Histórico numera los turnos por hora y el resto del sistema
por orden de envío. **En los dos días que la Fase 2 dejó numerados al revés y
en los diez días con jornada de más, las dos pantallas dirán números distintos
para el mismo turno.** Hay que unificarlo antes de los tableros.

---

## 3 · Lo que la tabla histórica todavía no puede hacer

La tabla sirve para lo que se diseñó —guardar la versión anterior cuando
alguien sobrescribe— pero le faltan cuatro cosas para ser la pantalla de
gestión que se pide:

| Falta | Por qué importa |
|---|---|
| **Agrupar un movimiento** | Cada fila es independiente. Al mover 2 902 filas, la pantalla mostraría 2 902 líneas sueltas y no habría forma de decir «devuelve *ese* turno»: no existe nada que ate las filas de un mismo movimiento. **Hace falta un `lote_id`.** |
| **Permisos de edición y borrado** | Las políticas RLS actuales solo permiten `SELECT` e `INSERT`. Un admin hoy **no puede editar la observación ni eliminar una línea**. |
| **Camino de vuelta** | No hay forma de devolver un turno archivado a la tabla de trabajo. Hace falta un RPC que lo haga entero y en una sola transacción. |
| **Motivo clasificable** | `motivo` es texto libre. Para filtrar «enséñame solo los duplicados por doble clic» hace falta un **código**. |

---

## 4 · Fase 5 · Esquema de auditoría

Migración `20260823HHMMSS_fase_5_esquema_auditoria.sql`. Todo aditivo.

### 4.1 · Columnas nuevas en las dos tablas históricas

| Columna | Tipo | Para qué |
|---|---|---|
| `lote_id` | `uuid` | Ata todas las filas movidas en el mismo acto. Es la unidad que la pantalla muestra, restaura o borra. |
| `codigo_motivo` | `text` | Clasificación cerrada, ver 4.2. |
| `restaurado_en` / `restaurado_por` | `timestamptz` / `uuid` | Marca el lote que se devolvió a la tabla de trabajo. La fila **no se borra al restaurar**: queda con la marca. |
| `editado_en` / `editado_por` | `timestamptz` / `uuid` | Deja constancia de que un admin tocó los valores antes de devolverlos. |

`observaciones` ya existe y no se toca.

### 4.2 · Catálogo de motivos

`CHECK` sobre `codigo_motivo`:

| Código | Cuándo se usa |
|---|---|
| `DUP_EXACTO` | Reenvío idéntico del mismo turno (doble clic) |
| `DUP_CORREGIDO` | Envío anterior sustituido por una corrección posterior |
| `DUP_JORNADA` | Jornada entera repetida dentro del mismo día |
| `FILA_HUERFANA` | Fila suelta sin envío completo detrás |
| `ENVIO_TRUNCADO` | Envío que se cortó a medias |
| `SOBRESCRITO` | Reemplazo hecho desde el formulario (lo que ya escribe la Fase 3) |
| `MANUAL` | Movimiento hecho a mano por un admin |

**Cada fila movida llevará además una observación en prosa generada por la
propia migración**, con los datos del caso. Ejemplo de lo que quedará escrito:

> Depuración 2026-08-23. El turno del 07/03/2026 (jornada 1) se envió 16 veces
> seguidas; los 16 bloques son idénticos. Se conserva el último envío y se
> archivan los 15 anteriores. Sin efecto sobre los importes del turno.

y para un divergente:

> Depuración 2026-08-23. El turno del 25/07/2026 (jornada 2) se envió dos
> veces. El segundo envío corrige datáfono real de 77 667 a 772 667. Se
> conserva el segundo y se archiva el primero.

### 4.3 · Permisos

```sql
-- Editar: solo admin de su empresa
CREATE POLICY cierres_turno_historico_update ON public.cierres_turno_historico
  FOR UPDATE USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

-- Eliminar: mismo criterio
CREATE POLICY cierres_turno_historico_delete ON public.cierres_turno_historico
  FOR DELETE USING (public.app_es_admin() AND public.app_puede_ver_empresa(empresa_id));

GRANT UPDATE, DELETE ON public.cierres_turno_historico TO authenticated;
```

**Tensión que conviene tener presente:** dar `UPDATE` sobre los valores permite
a un admin editar la evidencia de un arqueo de caja. Se pidió explícitamente
(«el administrador puede editar los datos de ese registro por si debe
corregirlo y devolverlo a la base») y se implementa, pero por eso van las
columnas `editado_en` / `editado_por`: **toda edición queda fechada y
firmada**, y la pantalla marcará los lotes editados.

### 4.4 · Vista de lotes

`public.historico_turnos_lotes`, `security_invoker`, una fila por lote:
empresa, sede, fecha, jornada, código y texto del motivo, quién y cuándo lo
movió, filas del lote, importe `real` que representa, si está restaurado, si
está editado, y si el turno sigue existiendo en la tabla de trabajo.

Es lo que la pantalla lee. Sin ella, el navegador tendría que agrupar 2 902
filas a mano.

---

## 5 · Fase 6 · Depurar los envíos repetidos

Migración `20260823HHMMSS_fase_6_depurar_duplicados.sql`. Es la que mueve las
2 902 filas.

### 5.1 · Regla

Por cada turno, contar los envíos y **conservar el último completo**. Todo lo
demás se copia a `cierres_turno_historico` con su `lote_id`, su código y su
observación, y luego se borra de la tabla de trabajo.

`efectivo_apertura` no se toca: la Fase 4 dejó exactamente un par por turno.

### 5.2 · Códigos por caso

- Turnos con todos los envíos idénticos (83) → `DUP_EXACTO`
- Turnos donde el último corrige (11) → `DUP_CORREGIDO`

### 5.3 · Apoyos

Mismo criterio sobre `apoyos_turno` y `apoyos_turno_locales`: los 19 grupos
duplicados se reducen a uno y las copias van a `apoyos_turno_historico` con el
mismo `lote_id` del turno.

### 5.4 · Aserciones que hacen fallar el push si algo no cuadra

1. Ningún turno queda con más de un envío.
2. El número de filas movidas coincide **exactamente** con 2 902.
3. La suma de `real` por turno tras depurar es igual a la suma de hoy dividida
   por el número de envíos de ese turno, **al peso**.
4. Ningún turno pierde variables: el conjunto de `(variable, categoria)` de
   cada turno es el mismo antes y después.
5. Toda fila del histórico tiene `lote_id`, `codigo_motivo` y `observaciones`
   no vacíos.

La 3 y la 4 son las importantes: garantizan que **la depuración no cambia
ningún importe, solo elimina repeticiones**.

---

## 6 · Fase 7 · Jornadas de más

Migración `20260823HHMMSS_fase_7_jornadas_duplicadas.sql`.

### 6.1 · Lo que se ejecuta sin más preguntas

Los seis días de la primera tabla de 2.6: se archiva la jornada sobrante con
código `DUP_JORNADA` y se renumeran las que quedan para que no haya huecos
(18/06, 10/08 y 20/08 pasan su T3 a T2).

Observación tipo:

> Depuración 2026-08-23. El 08/04/2026 se registraron tres jornadas. Las
> jornadas 2 y 3 son idénticas (15:13–21:20, $1 279 664, subidas con un minuto
> de diferencia). Se archiva la jornada 3 y el día queda con dos turnos.

### 6.2 · Lo que necesita tu decisión antes

- **15/08 y 01/08 en MERIDIEM** tienen **tres jornadas reales**, con horarios y
  ventas distintas. No hay nada duplicado que quitar. O el negocio abrió tres
  turnos esos días, o alguien partió un turno en dos. **Solo tú lo sabes.**
  Hasta que lo digas se dejan como están y la pantalla los marca.
- **Restaurante Prueba** — 22 días, 781 filas, con jornadas de 12 horas y
  fechas de cierre que no cuadran. Es una sede de pruebas. Ver 10.1.

---

## 7 · Fase 8 · Casos sueltos

Migración `20260823HHMMSS_fase_8_casos_sueltos.sql`.

| Caso | Acción | Código |
|---|---|---|
| BATUT VIVA 19/08 T2, fila huérfana | Al histórico | `FILA_HUERFANA` |
| MERIDIEM 18/05 T2, envío truncado | **Se deja en su sitio** y se marca | `ENVIO_TRUNCADO` |
| 5 apoyos sin `numero_turno` | Emparejar por fecha y hora; los que no casen quedan en NULL y se listan | — |

El truncado **no se archiva**: quitarlo borraría el único registro de ese
turno. Se deja visible con su marca para que decidas si se completa a mano o
se acepta incompleto.

---

## 8 · Fase 9 · Cerrar el invariante

Migración `20260823HHMMSS_fase_9_indice_unico.sql`. Solo se aplica si las
Fases 6 a 8 pasaron todas sus aserciones.

1. **Índice único** sobre `(empresa_id, fecha_turno, numero_turno, variable,
   categoria)` en las dos tablas de cierre. A partir de aquí la base **rechaza
   físicamente** un turno duplicado, sin depender de que el código se acuerde.
2. **Arreglar `turnos_agrupados`** y `turnos_agrupados_locales` para que usen
   la columna `numero_turno` en lugar del `dense_rank()` por hora (2.9).
3. `CHECK` de `numero_turno` de vuelta a `BETWEEN 1 AND 3`, ya sin días de 4
   jornadas que lo impidan.

**Detalle a resolver al implementar el punto 1:** `gasto_extra` puede tener
legítimamente varias filas de la misma categoría dentro de un turno (se
observó `general` dos veces con valor 0 en envíos correctos). El índice único
tendrá que ser **parcial, excluyendo `gasto_extra`**, o incluir una columna de
orden. Se decide al escribir la migración, con el recuento delante.

El riesgo que quedaba abierto en la ejecución anterior —la pantalla auxiliar
que insertaba directo en `cierres_turno_final`— **ya está cerrado**:
`cierre_turno/auxiliar.html` y `js/cierre_turno_auxiliar.js` están borrados en
el árbol de trabajo y no queda ningún `.insert()` directo en el módulo.

---

## 9 · Fase 10 · La pantalla de auditoría

### 9.1 · Nombre

«Turnos sobreescritos» se queda corto: la pantalla va a contener sobrescritos,
duplicados depurados, filas huérfanas y envíos truncados. Propuestas:

| Nombre | A favor | En contra |
|---|---|---|
| **Auditoría de turnos** *(recomendado)* | Cubre todo lo que va a haber dentro y dice para qué sirve: revisar | Menos literal |
| Turnos archivados | Describe el mecanismo con exactitud | «Archivado» suena a algo que no se toca, y aquí sí se toca |
| Turnos sobreescritos | Es como lo llamaste tú | Deja fuera los depurados, que van a ser el 95 % del contenido |

El resto del documento usa **Auditoría de turnos**.

### 9.2 · Archivos

| Archivo | Qué |
|---|---|
| `cierre_turno/auditoria_turnos.html` | Página nueva |
| `js/auditoria_turnos.js` | Lógica |
| `css/auditoria_turnos.css` | Estilos sobre los tokens semánticos existentes |

Registro del módulo con clave `auditoria_turnos` en cinco sitios: `js/urls.js`,
`js/permissions.js` (`PAGE_ENVIRONMENT` y `DEFAULT_ROLE_PERMISSIONS`),
`js/access_control.local.js` (`LOCAL_ROLE_ACCESS`, `MODULE_ROUTE_MAP`,
`MODULE_ENV_MAP`, `LOGGRO_PRIORITY`), `js/permisos.js` (`DEFAULT_PAGES`) y
`js/header.js` (tercera entrada del desplegable «Cierre de turno»).

### 9.3 · Quién entra

`admin` y `admin_root`: `true`. `operativo`: `false`.

**Dos barreras, no una.** El permiso oculta el enlace y corta la ruta; el RLS
de la tabla ya exige `app_es_admin()`, así que un operativo que escriba la URL
a mano vería una tabla vacía. Es lo mismo que protege hoy al resto de módulos
de administración.

### 9.4 · Qué se ve

**Filtros:** sede, rango de fechas del turno, código de motivo, y estado
(vigentes / restaurados / editados).

**Tabla de lotes**, una línea por movimiento:

| Fecha turno | Jornada | Sede | Motivo | Observación | Movido por | Movido el | Filas | Importe | Estado |
|---|---|---|---|---|---|---|---:|---:|---|

Ordenada por fecha de turno descendente. Los lotes editados van marcados.

**Detalle del lote seleccionado:** las filas archivadas variable a variable y,
al lado, **lo que hay hoy en la tabla de trabajo para ese mismo turno**, para
que la comparación sea directa y no haya que abrir dos pantallas.

### 9.5 · Qué se puede hacer

| Acción | Cómo |
|---|---|
| **Editar la observación** | En línea sobre la tabla. `UPDATE` directo por RLS. |
| **Editar los valores** | En el detalle. Marca `editado_en` / `editado_por`. |
| **Eliminar** | Por lote o línea suelta, con confirmación que dice cuántas filas se van y advierte de que **no hay vuelta atrás**. |
| **Devolver a la base principal** | RPC `restaurar_turno_historico(p_lote_id, p_motivo)`. |

### 9.6 · El RPC de restauración

`restaurar_turno_historico(p_lote_id uuid, p_motivo text)`, `SECURITY INVOKER`,
en una sola transacción:

1. Comprueba `app_es_admin()` y que el lote es de una empresa que puede ver.
2. Si el turno **ya existe** en la tabla de trabajo, lo archiva primero con
   código `SOBRESCRITO` y su propio `lote_id` nuevo. Nunca se pisa nada sin
   dejar copia: el turno que hoy está bien podría ser el bueno.
3. Inserta las filas del lote de vuelta en `cierres_turno_final` o
   `cierres_turno_final_locales` según `origen`.
4. Marca el lote con `restaurado_en` y `restaurado_por`. **La fila del
   histórico no se borra.**
5. Devuelve un resumen: filas restauradas, filas archivadas al hacerlo, y el
   `lote_id` del turno desplazado por si hay que deshacerlo.

Es idempotente por `lote_id`: llamarlo dos veces no restaura dos veces.

**Por qué el orden de los pasos 2 y 3 importa:** la Fase 9 activa el índice
único, así que restaurar un turno cuando ya hay otro vigente **fallaría** si no
se archiva el vigente primero. Por eso el 2 va antes que el 3, y ambos en la
misma transacción.

---

## 10 · Decisiones que necesito de ti

Ninguna bloquea el arranque: las Fases 5, 6 y 8 se pueden ejecutar tal cual.
Estas afectan a las Fases 7 y 10.

1. **Restaurante Prueba.** 22 días, 781 filas, datos claramente de ensayo. ¿Se
   depura como una sede más, se borra entera, o se marca para que los
   dashboards la excluyan? **Recomiendo marcarla y excluirla**: depurar datos
   de prueba es trabajo sin retorno, y borrarla pierde el historial de cómo se
   probó el sistema.
2. **15/08 y 01/08 en MERIDIEM.** ¿El negocio abrió tres turnos esos días?
3. **Confirmación de la regla «gana el último envío»** para los 11 turnos
   divergentes de 2.5. Los once casos que revisé apuntan a que el último es la
   corrección, pero es tu dinero.
4. **Nombre de la pantalla**, de las tres opciones de 9.1.
5. **18/05 T2 truncado.** ¿Tienes forma de recuperar los datos que faltan
   (transferencias, bono_regalo y gastos de esa tarde), o se acepta incompleto?

---

## 11 · Orden de ejecución y reversión

| # | Fase | Qué toca | Reversible |
|---|---|---|---|
| 1 | **5 · Esquema** | Columnas, políticas, vista | Sí, aditivo puro |
| 2 | **6 · Duplicados** | Mueve 2 902 filas | Sí, desde el histórico por `lote_id` |
| 3 | **7 · Jornadas** | 6 días, renumeración | Sí, ídem |
| 4 | **8 · Sueltos** | 1 fila, 5 apoyos | Sí |
| 5 | **9 · Índice único** | Índices y vistas | Sí, `DROP INDEX` |
| 6 | **10 · Pantalla** | Frontend | Sí, `git checkout` |

**Nada se borra en las fases 6 a 8.** Todo lo que sale de la tabla de trabajo
entra en el histórico con su lote, y el RPC de restauración lo devuelve. La
única operación irreversible de todo el plan es el botón «Eliminar» de la
pantalla, y solo lo puede pulsar un admin sobre una línea concreta.

Antes de la Fase 6 se toma **copia de las cuatro tablas** con
`supabase db dump --data-only`, guardada fuera del repositorio.

---

## 12 · Lo que hay que recordar al construir los dashboards

- Después de esta depuración, **sumar `cierres_turno_final` directamente ya es
  correcto**. Hoy no lo es: sale un 42 % de más.
- Los **36 días con una sola jornada** siguen ahí. Un tablero que promedie por
  día los tratará como días flojos. Conviene una marca de «día incompleto».
- Los **dos días con tres jornadas reales** rompen el supuesto de dos turnos
  por día, si se confirma que son legítimos.
- `turnos_agrupados` numera por hora y no por la columna real (2.9). **Se
  arregla en la Fase 9**, pero cualquier vista nueva debe leer `numero_turno`,
  nunca recalcularlo.

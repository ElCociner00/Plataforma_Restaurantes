# Ejecución · Depuración de turnos y pantalla de auditoría

**Fecha:** 2026-08-23 · **Base:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`) · **Estado:** aplicado y verificado

Ejecución del plan
[2026-08-23_plan_depuracion_turnos_y_auditoria.md](2026-08-23_plan_depuracion_turnos_y_auditoria.md),
Fases 5 a 10. Con esto los dashboards dejan de estar bloqueados.

---

## 1 · Qué cambió en los números

| | Antes | Después | Retirado |
|---|---:|---:|---:|
| `cierres_turno_final` | 9 629 filas · 356 turnos | **6 057 · 313** | 3 572 |
| `cierres_turno_final_locales` | 1 901 · 100 turnos | **1 745 · 100** | 156 |
| `cierres_turno_historico` | 0 | **3 728 filas · 138 lotes** | — |
| `apoyos_turno_historico` | 0 | **95 filas** | — |

Efectivo real por sede, que es lo que van a sumar los tableros:

| Sede | Antes | Después | Retirado |
|---|---:|---:|---:|
| BATUT LE MERIDIEM | $633 256 894 | **$429 361 065** | $203 895 829 (32,2 %) |
| BATUT VIVA | $121 781 327 | **$107 233 375** | $14 547 952 (11,9 %) |
| Restaurante Prueba | $52 144 516 | **$0** | todo (datos de ensayo) |

**Ninguna fila se perdió.** Comprobado sobre el respaldo: las 11 530 filas de
cierre y los 140 apoyos que había antes están hoy o en la tabla de trabajo o en
el histórico. El cuadre es exacto: 6 057 + 3 572 = 9 629, y 1 745 + 156 = 1 901.

---

## 2 · Qué se archivó y por qué

| Código | Lotes | Filas | Qué es |
|---|---:|---:|---|
| `DUP_EXACTO` | 83 | 2 629 | El mismo turno enviado varias veces con datos idénticos |
| `DUP_CORREGIDO` | 10 | 268 | Envíos anteriores sustituidos por una corrección posterior |
| `DUP_JORNADA` | 6 | 116 | Jornada entera repetida dentro del mismo día |
| `DATOS_PRUEBA` | 37 | 712 | Cierres de ensayo de Restaurante Prueba |
| `ENVIO_TRUNCADO` | 1 | 2 | Reintento cortado del 18/05 |
| `FILA_HUERFANA` | 1 | 1 | Fila suelta del 19/08 en BATUT VIVA |

**Cada fila lleva su observación escrita**, generada con los datos del caso.
Ejemplo real de lo que un administrador lee en la pantalla:

> Depuración del 23/08/2026. El turno del 07/03/2026 (jornada 1) se envió 16
> veces con datos idénticos: el formulario permitía pulsar Enviar más de una vez
> y cada pulsación insertó el bloque completo del cierre dentro del mismo turno.
> Se conserva el último envío y se archivan las 270 filas sobrantes. Los importes
> del turno no cambian: solo se eliminan repeticiones.

---

## 3 · Decisiones aplicadas

| Decisión | Qué se hizo |
|---|---|
| Restaurante Prueba se elimina | Sus 712 filas salieron de la tabla de trabajo. **No se borraron**: están en el histórico con código `DATOS_PRUEBA`, y desde la pantalla se pueden eliminar definitivamente cuando quieras. Se eligió así porque borrar es la única operación irreversible del sistema y no hacía falta para dejar limpios los tableros. |
| 01/08 y 15/08 tuvieron tres turnos | Se conservan como turno 3. El sistema pasa a admitir la jornada 3 de punta a punta. |
| Gana el último envío | Aplicado a los 10 turnos con correcciones. El más claro: el 25/07 el datáfono pasa de 77 667 a 772 667 al reenviar. |
| Nombre de la pantalla | **Auditoría de turnos** |

---

## 4 · Migraciones aplicadas

| Archivo | Contenido |
|---|---|
| `20260823100000_fase_5_esquema_auditoria.sql` | `lote_id`, `codigo_motivo`, marcas de restaurado y editado; políticas UPDATE/DELETE; vista `historico_turnos_lotes`; RPC de restauración, anotación y edición |
| `20260823110000_fase_6_depurar_duplicados.sql` | 2 897 filas duplicadas al histórico |
| `20260823120000_fase_7_jornadas_y_datos_prueba.sql` | 6 jornadas repetidas, renumeración y salida de Restaurante Prueba |
| `20260823141000_fase_7b_corregir_lotes_datos_prueba.sql` | Corrección de un fallo de la Fase 7 (sección 6) |
| `20260823130000_fase_8_casos_sueltos.sql` | Fila huérfana, reintento truncado y 4 apoyos sin jornada |
| `20260823140000_fase_9_indice_unico_y_vistas.sql` | Índice único, `numero_turno` obligatorio, `turnos_agrupados` corregida |
| `20260823150000_fase_10_jornada_3_y_lote_sobrescritura.sql` | `subir_cierre_turno()` admite jornada 3 y etiqueta sus sobrescrituras |

Antes de tocar nada se copiaron las cuatro tablas a
`zz_backup_20260823_*` dentro de la propia base. **Siguen ahí**; conviene
borrarlas cuando des la depuración por buena.

---

## 5 · La jornada 3, de punta a punta

Añadirla en el desplegable no bastaba: el RPC la habría rechazado y las
pantallas la habrían dejado fuera de sus filtros. Se tocaron cinco sitios:

| Dónde | Cambio |
|---|---|
| `cierre_turno/index.html` | Opción «Turno 3 · Noche» en el desplegable de jornada |
| `js/cierre_turno.js` | Los dos avisos decían «Turno 1 o Turno 2» |
| `subir_cierre_turno()` | Validaba `NOT IN (1,2)` y habría rechazado cualquier cierre de un tercer turno |
| `turnos_agrupados` | La jornada 3 se nombra «Noche» |
| `cierre_turno/historico_cierre_turno.html` | Opción «Noche» en el filtro Momento, para que los turnos 3 no queden fuera al filtrar |

El `CHECK` de la base pasó de `1..9` —abierto en la Fase 2 para dar sitio a los
duplicados heredados— a `1..3`.

---

## 6 · Dos fallos que aparecieron durante la ejecución

Se registran porque los dos son trampas que volverán a aparecer.

### 6.1 · División entera en la Fase 6

La regla conservaba las primeras `n / envios` copias de cada
(turno, variable, categoría). Las dos filas de `efectivo_apertura` las escribió
la Fase 4 una sola vez por turno, así que en un turno con 2 envíos su `n` es 1
y `1 / 2` en enteros da **0**: la partición entera se habría borrado.

**Lo detuvo la aserción 4**, que comparaba el conjunto de
(turno, variable, categoría) contra el respaldo. Falló con «168 combinaciones
desaparecieron» —84 turnos × 2 filas— y revirtió el push completo. Se corrigió
con `GREATEST(1, n / envios)`, que garantiza que ninguna combinación se quede
sin ninguna fila.

**Sin esa aserción, la migración habría pasado y habría borrado en silencio el
efectivo de apertura de 84 turnos.**

### 6.2 · `gen_random_uuid()` dentro de un `SELECT DISTINCT`

La Fase 7 listó los turnos de prueba así:

```sql
SELECT DISTINCT empresa_id, fecha_turno, numero_turno, gen_random_uuid() ...
```

La función se evalúa **antes** del `DISTINCT` y devuelve un valor distinto por
fila, así que el `DISTINCT` no colapsó nada: la lista quedó con una fila por
cada fila de cierre en lugar de una por turno, y el JOIN posterior multiplicó.
En el histórico entraron 13 868 copias de 712 filas reales.

Las tablas de trabajo no se vieron afectadas —aquel `DELETE` filtraba por
`empresa_id` sin JOIN— pero la pantalla habría mostrado 712 lotes basura. Lo
arregla la Fase 7b, que además deja el patrón correcto: **`GROUP BY`, no
`DISTINCT`**, porque con `GROUP BY` el uuid se evalúa una vez por grupo.

Al reescribirla apareció un tercer detalle: el primer `DELETE` usaba una
subconsulta correlacionada por `id`, que recorría las 13 868 filas una vez por
fila y agotó el tiempo de sentencia. Se rehízo con `row_number()`, en una sola
pasada.

---

## 7 · La pantalla de auditoría

`cierre_turno/auditoria_turnos.html` · `js/auditoria_turnos.js` ·
`css/auditoria_turnos.css`

Tercera entrada del desplegable «Cierre de turno», visible solo para `admin` y
`admin_root`.

**Dos barreras, no una.** El menú oculta el enlace y la pantalla avisa a quien
no es administrador, pero lo que de verdad protege los datos es el RLS de
`cierres_turno_historico`, que exige `app_es_admin()`. Quien escriba la URL a
mano no verá ni una fila.

### Filtros

Sede, **responsable**, motivo, estado (archivado / restaurado / editado),
jornada, rango de fechas y búsqueda libre en las observaciones. Los selectores
de sede y responsable se rellenan con lo que realmente hay en el histórico, no
con el catálogo completo: ofrecer sedes sin movimientos solo daría filtros que
devuelven cero. Si el administrador tiene una sola sede, esa columna se oculta.

### Qué se ve y qué se puede hacer

La tabla muestra un movimiento por línea. Al abrir uno, el detalle pone las
filas archivadas **al lado de lo que hay hoy en la base**, y resalta las que no
coinciden: la pregunta que trae a un administrador aquí es siempre si lo que se
archivó era mejor que lo que quedó.

| Acción | Detalle |
|---|---|
| Editar la observación | Se guarda sobre todo el lote |
| Editar los valores | Marca el movimiento como **editado**, con fecha y autor |
| Devolver a la base | Si ya hay un turno en esa fecha y jornada, **se archiva primero**, en la misma transacción. Nunca se pisa nada sin dejar copia. La fila del histórico no se borra al restaurar: queda marcada |
| Eliminar | Con confirmación que dice cuántas filas se van y avisa de que no hay vuelta atrás |

Sobre la edición de valores: permite a un administrador tocar la evidencia de un
arqueo de caja. Se pidió expresamente para poder corregir un registro antes de
devolverlo, y por eso toda edición queda fechada y firmada en `editado_en` /
`editado_por`, y la pantalla marca esos movimientos.

---

## 8 · Verificaciones superadas

**Datos**

- Cero filas del respaldo perdidas en las cuatro tablas.
- Cuadre exacto: trabajo + histórico = respaldo, en las dos tablas de cierre.
- Cero turnos con filas repetidas.
- Cero días con huecos en la numeración de jornadas.
- Cero filas del histórico sin lote, código u observación.
- Todos los turnos conservan su par sistema/real de efectivo de apertura.
- Días con tres jornadas: exactamente 01/08 y 15/08.
- `turnos_agrupados` devuelve 313 filas para 313 turnos: uno por turno, que era
  el fallo que arrastraba.

**El índice único, probado de verdad**

Se intentó insertar una fila duplicada real. Postgres la rechazó y el conteo de
la tabla no cambió. A partir de ahora el invariante lo sostiene la base, no la
disciplina del código.

**Frontend**

- `node --check` sobre los 7 archivos JS tocados o creados.
- Los 2 imports de `auditoria_turnos.js` existen y exportan lo que se usa.
- Los 17 identificadores del DOM que busca el JS están una sola vez en el HTML;
  los 5 restantes los inyecta el propio script en el detalle.
- Los tokens CSS inventados (`--ek-surface-1`, `--ek-ink-3`) se sustituyeron por
  los reales del proyecto (`--ek-surface`, `--ek-ink-2`).

---

## 9 · Lo que queda pendiente

1. **El turno del 18/05 sigue incompleto.** Le faltan transferencias, bono de
   regalo y los gastos de esa tarde, y no hay forma de reconstruirlos desde la
   base. Cualquier total de ese día está por debajo de lo real. Se dejó a la
   vista, marcado como `ENVIO_TRUNCADO`.
2. **25 días tienen una sola jornada** (eran 36 antes de que saliera
   Restaurante Prueba). Ver la sección 11: no siguen ningún patrón de
   calendario. **3 están completos porque una persona cubrió el día entero,
   4 son dudosos y a 18 les falta un turno de verdad.**
3. **Un apoyo sigue sin jornada** (de los 5 iniciales, 4 se emparejaron por
   rango horario). No hay turno registrado que lo explique.
4. **Borrar las tablas `zz_backup_20260823_*`** cuando des esto por bueno.
5. **`js/header.js` cambió y no está versionado** con `?v=` en ninguna página.
   El menú nuevo puede tardar en aparecer hasta que caduque la caché del
   navegador (Ctrl+F5 lo fuerza).

---

## 10 · Reversión

Cada migración lleva su bloque al final. La red de seguridad real son las
tablas `zz_backup_20260823_*`, con las cuatro tablas íntegras tal como estaban
antes de empezar.

Para devolver un turno concreto no hace falta SQL: la pantalla de auditoría lo
hace con el botón «Devolver a la base principal», que llama a
`restaurar_turno_historico(lote_id)` y es idempotente.

---

## 11 · Los días con una sola jornada: ¿domingos y festivos?

Se planteó que los domingos y festivos operan con un solo turno y que por eso
esos días aparecían incompletos. **Los datos no lo respaldan.**

### 11.1 · Ninguno de estos días perdió nada en la depuración

Comprobado contra el respaldo: los 25 días **ya tenían una sola jornada antes
de empezar**. No se archivó ni un turno suyo, siguen íntegros en
`cierres_turno_final` y ya salen en cualquier consulta. No hay nada que
devolver a la tabla principal.

### 11.2 · Domingos y festivos operan con dos turnos

| Tipo de día | 1 turno | 2 turnos | 3 turnos | % con un solo turno |
|---|---:|---:|---:|---:|
| Domingo | 3 | 28 | — | 9,7 % |
| Festivo | 1 | 13 | — | 7,1 % |
| Laborable | 21 | 150 | 2 | 12,1 % |

**28 de 31 domingos y 13 de 14 festivos tienen dos turnos.** La proporción de
días con una sola jornada es prácticamente la misma en domingo, festivo y día
laborable: no hay ningún patrón de calendario detrás.

### 11.3 · La hipótesis correcta: una sola persona cubrió el día

La explicación que faltaba: **si una persona cubre la jornada entera, hay un
solo cierre y el día está completo.** Ocurre de verdad, pero hay que
distinguirlo de un turno que sencillamente no se subió.

El primer criterio que se probó fue la duración de la franja horaria, y **es
insuficiente**. Lo refuta el sábado 20/06: solo anota 15:10–22:26 (7,3 h) pero
factura $2 858 600, el **103 %** de un sábado normal. Ese día está completo con
una franja corta, así que las horas anotadas no bastan para decidir.

El criterio que sí funciona es comparar las ventas del día contra **la mediana
de los días completos del mismo día de la semana y la misma sede**:

**Días completos — una persona cubrió el 100 %:**

| Día | Franja | Horas | Ventas | vs. día normal |
|---|---|---:|---:|---:|
| Domingo 08/03 | 07:30–23:34 | 16,1 h | $3 517 246 | **134 %** |
| Sábado 20/06 | 15:10–22:26 | 7,3 h | $2 858 600 | **103 %** |
| Domingo 22/02 | 08:00–22:00 | 14,0 h | $2 157 633 | **82 %** |

El 22/02 se cuenta como completo porque une un 82 % de ventas con 14 h de
cobertura: las dos señales apuntan al mismo sitio.

**Dudosos — entre el 65 % y el 85 %, decisión humana:**

| Día | Franja | Ventas | vs. normal |
|---|---|---:|---:|
| Lunes 09/03 | 14:24–22:59 | $2 009 456 | 78 % |
| Martes 26/05 | 15:18–21:50 | $1 811 300 | 69 % |
| Martes 07/04 | 15:08–21:28 | $1 754 200 | 67 % |
| Lunes 23/02 | 14:56–21:00 | $1 720 900 | 66 % |

**Incompletos — falta un turno (18 días):** entre el **28 % y el 63 %** de un
día normal. Los más claros no dejan lugar a duda: el jueves 12/02 factura el
28 %, el martes 09/06 el 30 %, el martes 07/07 el 35 %. Aquí entran también los
dos días de calendario especial que parecían candidatos:

| Día | Franja | Ventas | vs. normal |
|---|---|---:|---:|
| Domingo 22/03 | 16:36–21:56 | $1 371 513 | 52 % |
| Festivo 15/06 | 08:59–14:34 | $1 440 546 | 56 % |

### 11.4 · Qué hacer con esto en los tableros

El criterio **no es el día de la semana ni el número de turnos ni las horas
anotadas, sino las ventas frente a la norma de ese día de la semana en esa
sede**:

- **≥ 85 %** → día completo, aunque tenga un solo cierre.
- **65 – 85 %** → marcar y revisar; son cuatro días.
- **< 65 %** → falta un turno: las ventas están por debajo de lo real y un
  promedio diario que los incluya sin marcar sale sesgado a la baja.

Queda pendiente decidir si esos 18 días se excluyen de los promedios, se
muestran marcados, o se dejan tal cual.

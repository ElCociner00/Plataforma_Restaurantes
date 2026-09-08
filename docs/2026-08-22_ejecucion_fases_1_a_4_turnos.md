# Ejecución · Fases 1 a 4 · Integridad de turnos y efectivo de apertura

**Fecha:** 2026-08-22 · **Base:** «Enkrato Google» (`tgkvcvnwwnrlyhbqmhaf`) · **Estado:** aplicado y verificado

Ejecución de las cuatro fases de datos del plan
[2026-08-22_plan_sistema_dashboards.md](2026-08-22_plan_sistema_dashboards.md),
Partes II y III. Los tableros (Fases 5 en adelante) quedan pendientes.

---

## 1 · Objetivo

Cerrar el origen de los turnos duplicados —el 24 % de los turnos tenía filas
repetidas, e inflaba el efectivo del sistema un 45 %— y dar al sistema una
forma de registrar el descuadre de efectivo entre dos turnos, que hasta ahora
desaparecía sin dejar rastro.

---

## 2 · Migraciones aplicadas

| Archivo | Contenido |
|---|---|
| `20260822210000_fase_1_jornada_e_historico.sql` | Columnas `numero_turno` y `token_envio`; tablas `cierres_turno_historico` y `apoyos_turno_historico` con RLS |
| `20260822213000_fase_2_backfill_jornadas.sql` | Numeración de los turnos existentes; vista `turnos_sospechosos` |
| `20260822214000_fase_2_verificacion.sql` | Aserciones del backfill; función `resumen_jornadas()` |
| `20260822220000_fase_3_cierre_idempotente.sql` | `subir_cierre_turno()` idempotente; `turno_existente()`; `efectivo_apertura_esperado()` |
| `20260822223000_fase_4_reconstruir_apertura.sql` | Reconstrucción del efectivo de apertura hacia atrás; vista `descuadres_apertura` |

### 2.1 · La identidad del turno

Antes: `(empresa_id, fecha_turno, hora_inicio, responsable_id)`.
Ahora: **`(empresa_id, fecha_turno, numero_turno)`**.

Salen de la clave la hora y el responsable. Eran la causa: el mismo turno
subido con la hora corregida, o por otra persona, contaba como turno nuevo.

`numero_turno` admite de 1 a 9 aunque las jornadas reales sean 1 y 2. Los
valores de 3 en adelante marcan días con más registros de los que caben en dos
jornadas, que son los duplicados heredados. Sin ese margen habría habido que
descartarlos, y la instrucción fue conservarlos para analizarlos.

### 2.2 · Regla de numeración del backfill

El turno 1 es el **primer cierre subido del día** y el 2 el segundo, sin
importar la hora. Se ordenó por el `created_at` más antiguo de cada turno.

Verificado sobre los datos: en **143 de los 145** días con dos turnos ese orden
coincide con el orden por hora de inicio. En **2 días** la persona del turno de
mañana subió su cierre después que la de la tarde, así que quedan numerados al
revés. Se dejaron así, a la vista, en lugar de forzar una excepción automática.

### 2.3 · Histórico en tabla aparte

Al sobrescribir un turno, la versión anterior **se mueve** a
`cierres_turno_historico` en lugar de borrarse. La tabla guarda la fila íntegra
más `reemplazado_en`, `reemplazado_por`, `reemplazado_por_correo`, `motivo` y
**`observaciones`**, esta última libre para anotar a mano la razón de los
movimientos de limpieza que se hagan más adelante.

Mover en vez de marcar permite que el índice único de la clave nueva sea
**total** en lugar de parcial. La lección del parche 3 de la Fase B fue que un
índice único parcial no sirve como destino de `ON CONFLICT`.

### 2.4 · Permisos de sobrescritura

| Rol | Qué puede reemplazar |
|---|---|
| `operativo` | Solo turnos del día en curso (hora Colombia) |
| `admin`, `admin_root` | Cualquier turno, cualquier día |

La comprobación vive dentro del RPC. Toda sobrescritura queda en el histórico
con su autor, sea del rol que sea.

### 2.5 · Idempotencia

El formulario genera un `token_envio` al abrir. Si llegan dos peticiones con el
mismo token, la segunda devuelve éxito sin insertar nada. Cubre el doble clic y
el reintento por red lenta, que explicaban los 989 reenvíos idénticos.

El token se renueva solo cuando un cierre entra de verdad.

---

## 3 · Efectivo de apertura

### 3.1 · Cómo funciona

`efectivo_apertura_esperado` = **`caja_global` del turno inmediatamente
anterior** de esa sede, ordenando por `(fecha_turno, numero_turno)`. La bolsa
es el dinero que se retira del local; la caja es lo que queda para quien entra
después, así que solo la caja se hereda.

Se guarda con el mismo modelo entidad-valor que los seis canales:

```
variable = 'efectivo_apertura'  categoria = 'sistema'  → la caja heredada
variable = 'efectivo_apertura'  categoria = 'real'     → lo que declaró la persona
```

Así la vista de pivote de los tableros lo recogerá sin código especial, y la
columna `efectivo_apertura` que ya existía queda intacta.

### 3.2 · El cálculo se hace en el servidor

El RPC ignora deliberadamente cualquier valor «sistema» que llegue del
navegador y lo recalcula. Si la diferencia se calculara en el cliente, quien
tuviera que justificar un faltante podría enviarla en cero.

### 3.3 · Cuándo se carga en pantalla

Al pulsar **«Consultar Loggro»**, en paralelo con la consulta de ventas
(`Promise.all`), de modo que no añade espera. Se mantienen como dos llamadas
separadas: si se fusionaran, una caída de Loggro dejaría también sin ver el
efectivo del turno anterior, que es un dato propio.

**El momento importa por una razón de control.** La validación existente ya
exige que el efectivo de apertura esté escrito antes de poder consultar. Es
decir, la persona declara lo que contó sin saber todavía cuánto debería haber,
y solo después el sistema revela el esperado. Si se mostrara al abrir el
formulario, bastaría con copiar la cifra para que la diferencia diera cero
siempre. **No mover ese orden sin tener esto presente.**

### 3.4 · Reconstrucción del histórico

El plan preveía rellenar el pasado con ceros. No hizo falta: `caja_global`
tiene valor en todos los turnos y `efectivo_apertura` guarda lo declarado, así
que la comparación se reconstruyó hacia atrás sin inventar nada.

Ejemplo real del 19/08: caja del cierre anterior 333 150, apertura declarada
334 500 → **+1 350** de descuadre que ya estaba en la base sin que nadie lo
mirara.

Cuando no hay turno anterior, el esperado se iguala al declarado y la
diferencia queda en cero, en lugar de fabricar un descuadre.

---

## 4 · Cambios en el formulario

| Archivo | Cambio |
|---|---|
| `cierre_turno/index.html` | Lista desplegable de jornada bajo el responsable; tarjeta «Efectivo de apertura» dentro de `.turno-datos-grid`, con los tres campos en horizontal |
| `css/cierre_turno.css` | Estilos de la tarjeta sobre los tokens semánticos existentes; centrado de `.icon-btn` y `.hint-icon` |
| `js/cierre_turno.js` | Estado de jornada, token de envío, carga de la caja anterior, cálculo de la diferencia, aviso de turno existente, confirmación de reemplazo y envío por RPC |

Revisión de interfaz posterior a la primera entrega:

- La jornada pasó de dos botones a **lista desplegable**. Uno al lado del otro
  no dejaba ver cuál estaba seleccionado.
- La tarjeta de apertura entró en `.turno-datos-grid` como una tarjeta más,
  ocupando el ancho completo. Antes vivía en un grid propio que dejaba media
  pantalla vacía a la derecha.
- Títulos por columna: **Caja recibida en turno anterior** (solo lectura),
  **Caja que recibiste realmente** (editable), **Diferencia de caja recibida**
  (solo lectura).
- Se eliminó la nota «mantén Loggro abierto en el negocio correspondiente».
- Los dos iconos descuadrados eran glifos de texto —`↻` (U+21BB) y el emoji de
  lupa—, y cada uno trae su propia caja y línea base, así que ningún centrado
  del contenedor los cuadraba. Se sustituyeron por iconos de **Phosphor**, que
  la página ya carga: `ph-arrows-clockwise` y `ph-info`. El círculo además se
  centra ahora con `translateY(-50%)` en vez de un `top` fijo.

Detalles de comportamiento:

- La jornada es obligatoria para consultar y para enviar.
- Al elegir fecha y jornada se consulta `turno_existente()` y se avisa ahí
  mismo si ese turno ya fue subido, indicando quién y cuándo, y si quien
  pregunta podría reemplazarlo.
- Cambiar la fecha limpia la caja heredada, que deja de ser válida.
- La diferencia se marca en cuanto es distinta de cero: **tolerancia cero**.
- Al enviar, si el turno existe, el backend responde `requiere_confirmacion` y
  no toca nada. El formulario pide confirmación y un motivo opcional.
- `js/cierre_turno.js` ya no usa `WEBHOOK_SUBIR_CIERRE`: el cierre lo guarda el
  RPC. El import se eliminó.

---

## 5 · Verificaciones superadas

- **Las cinco migraciones aplicadas** con `supabase db push --linked`, sin error.
- **Aserciones de la Fase 2** (si fallan, el push falla): cero filas sin
  `numero_turno` en las dos tablas de cierre; ningún `numero_turno` menor que 1;
  **cero días con huecos** en la numeración; la vista `turnos_sospechosos`
  responde.
- **Aserciones de la Fase 4**: todos los turnos tienen el par sistema/real del
  efectivo de apertura completo, y el recuento de turnos con apertura coincide
  exactamente con el número de turnos.
- **`node --check`** sobre `js/cierre_turno.js`: correcto.
- **Imports**: 0 rotos en los 80+ módulos de `js/`.
- **Elementos del DOM**: los 5 ids nuevos y el `select#numeroTurno` están
  presentes una sola vez en el HTML.
- **Orden de declaración en JS** comprobado: `fecha`, `efectivoApertura` y
  `toNumberValue` se declaran antes del bloque nuevo, sin zona muerta temporal.

---

## 6 · Riesgo conocido, pendiente de decidir

**`js/cierre_turno_auxiliar.js:459` inserta directamente en
`cierres_turno_final`**, sin pasar por `subir_cierre_turno()`:

```js
await supabase.from("cierres_turno_final").insert(rows)
```

Esa vía se salta todo lo que esta ejecución construyó: no pone `numero_turno`,
no es idempotente, no genera las filas de efectivo de apertura y no comprueba
si el turno ya existe. Cualquier cierre subido desde la pantalla auxiliar
volvería a romper el invariante que la Fase 2 acaba de dejar limpio.

Tres salidas:

1. Redirigir esa pantalla al RPC, como se hizo con la principal.
2. Añadir un `trigger` que rechace inserciones sin `numero_turno`, lo que
   dejaría la pantalla auxiliar fallando hasta que se adapte.
3. Dejarlo, si esa pantalla ya no se usa.

**El índice único de la clave nueva no se ha activado todavía** por dos razones:
los 10 días con 3 y 4 registros colisionarían, y esta vía paralela seguiría
insertando. Se activará cuando ambas cosas estén resueltas.

---

## 7 · Reversión de emergencia

Cada migración lleva su bloque de reversión al final, línea por línea. En orden
inverso al de aplicación:

1. `20260822223000` — borra las filas `efectivo_apertura` y la vista.
2. `20260822220000` — reaplicar `subir_cierre_turno()` de la Fase C y borrar las
   dos funciones nuevas.
3. `20260822214000` — borrar `resumen_jornadas()`.
4. `20260822213000` — poner `numero_turno` en NULL y borrar `turnos_sospechosos`.
5. `20260822210000` — borrar las tablas de histórico y las columnas nuevas.

Frontend:

```bash
git checkout <commit-anterior> -- \
  Plataforma_Restaurantes-main/cierre_turno/index.html \
  Plataforma_Restaurantes-main/css/cierre_turno.css \
  Plataforma_Restaurantes-main/js/cierre_turno.js
```

Ningún paso destruye datos de negocio: todo lo añadido es aditivo, y las filas
sobrescritas viven en el histórico.

---

## 8 · Checklist de funcionalidad para logs

### Consola del navegador

| Acción | Señal esperada |
|---|---|
| Elegir fecha y jornada de un turno ya subido | Aviso ámbar bajo la lista con quién y cuándo lo subió |
| Pulsar «Consultar Loggro» | La leyenda bajo «Caja recibida en turno anterior» pasa a `Caja del DD/MM/AAAA turno N` |
| Enviar un turno que ya existe | Diálogo de confirmación; si se cancela, nada cambia |
| Enviar dos veces seguidas (doble clic) | `subir_cierre_turno OK` con `reenvio_ignorado: true` |

### SQL de comprobación

```sql
-- Cómo quedó la numeración
SELECT * FROM public.resumen_jornadas();

-- Días con más de dos jornadas: los duplicados heredados
SELECT * FROM public.turnos_sospechosos;

-- Descuadres de efectivo entre turnos, tolerancia cero
SELECT * FROM public.descuadres_apertura WHERE diferencia <> 0;

-- Sobrescrituras registradas
SELECT fecha_turno, numero_turno, reemplazado_en, reemplazado_por_correo, motivo
FROM public.cierres_turno_historico
ORDER BY reemplazado_en DESC;
```

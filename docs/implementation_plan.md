# Plan definitivo — Dashboard Analítico (`/dashboard/`)

**Fecha:** 2026-08-23 · **Corte 7 — plan final**
**Alcance:** solo lo necesario para que los tableros carguen y escalen.
Fusión de tablas y unificación de usuarios: **aplazadas**, fuera de este plan.
**Estado:** PENDIENTE DE TU VISTO BUENO. La base sigue sin cambios míos.

---

## 1 · Qué falta para que las gráficas funcionen

Dos bloques independientes. El bloque A hace que aparezcan datos; el bloque B
hace que sigan apareciendo rápido cuando tengas 100 empresas.

| | Bloque | Efecto |
|---|---|---|
| **A** | 5 correcciones de SQL | Hoy las tres pestañas dan error. Con esto muestran datos. |
| **B** | 2 índices + filtro por arreglo | El motor deja de recorrer los datos de todos los inquilinos. |

El frontend **no necesita ni un cambio más**: `js/dashboard.js` quedó bien en
las rondas anteriores y el contrato JSON no se altera.

---

## 2 · Bloque A — Las cinco correcciones

Todas reproducidas contra la base, no deducidas.

### A1 · `unnest()` sobre una función que no devuelve arreglo

`app_empresas_visibles()` está declarada `RETURNS SETOF uuid`: ya devuelve
filas. `unnest()` espera un arreglo.

```
ERROR: 42883: function unnest(uuid) does not exist
```

**Aparece 5 veces:** `dashboard_sedes` (×2), `dashboard_conciliacion`,
`dashboard_ventas`, `dashboard_dias_pendientes`.
**Arreglo:** ver A6, que lo resuelve y de paso habilita el índice.

### A2 · `empresas.nombre` no existe

```
ERROR: 42703: column e.nombre does not exist
```

Las columnas reales son `nombre_comercial` y `razon_social`.
**Arreglo:** `COALESCE(NULLIF(btrim(nombre_comercial),''), NULLIF(btrim(razon_social),''), 'Sin nombre')`, igual que hace `js/session.js:359`.

### A3 · La tabla `empresas_locales` no existe

Los locales son filas de `empresas`; la relación madre↔local vive en
`grupos_empresariales`.
**Arreglo:** una sola consulta sobre `empresas`, porque
`app_empresas_visibles()` ya devuelve madre + locales. El tipo se deduce de si
la empresa figura como hija:

```sql
SELECT e.id,
       COALESCE(NULLIF(btrim(e.nombre_comercial), ''),
                NULLIF(btrim(e.razon_social), ''), 'Sin nombre'),
       CASE WHEN EXISTS (SELECT 1 FROM public.grupos_empresariales ge
                         WHERE ge.empresa_id = e.id AND COALESCE(ge.activo, true))
            THEN 'local' ELSE 'principal' END
FROM public.empresas e
WHERE e.id = ANY (v_empresas);
```

Esto cumple lo que pediste: **solo salen las empresas a las que el usuario tiene
acceso**. Probado con tu cuenta: 2 de las 6.

### A4 · La tabla `usuarios` no existe

`dashboard_ventas` hace `LEFT JOIN public.usuarios`. Los responsables están en
dos tablas, y en ambas la columna es `nombre_completo`:

| Tabla | Turnos que resuelve |
|---|---|
| `usuarios_sistema` | 314 |
| `usuarios_locales` | 99 |
| **Total** | **413 — el 100 %** |

**Arreglo:** dos `LEFT JOIN` y un `COALESCE`.

### A5 · El RLS oculta el nombre del responsable de las sedes hermanas

No da error, da datos incompletos. Medido con tu cuenta:

| Sede | Turnos en agosto | Con nombre |
|---|---|---|
| BATUT VIVA (tu empresa) | 42 | **42** |
| BATUT LE MERIDIEM (hermana) | 44 | **0** |

Sin esto, «Turnos Recientes» diría «Desconocido» en 44 de 86 filas.

**Arreglo:** función auxiliar `SECURITY DEFINER`
`app_nombre_responsable(uuid)` que devuelve el nombre **solo si** ese usuario
pertenece a una empresa que ya puedes ver. No abre las tablas de usuarios ni
toca sus políticas: el aislamiento entre clientes queda igual.

### A6 · Resolver las empresas visibles a un arreglo, una sola vez

Reemplaza al `unnest` de A1 y es además lo que habilita el índice del bloque B.
En cada función, al principio:

```sql
DECLARE v_empresas uuid[];
...
v_empresas := ARRAY(SELECT public.app_empresas_visibles());
```

y filtrar con `empresa_id = ANY (v_empresas)`.

Dos ventajas de una: la función se evalúa **una vez** en lugar de por fila, y
el planificador recibe un valor que **sí puede empujar al índice**.

---

## 3 · Bloque B — Que no recorra los datos de todos

### El problema, medido

```
-> Seq Scan on cierres_turno_final
     Rows Removed by Filter: 5150      <-- lee 6.057 para quedarse con 907
Buffers: shared hit=957
```

Cada vez que alguien abre su dashboard, la base recorre los datos de **todos**
los clientes y descarta lo ajeno al final.

### La causa

No hay índice utilizable para `(empresa_id, fecha_turno)`. El único que tiene
esas columnas, `ux_cierres_turno_final_identidad`, es **parcial**
(`WHERE variable <> 'gasto_extra'`) y la vista no lleva esa condición.

### El arreglo

```sql
create index on public.cierres_turno_final          (empresa_id, fecha_turno);
create index on public.cierres_turno_final_locales  (empresa_id, fecha_turno);
```

### Medido, con el índice creado dentro de una transacción y revertida

| Escenario | Plan | Bloques |
|---|---|---|
| Hoy, con `unnest` (falla) / forma actual | `Hash Join` + `Seq Scan` ×2 | **957** |
| Con A6, sin índice | `Seq Scan` ×2 | 645 |
| **Con A6 + los dos índices** | **`Index Scan` ×2** | **457** |
| Una sola empresa, con índice | `Index Scan` ×2 | **83** |

**Cómo leer esto sin exagerar:** hoy tu cuenta ve las dos únicas empresas con
datos de toda la base, así que la mejora inmediata es de ~2× (957 → 457): la
mayoría de lo que lee **sí es tuyo**, y eso es trabajo irreducible.

Lo que cambia de verdad es la **forma de crecer**. Con `Seq Scan` el coste de
tu dashboard sube con los datos de los demás; con `Index Scan` sube solo con los
tuyos. La fila de «una sola empresa» —83 bloques contra 645— es la que enseña
adónde va esto: es el comportamiento que tendrá cada cliente cuando haya 100.

`CREATE INDEX` es aditivo: no modifica ni una fila y se puede borrar para
volver atrás.

---

## 4 · Qué se toca exactamente

### Base de datos

| Objeto | Acción | Correcciones |
|---|---|---|
| `app_nombre_responsable(uuid)` | CREATE (nueva) | A5 |
| `dashboard_sedes()` | REPLACE | A1, A2, A3, A6 |
| `dashboard_conciliacion(date,date,uuid)` | REPLACE | A1, A6 |
| `dashboard_ventas(date,date,uuid)` | REPLACE | A1, A4, A5, A6 |
| `dashboard_dias_pendientes(uuid)` | REPLACE | A1, A6 |
| índice en `cierres_turno_final` | CREATE | B |
| índice en `cierres_turno_final_locales` | CREATE | B |

Las firmas no cambian, así que `CREATE OR REPLACE` basta. **Ningún `DROP`,
`ALTER TABLE`, `DELETE`, `TRUNCATE` ni `UPDATE`.** Nada de esto altera un solo
registro. Cumple las reglas 2 y 3 del proyecto.

### Repositorio

Corregir en su sitio las migraciones `170000`, `180000` y `190000` —nunca se
registraron en el historial remoto— y añadir una nueva con los dos índices.

*Si prefieres historial de solo-añadir*, lo hago todo como una migración nueva y
dejo intactos los archivos viejos. Tu decisión.

### Frontend

**Nada.**

---

## 5 · Verificación

1. Cada función devuelve JSON sin excepción, impersonando tu cuenta.
2. Los números cuadran con lo ya medido: **86 turnos, 34 descuadrados,
   descuadre neto $1.499.130, ventas $114.883.698** en agosto de 2026.
3. La tabla de turnos trae los **86** nombres de responsable, no 42.
4. `EXPLAIN (ANALYZE, BUFFERS)` muestra **`Index Scan`**, no `Seq Scan`.
5. En `http://127.0.0.1:5500/dashboard/` con `Ctrl+F5`: selector con tus dos
   sedes, las dos pestañas con datos, gráficas pintadas, consola limpia.

Los puntos 1-4 los verifico yo y te paso la salida. El 5 lo confirmas tú.

---

## 6 · Fuera de este plan

- Fusión de `cierres_turno_final` con su gemela, y de las otras dos parejas.
- Unificación de `usuarios_sistema` con `usuarios_locales`.
- Cambiar `grupos_empresariales.grupo_id` de `text` a `uuid`.
- Los tres fallos de `nomina-consultar` (incluida la tabla inexistente
  `parametros_nomina_locales`). Están documentados y siguen ahí.
- Reconciliar el registro de migraciones.

Nada de esto bloquea el dashboard.

---

## 7 · Ya aplicado en rondas anteriores

| Cambio | Archivo |
|---|---|
| Desescapados 4 backticks y 9 interpolaciones | `js/dashboard.js` |
| `checkAuth` (inexistente) → `getUserContext` de `session.js` | `js/dashboard.js` |
| Enlace al Libro de Descuadres vía `APP_URLS.libroDescuadres` | `js/dashboard.js` |
| Los `if (!mesStr)` apagan el spinner antes de salir | `js/dashboard.js` |
| Eliminado el `<link>` a `css/dashboard.css` (no existía) | `dashboard/index.html` |
| Servidor movido de `:8000` a `:5500` | — |

---

## 8 · Tu visto bueno

1. **¿Aplico el bloque A** (las cinco correcciones)?
2. **¿Aplico el bloque B** (los dos índices)?
3. **¿Corrijo las migraciones en su sitio o añado una nueva?**

# Documentos para pruebas

Material de referencia real para desarrollar y verificar. **No son datos
inventados**: salieron de sistemas de producción, así que sirven para
comprobar que lo que construimos coincide con lo que el proveedor espera de
verdad.

Esta carpeta vive dentro de `docs/`, que está en la lista `ignore` de
`firebase.json`. Eso es a propósito: **no se publica en
restaurantes.enkrato.com**. Si mueves estos archivos a una carpeta de nivel
superior, quedarían accesibles públicamente en el sitio, y el menú de un
cliente real no debe estar expuesto.

---

## `2026-09-17_menu_rappi_batut_aprobado.json`

El último menú que Batut envió a Rappi y que **Rappi aceptó y aprobó**.

| | |
|---|---|
| Tienda | `900170987` (Batut) |
| Productos | 50 |
| Toppings | 473 |
| Secciones | 8 |

**Es el modelo a replicar, literal.** El análisis completo de su estructura
—las siete reglas del contrato de Rappi que hoy incumplimos— está en
`docs/2026-09-22_plan_menu_guias_dashboard.md`, sección 2.5. Léelo antes de
tocar `construirItems()` en `supabase/functions/rappi-menu/index.ts`.

Resumen de lo que hay que mirar en este archivo:

- `items[].category` es **la sección del menú** (lo que agrupa los productos
  en la app de Rappi). Lleva solo `id`, `name`, `sortingPosition`.
- `sortingPosition` empieza en **1** y en los productos **reinicia dentro de
  cada sección**.
- `minQty` / `maxQty` viven en `children[].category`, o sea son propiedad del
  grupo **dentro de ese producto**, no globales.
- `maxLimit` (en el topping) es otra cosa: cuántas unidades de esa misma
  opción puede repetir el cliente.
- Cada grupo de opciones tiene un `id` **único por producto**. Ninguno se
  comparte entre productos.
- 20 de los 50 productos no tienen `children`, y **ninguno** trae `imageUrl`:
  ambas cosas son válidas.

Úsalo como caso de prueba: importarlo, reconstruir el payload y comparar
campo por campo contra el original. Si coinciden, replicamos a Rappi bien.

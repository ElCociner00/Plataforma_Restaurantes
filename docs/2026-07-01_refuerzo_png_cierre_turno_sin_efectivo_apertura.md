# 2026-07-01 - Refuerzo PNG cierre turno sin efectivo apertura

## 1. Objetivo de la petición

Reforzar la captura/imagen PNG del módulo **Cierre turno** para que el valor mostrado como **Total ventas (sin efectivo apertura)** no arrastre el efectivo de apertura cuando ciertos locales o cuentas dejan ese valor sumado dentro del efectivo real del turno.

El ajuste es una capa aislada de presentación para la constancia visual. No modifica login, sesión, contexto, header, webhooks, payloads de envío ni los datos que llegan desde el sistema.

## 2. Archivos implicados y modificaciones

### `js/cierre_turno_png.js` (modificado)

- Tipo de modificación: refuerzo aislado en el generador PNG de cierre turno.
- Objetivo: descontar el efectivo de apertura del total visual de ventas usado en la captura.
- Qué hace explícitamente:
  - Agrega `toPngNumber(value)` para convertir valores monetarios/textuales a número dentro del archivo PNG sin depender de otros módulos.
  - Permite que `getSnapshotRows` reciba `meta`, donde ya viaja `efectivoApertura` desde `js/cierre_turno.js` y `js/cierre_turno_auxiliar.js`.
  - Calcula `totalVentasSinApertura = totalReal - efectivoApertura` solo para el resumen visual del PNG.
  - Cambia la fila de totales de `Total ventas` a `Total ventas (sin efectivo apertura)` para dejar explícita la regla aplicada.
  - Usa `totalVentasSinApertura` en la tarjeta destacada del PNG que ya decía **Total ventas (sin efectivo apertura)**.

## 3. Notas de emergencia para revertir

### Revertir `js/cierre_turno_png.js`

1. Borrar el helper agregado al inicio del archivo:

```js
const toPngNumber = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  let text = String(value).trim();
  if (!text) return 0;
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  text = text.replace(/\$/g, "").replace(/\s+/g, "");
  if (hasComma && hasDot) {
    text = text.lastIndexOf(",") > text.lastIndexOf(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    text = text.replace(/\./g, "").replace(/,/g, ".");
  }
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
```

2. En la firma de `getSnapshotRows`, volver de:

```js
const getSnapshotRows = ({
  snapshotContext,
  meta = {}
}) => {
```

 a:

```js
const getSnapshotRows = ({
  snapshotContext
}) => {
```

3. En el bloque de totales, reemplazar la versión con `efectivoApertura`, `totalVentasSinApertura` y `totalSistemaSinApertura` por la versión anterior:

```js
const ventaBruta = totalReal;
const ventaNeta = totalReal - totalGastos;
const diferenciaGeneral = totalReal - totalSistema;

const totales = [
  ["Total ingresos sistema", totalSistema],
  ["Total ventas", totalReal],
  ["Total gastos", totalGastos],
  ["Venta bruta (sin gastos)", ventaBruta],
  ["Venta neta (después de gastos)", ventaNeta],
  ["Diferencia general", diferenciaGeneral]
];
```

4. Volver a retornar únicamente:

```js
return { finanzas, gastos, totales, apoyos };
```

5. En `descargarImagenResumenCierreTurno`, volver a llamar:

```js
const { finanzas, gastos, totales, apoyos } = getSnapshotRows({ snapshotContext });
```

6. En la tarjeta destacada, volver a usar:

```js
ctx.fillText(formatCOP(snapshotContext.getTotalIngresosReales()), tableX + 470, startY);
```

7. Validar sintaxis:

```bash
node --check js/cierre_turno_png.js
```

## 4. Guía para exportar este parche a otro repositorio

1. Confirmar que el repositorio destino tenga un generador PNG equivalente para cierre turno.
2. Verificar cómo llega el efectivo de apertura al generador. En este repositorio ya llega en `meta.efectivoApertura` desde los cierres principal y auxiliar.
3. Copiar `toPngNumber(value)` si el destino no tiene un normalizador numérico local para valores monetarios.
4. Ajustar el cálculo visual de ventas para que use `totalReal - efectivoApertura` en la captura, sin alterar los valores recibidos desde webhooks ni inputs originales.
5. Particularidad de este repositorio: las URLs de webhooks están centralizadas en `js/webhooks.js`, pero este parche no crea ni modifica URLs. No se debe tocar `js/webhooks.js` para portar esta mejora.
6. Validar que el destino no tenga otro archivo encargado de generar la constancia PNG. Si existe, priorizar modificar ese archivo central en vez de duplicar lógica.
7. Ejecutar:

```bash
node --check js/cierre_turno_png.js
```

## 5. Check funcional para logs

- Cierre turno / PNG: funciona; la tarjeta **Total ventas (sin efectivo apertura)** descuenta `efectivoApertura`.
- Cierre turno / tabla de totales PNG: funciona; la fila queda explícita como **Total ventas (sin efectivo apertura)**.
- Cierre turno / datos originales en pantalla: no se modificaron.
- Cierre turno / envío de datos: no se modificó.
- Cierre turno auxiliar / PNG: conserva compatibilidad porque usa el mismo generador PNG y también envía `meta.efectivoApertura`.
- Login / sesión / contexto / header: no se modificaron.
- Nómina: no se modificó en este parche.

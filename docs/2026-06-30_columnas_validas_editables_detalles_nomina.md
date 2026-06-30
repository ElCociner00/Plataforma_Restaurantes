# 2026-06-30 - Columnas válidas editables en detalles de nómina

## 1. Objetivo de la petición

Agregar en el módulo de nómina, dentro de la tabla **Detalles**, cuatro columnas adicionales y editables para que administración pueda ajustar manualmente las horas que sí deben participar en el cálculo monetario, sin sobrescribir ni ocultar las horas reales calculadas originalmente.

Las columnas originales **Diurnas**, **Nocturnas**, **Dom. diurnas** y **Dom. nocturnas** siguen mostrándose como referencia. Las nuevas columnas **Diurnas vál.**, **Nocturnas vál.**, **Dom. diurnas vál.** y **Dom. nocturnas vál.** son las que se usan para multiplicar por los parámetros monetarios y definir los valores de ingresos de nómina.

## 2. Archivos implicados y modificaciones

### `nomina/index.html` (modificado)

- Tipo de modificación: cambio de estructura visual en una tabla existente del módulo de nómina.
- Objetivo: añadir los encabezados de las 4 columnas duplicadas/editables en la tabla **Detalles**.
- Qué hace explícitamente: conserva las columnas reales y agrega:
  - `Diurnas vál.`
  - `Nocturnas vál.`
  - `Dom. diurnas vál.`
  - `Dom. nocturnas vál.`

### `js/nomina.js` (modificado)

- Tipo de modificación: lógica aislada dentro del módulo de nómina.
- Objetivo: renderizar inputs editables para las 4 columnas válidas y usar esos valores en el cálculo monetario.
- Qué hace explícitamente:
  - Crea la constante `PAYROLL_DETAIL_FIELDS` para centralizar las cuatro columnas de horas afectadas.
  - Crea `getDetalleEditableValue(row, field, calculatedTimes)` para resolver el valor válido editable; si el admin no ha escrito nada, usa el valor real calculado como respaldo.
  - En `renderParametrosYDetalle`, añade un `<input>` por cada columna válida en cada fila de la tabla **Detalles**.
  - En `calculateMoneyByDetail`, sustituye únicamente la base de cálculo monetario por las columnas válidas, manteniendo intactas las horas reales de referencia.
  - Reutiliza el listener existente de `.nomina-detalle-horas`, por lo que los cambios se recalculan al modificar una celda editable sin agregar dependencias externas.

## 3. Notas de emergencia para revertir

### Revertir `nomina/index.html`

1. Ubicar la tabla con título **Detalles**.
2. En el `<thead>`, reemplazar el encabezado actual:

```html
<thead><tr><th>Validar</th><th>Fecha</th><th>Día</th><th>Horario</th><th>Diurnas</th><th>Nocturnas</th><th>Dom. diurnas</th><th>Dom. nocturnas</th><th>Diurnas vál.</th><th>Nocturnas vál.</th><th>Dom. diurnas vál.</th><th>Dom. nocturnas vál.</th></tr></thead>
```

por el encabezado anterior:

```html
<thead><tr><th>Validar</th><th>Fecha</th><th>Día</th><th>Horario</th><th>Diurnas</th><th>Nocturnas</th><th>Dom. diurnas</th><th>Dom. nocturnas</th></tr></thead>
```

### Revertir `js/nomina.js`

1. Borrar el bloque agregado después de `calculateDetalleTimes`:

```js
const PAYROLL_DETAIL_FIELDS = [
  ["horas_diurnas", "Diurnas"],
  ["horas_nocturnas", "Nocturnas"],
  ["horas_dominicales_diurnas", "Dom. diurnas"],
  ["horas_dominicales_nocturnas", "Dom. nocturnas"]
];

const getDetalleEditableValue = (row, field, calculatedTimes = null) => {
  const validField = `${field}_validas`;
  const rawValue = row?.[validField];
  if (rawValue !== null && rawValue !== undefined && String(rawValue).trim() !== "") return rawValue;
  const calculated = calculatedTimes || calculateDetalleTimes(row || {});
  return calculated[field] || "00:00";
};
```

2. En `calculateMoneyByDetail`, reemplazar:

```js
const calculatedTimes = calculateDetalleTimes(row);
const effectiveTimes = PAYROLL_DETAIL_FIELDS.reduce((acc, [field]) => {
  acc[field] = getDetalleEditableValue(row, field, calculatedTimes);
  return acc;
}, {});
const base = { ...row, ...calculatedTimes, ...effectiveTimes };
```

por:

```js
const calculatedTimes = calculateDetalleTimes(row);
const base = { ...row, ...calculatedTimes };
```

3. En `renderParametrosYDetalle`, eliminar el bloque `editableCells` y quitar `${editableCells}` del `<tr>` de detalles, dejando nuevamente solo las cuatro celdas reales:

```js
<td>${calculated.horas_diurnas}</td><td>${calculated.horas_nocturnas}</td><td>${calculated.horas_dominicales_diurnas}</td><td>${calculated.horas_dominicales_nocturnas}</td>
```

4. Ejecutar validación sintáctica:

```bash
node --check js/nomina.js
```

## 4. Guía para exportar este cambio a otro repositorio

Se realizaron cambios puntuales, no masivos, en el módulo de nómina. Para portar el parche a otro repositorio:

1. Copiar la modificación de encabezados de `nomina/index.html` en la tabla **Detalles**.
2. Copiar en `js/nomina.js` la constante `PAYROLL_DETAIL_FIELDS` y la función `getDetalleEditableValue` cerca de las utilidades de cálculo de horas.
3. Adaptar el render de filas de detalles para crear inputs con clase `nomina-detalle-horas` y `data-field="horas_*_validas"`.
4. Adaptar el cálculo monetario para que use los valores válidos editables como base de multiplicación.
5. Verificar que el repositorio destino tenga un listener compatible para `.nomina-detalle-horas`; en este repositorio ya existía y por eso se reutilizó sin crear una dependencia nueva.
6. Particularidad de este repositorio: las URLs de webhooks están centralizadas en `js/webhooks.js`, pero este cambio no agrega ni modifica URLs. Si el repositorio destino centraliza rutas/URLs de otra forma, no hay que añadir entradas nuevas para esta mejora.
7. Validar que no existan scripts externos que dependan del número exacto de columnas de la tabla **Detalles**. Si existen exportadores o capturadores por índice fijo, deberán actualizarse para ignorar o manejar las cuatro columnas nuevas.
8. Ejecutar como mínimo:

```bash
node --check js/nomina.js
```

## 5. Check funcional para logs

- Nómina / consulta: funciona con el flujo existente; no se tocaron webhooks ni sesión.
- Tabla Detalles: funciona; muestra horas reales y cuatro columnas válidas editables.
- Cálculo monetario: funciona; multiplica usando las columnas válidas editables.
- Valores originales: funcionan; permanecen visibles y no se sobrescriben al editar valores válidos.
- Parámetros de cálculo: funcionan; siguen relacionando conceptos contra las mismas llaves internas de horas.
- Login / sesión / contexto / header: no se modificaron.
- Cierre de turno: no se modificó.
- Cierre de inventario: no se modificó.

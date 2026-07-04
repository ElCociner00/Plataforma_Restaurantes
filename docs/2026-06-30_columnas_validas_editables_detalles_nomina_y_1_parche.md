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

---

# Parche posterior 1 - 2026-07-04 - Compatibilidad de renderizado en navegadores para nómina

## 1. Objetivo del parche

Corregir un fallo de compatibilidad que podía dejar el módulo de nómina en blanco en ciertos navegadores después de consultar datos correctamente. El problema no estaba en la entrega del webhook ni en Supabase: el riesgo estaba en la ejecución del JavaScript de interfaz, donde algunos navegadores podían detener el renderizado por APIs no disponibles o por una función auxiliar referenciada sin definición.

Este parche mantiene intacta la petición original de columnas válidas editables en **Detalles** y solo refuerza la compatibilidad para que la tabla y los demás campos se sigan pintando cuando la respuesta de nómina llega con estructuras JSON anidadas o cuando el navegador no soporta `String.prototype.replaceAll`.

## 2. Archivos implicados y modificación realizada

### `js/nomina.js` (modificado)

- **Tipo de modificación:** parche de compatibilidad y estabilidad de renderizado en el módulo de nómina.
- **Objetivo:** evitar que navegadores con soporte parcial de JavaScript moderno detengan la ejecución del módulo y dejen las tablas sin renderizar.
- **Qué hace explícitamente:**
  1. Se agregó la función `normalizeJsonLikeValue(value, maxDepth = 8)` cerca de los extractores profundos de payloads de nómina.
     - Intenta convertir cadenas JSON anidadas de forma segura.
     - Devuelve `null` si la cadena está vacía.
     - Devuelve el valor original si no se puede parsear, evitando una excepción no controlada.
     - Atiende la referencia que ya existía dentro de `extractPayrollArrayCandidates`.
  2. Se reemplazó `tipo.replaceAll("_", " ")` por `String(tipo).replace(/_/g, " ")`.
     - La salida visual es la misma: convierte claves como `horas_diurnas` en `horas diurnas`.
     - Mejora compatibilidad con navegadores que no implementan `replaceAll`.

### Archivos creados

- No se crearon archivos funcionales nuevos.
- Se renombró esta documentación de `docs/2026-06-30_columnas_validas_editables_detalles_nomina.md` a `docs/2026-06-30_columnas_validas_editables_detalles_nomina_y_1_parche.md` para cumplir la regla de documentación de parches posteriores.

### Archivos borrados

- No se borraron archivos funcionales.
- El archivo documental anterior sin sufijo de parche dejó de existir por renombrado controlado con `git mv`.

## 3. Notas de emergencia para revertir este parche

> Revertir solo si se confirma que el navegador destino soporta `replaceAll` y que `extractPayrollArrayCandidates` no será usado por ningún flujo actual o futuro. En emergencia, revertir preferiblemente con Git para evitar borrar documentación accidentalmente.

### Revertir `js/nomina.js`

1. Ubicar el bloque agregado después de `deepExtractPayrollObject` y antes de `extractPayrollArrayCandidates`.
2. Eliminar completamente este fragmento:

```js
const normalizeJsonLikeValue = (value, maxDepth = 8) => {
  let current = value;
  for (let depth = 0; depth < maxDepth && typeof current === "string"; depth += 1) {
    const text = current.trim();
    if (!text) return null;
    try {
      current = JSON.parse(text);
    } catch (_error) {
      return value;
    }
  }
  return current;
};
```

3. Ubicar dentro de `normalizeNominaWebhookRows`, en `fromPrototypePayload`, la creación de filas con `Object.entries(candidate.detalle_horas || {})`.
4. Cambiar esta línea:

```js
tipo: `Horas ${String(tipo).replace(/_/g, " ")}`,
```

por la versión anterior:

```js
tipo: `Horas ${tipo.replaceAll("_", " ")}`,
```

5. Validar inmediatamente:

```bash
node --check js/nomina.js
```

### Revertir documentación

Si se necesita volver al nombre documental anterior:

```bash
git mv docs/2026-06-30_columnas_validas_editables_detalles_nomina_y_1_parche.md docs/2026-06-30_columnas_validas_editables_detalles_nomina.md
```

Luego eliminar la sección **Parche posterior 1 - 2026-07-04 - Compatibilidad de renderizado en navegadores para nómina** de ese archivo.

## 4. Indicaciones para exportar este parche a otro repositorio

Se realizó un parche pequeño sobre un cambio más grande ya existente. Para exportarlo a otro repositorio:

1. **Identificar el archivo equivalente a `js/nomina.js`.**
   - En este repositorio, `js/nomina.js` consume las URLs centralizadas desde `js/webhooks.js`, específicamente `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO`.
   - No se debe codificar una URL directa en el parche; el repositorio destino debe conservar su archivo central de webhooks/URLs y mantener el import equivalente.
2. **Copiar la función `normalizeJsonLikeValue` cerca de los extractores/normalizadores profundos.**
   - Debe quedar disponible antes de cualquier función que la llame.
   - En este repositorio la función relacionada es `extractPayrollArrayCandidates`, que intenta recorrer payloads anidados.
3. **Reemplazar usos de `replaceAll` en el flujo de nómina por expresiones regulares globales compatibles.**
   - Cambio puntual aplicado aquí: `tipo.replaceAll("_", " ")` -> `String(tipo).replace(/_/g, " ")`.
   - Antes de aplicar en destino, buscar si hay más `replaceAll` en archivos críticos que se ejecuten al cargar módulos web.
4. **Validar que el HTML destino tenga los IDs que `js/nomina.js` renderiza.**
   - Especialmente: `nominaDetalleCalculoBody`, `nominaParametrosBody`, `nominaParametrosTiempoBody`, `nominaParametrosCalculoBody`, `nominaDetallesCalculosBody`, `nominaApoyosBody`, `nominaIngresosBody`, `nominaDeduccionesBody`.
5. **Validar que no exista otro normalizador que ya haga esta función.**
   - Si el destino ya tiene una función equivalente para parsear JSON anidado, priorizar esa función existente y solo ajustar la referencia para evitar duplicidad.
6. **Validaciones mínimas después de portar:**

```bash
node --check js/nomina.js
rg -n "replaceAll|normalizeJsonLikeValue|extractPayrollArrayCandidates" js/nomina.js
```

7. **Prueba funcional manual recomendada:**
   - Abrir nómina en un navegador donde antes quedaba en blanco.
   - Seleccionar empleado y rango.
   - Consultar nómina.
   - Confirmar que **Detalles**, **Parámetros**, **Detalles cálculos**, **Ingresos**, **Deducciones** y **Apoyos** se renderizan.

## 5. Check de funcionamiento para logs

- Login/sesión/contexto: no se modificó; debe seguir funcionando igual que antes.
- Consulta de nómina por webhook centralizado: funciona a nivel de código; no se cambió URL ni payload.
- Render de tabla **Detalles**: corregido a nivel de compatibilidad; conserva columnas reales y columnas válidas editables.
- Cálculo monetario desde columnas válidas: se conserva; no se modificó la fórmula funcional.
- Exportación Excel empleado: se conserva; no se modificó el flujo de descarga.
- Comprobante PNG: se conserva; no se modificó el flujo de descarga.
- Navegadores con soporte parcial de `replaceAll`: parche aplicado para evitar fallo por esa API en el flujo prototipo de nómina.
- Payloads JSON anidados: parche aplicado para que la referencia `normalizeJsonLikeValue` exista y no provoque un corte de ejecución si se activa ese extractor.

## 6. Validaciones ejecutadas

```bash
node --check js/nomina.js
```

Resultado: correcto, el archivo queda con sintaxis JavaScript válida.

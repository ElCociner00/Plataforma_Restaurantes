# 2026-07-04 - Compatibilidad de renderizado monetario en cierre de turnos

## 1. Objetivo de la petición

Corregir el problema de renderizado de valores monetarios reportado en **Cierre de turno**, donde algunos navegadores podían mostrar campos monetarios en blanco, mal interpretados o sin formato aunque la consulta de datos sí estuviera llegando correctamente.

La causa probable no estaba en los webhooks ni en la entrega de datos, sino en la capa web de interfaz: algunos valores monetarios podían llegar o quedar escritos como texto formateado (`$1.234,00`, `1,234.00`, `1.234`) y la función local de conversión numérica no los interpretaba correctamente. Además, el decorador visual de contabilidad usaba `Intl.NumberFormat` de forma directa al cargar el archivo, lo que podía afectar navegadores con soporte incompleto de `Intl`.

## 2. Archivos implicados y modificaciones realizadas

### `js/cierre_turno.js` (modificado)

- **Tipo de modificación:** corrección funcional de compatibilidad numérica en el módulo principal de cierre de turno.
- **Objetivo:** hacer que los cálculos y totalizados acepten tanto números planos como valores monetarios escritos o renderizados con separadores de miles/decimales.
- **Qué hace explícitamente:**
  - Reemplaza la conversión directa `Number(value)` por un parser tolerante.
  - Acepta valores como `1000`, `1.000`, `1,000`, `$1.000,00`, `$1,000.00` y negativos.
  - Detecta el último separador (`.` o `,`) para decidir cuál funciona como decimal cuando aparecen ambos.
  - Retira símbolos monetarios y espacios sin perder el signo negativo.
  - Evita que un valor formateado se convierta en `0` por error y dañe los totales de ingresos, gastos, venta neta o diferencia general.

### `js/cierre_turno_auxiliar.js` (modificado)

- **Tipo de modificación:** corrección equivalente en la contingencia manual/auxiliar de cierre de turno.
- **Objetivo:** mantener el mismo comportamiento numérico robusto en el cierre auxiliar para que no exista diferencia entre flujo principal y flujo de respaldo.
- **Qué hace explícitamente:**
  - Aplica el mismo parser tolerante de valores monetarios usado en `js/cierre_turno.js`.
  - Protege totales y diferencias cuando el valor llega con `$`, puntos, comas o signo negativo.

### `js/cierre_turno_contabilidad_visual.js` (modificado)

- **Tipo de modificación:** compatibilidad de renderizado visual de moneda.
- **Objetivo:** evitar que el formateador visual falle en navegadores donde `Intl` o `Intl.NumberFormat` no estén disponibles o estén incompletos.
- **Qué hace explícitamente:**
  - Crea `currencyFormatter` solo si `Intl.NumberFormat` existe.
  - Si `Intl` no está disponible, usa un formateador manual compatible con COP (`$1.234,00`).
  - Mantiene el formateo visual en navegadores modernos sin cambiar el valor real de los inputs.

### Archivos creados

- `docs/2026-07-04_compatibilidad_renderizado_monetario_cierre_turnos.md`
  - Documenta este parche, sus objetivos, archivos implicados, reversión de emergencia, portado a otro repositorio y checks de funcionamiento.

### Archivos borrados

- No se borraron archivos funcionales.

## 3. Notas de emergencia para revertir estos cambios

> Revertir solo si se confirma que el problema no está relacionado con valores monetarios formateados ni con soporte parcial de `Intl`. Si hay emergencia, revertir primero con Git; si no es posible, aplicar las instrucciones manuales siguientes.

### Revertir `js/cierre_turno.js`

1. Ubicar la función `toNumberValue` cerca del inicio del módulo, antes de `formatCOP`.
2. Reemplazar el parser tolerante actual por la versión anterior:

```js
const toNumberValue = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
```

3. Validar:

```bash
node --check js/cierre_turno.js
```

### Revertir `js/cierre_turno_auxiliar.js`

1. Ubicar la función `toNumberValue` cerca de `setStatus` y antes de `formatCOP`.
2. Reemplazar el parser tolerante actual por la versión anterior:

```js
const toNumberValue = (value) => {
  const clean = String(value ?? "").replace(/[^0-9.-]/g, "");
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : 0;
};
```

3. Validar:

```bash
node --check js/cierre_turno_auxiliar.js
```

### Revertir `js/cierre_turno_contabilidad_visual.js`

1. Ubicar la definición de `currencyFormatter` al inicio del archivo.
2. Reemplazar la versión condicional por la versión anterior:

```js
const currencyFormatter = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
```

3. Ubicar `formatMoneyValue(value)`.
4. Reemplazar su cuerpo por la versión anterior:

```js
function formatMoneyValue(value) {
  const amount = parseMoneyValue(value);
  return amount === null ? "" : currencyFormatter.format(amount).replace(/\s+/g, " ");
}
```

5. Validar:

```bash
node --check js/cierre_turno_contabilidad_visual.js
```

### Revertir documentación

Eliminar este archivo documental si se revierte completamente el parche:

```bash
git rm docs/2026-07-04_compatibilidad_renderizado_monetario_cierre_turnos.md
```

## 4. Indicaciones para exportar este cambio a otro repositorio

Se realizaron cambios puntuales pero sensibles porque afectan totalizados monetarios. Para portarlos a otro repositorio:

1. **Identificar los archivos equivalentes del flujo de cierre de turno.**
   - En este repositorio el flujo principal vive en `js/cierre_turno.js`.
   - El flujo auxiliar/manual vive en `js/cierre_turno_auxiliar.js`.
   - El decorador visual de campos monetarios vive en `js/cierre_turno_contabilidad_visual.js`.
2. **Conservar la centralización de URLs.**
   - Este parche no cambia URLs, pero el repositorio usa `js/webhooks.js` para centralizar webhooks de cierre de turno: `WEBHOOK_CONSULTAR_DATOS_CIERRE`, `WEBHOOK_VERIFICAR_CIERRE`, `WEBHOOK_SUBIR_CIERRE`, entre otros.
   - Si el repositorio destino tiene URLs codificadas directamente en módulos, centralizarlas primero en su equivalente de `js/webhooks.js` antes de mezclar cambios funcionales.
3. **Portar el parser monetario como unidad funcional.**
   - Copiar la nueva función `toNumberValue` a los módulos que calculan totales de cierre.
   - Verificar si ya existe un parser equivalente (`parseMoneyValue`, `toNumeric`, `parseCurrency`). Si existe, priorizar unificar en una sola función para no duplicar reglas.
4. **Portar el fallback visual de `Intl`.**
   - En el archivo equivalente a `js/cierre_turno_contabilidad_visual.js`, crear el formateador solo cuando `Intl.NumberFormat` exista.
   - Mantener un fallback manual que pinte COP en formato `$1.234,00`.
5. **Validar interferencias.**
   - Revisar si algún input monetario guarda el valor real en formato texto plano. Este parche no cambia lo que se guarda, solo mejora cómo se interpreta y se muestra.
   - Revisar si otros scripts envuelven los mismos inputs; no deben duplicar wrappers visuales sobre los IDs definidos en `MONEY_INPUT_IDS`.
6. **Validaciones mínimas en el repositorio destino:**

```bash
node --check js/cierre_turno.js
node --check js/cierre_turno_auxiliar.js
node --check js/cierre_turno_contabilidad_visual.js
rg -n "toNumberValue|currencyFormatter|formatMoneyValue|MONEY_INPUT_IDS" js/cierre_turno.js js/cierre_turno_auxiliar.js js/cierre_turno_contabilidad_visual.js
```

7. **Prueba manual recomendada:**
   - Abrir cierre de turno.
   - Consultar datos del cierre.
   - Confirmar que efectivo, datáfono, Rappi, Nequi, transferencias, bono regalo, propina y domicilios se visualizan.
   - Confirmar que totalizados muestran ingresos sistema, ingresos reales, gastos, venta bruta, venta neta y diferencia general.
   - Escribir manualmente valores como `$1.000,00`, `1,000.00` y `1000` en campos reales editables y verificar que el cálculo no queda en cero.

## 5. Check de funcionamiento para logs

- Cierre turno principal: corregido; los valores monetarios formateados ya no deberían convertirse en cero por `Number(value)`.
- Cierre turno auxiliar: corregido con el mismo parser para mantener contingencia consistente.
- Render visual de contabilidad de cierre turno: corregido; si `Intl.NumberFormat` no existe, usa fallback manual.
- Webhooks de cierre turno: no se modificaron; siguen centralizados en `js/webhooks.js`.
- Nómina: no se modificó en este parche adicional.
- Cierre inventario: no se modificó.
- Login/sesión/contexto/header: no se modificaron.
- Exportaciones PNG de cierre turno: no se modificaron; reciben `formatCOP` desde el flujo principal como antes.

## 6. Validaciones ejecutadas

```bash
node --check js/cierre_turno.js
node --check js/cierre_turno_auxiliar.js
node --check js/cierre_turno_contabilidad_visual.js
```

Resultado: los tres archivos quedan con sintaxis JavaScript válida.

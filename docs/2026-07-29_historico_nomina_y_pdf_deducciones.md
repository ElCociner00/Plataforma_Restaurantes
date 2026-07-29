# 2026-07-29 - Histórico nómina y PDF de deducciones

## 1. Objetivo de la petición

Conectar el submódulo **Histórico Nómina** al webhook real `https://n8n.enkrato.com/webhook/nomina_historico_consultar`, cargar responsables desde la misma fuente reutilizable que otros módulos como cierre de turno, listar cada nómina en filas resumidas con solo **fecha** y **empleado**, y abrir el detalle en un panel/submódulo separado al seleccionar una fila. Además, mejorar el PDF de autorización de deducciones: texto justificado, espacio visible para firma del trabajador y nombre de archivo final `Autorización Deducciones.pdf`.

## 2. Archivos implicados y modificaciones

### `js/webhooks.js`
- **Tipo de modificación:** ajuste de URL centralizada y descripción del webhook de histórico.
- **Objetivo:** mantener la particularidad del repositorio: las URLs no se hardcodean en los módulos, se importan desde el archivo central `js/webhooks.js`.
- **Qué hace explícitamente:** `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR` ahora apunta a `https://n8n.enkrato.com/webhook/nomina_historico_consultar`; el registro `WEBHOOKS.NOMINA_HISTORICO_RENDERIZAR` conserva trazabilidad de consumidores y método `POST`.

### `nomina/historico.html`
- **Tipo de modificación:** actualización no intrusiva de la estructura visual del submódulo histórico.
- **Objetivo:** reemplazar el filtro libre de empleado por un selector de responsables/empleados, simplificar la tabla a dos columnas y agregar un panel de detalle separado.
- **Qué hace explícitamente:** el listado muestra columnas `Fecha` y `Empleado`; el selector `historicoNominaEmpleado` se llena por JavaScript; `historicoNominaListadoPanel` y `historicoNominaDetallePanel` permiten navegar visualmente entre listado y detalle sin tocar login, sesión, contexto ni header.

### `js/nomina_historico.js`
- **Tipo de modificación:** conexión funcional y normalización de datos.
- **Objetivo:** consultar el webhook automáticamente al ingresar, enviar token/tenant con `buildRequestHeaders({ includeTenant: true })`, resolver nombres de responsables, filtrar por rango de fechas/responsable y renderizar detalle separado.
- **Qué hace explícitamente:**
  - Importa `fetchResponsablesActivos` desde `js/responsables.js` para cargar empleados como en cierre de turno.
  - Crea `state` local aislado para contexto, responsables y nóminas recibidas.
  - Convierte la fecha en DOM con `Intl.DateTimeFormat("es-CO", { day, month: "long", year })` para mostrar mes en texto.
  - Resuelve el empleado por `empleado_nombre`, `responsable_nombre`, `responsable_id` o por los ingresos recibidos.
  - Mantiene filtros de rango de fechas y responsable sobre las filas normalizadas.
  - Al hacer clic en una fila, oculta el listado y muestra el detalle en `historicoNominaDetallePanel`.

### `css/nomina.css`
- **Tipo de modificación:** estilos aislados para histórico de nómina.
- **Objetivo:** dar affordance visual a filas seleccionables y al submódulo de detalle, usando la gama existente de blancos, grises suaves e índigos claros.
- **Qué hace explícitamente:** agrega hover para filas, panel de detalle, tarjetas de resumen y botón secundario sin alterar estilos globales de login, sesión, contexto o header.

### `js/nomina.js`
- **Tipo de modificación:** parche del PDF de autorización de deducciones.
- **Objetivo:** mejorar legibilidad del documento exportado y corregir el nombre del archivo enviado al webhook.
- **Qué hace explícitamente:**
  - Mantiene el texto del PDF generado localmente con párrafos justificados mediante espaciado de palabras por línea (`drawJustifiedParagraph`).
  - Baja la línea de firma y los textos de nombre/C.C. para dejar espacio real debajo de `Firma del trabajador`.
  - Añade una línea visible en la plantilla HTML alternativa de autorización.
  - Cambia el nombre del archivo adjunto a `Autorización Deducciones.pdf`.

## 3. Notas de emergencia para revertir

> Antes de revertir, guardar evidencia del comportamiento actual y confirmar si n8n ya migró el webhook a `nomina_historico_consultar`.

### Revertir `js/webhooks.js`
1. Buscar la constante `WEBHOOK_NOMINA_HISTORICO_RENDERIZAR`.
2. Cambiar la URL de vuelta a:
   ```js
   "https://n8n.enkrato.com/webhook/nomina_historico_renderizar";
   ```
3. En el objeto `WEBHOOKS.NOMINA_HISTORICO_RENDERIZAR`, revertir la descripción a la anterior si se necesita auditoría histórica.

### Revertir `nomina/historico.html`
1. Cambiar el `<select id="historicoNominaEmpleado">` por el input anterior:
   ```html
   <input id="historicoNominaEmpleado" type="search" placeholder="Nombre o documento">
   ```
2. Reemplazar la tabla de dos columnas por la tabla antigua con `Seleccionar`, `Periodo`, `Empleado`, `Sedes`, `Estado`.
3. Eliminar el bloque completo `historicoNominaDetallePanel` y el botón `historicoNominaVolver`.
4. Cambiar el mensaje de estado para apuntar de nuevo a `nomina_historico_renderizar` si también se revierte el webhook.

### Revertir `js/nomina_historico.js`
1. Quitar el import:
   ```js
   import { fetchResponsablesActivos } from "./responsables.js";
   ```
2. Eliminar `state`, `cargarResponsables`, `normalizeResponsablesPayload`, `getResponsableNombre`, `getEmpleadoNombre`, `getRowDate`, `filterHistoricoRows` y `renderDetalle`.
3. Restaurar `buildHistoricoRequestPayload` para obtener contexto internamente con `getUserContext()` y enviar `empleado` como texto libre.
4. Restaurar `renderHistoricoRows()` para pintar las cinco columnas antiguas.
5. Quitar listeners de fila y botón volver en `init()` o volver al flujo anterior de carga directa.

### Revertir `css/nomina.css`
Borrar el bloque agregado al final del archivo:
```css
.nomina-historico-row { ... }
.nomina-historico-row:hover { ... }
.nomina-detail-panel { ... }
.nomina-detail-grid { ... }
.nomina-detail-card { ... }
.nomina-detail-card span { ... }
.nomina-secondary-btn { ... }
```

### Revertir `js/nomina.js`
1. En `createSimplePdf()`, restaurar posiciones de firma:
   - `Nombre` en y `168`.
   - `C.C.` en y `152`.
   - texto empleador en y `152`.
   - línea en `72 184 ... 330 184 ...`.
2. En `buildAutorizacionDeduccionesHtml()`, quitar `.firma-linea`, regresar `.firma h3` a `margin: 0 0 12px;` y eliminar `<div class="firma-linea"></div>`.
3. En `enviarDeduccionesNomina()`, si se requiere el nombre técnico anterior, cambiar:
   ```js
   formData.append("pdf", pdfBlob, "Autorización Deducciones.pdf");
   ```
   por:
   ```js
   formData.append("pdf", pdfBlob, `autorizacion-deducciones-${empleadoId}.pdf`);
   ```

## 4. Guía para exportar este cambio a otro repositorio

1. Generar parche desde este repositorio:
   ```bash
   git format-patch -1 HEAD
   ```
   o, antes del commit, usar:
   ```bash
   git diff -- js/webhooks.js nomina/historico.html js/nomina_historico.js css/nomina.css js/nomina.js > historico-nomina-pdf-deducciones.patch
   ```
2. En el repositorio destino, verificar que exista un archivo central equivalente a `js/webhooks.js`. Si no existe, crearlo o adaptar la importación para no hardcodear URLs en el módulo.
3. Centralizar la URL del histórico así:
   ```js
   export const WEBHOOK_NOMINA_HISTORICO_RENDERIZAR =
     "https://n8n.enkrato.com/webhook/nomina_historico_consultar";
   ```
4. Confirmar que el repositorio destino tenga una utilidad equivalente a `buildRequestHeaders({ includeTenant: true })` que envíe token y empresa/tenant. El webhook indicado espera únicamente autenticación: token y empresa id.
5. Confirmar que exista una función equivalente a `fetchResponsablesActivos(empresaId)` conectada a usuarios/empleados de la empresa. Si ya existe una función de responsables, usar esa función antes de duplicar lógica.
6. Copiar o adaptar los IDs HTML usados por `js/nomina_historico.js`: `historicoNominaEmpleado`, `historicoNominaDesde`, `historicoNominaHasta`, `historicoNominaSede`, `historicoNominaBody`, `historicoNominaListadoPanel`, `historicoNominaDetallePanel`, `historicoNominaDetalleTitulo`, `historicoNominaDetalleResumen`, `historicoNominaVolver`.
7. Validar que no haya otro archivo escuchando los mismos IDs con una lógica incompatible. Si existe, priorizar una integración en ese archivo para mantener funcionalidad máxima.
8. Ejecutar validación de sintaxis con:
   ```bash
   node --check js/nomina_historico.js
   node --check js/nomina.js
   node --check js/webhooks.js
   ```
9. Probar manualmente que al ingresar a `nomina/historico.html` se hace el `POST`, se cargan responsables y el clic en una fila muestra el submódulo de detalle.

## 5. Check funcional para logs

- **Login/sesión/header:** no se modificaron; se usan imports existentes de sesión y URLs centralizadas.
- **Histórico Nómina - webhook:** funciona a nivel frontend apuntando a `nomina_historico_consultar`; la respuesta final depende de que n8n esté publicado y responda con arreglo, `data`, `nominas` o `rows`.
- **Histórico Nómina - responsables:** funciona a nivel frontend usando `fetchResponsablesActivos`, la misma familia de utilidad que cierre de turno.
- **Histórico Nómina - filtros:** funcionan en frontend por rango de fechas y responsable seleccionado.
- **Histórico Nómina - filas:** funciona mostrando solo fecha con mes en texto y nombre de empleado/responsable resuelto.
- **Histórico Nómina - detalle:** funciona como panel separado; no despliega contenido dentro de la misma tabla.
- **PDF autorización deducciones - justificación:** funciona en el PDF generado localmente con espaciado por palabras en líneas no finales; la plantilla HTML mantiene `text-align: justify`.
- **PDF autorización deducciones - firma trabajador:** funciona con espacio visible debajo del subtítulo.
- **PDF autorización deducciones - nombre archivo:** funciona enviando `Autorización Deducciones.pdf`.
- **Nómina operativa existente:** se mantiene; no se cambió la consulta principal de nómina ni los cálculos.

## 6. Validaciones realizadas

- `node --check js/nomina_historico.js`
- `node --check js/nomina.js`
- `node --check js/webhooks.js`

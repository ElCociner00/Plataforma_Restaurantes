# 2026-04-17 — Cierre de turno: apoyos, validaciones obligatorias y rediseño PNG

## 1) Objetivo de la petición
Implementar un cambio grande y prioritario en `cierre_turno` para:

1. Registrar **apoyos del turno** con estructura por persona (responsable, propina, tiempo).
2. Rediseñar el **PNG de constancia** para destacar datos críticos y mostrar apoyos (con paginación si no caben).
3. Evitar envíos incompletos que terminan en falsos ceros (especialmente `bolsa`) mediante validación estricta y confirmación explícita cuando `bolsa`/`caja` quedan en `0`.
4. Reforzar lectura de `bolsa` en histórico Excel contemplando naming alterno (`bolsas`).

---

## 2) Archivos implicados, tipo de modificación y objetivo

### A) `cierre_turno/index.html`
**Tipo:** ampliación de UI.

**Qué se hizo:**
- Se agregó un bloque nuevo **“Apoyos del turno”** debajo de gastos con:
  - selector `SI/NO` sobre si hubo apoyos,
  - selector de cantidad de personas (1 a 50),
  - tabla dinámica de filas por apoyo con columnas: responsable, propina, tiempo.

**Objetivo explícito:** capturar información detallada de apoyos desde la UI sin romper el flujo actual.

---

### B) `css/cierre_turno.css`
**Tipo:** estilos nuevos para componente funcional.

**Qué se hizo:**
- Se agregaron estilos para:
  - cabecera de apoyos,
  - tabla de apoyos dinámica,
  - responsive para móvil en filas de apoyos.

**Objetivo explícito:** mantener consistencia visual con el diseño existente y mejorar legibilidad.

---

### C) `js/cierre_turno.js`
**Tipo:** lógica funcional grande (UI dinámica + validación + payload + PNG).

**Qué se hizo (resumen):**
1. **Apoyos dinámicos**
   - Render condicional por `SI/NO`.
   - Cantidad configurable de 1 a 50.
   - Generación de filas con responsable, propina numérica y tiempo en intervalos de 5 minutos (5 → 960 min).
   - Formateo de duración en texto `X horas Y minutos`.

2. **Payload separado `apoyo`**
   - Se construye `apoyo` con etiqueta explícita y estructura separada del payload principal:
     - `empresa_id`, `fecha`, `hora_inicio`, `hora_fin`, `responsable_turno_id`.
     - `registros[]` con `apoyo_responsable_id`, `propina`, `tiempo_minutos`, `tiempo_texto`.
   - El objeto queda incluido como bloque independiente para no mezclar interpretación del cierre base.

3. **Validaciones obligatorias reforzadas**
   - Se bloquea verificar/subir si hay campos obligatorios vacíos (incluye `bolsa`, `caja` y campos reales clave).
   - Se valida integridad de filas de apoyos cuando aplica.
   - Se agrega alerta de confirmación explícita cuando `bolsa` o `caja` están en `0`.

4. **PNG rediseñado**
   - Se resaltan arriba: **Efectivo apertura, Bolsa, Caja, Total ingresos reales**.
   - Se mantiene tabla financiera + gastos + totales.
   - Se agrega tabla de apoyos en PNG.
   - Si hay demasiados apoyos, se generan páginas adicionales (`_p2`, `_p3`, etc.) con encabezado y contexto del turno.

**Objetivo explícito:** asegurar completitud de datos, trazabilidad de apoyos y constancias más útiles operativamente.

---

### D) `js/historico_cierre_turno.js`
**Tipo:** ajuste de robustez de mapeo de datos.

**Qué se hizo:**
- Se amplió lectura de bolsa para considerar también clave `bolsas` además de `bolsa`/`bolsa_global`/`total_bolsa`.

**Objetivo explícito:** reducir casos donde Excel muestra `0` por variaciones de naming.

---

## 3) Plan de emergencia / reversión detallada

### Revertir `cierre_turno/index.html`
- Eliminar bloque `<section class="bloque">` con título **Apoyos del turno** y nodos:
  - `#apoyo_hubo`, `#apoyo_cantidad`, `#apoyoRows`, `#apoyoTablaWrap`, `#apoyoCantidadWrap`.

### Revertir `css/cierre_turno.css`
- Eliminar reglas nuevas:
  - `.apoyos-head-grid`
  - `.apoyos-question`
  - `.apoyos-cantidad`
  - `.apoyo-tabla-wrap`
  - `.apoyo-tabla-head`
  - `.apoyo-rows`
  - `.apoyo-row`
  - media query asociada a `.apoyo-tabla-head, .apoyo-row`.

### Revertir `js/cierre_turno.js`
1. Eliminar referencias DOM de apoyos:
   - `apoyo_hubo`, `apoyo_cantidad`, `apoyoCantidadWrap`, `apoyoTablaWrap`, `apoyoRows`.
2. Eliminar helpers de apoyos:
   - `formatDurationLabel`
   - `buildApoyoTimeOptions`
   - `getResponsableOptionsHtml`
   - `createApoyoRow`
   - `renderApoyoRows`
   - `buildApoyoPayload`
   - `validateApoyoRows`
3. Quitar validaciones nuevas:
   - `validateCamposObligatoriosCompletos`
   - `confirmarCerosCriticos`
4. Quitar bloque `apoyo` de payloads (`verificar` y `construirPayloadEnvio`).
5. Restaurar `descargarImagenResumen` a versión de una sola página sin sección de apoyos ni tarjetas destacadas.

### Revertir `js/historico_cierre_turno.js`
- Retirar `bolsas` de candidatos de bolsa para volver al comportamiento previo estricto.

---

## 4) Nombre del documento
Se creó con formato requerido AAAA-MM-DD + título descriptivo:

- `2026-04-17_cierre_turno_apoyos_validaciones_bolsa_png_y_2_parches.md`

---

## 5) Guía para portar el cambio a otro repositorio

### Orden recomendado
1. Migrar `index.html` + `css` de apoyos.
2. Migrar lógica JS de apoyos y validaciones en `cierre_turno.js`.
3. Migrar rediseño de `descargarImagenResumen` (incluye paginación de apoyos).
4. Migrar ajuste de histórico para candidatos de bolsa (`historico_cierre_turno.js`).

### Validaciones clave de portabilidad
- Confirmar que el repo destino tenga módulo equivalente de responsables activos para poblar selects.
- Confirmar que el envío soporte un bloque extra en payload (`apoyo`) sin romper contrato existente.
- Verificar centralización de rutas/webhooks (este repo usa archivos de URLs/webhooks centralizados).
- Revisar funciones duplicadas de generación de PNG para no tener dos implementaciones activas al mismo tiempo.

### Particularidad importante de este repo
- Las rutas y webhooks se centralizan en `js/urls.js` y `js/webhooks.js`; si el repo destino no usa ese patrón, adaptar referencias antes de probar.

---

## 6) Check funcional (logs)
- **cierre_turno:** funciona con apoyos dinámicos, validación obligatoria y PNG con destacadas + apoyos paginados.
- **historico_cierre_turno:** funciona con refuerzo adicional de lectura de bolsa (`bolsas`).
- **cierre_inventarios:** sin cambios.
- **login / permisos / sesión:** sin cambios directos.

---

## 7) Política de parches
Este cambio se documenta como cambio grande independiente con fecha nueva. Si se aplican ajustes adicionales sobre esta misma base, actualizar este mismo documento con sección “parche posterior” y renombrar con contador de parches según guía.

---

## Parche posterior (2026-04-17) — Ajuste visual PNG + fix selector de apoyos + copy de verificación

### Objetivo puntual del parche
1. Corregir superposición y exceso visual del bloque resaltado del PNG.
2. Corregir despliegue de cantidad de apoyos.
3. Eliminar redundancia en el mensaje posterior a verificar.

### Cambios aplicados
- `js/cierre_turno.js`
  - En inicialización de `#apoyo_cantidad`, se corrigió la condición de carga para que inserte opciones cuando existe solo el placeholder y se redujo rango de `1..50` a `1..30`.
  - En `descargarImagenResumen`, se reemplazó el bloque de tarjetas grandes por una sola **row destacada** de 4 columnas para mejorar consistencia visual y evitar superposición.
  - En `btnVerificar`, se simplificó el texto final para evitar repetición de “verificación”.

### Reversión rápida del parche
- Restaurar en `js/cierre_turno.js`:
  - condición y bucle de cantidad de apoyos a la versión previa,
  - función de destacados del PNG tipo cards,
  - texto anterior de estado en verificación.


---

## Parche posterior #2 (2026-04-17) — Ajuste final PNG + apoyos en histórico + hoja Apoyos en Excel

### Objetivo puntual del parche #2
1. Corregir contraste/solapamiento visual entre fila destacada y bloque de datos financieros en PNG.
2. Reubicar UI de apoyos justo después de botones y antes de datos financieros.
3. Mostrar evidencia explícita cuando no hubo apoyos (texto “Turno culminado sin apoyos”).
4. Incluir apoyos en detalle de histórico consultando `apoyos_turno` por empresa, fecha, hora inicio y hora fin.
5. Exportar Excel histórico en 2 hojas: `Turnos` y `Apoyos`.

### Cambios aplicados
- `cierre_turno/index.html`: bloque de apoyos movido al primer bloque, debajo de botones/estado y antes de datos financieros.
- `css/cierre_turno.css`: estilo del bloque inline de apoyos para nueva ubicación.
- `js/cierre_turno.js`:
  - fila destacada del PNG reposicionada con separación suficiente para evitar superposición.
  - al no existir apoyos, constancia muestra fila con texto “Turno culminado sin apoyos”.
- `js/historico_cierre_turno.js`:
  - enriquecimiento con `apoyos_turno` por coincidencia de empresa/fecha/hora_inicio/hora_fin.
  - sección adicional de apoyos en detalle de histórico.
  - exportador Excel reconstruido con 2 worksheets (`Turnos` y `Apoyos`) en formato SpreadsheetML.

### Reversión rápida del parche #2
- Restaurar ubicación anterior del bloque apoyos en `cierre_turno/index.html`.
- Revertir estilos `.apoyos-inline-block` en `css/cierre_turno.css`.
- En `js/cierre_turno.js`, volver a la posición anterior de la fila destacada y quitar fila de “sin apoyos”.
- En `js/historico_cierre_turno.js`, eliminar enriquecimiento `apoyos_turno`, tabla de apoyos en detalle y workbook de 2 hojas para regresar a 1 hoja.

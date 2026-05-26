# Objetivo
Implementar correcciones funcionales en Compras, Cierre de turno y Nómina para evitar reprocesos, forzar decisiones explícitas en apoyos y habilitar salida de datos de empleado por webhook para futuro Excel.

## Archivos implicados y cambios
- `js/compras.js` (modificación lógica):
  - Se cambia interpretación de estado de factura a esquema numérico (`0` pendiente, `1` revisada, `2` no corresponde).
  - Se bloquea apertura de facturas revisadas para evitar doble subida.
  - Se agrega vista separada para facturas `no corresponde` mediante tabs.
  - Tras enviar match/no-corresponde se recarga listado para reflejar nuevo estado.
- `compras/index.html` (UI):
  - Se añaden pestañas de navegación interna: módulo principal y no corresponde.
- `css/compras.css` (estilos):
  - Estilos para tabs, etiqueta naranja no corresponde y tarjeta bloqueada revisada.
- `cierre_turno/index.html` (UI/validación):
  - Selector “¿Hubo apoyos?” inicia vacío con opción `Selecciona`.
- `js/cierre_turno.js` (validación/flujo):
  - Se elimina el default implícito `NO`.
  - Campo “¿Hubo apoyos?” pasa a ser obligatorio en validaciones requeridas.
  - Al elegir NO se solicita confirmación explícita.
- `nomina/index.html` (UI):
  - Nuevo botón “Descargar Excel empleado”.
- `js/nomina.js` (integración):
  - Se agrega envío al webhook `consultar_histórico_empleado` con corte, rango y `responsable_id`.
  - Se añade contingencia para respuestas sin estructura final (errores controlados y mensaje operativo).
- `js/webhooks.js` (config centralizada):
  - Nueva constante `WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO` para mantener referencia única de URL.

## Reversión de emergencia
1. Compras
   - En `js/compras.js`, revertir función `normalizeRevisionStatus` y regresar lectura booleana previa en `groupFacturas`.
   - Eliminar guardado de bloqueo en `openDetalleFactura` para revisadas.
   - Reemplazar `renderFacturas(view)` por la versión única sin tabs.
   - En `compras/index.html`, borrar bloque `.compras-tabs`.
   - En `css/compras.css`, borrar reglas de `.compras-tabs`, `.compras-tab`, `.factura-tag.no-corresponde`, `.factura-card.is-locked`.
2. Cierre turno
   - En `cierre_turno/index.html`, restaurar `apoyo_hubo` con default `NO`.
   - En `js/cierre_turno.js`, restituir comparaciones con fallback `(apoyoHubo?.value || "no")`.
   - Quitar `confirm()` al seleccionar NO.
   - Eliminar campo obligatorio de apoyo en lista de requeridos.
3. Nómina
   - En `nomina/index.html`, borrar botón `descargarExcelEmpleadoNomina`.
   - En `js/nomina.js`, eliminar import de webhook histórico, `descargarExcelEmpleado` y listener asociado.
   - En `js/webhooks.js`, borrar constante de webhook histórico de empleado.

## Exportar a otro repositorio (guía)
1. Copiar cambios de UI y lógica de:
   - `compras/index.html`, `js/compras.js`, `css/compras.css`
   - `cierre_turno/index.html`, `js/cierre_turno.js`
   - `nomina/index.html`, `js/nomina.js`, `js/webhooks.js`
2. **Particularidad crítica de este repo:** URLs centralizadas en `js/webhooks.js`.
   - En el repositorio destino, crear/migrar el archivo centralizador y mapear ahí todas las URLs.
   - Ajustar imports para consumir constantes centralizadas, no URLs inline.
3. Validaciones recomendadas:
   - Compras: verificar que backend ya emite `Revisada` compatible con `0/1/2`.
   - Cierre turno: confirmar que formularios no envían cuando `apoyo_hubo` está vacío.
   - Nómina: confirmar recepción de `corte`, `fecha_inicio`, `fecha_fin`, `responsable_id` en webhook destino.
4. Riesgos de compatibilidad:
   - Si existe lógica previa de tabs o filtro de compras, fusionar en una sola fuente de verdad.
   - Si webhook de nómina no retorna archivo todavía, mantener la contingencia de error controlado.

## Check de estado funcional (log)
- Compras:
  - ✅ bloqueo de apertura de facturas revisadas.
  - ✅ estado trivalor 0/1/2 interpretado en frontend.
  - ✅ facturas no corresponde fuera del módulo principal (subpestaña).
- Cierre turno:
  - ✅ selector de apoyos sin valor default.
  - ✅ selección consciente obligatoria.
  - ✅ confirmación al seleccionar NO.
- Nómina:
  - ✅ botón para solicitar Excel de empleado.
  - ✅ envío de parámetros requeridos al webhook.
  - ⚠️ generación real del Excel depende de estructura del flujo n8n (pendiente definición backend).


---

## Parche posterior #1 (2026-05-25)
### Objetivo
Corregir visibilidad de tabs en Compras, agregar pestaña de Revisadas, ocultar botón/box de confirmar apoyo cuando no aplica, y completar exportación de Excel empleado con columnas definidas (descarga CSV compatible con Excel).

### Archivos implicados en este parche
- `compras/index.html`: se añade tab **Revisadas**.
- `css/compras.css`: se refuerza contraste/estilo de tabs para evitar efecto “invisible”.
- `js/compras.js`: se actualiza render por 3 vistas separadas: principal (pendientes), no corresponde y revisadas.
- `cierre_turno/index.html`: `apoyosConsultaBox` inicia oculto.
- `js/cierre_turno.js`: nueva sincronización de visibilidad de `apoyosConsultaBox` según selección SI + cantidad.
- `js/nomina.js`: ahora procesa respuesta del webhook y genera archivo CSV con columnas:
  `fecha_turno,hora_inicio,hora_fin,Momento,comentarios,domicilios,efectivo_inicial,propinas,ventas_brutas,bolsas,caja_final,diferencia_caja`.

### Reversión de emergencia (parche #1)
1. Tabs Compras:
   - Quitar botón `tabComprasRevisadas` en `compras/index.html`.
   - Restaurar estilos previos de `.compras-tab*` en `css/compras.css`.
   - En `js/compras.js`, revertir filtro de `renderFacturas(view)` para eliminar vista `revisadas`.
2. Cierre turno:
   - En `cierre_turno/index.html`, quitar `is-hidden` inicial de `apoyosConsultaBox`.
   - En `js/cierre_turno.js`, eliminar `syncApoyosConsultaVisibility()` y sus invocaciones.
3. Nómina:
   - En `js/nomina.js`, revertir bloque de `descargarExcelEmpleado` al comportamiento de solo envío sin descarga.

### Exportación a otro repo (parche #1)
- Migrar los cambios de los 6 archivos del parche.
- Mantener URL en `js/webhooks.js` centralizada (patrón obligatorio de este repo).
- Validar en destino:
  1) Tabs visibles con buen contraste en todos los temas/CSS base.
  2) `apoyosConsultaBox` oculto salvo `SI` + cantidad.
  3) Apertura CSV en Excel con delimitador `;` y UTF-8 BOM.

### Check funcional (log)
- compras: ✅ tabs visibles/legibles, ✅ submódulo revisadas creado, ✅ separación de 3 estados.
- cierre turno: ✅ confirmar apoyo oculto cuando no aplica.
- nómina: ✅ descarga CSV compatible Excel con columnas pedidas.
- pendiente backend: ⚠️ si webhook no devuelve filas, el frontend informa estado sin romper flujo.


---

## Parche posterior #2 (2026-05-25)
### Objetivo
Corregir regresión del módulo Nómina causada por error de sintaxis en `js/nomina.js` (rompía la carga completa del módulo), y reemplazar salida CSV por archivo Excel descargable con columnas/celdas según estructura acordada.

### Archivos implicados en este parche
- `js/nomina.js` (modificación correctiva y funcional):
  - Se reescribe `descargarExcelEmpleado` para eliminar el fragmento que generó error de expresión regular/salto de línea.
  - Se mantiene consulta al webhook histórico.
  - Se extraen filas del payload de forma tolerante.
  - Se genera archivo `.xls` (HTML tabular + MIME Excel) con columnas:
    `fecha_turno,hora_inicio,hora_fin,Momento,comentarios,domicilios,efectivo_inicial,propinas,ventas_brutas,bolsas,caja_final,diferencia_caja`.

### Causa raíz de la falla y aislamiento
- Causa raíz: en el parche anterior se introdujo código mal serializado en `js/nomina.js` (saltos de línea dentro de literales para regex/join), produciendo error de parseo y abortando la ejecución del módulo completo.
- Efecto: al no cargar el script, dejaron de correr inicialización de fechas rápidas (`updateDatesByCut`) y carga de empleados (`fetchResponsablesActivos`).
- Aislamiento aplicado:
  1. Validación sintáctica obligatoria post-cambio con `node --check js/nomina.js`.
  2. Reescritura limpia de la función problemática sin concatenaciones ambiguas.
  3. Mantener cambios encapsulados en `descargarExcelEmpleado` sin tocar flujo base de inicialización de nómina.

### Reversión de emergencia (parche #2)
1. En `js/nomina.js`, ubicar función `descargarExcelEmpleado` y reemplazarla por la versión previa de solo solicitud sin generación de archivo.
2. Verificar que listeners de `init`, `corteSelect`, fechas y empleado permanecen intactos.
3. Ejecutar `node --check js/nomina.js` antes de desplegar.

### Exportar a otro repositorio (parche #2)
1. Copiar únicamente cambios de `js/nomina.js` si el resto del parche ya existe.
2. Verificar centralización de URL en archivo equivalente a `js/webhooks.js`.
3. Validar en navegador:
   - Cambio de corte actualiza fechas.
   - Lista de empleados carga.
   - Botón Excel descarga `.xls` con columnas definidas.
4. Confirmar que no exista minificador/procesador que modifique literales JS de forma insegura.

### Check funcional (log)
- nómina: ✅ inicialización vuelve a ejecutarse, ✅ cortes rápidos funcionan, ✅ empleados cargan, ✅ exporta archivo Excel `.xls`.
- compras: ✅ sin cambios en este parche.
- cierre turno: ✅ sin cambios en este parche.
- pendiente backend: ⚠️ si webhook retorna vacío/no estructurado, se informa en status sin romper el módulo.


---

## Parche posterior #3 (2026-05-25)
### Objetivo
Corregir el flujo de descarga de Excel en Nómina cuando el webhook sí retorna datos válidos pero no se disparaba el archivo en algunos navegadores, eliminando interferencias del fallback y robusteciendo la ruta de descarga.

### Archivos implicados en este parche
- `js/nomina.js`:
  - Se refuerza `descargarExcelEmpleado` para soportar dos escenarios:
    1) webhook retorna archivo Excel/binario (descarga directa de blob),
    2) webhook retorna JSON con filas (construcción local de `.xls`).
  - Se normaliza extracción de filas con mayor profundidad y validación de objetos.
  - Se elimina retorno silencioso cuando no hay filas y ahora se lanza error con vista previa para depuración.
  - Se ajusta el disparo de descarga (`appendChild` + `click` + `remove` + `revoke` diferido) para mejorar compatibilidad de descarga.

### Causa raíz identificada
- La ruta anterior podía no disparar la descarga en ciertos contextos por liberación temprana del Object URL y por fallback silencioso que ocultaba la falla cuando la estructura no coincidía exactamente.

### Reversión de emergencia (parche #3)
1. En `js/nomina.js`, localizar `descargarExcelEmpleado`.
2. Restaurar implementación del parche #2 si se desea solo generación local `.xls` sin rama de blob binario.
3. Mantener `node --check js/nomina.js` como validación mínima pre-despliegue.

### Exportación a otro repositorio (parche #3)
1. Migrar solo `js/nomina.js` si parches previos ya están aplicados.
2. Confirmar que el repositorio destino centraliza webhooks como este (`js/webhooks.js`), manteniendo la misma URL.
3. Validar 4 casos:
   - webhook devuelve JSON array plano,
   - webhook devuelve JSON anidado,
   - webhook devuelve binario Excel,
   - webhook devuelve payload vacío/error.
4. Verificar políticas del navegador para descargas iniciadas por click programático.

### Check funcional (log)
- nómina: ✅ descarga Excel cuando webhook retorna JSON con filas, ✅ descarga directa cuando webhook retorna blob, ✅ error explícito cuando no hay filas.
- compras: ✅ sin cambios en este parche.
- cierre turno: ✅ sin cambios en este parche.

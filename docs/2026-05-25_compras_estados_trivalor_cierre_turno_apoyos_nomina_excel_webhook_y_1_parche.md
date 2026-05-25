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

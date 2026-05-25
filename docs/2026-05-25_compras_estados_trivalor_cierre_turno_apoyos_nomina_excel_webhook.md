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

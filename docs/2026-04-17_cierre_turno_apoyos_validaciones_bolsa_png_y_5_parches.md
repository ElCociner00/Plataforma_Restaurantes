# 2026-04-17 — Cierre de turno: apoyos, validaciones obligatorias y rediseño PNG (5 parches)

## Parche posterior #5 (2026-05-06) — Propina de apoyos/responsable ahora viene 100% desde BD vía webhook

### 1) Objetivo de la petición
Ajustar el flujo de **cierre de turno > apoyos > botón "Consultar propina"** para que la plataforma deje de calcular/repartir internamente la propina por bloques de tiempo y, en su lugar, use directamente la distribución ya calculada en BD y enviada por webhook (`detalles[].id`, `detalles[].tipo`, `detalles[].propina_correspondiente`).

Se mantiene una validación de coherencia: la suma visual de propina responsable + propina apoyos contra total distribuido/total de referencia del webhook.

---

### 2) Archivos implicados, tipo de modificación y objetivo

#### A) `js/apoyos.js`
**Tipo:** refactor funcional de integración webhook + simplificación de lógica de negocio.

**Qué se modificó:**
1. Se eliminó la lógica local de reparto temporal (bloques de 5 minutos/redondeos) como fuente principal de cálculo.
2. Se añadió parseo del nuevo formato de webhook:
   - `parseWebhookDetalleRows(...)` para leer `detalles[]` (o formatos previos compatibles).
   - `extractWebhookTotals(...)` para leer `total_propina_dia` y `total_propina_distribuida`.
3. `applyDistribucion(...)` ahora:
   - asigna propina de cada apoyo por `id`.
   - asigna propina del responsable usando `tipo: "responsable"` o fallback por ID.
   - conserva chequeo de coherencia (`sumaRepartida` vs total de referencia).
4. Se actualizó el texto informativo para dejar explícito que propinas de apoyos/responsable son automáticas desde BD.
5. Se actualizó `APOYOS_PROPINA_RESPONSE_SAMPLE` al nuevo contrato de respuesta.

**Objetivo explícito:** que la UI refleje exactamente lo que calcula BD, reduciendo duplicidad de reglas y riesgo de divergencia entre backend y frontend.

---

### 3) Plan de emergencia / reversión detallada

#### Revertir `js/apoyos.js` al esquema anterior de cálculo local
1. Restaurar funciones eliminadas de reparto local:
   - `roundToNearest`
   - `distributeByTimeline`
2. En `applyDistribucion(...)`, reemplazar la asignación por `detalles[]` y volver a:
   - construir `supportRows` con rangos,
   - ejecutar reparto local,
   - escribir `propinaInput` con resultado calculado localmente.
3. Restaurar copy de ayuda/estado al mensaje de “distribuida por bloques de 5 minutos”.
4. Si el webhook nuevo deja de enviar `detalles[]`, validar compatibilidad temporal usando el fallback existente (`apoyo_responsable_id`, `total_propina_periodo`) o restaurar integración previa completa.

**Fragmentos clave a tocar para revertir rápido:**
- Bloque de utilidades nuevas: `parseWebhookDetalleRows`, `extractWebhookTotals`.
- Cuerpo de `applyDistribucion(...)`.
- Constante `APOYOS_PROPINA_RESPONSE_SAMPLE`.

---

### 4) Nombre del documento
Se documenta este parche con el formato solicitado y contador de parches:

- `2026-04-17_cierre_turno_apoyos_validaciones_bolsa_png_y_5_parches.md`

---

### 5) Guía para exportar este cambio a otro repositorio

1. Migrar `js/apoyos.js` completo o portar funciones:
   - `parseWebhookDetalleRows`
   - `extractWebhookTotals`
   - nuevo `applyDistribucion`
2. Verificar que el botón “Consultar propina” mantenga el mismo webhook o actualizar URL centralizada.
3. Confirmar que el repositorio destino también centralice URLs/webhooks (en este repo suele hacerse en archivos JS de configuración global).
4. Validar contrato del webhook en destino:
   - `detalles[].id`
   - `detalles[].tipo` (`responsable` / `apoyo`)
   - `detalles[].propina_correspondiente`
   - totales (`total_propina_distribuida` y/o `total_propina_dia`)
5. Ejecutar prueba funcional completa:
   - turno con responsable solo,
   - turno con apoyos,
   - caso donde `coinciden_totales = false` para verificar warning.

**Particularidad de este repositorio:**
- Existe separación modular por archivo (`cierre_turno.js` coordina UI y `apoyos.js` concentra la lógica del botón de consulta de propina). Mantener este diseño mejora trazabilidad de parches.

---

### 6) Check funcional (logs)
- ✅ **cierre_turno > consultar propina apoyos:** funciona con asignación desde BD/webhook por ID y tipo.
- ✅ **cierre_turno > validación de coherencia de suma:** funciona (muestra estado con suma y total de referencia).
- ✅ **otros módulos de propina (ej. loggro):** sin cambios en este parche; continúan con su flujo actual.
- ⚠️ **coincidencia perfecta de totales:** puede mostrar advertencia cuando webhook reporta discrepancia (`coinciden_totales=false`), esperado por diseño.

---

### 7) Nota de parche incremental
Este documento corresponde a una **modificación puntual** sobre el cambio grande de apoyos en cierre de turno y se publica como **parche #5** para mantener historial operativo y facilitar rollback/portabilidad.

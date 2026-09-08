# Hotfix de caja anterior y envío de cierre en BATUT VIVA

## Objetivo

Evitar que el formulario de cierre muestre la caja de otra empresa cuando el
RPC no logra resolver una sede local, y permitir el intento de envío después de
verificar aunque exista un faltante o sobrante.

## Archivos implicados

- `js/cierre_turno.js`: la caja anterior se consulta en la tabla principal o
  local según `app_es_local`, filtrando siempre por el UUID exacto de la sede.
  Se rechaza cualquier fila cuyo `empresa_id` sea distinto. El botón se habilita
  al completar la verificación y los medios monetarios vacíos se interpretan
  como cero, igual que al construir el payload. El payload también obtiene de
  `app_es_local` el tipo real de la empresa, incluso cuando el usuario pertenece
  directamente a VIVA y no entró mediante el selector de locales.
- `cierre_turno/index.html`: cachebuster `20260908viva3`.
- `tools/test_cierre_turno_contexto.mjs`: regresiones para sede exacta, tabla
  local, eliminación del fallback ambiguo y habilitación del botón.

La escritura sigue protegida por `subir_cierre_turno`, que valida el acceso y
el ciclo de vida en PostgreSQL. El cierre de turno no usa una Edge Function
para guardar: usa ese RPC transaccional. `consultar-ventas` sí es una Edge
Function y se ejecuta antes de verificar.

## Verificación y estado

- Caja anterior de otra sede: bloqueada por filtro y comprobación de UUID.
- Diferencia negativa o positiva: informativa, no bloqueante.
- Campos monetarios no usados: se guardan como cero y no impiden verificar.
- Envío definitivo: conserva las validaciones del servidor.

## Reversión de emergencia

Restaurar `cargarEfectivoAperturaEsperado` para llamar
`efectivo_apertura_esperado`, restaurar la condición de plan en
`refreshEstadoBotonSubir` y volver el cachebuster a `20260908viva1`. Esto
reintroduce el riesgo de mostrar una caja perteneciente a la empresa principal.

## Exportación

Aplicar juntos el JavaScript, el HTML y la prueba. Ejecutar
`node --check js/cierre_turno.js` y
`node tools/test_cierre_turno_contexto.mjs`; luego desplegar Firebase Hosting.

# Revisión integral del repositorio — 2026-04-09

## Objetivo de esta pasada
- Revisar riesgos funcionales para gestión de usuarios y responsables.
- Extender el alcance del módulo de nómina a entorno Loggro además de Siigo.
- Revisar fallos de seguridad/flujo en integraciones de configuración.

## Hallazgos corregidos

1. **Gestión de usuarios incompleta en configuración.**
   - Antes: solo listaba `usuarios_sistema`; no contemplaba `otros_usuarios`.
   - Ahora: unifica ambas tablas en una sola vista de gestión con switch de activación.

2. **Inactivos seguían apareciendo en selección de responsables (según tabla).**
   - Antes: solo se consultaba `usuarios_sistema` para responsables activos.
   - Ahora: responsables se cargan desde ambas tablas y se filtran por estado activo.

3. **Nómina restringida al entorno Siigo.**
   - Antes: el módulo `nomina` solo aceptaba entorno `siigo`.
   - Ahora: acepta `siigo` y `loggro` mediante `PAGE_ENVIRONMENT` con lista.

4. **Integración Loggro sin headers de sesión en registro de credenciales.**
   - Antes: el fetch enviaba solo `Content-Type`.
   - Ahora: incluye headers de autenticación/tenant para trazabilidad y validación backend.

## Riesgos aún pendientes (no bloqueantes para este cambio)

- Validar en BD si existe necesidad de migrar `otros_usuarios.estado` a booleano `activo`
  para estandarización de consultas y políticas RLS.
- Definir políticas RLS para lectura/escritura de `usuarios_sistema` y `otros_usuarios`
  según rol (`admin`, `revisor`, `operativo`) si aún no están centralizadas.

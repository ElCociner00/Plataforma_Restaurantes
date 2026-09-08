# Base técnica para un MCP de Rappi

Fecha de corte: 2026-08-30

Esta carpeta concentra el conocimiento reutilizable obtenido durante la integración Enkrato + Rappi. Su objetivo es evitar repetir el trabajo de descubrimiento al construir un producto MCP relacionado con Rappi.

No contiene Client ID, Client Secret, contraseñas, tokens, secretos HMAC ni cuerpos con información personal. Las credenciales de prueba permanecen únicamente en el `.env` local ignorado por Git.

## Documentos

1. [Contratos y arquitectura](01_CONTRATOS_Y_ARQUITECTURA_RAPPI.md): autenticación, hosts, endpoints, webhooks, HMAC, normalización, idempotencia y seguridad.
2. [Evidencia sandbox y diagnóstico](02_EVIDENCIA_SANDBOX_Y_DIAGNOSTICO.md): resultados reales, los tres fallos de firma, reparación aplicada y criterios de retest.
3. [Diseño del MCP](03_DISENO_MCP_RAPPI.md): herramientas, recursos, permisos, esquemas y fases recomendadas del producto.
4. [Runbook de certificación y producción](04_RUNBOOK_CERTIFICACION_Y_PRODUCCION.md): pasos reproducibles para DEV, certificación, cambio de ambiente, observabilidad y rollback.

## Fuentes del repositorio

- `supabase/functions/_shared/rappi/`: cliente, criptografía, payloads, estados y validadores.
- `supabase/functions/rappi-admin/`: onboarding y administración de webhooks.
- `supabase/functions/rappi-webhook/`: recepción y verificación HMAC.
- `supabase/functions/rappi-worker/`: normalización asíncrona.
- `supabase/functions/rappi-sync/`: sincronización de tiendas, órdenes, menús y datos financieros.
- `supabase/functions/rappi-data/`: lectura multiempresa para la interfaz.
- `tools/run_rappi_dev_onboarding.mjs`: onboarding, verificación, diagnóstico y reparación selectiva.
- `tools/test_rappi_dev_credentials.mjs`: autenticación y comprobación remota de webhooks.

## Documentos históricos relacionados

- `docs/2026-08-29_integracion_enkrato_rappi_v1.md`
- `docs/2026-08-29_correcciones_integracion_rappi_v4_y_3_parches.md`
- `docs/2026-08-29_cierre_27_migraciones_y_rappi.md`

Los documentos históricos explican decisiones de Enkrato. Los archivos de esta carpeta separan lo reutilizable para un MCP de lo que es específico de esa aplicación.

## Regla de actualización

Cuando cambie un contrato Rappi:

1. confirmar el cambio contra el Developer Portal oficial;
2. registrar fecha, ambiente y endpoint observado;
3. añadir evidencia reproducible sin secretos ni PII;
4. actualizar pruebas antes de modificar el conector;
5. conservar DEV y PROD como configuraciones independientes.

Fuentes oficiales principales:

- https://dev-portal.rappi.com/
- https://dev-portal.rappi.com/en/api-reference/authentication/
- https://dev-portal.rappi.com/en/api-reference/webhooks/
- https://dev-portal.rappi.com/es/webhook-events
- https://dev-portal.rappi.com/managing-user-orders/
- https://dev-portal.rappi.com/managing-store-menus/
- https://dev-portal.rappi.com/managing-availability/

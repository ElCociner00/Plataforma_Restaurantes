# Cierre de las 27 migraciones y acceso a Rappi

Fecha: 2026-08-29

## Resultado comprobado

- Las 27 versiones historicas quedaron registradas individualmente como aplicadas.
- No se repitieron backfills, facturas, pagos, aceptaciones ni la anulacion AX-01004.
- Se aplicaron migraciones correctivas hacia adelante y sus aserciones terminaron sin error.
- `supabase db push --linked --dry-run` devuelve `Remote database is up to date`.
- El sistema de facturacion de suscripciones se conserva y queda endurecido; no se descarto.
- Rappi se publica en `https://restaurantes.enkrato.com/rappi/operacion` y tiene acceso directo en el encabezado.

## Tratamiento individual

| # | Version | Decision ejecutada |
|---:|---|---|
| 1 | `20260823170000` | Conservada. Vistas base y `parse_hora` ya existian; se mantuvo `security_invoker` y se ajusto la volatilidad de `parse_hora` a `STABLE`. |
| 2 | `20260823180000` | Conservada. Conciliacion y sedes siguen activas. Las RPC de dias pendientes/marcado, sin UI, quedaron solo para `service_role`. |
| 3 | `20260823190000` | Archivada como version intermedia. No se reejecuto porque la fase 18 contiene la definicion final de ventas. |
| 4 | `20260823200000` | Conservada y conciliada. Los indices de dashboard existentes no se duplicaron. |
| 5 | `20260823210000` | Conservada como parte de las vistas finales, preservando gastos y el valor mas reciente. |
| 6 | `20260823220000` | Archivada como version intermedia, reemplazada funcionalmente por fase 18. |
| 7 | `20260824100000` | Conservada como definicion final de ventas netas y ventas por responsable. |
| 8 | `20260825000000` | Archivada como intervencion operacional. No se repitio la manipulacion historica del cron; el enforcer quedo interno. |
| 9 | `20260825001000` | Conservada: modelo multitenant de cuentas, suscripciones, documentos de cobro, pagos y bitacora. Se retiro DML directo del navegador. |
| 10 | `20260825002000` | Archivada como backfill unico. Los clientes ya migrados no se insertaron nuevamente. |
| 11 | `20260825003000` | Conservada. RPC de cobro y pago siguen activas, con emision/confirmacion/reversion reservadas a `service_role`. |
| 12 | `20260825004000` | Conservada y corregida. `manual` ahora es proveedor valido e idempotente para aprobaciones de comprobantes. |
| 13 | `20260825005000` | Conservada. El ciclo diario permanece activo, con ejecucion exclusiva de servicio. |
| 14 | `20260825006000` | Reemplazada por cron seguro: el secreto se movio a Vault y ya no queda en texto plano en `cron.job`. |
| 15 | `20260825007000` | Conservada. Backoffice y emision manual siguen disponibles bajo controles de superadministrador. |
| 16 | `20260825010000` | Conservada. Helpers de identidad/superadmin quedaron con `search_path` fijo y sin ejecucion anonima. |
| 17 | `20260825011000` | Conservada. Tabla de permisos protegida sin DML directo; se preservaron las asignaciones existentes para no quitar acceso de negocio. |
| 18 | `20260825012000` | Conservada y corregida. Una baja mantiene acceso total hasta `cubierto_hasta` o `prueba_hasta`. |
| 19 | `20260825013000` | Conservada y endurecida. Aceptacion de terminos obligatoria, identidad unica entre tipos de usuario y prueba de 15 dias sin dia adicional. |
| 20 | `20260825014000` | Conservada. Baja/reactivacion siguen activas, sin purga automatica; el periodo pagado se respeta mediante el contrato de acceso corregido. |
| 21 | `20260825015000` | Conservada con trazabilidad. Aceptaciones heredadas se marcaron `migracion_administrativa`; las nuevas quedan `explicita`. |
| 22 | `20260825016000` | Conservada parcialmente. Metricas/cuentas de backoffice siguen activas; `pagos_por_conciliar`, sin pantalla, quedo solo para servicio. |
| 23 | `20260825017000` | Conservada como guarda central de escritura y sin exposicion anonima. |
| 24 | `20260825018000` | Conservada y reconstruida en UTF-8 real. `subir_cierre_turno` y `guardar_parametros_nomina` pasaron las aserciones de codificacion. |
| 25 | `20260827000000` | Conservada porque `pago-iniciar` usa el banco de pruebas. Se sustituyo `count(*) + 1` por secuencia y bloqueo transaccional. |
| 26 | `20260827010000` | Conservada. Cambio mensual/anual y anulacion de documento futuro siguen disponibles sin acceso anonimo. |
| 27 | `20260827020000` | Archivada como intervencion unica. AX-01004 ya estaba anulada y no se ejecuto nuevamente. |

## Correcciones nuevas aplicadas

- `20260829020000_conciliar_facturacion_y_ciclo_vida.sql`
- `20260829021000_reaplicar_guardas_utf8.sql` (intento historico conservado)
- `20260829021500_corregir_guardas_utf8_real.sql`
- `20260829021700_guardas_utf8_canonicas.sql`
- `20260829022000_validar_conciliacion_27.sql`
- `20260829023000_retirar_rpc_sin_consumidor.sql`

## Alcance fiscal

El modulo implementa facturacion comercial de la suscripcion Enkrato: cuentas,
planes, cobros, comprobantes, pagos, mora, backoffice y ciclo de vida. Los
documentos `AX-*` son documentos internos de cobro. No se presentan como factura
electronica DIAN hasta integrar numeracion autorizada, firma y validacion fiscal.

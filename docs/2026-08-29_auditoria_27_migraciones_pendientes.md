# Auditoría de las 27 migraciones pendientes de conciliación

Fecha de corte: 2026-08-29

Entorno auditado: proyecto Supabase de producción vinculado

Alcance: migraciones locales posteriores a `20260823160000` y anteriores a Rappi

## Dictamen ejecutivo

Las 27 migraciones aparecen como pendientes porque no tienen una fila en
`supabase_migrations.schema_migrations`, pero sus objetos y efectos ya existen en
producción. Fueron aplicadas total o parcialmente por fuera del historial formal.

**No se debe ejecutar ninguna de las 27 migraciones tal como está.** Hacerlo puede
repetir operaciones de datos, reemplazar funciones que hoy tienen ajustes manuales,
quitar `security_invoker=on` de vistas o reprogramar tareas ya activas.

La salida segura es:

1. corregir hacia adelante los defectos encontrados en una migración nueva;
2. validar esa migración en un clon de producción;
3. aplicarla de forma controlada;
4. registrar las 27 versiones como aplicadas mediante reparación del historial,
   sin volver a ejecutar su SQL;
5. comprobar que un entorno vacío puede reconstruirse con la cadena completa.

La migración Rappi `20260829000000_rappi_v1_core.sql` no forma parte de este grupo:
fue aplicada selectivamente y sí está registrada en el historial remoto.

## Evidencia comprobada en producción

- Existen las tres vistas de tableros (`v_dias_operacion`, `v_turnos_lineas` y
  `v_turnos_pivote`) y conservan `security_invoker=on`.
- Existen las RPC de dashboards, facturación, ciclo de vida, consola y guardas.
- Existen las tablas, columnas, restricciones, índices, políticas RLS y datos de
  facturación/ciclo de vida introducidos por estas fases.
- `billing-crear-ciclos` está inactivo y `facturacion-ciclo-diario` está activo con
  horario `10 14 * * *`.
- `AX-01004` ya está anulada y no tiene pagos asociados.
- La versión de términos `2026-08-25` y sus dos registros de aceptación ya existen.
- Los índices de dashboard tienen uso real observado; no son objetos huérfanos.
- El historial remoto salta desde `20260823160000` hasta
  `20260829000000_rappi_v1_core`, confirmando la falta de conciliación de las 27.

La consulta reproducible y exclusivamente de lectura está en
`tools/audit_pending_migrations.sql`.

## Revisión individual

| # | Migración | Objetivo y evidencia actual | Dictamen | Corrección o tratamiento |
|---:|---|---|---|---|
| 1 | `20260823170000_fase_12_tableros_cimientos.sql` | Crear vistas base y `parse_hora`. Las vistas y la función existen y son utilizadas. | **Reescribir/conservar** | No repetir: el archivo local no preserva `security_invoker=on` y degradaría la seguridad remota. Mantener las vistas canónicas con esa opción y cambiar `parse_hora` de `IMMUTABLE` a `STABLE` o hacer su cálculo realmente inmutable. |
| 2 | `20260823180000_fase_13_dashboard_conciliacion.sql` | Exponer conciliación, sedes, días pendientes y marcado de día. Las RPC existen; conciliación y sedes tienen consumidores activos. | **Conservar consolidada** | Mantener en la cadena final. Revisar permisos y decidir si las RPC de días pendientes, hoy sin consumidor visible, se conectan a UI o se retiran. |
| 3 | `20260823190000_fase_14_dashboard_ventas.sql` | Primera versión del dashboard de ventas. Está supersedida por las fases 16–18. | **Descartar como unidad independiente** | Preservar solo en historia Git; la definición canónica debe ser la final de la fase 18. |
| 4 | `20260823200000_fase_15_rendimiento_dashboard.sql` | Crear índices de desempeño para dashboards. Existen y registran uso. | **Conservar/registrar** | No volver a crearlos. Incluir sus definiciones en la línea base y revisar únicamente duplicados señalados por los asesores de base de datos. |
| 5 | `20260823210000_fase_16_gastos_completos_y_valor_mas_reciente.sql` | Preservar gastos y usar el valor más reciente. El comportamiento está activo. | **Reescribir/conservar** | Integrar el resultado en las vistas finales, siempre con `security_invoker=on`; no reemplazar las vistas remotas con este archivo sin corregirlo. |
| 6 | `20260823220000_fase_17_gastos_en_resumen_y_ventas_por_responsable.sql` | Agregar gastos al resumen y ventas por responsable. Supersedida por fase 18. | **Descartar como unidad independiente** | Mantener solo la definición final corregida. |
| 7 | `20260824100000_fase_18_corregir_ventas_netas_dashboard.sql` | Corregir venta neta en dashboards generales y por responsable. Las RPC finales existen y tienen consumidores. | **Conservar consolidada** | Adoptar estas definiciones como canónicas, con pruebas de totales, responsables y permisos por tenant. |
| 8 | `20260825000000_fac_fase0_detener_hemorragia.sql` | Detener el ciclo defectuoso y convertir el enforcer en observador. El cron anterior está inactivo y existen observaciones. | **Descartar como migración ejecutable** | Guardar como evidencia operacional. Una migración nueva debe corregir los permisos del enforcer; no se debe repetir la manipulación del cron. |
| 9 | `20260825001000_fac_fase1_modelo_cuentas.sql` | Crear el modelo multitenant de cuentas, suscripciones, facturas, pagos y bitácora. Todo existe y contiene datos. | **Conservar/esquematizar** | Consolidar el esquema real, restricciones y RLS. Revocar DML directo a `anon` y limitar `authenticated`; las escrituras deben pasar por RPC controladas o `service_role`. |
| 10 | `20260825002000_fac_fase2_migrar_clientes.sql` | Migrar clientes existentes al modelo nuevo. Los datos ya están poblados. | **Archivar como migración de datos no repetible** | No ejecutar otra vez. Para entornos nuevos, usar fixtures/seed explícito; para producción, conservar conteos y mapeo como evidencia de conciliación. |
| 11 | `20260825003000_fac_fase3_rpcs_cobro.sql` | Crear cálculo, emisión, referencia y consulta de cobros. Las RPC existen y son usadas. | **Conservar con correcciones críticas** | Revocar ejecución anónima, reforzar alcance por cuenta/empresa y separar cotización/intención de pago de la emisión del documento. Revisar numeración y naturaleza fiscal antes de llamar “factura” al documento `AX-*`. |
| 12 | `20260825004000_fac_fase3b_revision_manual.sql` | Aprobar/rechazar comprobantes manuales. Las RPC existen y la UI las consume. | **Conservar y corregir** | `aprobar_pago` registra proveedor `manual`, pero la restricción de `pasarela_eventos` solo admite `wompi` y `mercadopago`. Ampliar/modelar el proveedor antes de utilizar aprobaciones manuales y agregar prueba transaccional. |
| 13 | `20260825005000_fac_fase4_ciclo_automatico.sql` | Emitir cobros diarios, marcar mora y generar avisos. La función existe y el cron está activo. | **Conservar con bloqueo de seguridad** | Quitar acceso a `anon`, exigir invocación de servicio y probar idempotencia. Se recomienda pausar temporalmente el cron hasta cerrar permisos y semántica fiscal. |
| 14 | `20260825006000_fac_fase4_cron.sql` | Programar el ciclo diario. El trabajo ya está activo. | **Reemplazar/descartar el SQL actual** | Gestionar el cron con una operación idempotente y secreto dedicado. No extraer ni reutilizar secretos incrustados en comandos de otros cron. |
| 15 | `20260825007000_fac_fase5_backoffice.sql` | Añadir consola inicial, emisión manual y ayudas de cuenta. Los objetos existen. | **Conservar** | Mantener consumidores activos y aplicar mínimo privilegio a toda RPC `SECURITY DEFINER`. |
| 16 | `20260825010000_cv_faseA_desatascar.sql` | Estabilizar helpers de identidad/superadmin y quitar bloqueos anteriores. Las definiciones están desplegadas. | **Conservar definición final** | No reproducir versiones intermedias. Consolidar helpers con `search_path` fijo, permisos explícitos y pruebas de identidad. |
| 17 | `20260825011000_cv_faseB_superadmin.sql` | Crear permisos de superadmin. La tabla existe con dos filas. | **Conservar y ajustar datos** | Reemplazar el otorgamiento masivo `todo` a todos los usuarios de sistema por una lista explícita y revisada por negocio. Mantener auditoría de altas/bajas de privilegio. |
| 18 | `20260825012000_cv_faseC_estados.sql` | Modelar estados y resolver el acceso de una empresa. Está activo. | **Conservar y corregir** | `cancelada` pasa de inmediato a solo facturación aunque exista período pagado. Definir cancelación efectiva al final de `servicio_hasta` o mantener acceso total hasta esa fecha. |
| 19 | `20260825013000_cv_faseC_alta.sql` | Registro autoservicio, prueba y alta. La UI actual envía el checkbox de términos. | **Conservar y endurecer** | El servidor debe usar aceptación por defecto `false`/obligatoria, exigir versión de términos, comprobar duplicados tanto en `usuarios_sistema` como en `otros_usuarios` y definir exactamente si “15 días” incluye el día inicial para evitar un día extra. |
| 20 | `20260825014000_cv_faseD_baja.sql` | Baja, reactivación y ciclo de vida. Las RPC existen. | **Conservar y corregir** | No cancelar acceso pagado de inmediato. Separar solicitud, fecha efectiva y ejecución; mantener prohibida cualquier purga automática de datos sin autorización específica. |
| 21 | `20260825015000_cv_faseE_terminos.sql` | Versionar términos y registrar aceptaciones. Ya hay una versión y dos aceptaciones. | **Reemplazar por versión legal revisada** | No representar la migración administrativa de clientes previos como consentimiento explícito. Registrar origen/tipo de aceptación y solicitar aceptación verificable de una versión nueva. Revisión jurídica obligatoria de privacidad, tratamiento de datos, facturación y cancelación. |
| 22 | `20260825016000_cv_faseF_consola.sql` | Métricas, backoffice y conciliación. Dos RPC tienen UI; `pagos_por_conciliar` no. | **Conservar parcialmente** | Mantener `cuentas_backoffice` y `metricas_facturacion`; conectar `pagos_por_conciliar` a una pantalla y permisos claros o retirar su exposición. |
| 23 | `20260825017000_cv_faseC_guarda_servidor.sql` | Centralizar el bloqueo de escritura por estado. La guarda existe y se usa desde backend/router. | **Conservar** | Mantener como único contrato y cubrir con pruebas para prueba, activa, mora, implementación, cancelación programada y cancelada. |
| 24 | `20260825018000_cv_faseC_guarda_en_rpcs.sql` | Incorporar la guarda a RPC críticas. Las funciones remotas contienen la guarda, pero también texto con mojibake. | **Reconstruir desde UTF-8 canónico** | Corregir mensajes dañados en `subir_cierre_turno` y `guardar_parametros_nomina`; desplegar una definición limpia y probar ambos flujos antes/después. |
| 25 | `20260827000000_fac_banco_de_pruebas.sql` | Habilitar cuentas y documentos de prueba de pagos. Existe una cuenta marcada y la RPC es solo de servicio. | **Conservar condicionalmente** | Mantener solo si sigue siendo necesario probar pagos en producción. Eliminar la numeración `count(*) + 1`, vulnerable a concurrencia, y usar secuencia/identificador transaccional; de lo contrario deshabilitar la función y retirar su consumidor. |
| 26 | `20260827010000_fac_cambio_de_modalidad.sql` | Cambiar mensual/anual y anular un cobro futuro no pagado. La UI usa el cambio y sus permisos no están expuestos a `anon`. | **Conservar y ajustar diseño** | Añadir regresiones de cambio de modalidad. Evitar emitir una “factura” anual de período futuro al cotizar; usar cotización/intención y emitir el documento cuando corresponda. |
| 27 | `20260827020000_fac_anular_ax01004.sql` | Anular específicamente `AX-01004`. Ya está anulada, total 575.040 y sin pagos. | **Descartar como ejecutable** | Objetivo cumplido. Conservar solo un registro de auditoría de la intervención y no incluir SQL específico de producción en futuras instalaciones. |

## Defectos transversales que bloquean una conciliación directa

### P0 — Seguridad y aislamiento

El asesor remoto reportó 29 RPC relevantes `SECURITY DEFINER` ejecutables por
`anon`. Entre las que modifican estado o generan documentos se encuentran
`emitir_factura_cuenta`, `factura_a_pagar`, `facturacion_ciclo_diario`,
`billing_daily_enforcer`, `ciclo_vida_diario` y `siguiente_numero_factura`.

Corrección inmediata propuesta:

1. `REVOKE EXECUTE ... FROM PUBLIC, anon` para todas las RPC de servicio;
2. otorgar solo a `authenticated` las RPC de usuario que verifican tenant y solo a
   `service_role` las de cron, emisión y mantenimiento;
3. revocar DML directo sobre tablas de facturación/ciclo de vida y usar RPC acotadas;
4. fijar `search_path` en todas las funciones `SECURITY DEFINER`;
5. mover, proteger o retirar cuatro tablas `zz_backup_*` que hoy están en `public`
   sin RLS;
6. pausar el cron de facturación hasta que las pruebas negativas confirmen que un
   usuario anónimo/autenticado no puede emitir, cambiar estado ni leer otro tenant.

### P1 — Integridad funcional

- Hacer compatible el evento `manual` con la restricción de proveedores.
- Respetar el período ya pagado al solicitar baja.
- Reparar los dos cuerpos de función con codificación dañada.
- Endurecer el alta autoservicio, la aceptación de términos y el cálculo de prueba.
- Sustituir contadores basados en `count(*) + 1` por numeración transaccional.
- Resolver índices duplicados y los errores de lint preexistentes antes de declarar
  una reconstrucción limpia y reproducible.

### P2 — Facturación y cumplimiento

Los registros `AX-*` funcionan como documentos internos de cobro, pero no se debe
asumir que constituyen factura electrónica válida. La DIAN exige, entre otros
elementos, numeración autorizada y el proceso técnico de generación, firma y
validación del documento electrónico. Hasta integrar un proveedor/flujo DIAN y
validarlo con contabilidad, la UI y los términos deben llamarlos “cobro”, “estado
de cuenta” u “orden de pago”, no factura fiscal.

Referencias oficiales:

- [DIAN: requisitos para facturar electrónicamente](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/que-requieres-para-factura-electronicamente/)
- [DIAN: numeración y autorización](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/numeracion-autorizacion/)
- [Resolución DIAN 165 de 2023, compilada](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm)
- [Ley 1581 de 2012: protección de datos personales](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)

La versión siguiente de términos debe pasar por revisión jurídica y contable; esta
auditoría técnica no reemplaza ese concepto profesional.

## Plan de corrección y conciliación

### Fase 1 — Contención

- Congelar despliegues de las 27 versiones.
- Exportar definiciones y conteos del esquema remoto, sin datos sensibles.
- Pausar el cron de facturación durante la ventana de corrección.
- Aplicar una migración nueva posterior a Rappi con revocaciones de permisos,
  protección de tablas backup y `search_path` seguro.

Condición de salida: pruebas negativas 401/403 o error de permisos para todos los
casos anónimos, y aislamiento confirmado entre dos tenants de prueba.

### Fase 2 — Correcciones funcionales

- Aplicar los arreglos P1 en una nueva migración hacia adelante.
- Añadir pruebas de aprobación manual, baja con período pagado, cambio de modalidad,
  registro con/sin términos, vencimiento de prueba y concurrencia de numeración.
- Decidir con negocio si `pagos_por_conciliar` y el banco de pruebas permanecen.

Condición de salida: suite SQL/Deno/frontend verde y sin cambios inesperados en los
conteos financieros existentes.

### Fase 3 — Decisión fiscal/legal

- Cambiar nomenclatura a documento de cobro interno o implementar facturación
  electrónica DIAN de extremo a extremo.
- Publicar términos versionados revisados y solicitar consentimiento explícito.
- Conservar trazabilidad de origen, fecha, versión, usuario y evidencia.

### Fase 4 — Reconciliación del historial

Solo después de desplegar y validar las correcciones:

1. probar la cadena completa en una base vacía;
2. comprobar definiciones canónicas contra producción;
3. registrar las 27 versiones como `applied` con `supabase migration repair`, sin
   ejecutar sus archivos en producción;
4. ejecutar `db push --dry-run` y exigir resultado vacío;
5. documentar hashes, conteos y responsable de la conciliación.

No se debe usar `migration repair` antes de la migración correctiva: ocultaría la
divergencia actual sin resolverla.

## Matriz mínima de validación antes de reactivar el cron

| Área | Prueba obligatoria |
|---|---|
| Permisos | `anon` no puede emitir, aprobar, anular, ejecutar cron ni consultar datos privados. |
| Tenant | Un usuario de empresa A no puede leer o cambiar información de empresa B. |
| Idempotencia | Dos ejecuciones del cron no duplican factura/cobro, bitácora ni aviso. |
| Pago manual | Aprobación válida se registra una sola vez; rechazo no cambia saldo; reintento es seguro. |
| Baja | El acceso permanece hasta la fecha cubierta y cambia exactamente en la fecha efectiva. |
| Modalidad | Cambio mensual/anual no crea documentos futuros indebidos ni dobles. |
| Alta | Sin aceptación explícita no hay registro; no admite duplicados en ningún tipo de usuario. |
| Tableros | Totales actuales coinciden y las vistas siguen con `security_invoker=on`. |
| Datos | Conteos y sumas financieras antes/después coinciden salvo cambios esperados y auditados. |

## Estado de Rappi al cierre

- Migración de base aplicada y registrada de forma independiente.
- Cinco Edge Functions desplegadas con los controles de autenticación previstos.
- Pruebas negativas de autenticación satisfactorias.
- Cero filas Rappi creadas por el despliegue.
- Sin cron Rappi, credenciales de comercio, mapeos ni webhook productivo activados.

La integración queda técnicamente disponible pero inerte hasta que se suministren y
validen credenciales/mapeos de producción y se autorice expresamente su activación.

# Correcciones de integración Enkrato + Rappi V4 y 1 parche

Fecha: 29 de agosto de 2026

## Resultado implementado

- Las páginas Rappi reutilizan `js/header.js` y `css/main.css`; ya no existe un header alternativo.
- La navegación visible usa únicamente **Rappi** e **Integración Rappi**. Se retiraron R1/R2/R3 y Financial de la UI.
- La operación muestra pedidos, tienda, hora, estado en lenguaje de negocio, total, forma de pago, último cambio e historial.
- Tiendas y menús muestran estado y última actualización sin exponer IDs, firmas, URLs, colas ni nombres de eventos.
- El cliente solo aporta Client ID y Client Secret de pruebas. Los dominios DEV se resuelven en backend.
- Producción Rappi permanece bloqueada hasta contar con autorización y credenciales reales.
- El onboarding ejecuta: guardar cifrado, token, descubrir tiendas, configurar ocho eventos, verificar URL/tiendas, programar tareas e iniciar una sincronización.
- Los eventos son una política fija de Enkrato y no aparecen como interruptores del cliente.
- La carga de menú DEV por tienda valida tamaño y estructura antes de llamar el endpoint oficial.
- La sincronización de menús usa la ruta oficial vigente `menu/rappi/{storeId}` sobre el dominio de microservicios DEV.
- No hay dependencia Rappi de n8n.

## Seguridad y aislamiento

- Secretos y tokens permanecen cifrados y en tablas restringidas a `service_role`.
- RLS y aislamiento por empresa de las tablas Rappi continúan activos.
- El webhook conserva el cuerpo original para validar HMAC antes del procesamiento.
- La persistencia conserva idempotencia por evento y transiciones protegidas de pedido.
- Firebase excluye `.env`, Supabase, SQL, documentación, herramientas y archivos internos.

## Validación ejecutada

- 82 archivos JavaScript pasaron validación sintáctica.
- Cinco Edge Functions Rappi pasaron `deno check`.
- 20 pruebas Deno pasaron: URL segura, HMAC, payload/PII, idempotencia, estados, conciliación, menú y verificación remota de webhooks.
- La prueba estática V4 confirmó header global, ausencia de términos prohibidos y política fija de ocho eventos.
- Chrome headless validó escritorio 1440 px y móvil 390 px sin overflow horizontal ni header alternativo.
- `git diff --check` pasó sin errores.

## Evidencia externa pendiente

La finalización de DEV exige ejecutar desde una sesión administrativa de Enkrato el botón **Conectar y configurar** y generar pruebas desde Rappi Integrations Manager. Deben conservarse los IDs y timestamps de los ocho eventos y verificar su llegada a base de datos/UI. Esta evidencia depende de usar las credenciales reales contra servicios externos y no se sustituye con datos simulados.

## Referencias oficiales verificadas

- https://dev-portal.rappi.com/dev-portal/es/api-reference/authentication/
- https://dev-portal.rappi.com/dev-portal/es/api-reference/webhooks/
- https://dev-portal.rappi.com/dev-portal/es/api-reference/menus/
- https://dev-portal.rappi.com/dev-portal/es/webhook-events/

---

## Parche 1: diagnóstico definitivo y prueba end-to-end de firmas

Fecha del parche: 30 de agosto de 2026

### Objetivo de la petición

Resolver los `HTTP 401 INVALID_SIGNATURE` observados en `NEW_ORDER`, `STORE_CONNECTIVITY` y `ORDER_RT_TRACKING`, comprobar si el problema pertenecía a Enkrato o al probador de Rappi, dejar datos DEV concretos visibles y conservar la verificación HMAC estricta para no comprometer producción.

### Causa demostrada

Las tres muestras del documento se validaron de forma ciega contra:

- el secreto HMAC cifrado vigente de cada webhook;
- el Client Secret operacional DEV;
- el contrato oficial `HMAC-SHA256(secret, timestamp + "." + rawBody)`.

Los seis cruces dieron `false`. El encabezado sí se pudo parsear, pero las firmas no fueron creadas con ningún secreto de Enkrato. No se modificó el receptor para aceptar esas firmas porque eso eliminaría la autenticidad del webhook.

La sesión autenticada de `integrations-manager.rappi.com` mostró solamente `DEFAULT (NO USAR) (CO)`. El alcance persistido era `DEFAULT(NOUSAR)`, mientras que el Client ID DEV de Enkrato no estaba disponible en el selector. Las consultas de suscripciones y muestras para el Client ID real de Enkrato devolvieron `404 NOT FOUND`. Por tanto, el panel usado para las tres pruebas no está asociado por Rappi a las credenciales sandbox entregadas a Enkrato y genera firmas desde otro alcance.

La corrección pendiente es administrativa del proveedor: Rappi debe asociar a la cuenta de Integrations Manager el Client ID sandbox de Enkrato y la tienda `900170987`, o entregar una cuenta que ya tenga esa asociación. No se requiere ni se permite debilitar HMAC en Enkrato.

### Archivos implicados y comportamiento

| Archivo | Tipo de cambio | Objetivo y comportamiento explícito |
|---|---|---|
| `supabase/functions/rappi-admin/index.ts` | Backend/seguridad | Añade `diagnose_signature`, solo admin y DEV, que compara una muestra con secretos descifrados dentro del servidor y devuelve únicamente booleanos. Añade `test_webhooks`, solo admin, DEV y confirmación explícita: crea una orden marcada `ENKRATO-DEV-*`, firma tres payloads oficiales, llama los endpoints reales y procesa la cola. Nunca devuelve secretos ni firmas calculadas. |
| `tools/run_rappi_dev_onboarding.mjs` | Operación/QA | Añade `check-signatures` para reproducir las tres muestras del documento y `test-webhooks` para comprobar HTTP, worker y datos persistidos. La salida omite credenciales. |
| `tools/test_rappi_portal.mjs` | Automatización Chrome | Reconoce el selector en español o inglés e intenta seleccionar exclusivamente el Client ID DEV definido en `.env`. |
| `tools/probe_rappi_portal_webhooks.mjs` | Diagnóstico Chrome/API | Consulta desde una sesión autenticada el alcance, integraciones y suscripciones; redacta claves sensibles y bloquea el envío de muestras a cualquier Client ID diferente al DEV de Enkrato. |
| `docs/rappi_mcp_base/02_EVIDENCIA_SANDBOX_Y_DIAGNOSTICO.md` | Evidencia MCP | Registra la causa externa, la prueba firmada correcta y los criterios de cierre con Rappi. |
| `docs/rappi_mcp_base/README.md` | Índice | Actualiza el nombre de este documento con el contador de parches. |
| `docs/2026-08-29_correcciones_integracion_rappi_v4_y_3_parches.md` | Documento principal | Conserva el cambio V4 original y sus parches, según la regla de documentación acumulativa. |

No se borraron archivos funcionales ni se modificaron migraciones, UI o configuración de Firebase en este parche.

### Evidencia funcional del lado Enkrato

La prueba end-to-end ejecutada con los secretos vigentes produjo:

| Componente | Resultado |
|---|---|
| `NEW_ORDER` | HTTP 200, aceptado y procesado |
| `STORE_CONNECTIVITY` | HTTP 200, aceptado y procesado |
| `ORDER_RT_TRACKING` | HTTP 200, aceptado y procesado |
| Worker | 3 tomados, 3 procesados, 0 reintentos, 0 muertos |
| Orden DEV | Encontrada, total 1.500, estado `IN_DELIVERY` |
| Evento de nueva orden | Persistido |
| Tracking | 1 registro `ON_THE_WAY` |
| Webhooks | 8 activos, 8 recibidos, 8 con firma válida |
| Incidentes abiertos | 0 |

Orden de evidencia más reciente: `ENKRATO-DEV-1788125848688`. Es un dato de prueba reconocible y puede filtrarse por ese prefijo.

### Checklist funcional

- [x] Autenticación Rappi DEV y token operacional.
- [x] Tienda Batut descubierta, mapeada y `ONLINE`.
- [x] Ocho webhooks habilitados con URL Supabase y secreto cifrado.
- [x] HMAC oficial sobre `timestamp.rawBody`, sin bypass.
- [x] Nueva orden firmada: recibe, encola y persiste.
- [x] Conectividad firmada: recibe, encola y persiste.
- [x] Tracking firmado: recibe, encola y aparece en detalle.
- [x] Páginas Firebase `/rappi/operacion` y `/rappi/integracion`: HTTP 200.
- [x] 27 pruebas Deno y prueba estática frontend.
- [ ] Testing del Integration Manager con el Client ID real: bloqueado porque la cuenta solo muestra `DEFAULT (NO USAR) (CO)` y el Client ID Enkrato devuelve 404.
- [ ] Certificación del proveedor: requiere que Rappi asocie cuenta, Client ID y tienda; después se repiten los tres eventos.

### Reversión de emergencia

La reversión no requiere tocar tablas ni secretos:

1. En `supabase/functions/rappi-admin/index.ts`, eliminar del `switch` los casos `diagnose_signature` y `test_webhooks`.
2. En el mismo archivo, quitar el import de `hmacSha256Hex` y conservar `validateRappiSignature` solo si se mantiene el diagnóstico. Eliminar las funciones completas `diagnoseSignature` y `testWebhooks` desde sus comentarios de cabecera hasta la llave final.
3. Redesplegar solo `rappi-admin`. `rappi-webhook`, `rappi-worker`, secretos, suscripciones y datos reales permanecen intactos.
4. En `tools/run_rappi_dev_onboarding.mjs`, retirar los modos `check-signatures` y `test-webhooks`, `checkDocumentedSignatures` y `verifyWebhookTestData`.
5. Eliminar `tools/probe_rappi_portal_webhooks.mjs` si no se desea conservar el diagnóstico del portal. En `tools/test_rappi_portal.mjs`, revertir únicamente la detección bilingüe del selector si fuera necesario.
6. Los pedidos `ENKRATO-DEV-*` son evidencia DEV. Si se decide retirarlos, hacerlo mediante una migración de limpieza revisada que filtre exactamente ese prefijo; no ejecutar borrados manuales amplios.
7. Validar la reversión con `deno check`, las 27 pruebas y `node tools/test_rappi_frontend.mjs` antes del redespliegue.

### Guía para exportar el cambio a otro repositorio

1. Portar conjuntamente el receptor HMAC, cifrado, tablas de configuración/secreto y contexto multiempresa. Copiar solo la acción administrativa sin esas dependencias produciría una prueba falsa o insegura.
2. Centralizar las URLs de interfaz en el equivalente a `js/config.js`/`APP_URLS`. Las URLs externas de Rappi deben resolverse en backend por ambiente; no duplicarlas en HTML o herramientas de cliente.
3. Centralizar el host Supabase con la configuración del repositorio destino. La función construye internamente `/functions/v1/rappi-webhook` y `/functions/v1/rappi-worker`; comprobar que el destino mantiene esos nombres o adaptar ambos de forma atómica.
4. Mantener separados Client Secret operacional y secret HMAC por evento. Nunca usar el primero como fallback del segundo.
5. Crear los equivalentes de `diagnose_signature` y `test_webhooks` con autenticación admin, límite DEV y confirmación explícita. Verificar que ninguna función existente ya genere muestras para evitar datos duplicados.
6. Portar `tools/run_rappi_dev_onboarding.mjs` después de adaptar la lectura de URL/anon key centralizadas. No versionar `.env`, perfiles Chrome, cookies ni resultados con tokens.
7. Ejecutar, en orden: comprobación de tipos, pruebas unitarias HMAC/payload, prueba end-to-end firmada, consulta de orden/tracking, verificación HTTP de UI y auditoría de secretos en Git.
8. Antes de usar el Integration Manager, confirmar que su selector muestra el mismo Client ID del ambiente. Si muestra `DEFAULT (NO USAR)` o el endpoint devuelve 404, detener el test y solicitar asociación a Rappi; no aceptar firmas alternativas.

### Comandos de verificación

```powershell
node tools/run_rappi_dev_onboarding.mjs check-signatures
node tools/run_rappi_dev_onboarding.mjs test-webhooks
node tools/run_rappi_dev_onboarding.mjs diagnose
deno test --allow-env supabase/functions/_shared/fechas_test.ts supabase/functions/_shared/ventas_test.ts supabase/functions/_shared/rappi/*_test.ts
node tools/test_rappi_frontend.mjs
```

### Despliegue

Se desplegó `rappi-admin` en Supabase `tgkvcvnwwnrlyhbqmhaf`. No se ejecutó un nuevo despliegue Firebase porque este parche no cambia archivos servidos por Hosting; las dos rutas Rappi ya publicadas respondieron HTTP 200 en `restaurantes.enkrato.com`.

---

## Parche 2: separar simulación de operación, permisos y accesos Loggro

Fecha del parche: 1 de septiembre de 2026

### Objetivo

Reauditar los tres `HTTP 401 INVALID_SIGNATURE`, rastrear los pedidos de $1.500 y el estado «Rechazado» del menú, impedir que las pruebas creen hallazgos de negocio, restringir Integración Rappi/Loggro a `admin` y `admin_root`, y añadir el atajo de credenciales Loggro a Cierre de turno y Cierre inventarios sin modificar el menú real de Batut.

### Causa comprobada en vivo

- Los cinco eventos `ORDER_EVENT_CANCEL`, `ORDER_OTHER_EVENT`, `MENU_APPROVED`, `MENU_REJECTED` y `PING` validaron HMAC el 1 de septiembre.
- `NEW_ORDER`, `STORE_CONNECTIVITY` y `ORDER_RT_TRACKING` llegaron con `SIGNATURE_MISMATCH`. La validación termina antes del worker y antes de RLS: no es un problema de políticas de Supabase.
- El Integration Manager autenticó la cuenta, pero `/api/integrations` respondió 500, el selector no ofreció integraciones y la consulta del Client ID DEV devolvió 404. Por tanto, la cuenta del portal sigue sin el alcance de las credenciales DEV usadas por Enkrato.
- Los pedidos `ENKRATO-DEV-1788125794466` y `ENKRATO-DEV-1788125848688` fueron creados por `rappi-admin/test_webhooks`; no vinieron de una orden real de Rappi.
- `SAMPLE-ORDER-0001` se creó al procesar eventos de cancelación/otros del simulador sin un `NEW_ORDER` previo.
- El estado «Rechazado» provino de `MENU_REJECTED` con `menu_id=SAMPLE-MENU-0001`. La versión de menú sincronizada desde Rappi contiene 42 productos y no reportó rechazo propio. No se envió ni modificó el menú.

### Modelo multitenant y producción verificado

La documentación oficial vigente confirma:

1. DEV usa `https://api.dev.rappi.com`; producción Colombia usa el host constante `https://api.rappi.com.co` y el path base `/api/v2/restaurants-integrations-public-api`.
2. Los tokens se generan con `client_id` y `client_secret`, duran una semana en el flujo clásico y deben renovarse al expirar.
3. Los webhooks son recursos del cliente autenticado. La API permite crearlos, cambiar URL, cambiar estado, agregar/quitar tiendas y rotar el secret. Una configuración DEV no se transporta automáticamente a PROD.
4. El self-onboarding moderno requiere una configuración inicial única del TAM de Rappi (Integration + clientId Auth0) y autorización OAuth2 Authorization Code + PKCE del comercio. Después de esa habilitación, el alta de tiendas y webhooks puede ser autoservicio y escalable.
5. Enkrato puede conservar URLs propias constantes por evento y registrarlas automáticamente para cada cliente/ambiente. No es necesario entrar manualmente al portal de cada cliente si Rappi habilita el clientId y el flujo de onboarding; entregar solo credenciales de producción no sustituye esa habilitación inicial.

Fuentes revisadas:

- https://dev-portal.rappi.com/es/self-onboarding/
- https://dev-portal.rappi.com/es/authentication-process/
- https://dev-portal.rappi.com/dev-portal/es/api-reference/webhooks/
- https://dev-portal.rappi.com/dev-portal/es/webhook-events/

### Archivos implicados

| Archivo | Modificación y objetivo |
|---|---|
| `supabase/functions/_shared/rappi/payload.ts` | Identifica payloads oficiales `SAMPLE-*` del probador sin confundirlos con órdenes reales ni con la prueba interna controlada. |
| `supabase/functions/_shared/rappi/payload_test.ts` | Prueba muestras de pedido/menú y casos reales/no simulados. |
| `supabase/functions/rappi-worker/index.ts` | Acepta y marca como procesada la muestra firmada, pero omite sus efectos de pedido, tracking y menú. La recepción/HMAC sigue certificándose. |
| `supabase/functions/rappi-admin/index.ts` | Verifica persistencia end-to-end de la prueba interna y elimina inmediatamente pedido, evento normalizado y tracking creados por ella. |
| `tools/run_rappi_dev_onboarding.mjs` | Comprueba que la evidencia existió durante la prueba y que el pedido ya no existe al terminar. |
| `js/header.js` | Añade «Integración Loggro» en ambos acordeones solo para `admin`/`admin_root`; restringe el enlace Rappi a esos roles. |
| `js/rappi/core.js`, `js/rappi/integracion.js` | Elimina roles heredados de la condición administrativa y redirige a la operación si alguien no autorizado abre la URL directa. |
| `js/loggro.js` | Alinea el frontend con el backend: solo `admin` y `admin_root`. |
| `cierre_turno/index.html`, `cierre_inventarios/index.html`, `configuracion/loggro.html`, `rappi/integracion.html` | Actualizan cachebuster para cargar los cambios de JS. |
| `tools/test_rappi_frontend.mjs` | Verifica autolimpieza, filtrado de muestras, dos atajos Loggro y roles permitidos. |

Las funciones `guardar-credenciales`, `consultar-credenciales` y `rappi-admin` ya aplicaban `exigirAdmin`; `tenant.ts` define exclusivamente `admin_root` y `admin`, además del superadministrador de plataforma representado por `system_users`. Las políticas RLS usan `app_es_admin()`, cuya lista también es `admin_root`/`admin`. No fue necesaria una migración de permisos.

### Tratamiento de los artefactos históricos

La eliminación remota de las tres filas históricas fue bloqueada por el control de seguridad destructiva, que exige una confirmación adicional después de enumerar los IDs exactos. No se eludió el bloqueo ni se modificó el menú persistido.

Se desplegó la alternativa reversible:

- `rappi-data` excluye de conteos, listados y detalle los identificadores `SAMPLE-*` y `ENKRATO-DEV-*`;
- `rappi-data` y `rappi-admin` reconstruyen el estado visible del menú omitiendo eventos cuyo `menu_id` sea `SAMPLE-*`;
- `rappi-worker` impide que nuevas muestras vuelvan a crear esos efectos;
- `test_webhooks` verifica el ciclo de persistencia y está preparado para autolimpiar su pedido, pero su prueba viva no se ejecutó porque incluye una eliminación remota y requiere aprobación adicional.

Resultado de lectura tras el despliegue: cero pedidos visibles, cero incidentes visibles, una tienda, un menú visible. Las filas históricas y eventos raw permanecen en base como evidencia hasta recibir autorización explícita de limpieza.

### Checklist funcional

- [x] Causa del 401 separada de RLS y del receptor HMAC.
- [x] Cuenta del Integration Manager auditada sin enviar nuevas muestras.
- [x] Origen de los tres pedidos de simulación trazado.
- [x] Origen de «Menú rechazado» trazado a `SAMPLE-MENU-0001`.
- [x] Muestras `SAMPLE-*` sin efectos en pedidos/menú.
- [x] Prueba interna preparada para autolimpieza.
- [x] Artefactos históricos excluidos de operación sin borrado remoto.
- [x] Atajos Loggro limitados a `admin`/`admin_root` en ambos acordeones.
- [x] Integración Rappi y Loggro limitadas en frontend y backend.
- [ ] Retest de los tres eventos desde el Client ID DEV correcto: depende de que Rappi asocie el Client ID y la tienda a la cuenta del portal.
- [ ] Borrado físico de los tres pedidos históricos: requiere confirmación destructiva adicional para los IDs documentados.

### Reversión de emergencia

1. En `payload.ts`, eliminar `isRappiTesterSample`; en `rappi-worker/index.ts`, retirar su import y volver a ejecutar siempre el `switch`. Esto restaura el comportamiento anterior, incluido el riesgo de datos falsos.
2. En `rappi-admin/index.ts`, retirar `verifyControlledTestOrder`, `cleanupControlledTestOrder`, `persisted`, `cleaned`, `workerOk` y `lifecycleOk`; restaurar `all_ok` a la comprobación exclusiva de respuestas HTTP.
3. En `header.js`, eliminar los dos enlaces «Integración Loggro» y restaurar la lista antigua de roles solo si se decide volver a admitir roles no reconocidos por el backend.
4. En `rappi/integracion.js`, retirar la redirección; en `rappi/core.js` y `loggro.js`, revertir la condición de roles si el modelo de usuarios cambia formalmente.
5. Revertir los cachebusters a la versión anterior únicamente junto con los JS anteriores.
6. Validar `deno check`, pruebas Deno y `node tools/test_rappi_frontend.mjs` antes de redesplegar `rappi-worker`/`rappi-admin` y Firebase Hosting.

### Exportación a otro repositorio

Portar conjuntamente `payload.ts`, `rappi-worker`, `rappi-admin` y sus pruebas; copiar solo el filtro sin autolimpieza deja residuos de la prueba interna, y copiar solo la autolimpieza permite que el simulador vuelva a alterar el menú. Centralizar URLs en el equivalente de `js/urls.js`, mantener los dominios Rappi por ambiente en backend y verificar que los roles administrativos del repositorio destino sean exactamente los reconocidos por su guarda de servidor/RLS. Adaptar nombres de tablas y relaciones antes de copiar la limpieza. No exportar `.env`, cookies, perfiles Chrome, service role ni payloads con PII.

### Validación y despliegue del parche 2

- `deno check`: `rappi-webhook`, `rappi-worker`, `rappi-admin` y `rappi-data` correctas.
- 24 pruebas compartidas Rappi: aprobadas; la batería completa ejecutada durante el parche alcanzó 29 pruebas con fechas/ventas, sin fallos.
- JavaScript de header, Rappi, Loggro y herramienta operativa: sintaxis correcta.
- Prueba estática Rappi: aprobada con ocho eventos, dos accesos Loggro, filtrado `SAMPLE-*` y autolimpieza declarada.
- `git diff --check`: sin errores.
- Despliegue Supabase: `rappi-worker`, `rappi-admin` y `rappi-data` en `tgkvcvnwwnrlyhbqmhaf`.
- Despliegue Firebase Hosting: versión `7b90998be539a5d7` publicada en el canal live.
- Verificación viva autenticada: conexión `CONNECTED`, 1 tienda, 8 webhooks activos, 8 con recepción y firma válida histórica, token operacional vigente, 0 pedidos visibles, 0 incidentes visibles y menú `PENDING`.
- Verificación anónima: `rappi-admin`, `rappi-data`, `consultar-credenciales` y `rappi_connection_secrets` respondieron HTTP 401.
- Rutas públicas `cierre_turno`, `cierre_inventarios` y `rappi/integracion`: HTTP 200 con cachebuster nuevo; `header.js` publicado contiene exactamente dos accesos «Integración Loggro».
- Prueba viva `test_webhooks`: no ejecutada después del parche porque su autolimpieza implica borrado remoto y el control de seguridad exigió confirmación adicional.

## Parche 3 — cierre completo del entorno Rappi DEV (2026-09-01)

El usuario autorizó explícitamente las operaciones remotas y destructivas que
habían quedado pendientes. Con esa autorización se completó la reparación de
suscripciones, la certificación end-to-end y la limpieza física de las muestras.

### Reparación y certificación remota

1. `repair-signatures` volvió a suscribir `NEW_ORDER`, `STORE_CONNECTIVITY` y
   `ORDER_RT_TRACKING` en Rappi DEV con la URL y el secreto vigentes de Enkrato.
   Rappi aceptó las tres operaciones y cada evento quedó asociado a una tienda.
2. La prueba viva posterior envió los tres eventos firmados a los endpoints
   desplegados. Los tres respondieron HTTP 200.
3. `rappi-worker` reclamó y procesó 3/3 trabajos, sin reintentos ni trabajos
   muertos. Durante la prueba se comprobó pedido `IN_DELIVERY`, total 1.500,
   evento `NEW_ORDER` y un registro de tracking.
4. El pedido controlado se autolimpió y su ausencia se verificó mediante
   `rappi-data`.

### Limpieza física autorizada

Se añadió `cleanup_dev_test_data` a `rappi-admin`. La operación exige usuario
administrador, confirmación explícita y ambiente DEV; no admite identificadores
arbitrarios, sino solamente los marcadores reconocibles `SAMPLE-*`,
`ENKRATO-DEV-*` y el mensaje exacto de conectividad de la prueba interna.

La primera ejecución eliminó 48 filas: los 3 pedidos históricos, 3 eventos de
conectividad normalizados, 21 trabajos y 21 eventos raw. No existían registros
financieros, contables o de conciliación asociados. La ejecución posterior a la
certificación final retiró sus 7 trazas técnicas adicionales. La tienda quedó
recalculada sin el falso `MENU_REJECTED` de `SAMPLE-MENU-0001`; no se envió ni
modificó ningún menú remoto.

### Resultado final verificado

- conexión: `CONNECTED`;
- tienda Batut: mapeada y `ONLINE`;
- webhooks: 8 activos, 8 con eventos recibidos y 8 con firma válida;
- token operacional: vigente;
- errores abiertos: 0;
- pedidos/incidentes visibles: 0/0;
- estado de menú: `PENDING`;
- consultas de pedidos y soporte de menú: correctas.

### Archivos y reversión del parche 3

- `supabase/functions/rappi-admin/index.ts`: operación de limpieza DEV
  restringida y recálculo del estado local del menú.
- `tools/run_rappi_dev_onboarding.mjs`: modo `cleanup-dev-data` autenticado.
- `tools/test_rappi_frontend.mjs`: comprueba que la limpieza existe y está
  limitada a DEV.

Para revertir el mecanismo, retirar el caso `cleanup_dev_test_data`, la función
`cleanupDevTestData`, el modo `cleanup-dev-data` de la herramienta y sus dos
aserciones estáticas; ejecutar `deno check`, redesplegar `rappi-admin` y repetir
el diagnóstico de solo lectura. Los datos ya eliminados no se recrean al revertir.

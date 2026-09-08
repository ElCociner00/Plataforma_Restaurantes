# API Loggro Restobar: guía técnica verificada para un producto MCP

Fecha de verificación: **2026-08-30**

Producto cubierto: **Loggro Restobar / Pirpos**
Base comprobada: `https://api.pirpos.com`

## 1. Propósito y alcance

Este documento concentra el conocimiento obtenido al migrar la integración de Enkrato desde n8n a Supabase Edge Functions y al probarla con cuentas reales de Loggro Restobar.

Está pensado para entregar a otro agente o equipo que construirá una herramienta MCP relacionada con la operación de restaurantes. El producto puede usar la API de Loggro como fuente o destino, pero **no debe presentarse como un MCP oficial de Loggro**.

Esta guía cubre:

- autenticación de Restobar;
- selección y aislamiento de negocio;
- consulta de facturas, gastos e ingredientes;
- lectura y escritura de movimientos de inventario;
- normalización de pagos y propinas;
- tratamiento correcto de la zona horaria de Colombia;
- almacenamiento, renovación y reintento de tokens;
- diferencias encontradas entre la documentación pública y el comportamiento real;
- arquitectura recomendada para una herramienta MCP multiempresa.

No mezclar esta API con:

- Loggro Enterprise: suele usar rutas bajo `https://api.loggro.com/apik/loggro-enterprise/...`;
- facturación o nómina electrónica: tienen autenticaciones y contratos diferentes;
- Loggro Alojamientos: usa un flujo OTP independiente.

Fuentes oficiales principales:

- [Introducción Loggro Restobar](https://developer.loggro.com/reference/introduccion-restobar)
- [Inicio de sesión](https://developer.loggro.com/reference/iniciarsesion)
- [Consultar facturas](https://developer.loggro.com/reference/consultarfacturas)
- [Consultar gastos](https://developer.loggro.com/reference/consultargastos)
- [Consultar ingredientes](https://developer.loggro.com/reference/consultaringredientes)
- [Consultar movimientos de inventario](https://developer.loggro.com/reference/consultarmovimientosinventario)
- [Crear o editar movimiento de inventario](https://developer.loggro.com/reference/guardarmovimientoinventario)

La implementación real de Enkrato es la fuente de verdad cuando el comportamiento del tenant contradice la documentación genérica.

## 2. Credenciales para pruebas

Las credenciales funcionales se guardaron en el archivo local `.env`, ignorado por Git y excluido de Firebase Hosting. No se escriben aquí porque este documento sí se versiona.

Variables disponibles localmente:

```dotenv
LOGGRO_API_URL="https://api.pirpos.com"

LOGGRO_TEST_FACTORY_EMAIL="<guardado en .env>"
LOGGRO_TEST_FACTORY_PASSWORD="<guardado en .env>"

LOGGRO_TEST_BATUT_EMAIL="<guardado en .env>"
LOGGRO_TEST_BATUT_PASSWORD="<guardado en .env>"
```

Para otro repositorio se debe crear su propio `.env` local con esas variables. Nunca deben ponerse valores reales en:

- prompts compartidos;
- código fuente;
- manifiestos MCP;
- ejemplos de documentación;
- parámetros o respuestas de herramientas MCP;
- logs;
- Firebase Hosting;
- migraciones SQL o volcados de datos.

Las credenciales de acceso al portal web no son un sustituto de una credencial API independiente: Restobar utiliza el correo y la contraseña del usuario para `POST /login`.

## 3. Arquitectura que funciona en Enkrato

```text
Navegador / cliente MCP
        │ JWT propio de Enkrato o identidad del cliente MCP
        ▼
Backend de confianza / Supabase Edge Function
        │ resuelve empresa y permisos
        ▼
integraciones_credenciales
        │ correo + contraseña cifrada por empresa
        ▼
_shared/loggro.ts
        │ obtiene o renueva token
        ▼
credenciales_plataforma + caché en memoria
        │ Authorization: Bearer <tokenCurrent>
        ▼
https://api.pirpos.com
```

Reglas esenciales:

1. El navegador o cliente MCP nunca recibe la contraseña de Loggro.
2. El token de Loggro tampoco debe devolverse a quien llama una herramienta.
3. La empresa efectiva se deriva de una identidad autenticada; no se confía ciegamente en un `empresa_id` recibido.
4. Cada empresa configura sus propias credenciales.
5. Dos empresas pueden compartir una cuenta de Loggro, pero entonces se debe filtrar por el negocio externo correcto.
6. Las operaciones de escritura deben exigir confirmación explícita y comprobación de alcance.

Archivos centrales del proyecto:

```text
supabase/functions/_shared/loggro.ts
supabase/functions/_shared/fechas.ts
supabase/functions/_shared/ventas.ts
supabase/functions/guardar-credenciales/index.ts
supabase/functions/consultar-ventas/index.ts
supabase/functions/consultar-gastos/index.ts
supabase/functions/consultar-inventarios/index.ts
supabase/functions/consultar-propina-apoyos/index.ts
supabase/functions/cierre-inventarios-subir/index.ts
supabase/functions/compras-subir/index.ts
supabase/functions/cron-refrescar-token-loggro/index.ts
```

## 4. Autenticación

### 4.1 Petición

```http
POST https://api.pirpos.com/login
Accept: application/json
Content-Type: application/json

{
  "email": "<correo de la cuenta Restobar>",
  "password": "<contraseña>"
}
```

### 4.2 Respuesta relevante

La respuesta no es únicamente un token. Es un objeto de usuario y negocio. Los campos comprobados que interesan son:

```json
{
  "_id": "<id del usuario>",
  "tokenCurrent": "<JWT>",
  "business": {
    "_id": "<id del negocio>"
  }
}
```

Decisiones importantes:

- El token está en `tokenCurrent`. No asumir `token` ni `access_token`.
- `business._id` identifica el negocio usado para aislar registros.
- El `sub` del JWT identifica al usuario, no al negocio.
- En las dos cuentas verificadas, el JWT incluye una reclamación `date`, pero **no incluye `exp`**.
- Como el proveedor no anuncia una caducidad confiable en el token real, Enkrato aplica una vigencia local conservadora.

### 4.3 Uso del token

```http
Authorization: Bearer <tokenCurrent>
Accept: application/json
```

No guardar el prefijo `Bearer` dentro del token. Se agrega al formar cada petición.

## 5. Ciclo de vida del token

Enkrato usa tres niveles:

1. Caché en memoria del proceso, indexada por `empresa_id`.
2. Caché persistente en `credenciales_plataforma`.
3. Login nuevo con la credencial cifrada de `integraciones_credenciales`.

Configuración actual:

```dotenv
LOGGRO_TOKEN_TTL_MIN=720
LOGGRO_TIMEOUT_MS=15000
LOGGRO_VENTANA_RENOVACION_H=6
```

Los valores anteriores son los valores por defecto si las variables no existen.

Flujo:

```text
¿Hay token en memoria y le quedan más de 60 segundos?
  ├─ Sí → usarlo
  └─ No
      ¿Hay token vigente en base y le quedan más de 60 segundos?
        ├─ Sí → cargarlo a memoria y usarlo
        └─ No → descifrar credencial, POST /login, persistir token y usarlo
```

Si una llamada devuelve `401` o `403`:

1. se elimina la caché en memoria;
2. se fuerza un login;
3. se repite la llamada una sola vez;
4. si vuelve a fallar, se devuelve un error controlado.

No hacer bucles ilimitados de autenticación.

### 5.1 Renovación programada

La Edge Function `cron-refrescar-token-loggro`:

- se protege con `x-cron-secret`;
- revisa todas las credenciales activas por empresa;
- no renueva tokens a los que todavía les queda más que la ventana configurada;
- descifra únicamente durante la ejecución;
- actualiza `ultimo_error` si falla una empresa y continúa con las demás.

La tarea se programa por defecto cada cuatro horas:

```cron
0 */4 * * *
```

La función SQL que la instala es:

```sql
public.programar_refresco_loggro(p_url, p_secret, p_cron)
```

El índice para los `upsert` debe ser **único total** sobre `(empresa_id, plataforma)`. Un índice único parcial con `WHERE activo = true` no sirve automáticamente como destino de `ON CONFLICT (empresa_id, plataforma)` y produjo el error `42P10` durante la migración.

## 6. Selección de URL y multiempresa

Prioridad actual para decidir la URL de una empresa:

1. `integraciones_credenciales.url_api`;
2. `credenciales_plataforma.url_plataforma`;
3. `LOGGRO_API_URL`;
4. `https://api.pirpos.com`.

La URL se normaliza quitando barras finales.

Esto permite que el mismo código soporte múltiples usuarios y futuros ambientes sin incorporar credenciales o dominios por cliente en el código.

Para producción conviene validar además una lista de hosts permitidos. El código actual usa la URL configurada por un administrador; una herramienta MCP comercial debe impedir destinos arbitrarios para evitar SSRF.

## 7. Zona horaria y desfase de Colombia

Colombia opera en `UTC-5` y no aplica horario de verano. El proveedor trabaja con instantes ISO UTC.

El error histórico fue construir fechas como si una hora local fuera UTC o sumar cinco horas en muchos nodos distintos. La solución centralizada es:

```text
instante UTC = fecha/hora local - desfase local
instante UTC = fecha/hora local - (-5 horas)
instante UTC = fecha/hora local + 5 horas
```

Ejemplos verificados:

```text
2026-08-30 19:15 Colombia → 2026-08-31T00:15:00.000Z
Inicio 2026-08-30 local → 2026-08-30T05:00:00.000Z
Fin 2026-08-30 local    → 2026-08-31T04:59:59.999Z
```

Turno nocturno:

```text
Fecha: 2026-08-30
Inicio: 18:00 → 2026-08-30T23:00:00.000Z
Fin:    02:00 → 2026-08-31T07:00:00.000Z
```

Si la hora final es menor o igual a la inicial, el fin pertenece al día siguiente.

Variable actual:

```dotenv
ZONA_HORARIA_DESFASE=-5
```

Para una solución realmente multizona se recomienda guardar una zona IANA por empresa, por ejemplo `America/Bogota`, y convertir con una biblioteca que conozca cambios históricos y horario de verano. Un offset fijo solo es correcto para Colombia y zonas equivalentes.

Evitar:

```js
new Date("2026-08-30")
```

Ese texto se interpreta como medianoche UTC y puede mostrarse como el día anterior en Colombia. Construir explícitamente el instante o conservar la fecha como `YYYY-MM-DD` cuando semánticamente no contiene hora.

## 8. Endpoints usados y verificados

### 8.1 Facturas pagadas

```http
GET /invoices?status=Pagada&dateInit=<ISO>&dateEnd=<ISO>
Authorization: Bearer <token>
```

Comprobado el 2026-08-30 con dos cuentas: HTTP 200 y respuesta tipo arreglo.

Campos relevantes observados:

```json
{
  "_id": "<id factura>",
  "businessId": "<id negocio>",
  "createdOn": "<fecha ISO>",
  "total": 48000,
  "paid": {
    "paymentMethodValue": [
      {
        "paymentMethod": "Transferencia Bancolombia",
        "value": 24000,
        "tip": 1000,
        "deliveryCost": 0
      },
      {
        "paymentMethod": "Efectivo",
        "value": 24000,
        "tip": 500,
        "deliveryCost": 0
      }
    ]
  }
}
```

La estructura anterior es ilustrativa y contiene valores ficticios, pero respeta el contrato comprobado.

Advertencia verificada:

- En ambas cuentas, `GET /invoices?pagination=true&limit=1&page=0` devolvió HTTP 500.
- La consulta usada por Enkrato, con `status`, `dateInit` y `dateEnd`, devolvió HTTP 200.
- Por eso no se debe usar una consulta sin rango temporal como prueba de salud.

La documentación oficial indica que las cuentas trial pueden limitar las facturas visibles a las últimas 24 horas.

### 8.2 Gastos

```http
GET /expenses?dateInit=<ISO>&dateEnd=<ISO>
Authorization: Bearer <token>
```

Comprobado el 2026-08-30: HTTP 200 y respuesta tipo arreglo.

Campos usados:

```json
{
  "_id": "<id>",
  "business": { "_id": "<id negocio>" },
  "typeExpense": { "_id": "<id tipo>", "name": "Servicios" },
  "provider": { "name": "Proveedor" },
  "paidTo": { "name": "Persona" },
  "cashBox": {
    "_idCashBoxRegister": { "name": "Caja principal" }
  },
  "subTotal": 100000,
  "taxes": 0,
  "paymentMethod": "Efectivo",
  "date": "<fecha>",
  "invoiceNumber": "<número>"
}
```

Diferencia clave frente a facturas:

- facturas: negocio en `businessId`;
- gastos: negocio en `business._id`.

### 8.3 Ingredientes y stock

Ruta usada históricamente por Enkrato:

```http
GET /Ingredients?dateInit=<ISO>&dateEnd=<ISO>
```

Ruta publicada actualmente:

```http
GET /ingredients?pagination=true&limit=<n>&page=<n>
```

El 2026-08-30 las dos variantes respondieron HTTP 200 en ambas cuentas. HTTP no distingue mayúsculas por norma, pero el servidor puede hacerlo; conservar la ruta probada o cubrir ambas con una prueba automática.

La respuesta comprobada viene envuelta:

```json
{
  "data": [
    {
      "_id": "<id ingrediente>",
      "name": "Producto",
      "category": { "name": "Categoría" },
      "unit": { "name": "Unidad" },
      "isIngredient": true,
      "isActive": true,
      "locationsStock": {
        "stock": 10,
        "stockMinimum": 2,
        "pricePurchase": 5000,
        "locationStock": { "_id": "<id ubicación>" }
      }
    }
  ]
}
```

Comportamiento real importante: el catálogo puede heredarse del negocio padre. En la prueba histórica, filtrar ingredientes por el `business` de la cuenta dejaba 1 de 164 productos. Por eso Enkrato no filtra ingredientes por negocio de forma predeterminada; el token de cada empresa da el aislamiento.

Interruptor disponible:

```dotenv
FILTRAR_INVENTARIO_POR_NEGOCIO=false
```

### 8.4 Movimientos de inventario

Rutas encontradas:

```text
Implementación heredada y tenant real: /inventories
Documentación pública actual:         /inventory
```

Prueba de lectura del 2026-08-30:

- `GET /inventories`: HTTP 200 en ambas cuentas;
- `GET /inventory?pagination=true&limit=1&page=0`: HTTP 404 en ambas cuentas.

Conclusión: no cambiar automáticamente la aplicación a la ruta singular solo porque aparezca en la documentación. Confirmar el contrato del tenant o ambiente entregado por Loggro.

Enkrato escribe actualmente en:

```http
POST /inventories
Authorization: Bearer <token>
Content-Type: application/json
```

Movimiento de compra, `type: 1`:

```json
{
  "type": 1,
  "date": "2026-08-30T15:00:00.000Z",
  "invoice": "FAC123",
  "note": "Compra_Enkrato | Proveedor | FAC123",
  "payments": [],
  "ingredients": [
    {
      "ingredient": { "_id": "<id>", "name": "Producto" },
      "quantity": 5,
      "price": 3000,
      "locationStock": "<id ubicación>",
      "note": "",
      "invoice": null,
      "provider": null
    }
  ]
}
```

Ajuste por faltante, `type: 7`:

```json
{
  "type": 7,
  "date": "2026-08-30T15:00:00.000Z",
  "ingredients": [
    {
      "ingredient": { "_id": "<id>", "name": "Producto" },
      "quantity": 2,
      "locationStock": "<id ubicación>",
      "note": "Ajuste_Enkrato | cierre de inventario",
      "price": null,
      "invoice": null,
      "provider": null
    }
  ]
}
```

Los tipos `1` y `7` son comportamiento probado en esta integración; confirmar con Loggro antes de reutilizarlos en una cuenta con parametrización distinta.

## 9. Pagos mixtos, canales y propinas

Una factura puede incluir varios medios de pago. Nunca asignar el `total` completo al primer método.

Recorrer:

```text
factura.paid.paymentMethodValue[]
```

Campos por entrada:

```text
paymentMethod
value
tip
deliveryCost
```

Canales usados por Enkrato:

```text
efectivo
datafono
rappi
nequi
transferencias
bono_regalo
```

El mapeo se hace por palabras del nombre del método. Es ampliable con:

```dotenv
LOGGRO_MAPEO_METODOS='{"transferencias":["mi banco"],"datafono":["terminal xyz"]}'
```

Reglas heredadas de comisión sobre propina:

- transferencia/Bancolombia: resta cuatro pesos por cada mil pesos completos de propina;
- datáfono: multiplica la propina por `0.975`;
- otros métodos: no aplica ajuste.

Estas reglas son lógica de negocio de Enkrato, no una obligación general de la API Loggro. Un MCP vendible debe hacerlas configurables por cliente.

Contrato agregado que consume el cierre de turno:

```json
{
  "efectivo_sistema": 0,
  "datafono_sistema": 0,
  "rappi_sistema": 0,
  "nequi_sistema": 0,
  "transferencias_sistema": 0,
  "bono_regalo_sistema": 0,
  "propina": 0,
  "transacciones": 0,
  "total_general_valor": 0,
  "total_general_propina": 0,
  "total_general_domicilios": 0,
  "total_general": 0
}
```

## 10. Aislamiento por negocio

Una cuenta Loggro puede ver varios negocios. El filtro usado es:

```text
tenant externo de login = login.business._id
factura                  = registro.businessId
gasto                    = registro.business._id
```

Algoritmo defensivo:

1. Si existe un `tenantId`, buscar registros con marcador de negocio.
2. Si ningún registro trae marcador, conservar toda la respuesta para mantener compatibilidad.
3. Si hay marcadores, conservar únicamente los que coincidan exactamente.

El paso 2 evita eliminar todas las filas cuando un endpoint no incluye negocio, pero también significa que el aislamiento depende de que el token ya limite esos datos. Para un MCP comercial, cada herramienta debe declarar si el endpoint se aísla por token, por campo o por ambos.

## 11. Formas variables de respuesta

La función compartida acepta:

```text
[]
{ data: [] }
{ results: [] }
{ items: [] }
{ content: [] }
{ docs: [] }
```

No asumir una envoltura única. Primero convertir a lista y después normalizar cada registro.

Cuando se necesita depurar un contrato nuevo puede activarse temporalmente:

```dotenv
LOGGRO_DEBUG=true
```

Con `LOGGRO_DEBUG=true`, algunas funciones pueden devolver muestras `_crudo` o escribir fragmentos de respuesta en logs. Debe volver a `false` inmediatamente porque las facturas contienen datos comerciales y potencialmente personales.

## 12. Errores, timeouts y reintentos

Mapa de errores interno:

```text
Timeout del proveedor         → LOGGRO_TIMEOUT / HTTP 504
Red no disponible             → LOGGRO_INALCANZABLE / HTTP 502
Credenciales rechazadas       → LOGGRO_CREDENCIALES / HTTP 401
Login sin tokenCurrent        → LOGGRO_SIN_TOKEN / HTTP 502
Error de endpoint             → LOGGRO_ERROR / HTTP 502 hacia el cliente
Respuesta no JSON             → LOGGRO_RESPUESTA / HTTP 502
Sin credenciales por empresa  → SIN_CREDENCIALES / HTTP 412
```

Política recomendada:

- GET: reintento exponencial limitado ante `429`, `502`, `503`, `504`.
- `401/403`: renovar token y repetir exactamente una vez.
- POST de inventario: no reintentar a ciegas, porque se puede duplicar el movimiento.
- Antes de repetir un POST, buscar una referencia propia en `note`/`invoice` o mantener un registro local de idempotencia.
- Nunca registrar contraseñas, tokens ni cuerpos completos de facturas.

## 13. Persistencia segura de credenciales

Tabla de credencial:

```text
integraciones_credenciales
  empresa_id
  plataforma = loggro
  usuario
  password = enc:<AES-GCM>
  url_api
  activo
  validado_en
```

Tabla de caché:

```text
credenciales_plataforma
  empresa_id
  plataforma = loggro
  token
  plataforma_tenant_id
  token_expira_en
  token_actualizado_en
  ultimo_error
```

La contraseña se valida contra `/login` antes de guardarse y se cifra con `MASTER_ENCRYPTION_KEY`. El frontend solo puede consultar si existe una credencial y el correo asociado; nunca puede leer la contraseña.

Variables obligatorias en el backend:

```dotenv
MASTER_ENCRYPTION_KEY="<mínimo 16 caracteres; usar valor aleatorio largo>"
CRON_SECRET="<valor aleatorio largo>"
```

## 14. Diseño sugerido para el MCP

Herramientas de lectura seguras:

```text
restaurant_sales_summary
restaurant_payment_breakdown
restaurant_expenses_summary
restaurant_inventory_status
restaurant_low_stock_items
restaurant_purchase_movements
restaurant_reconciliation_report
```

Herramientas de escritura con confirmación explícita:

```text
restaurant_create_inventory_purchase
restaurant_adjust_inventory_shortage
```

Cada herramienta debería:

1. resolver la empresa desde la sesión MCP;
2. comprobar permisos;
3. obtener el token internamente;
4. limitar fechas y tamaño de respuesta;
5. normalizar la respuesta a un esquema estable propio;
6. eliminar datos personales innecesarios;
7. devolver totales y referencias, nunca credenciales ni token;
8. generar un `correlation_id` para auditoría;
9. exigir confirmación en operaciones que cambian inventario.

El MCP debe vender una capacidad de negocio —por ejemplo conciliación de caja, alertas de inventario o análisis operativo— y mantener Loggro como adaptador interno intercambiable.

## 15. Pruebas reproducibles

Prueba real de solo lectura:

```powershell
node tools\test_loggro_api.mjs
```

Resultado del 2026-08-30:

- 2/2 cuentas autenticadas con HTTP 200;
- 2/2 respuestas con `tokenCurrent`;
- 2/2 respuestas con `business._id`;
- `GET /invoices` con rango: HTTP 200 en ambas;
- `GET /expenses`: HTTP 200 en ambas;
- `GET /Ingredients` y `/ingredients`: HTTP 200 en ambas;
- `GET /inventories`: HTTP 200 en ambas;
- `GET /inventory`: HTTP 404 en ambas;
- ningún endpoint de escritura fue llamado por esta prueba.

Pruebas unitarias de zona horaria, pagos mixtos y aislamiento:

```powershell
deno test --allow-env `
  supabase\functions\_shared\fechas_test.ts `
  supabase\functions\_shared\ventas_test.ts
```

Casos cubiertos:

- conversión Colombia → UTC;
- turno cruzando medianoche;
- factura con pago mixto;
- comisión por medio de pago;
- `businessId` y `business._id`;
- fallback de registros sin marcador de negocio.

## 16. Lista de comprobación para producción

- [ ] Credenciales configuradas por empresa desde un backend confiable.
- [ ] Contraseñas cifradas y no visibles por RLS.
- [ ] `MASTER_ENCRYPTION_KEY` respaldada en un gestor de secretos.
- [ ] `CRON_SECRET` aleatorio y distinto de otras integraciones.
- [ ] Renovación de token programada y observable.
- [ ] Host permitido validado; no aceptar URLs arbitrarias.
- [ ] `LOGGRO_DEBUG=false`.
- [ ] Rango de fechas obligatorio para facturas.
- [ ] Zona horaria definida por empresa.
- [ ] Aislamiento por negocio probado con dos negocios de la misma cuenta.
- [ ] Pagos mixtos cubiertos por pruebas.
- [ ] Escrituras de inventario con idempotencia y confirmación.
- [ ] Alertas sobre `ultimo_error` y caducidad del token.
- [ ] Rotación de cualquier credencial que haya aparecido en repositorios o volcados.

## 17. Hallazgos que no deben repetirse

1. Buscar el token en `access_token` en vez de `tokenCurrent`.
2. Usar el `sub` del JWT como id del negocio.
3. Suponer que facturas y gastos guardan el negocio en el mismo campo.
4. Sumar el total completo de una factura a un único método de pago.
5. Interpretar una hora colombiana como UTC.
6. Cortar un turno nocturno en la medianoche.
7. Filtrar el catálogo heredado de ingredientes por el negocio hijo.
8. Cambiar `/inventories` por `/inventory` sin probar el tenant real.
9. Usar un índice único parcial como destino de un `upsert` sin declarar la condición.
10. Renovar todos los tokens en cada petición.
11. Permitir que el cliente elija libremente un `empresa_id` o una URL de proveedor.
12. Versionar credenciales, tokens o volcados con datos reales.

## 18. Nota de seguridad sobre el repositorio heredado

Durante esta auditoría se confirmó que el volcado histórico `supabase/migrations/20260822000001_data_dump.sql` contiene tokens y credenciales antiguas en texto plano. Aunque la aplicación actual cifra las contraseñas en producción, eliminar esos valores del archivo actual no los elimina del historial Git.

Acciones obligatorias:

1. rotar las credenciales expuestas;
2. sanear la revisión actual del volcado;
3. si el repositorio se compartirá externamente, reescribir el historial con una herramienta especializada;
4. invalidar tokens históricos;
5. almacenar las nuevas credenciales solo en `.env` local o un gestor de secretos.

No entregar este repositorio a un tercero como base de un producto MCP hasta cerrar ese punto.

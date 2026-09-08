# Facturación multi-tenant: diagnóstico y plan

Fecha: 2026-08-24 · versión 3 (2026-08-25: fases 0-5 ejecutadas con Wompi)

> **Estado a 2026-08-25.** Fases 0 a 5 construidas y desplegadas en producción
> con **Wompi**, no con Mercado Pago. El detalle de lo que quedó vivo está en
> el **§11**. La Fase 6 (restricción de servicio) sigue **sin encender**: nada
> bloquea a nadie. La URL de eventos a registrar en el panel de Wompi es
> `https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/wompi-eventos`

Alcance: módulo `facturacion/` de AXIOMA, su backend en Supabase
(`tgkvcvnwwnrlyhbqmhaf`, base «Enkrato Google») y el cobro a los clientes de la
plataforma. No cubre el módulo de compras ni las facturas de proveedores.

---

## 1. Las reglas del negocio (ya decididas)

Todo el diseño de aquí en adelante sale de estas reglas. Si alguna cambia,
cambia el modelo de datos.

### 1.1 Precio

| Concepto | Valor |
|---|---|
| Plan base mensual | **$59.900** — cubre la empresa **más un local sin costo** |
| Local adicional (del 2.º en adelante) | **+$30.000/mes** cada uno |
| Plan anual | mensual × 12 − 20% |
| Prueba gratuita | **15 días** desde el registro |

Fórmula: `total_mes = 59.900 + max(0, sedes − 2) × 30.000`

| Sedes de la cuenta | Mensual | Anual (−20%) |
|---|---|---|
| 1 | $59.900 | $575.040 |
| 2 (caso BATUT) | $59.900 | $575.040 |
| 3 | $89.900 | $863.040 |
| 4 | $119.900 | $1.151.040 |

El anual equivale a $47.920/mes: dos meses y pico de regalo. Es el incentivo
correcto, y además ahorra once comisiones de pasarela al año (§5.4).

### 1.2 Calendario de cobro

Cobro **vencido**: el cliente usa el mes y lo paga al cerrar.

```
25 de agosto     Se genera y se envía la factura de agosto (ya es pagable)
31 de agosto     Corte del periodo. Fin del mes facturado
1–5 de sept.     Días de gracia. Puede pagar sin perder nada
6 de sept.       Si no pagó: la cuenta pasa a modo restringido
```

- Fecha de corte: **último día del mes**, igual para todos.
- Fecha límite de pago: **día 5 del mes siguiente**.
- Un cliente nuevo estrena con **15 días de prueba**; su primer periodo
  facturable va desde el fin de la prueba hasta el último día de ese mes, y se
  cobra **prorrateado por días**.

Ejemplo: se registra el 1 de septiembre → prueba hasta el 15 → primera factura
por 15 días de septiembre = 59.900 × 15/30 = **$29.950**, con corte el 30 de
septiembre y límite de pago el 5 de octubre. A partir de octubre, mes completo.

### 1.3 Quién es cliente hoy

Son **dos cuentas distintas**, no una con tres sedes:

| Cuenta | Sedes | Situación |
|---|---|---|
| **BATUT** | LE MERIDIEM + VIVA | Cliente activo. Pagó un año el 31/05/2026 → cubierto hasta el **31/05/2027**. Al renovar: $575.040 |
| **BATUT Cartagena** | Cartagena | Empresa madre aparte, **otro administrador**. En implementación, aún no opera. Estrena con **15 días de prueba** y luego **$59.900/mes** |
| Internas (tuyas) | Restaurante Prueba, Prueba Global Nexo 2, Prueba Nuevo Cliente, Global Nexo Shop S.A.S. | Pruebas. **Exentas de facturación** |

Que sean dos cuentas separadas tiene consecuencias concretas de diseño:

- **Contacto de facturación propio.** Las facturas, recordatorios y avisos de
  Cartagena van a su administrador, no al de BATUT. Por eso `cuentas` lleva su
  propio `correo_facturacion` (§6.2).
- **Aunque compartan marca, no comparten cupo de locales.** Cartagena paga su
  plan base completo; no entra como "local adicional" de BATUT a $30.000.
- **Vigencias independientes.** Que BATUT esté pagado hasta 2027 no cubre a
  Cartagena ni un día.

#### El reloj de la prueba no puede arrancar en el registro

La empresa BATUT Cartagena se creó el **22 de agosto**, pero está en
implementación y no ha empezado a operar. Si los 15 días de prueba contaran
desde que se crea la empresa, **ya se le habrían consumido 2 días sin haber
usado el producto**, y se le acabarían el 6 de septiembre estando todavía en
montaje.

Por eso el modelo necesita un estado previo:

```
implementacion  ->  prueba (15 días)  ->  activa (facturable)
     |                   |
   sin reloj      arranca cuando TÚ das el "listo, ya opera"
```

`suscripciones` guarda `prueba_desde` y `prueba_hasta`, y ambos se rellenan en
el momento de la activación, no en el del registro. En el backoffice es un botón
"Iniciar prueba" — y también sirve para extenderla si la implementación se
alarga.

### 1.4 Restricción operativa

**Nada de lo que construyamos puede bloquear a nadie hoy.** El corte de servicio
se implementa, se prueba en modo observación (registra lo que habría bloqueado,
sin bloquear), y solo se enciende cuando tú lo autorices, cliente por cliente.
Esto está reflejado en la Fase 5.

---

## 2. Qué hay hoy

| Pieza | Dónde | Qué hace |
|---|---|---|
| Pantalla de factura | [js/facturacion.js](../js/facturacion.js) | "Factura" HTML fija, dos botones de Mercado Pago, formulario de comprobante |
| Aviso de impago | [js/anuncio_impago.js](../js/anuncio_impago.js) | Modal con cuenta regresiva |
| Bandeja de revisión | [js/revision_pagos.js](../js/revision_pagos.js) | Superadmin aprueba/rechaza comprobantes |
| Backoffice | [js/gestion_empresas.js](../js/gestion_empresas.js) | Plan, activo/inactivo, banner |
| Generador de ciclos | `create_billing_cycles_for_period()` + cron `billing-crear-ciclos` (día 1) | Una fila por empresa y mes |
| Motor de estados | `billing_daily_enforcer()` + cron `billing-enforcer-diario` (09:00 COL) | Banner, mora, suspensión |
| Modelo nuevo | `billing_cycles`, `payment_attempts`, `billing_events` | Mensual por empresa |
| Modelo viejo | `facturacion`, `historial_facturacion`, `pagos_en_revision`, `facturaciones_pagadas` | Sigue escrito por triggers |
| Cobro | `metodos_pago` | Dos URL estáticas de Mercado Pago |

Los dos cron están **activos** (última corrida del enforcer: 2026-08-24 14:00
UTC, `succeeded`). `payment_attempts` y `billing_events` tienen **0 filas**: el
circuito de pagos no se ha usado nunca.

---

## 3. Diagnóstico

Ordenado por gravedad. Todo verificado contra el código y la base, no inferido.

### 3.1 · CRÍTICO · No hay forma de que entre un pago

El enlace de Mercado Pago es un **link estático compartido por todos los
clientes** (`https://mpago.li/15d6BkC`), sin identificador de quién paga, y no
existe ningún receptor de notificaciones: cero webhooks, cero llamadas a la API
de Mercado Pago, cero tablas de transacciones en todo el repositorio.

Dos consecuencias, y la segunda es peor:

1. Mercado Pago no avisa a la plataforma cuando alguien paga.
2. **Aunque avisara, no se sabría qué empresa pagó.** El link es el mismo para
   todos; la notificación no traería identificador de cliente.

Igual con el link de suscripción
(`preapproval_plan_id=418f65131d8f43c18f38b7e23615f55e`): el plan existe en tu
cuenta de Mercado Pago, pero si un cliente se suscribe hoy, el cobro recurrente
corre en Mercado Pago y la plataforma nunca se entera ni sabe de quién es.

Esto se resuelve en §4, con el detalle que pediste.

### 3.2 · CRÍTICO · El único camino manual también está roto

`facturacion.js` sube el comprobante al bucket `comprobantes_pago`
([js/facturacion.js:352](../js/facturacion.js#L352)). **Ese bucket no existe**;
el único bucket de la base es `nomina-pdf`. Cada intento falla con "Bucket not
found" y el `payment_attempts` nunca se inserta. Eso explica las 0 filas.

Detrás vienen dos fallos más, que aparecerán en cuanto se cree el bucket:

- La política RLS `payment_attempts_insert` exige que el comprobante apunte a un
  `billing_cycle_id` de la propia empresa, pero `facturacion.js` solo adjunta
  ese campo si encontró ciclo del mes ([js/facturacion.js:365](../js/facturacion.js#L365)).
  Una empresa sin ciclo verá su inserción rechazada.
- El comprobante se registra con `monto_reportado: 0` y `canal: "transferencia"`
  fijos, sin referencia: no hay nada que conciliar contra la factura.

### 3.3 · CRÍTICO · El sistema se perdona la deuda solo

La falla más costosa, y ya ocurrió en producción:

1. `billing_daily_enforcer()` suspende degradando: `plan_actual = 'free'`.
2. `create_billing_cycles_for_period()` calcula el monto del mes siguiente con
   `plan_price(coalesce(e.plan_actual, e.plan, 'free'))`.
3. Como `plan_actual` ya es `free`, el ciclo nuevo nace con **monto 0 y estado
   `paid_verified`**.

La deuda desaparece y el servicio vuelve solo. Evidencia:

```
498b9fd6  2026-07  monto=59900  suspended      <- suspendida por mora
498b9fd6  2026-08  monto=0      paid_verified  <- perdonada un mes después
```

Ese mismo mecanismo dejó a **cinco de las siete empresas en `plan='pro'` con
`plan_actual='free'`**, es decir, facturando $0 mientras usan el producto.

### 3.4 · CRÍTICO · El bloqueo por impago no bloquea nada

Tres capas, las tres inertes:

1. **El guarda del frontend es un stub.** `puedeEnviarDatos()` en
   [js/permisos.core.js:177](../js/permisos.core.js#L177) es literalmente
   `return true;`. De él cuelgan todos los mensajes "Plan FREE o empresa
   inactiva: envío bloqueado por seguridad" de cierre de turno e inventarios.
2. **La resolución de plan deshace la degradación.** `resolveEmpresaPlan()`
   ([js/plan.js:30](../js/plan.js#L30)): si `plan_actual` y `plan` difieren y
   uno es `free`, devuelve el que **no** es free. El enforcer pone
   `plan_actual='free'` y deja `plan='pro'` → el frontend resuelve `pro`.
3. **El servidor no valida nada.** Ni el RPC `subir_cierre_turno` ni las Edge
   Functions de escritura consultan el estado de facturación.

Hoy nadie queda bloqueado por no pagar. Dado tu requisito §1.4, esto **juega a
favor**: no hay urgencia por desactivar nada, solo por construirlo bien.

### 3.5 · ALTO · Aprobar un pago no funciona

`revision_pagos.js` llama al RPC `aprobar_pago`, que **no existe en la base**:
`supabase/sql/002_billing_rpcs.sql` nunca se ejecutó (en `pg_proc` no están
`aprobar_pago`, `rechazar_pago`, `aplicar_suspension` ni `restaurar_servicio`).

Cae entonces al fallback ([js/revision_pagos.js:130](../js/revision_pagos.js#L130)),
que escribe tu correo en `revisado_por`, una columna `uuid` con clave foránea a
`system_users(id)`. El `UPDATE` falla por tipo — **y el código no comprueba el
error**. Resultado: el comprobante queda "pendiente" para siempre, pero las dos
sentencias siguientes sí marcan el ciclo como pagado y la empresa como activa.

El SQL de esas RPC arrastra el mismo error de tipo, así que desplegarlo tal cual
tampoco lo arregla.

### 3.6 · ALTO · No existe el concepto de vigencia

El modelo es "una fila por empresa y mes". No hay ningún campo que diga *hasta
cuándo tiene derecho a usar el producto*:

- **El pago anual de BATUT no cabe en el modelo.** Hoy sobrevive por accidente,
  gracias al bug §3.3 que le pone ciclos de $0. Corregido ese bug sin más, el
  cron empezaría a facturarle y a suspenderlo pese a estar pagado hasta 2027.
- No hay plan anual, ni prepago, ni prorrateo, ni saldo a favor.
- Los constraints lo refuerzan: `billing_cycles_vencimiento_dia_15` obliga a que
  **toda** factura venza un día 15 — incompatible con tu corte a fin de mes — y
  `billing_cycles_empresa_periodo_unique` impide cubrir 12 meses con un cobro.

### 3.7 · ALTO · El cobro es por empresa, no por cliente

Se factura por fila de `empresas`, y los locales **también son filas de
`empresas`**:

```
5b5f990a (BATUT VIVA)           -> local de f37f6983 (BATUT LE MERIDIEM)
498b9fd6 (Prueba Global Nexo 2) -> local de b76d89f6 (Restaurante Prueba)
```

Con la regla que decidiste (§1.1), BATUT debe pagar **una** factura de $59.900
por sus dos sedes. El modelo actual le generaría **dos** de $59.900, con dos
avisos de impago independientes, y podría dejar una sede suspendida y la otra
activa. Falta la entidad que hoy no existe en ninguna parte: **la cuenta que
paga**, separada de las sedes que consumen.

### 3.8 · MEDIO · El onboarding no engancha con el cobro

- Una empresa nueva nace con `plan = 'free'` (default de la tabla) y el RPC de
  registro self-service no lo cambia: su primera factura sería de $0 y estado
  `paid_verified`. El registro tampoco pide elegir plan.
- No hay periodo de prueba en ninguna parte: los 15 días que decidiste no
  existen como concepto.
- El trigger `trg_empresas_create_billing_cycle`, pese al nombre, **no crea un
  billing cycle**: inserta una fila en la tabla legacy `facturacion`.
- Los ciclos solo se crean el día 1. Las dos empresas creadas el 22 de agosto
  siguen sin factura de agosto.

### 3.9 · MEDIO · Cuatro sistemas de facturación superpuestos

Conviven `facturacion` + `historial_facturacion` + `pagos_en_revision` +
`facturaciones_pagadas` (viejo, con la numeración `AX-1..AX-7` y triggers que
siguen escribiendo) y `billing_cycles` + `payment_attempts` + `billing_events`
(nuevo). `facturacion.js` lee de los dos y usa el primero que responda
([js/facturacion.js:432](../js/facturacion.js#L432)). Nadie sabe cuál manda.

### 3.10 · MEDIO · Lo que se muestra no es una factura

- El emisor está escrito a mano en el JS, con un correo personal de Outlook.
- `amountInWordsEs()` devuelve la constante *"CINCUENTA Y NUEVE MIL NOVECIENTOS
  PESOS COLOMBIANOS"* **sea cual sea el monto**
  ([js/facturacion.js:139](../js/facturacion.js#L139)). Con locales adicionales
  dirá una cifra y cobrará otra.
- IVA fijo 0%, código fijo `AX-SUSC`, sin número, sin fecha de emisión, sin
  datos del adquiriente, sin CUFE ni resolución DIAN. Y encabeza "Factura
  electrónica de venta".

### 3.11 · MEDIO · Quién puede ver su factura

Las políticas RLS de `billing_cycles` y `payment_attempts` usan
`get_my_empresa_id()`, que resuelve **solo** contra `usuarios_sistema`. Un
usuario de `otros_usuarios` o alguien operando dentro de un local con el
switcher activo no vería su factura ni podría reportar un pago. Existe
`current_empresa_id()`, que sí contempla esos casos, pero facturación no la usa.

Con cuentas multi-sede (§1.1) esto hay que rehacerlo igualmente: el
administrador de BATUT debe ver **una** factura desde cualquiera de sus dos
sedes.

### 3.12 · BAJO · Cabos sueltos

- `empresas.deuda_actual` nunca se calcula (0 en todas), y aun así
  `gestion_empresas.js` la usa para decidir si marcar un ciclo como pagado
  ([js/gestion_empresas.js:186](../js/gestion_empresas.js#L186)).
- La columna "Fecha corte" del backoffice nunca se selecciona: siempre "-".
- El aviso de impago se guarda en `localStorage` por día: se salta borrándolo.
- `facturacion` está clasificado bajo `ENV_SIIGO`
  ([js/access_control.local.js:122](../js/access_control.local.js#L122)), el
  entorno del módulo Siigo ya descontinuado.

### 3.13 El error de fondo

Los doce puntos tienen una sola raíz: **esto se construyó como un recordatorio
de cobro, no como un sistema de facturación**. Todo lo que existe sirve para
*avisar* y para *anotar a mano* lo que pasó fuera del sistema. Las tres cosas
que definen un sistema de facturación —**recibir el dinero, saber de quién es, y
poder cortar el servicio**— no están implementadas en ninguna capa. De ahí que
todo el trabajo caiga sobre ti.

---

## 4. Cómo funciona la "señal de retorno" del pago

Esta es la pieza que no tienes y la que lo cambia todo. Explicada desde cero.

### 4.1 El concepto en una frase

Cuando alguien te paga, la pasarela hace **dos cosas distintas** que se
confunden mucho:

| | **Redirección (`back_url`)** | **Webhook / notificación (`notification_url`)** |
|---|---|---|
| Quién la ejecuta | El **navegador** del cliente | El **servidor** de la pasarela |
| A dónde llega | A una página tuya | A un endpoint tuyo, sin navegador |
| ¿Es confiable? | **No.** El cliente puede cerrar el navegador, quedarse sin datos, o manipular la URL | **Sí.** Va servidor a servidor y viene firmada |
| Para qué sirve | Mostrar "¡Gracias, tu pago fue exitoso!" | **Registrar el pago de verdad** |

**La regla de oro: nunca marques una factura como pagada por la redirección.**
Solo el webhook cuenta. La redirección es cortesía visual; el webhook es la
contabilidad.

Hoy no tienes ninguna de las dos.

### 4.2 El flujo completo, paso a paso

```
 1. El cliente entra a /facturacion/ y pulsa "Pagar agosto — $59.900"
        |
 2. Tu Edge Function  pago-crear-preferencia  llama a la API de Mercado Pago:
        POST https://api.mercadopago.com/checkout/preferences
        {
          items: [{ title: "AXIOMA agosto 2026", quantity: 1,
                    unit_price: 59900, currency_id: "COP" }],
          external_reference: "<uuid de la factura>",   <-- LA CLAVE
          notification_url: "https://<proyecto>.supabase.co/functions/v1/mercadopago-webhook",
          back_urls: { success: "https://tu-app/facturacion/?pago=ok", ... }
        }
        Mercado Pago devuelve  init_point: "https://www.mercadopago.com.co/..."
        |
 3. Rediriges al cliente a ese init_point. Paga con tarjeta, PSE o Nequi.
        |
 4. Mercado Pago cobra y, en segundos, hace POST a tu notification_url:
        POST /functions/v1/mercadopago-webhook?type=payment&data.id=123456789
        headers: x-signature: ts=1756...,v1=618c85...
                 x-request-id: 9f8a...
        |
 5. Tu Edge Function:
        a) valida la firma  (§4.4)         -> si no cuadra, 401 y fuera
        b) inserta en pasarela_eventos     -> si el evento ya existía, responde 200 y sale
        c) GET https://api.mercadopago.com/v1/payments/123456789
           con tu Access Token             -> ESTA es la fuente de verdad
        d) lee status == "approved", transaction_amount == 59900,
           currency_id == "COP", external_reference == <uuid de la factura>
        e) registra el pago, marca la factura pagada,
           mueve la vigencia de la cuenta, levanta restricciones
        f) responde HTTP 200 en menos de 22 segundos
        |
 6. Mientras tanto el cliente volvió a /facturacion/?pago=ok y ve
    "Estamos confirmando tu pago…", que pasa a "Pago confirmado" en cuanto
    el paso 5 termina.
```

Los tres puntos que hacen que esto sea seguro y no un agujero:

1. **`external_reference`.** Es el campo donde metes *tu* identificador de
   factura. Sin él, la notificación llega y no sabes a quién aplicarla — que es
   exactamente el problema del link estático que tienes hoy.
2. **Verificar la firma.** Sin esto, cualquiera que conozca la URL de tu webhook
   puede enviarte un POST diciendo "la factura X está pagada" y regalarse un año
   de servicio.
3. **Volver a consultar el pago con `GET /v1/payments/{id}`.** El cuerpo de la
   notificación solo trae un ID; nunca confíes en montos o estados que vengan en
   el POST. Consultas la API con tu token y lo que ella diga es lo que vale.

### 4.3 Configuración en el panel de Mercado Pago (lo que tienes que hacer tú)

Una sola vez, y son diez minutos:

1. Entra a **mercadopago.com.co → Tu negocio → Tus integraciones**
   (developers.mercadopago.com).
2. **Crea una aplicación** (si no la tienes): nombre "AXIOMA", producto
   "Pagos online". Al crearla te da dos juegos de credenciales:
   - **Credenciales de prueba** → `TEST-...` (para desarrollar)
   - **Credenciales de producción** → `APP_USR-...` (dinero real)
   Cada juego tiene *Public Key* y *Access Token*. **El Access Token nunca puede
   estar en el navegador**: va en los secretos de Supabase.
3. Dentro de la aplicación, menú izquierdo: **Webhooks → Configurar
   notificaciones**.
4. Verás dos campos de URL, uno para **modo pruebas** y otro para
   **producción**. En ambos pones la misma dirección de la Edge Function:
   ```
   https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/mercadopago-webhook
   ```
5. Marca los eventos que quieres recibir. Para lo nuestro:
   - `payment` — pagos (Checkout Pro y también los cobros de suscripción)
   - `subscription_preapproval` — alta, pausa o baja de una suscripción
   - `subscription_authorized_payment` — cada cobro automático recurrente
   - `topic_chargebacks_wh` — contracargos (importante: revierte la vigencia)
6. Pulsa **Guardar**. En ese momento Mercado Pago genera tu **clave secreta**
   (la "firma secreta"). **Cópiala**: es lo que usarás para validar que las
   notificaciones vienen de verdad de ellos. Se puede regenerar con
   **Restablecer**, pero eso invalida la anterior.
7. Guarda los dos valores en Supabase, nunca en el repositorio:
   ```
   supabase secrets set MP_ACCESS_TOKEN=APP_USR-xxxxx
   supabase secrets set MP_WEBHOOK_SECRET=xxxxx
   ```
8. En el panel hay un botón **Simular notificación**: te deja disparar un
   webhook de prueba contra tu URL antes de tener un pago real. Es la forma de
   comprobar que la función responde 200.

Del lado del repositorio hace falta una línea en
[supabase/config.toml](../supabase/config.toml), porque el webhook no lleva JWT
de usuario:

```toml
[functions.mercadopago-webhook]
enabled = true
verify_jwt = false   # lo protege la firma x-signature, no el JWT
```

### 4.4 Cómo se valida la firma (el detalle exacto)

Mercado Pago manda dos cabeceras:

```
x-signature:  ts=1756051200,v1=618c85345248dd820d5fd456117c2ab2ef8eda45a0282ff693eac24131a5e839
x-request-id: 9f8a7b6c-1234-...
```

Y en la URL viene `data.id=123456789`. Con esas tres piezas construyes una
cadena exactamente con este formato — los dos puntos, los punto y coma y el
punto y coma final importan:

```
id:123456789;request-id:9f8a7b6c-1234-...;ts:1756051200;
```

Le aplicas **HMAC-SHA256** usando tu clave secreta como llave, lo pasas a
hexadecimal y lo comparas con el valor `v1`. Si coinciden, la notificación es
auténtica.

Esqueleto real de la función, en Deno (Supabase Edge Functions):

```ts
// supabase/functions/mercadopago-webhook/index.ts
const SECRETO = Deno.env.get("MP_WEBHOOK_SECRET")!;
const TOKEN   = Deno.env.get("MP_ACCESS_TOKEN")!;

async function firmaValida(req: Request, dataId: string): Promise<boolean> {
  const cabecera = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";

  // "ts=1756051200,v1=618c85..."  ->  { ts, v1 }
  const partes = Object.fromEntries(
    cabecera.split(",").map((p) => p.trim().split("=", 2) as [string, string]),
  );
  if (!partes.ts || !partes.v1) return false;

  // Rechaza notificaciones viejas: evita reenvíos maliciosos
  const edadSegundos = Math.abs(Date.now() / 1000 - Number(partes.ts));
  if (edadSegundos > 300) return false;

  const manifiesto = `id:${dataId};request-id:${requestId};ts:${partes.ts};`;

  const llave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRETO),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const firma = await crypto.subtle.sign(
    "HMAC", llave, new TextEncoder().encode(manifiesto),
  );
  const esperado = [...new Uint8Array(firma)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");

  // Comparación de tiempo constante
  if (esperado.length !== partes.v1.length) return false;
  let diferencia = 0;
  for (let i = 0; i < esperado.length; i++) {
    diferencia |= esperado.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  }
  return diferencia === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") ?? "";
  const tipo   = url.searchParams.get("type") ?? "";

  if (!await firmaValida(req, dataId)) {
    return new Response("firma inválida", { status: 401 });
  }

  // Idempotencia: si este evento ya se procesó, salimos con 200.
  // El UNIQUE de pasarela_eventos.evento_id es lo que lo garantiza,
  // no un "select ... if exists" (que tiene carrera).
  const { error: dup } = await supabase
    .from("pasarela_eventos")
    .insert({ proveedor: "mercadopago", evento_id: `${tipo}:${dataId}`, tipo });
  if (dup?.code === "23505") return new Response("ok (repetido)", { status: 200 });

  if (tipo === "payment") {
    // LA FUENTE DE VERDAD: consultar la API, no creerle al POST
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const pago = await r.json();

    if (pago.status === "approved") {
      await supabase.rpc("registrar_pago_confirmado", {
        p_factura_id: pago.external_reference,
        p_proveedor_pago_id: String(pago.id),
        p_monto: pago.transaction_amount,
        p_moneda: pago.currency_id,
        p_canal: pago.payment_type_id,   // credit_card | pse | account_money...
        p_payload: pago,
      });
    }
  }

  return new Response("ok", { status: 200 });
});
```

`registrar_pago_confirmado` es un RPC transaccional: valida que el monto cuadre
con la factura, registra el pago, marca la factura pagada, mueve la vigencia de
la cuenta, levanta el modo restringido si lo había y escribe la bitácora. Todo o
nada, y dos llamadas con el mismo `proveedor_pago_id` no duplican nada.

### 4.5 Los casos que sí ocurren y hay que manejar

| Situación | Qué hace el sistema |
|---|---|
| Pago aprobado | Factura pagada, vigencia extendida, correo de confirmación |
| Pago rechazado (`rejected`) | Se registra el intento fallido; la factura sigue pendiente |
| PSE queda `in_process` | No se marca nada; llega un segundo webhook al confirmarse |
| Pago parcial o monto distinto | **No** se marca pagada: se registra como pendiente de conciliación y te avisa |
| Contracargo o devolución | Revierte el pago y la vigencia; te avisa |
| Cliente cancela su suscripción | La cuenta pasa a "sin renovación automática"; sigue vigente hasta el fin del periodo pagado |
| Cobro recurrente falla | Mercado Pago reintenta; si agota reintentos, la factura queda vencida |
| Webhook repetido | El `UNIQUE` de `pasarela_eventos` lo descarta; se responde 200 igual |
| Webhook con firma inválida | 401, se registra el intento y no se toca nada |

### 4.6 Cómo se prueba antes de tocar dinero real

1. Con credenciales `TEST-`, Mercado Pago da **tarjetas de prueba** y usuarios
   de prueba (comprador y vendedor). Un pago de prueba dispara el webhook igual
   que uno real.
2. **Simular notificación** en el panel dispara un POST contra tu URL.
3. Comprobación obligatoria antes de pasar a producción: reenviar el mismo
   webhook diez veces y verificar que la factura se paga **una** vez, y que
   `pasarela_eventos` tiene una fila y nueve descartes.

---

## 5. Qué pasarela usar

### 5.1 ¿Mercado Pago sirve para lo que necesitas?

**Sí, con un matiz importante.** Mercado Pago Colombia soporta las dos cosas que
pediste:

- **Pago en línea que se registre solo**: sí, con Checkout Pro + webhook, y
  acepta tarjeta, PSE, Nequi y efectivo.
- **Dejar la tarjeta para cobro recurrente**: sí, con Suscripciones
  (`preapproval`), que admite frecuencia mensual o anual y cobra sola.

El matiz: en Mercado Pago **el calendario de cobro lo controla ellos**. Una
suscripción cobra cada mes contando desde la fecha en que el cliente se
suscribió. Si alguien se suscribe un 12, le cobrarán los 12, no el día 1 como
exige tu regla de corte a fin de mes.

Se resuelve, y hay que hacerlo así:

- Al activar la suscripción se le cobra aparte el **prorrateo** hasta fin de mes.
- El `preapproval` se crea con `start_date` = día 1 del mes siguiente, de modo
  que los cobros automáticos caen entre el 1 y el 5 — justo dentro de tu ventana
  de gracia.
- Y hay que dejar de usar el link de plan compartido: se crea **un `preapproval`
  por cuenta**, con `external_reference = <uuid de la cuenta>` y su propio
  `transaction_amount`. Es obligatorio de todos modos, porque el monto varía
  según el número de sedes ($59.900 o $89.900…), y un plan fijo no puede
  cubrirlos a todos.

### 5.2 Las alternativas colombianas

Antes de la tabla, una aclaración importante porque es fácil confundirse:
**el webhook lo tienen todas.** No es un diferencial de Wompi. Mercado Pago
también notifica, también va firmado y también sirve perfectamente. Lo que
cambia entre proveedores es *cuánto cobran* y *quién controla el calendario del
cobro recurrente*.

| Proveedor | Recurrencia con tarjeta | Webhook | Diferencial real |
|---|---|---|---|
| **Mercado Pago** | Sí (`preapproval`): **el calendario lo controla MP** | Sí, firma HMAC-SHA256 | Ya la tienes activa. Acepta efectivo y saldo MP |
| **Wompi** (Bancolombia) | Sí, por **tokenización**: guardas la tarjeta y **tú decides cuándo cobrar** | Sí, `transaction.updated`, checksum SHA256 | Encaja con tu corte a fin de mes. Dinero en Bancolombia |
| **ePayco** | Sí | Sí | Muy extendido, documentación irregular |
| **PayU** | Sí | Sí | Orientado a comercios grandes |
| **Bold** | Parcial | Sí | Fuerte en datáfono físico, no en SaaS |

#### Números de Wompi (tarifa oficial publicada)

- Plan Avanzado (agregador): **2,65% + $700 + IVA** en tarjeta.
- La comisión lleva **IVA del 19%** encima; eso aplica en todas las pasarelas.
- En pagos con tarjeta se practican además retenciones de ley (retefuente 1,5%,
  ICA 0,2%, reteIVA 15%). **No son un costo**: son anticipo de impuestos que
  recuperas al declarar, y las cobra cualquier agregador, no solo Wompi.

Para una factura de $59.900 pagada con tarjeta en Wompi:

```
  Comisión   2,65% x 59.900 = 1.587  +  700  =  2.287
  IVA 19% sobre la comisión               =    434
  ───────────────────────────────────────────────────
  Costo real por transacción              ≈  2.721   (4,5% del cobro)
```

Sobre PSE, Wompi tiene fama de ser el más barato del mercado (los comparadores
lo sitúan cerca del 1,49%), pero **ese número no lo pude confirmar en fuente
oficial** — hay que verificarlo en el simulador de tarifas de su web o
preguntándolo al abrir la cuenta.

De Mercado Pago no publico cifra aquí a propósito: la tarifa que te aplican a ti
depende de tu cuenta y del plazo de acreditación que elijas. **Míralo en tu
panel, en Tu negocio → Costos**, y compáralo con los $2.721 de arriba. Ese es el
único número que decide de verdad.

#### Lo que sí es seguro: el plan anual te ahorra comisiones

| Escenario (cliente de $59.900) | Costo aprox. |
|---|---|
| 12 pagos mensuales con tarjeta | ~$32.600 al año |
| 12 pagos mensuales por PSE (~1,5% + IVA) | ~$12.800 al año |
| **1 pago anual por PSE** ($575.040) | **~$10.300, una sola vez** |

El descuento del 20% que definiste ya se paga en parte por aquí, además de
adelantarte la caja y quitarte once oportunidades de mora.

### 5.3 Recomendación

Respondo directo a tu pregunta: **no cambies a Wompi todavía, pero abre la
cuenta ahora.** Las dos cosas a la vez, y por razones distintas.

**Por qué no cambiar ahora.** El motivo que te llevó a Wompi —que "devuelve el
webhook"— no es un diferencial: Mercado Pago hace exactamente lo mismo, ya
tienes la cuenta activa y ya tienes el plan de suscripción creado. Cambiar de
proveedor hoy te retrasa la Fase 3 sin resolver nada nuevo. Y con **un solo
cliente pagando en línea** (BATUT no paga hasta mayo de 2027; Cartagena sería el
primero), la diferencia de comisión entre uno y otro son unos cientos de pesos
al mes. No es una decisión que se deba tomar por ahí.

**Por qué abrir la cuenta igual.** Porque la ventaja real de Wompi aparece en la
Fase 4, cuando toque el cobro recurrente: la tokenización te deja **cobrar el
día que tú quieras y por el monto exacto que toque** —incluyendo cuando una
cuenta suma un local a mitad de año—, mientras que Mercado Pago cobra en el
aniversario de la suscripción y con un monto atado al plan. Con tu corte a fin
de mes, esa diferencia sí importa. Y como abrirla tarda entre 1 y 3 días
hábiles, conviene tenerla lista antes de necesitarla, no después.

**Antes de abrirla, comprueba dos requisitos**, porque son excluyentes:

1. **Wompi solo desembolsa a Bancolombia** (cuenta de ahorros o corriente a tu
   nombre; Nequi vale si te registras como persona natural y la cuenta tiene más
   de 30 días). Si no tienes Bancolombia, Wompi queda descartado de entrada.
2. Como **persona natural**, tu **primer desembolso llega 30 días después de la
   primera transacción**; los siguientes, al día hábil siguiente. Si registras
   el negocio como persona jurídica, no aplica esa espera. Tenlo en cuenta antes
   de poner ahí el primer cobro de un cliente.

Como persona natural solo te piden RUT y la cuenta bancaria: no hace falta
cámara de comercio.

**El plan concreto entonces:**

| Cuándo | Qué |
|---|---|
| Esta semana | Abres la cuenta de Wompi (si tienes Bancolombia) y miras tu tarifa real de Mercado Pago en el panel |
| Fase 3 | Integramos **Mercado Pago**: pago en línea funcionando, mensual y anual |
| Fase 4 | Con las dos tarifas reales sobre la mesa, decides quién se queda con la recurrencia |

Esto no es aplazar la decisión: es tomarla con el dato que hoy no tienes, que es
cuánto te cobra Mercado Pago a ti. El diseño de §6.2 guarda `proveedor` e
`id_externo` en cada suscripción, así que **soporta ambos a la vez** y cambiar
después es añadir un adaptador, no rehacer el sistema.

Una advertencia para la Fase 3: entra a tu cuenta de Mercado Pago y confirma que
tienes **credenciales de producción activas** y la cuenta verificada como
vendedor. Las cuentas personales sin verificar tienen límites de recaudo.

---

## 6. Sistema objetivo

### 6.1 Principio rector

> El acceso al producto lo decide **la cuenta**, no la empresa; y se resuelve
> con **una fecha** más **la lista de facturas vencidas**. Un pago confirmado es
> lo único que mueve esa fecha.

```sql
public.cuenta_al_dia(p_empresa_id uuid) returns boolean
-- true si la cuenta que cubre esa empresa:
--    está en prueba y prueba_hasta >= hoy,           o
--    está marcada como exenta (interna / cortesía),  o
--    cubierto_hasta >= hoy,                          o
--    no tiene ninguna factura con fecha_limite_pago < hoy sin pagar
```

Con esto, el caso BATUT se resuelve solo: `cubierto_hasta = 2027-05-31`, no se
le emiten facturas mensuales, y ningún cron puede tocarlo.

### 6.2 Modelo de datos

```
cuentas                       <- el que paga
  id, nombre, nit, ciudad,
  correo_facturacion,                       <- propio de cada cuenta:
  contacto_nombre, contacto_telefono           BATUT y Cartagena tienen
  tipo (cliente | interna | cortesia),         administradores distintos
  estado (implementacion | prueba | activa | morosa | restringida | cancelada)

cuenta_empresas               <- qué sedes cubre la cuenta
  cuenta_id, empresa_id, es_principal, activo, desde, hasta

planes                        <- ya existe, se amplía
  id, nombre, precio_mensual (59900),
  locales_incluidos (1),                    <- locales adicionales sin costo
  precio_local_adicional (30000),
  descuento_anual_pct (20), iva_porcentaje

suscripciones                 <- el corazón
  id, cuenta_id, plan_id,
  periodicidad (mensual | anual),
  estado (implementacion | prueba | activa | morosa | restringida | cancelada),
  prueba_desde, prueba_hasta (date),        <- se rellenan al ACTIVAR,
                                               no al registrar la empresa
  cubierto_hasta (date),                    <- LA fecha
  renovacion_automatica (bool),
  proveedor (mercadopago | wompi | manual),
  id_externo (preapproval_id / token),
  metodo_pago_resumen ("Visa ****4242"),
  precio_congelado, sedes_facturadas

facturas_suscripcion
  id, cuenta_id, suscripcion_id,
  numero (prefijo + consecutivo),
  periodo_desde, periodo_hasta,
  detalle jsonb,                            <- desglose: base + N locales
  subtotal, iva, total, moneda,
  fecha_emision, fecha_corte, fecha_limite_pago,
  estado (emitida | pagada | vencida | anulada),
  pdf_url, dian_cufe

pagos_suscripcion
  id, factura_id, cuenta_id, monto, moneda, fecha_pago,
  canal (tarjeta | pse | nequi | efectivo | transferencia),
  proveedor, proveedor_pago_id (ÚNICO),     <- idempotencia
  estado (confirmado | revertido), payload jsonb

pasarela_eventos
  id, proveedor, evento_id (ÚNICO), tipo, payload jsonb,
  procesado_at, resultado, error

suscripcion_bitacora
  cuenta_id, suscripcion_id, tipo, detalle jsonb, actor, created_at
```

Se conserva `payment_attempts` para comprobantes manuales (corregido). Se
retiran, tras migrar: `facturacion`, `historial_facturacion`,
`pagos_en_revision`, `facturaciones_pagadas`, `billing_cycles`.

Los constraints que estorban (`vencimiento_dia_15`, unicidad por
`empresa+periodo`) desaparecen con la tabla vieja.

### 6.3 Cálculo del monto

```sql
public.calcular_monto_cuenta(p_cuenta_id uuid, p_periodicidad text)
-- sedes = count(cuenta_empresas activas)
-- mensual = precio_mensual + max(0, sedes - 1 - locales_incluidos) * precio_local_adicional
-- anual   = mensual * 12 * (1 - descuento_anual_pct/100)
```

Comprobación con tus reglas: BATUT tiene 2 sedes → `max(0, 2−1−1) = 0` →
$59.900/mes, $575.040/año. Una cuenta de 3 sedes → `max(0, 3−1−1) = 1` →
$89.900/mes. ✔

Cuando se añade o quita una sede a mitad de mes, la diferencia se prorratea en
la siguiente factura, y si hay `preapproval` activo se actualiza su monto.

---

## 7. Plan de trabajo

Ninguna fase bloquea a ningún cliente. El corte de servicio solo se enciende en
la Fase 6, con tu autorización explícita.

### Fase 0 — Detener la hemorragia (1 sesión, se puede hacer ya)

No depende de ninguna decisión pendiente y no cambia nada de cara al usuario.

1. Pausar el cron `billing-crear-ciclos`, que sigue creando ciclos de $0 que
   borran deuda.
2. Dejar el cron `billing-enforcer-diario` en marcha pero **sin la degradación
   de plan**: que actualice banners, no que ponga `plan_actual='free'`.
3. Corregir la incoherencia `plan` / `plan_actual` de las cinco empresas
   afectadas.
4. Registrar el pago anual de BATUT con fecha y monto en `billing_events`, para
   que quede evidencia fechada antes de migrar nada.
5. Crear el bucket `comprobantes_pago` con sus políticas, para que la vía manual
   funcione mientras se construye la automática.
6. Arreglar `revision_pagos.js`: escribir el `uuid` del superadmin y **comprobar
   los errores** en vez de tragárselos.

**Resultado:** deja de perderse deuda y el circuito manual funciona de verdad.

### Fase 1 — Modelo de datos (2 sesiones)

Tablas de §6.2 con RLS desde el primer día, `cuenta_al_dia()`,
`calcular_monto_cuenta()` y numeración consecutiva real de facturas.

### Fase 2 — Migración de lo que existe (1 sesión)

1. Cuenta **BATUT** → cubre LE MERIDIEM + VIVA, suscripción anual,
   `cubierto_hasta = 2027-05-31`, `renovacion_automatica = true`.
2. Cuenta **BATUT Cartagena** → una sede, contacto de facturación de su propio
   administrador, estado `implementacion`, sin reloj de prueba corriendo y sin
   facturas. Queda esperando a que pulses "Iniciar prueba" el día que salga a
   operar.
3. Cuentas **internas** para tus cuatro empresas de prueba, `tipo = 'interna'`:
   nunca se les emite factura ni se les restringe nada.
4. Histórico de `billing_cycles` convertido en `facturas_suscripcion` marcadas
   como cerradas, para no perder la trazabilidad.
5. Modelo viejo en solo lectura: se quitan los triggers, **no se borra nada**.

**Criterio de aceptación:** BATUT ve una sola factura por sus dos sedes, con
vigencia hasta mayo de 2027 y sin nada pendiente; Cartagena existe como cuenta
sin cobros ni cuenta regresiva; las empresas de prueba no generan nada.

### Fase 3 — Cobro en línea con Mercado Pago (2-3 sesiones)

Todo lo de §4:

1. Credenciales en secretos de Supabase; webhook configurado en el panel.
2. Edge Functions `pago-crear-preferencia` y `mercadopago-webhook`, con firma
   verificada, idempotencia y confirmación contra la API.
3. RPC `registrar_pago_confirmado` transaccional.
4. Botones reales en `/facturacion/`: "Pagar este mes" y "Pagar el año
   (−20%)", con `external_reference` propio de cada factura.
5. Pruebas completas en sandbox antes de tocar producción.

**Criterio de aceptación:** un pago de prueba marca la factura pagada y mueve la
vigencia sin que nadie toque nada; y reenviar el mismo webhook diez veces no
duplica el pago.

### Fase 4 — Recurrencia y ciclo automático (2 sesiones)

1. Decisión Mercado Pago `preapproval` vs Wompi tokenizado (§5.3).
2. Alta de suscripción por cuenta con `external_reference`, prorrateo del primer
   periodo, y actualización del monto cuando cambia el número de sedes.
3. `pg_cron`: emitir facturas el día 25, cerrar periodo el último día del mes,
   marcar vencidas el día 6, y **anotar** (sin aplicar) quién quedaría
   restringido.
4. Correos con `_shared/correo.ts`: factura emitida, recordatorio el día 1 y el
   día 4, vencida, pago recibido.

### Fase 5 — Pantallas (2 sesiones)

1. `/facturacion/`: estado de la cuenta, sedes incluidas y su desglose, próxima
   fecha de corte, método de pago guardado, botones de pago, historial con PDF.
   Y la factura deja de mentir: monto en letras calculado, numeración real,
   desglose por sede.
2. Backoffice: cuentas, sedes, suscripciones, facturas, pagos, conciliación,
   prórroga manual con motivo, y métricas (ingreso recurrente, mora, bajas).
   Incluye el botón **"Iniciar prueba"** (§1.3): es como pondrás en marcha el
   reloj de Cartagena el día que salga a operar, y el que usarás con cada
   cliente nuevo al terminar su implementación.

### Fase 6 — Restricción de servicio (1-2 sesiones, **solo cuando lo autorices**)

1. `cuenta_al_dia()` en los RPC y Edge Functions de escritura.
2. `puedeEnviarDatos()` real; quitar el atajo de `resolveEmpresaPlan()`.
3. **Se enciende en tres pasos**: primero modo observación (registra a quién
   habría restringido, sin restringir); luego lo revisas una semana; luego se
   activa por cuenta, con las internas y BATUT exentas.

Regla del modo restringido: **leer siempre, escribir nunca, y facturación
siempre accesible** — que es lo que el banner ya promete hoy sin cumplirlo.

### Fase 7 — Facturación electrónica DIAN (a decidir)

Lo que hoy muestras no tiene validez fiscal (§3.10). Opciones: proveedor por API
(Siigo, que ya conoces, Alegra, Factus) o el servicio gratuito de la DIAN con
emisión manual. Se engancha en el paso (e) del webhook: pago confirmado → emitir
factura → guardar CUFE y PDF.

---

## 8. Orden y dependencias

```
Fase 0 ──► Fase 1 ──► Fase 2 ──► Fase 3 ──► Fase 4 ──► Fase 5 ──► Fase 6 ──► Fase 7
 ya       modelo    migrar     cobro      recurrencia  pantallas  restricción  DIAN
                    BATUT      en línea                           (tu permiso)
```

La Fase 0 se puede ejecutar hoy mismo. Las fases 1-3 son el grueso y lo que
resuelve tu problema real: **que los pagos entren y se registren solos**.

---

## 9. Supuestos declarados y lo que falta confirmar

Confirmado ya: BATUT cubierto hasta el **31/05/2027**; **BATUT Cartagena es una
cuenta cliente aparte** (empresa madre, otro administrador, $59.900/mes tras sus
15 días de prueba).

Queda por confirmar:

| # | Supuesto que estoy usando | Por qué importa |
|---|---|---|
| 1 | Cobro **vencido**: se usa el mes, se factura el último día, se paga hasta el 5 | Es como leí "corte último día del mes + 5 días de gracia" |
| 2 | El primer periodo tras la prueba se cobra **prorrateado por días** | La alternativa es regalar los días sueltos hasta fin de mes |
| 3 | Precios **sin IVA discriminado** (como hoy, 0%) | Confirmar con tu contador si debes cobrar IVA sobre el servicio |
| 4 | La prueba de 15 días **no pide tarjeta** por adelantado | Si la pides, sube la conversión a pago pero baja la de registro |
| 5 | Los 15 días de prueba de Cartagena arrancan **cuando tú lo digas**, no ahora | Está en implementación desde el 22/08; el reloj automático ya le habría comido días |
| 6 | Tienes **cuenta Bancolombia** a tu nombre | Sin ella, Wompi queda descartado (§5.3) |

---

## 10. Riesgos y lo que no haría

- **No pasar a producción sin sandbox.** Toda la Fase 3 se prueba con
  credenciales `TEST-`. Un webhook sin firma verificada en producción es una
  puerta abierta a que cualquiera se regale servicio.
- **No borrar las tablas viejas** hasta que el modelo nuevo lleve un ciclo
  completo funcionando. Se desconectan, se mantienen.
- **No encender la Fase 6 antes de que la Fase 3 esté viva.** Si restringes
  antes de poder cobrar en línea, el cliente que quiera pagar no podrá, y
  quedarás igual de manual pero con clientes molestos.
- **Registrar la vigencia de BATUT antes de tocar el auto-perdón** (§3.3), o el
  cron lo suspenderá pese a estar pagado hasta 2027.
- **Verifica tu cuenta de Mercado Pago** antes de la Fase 3: credenciales de
  producción activas y cuenta verificada como vendedor. Las cuentas personales
  sin verificar tienen límites de recaudo.
- El `preapproval_plan_id` que ya tienes creado **no sirve tal cual**: cobra un
  monto fijo igual para todos. Con locales adicionales el monto varía por
  cliente, así que hay que crear un `preapproval` por cuenta.

---

## Fuentes consultadas

- [Mercado Pago — Webhooks](https://www.mercadopago.com.co/developers/es/docs/your-integrations/notifications/webhooks)
- [Mercado Pago — Suscripciones](https://www.mercadopago.com.co/developers/es/docs/subscriptions/overview)
- [Mercado Pago — Planes de suscripción](https://www.mercadopago.com.co/developers/es/docs/subscription-plans/overview)
- [Wompi — Eventos (webhooks)](https://docs.wompi.co/docs/colombia/eventos/)
- [Wompi — Fuentes de pago y tokenización](https://docs.wompi.co/en/docs/colombia/fuentes-de-pago/)
- [Wompi — Planes y tarifas](https://soporte.wompi.co/hc/es-419/articles/360020957133--Cu%C3%A1les-son-los-planes-y-tarifas-que-maneja-la-plataforma-Wompi)
- [Wompi — Cobros adicionales sobre transacciones aprobadas](https://soporte.wompi.co/hc/es-419/articles/360042471394--Qu%C3%A9-cobros-adicionales-se-generan-sobre-las-transacciones-aprobadas)
- [Wompi — Proceso de vinculación y requisitos](https://soporte.wompi.co/hc/es-419/articles/360020955173--C%C3%B3mo-es-el-proceso-de-vinculaci%C3%B3n-a-la-pasarela-de-pago)
- [Wompi — Condiciones de la cuenta bancaria](https://soporte.wompi.co/hc/es-419/articles/360056658413--Qu%C3%A9-condiciones-debe-cumplir-la-cuenta-bancaria-que-se-va-a-registrar-en-la-plataforma)
- [Comparativa de pasarelas en Colombia 2026](https://bytechhub.com/blog/pasarelas-de-pago-en-colombia-comparativa-2026/)

---

## 11. Registro de ejecución (2026-08-25)

Lo que sigue es lo que se construyó y quedó **funcionando en producción**, no
lo que se propone. Cambió una decisión respecto a la versión 2: se integró
**Wompi** en vez de Mercado Pago, porque abriste la cuenta y entregaste las
credenciales de producción. El diseño ya lo contemplaba (§5.3): `suscripciones`
guarda `proveedor` e `id_externo`, así que Mercado Pago sigue siendo posible
como segundo adaptador sin rehacer nada.

### 11.1 Lo que hay que hacer en el panel de Wompi

Una sola cosa, y es el único paso que no se puede automatizar:

**Mi cuenta → URL de eventos**, pegar y guardar:

```
https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/wompi-eventos
```

La función ya está desplegada y respondiendo. Comprobado contra ella:

| Prueba | Resultado |
|---|---|
| POST con checksum inválido | **401**, no se toca nada |
| POST con checksum válido | **200**, evento registrado |
| El mismo evento reenviado | **200 `repetido:true`**, sin duplicar el pago |
| Sin cabecera de autorización | Entra igual (`verify_jwt = false`) |

La firma de integridad se validó contra el ejemplo literal de la documentación
de Wompi y **da el mismo hash**.

### 11.2 Fase 0 — hecho

- `billing-crear-ciclos` **pausado**. Era la mitad del auto-perdón de §3.3.
- `billing_daily_enforcer()` reescrito: **ya no** pone `plan_actual='free'` ni
  `activa=false`. Ahora anota en la tabla nueva `billing_observaciones`.
- Las **cinco empresas** con `plan='pro'` / `plan_actual='free'` corregidas.
- «Prueba Nuevo Cliente», apagada por el bug, **reactivada**.
- Pago anual de BATUT registrado con fecha y monto en `billing_events`, y sus
  dos sedes protegidas con `manual_override` hasta 2027-06-30.
- Bucket **`comprobantes_pago` creado** con tres políticas RLS (el cliente sube
  y lee solo su carpeta; el superadmin, todo).

### 11.3 Fases 1 y 2 — hecho

Tablas nuevas: `cuentas`, `cuenta_empresas`, `suscripciones`,
`facturas_suscripcion`, `pagos_suscripcion`, `pasarela_eventos`,
`suscripcion_bitacora`, `billing_observaciones`. Todas con RLS desde el minuto
cero. `planes` ampliada con `locales_incluidos`, `precio_local_adicional`,
`descuento_anual_pct`, `iva_porcentaje`.

Funciones: `cuenta_de_empresa()`, `mi_cuenta_id()`, `calcular_monto_cuenta()`,
`cuenta_al_dia()`, `siguiente_numero_factura()`, `monto_en_letras()`.

Estado real tras migrar:

| Cuenta | Tipo | Sedes | Estado | Cubierto hasta | Precio |
|---|---|---|---|---|---|
| BATUT | cliente | 2 | activa | **2027-05-31** | $575.040/año |
| BATUT Cartagena | cliente | 1 | **implementación** | — (sin reloj) | $59.900/mes |
| Interna · Global Nexo | interna | 2 | exenta | — | — |
| Interna · Prueba Nuevo Cliente | interna | 1 | exenta | — | — |
| Interna · Global Nexo Shop | interna | 1 | exenta | — | — |

Se cumplen los tres criterios de aceptación de la Fase 2: BATUT tiene **una**
factura por sus dos sedes, Cartagena existe sin cobros ni cuenta regresiva, y
las internas no generan nada.

`monto_en_letras()` sustituye a `amountInWordsEs()`, que devolvía «cincuenta y
nueve mil novecientos» cobrara lo que cobrara (§3.10). Comprobado: 575.040 →
«QUINIENTOS SETENTA Y CINCO MIL CUARENTA PESOS COLOMBIANOS».

### 11.4 Fase 3 — hecho

**Edge Functions desplegadas:**

| Función | JWT | Qué hace |
|---|---|---|
| `pago-iniciar` | sí | Resuelve la factura del cliente, la firma y devuelve la URL del Checkout de Wompi |
| `wompi-eventos` | **no** | Recibe la notificación, valida el checksum, reconsulta la API y aplica el pago |

**RPC transaccionales:** `emitir_factura_cuenta()`, `factura_a_pagar()`,
`registrar_pago_confirmado()`, `revertir_pago()`, `iniciar_prueba()`,
`estado_facturacion_empresa()`, `referencia_de_factura()`,
`factura_por_referencia()`.

`registrar_pago_confirmado` y `revertir_pago` están **revocadas para
`authenticated`**: solo las puede llamar `service_role`. Un cliente con sesión
no puede declararse pagado a sí mismo.

Prueba de extremo a extremo ejecutada contra la base real (con `rollback`):

| Caso | Resultado |
|---|---|
| Factura de agosto | `AX-01002`, 01-ago → 31-ago, corte 31-ago, límite **5-sep**, $59.900 |
| Pago aprobado | factura pagada, `cubierto_hasta` movido a 2026-08-31 |
| Mismo webhook reenviado | `repetido: true`, **un solo pago** |
| Monto que no cuadra | **no** marca pagada: queda `pendiente_conciliar` y avisa |
| Referencia irreconocible | rechazada, y el pago se guarda como huérfano para conciliar |
| Contracargo | revierte el pago y **retrocede la vigencia** |

**El problema de raíz de §3.1 queda resuelto**: cada cobro lleva su propia
referencia derivada del uuid de la factura, así que la notificación se aplica
sola a quien corresponde. Se acabó el enlace único compartido.

**§3.5 corregido:** `aprobar_pago` y `rechazar_pago` existen ahora de verdad,
toman el revisor de `auth.uid()` (uuid, no el correo) y registran el pago
también contra el modelo nuevo. `revision_pagos.js` perdió el fallback que se
tragaba los errores.

### 11.5 Fase 4 — hecho

`facturacion_ciclo_diario()` + tarea `facturacion-ciclo-diario` a las **09:10
de Colombia**, y la Edge Function `cron-facturacion` que envía los correos
(factura emitida, recordatorio, vencida) por el proveedor ya configurado.

```
día 25        emite la factura del mes y la envía por correo
días 1 y 4    recordatorio de que quedan días de gracia
día 6         marca vencida, avisa, y ANOTA a quién habría restringido
```

Quedan fuera siempre: internas, cortesías, suscripciones en implementación, en
prueba vigente, y cuentas con `cubierto_hasta` por delante — que es lo que
protege a BATUT hasta mayo de 2027.

Ejecutado hoy contra producción: **cero facturas emitidas, cero correos**. Es
el resultado correcto.

### 11.6 Fase 5 — hecho

- **`/facturacion/`** reescrita sobre `estado_facturacion_empresa()`. Una sola
  fuente de verdad (se acabó el §3.9), desglose por sede, fecha de corte,
  botones «Pagar ahora» y «Pagar el año (−20%)», historial y monto en letras
  calculado de verdad.
- **`/facturacion/cuentas.html`** (nueva, superadmin): cuentas, sedes,
  vigencia, facturas abiertas, y los botones **«Iniciar prueba»** y «Emitir
  factura». Ahí es donde arrancará el reloj de Cartagena el día que salga a
  operar.
- **§3.12 corregido:** `facturacion` estaba clasificada solo en `ENV_SIIGO`, el
  entorno del módulo Siigo descontinuado. Un cliente de Loggro no veía su
  propia factura y por tanto **no podía pagarla**. Ahora está en los dos
  entornos.

### 11.7 Lo que NO se hizo, y por qué

| Pendiente | Motivo |
|---|---|
| **Fase 6 — restricción de servicio** | Requiere tu autorización explícita (§1.4). Todo el andamiaje está listo: `cuenta_al_dia()` responde correctamente y `billing_observaciones` acumula evidencia. Hoy **nadie queda bloqueado** |
| **Cobro recurrente con tarjeta guardada** | Necesita el formulario de tokenización en el navegador y que Wompi tenga la cuenta plenamente habilitada para transacciones. El modelo ya guarda `proveedor` e `id_externo` esperándolo |
| **Fase 7 — DIAN** | Sigue siendo decisión tuya de proveedor (Siigo / Alegra / Factus / DIAN gratuito) |
| **Retirar las tablas viejas** | Por diseño: `facturacion`, `historial_facturacion`, `pagos_en_revision`, `facturaciones_pagadas` y `billing_cycles` se mantienen intactas hasta que el modelo nuevo lleve un ciclo completo |

### 11.8 Lo que hace falta de tu parte

1. **Pegar la URL de eventos** en el panel de Wompi (§11.1).
2. **Hacer un pago real pequeño** y comprobar que la factura se marca sola.
   Es la única prueba que queda, porque las credenciales son de producción y
   con esas llaves no hay sandbox.
3. **Rotar la llave privada y los dos secretos** de Wompi cuando el circuito
   esté validado: viajaron por chat y quedaron en el registro de la sesión.
   Están guardados en los secretos de Supabase, nunca en el repositorio.
4. Confirmar si `https://restaurantes.enkrato.com/facturacion/` es la URL
   correcta de retorno tras pagar (es la que quedó configurada).
5. Decidir sobre los supuestos 1-4 de §9, que siguen abiertos.

### 11.9 Archivos tocados

**Migraciones nuevas** (todas aplicadas a `tgkvcvnwwnrlyhbqmhaf`):

```
20260825000000_fac_fase0_detener_hemorragia.sql
20260825001000_fac_fase1_modelo_cuentas.sql
20260825002000_fac_fase2_migrar_clientes.sql
20260825003000_fac_fase3_rpcs_cobro.sql
20260825004000_fac_fase3b_revision_manual.sql
20260825005000_fac_fase4_ciclo_automatico.sql
20260825006000_fac_fase4_cron.sql
20260825007000_fac_fase5_backoffice.sql
```

**Edge Functions:** `_shared/wompi.ts` (nueva), `wompi-eventos/`,
`pago-iniciar/`, `cron-facturacion/`, y `config.toml` con sus tres bloques.

**Frontend:** `js/facturacion.js` (reescrito), `js/cuentas_facturacion.js`
(nuevo), `js/revision_pagos.js`, `js/urls.js`,
`js/access_control.local.js`, `facturacion/index.html`,
`facturacion/cuentas.html` (nuevo).

---

## 12. Registro de ejecución (2026-08-27) — rediseño de la pantalla y modalidades

Se rediseñó `facturacion/index.html` con la misma arquitectura (JS vanilla,
módulos ES, sin build) y se corrigió la oferta que mostraba.

### 12.1 El defecto que se corrigió

La pantalla pintaba dos botones fijos: «Pagar ahora» y «Pagar el año (−20%)».
Con la factura AX-01004 de BATUT viva —anual, 2027-06-01 → 2028-05-31— los dos
mostraban **$ 575.040**, porque el segundo ofrecía el descuento sobre un
periodo que ya lo tenía aplicado.

No era un problema de presentación. La causa está en `factura_a_pagar()`:

- con `p_periodicidad = 'anual'` **emite** una factura anual nueva;
- con cualquier otra cosa devuelve la factura viva más antigua.

Y `emitir_factura_cuenta()` arranca el periodo en `cubierto_hasta + 1` y
reutiliza la factura viva si ya existe una para ese mismo periodo. De ahí:

| Situación | Qué hacía el botón «Pagar el año» | Qué se muestra ahora |
|---|---|---|
| Factura **anual** viva | Devolvía esa misma factura. Botón que finge ser una oferta | Un solo CTA. Se dice que ya cubre el año |
| Factura **mensual** viva | Emitía una anual **y dejaba la mensual viva**: dos cobros solapados | Un solo CTA por la mensual. El cambio a anual se tramita por correo |
| Sin factura viva | Correcto | Selector mensual/anual con los dos precios |

La tercera fila es la única en la que caben las dos modalidades, porque lo que
se contrate arranca cuando termine lo ya cubierto y no solapa con nada.

### 12.2 Precios

Se toman siempre de `estado_facturacion_empresa()` → `calcular_monto_cuenta()`.
Ninguno está escrito en el frontend. Con el plan `pro` actual
(`precio_mensual` 59.900, `descuento_anual_pct` 20):

```
mensual          $  59.900
anual            $ 575.040   = 59.900 × 12 × 0,80
doce mensuales   $ 718.800
ahorro           $ 143.760   (20 %)
equivale a       $  47.920 / mes
```

El ahorro lo calcula `calcularAhorroAnual()` restando el anual a doce
mensualidades. Si `descuento_anual_pct` pasara a 0, el distintivo de «mejor
opción» desaparece solo, sin tocar código.

### 12.3 Cobro de prueba de $1.000

Para verificar el circuito completo hace falta una factura real: el webhook
exige que el monto **cuadre** con ella (§4.4), así que pagar $1.000 contra una
factura de $575.040 cae en `pendiente_conciliar` y no prueba nada.

La salida es una cuenta aparte cuyas facturas sí valen $1.000 — la que ya
existía a medias, `AXIOMA · prueba de cobro`. Tres candados:

1. La bandera vive en la **cuenta** (`cuentas.es_banco_pruebas`), no en un
   precio global: el plan sigue costando $59.900.
2. Un trigger impide marcar como banco de pruebas cualquier cuenta **con sedes
   activas**. BATUT no puede caer ahí ni por error de dedo.
3. `factura_de_prueba()` solo la ejecuta `service_role`; la llama
   `pago-iniciar` tras comprobar superadmin **y** `PAGO_PRUEBA_ACTIVA=1`.

Sin ese interruptor la rama es inalcanzable, también para un superadmin. El
botón solo se pinta para superadministradores, pero **esconderlo no es la
protección**: la comprobación real es de servidor.

Si se configuran `WOMPI_TEST_PUBLIC_KEY` y `WOMPI_TEST_INTEGRITY_SECRET`, el
modo prueba usa sandbox y el dinero es ficticio. Sin ellas usa producción con
el importe simbólico, que es lo que hay hoy.

### 12.4 Para ejecutar la prueba de $1.000

Todo lo demás está aplicado y desplegado. Solo queda el interruptor:

```
npx supabase secrets set PAGO_PRUEBA_ACTIVA=1     # encender
# ... ejecutar la prueba desde la pantalla, como superadmin ...
npx supabase secrets unset PAGO_PRUEBA_ACTIVA     # APAGAR al terminar
```

### 12.5 Decisión de negocio que queda abierta

**Pasar de mensual a anual con una factura mensual viva.** Hoy no se ofrece
desde la pantalla porque `factura_a_pagar('anual')` emitiría la anual y dejaría
la mensual pendiente: dos cobros solapados. Para ofrecerlo habría que decidir
si al emitir la anual se **anula** la mensual viva, se **prorratea**, o se
descuenta lo ya pagado. Eso mueve dinero y no estaba definido, así que se dejó
fuera y la pantalla explica cómo tramitarlo por correo.

### 12.6 Archivos tocados

**Migración nueva** (escrita, **pendiente de aplicar**):

```
20260827000000_fac_banco_de_pruebas.sql
```

**Edge Functions:** `pago-iniciar/index.ts` (modo prueba; el flujo normal
queda igual).

**Frontend:** `js/facturacion.js` (reescrito), `css/facturacion.css`
(reescrito), `facturacion/index.html`, `css/cuentas_facturacion.css` (nuevo —
es la hoja anterior, movida para que el backoffice de `facturacion/cuentas.html`
no perdiera sus clases al rediseñarse la pantalla del cliente),
`facturacion/cuentas.html` (solo el enlace a esa hoja).

---

## 13. Incidente del 2026-08-27 y su corrección

Al probar lo del §12 aparecieron dos fallos. Los dos tenían la misma raíz: el
código nuevo estaba en el repositorio pero **no en producción**.

### 13.1 El cobro de prueba abrió un checkout de $575.040

**Qué pasó.** El botón mandaba `{ modo: "prueba" }`. La versión de
`pago-iniciar` desplegada era la anterior, que **no conoce ese campo**: lo
ignoró en silencio, cayó al `periodicidad ?? "mensual"` por defecto, y
`factura_a_pagar()` devolvió la factura viva de BATUT. Wompi abrió con
$575.040. No se pagó nada: cero filas en `pagos_suscripcion`.

**La causa de fondo no fue no haber desplegado**, sino haber elegido una
bandera que un despliegue viejo degrada al camino que cobra de verdad. Un flag
desconocido nunca debe caer del lado del cobro.

**La corrección, en tres capas:**

1. La bandera vive dentro de `periodicidad` (`"prueba"`), que la función
   **valida**. Un despliegue viejo responde «periodicidad debe ser 'mensual' o
   'anual'» en vez de cobrar. El fallo pasa al lado seguro.
2. Antes de redirigir, el frontend exige que la respuesta traiga
   `prueba: true` **y** `factura.total === 1000`. Si no, no abre nada y dice
   por qué.
3. Todo botón de pago lleva su importe en `data-total`, y `pagar()` comprueba
   que el servidor vaya a cobrar exactamente eso. Si no coincide —el estado
   cambió entre el repintado y el clic, o el despliegue no es el esperado— no
   redirige: recarga y deja decidir otra vez. **Nadie llega a Wompi con un
   importe que no vio.**

### 13.2 No aparecía la opción mensual

**Qué pasó.** BATUT tenía AX-01004 emitida —anual, 2027-06-01 → 2028-05-31—
estando **al día y cubierta hasta 2027-05-31**. La bitácora dice que la emitió
el actor `cliente` ese mismo día: fue el botón «Pagar el año (−20%)» de la
pantalla anterior, que no llevaba a pagar sino que **emitía**.

La pantalla nueva trataba cualquier factura emitida como deuda exigible, así
que mostraba un único CTA y escondía el selector. La regla era demasiado
gruesa: confundía «debes esto» con «reservaste el año que viene».

**La distinción que faltaba en el modelo:**

| | Condición | Qué es |
|---|---|---|
| **Exigible** | `periodo_desde <= hoy`, o vencida, o sin vigencia cubierta | Deuda. Se paga |
| **Anticipada** | `periodo_desde > hoy` **y** `cubierto_hasta >= hoy` | Reserva. Se puede cambiar |

`clasificarFactura()` en el frontend replica exacto el candado de
`cambiar_modalidad_factura()` en la base, para que la pantalla nunca ofrezca un
botón que el servidor rechaza.

**Y la pieza que faltaba para poder cambiar:** no existía forma de anular una
factura. El estado `anulada` solo lo escribía la migración de datos históricos.
Pedir la otra modalidad se limitaba a emitir una segunda y dejar viva la
primera — dos cobros solapados. Ahora hay dos funciones nuevas, con los mismos
cuatro candados: estado `emitida`, **sin ningún pago asociado**, periodo aún
sin empezar, y alcance de la propia cuenta.

- `anular_factura_no_pagada(factura_id, motivo)`
- `cambiar_modalidad_factura(periodicidad, empresa_id)` — anula y emite en una
  sola transacción, así que nunca quedan dos vivas ni ninguna.

Verificado contra la base real, en una transacción revertida al terminar:

```
1. anual emitida     : AX-01006  $575.040  2027-06-01 -> 2028-05-31
2. cambiada a mensual: AX-01007  $ 59.900  2027-06-01 -> 2027-06-30
3. la anual quedó    : anulada                    [OK]
4. facturas vivas    : 1                          [OK]
5. mismo arranque    : 2027-06-01                 [OK]
6. repetir mensual   : rechazado                  [OK]
7. anular periodo en curso: rechazado             [OK]
```

### 13.3 AX-01004

Anulada (`20260827020000_fac_anular_ax01004.sql`), con los cuatro candados
comprobados y su entrada en la bitácora. BATUT queda como estaba de verdad: al
día, cubierta hasta el 31 de mayo de 2027, sin nada emitido por delante — y con
el selector mensual/anual disponible.

### 13.4 Lección para el resto del proyecto

Una migración escrita no es una migración aplicada, y una función en el
repositorio no es una función desplegada. Cuando el frontend y el servidor
pueden ir desacompasados, **la UI tiene que fallar hacia el lado que no cobra**:
validar la respuesta antes de actuar sobre ella, en vez de confiar en que el
otro extremo entiende lo mismo.

### 13.5 Archivos tocados

**Migraciones** (aplicadas):

```
20260827000000_fac_banco_de_pruebas.sql
20260827010000_fac_cambio_de_modalidad.sql
20260827020000_fac_anular_ax01004.sql
```

**Edge Functions:** `pago-iniciar` (desplegada, v3).

**Frontend:** `js/facturacion.js`, `css/facturacion.css`.

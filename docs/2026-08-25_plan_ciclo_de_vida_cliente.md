# Ciclo de vida del cliente: del registro a la baja

Fecha: 2026-08-25
Alcance: alta de clientes nuevos, periodo de prueba, bloqueo por no activar,
consola de administración, baja del servicio y borrado de datos.
Continúa [2026-08-24_plan_facturacion_multitenant.md](2026-08-24_plan_facturacion_multitenant.md),
cuyas fases 0-5 ya están en producción.

> **Estado a 2026-08-25: ejecutado.** Fases A a G aplicadas en producción.
> El registro de lo entregado, con las decisiones que tomaste y lo que quedó
> fuera, está en el **§7**. La purga a los 90 días **no se implementó**: nada
> borra datos todavía.

---

## 0. Antes que nada: hay algo roto y es de una línea

La pantalla `/facturacion/` no carga. No es un problema de datos: **BATUT tiene
todo bien registrado**. Lo comprobé impersonando a `gerenciabatut@gmail.com`
contra la base real y el resultado es exactamente el que esperabas ver:

```
cuenta            BATUT · 2 sedes (LE MERIDIEM + VIVA)
factura           AX-00001 · $575.040 · pagada
periodo           2026-06-01 → 2027-05-31
cubierto hasta    2027-05-31   (280 días restantes)
al día            sí
```

Lo que falla es la función `public.current_empresa_id()`, que tiene un error
de tipo desde antes de este trabajo:

```sql
--  otros_usuarios.estado es BOOLEAN
where ou.id = auth.uid()
  and lower(coalesce(ou.estado, 'activo')) <> 'inactivo'   -- ← 'activo' es texto
```

PostgreSQL intenta convertir el literal `'activo'` a booleano **al preparar la
función**, no al ejecutar la rama. Por eso falla siempre, para todo el mundo, y
el `coalesce` no llega a cortocircuitar:

```
ERROR 22P02: invalid input syntax for type boolean: "activo"
CONTEXT: SQL function "current_empresa_id" during startup
```

### Por qué no había explotado antes

Porque **nadie la llamaba**. Es justo lo que anoté en el §3.11 del diagnóstico
anterior: facturación usaba `get_my_empresa_id()`, que solo mira
`usuarios_sistema`. `current_empresa_id()` existía como la versión buena —
contempla `otros_usuarios` y el switcher de locales— pero estaba muerta.

Al construir el modelo de cuentas la elegí a propósito, porque es la correcta.
Fui el primero en ejercitarla, y ahí saltó el error. Es mío en el sentido de
que mi código lo destapó; el defecto llevaba ahí desde el `init`.

### Qué más se lleva por delante

Dos cosas, y la segunda no la había detectado hasta ahora:

| Afectado | Síntoma |
|---|---|
| `/facturacion/` | «No pudimos cargar tu facturación» para **todos** los usuarios |
| Políticas RLS `comprobantes_pago_subir` y `comprobantes_pago_leer` | El bucket que creé en la Fase 0 **tampoco funciona**: ambas políticas se apoyan en `current_empresa_id()` |

O sea: la vía manual de comprobantes que di por arreglada en la Fase 0 sigue
rota, por otro motivo. Lo corrijo el mismo día que esto.

### El arreglo

```sql
and coalesce(ou.estado, true) = true
```

Probado en transacción con `rollback`: con esa línea, la pantalla devuelve el
JSON completo de arriba. **Es lo primero de la Fase A y no depende de que
apruebes el resto del plan.**

---

## 1. Las reglas nuevas que me diste

| Regla | Consecuencia de diseño |
|---|---|
| El cliente pulsa **él mismo** «Iniciar mi prueba gratuita de 15 días» | El botón pasa del backoffice al cliente. El del backoffice se queda, pero para otra cosa (§3.3) |
| Tiene **30 días** desde el registro para activar | Aparece una ventana con fecha límite y un estado nuevo: `registrada` |
| Si no activa, **la cuenta se bloquea** y necesita a un administrador | **Es el primer bloqueo que autorizas.** Ver §2.4: está acotado a propósito |
| Necesitas un **superadministrador** con funciones especiales | Hoy el único es `santiagoelchameluco@gmail.com`. Tu correo **no está** en `system_users` |
| Si alguien se da de baja: datos **90 días** y luego se borran | Estados `cancelada` → `purgada`, con cron de purga y exportación previa |
| En la baja se suspende todo **excepto retomar el plan** | Nivel de acceso `solo_facturacion` |
| Todo eso debe estar en los términos y condiciones | `legal/terminos.html` hoy son tres párrafos sobre responsabilidad contable |

### Sobre el botón: tenías razón y el diseño mejora

Mi versión ponía el arranque de la prueba solo en tu backoffice. La tuya lo
pone en el cliente. La tuya es mejor: te quita trabajo y hace que el reloj mida
lo que debe medir, que es el tiempo en que el cliente **decide** que está listo.

Pero hay un caso que tu versión sola no cubre, y es justo el de BATUT
Cartagena: alguien a quien tú montas el servicio durante semanas antes de que
pueda usarlo. Si su ventana de 30 días corriera durante el montaje, se le
gastaría sin haber tocado el producto.

La solución no es elegir una de las dos. Es que el estado `implementacion`
**congele el reloj**:

```
registrada  ──(tú marcas "en implementación")──►  implementacion
   │                                                    │
   │ 30 días corriendo                          reloj PARADO
   │                                                    │
   └────────── el cliente pulsa el botón ───────────────┘
                          ▼
                       prueba (15 días)
```

Así el camino normal es el tuyo —el cliente se registra, ve el cartel y lo
pulsa cuando quiere— y el camino de acompañamiento sigue existiendo sin
castigar a nadie.

---

## 2. El ciclo de vida completo

### 2.1 La máquina de estados

```
                        ┌──────────────┐
      registro   ─────► │  REGISTRADA  │  30 días para activar
                        └──────┬───────┘
                               │
            ┌──────────────────┼──────────────────┐
            │                  │                  │
   tú marcas montaje    cliente pulsa      pasan 30 días
            │            "Iniciar prueba"         │
            ▼                  │                  ▼
    ┌────────────────┐         │        ┌──────────────────────┐
    │ IMPLEMENTACION │         │        │ BLOQUEADA_SIN_ACTIVAR│
    │  (reloj parado)│         │        │  solo /facturacion/  │
    └────────┬───────┘         │        └──────────┬───────────┘
             └─────────────────┤                   │ un admin desbloquea
                               ▼                   │ (ventana nueva)
                        ┌─────────────┐            │
                        │   PRUEBA    │◄───────────┘
                        │   15 días   │
                        └──────┬──────┘
                               │ termina → primera factura prorrateada
                               ▼
                        ┌─────────────┐   paga    ┌─────────────┐
                        │   ACTIVA    │◄──────────│   MOROSA    │
                        └──────┬──────┘  factura  └─────────────┘
                               │         vencida    NO restringe:
                               │                    solo observa (§2.4)
                               │ el cliente pide la baja
                               ▼
                        ┌─────────────┐
                        │  CANCELADA  │  90 días · solo /facturacion/
                        └──────┬──────┘  puede retomar el plan
                               │
                    ┌──────────┴──────────┐
                    │                     │ pasan 90 días
              retoma el plan               ▼
                    │              ┌─────────────┐
                    └──────────────┤   PURGADA   │  datos borrados
                                   └─────────────┘
```

### 2.2 Los tres niveles de acceso

Un solo concepto en vez de la mezcla actual de `activa`, `activo`, `plan`,
`plan_actual` y `mostrar_anuncio_impago`:

| Nivel | Qué puede hacer | Quién queda aquí |
|---|---|---|
| `total` | Todo | Registrada dentro de plazo, implementación, prueba, activa, **morosa** |
| `solo_facturacion` | Ver su cuenta, pagar, retomar el plan, exportar sus datos, cerrar sesión | Bloqueada sin activar, cancelada |
| `solo_lectura` | Leer sí, escribir no | **Nadie todavía.** Reservado para la Fase 6 del plan anterior |

La función `acceso_de_empresa(empresa_id)` devuelve ese nivel más el motivo y
la fecha relevante, para que la interfaz pueda explicar en vez de solo negar.

### 2.3 Dónde se aplica de verdad

Un bloqueo que solo vive en el navegador no es un bloqueo. Se aplica en tres
capas, y la que manda es la tercera:

1. **Router** — redirige a `/facturacion/` con el mensaje que toca.
2. **Menú** — oculta lo que no aplica.
3. **Servidor** — los RPC de escritura y las Edge Functions llaman a
   `acceso_de_empresa()` y rechazan lo que no corresponda. Sin esto, cualquiera
   con la consola del navegador se salta las dos anteriores.

### 2.4 Qué bloquea y qué no — importante

Me pediste antes que **nada bloqueara a ningún cliente**. Ahora me pides que
una cuenta sin activar se bloquee. Las dos cosas conviven si se separan bien, y
quiero que quede explícito porque es un cambio en una regla que pusiste tú:

| Situación | ¿Bloquea? | Por qué |
|---|---|---|
| No activó en 30 días | **Sí** (nuevo) | Nunca llegó a ser cliente. No hay operación que interrumpir ni dinero de por medio |
| Se dio de baja | **Sí** (nuevo) | Lo pidió él. Conserva el acceso a facturación para poder volver |
| Tiene una factura vencida | **No** | Sigue en observación, como acordamos. Encenderlo es la Fase 6 y sigue esperando tu palabra |

Dicho de otro modo: se bloquea a quien nunca empezó o a quien decidió irse.
**A ningún cliente que esté operando y deba dinero.**

---

## 3. Trabajo por fases

### Fase A — Desatascar (medio día, se puede hacer ya)

1. Corregir `current_empresa_id()` (§0).
2. Verificar que `/facturacion/` carga para BATUT, BATUT VIVA y Cartagena.
3. Verificar que el bucket `comprobantes_pago` acepta una subida real.
4. Añadir `SET search_path` a `is_super_admin()`, que hoy no lo tiene: una
   función `SECURITY DEFINER` sin search_path fijado es un riesgo conocido.

**No depende de que apruebes el resto.** Dime y lo hago.

### Fase B — Superadministrador de verdad (1 sesión)

Hoy `system_users` tiene una sola fila y no eres tú.

1. Añadir `andreszamora4life@gmail.com` (uid `aced679b-…`) a `system_users`.
2. **Un detalle que hay que decidir:** ese mismo usuario es hoy `admin_root` de
   BATUT VIVA en `usuarios_sistema`. Funciona —`is_super_admin()` tiene
   prioridad— pero es sucio: mezcla el dueño de la plataforma con un usuario de
   un cliente. Recomiendo dejarlo así de momento y anotarlo, y cuando haya más
   clientes crear un usuario de plataforma separado.
3. Tabla `superadmin_permisos` para ir añadiendo funciones sin tocar código
   cada vez: `ver_cuentas`, `iniciar_prueba`, `desbloquear`, `emitir_factura`,
   `conciliar_pagos`, `cancelar_cuenta`, `purgar_datos`, `impersonar`.
4. Toda acción de superadmin deja rastro en `suscripcion_bitacora`: quién, qué,
   cuándo y sobre quién. Sin excepciones.

### Fase C — El alta (2 sesiones)

**C.1 · Conectar el registro con la facturación.** Hoy no lo está: el RPC
`registrar_empresa_self_service` crea la empresa con `plan='free'` y su usuario,
y nada más. No crea cuenta ni suscripción. Por eso un cliente nuevo hoy vería
«tu empresa todavía no tiene cuenta de facturación».

El RPC pasa a crear, en la misma transacción:

```
empresas          (como hoy)
usuarios_sistema  (como hoy)
cuentas           estado = 'registrada'
                  registrada_en    = hoy
                  activacion_limite = hoy + 30 días
cuenta_empresas   la empresa como sede principal
suscripciones     plan 'pro', mensual, estado 'registrada', sin reloj
aceptaciones_terminos  versión aceptada, fecha, IP
```

**C.2 · La pantalla de registro dice el precio.** Hoy no menciona ni el plan ni
la prueba ni los $59.900. Un alta que no dice lo que cuesta genera bajas y
reclamaciones. Se añade el resumen del plan y el enlace a los términos, con
casilla de aceptación explícita.

**C.3 · El cartel del cliente.** En el panel, mientras la cuenta esté
`registrada`:

> **Activa tu prueba gratuita de 15 días**
> Empieza cuando quieras. Tienes hasta el 24 de septiembre para activarla.
> Después de la prueba: $59.900/mes, con la primera factura prorrateada.
> `[ Activar mi prueba ]`

Con confirmación, porque a partir de ahí corre el reloj. RPC nuevo
`activar_prueba_cliente()`, que solo puede ejecutar el `admin_root` de esa
cuenta y es idempotente.

**C.4 · La ventana de 30 días.** El cron diario que ya existe se encarga:

```
día 20 sin activar   aviso al cliente (le quedan 10 días)
día 27 sin activar   aviso al cliente y a ti
día 30 sin activar   estado = bloqueada_sin_activar, nivel solo_facturacion
```

**C.5 · Desbloqueo.** RPC `desbloquear_cuenta(cuenta_id, dias, motivo)` para el
superadmin, que abre una ventana nueva y deja constancia del motivo.

**C.6 · Primera factura.** Al terminar la prueba, prorrateada hasta fin de mes,
tal como ya funciona (`emitir_factura_cuenta` lo hace: probado, 15 días de
septiembre = $29.950).

### Fase D — La baja (2 sesiones)

**D.1 · Pedirla.** Botón en `/facturacion/`, con motivo (lista + texto libre) y
una pantalla que diga sin ambigüedad qué va a pasar:

> - Conservas acceso a facturación para retomar el plan cuando quieras.
> - Tus datos se guardan **90 días**, hasta el 23 de noviembre de 2026.
> - Pasada esa fecha se borran de forma permanente y no se pueden recuperar.
> - Puedes descargar todo antes: `[ Exportar mis datos ]`

**D.2 · Qué pasa al confirmar.** Nivel `solo_facturacion`; renovación
automática cancelada y fuente de pago borrada en Wompi; sin facturas nuevas;
las pendientes siguen debiéndose; `purgar_desde = hoy + 90 días`.

**D.3 · Exportación.** Obligatoria antes de purgar, y disponible en cualquier
momento. ZIP con CSV por módulo más las facturas en PDF. Es lo que hace
cualquier plataforma seria y lo que evita el reclamo de «me borraron mi
contabilidad».

**D.4 · Retomar.** Un botón. Si aún no se purgó, vuelve a `activa` con todos
sus datos. Si ya se purgó, empieza de cero como cliente nuevo — y hay que
decirlo antes, no después.

**D.5 · La purga.** Aquí está el trabajo de verdad: **41 de las 53 tablas
tienen `empresa_id`**. No se escribe a mano.

- Un catálogo `purga_tablas` generado desde el esquema, revisado una vez.
- `purgar_cuenta(cuenta_id)` recorre el catálogo en orden de dependencias,
  dentro de una transacción, y borra también los objetos de Storage.
- Avisos al cliente **7 días antes** y **1 día antes**.
- Doble confirmación: el cron marca `lista_para_purgar`; la purga solo corre
  con `PURGA_HABILITADA=true`. Un borrado irreversible no debe poder
  dispararlo un error de fecha.
- Ensayo obligatorio en una cuenta interna antes de tocar una real.

**D.6 · Qué NO se borra, y por qué.** Recomiendo conservar
`facturas_suscripcion`, `pagos_suscripcion` y `pasarela_eventos`
**anonimizadas** (sin nombre, NIT ni correo, solo el identificador de cuenta y
los importes). Motivo: son tu propia contabilidad como vendedor, y el artículo
28 del Código de Comercio te obliga a conservar tus libros. Borrar la factura
que te pagaron te deja a ti expuesto, no al cliente. Esto hay que decirlo en
los términos.

### Fase E — Términos y condiciones (1 sesión)

Los actuales son tres párrafos sobre responsabilidad contable. Faltan las
cláusulas que sostienen todo lo anterior:

1. Objeto y descripción del servicio.
2. Precios: $59.900/mes, $30.000 por local adicional del segundo en adelante,
   anual con 20% de descuento. Y cómo se avisan los cambios de precio.
3. Prueba de 15 días y ventana de activación de 30 días.
4. Facturación: corte último día del mes, pago hasta el día 5, cobro vencido.
5. Mora: qué pasa y en qué plazos.
6. Baja: efecto inmediato, retención de 90 días, borrado permanente,
   exportación disponible, y qué se conserva anonimizado.
7. Tratamiento de datos conforme a la **Ley 1581 de 2012** y el Decreto 1377 de
   2013: finalidad, responsable, encargado, y derechos del titular.
8. Disponibilidad y limitación de responsabilidad.
9. Ley aplicable y jurisdicción (Colombia).

Con **versionado**: `terminos_versiones` guarda cada texto con su fecha, y
`aceptaciones_terminos` quién aceptó qué versión y cuándo. Sin eso, un cambio
de términos no es oponible a nadie. Y cuando cambien, aviso previo y
reaceptación al entrar.

> No soy abogado y esto no es asesoría legal. Redacto el borrador completo y
> técnicamente coherente con lo que hace el sistema; conviene que lo revise un
> abogado colombiano antes de publicarlo, sobre todo el apartado 7.

### Fase F — Consola de administración (2 sesiones)

Ampliar `/facturacion/cuentas.html` hasta ser una consola de verdad:

- **Listado** con filtros por estado, buscador, y semáforo de qué necesita
  atención hoy (por activar, por vencer, morosas, por purgar).
- **Ficha de cuenta**: datos, sedes, suscripción, facturas, pagos, bitácora
  completa, y las acciones según permiso: iniciar/extender prueba, desbloquear,
  emitir factura, conciliar un pago, prorrogar, cancelar, exportar.
- **Métricas**: ingreso recurrente mensual, altas y bajas del mes, tasa de
  conversión de prueba a pago, mora, y valor en riesgo.
- **Bandeja de conciliación**: los pagos que llegaron con monto distinto o
  referencia irreconocible, que hoy se guardan bien pero no los ve nadie.

### Fase G — Correos del ciclo de vida (1 sesión)

El proveedor ya está configurado (Resend). Faltan las piezas:

| Momento | Para |
|---|---|
| Bienvenida tras registrarse | Cliente |
| Recordatorio de activar (día 20 y 27) | Cliente |
| Prueba iniciada · quedan 15 días | Cliente |
| Prueba por terminar (día 12) | Cliente |
| Prueba terminada · primera factura | Cliente |
| Cuenta bloqueada por no activar | Cliente y tú |
| Baja confirmada · 90 días | Cliente |
| Purga en 7 días / mañana | Cliente |
| Datos eliminados | Cliente |
| Resumen diario de lo que pasó | Tú |

---

## 4. Orden y dependencias

```
Fase A ──► Fase B ──► Fase C ──► Fase D ──► Fase E ──► Fase F ──► Fase G
desatascar  admin      alta       baja      términos   consola    correos
 (ya)                              │           │
                                   └───────────┘
                                   D y E van juntas: la baja no se
                                   publica sin la cláusula que la respalda
```

La Fase A es independiente y urgente. B y C son lo que te desbloquea para
recibir clientes nuevos sin tocar nada a mano. D y E pueden esperar hasta que
haya un cliente que pueda querer irse — pero **no deben esperar más que eso**,
porque una baja improvisada es donde se pierden los datos de alguien.

Estimación total: **8 o 9 sesiones**, sin contar la revisión legal.

---

## 5. Lo que necesito que decidas

| # | Pregunta | Lo que recomiendo |
|---|---|---|
| 1 | ¿`implementacion` congela la ventana de 30 días? | **Sí.** Es lo que evita el problema de Cartagena |
| 2 | ¿La purga borra facturas y pagos, o se conservan anonimizados? | **Conservarlos.** Es tu obligación contable como vendedor (§D.6) |
| 3 | ¿La exportación es obligatoria antes de purgar? | **Sí**, y disponible siempre |
| 4 | ¿Quién puede pedir la baja? | Solo el `admin_root` de la cuenta, con confirmación por correo |
| 5 | ¿Se puede cancelar con facturas pendientes? | **Sí**, pero la deuda no desaparece y se dice claramente |
| 6 | ¿Tu correo como superadmin sigue siendo también admin de BATUT VIVA? | Sí por ahora; separarlo cuando haya más clientes (§B.2) |
| 7 | ¿Reembolso si se da de baja a mitad de un plan anual? | Hay que decidirlo **antes** de escribir los términos. Lo habitual es no reembolsar y dejar el servicio hasta el fin del periodo pagado |

---

## 6. Riesgos y lo que no haría

- **No pondría la purga automática en marcha sin ensayarla** en una cuenta
  interna y sin la doble confirmación de §D.5. Es la única operación de todo el
  sistema que no tiene vuelta atrás.
- **No publicaría los términos sin revisión de un abogado**, en particular el
  apartado de datos personales. El resto lo puedo dejar coherente y completo.
- **No mezclaría el bloqueo por no activar con el bloqueo por mora.** Son
  decisiones distintas, con consecuencias distintas, y la segunda sigue sin tu
  autorización.
- **No borraría la ventana de 30 días sin avisar tres veces.** Un cliente que
  se registró y se distrajo no es un cliente perdido; uno al que bloqueaste sin
  avisar, sí.
- **No dejaría el arreglo de la Fase A esperando a este plan.** Ahora mismo
  ningún cliente puede ver su facturación, incluido BATUT.

---

## 7. Registro de ejecución (2026-08-25)

Todo lo de abajo está **aplicado en producción** contra `tgkvcvnwwnrlyhbqmhaf`.
Decisiones que tomó Andrés y que cambian el plan original:

| Decisión | Efecto |
|---|---|
| **La purga a 90 días no se implementa todavía** | Se guarda `purgar_desde` y se avisa, pero **no existe ninguna función ni cron que borre nada**. Una cuenta cancelada conserva sus datos indefinidamente |
| **Santiago sigue de superadmin** | Se añadió Andrés junto a él; ambos con permiso `todo` |
| **Su usuario se queda en BATUT VIVA** | Es su empresa de pruebas, no la del cliente. Anotado para separarlo cuando haya más clientes |
| **No hay reembolsos** | Escrito en la cláusula 7 de los términos y respetado por `solicitar_baja()`, que conserva el servicio hasta `cubierto_hasta` |

### 7.1 Fase A — el arreglo que tenía la pantalla caída

`current_empresa_id()` comparaba `otros_usuarios.estado` (booleano) contra el
texto `'activo'`, y PostgreSQL fallaba **al preparar** la función, no al
ejecutar la rama. Corregido a `coalesce(ou.estado, true) = true`.

Verificado impersonando a los dos usuarios de BATUT:

| Usuario | Resultado |
|---|---|
| `gerenciabatut@gmail.com` | Cuenta BATUT · cubierto hasta 2027-05-31 · **279 días** |
| `admbatutviva@gmail.com` | Misma cuenta, **2 sedes** — el multi-tenant funciona desde cualquiera |

De paso, `is_super_admin()` no fijaba `search_path`: una función
`SECURITY DEFINER` sin él puede ser secuestrada. Corregido.

Esto arregla también las políticas del bucket `comprobantes_pago`, que
dependían de la misma función y por eso seguían sin funcionar.

### 7.2 Fase B — superadministradores

Dos, ambos con permiso `todo`:

```
Santiago Zamora   santiagoelchameluco@gmail.com
Andrés Zamora     andreszamora4life@gmail.com
```

Tabla `superadmin_permisos` con permisos finos —`ver_cuentas`,
`iniciar_prueba`, `marcar_implementacion`, `desbloquear`, `emitir_factura`,
`conciliar_pagos`, `cancelar_cuenta`, `reactivar_cuenta`, `purgar_datos`,
`impersonar`— y `exigir_permiso_superadmin()` como guarda de cada RPC de
administración. Toda acción queda en `suscripcion_bitacora`.

### 7.3 Fase C — el alta

**El registro ya crea la cuenta.** `registrar_empresa_self_service` pasa a
crear, en la misma transacción: empresa, usuario, **cuenta** en estado
`registrada` con `activacion_limite = hoy + 30`, `cuenta_empresas`,
`suscripciones` sin reloj y la **aceptación de términos** con su versión.

Además exige la aceptación en el servidor (`EK005`): la casilla del formulario
no basta, porque el RPC es un endpoint público.

**La pantalla de registro dice el precio.** Antes no mencionaba ni el plan ni
la prueba ni los $59.900.

**El botón es del cliente.** `activar_prueba_cliente()` — solo lo puede llamar
el `admin_root` de la cuenta, es idempotente y pone el reloj en marcha en ese
momento. El cartel aparece en `/facturacion/` mientras la cuenta esté
`registrada`.

**`implementacion` congela el reloj.** `marcar_implementacion()` pone
`activacion_limite = NULL`. Es lo que resuelve el caso Cartagena.

**La ventana de 30 días** la vigila `ciclo_vida_diario()`: avisa a 10 y a 3
días, y al vencer pasa la cuenta a `bloqueada_sin_activar`.
`desbloquear_cuenta()` la reabre con plazo nuevo.

### 7.4 Fase D — la baja

`solicitar_baja()` deja la cuenta en `cancelada`, cancela la renovación, suelta
la fuente de pago, calcula `purgar_desde = hoy + 90` y **conserva el servicio
hasta `cubierto_hasta`** porque no hay reembolsos. Las facturas emitidas
siguen siendo exigibles.

`reactivar_cuenta()` devuelve la cuenta al estado que le corresponde con todos
sus datos.

**Exportación:** Edge Function `exportar-datos`, que recoge el ámbito completo
de la cuenta —todas sus sedes— de 24 tablas operativas más las 6 de
facturación. Excluye a propósito `credenciales_plataforma` e
`integraciones_credenciales`: devolver secretos de Loggro en un archivo de
descarga sería un agujero.

> Entregado en JSON, no en ZIP con CSV y PDF como decía el plan. El contenido,
> que es lo que sostiene la cláusula legal, está completo; el empaquetado en
> CSV por módulo queda como mejora.

### 7.5 Fase E — términos y condiciones

14 cláusulas en `terminos_versiones`, versión `2026-08-25`, 8.617 caracteres.
`legal/terminos.html` ya no tiene el texto: lo lee de la base, que es la misma
fila que el cliente acepta al registrarse. Si divergieran, la constancia de
`aceptaciones_terminos` no valdría nada.

**Un matiz de redacción que conviene que veas:** la cláusula 8 dice que AXIOMA
**«podrá eliminar»** los datos pasados 90 días, avisando con 7 días. No dice
que los elimine automáticamente, porque la purga no está implementada.
Prometer un borrado que no ocurre es peor que no prometerlo.

La cláusula 8 también deja escrito que las **facturas y pagos se conservan**
aunque se borre lo demás: son tu contabilidad como vendedor (artículo 28 del
Código de Comercio).

### 7.6 Fase F — consola

`/facturacion/cuentas.html` con métricas arriba (ingreso recurrente, activos,
en prueba, sin activar, bloqueadas, bajas del mes, mora, cobrado, por
conciliar), semáforo por cuenta, ciclo de vida completo, bitácora de los
últimos movimientos y las acciones: marcar implementación, iniciar/extender
prueba, desbloquear, emitir factura, reactivar.

Hoy: **1 cliente activo, $59.900 de ingreso recurrente, 0 en mora.**

### 7.7 Fase G — correos

`cron-facturacion` envía ahora también los del alta: recordatorio de activación
a 10 y 3 días, y aviso de cuenta bloqueada. Se suman a los de factura emitida,
recordatorio de pago y factura vencida.

### 7.8 La guarda: qué bloquea y qué no

Aplicada en **tres capas**, y la que manda es la tercera:

1. `js/router.js` — redirige a `/facturacion/` con el motivo.
2. `/facturacion/` — explica y ofrece la salida (activar, retomar, escribir).
3. **Servidor** — `exigir_acceso_escritura()` en `subir_cierre_turno` y
   `guardar_parametros_nomina`, y `exigirAccesoEscritura()` en las siete Edge
   Functions de escritura.

Probado contra la base real, con `rollback`:

| Caso | Resultado |
|---|---|
| Cliente al día | **Pasa** |
| Cliente **con factura vencida** | **Pasa** — la mora no bloquea, como acordamos |
| Cuenta dada de baja | **Bloqueada**, con mensaje y salida |
| Cuenta sin activar en 30 días | **Bloqueada**, con mensaje y salida |
| Cuenta interna | **Pasa** |

`/facturacion/`, `/legal/`, `/inicio/` y `/contexto_local/` siguen abiertas
siempre: cerrar también esa puerta dejaría al cliente sin forma de volver.

### 7.9 Estado hoy

```
empresas con acceso total     7 de 7      ← nadie bloqueado
superadministradores          2
cuentas                       5
términos vigentes             2026-08-25
facturas abiertas             0
crons activos                 refrescar-token-loggro, billing-enforcer-diario,
                              facturacion-ciclo-diario
RPC nuevos                    12
purga implementada            NO  ← correcto, queda pendiente
```

### 7.10 Archivos

**Migraciones** (todas aplicadas):

```
20260825010000_cv_faseA_desatascar.sql
20260825011000_cv_faseB_superadmin.sql
20260825012000_cv_faseC_estados.sql
20260825013000_cv_faseC_alta.sql
20260825014000_cv_faseD_baja.sql
20260825015000_cv_faseE_terminos.sql
20260825016000_cv_faseF_consola.sql
20260825017000_cv_faseC_guarda_servidor.sql
20260825018000_cv_faseC_guarda_en_rpcs.sql
```

**Edge Functions:** `exportar-datos` (nueva), `cron-facturacion`,
`_shared/tenant.ts`, y las siete de escritura con la guarda.

**Frontend:** `js/router.js`, `js/facturacion.js`, `js/cuentas_facturacion.js`,
`js/registro.js`, `js/terminos.js` (nuevo), `registro/index.html`,
`legal/terminos.html`, `facturacion/cuentas.html`, `css/registro.css`,
`css/facturacion.css`.

### 7.11 Lo que queda pendiente

| Pendiente | Estado |
|---|---|
| **Purga a los 90 días** | Aplazada por ti. Toda la cuenta atrás existe; solo falta el borrado |
| **Corte por mora** (Fase 6 del plan de facturación) | Sigue apagado. `billing_observaciones` acumula evidencia |
| **Cobro recurrente con tarjeta guardada** | Necesita tokenización en el navegador y la cuenta Wompi plenamente habilitada |
| **Export en ZIP con CSV y PDF** | Hoy va en JSON con el contenido completo |
| **Revisión legal de los términos** | Sobre todo la cláusula 9, la de datos personales |
| **Facturación electrónica DIAN** | Sigue siendo decisión tuya de proveedor |

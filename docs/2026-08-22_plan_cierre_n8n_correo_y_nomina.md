# 2026-08-22 · Plan de cierre: apagar n8n, conectar el correo y migrar nómina

Continuación de `2026-08-22_migracion_n8n_edge_functions_fases_a_b_c.md`.
Cubre los tres frentes que quedaron abiertos y responde a las preguntas
concretas del usuario.

---

## 0 · Corrección importante sobre nómina

En el informe anterior escribí que no migré el cálculo de nómina porque «la
fórmula no está documentada». **Eso era incorrecto y cambia el plan entero.**

Al abrir el nodo de cálculo de `Nómina/Nómina_Nuevo.txt` aparece esto, escrito
por el propio autor del flujo:

```
// ❌ ELIMINADO: TODOS los cálculos monetarios
// ❌ ELIMINADO: clasificaciones de tiempo (diurnas/nocturnas/dominicales)
```

El flujo de n8n **no calcula dinero**. Solo consulta la base y devuelve cinco
bloques de datos en bruto: `parametros`, `detalle`, `apoyos`, `resumen_tiempos`
y `totales_generales`, todos ellos horas y contadores.

**La fórmula está en `js/nomina.js`**, 2 463 líneas del frontend: la
clasificación diurna/nocturna/dominical (líneas 364-392), el emparejamiento con
los parámetros por nombre de concepto (líneas 420-423), las deducciones de ley
y el neto a pagar.

**Consecuencia: no necesito que me des ninguna fórmula.** Lo que hay que migrar
es una consulta, no una regla de negocio. El riesgo que yo temía —inventar el
cálculo con el que se paga a la gente— no existe, porque ese cálculo no vive en
n8n y nadie lo va a tocar.

---

## 1 · Respuestas directas

### 1.1 ¿Dónde está la llave maestra? ¿No puedes guardarla en Supabase?

**Ya está en Supabase.** Se guardó en el momento de crearla:

```
supabase secrets list --project-ref tgkvcvnwwnrlyhbqmhaf
  → MASTER_ENCRYPTION_KEY   ✅
  → CRON_SECRET             ✅
  → LOGGRO_API_URL          ✅
```

Es de donde la leen las Edge Functions (`Deno.env.get("MASTER_ENCRYPTION_KEY")`).
No hace falta hacer nada para que el sistema funcione.

El archivo local es **solo una copia de respaldo**, y está en:

```
C:\Users\andre\AppData\Local\Temp\claude\c--Users-andre-Documents-Migraci-n-Google\
   3cb357b4-0f42-42e9-a5eb-7dcd03d8ef72\scratchpad\secretos.env
```

Por qué conviene copiarla igualmente a tu gestor de contraseñas: los secretos de
Supabase **se escriben pero no se leen**. `secrets list` muestra el nombre y un
hash, nunca el valor. Si algún día pierdes el proyecto o necesitas montar un
entorno paralelo que descifre las mismas credenciales, sin esa copia habría que
volver a introducir a mano las credenciales de Loggro de cada empresa.

Además esa carpeta es **temporal**: Windows la puede limpiar. Cópiala hoy.

### 1.2 Módulos que ya están funcionales

Tres niveles distintos. «Funcional» no significa lo mismo en cada uno.

#### ✅ Nivel 1 — Funcionando de punta a punta, con el frontend ya conectado

| Módulo | Detalle |
|---|---|
| **Credenciales de Loggro** | `js/loggro.js` ya llama a `guardar-credenciales` y `consultar-credenciales`. Verificado contra Loggro real con las 4 empresas. |
| **Cierre de turno · consulta de ventas** | `js/cierre_turno.js` ya llama a `consultar-ventas`. Verificado sobre 40 facturas reales, los 6 canales cuadran. |
| **Registro de empleados** | `js/registro_empleados.js` y `js/gestion_usuarios.js` ya llaman a `registro-empleados`. |
| **Refresco de token de Loggro** | Cron cada 4 h. No depende del frontend. Ejecutado 3 veces, 4/4 empresas. |

#### 🟡 Nivel 2 — Backend listo y verificado, pero el frontend sigue llamando a n8n

Funcionan si se les llama, pero **hoy nadie los llama**: el usuario final sigue
pasando por n8n.

| Módulo | Estado |
|---|---|
| `consultar-gastos` | Verificado sobre 30 gastos reales |
| `consultar-inventarios` | Verificado sobre 164 productos reales |
| `consultar-propina-apoyos` | Desplegado, lógica replicada del nodo original |
| `cierre-inventarios-subir` | Desplegado |
| `compras-subir` · `compras-importar` | Desplegado, **sin datos** hasta volcar el Sheet |
| `registro-otros-usuarios` · `registro-local` | Desplegado |
| RPC `subir_cierre_turno` · `historico_cierre_turno` · `guardar_parametros_nomina` | Desplegadas |

#### 🔴 Nivel 3 — Bloqueados

| Módulo | Bloqueo |
|---|---|
| `nomina-enviar-correo` | Falta configurar el proveedor de correo |
| Cálculo de nómina | Falta la RPC de consulta (Fase E) |
| 14 webhooks | No existe el flujo exportado (§4) |

---

## 2 · Fase D · Conectar el correo de la empresa

### 2.1 Por qué no puedo «conectarme» yo desde tu interfaz web

Lo que tiene n8n es una conexión OAuth de Google guardada en su servidor: un
navegador abrió una ventana de consentimiento y n8n conservó el token de
refresco. Una Edge Function no tiene navegador, no tiene sesión y se levanta y
se apaga en cada petición: **no puede sostener ese flujo**.

El correo hay que dárselo como credencial, no como sesión. Hay tres formas.

### 2.2 Las tres opciones

| Opción | Qué necesitas conseguir | Esfuerzo | Recomendada para |
|---|---|---|---|
| **A · SMTP con contraseña de aplicación** | Activar verificación en dos pasos en la cuenta y generar una «contraseña de aplicación» de 16 caracteres | 5 minutos | **Empezar hoy.** Si el correo es Gmail o Google Workspace, esto funciona ya |
| **B · Resend** | Crear cuenta, verificar el dominio `enkrato.com` con 3 registros DNS, copiar la API key | ~1 hora (propagación DNS) | **Destino final.** Mejor entregabilidad, registro de envíos, sin límites bajos |
| **C · Relay propio** | Una URL tuya que reciba `{para, asunto, html, texto, adjuntos}` | Ya tienes el código | Solo si quieres seguir usando n8n **solo** para correo |

El módulo `_shared/correo.ts` ya soporta las tres. Cambiar de una a otra es
cambiar variables de entorno, sin tocar código ni volver a desplegar la lógica.

### 2.3 Límite que importa para nómina

SMTP de Gmail permite unos **500 destinatarios al día** en cuenta personal y
2 000 en Workspace. Si el día de pago envías el PDF de deducciones a toda la
plantilla de las cuatro empresas de golpe, se puede rozar el límite. Resend no
tiene ese techo. Por eso: **A para arrancar, B como destino.**

### 2.4 Qué necesito exactamente de ti

Solo esto:

1. La **dirección exacta** desde la que deben salir los correos
   (p. ej. `no-responder@enkrato.com`).
2. Si eliges **A**: el proveedor (Gmail / Workspace / Outlook / otro) y la
   contraseña de aplicación.
3. Si eliges **B**: la API key de Resend y confirmar que el dominio quedó
   verificado.

No me lo pegues en el chat. Déjalo en un archivo local y te digo el comando, o
ejecuta tú mismo `supabase secrets set` — la sección 8.1 del documento anterior
tiene la línea exacta.

### 2.5 Qué se desbloquea al conectarlo

- `nomina-enviar-correo` (PDF de autorización de descuentos)
- Correo de bienvenida en `registro-empleados`, `registro-otros-usuarios` y
  `registro-local` — hoy el alta funciona pero el correo se omite en silencio
- La prueba de humo: envío real a una dirección tuya antes de tocar nada más

---

## 3 · Fase E · Migrar el módulo de nómina

Ahora que sabemos que no hay fórmula que reconstruir, esto es una consulta.

### 3.1 Lo que hay que construir

Una RPC `consultar_nomina(p_empresa_id, p_empleado_id, p_desde, p_hasta)` que
devuelva **exactamente** la forma que ya consume `js/nomina.js`:

```
Tabla_Parametros.Datos[]  → parametros_nomina + nombre de concepto y de tiempo
Tabla_Datos.Rows[]        → turnos del empleado: fecha_turno, Dia, hora_inicio,
                            hora_fin, Horas, Propinas, responsable_id, sede
Tabla_Apoyos.Datos[]      → apoyos_turno del empleado en el rango
```

Con la rama local / empresa suelta resuelta por `app_es_local()`, igual que en
`subir_cierre_turno()`.

### 3.2 Lo demás de nómina ya no necesita backend

Tras las políticas RLS de la Fase A, estos cuatro flujos se sustituyen por
llamadas directas de `supabase-js` desde el frontend, sin escribir nada nuevo:

| Flujo n8n | Sustituto |
|---|---|
| `nomina_historico_guardar` | `.from("historico_nomina").insert()` |
| `nomina_historico_consultar` | `.from("historico_nomina").select()` |
| `nomina_historico_consultar_vista` | `.from("historico_nomina").select()` |
| `nomina_historico_borrar` | `.from("historico_nomina").delete()` |
| `consultar_concepto_nómina` | `.from("dimensiones_concepto").select()` |
| `consultar_tiempo_nómina` | `.from("dimensiones_tiempo").select()` |

### 3.3 Cómo se valida que el resultado es idéntico

Este es el punto delicado: hay que demostrar que la RPC devuelve lo mismo que
n8n antes de cambiar nada.

1. Elegir 3 empleados con nómina ya liquidada en `historico_nomina`.
2. Llamar al webhook de n8n y a la RPC nueva con los mismos parámetros.
3. Comparar los tres bloques campo a campo con un script.
4. Solo si coinciden al 100 %, cambiar `js/nomina.js`.

**Lo único que necesito de ti aquí:** que n8n siga encendido mientras se hace
esta comparación, y que me confirmes 2 o 3 empleados con datos suficientes en el
rango de fechas.

---

## 4 · Fase F · Reconexión del frontend y el obstáculo real

### 4.1 Lo que apareció al cruzar los datos

El frontend llama a **49 webhooks de n8n**. La carpeta `Flujos N8N/` contiene
**34 rutas**. Faltan **14**, y sin ellas no se puede apagar n8n:

| Webhook sin flujo exportado | Lo usa |
|---|---|
| `verificar_nit_cedula` | `js/contrasena_reset_page.js` — recuperación de contraseña |
| `locales/duplicar_usuarios` | `js/anadir_local_usuario.js` |
| `registrar_credibanco` | `js/credibanco.js` |
| `dashboard` | `js/dashboard.js` |
| `consultar_nomina` | (constante declarada, sin consumidor) |
| `cargar_facturas_correo` | `js/subir_facturas_siigo.js` |
| `subir_factura_siigo` | `js/subir_facturas_siigo.js` |
| `corregir_factura_inconveniente` | `js/subir_facturas_siigo.js` |
| `siigo_proveedores_listar` | `js/proveedores_siigo.js` |
| `siigo_proveedores_registrar` | `js/proveedores_siigo.js` |
| `billing_daily_enforcer` | tarea programada en n8n |
| `crear_ciclos_mensuales` | tarea programada en n8n |
| `notificaciones_pagos` | `js/revision_pagos.js` |
| `verificar_pagos` | facturación |

Son **cinco módulos completos** que no estaban en el alcance original:
**Siigo** (5 webhooks), **facturación y cobros** (4), **Credibanco** (1),
**dashboard** (1) y **recuperación de contraseña** (1).

> **Esto es lo que bloquea «desconectar por completo n8n».** No es trabajo
> pendiente mío: es material que todavía no existe en el repositorio.
>
> **Lo que necesito de ti:** exportar esos 14 flujos desde n8n al mismo formato
> que los otros 37 y dejarlos en `Flujos N8N/`. Con eso puedo estimarlos y
> migrarlos. Sin ellos, apagar n8n rompe Siigo, la facturación, Credibanco, el
> dashboard y la recuperación de contraseña.

### 4.2 Cómo haré la reconexión, cuando toque

No de golpe. **Un módulo por entrega**, y en este orden (de menor a mayor
riesgo si algo falla):

| Orden | Módulo | Archivos | Por qué este orden |
|---|---|---|---|
| 1 | Gastos e inventarios (solo lectura) | `cierre_turno.js`, `cierre_inventarios.js`, `visualizacion_*.js` | Si falla, no se pierde ningún dato: se recarga |
| 2 | Históricos | `historico_cierre_turno.js`, `historico_cierre_inventarios.js` | Solo lectura |
| 3 | Propina de apoyos | `apoyos.js` | Lectura, pero afecta cifras que se guardan después |
| 4 | Subida de cierres | `cierre_turno.js`, `cierre_inventarios.js` | Primera escritura. Se prueba con un turno real de una empresa |
| 5 | Registro de usuarios y locales | `registro_otros_usuarios.js`, `anadir_local.js` | Crea cuentas: un fallo deja usuarios a medias |
| 6 | Nómina | `nomina.js`, `nomina_historico.js`, `parametros_nomina.js` | Lo más delicado: hay dinero |
| 7 | Compras | `compras.js` | Depende de haber volcado el Sheet |

Reglas para cada entrega:

- Se cambia **solo** la constante de `js/webhooks.js` por
  `supabase.functions.invoke(...)` o `supabase.rpc(...)`. Los `id`, `name` y
  etiquetas del DOM no se tocan (regla 2 del proyecto).
- La constante vieja se **comenta**, no se borra, con la fecha y el sustituto.
  Volver atrás es descomentar una línea.
- Tú pruebas ese módulo en el navegador antes de pasar al siguiente.
- Cada entrega, su archivo de parche en `docs/`.

### 4.3 Un detalle técnico que ahorrará un fallo

Hoy el frontend llama a n8n con `fetch(URL, {headers: authHeaders})`. Las Edge
Functions **no** se pueden llamar así sin más: hay que usar
`supabase.functions.invoke(...)`, que adjunta el JWT y la `apikey`
automáticamente. Un `fetch` directo contra la URL de la función devuelve 401
aunque el usuario tenga sesión. Es la causa de fallo más probable de toda la
reconexión.

---

## 5 · Orden propuesto y qué desbloquea cada paso

| Fase | Contenido | Depende de ti | Desbloquea |
|---|---|---|---|
| **D · Correo** | Configurar proveedor, prueba de envío real | Dirección + contraseña de aplicación o API key | `nomina-enviar-correo` y los 3 correos de bienvenida |
| **E · Nómina** | RPC `consultar_nomina` + comparación contra n8n | 2-3 empleados de prueba, n8n encendido | Migrar el módulo de nómina completo |
| **F · Reconexión** | 7 entregas, una por módulo | Probar cada una en el navegador | Que los usuarios dejen de pasar por n8n |
| **G · Los 14 flujos** | Analizar y migrar Siigo, facturación, Credibanco, dashboard, recuperación | **Exportar los 14 flujos a `Flujos N8N/`** | Apagar n8n del todo |
| **H · Apagado** | Desactivar los webhooks uno a uno y observar | — | Fin de n8n |

Las fases D y E son independientes: se pueden hacer en paralelo. F depende de E
solo para su entrega nº 6.

---

## 6 · Resumen de lo que necesito de ti

1. **Correo** — la dirección de envío y, según la opción elegida, la contraseña
   de aplicación o la API key de Resend.
2. **Nómina** — nada de fórmulas. Solo 2 o 3 empleados con nómina ya liquidada
   para comparar, y que n8n siga encendido mientras se compara.
3. **Para apagar n8n del todo** — exportar los **14 flujos** de §4.1 a
   `Flujos N8N/` en el mismo formato que los otros.
4. **Compras** — el volcado de las hojas 1 y 3 de «Automatización Facturas».
5. **Guardar la llave maestra** en tu gestor de contraseñas (ya está en
   Supabase; esto es respaldo).

---

## 7 · Reversión

Este documento no aplica cambios: es plan. Cada fase entregará su parche en
`docs/` con su propia reversión detallada, siguiendo la regla del proyecto.

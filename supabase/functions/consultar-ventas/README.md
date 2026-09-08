# Edge Function · `consultar-ventas`

Consulta de solo lectura contra la API de Loggro. El navegador nunca ve las
credenciales; la función exige un JWT válido de Supabase y resuelve por su
cuenta a qué empresa pertenece quien llama.

---

## 1 · Guardar las credenciales en la nube

Ejecuta esto **una vez**, desde la raíz del repositorio. Sustituye los valores
de ejemplo por los reales de Loggro.

```bash
supabase secrets set \
  LOGGRO_API_URL="https://api.loggro.com/v1" \
  LOGGRO_USUARIO="el-correo-de-la-cuenta-loggro" \
  LOGGRO_PASSWORD="la-contrasena-de-loggro" \
  --project-ref ivgzwgyjyqfunheaesxx
```

Si prefieres enlazar el proyecto primero y ahorrarte `--project-ref` en cada
comando:

```bash
supabase link --project-ref ivgzwgyjyqfunheaesxx
supabase secrets set LOGGRO_API_URL="..." LOGGRO_USUARIO="..." LOGGRO_PASSWORD="..."
```

**No escribas estos comandos en un archivo del repositorio.** Quedan en el
historial de tu terminal; si te preocupa, límpialo después (`history -c`) o usa
la opción de tu shell para no guardar líneas que empiezan por espacio.

### Comprobar qué secretos hay cargados

```bash
supabase secrets list --project-ref ivgzwgyjyqfunheaesxx
```

Muestra los nombres y un hash, nunca los valores.

---

## 2 · Variables de entorno

| Variable | Obligatoria | Por defecto | Para qué |
|---|---|---|---|
| `LOGGRO_API_URL` | **sí** | — | Base de la API de Loggro, sin barra final |
| `LOGGRO_USUARIO` | **sí** | — | Usuario/correo de la cuenta Loggro |
| `LOGGRO_PASSWORD` | **sí** | — | Contraseña de esa cuenta |
| `LOGGRO_API_KEY` | no | — | Si Loggro usa API key permanente, se salta el login |
| `LOGGRO_AUTH_PATH` | no | `/auth/login` | Ruta del login |
| `LOGGRO_VENTAS_PATH` | no | `/ventas` | Ruta de consulta de ventas |
| `LOGGRO_TIMEOUT_MS` | no | `7000` | Corte de la llamada saliente |
| `LOGGRO_DEBUG` | no | `false` | `true` añade el JSON crudo de Loggro a la respuesta |
| `ALLOWED_ORIGINS` | no | — | Orígenes CORS extra, separados por comas |

`SUPABASE_URL` y `SUPABASE_ANON_KEY` **no hay que configurarlas**: Supabase las
inyecta automáticamente en toda Edge Function. De hecho el prefijo `SUPABASE_`
está reservado y `secrets set` lo rechaza.

Las tres rutas van por variable de entorno a propósito: el contrato exacto de
Loggro aún está por confirmar, y así se corrige sin volver a desplegar.

---

## 3 · Desplegar

```bash
supabase functions deploy consultar-ventas --project-ref ivgzwgyjyqfunheaesxx
```

`supabase/config.toml` ya trae `verify_jwt = true`, así que el gateway rechaza
cualquier petición sin JWT válido antes de que el código se ejecute.

Para probar en local:

```bash
supabase start
supabase functions serve consultar-ventas --env-file ./supabase/.env.local
```

Crea `supabase/.env.local` con las mismas variables (y **añádelo a
`.gitignore`** antes de escribir nada dentro).

---

## 4 · Contrato

### Petición

`POST /functions/v1/consultar-ventas`

```
Authorization: Bearer <access_token de Supabase>
Content-Type: application/json
```

```jsonc
{
  "fecha": "2026-08-21",      // obligatorio, AAAA-MM-DD
  "hora_inicio": "12:00",     // opcional, HH:MM
  "hora_fin": "22:00",        // opcional, HH:MM
  "local_id": "..."           // opcional
}
```

La empresa **no se envía**: la deduce la función del JWT. Mandarla desde el
navegador permitiría a un usuario pedir las ventas de otra empresa.

### Respuesta correcta (200)

Las claves son exactamente las que ya lee `js/cierre_turno.js` al pulsar
«Consultar datos», para que esta función pueda sustituir al webhook de n8n sin
tocar el frontend:

```jsonc
{
  "ok": true,
  "efectivo_sistema": 1842500,
  "datafono_sistema": 930000,
  "rappi_sistema": 145000,
  "nequi_sistema": 62000,
  "transferencias_sistema": 210000,
  "bono_regalo_sistema": 0,
  "propina": 88000,
  "consulta": { "fecha": "2026-08-21", "hora_inicio": null, "hora_fin": null,
                "local_id": null, "empresa_id": "..." },
  "message": "Datos consultados."
}
```

### Errores

Siempre `{ ok: false, codigo, message }`. El `message` está redactado para
mostrarse al usuario tal cual.

| Código | HTTP | Cuándo |
|---|---|---|
| `SIN_TOKEN` | 401 | No llegó cabecera `Authorization` |
| `NO_AUTENTICADO` | 401 | JWT inválido o caducado |
| `SIN_CONTEXTO` | 403 | El usuario no tiene fila en `usuarios_sistema` |
| `USUARIO_INACTIVO` | 403 | `usuarios_sistema.activo = false` |
| `FECHA_INVALIDA` / `HORA_INVALIDA` / `JSON_INVALIDO` | 400 | Petición mal formada |
| `CONFIG_INCOMPLETA` | 500 | Faltan secretos de Loggro |
| `LOGGRO_AUTH` / `LOGGRO_NO_AUTORIZADO` | 502 | Loggro rechazó las credenciales |
| `LOGGRO_TIMEOUT` | 504 | Loggro no respondió a tiempo |
| `LOGGRO_ERROR` / `LOGGRO_RESPUESTA_INVALIDA` | 502 | Loggro falló o devolvió algo ininteligible |

---

## 5 · Descubrir los nombres reales de los campos

`normalizarVentas()` acepta varios nombres para cada cifra, igual que ya hace el
frontend. Si aun así llegan ceros, enciende el modo depuración una vez:

```bash
supabase secrets set LOGGRO_DEBUG=true --project-ref ivgzwgyjyqfunheaesxx
```

La respuesta incluirá `_crudo` con el JSON tal cual lo devuelve Loggro. Añade
los nombres correctos a las listas de candidatos en la sección 3 de `index.ts` y
**vuelve a apagarlo**:

```bash
supabase secrets set LOGGRO_DEBUG=false --project-ref ivgzwgyjyqfunheaesxx
```

---

## 6 · Garantía de solo lectura

La única sentencia que la función ejecuta contra Supabase es:

```sql
select id, empresa_id, rol, activo from usuarios_sistema where id = <auth.uid()>
```

No hay `insert`, `update`, `upsert`, `delete` ni `rpc` en el archivo. Además el
cliente se construye con la **clave anónima más el token del usuario**, nunca
con `service_role`: las políticas RLS siguen aplicando, así que aunque alguien
añadiera una escritura por descuido, la base la rechazaría.

---

## 7 · Pendiente de decisión: alcance de las credenciales

Las variables de entorno son **de plataforma**: una sola cuenta de Loggro para
todo Enkrato. Pero `js/loggro.js` guarda hoy usuario y contraseña de Loggro
**por empresa** — cada restaurante mete los suyos en
`configuracion/loggro.html`.

Si cada cliente tiene su propia cuenta de Loggro, un secreto global no sirve
para consultar las ventas de todos. El punto de extensión está aislado en
`obtenerCredenciales(empresaId)`, que ya recibe el `empresaId` aunque hoy no lo
use: cuando se decida, solo hay que cambiar esa función para leer las
credenciales cifradas de la base.

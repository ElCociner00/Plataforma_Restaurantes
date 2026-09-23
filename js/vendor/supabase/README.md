# Librería de Supabase, servida desde nuestro hosting

Estos archivos son la librería `@supabase/supabase-js@2.117.0`, copiada aquí
para que **la plataforma no dependa de un CDN ajeno para arrancar**.

## Por qué

Hasta el 2026-09-22, `js/supabase.js` la importaba de
`https://esm.sh/@supabase/supabase-js@2`. Ese archivo lo importa todo lo demás
—router, sesión, autenticación, cabecera—, así que cualquier red que no
alcanzara `esm.sh` dejaba **toda la plataforma en blanco, cargando para
siempre**. Un cliente se quedó fuera por eso, en todos sus navegadores, y el
resto del mundo entraba sin problema.

No es hipotético: un CDN de terceros caído o bloqueado por un ISP, un firewall
corporativo o un filtro de DNS tumbaba Enkrato entero, y desde nuestro lado no
había nada que hacer.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `supabase-js.bundle.mjs` | La librería completa (222 KB), con todas sus dependencias ya incluidas |
| `node/*.mjs` | Los polirrellenos de Node que el bundle necesita en el navegador (buffer, process, events, tty, async_hooks) |

**Los imports están reescritos a rutas relativas locales.** No queda ni una
sola referencia a `esm.sh`: si aparece alguna, el arreglo está roto.

## Cómo actualizar la versión

1. Mira qué versión sirve esm.sh hoy:
   `curl -s "https://esm.sh/@supabase/supabase-js@2?bundle" | head -1`
2. Descarga el grafo completo y reescribe los imports. El script que se usó
   está en el historial de la conversación del 2026-09-22; en esencia:
   partir de `/@supabase/supabase-js@<version>/es2022/supabase-js.bundle.mjs`,
   seguir recursivamente cada `from "/..."`, guardar cada archivo aquí y
   sustituir esas rutas absolutas por relativas.
3. **Verifica antes de subir.** Tres comprobaciones, en este orden:

   ```bash
   # 1. Que no quede ninguna referencia externa
   grep -rnoE '(from|import)\s*\(?"(https?:|/)[^"]*"' js/vendor/supabase/

   # 2. Que createClient siga exportado
   grep -c 'as createClient' js/vendor/supabase/supabase-js.bundle.mjs

   # 3. Que la app arranque de verdad: levanta el servidor local,
   #    abre /inicio/ y confirma en la pestaña de red que NO hay
   #    peticiones a esm.sh, y que una consulta a Supabase responde.
   python tools/servidor_local.py 5500
   ```

No actualices esto "por estar al día". Es el archivo del que cuelga toda la
plataforma: se toca cuando hay un motivo concreto, y se prueba antes de subir.

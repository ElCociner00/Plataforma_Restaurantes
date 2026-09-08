/**
 * cron-refrescar-token-loggro — renueva los tokens de Loggro que están por
 * caducar, empresa por empresa.
 *
 * Reemplaza `Registro/Reinicio_Credenciales_loggro.txt` (14 nodos con
 * Schedule Trigger). Aquel flujo renovaba TODOS los tokens en cada ejecución
 * porque la tabla no guardaba la caducidad; ahora solo se tocan los que la
 * necesitan, gracias a la columna token_expira_en de la Fase A.
 *
 * No la llama el navegador. Se dispara desde pg_cron o desde el planificador
 * de Supabase, y se protege con un secreto propio en vez de con un JWT de
 * usuario, porque no hay usuario detrás.
 *
 *   Cabecera obligatoria:  x-cron-secret: <CRON_SECRET>
 */

import { json } from "../_shared/cors.ts";
import { clienteServicio } from "../_shared/tenant.ts";
import { iniciarSesion, limpiarCache, PLATAFORMA } from "../_shared/loggro.ts";
import { decryptText } from "../_shared/crypto.ts";

const ETIQUETA = "cron-refrescar-token-loggro";
const URL_API_POR_DEFECTO = "https://api.pirpos.com";

/** Se renueva todo lo que caduque dentro de esta ventana. */
const VENTANA_HORAS = Number(Deno.env.get("LOGGRO_VENTANA_RENOVACION_H") ?? "6");

function llaveMaestra(): string {
  const llave = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY");
  if (!llave || llave.length < 16) throw new Error("MASTER_ENCRYPTION_KEY ausente o demasiado corta");
  return llave;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Sin CORS: esto no se llama desde un navegador.
  const secretoEsperado = Deno.env.get("CRON_SECRET");
  if (!secretoEsperado) {
    console.error(`[${ETIQUETA}] CRON_SECRET no está configurado.`);
    return json({ ok: false, message: "Función no configurada." }, 500, null);
  }
  if (req.headers.get("x-cron-secret") !== secretoEsperado) {
    return json({ ok: false, message: "No autorizado." }, 401, null);
  }

  const admin = clienteServicio();
  const limite = new Date(Date.now() + VENTANA_HORAS * 3600_000).toISOString();

  // Credenciales activas de todas las empresas. Cada una tiene su propio
  // usuario y contraseña: no hay ninguna cuenta compartida.
  const { data: credenciales, error } = await admin
    .from("integraciones_credenciales")
    .select("empresa_id, usuario, password, url_api")
    .eq("plataforma", PLATAFORMA)
    .eq("activo", true);

  if (error) {
    console.error(`[${ETIQUETA}] No se pudieron leer las credenciales:`, error.message);
    return json({ ok: false, message: "Error al leer credenciales." }, 500, null);
  }

  const { data: tokens } = await admin
    .from("credenciales_plataforma")
    .select("empresa_id, token, token_expira_en")
    .eq("plataforma", PLATAFORMA)
    .eq("activo", true);

  const vigenciaPorEmpresa = new Map<string, string | null>(
    (tokens ?? []).map((t) => [String(t.empresa_id), t.token ? t.token_expira_en : null]),
  );

  const resultados: { empresa_id: string; estado: string; detalle?: string }[] = [];

  for (const credencial of credenciales ?? []) {
    const empresaId = String(credencial.empresa_id);
    const expira = vigenciaPorEmpresa.get(empresaId);

    if (expira && expira > limite) {
      resultados.push({ empresa_id: empresaId, estado: "vigente" });
      continue;
    }

    try {
      const password = await decryptText(String(credencial.password ?? ""), llaveMaestra());
      const urlApi = (String(credencial.url_api ?? "").trim() ||
        (Deno.env.get("LOGGRO_API_URL") ?? "").trim() ||
        URL_API_POR_DEFECTO).replace(/\/+$/, "");

      const sesion = await iniciarSesion(empresaId, urlApi, String(credencial.usuario), password);

      // El error del upsert SÍ se comprueba: sin esto la tarea informaba
      // "renovado" mientras el token no llegaba a guardarse, y el fallo solo
      // se notaba al consultar ventas horas después.
      const { error: errorGuardado } = await admin
        .from("credenciales_plataforma")
        .upsert({
          empresa_id: empresaId,
          plataforma: PLATAFORMA,
          token: sesion.token,
          url_plataforma: urlApi,
          activo: true,
          token_expira_en: new Date(sesion.expiraEn).toISOString(),
          token_actualizado_en: new Date().toISOString(),
          ultimo_error: null,
          ...(sesion.tenantId ? { plataforma_tenant_id: sesion.tenantId } : {}),
        }, { onConflict: "empresa_id,plataforma" });

      if (errorGuardado) throw new Error(`no se pudo guardar el token: ${errorGuardado.message}`);

      limpiarCache(empresaId);
      resultados.push({ empresa_id: empresaId, estado: "renovado" });
    } catch (errorEmpresa) {
      const detalle = errorEmpresa instanceof Error ? errorEmpresa.message : "error desconocido";
      console.error(`[${ETIQUETA}] Fallo al renovar ${empresaId}:`, detalle);

      // El error queda visible en Configuración → Loggro para que el
      // administrador de esa empresa sepa que debe revisar sus credenciales.
      await admin.from("credenciales_plataforma")
        .update({ ultimo_error: `Renovación fallida: ${detalle}`.slice(0, 300) })
        .eq("empresa_id", empresaId)
        .eq("plataforma", PLATAFORMA);

      resultados.push({ empresa_id: empresaId, estado: "fallido", detalle });
    }
  }

  const renovados = resultados.filter((r) => r.estado === "renovado").length;
  const fallidos = resultados.filter((r) => r.estado === "fallido").length;

  console.info(
    `[${ETIQUETA}] empresas=${resultados.length} renovados=${renovados} fallidos=${fallidos}`,
  );

  return json({
    ok: true,
    message: `Revisadas ${resultados.length} empresas.`,
    renovados,
    vigentes: resultados.filter((r) => r.estado === "vigente").length,
    fallidos,
    detalle: resultados,
  }, 200, null);
});

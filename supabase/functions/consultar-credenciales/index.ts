/**
 * consultar-credenciales — estado de la integración de una empresa.
 *
 * Devuelve si hay credencial guardada, con qué usuario, si está validada y si
 * el token en caché sigue vigente. NUNCA devuelve la contraseña, ni cifrada.
 *
 * Contrato compatible con js/loggro.js:
 *   POST { plataforma?: "loggro", empresa_id?: string }
 *   →    { ok: true, existe: boolean, usuario?: string, message: string, ... }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { PLATAFORMA } from "../_shared/loggro.ts";

const ETIQUETA = "consultar-credenciales";

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);
    const ctx = await resolverContexto(req, String(cuerpo.empresa_id ?? "") || null);
    exigirAdmin(ctx, "consultar las credenciales de integración");

    const plataforma = String(cuerpo.plataforma ?? PLATAFORMA).trim().toLowerCase();
    const admin = ctx.clienteAdmin();

    const { data: credencial, error } = await admin
      .from("integraciones_credenciales")
      .select("usuario, url_api, activo, validado_en, updated_at")
      .eq("empresa_id", ctx.empresaId)
      .eq("plataforma", plataforma)
      .maybeSingle();

    if (error) {
      console.error(`[${ETIQUETA}] Error al consultar:`, error.message);
      throw errores.baseDeDatos(error.message);
    }

    if (!credencial) {
      return json({
        ok: true,
        existe: false,
        empresa_id: ctx.empresaId,
        plataforma,
        message: "No hay credenciales guardadas.",
      }, 200, origin);
    }

    // Estado del token en caché: le dice al administrador si la integración
    // está realmente viva sin tener que abrir el módulo de cierre de turno.
    const { data: fichaToken } = await admin
      .from("credenciales_plataforma")
      .select("token_expira_en, token_actualizado_en, ultimo_error, plataforma_tenant_id")
      .eq("empresa_id", ctx.empresaId)
      .eq("plataforma", plataforma)
      .eq("activo", true)
      .maybeSingle();

    const expira = fichaToken?.token_expira_en ? Date.parse(fichaToken.token_expira_en) : NaN;
    const tokenVigente = Number.isFinite(expira) && expira > Date.now();

    return json({
      ok: true,
      existe: true,
      // El correo de la integración no es un secreto y el frontend ya lo
      // muestra: es el propio administrador de la empresa quien lo configuró.
      // La contraseña, en cambio, no sale de aquí ni cifrada.
      usuario: credencial.usuario,
      empresa_id: ctx.empresaId,
      plataforma,
      activo: credencial.activo !== false,
      url_api: credencial.url_api ?? null,
      validado_en: credencial.validado_en ?? null,
      actualizado_en: credencial.updated_at ?? null,
      token_vigente: tokenVigente,
      token_expira_en: fichaToken?.token_expira_en ?? null,
      tenant_id: fichaToken?.plataforma_tenant_id ?? null,
      ultimo_error: fichaToken?.ultimo_error ?? null,
      message: "Credenciales encontradas.",
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

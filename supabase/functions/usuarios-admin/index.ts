/**
 * usuarios-admin — consultas administrativas seguras para el panel de usuarios.
 *
 * La service_role permanece exclusivamente en Supabase. El navegador aporta su
 * JWT normal y esta funcion valida rol y alcance antes de devolver solo los
 * correos pertenecientes a la empresa efectiva.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import {
  type Contexto,
  exigirAdmin,
  resolverContexto,
} from "../_shared/tenant.ts";
import type { SupabaseClient, User } from "jsr:@supabase/supabase-js@2";

const ETIQUETA = "usuarios-admin";
const POR_PAGINA = 1000;
const MAX_PAGINAS = 100;

function texto(valor: unknown): string {
  return typeof valor === "string"
    ? valor.trim()
    : (valor == null ? "" : String(valor).trim());
}

type UsuarioLocal = { id: string; usuario_principal_id: string | null };

async function idsDelAlcance(ctx: Contexto): Promise<{
  ids: Set<string>;
  aliases: UsuarioLocal[];
}> {
  const admin = ctx.clienteAdmin();
  const empresaBase = ctx.esLocal && ctx.grupoId ? ctx.grupoId : ctx.empresaId;

  const consultas = await Promise.all([
    admin.from("usuarios_sistema").select("id").eq("empresa_id", empresaBase),
    admin.from("otros_usuarios").select("id").eq("empresa_id", empresaBase),
    ctx.esLocal
      ? admin.from("usuarios_locales")
        .select("id, usuario_principal_id")
        .eq("empresa_id", ctx.empresaId)
      : Promise.resolve({ data: [] as UsuarioLocal[], error: null }),
  ]);

  for (const consulta of consultas) {
    if (consulta.error) throw errores.baseDeDatos(consulta.error.message);
  }

  const aliases = (consultas[2].data ?? []) as UsuarioLocal[];
  const ids = new Set<string>();
  for (const consulta of consultas.slice(0, 2)) {
    for (const fila of consulta.data ?? []) {
      const id = texto((fila as { id?: unknown }).id);
      if (id) ids.add(id);
    }
  }
  for (const fila of aliases) {
    const id = texto(fila.id);
    const principal = texto(fila.usuario_principal_id);
    if (id) ids.add(id);
    if (principal) ids.add(principal);
  }

  return { ids, aliases };
}

async function correosAuth(
  admin: SupabaseClient,
  ids: Set<string>,
): Promise<Map<string, string>> {
  const pendientes = new Set(ids);
  const correos = new Map<string, string>();

  for (let page = 1; page <= MAX_PAGINAS && pendientes.size; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: POR_PAGINA,
    });
    if (error) throw errores.baseDeDatos(error.message);

    const usuarios = (data?.users ?? []) as User[];
    for (const usuario of usuarios) {
      if (!pendientes.has(usuario.id)) continue;
      correos.set(usuario.id, texto(usuario.email).toLowerCase());
      pendientes.delete(usuario.id);
    }
    if (usuarios.length < POR_PAGINA) break;
  }

  return correos;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();
    const cuerpo = await leerCuerpo(req);
    const action = texto(cuerpo.action) || "listar_emails";
    if (action !== "listar_emails") throw errores.datosIncompletos("action");

    const ctx = await resolverContexto(req, texto(cuerpo.empresa_id) || null);
    exigirAdmin(ctx, "consultar usuarios");

    const { ids, aliases } = await idsDelAlcance(ctx);
    const correos = await correosAuth(ctx.clienteAdmin(), ids);

    const resultado = new Map<string, string>();
    for (const id of ids) {
      const email = correos.get(id);
      if (email) resultado.set(id, email);
    }
    for (const alias of aliases) {
      const id = texto(alias.id);
      const principal = texto(alias.usuario_principal_id);
      const email = correos.get(id) || correos.get(principal);
      if (id && email) resultado.set(id, email);
    }

    return json(
      {
        ok: true,
        empresa_id: ctx.empresaId,
        usuarios: [...resultado].map(([id, email]) => ({ id, email })),
      },
      200,
      origin,
    );
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

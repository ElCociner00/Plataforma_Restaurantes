/**
 * Resolución de contexto multi-tenant.
 *
 * Esta es la pieza que colapsa la duplicación de los flujos n8n. Allí, cada
 * flujo estaba clonado a mano para dos ejes independientes:
 *
 *   Eje 1 · ¿superadmin?  → nodo `Get a row (system_users)` + `If`
 *           system_users NO tiene empresa_id: es la lista blanca de
 *           superadministradores de plataforma. Si el llamante está ahí, y solo
 *           entonces, se acepta la empresa que venga en el cuerpo.
 *
 *   Eje 2 · ¿local o empresa suelta? → nodo `Get a row (grupos_empresariales)`
 *           En grupos_empresariales, empresa_id es el LOCAL y grupo_id es la
 *           empresa MADRE. Según el caso, los datos viven en las tablas base
 *           o en sus gemelas `_locales`.
 *
 * Aquí se resuelven una sola vez y el resto del código deja de estar duplicado.
 *
 * INVARIANTE DE SEGURIDAD: la empresa jamás se toma del cuerpo de la petición
 * salvo que el llamante sea superadmin, y aun así se valida contra el alcance.
 */

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ErrorFuncion, errores } from "./errores.ts";

export type TablasTenant = {
  cierres: "cierres_turno_final" | "cierres_turno_final_locales";
  apoyos: "apoyos_turno" | "apoyos_turno_locales";
  turnos: "turnos_agrupados" | "turnos_agrupados_locales";
  usuarios: "usuarios_sistema" | "usuarios_locales";
};

export type Contexto = {
  /** id del usuario en auth.users */
  authUserId: string;
  correo: string;
  /** empresa efectiva sobre la que opera esta petición */
  empresaId: string;
  /** empresa a la que pertenece la cuenta (sin suplantación de superadmin) */
  empresaPropiaId: string | null;
  rol: string;
  esSuperadmin: boolean;
  esAdmin: boolean;
  /** true si empresaId es un local dentro de un grupo empresarial */
  esLocal: boolean;
  /** empresa madre cuando esLocal; null en caso contrario */
  grupoId: string | null;
  /** todas las empresas que este usuario puede tocar */
  empresasVisibles: string[];
  /** nombres de tabla ya resueltos según esLocal */
  t: TablasTenant;
  /** cliente con el JWT del usuario: el RLS sigue aplicando */
  clienteUsuario: SupabaseClient;
  /** cliente con service_role. Solo para lo que RLS no puede hacer. */
  clienteAdmin: () => SupabaseClient;
};

export function clienteConJwt(authHeader: string): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw errores.configuracion("SUPABASE_URL / SUPABASE_ANON_KEY");

  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function clienteServicio(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw errores.configuracion("SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Extrae y valida la cabecera Authorization. */
export function cabeceraAuth(req: Request): string {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) throw errores.sinToken();
  return authHeader;
}

const ROLES_ADMIN = ["admin_root", "admin"];

/**
 * Resuelve el contexto completo de la petición.
 *
 * @param empresaSolicitada  empresa que pide el cuerpo. Se ignora salvo superadmin.
 */
export async function resolverContexto(
  req: Request,
  empresaSolicitada?: string | null,
): Promise<Contexto> {
  const authHeader = cabeceraAuth(req);
  const clienteUsuario = clienteConJwt(authHeader);

  const { data: auth, error: authError } = await clienteUsuario.auth.getUser();
  if (authError || !auth?.user) throw errores.noAutenticado();

  const authUserId = auth.user.id;
  const correo = auth.user.email ?? "";

  // --- Eje 1: superadmin ------------------------------------------------
  // Se consulta con service_role porque system_users tiene RLS y un usuario
  // normal no puede ni comprobar su propia ausencia de la lista.
  const admin = clienteServicio();

  const { data: filaSuper } = await admin
    .from("system_users")
    .select("id")
    .eq("id", authUserId)
    .maybeSingle();

  const esSuperadmin = Boolean(filaSuper);

  // --- Empresa propia ---------------------------------------------------
  const { data: filaUsuario } = await admin
    .from("usuarios_sistema")
    .select("empresa_id, rol, activo")
    .eq("id", authUserId)
    .maybeSingle();

  if (!esSuperadmin && !filaUsuario) throw errores.sinContexto();
  if (filaUsuario && filaUsuario.activo === false) {
    throw new ErrorFuncion("CUENTA_INACTIVA", "Tu cuenta está desactivada.", 403);
  }

  const empresaPropiaId = filaUsuario ? String(filaUsuario.empresa_id) : null;
  const rol = String(filaUsuario?.rol ?? (esSuperadmin ? "superadmin" : ""));
  const esAdmin = esSuperadmin || ROLES_ADMIN.includes(rol.toLowerCase());

  // --- Alcance ----------------------------------------------------------
  const empresasVisibles = await calcularEmpresasVisibles(
    admin,
    esSuperadmin,
    empresaPropiaId,
  );

  // --- Empresa efectiva -------------------------------------------------
  // El cuerpo solo manda si el llamante es superadmin. Para todos los demás
  // se ignora en silencio: es exactamente el punto donde un cliente malicioso
  // intentaría leer datos de otra empresa.
  let empresaId = empresaPropiaId;
  const pedida = (empresaSolicitada ?? "").trim();

  if (pedida) {
    if (esSuperadmin) {
      empresaId = pedida;
    } else if (pedida !== empresaPropiaId) {
      // Un usuario de grupo sí puede operar sobre otra empresa de su alcance
      // (una madre sobre sus locales), pero nunca fuera de él.
      if (!empresasVisibles.includes(pedida)) throw errores.fueraDeAlcance();
      empresaId = pedida;
    }
  }

  if (!empresaId) throw errores.sinContexto();
  if (!esSuperadmin && !empresasVisibles.includes(empresaId)) throw errores.fueraDeAlcance();

  // --- Eje 2: local vs empresa suelta -----------------------------------
  const { data: filaGrupo } = await admin
    .from("grupos_empresariales")
    .select("grupo_id, activo")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  const esLocal = Boolean(filaGrupo && filaGrupo.activo !== false);
  const grupoId = esLocal ? String(filaGrupo!.grupo_id) : null;

  return {
    authUserId,
    correo,
    empresaId,
    empresaPropiaId,
    rol,
    esSuperadmin,
    esAdmin,
    esLocal,
    grupoId,
    empresasVisibles,
    t: tablasPara(esLocal),
    clienteUsuario,
    clienteAdmin: clienteServicio,
  };
}

export function tablasPara(esLocal: boolean): TablasTenant {
  return esLocal
    ? {
      cierres: "cierres_turno_final_locales",
      apoyos: "apoyos_turno_locales",
      turnos: "turnos_agrupados_locales",
      usuarios: "usuarios_locales",
    }
    : {
      cierres: "cierres_turno_final",
      apoyos: "apoyos_turno",
      turnos: "turnos_agrupados",
      usuarios: "usuarios_sistema",
    };
}

/**
 * Empresas que el usuario puede tocar.
 *   superadmin → todas
 *   local      → él mismo + su madre + sus hermanos
 *   madre      → ella misma + sus locales
 *   suelta     → solo ella
 *
 * Réplica exacta de public.app_empresas_visibles(), para que la comprobación
 * en TypeScript y la de las políticas RLS nunca se contradigan.
 */
async function calcularEmpresasVisibles(
  admin: SupabaseClient,
  esSuperadmin: boolean,
  empresaPropiaId: string | null,
): Promise<string[]> {
  if (esSuperadmin) {
    const { data } = await admin.from("empresas").select("id");
    return (data ?? []).map((f: { id: string }) => String(f.id));
  }

  if (!empresaPropiaId) return [];

  const visibles = new Set<string>([empresaPropiaId]);

  const { data: comoLocal } = await admin
    .from("grupos_empresariales")
    .select("grupo_id")
    .eq("empresa_id", empresaPropiaId)
    .maybeSingle();

  if (comoLocal?.grupo_id) {
    const grupo = String(comoLocal.grupo_id);
    visibles.add(grupo);
    const { data: hermanos } = await admin
      .from("grupos_empresariales")
      .select("empresa_id")
      .eq("grupo_id", grupo);
    for (const fila of hermanos ?? []) visibles.add(String(fila.empresa_id));
    return [...visibles];
  }

  const { data: locales } = await admin
    .from("grupos_empresariales")
    .select("empresa_id")
    .eq("grupo_id", empresaPropiaId);
  for (const fila of locales ?? []) visibles.add(String(fila.empresa_id));

  return [...visibles];
}

/** Corta la petición si el usuario no es administrador. */
export function exigirAdmin(ctx: Contexto, accion = "realizar esta acción"): void {
  if (!ctx.esAdmin) throw errores.sinPermisos(accion);
}

/**
 * Guarda de ciclo de vida para las funciones que ESCRIBEN.
 *
 * Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §2.3
 *
 * Es la misma decisión que aplica exigir_acceso_escritura() en los RPC de la
 * base, para que dé igual por dónde entre la escritura. Lo que corta:
 *
 *   SÍ  cuentas que nunca activaron su prueba dentro de los 30 días
 *   SÍ  cuentas dadas de baja por el propio cliente
 *   NO  cuentas con facturas vencidas — la mora no bloquea, sigue en
 *       observación hasta que se autorice explícitamente
 *
 * Toda esa lógica vive en acceso_de_empresa(); aquí solo se consulta.
 */
export async function exigirAccesoEscritura(ctx: Contexto): Promise<void> {
  // Un superadministrador de la plataforma nunca queda fuera.
  if (ctx.esSuperadmin) return;

  const { data, error } = await ctx.clienteAdmin()
    .rpc("acceso_de_empresa", { p_empresa_id: ctx.empresaId });

  if (error) {
    // Si no se puede comprobar, se deja pasar: preferimos un registro de más
    // a bloquear a un cliente al día por un fallo nuestro.
    console.warn("[tenant] acceso_de_empresa no disponible:", error.message);
    return;
  }

  const acceso = data as { nivel?: string; mensaje?: string } | null;
  if (!acceso || acceso.nivel === "total") return;

  throw new ErrorFuncion(
    "CUENTA_SIN_ACCESO",
    acceso.mensaje ?? "Tu cuenta no permite registrar información en este momento.",
    403,
  );
}

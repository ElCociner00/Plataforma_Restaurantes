/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/session.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizeRole` (línea aprox. 7): Bloque funcional del módulo.
 * - `sanitizePermisos` (línea aprox. 11): Gestiona políticas de acceso/permisos.
 * - `mapContextPayload` (línea aprox. 16): Bloque funcional del módulo.
 * - `ensureAuthCacheInvalidation` (línea aprox. 37): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { supabase } from "./supabase.js";
import { getCurrentUser } from "./auth.js";

let cachedContext = null;
let authListenerInitialized = false;

const ACTIVE_LOCAL_CONTEXT_KEY = "plataforma_active_local_context_v1";

function readActiveLocalSelection() {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ACTIVE_LOCAL_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const empresaId = String(parsed?.empresa_id || "").trim();
    const grupoId = String(parsed?.grupo_id || "").trim();
    if (!empresaId || !grupoId) return null;
    return { empresa_id: empresaId, grupo_id: grupoId };
  } catch (_error) {
    return null;
  }
}

function writeActiveLocalSelection(selection) {
  if (typeof localStorage === "undefined") return;
  try {
    if (!selection?.empresa_id || !selection?.grupo_id) {
      localStorage.removeItem(ACTIVE_LOCAL_CONTEXT_KEY);
      return;
    }
    localStorage.setItem(ACTIVE_LOCAL_CONTEXT_KEY, JSON.stringify({
      empresa_id: selection.empresa_id,
      grupo_id: selection.grupo_id,
      updated_at: new Date().toISOString()
    }));
  } catch (_error) {
    // noop: si storage falla, se conserva el contexto base sin romper la app.
  }
}

export function clearActiveLocalContext() {
  writeActiveLocalSelection(null);
  cachedContext = null;
}

function normalizeRole(value) {
  return String(value || "operativo").trim().toLowerCase() || "operativo";
}

function sanitizePermisos(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function mapContextPayload(data, fallbackUser) {
  const userId = data?.user?.id || fallbackUser?.id || null;
  const email = data?.user?.email || fallbackUser?.email || null;
  const rol = normalizeRole(data?.rol);
  const usuarioActivo = data?.activo !== false && data?.estado !== false;

  return {
    user: {
      id: userId,
      email,
      user_id: userId,
      auth_user_id: fallbackUser?.id || userId
    },
    auth_user_id: fallbackUser?.id || userId,
    usuario_principal_id: data?.usuario_principal_id || fallbackUser?.id || userId,
    empresa_principal_id: data?.empresa_principal_id || data?.grupo_id || data?.empresa_id || null,
    empresa_id: data?.empresa_id || null,
    rol,
    nombre: data?.nombre || email || "Usuario",
    plan: String(data?.plan || "free").trim().toLowerCase() || "free",
    activa: data?.activa !== false,
    permisos: sanitizePermisos(data?.permisos),
    super_admin: rol === "admin_root",
    usuario_activo: usuarioActivo
  };
}

function ensureAuthCacheInvalidation() {
  if (authListenerInitialized) return;
  authListenerInitialized = true;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") {
      clearActiveLocalContext();
    }
  });
}

async function getContextFromRpc() {
  const { data, error } = await supabase.rpc("get_my_context");
  if (error) {
    console.warn("⚠️ RPC get_my_context no disponible, se intentará fallback por tablas:", error.message || error);
    return null;
  }

  return (data && typeof data === "object" && !Array.isArray(data))
    ? data
    : (Array.isArray(data) ? data[0] : null);
}

async function getContextFromTables(user) {
  const { data: usuarioSistema, error: usuarioError } = await supabase
    .from("usuarios_sistema")
    .select("id, empresa_id, nombre_completo, rol, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (usuarioError || !usuarioSistema) {
    const email = String(user?.email || "").trim().toLowerCase();
    const filters = [`id.eq.${user.id}`];
    if (email) filters.push(`correo.eq.${email}`);

    for (const tableName of ["system_users", "system_user"]) {
      const { data: systemUser, error: systemError } = await supabase
        .from(tableName)
        .select("id, nombre, correo")
        .or(filters.join(","))
        .maybeSingle();

      if (!systemError && systemUser) {
        return {
          user: {
            id: user.id,
            email: user.email,
            user_id: user.id
          },
          empresa_id: null,
          rol: "admin_root",
          nombre: systemUser.nombre || user.email || "Superadmin",
          plan: "enterprise",
          activa: true,
          permisos: {},
          super_admin: true,
          usuario_activo: true
        };
      }
    }

    console.error("No se pudo resolver usuarios_sistema para el usuario actual:", usuarioError);
    return null;
  }

  const { data: empresa, error: empresaError } = await supabase
    .from("empresas")
    .select("id, plan, plan_actual, activa, activo")
    .eq("id", usuarioSistema.empresa_id)
    .maybeSingle();

  if (empresaError) {
    console.error("No se pudo resolver empresa asociada al usuario:", empresaError);
    return null;
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      user_id: user.id
    },
    empresa_id: usuarioSistema.empresa_id || null,
    rol: usuarioSistema.rol || "operativo",
    nombre: usuarioSistema.nombre_completo || user.email || "Usuario",
    plan: empresa?.plan || empresa?.plan_actual || "free",
    activa: empresa?.activa !== false && empresa?.activo !== false,
    permisos: {},
    super_admin: String(usuarioSistema.rol || "").trim().toLowerCase() === "admin_root",
    activo: usuarioSistema.activo !== false,
    usuario_activo: usuarioSistema.activo !== false
  };
}

async function loadEmpresaForContext(empresaId) {
  if (!empresaId) return null;

  const { data, error } = await supabase
    .from("empresas")
    .select("id, plan, plan_actual, activa, activo, nombre_comercial, razon_social")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    console.error("No se pudo resolver empresa para contexto:", error);
    return null;
  }

  return data || null;
}

async function applyLocalContextOverride(baseContext, authUser) {
  const selection = readActiveLocalSelection();
  if (!selection || !baseContext?.empresa_id || !authUser?.id) return baseContext;

  const principalEmpresaId = baseContext.empresa_principal_id || baseContext.empresa_id;
  if (selection.empresa_id === principalEmpresaId) {
    clearActiveLocalContext();
    return baseContext;
  }

  try {
    const { data: grupo, error: grupoError } = await supabase
      .from("grupos_empresariales")
      .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
      .eq("empresa_id", selection.empresa_id)
      .eq("grupo_id", principalEmpresaId)
      .maybeSingle();

    if (grupoError || !grupo || grupo.activo === false) {
      console.warn("[session] Local seleccionado no pertenece al grupo activo o está inactivo. Se vuelve al contexto principal.", grupoError);
      clearActiveLocalContext();
      return baseContext;
    }

    const isAdminRoot = baseContext.rol === "admin_root" || baseContext.super_admin === true;
    let usuarioLocal = null;

    if (!isAdminRoot) {
      const { data, error: usuarioLocalError } = await supabase
        .from("usuarios_locales")
        .select("id, usuario_principal_id, empresa_id, nombre_completo, rol, activo")
        .eq("usuario_principal_id", authUser.id)
        .eq("empresa_id", selection.empresa_id)
        .maybeSingle();

      if (usuarioLocalError || !data || data.activo === false) {
        console.warn("[session] No existe usuario local activo para el local seleccionado. Se vuelve al contexto principal.", usuarioLocalError);
        clearActiveLocalContext();
        return baseContext;
      }

      usuarioLocal = data;
    }

    const empresa = await loadEmpresaForContext(selection.empresa_id);
    if (!empresa) {
      clearActiveLocalContext();
      return baseContext;
    }

    const contextualUserId = isAdminRoot ? authUser.id : usuarioLocal.id;
    const rol = normalizeRole(isAdminRoot ? baseContext.rol : (usuarioLocal.rol || baseContext.rol));

    return {
      ...baseContext,
      user: {
        ...baseContext.user,
        id: contextualUserId,
        user_id: contextualUserId,
        auth_user_id: authUser.id
      },
      auth_user_id: authUser.id,
      usuario_principal_id: usuarioLocal?.usuario_principal_id || authUser.id,
      usuario_local_id: usuarioLocal?.id || null,
      empresa_principal_id: principalEmpresaId,
      empresa_id: selection.empresa_id,
      nombre: usuarioLocal?.nombre_completo || baseContext.nombre,
      rol,
      plan: String(empresa.plan || empresa.plan_actual || grupo.plan_grupo || baseContext.plan || "free").trim().toLowerCase() || "free",
      activa: empresa.activa !== false && empresa.activo !== false,
      permisos: {},
      super_admin: rol === "admin_root",
      usuario_activo: isAdminRoot || usuarioLocal?.activo !== false,
      local_context: true,
      nombre_grupo: grupo.nombre_grupo || ""
    };
  } catch (error) {
    console.error("[session] Error aplicando contexto de local. Se vuelve al contexto principal:", error);
    clearActiveLocalContext();
    return baseContext;
  }
}

export async function listAvailableLocalContexts() {
  const context = await getUserContext();
  if (!context?.empresa_id) return [];

  const principalEmpresaId = context.empresa_principal_id || context.empresa_id;
  const principalUserId = context.usuario_principal_id || context.auth_user_id || context.user?.auth_user_id || context.user?.id;
  const isAdminRoot = context.rol === "admin_root" || context.super_admin === true;
  if (!principalEmpresaId || !principalUserId) return [];

  const { data: grupos, error: gruposError } = await supabase
    .from("grupos_empresariales")
    .select("empresa_id, grupo_id, nombre_grupo, razon_social_grupo, plan_grupo, activo")
    .eq("grupo_id", principalEmpresaId)
    .eq("activo", true);

  if (gruposError) {
    console.warn("[session] No se pudieron consultar locales del grupo:", gruposError);
    return [];
  }

  const localEmpresaIds = [...new Set((grupos || []).map((row) => row?.empresa_id).filter(Boolean))];
  let usuariosLocales = [];

  if (!isAdminRoot && localEmpresaIds.length) {
    const { data, error } = await supabase
      .from("usuarios_locales")
      .select("id, usuario_principal_id, empresa_id, nombre_completo, rol, activo")
      .eq("usuario_principal_id", principalUserId)
      .in("empresa_id", localEmpresaIds)
      .eq("activo", true);

    if (error) {
      console.warn("[session] No se pudieron consultar usuarios locales disponibles:", error);
    } else {
      usuariosLocales = data || [];
    }
  }

  const visibleEmpresaIds = [
    principalEmpresaId,
    ...(isAdminRoot ? localEmpresaIds : usuariosLocales.map((row) => row.empresa_id).filter(Boolean))
  ];
  let empresas = [];
  if (visibleEmpresaIds.length) {
    const { data, error } = await supabase
      .from("empresas")
      .select("id, nombre_comercial, razon_social")
      .in("id", [...new Set(visibleEmpresaIds)]);
    if (!error) empresas = data || [];
  }

  const empresaById = new Map(empresas.map((empresa) => [empresa.id, empresa]));
  const grupoByEmpresaId = new Map((grupos || []).map((grupo) => [grupo.empresa_id, grupo]));
  const labelForEmpresa = (empresaId, fallback = "") => {
    const empresa = empresaById.get(empresaId);
    return String(empresa?.nombre_comercial || empresa?.razon_social || fallback || empresaId).trim();
  };

  const locales = [{
    empresa_id: principalEmpresaId,
    usuario_id: principalUserId,
    nombre: labelForEmpresa(principalEmpresaId, "Empresa principal"),
    tipo: "principal",
    activo: context.empresa_id === principalEmpresaId && !context.local_context
  }];

  const localRowsForMenu = isAdminRoot
    ? (grupos || []).map((grupo) => ({
        empresa_id: grupo.empresa_id,
        id: principalUserId,
        rol: context.rol,
        grupo
      }))
    : usuariosLocales.map((usuarioLocal) => ({
        ...usuarioLocal,
        grupo: grupoByEmpresaId.get(usuarioLocal.empresa_id)
      }));

  localRowsForMenu.forEach((localRow) => {
    const grupo = localRow.grupo || grupoByEmpresaId.get(localRow.empresa_id);
    locales.push({
      empresa_id: localRow.empresa_id,
      usuario_id: localRow.id,
      nombre: labelForEmpresa(localRow.empresa_id, grupo?.nombre_grupo || "Local"),
      tipo: "local",
      rol: localRow.rol || "",
      activo: context.empresa_id === localRow.empresa_id,
      grupo_id: principalEmpresaId
    });
  });

  return locales;
}

export async function switchLocalContext(empresaId) {
  const context = await getUserContext();
  if (!context?.empresa_id) throw new Error("No se pudo resolver el contexto actual.");

  const principalEmpresaId = context.empresa_principal_id || context.empresa_id;
  const targetEmpresaId = String(empresaId || "").trim();
  if (!targetEmpresaId) throw new Error("Local inválido.");

  if (targetEmpresaId === principalEmpresaId) {
    clearActiveLocalContext();
    return { empresa_id: principalEmpresaId, tipo: "principal" };
  }

  const principalUserId = context.usuario_principal_id || context.auth_user_id || context.user?.auth_user_id || context.user?.id;
  const isAdminRoot = context.rol === "admin_root" || context.super_admin === true;
  const { data: grupo, error: grupoError } = await supabase
    .from("grupos_empresariales")
    .select("empresa_id, grupo_id, activo")
    .eq("empresa_id", targetEmpresaId)
    .eq("grupo_id", principalEmpresaId)
    .eq("activo", true)
    .maybeSingle();

  if (grupoError || !grupo) throw new Error("El local seleccionado no está activo o no pertenece a esta empresa principal.");

  let usuarioLocal = null;

  if (!isAdminRoot) {
    const { data, error: usuarioLocalError } = await supabase
      .from("usuarios_locales")
      .select("id, empresa_id, activo")
      .eq("usuario_principal_id", principalUserId)
      .eq("empresa_id", targetEmpresaId)
      .eq("activo", true)
      .maybeSingle();

    if (usuarioLocalError || !data) throw new Error("Tu usuario no tiene duplicado activo para ese local.");
    usuarioLocal = data;
  }

  writeActiveLocalSelection({ empresa_id: targetEmpresaId, grupo_id: principalEmpresaId });
  cachedContext = null;
  return { empresa_id: targetEmpresaId, usuario_id: usuarioLocal?.id || principalUserId, tipo: "local" };
}

async function resolveAccessToken() {
  const { data } = await supabase.auth.getSession();
  const sessionToken = data?.session?.access_token;
  if (sessionToken) return sessionToken;

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return refreshed?.session?.access_token || null;
}

export async function getUserContext() {
  ensureAuthCacheInvalidation();

  if (cachedContext) return cachedContext;

  const user = await getCurrentUser();
  if (!user) {
    cachedContext = null;
    return null;
  }

  const payload = await getContextFromRpc();
  const fallbackPayload = payload || await getContextFromTables(user);
  if (!fallbackPayload) return null;

  const baseContext = mapContextPayload(fallbackPayload, user);
  const context = await applyLocalContextOverride(baseContext, user);
  if (context?.usuario_activo === false) {
    await supabase.auth.signOut().catch(() => {});
    cachedContext = null;
    return null;
  }
  cachedContext = context;

  console.log(`✅ Contexto cargado: ${context.empresa_id || "sin_empresa"} | Plan: ${context.plan} | Rol: ${context.rol}`);
  return context;
}

export async function getCurrentEmpresaId() {
  const context = await getUserContext();
  return context?.empresa_id || null;
}

export function clearUserContextCache() {
  cachedContext = null;
}

export async function obtenerUsuarioActual() {
  const context = await getUserContext();
  return context?.user || null;
}

async function loadEmpresaById(empresaId) {
  if (!empresaId) return null;

  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social, nit, plan, plan_actual, activo, activa, mostrar_anuncio_impago, deuda_actual, correo_empresa")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) {
    console.error("No se pudo cargar la empresa activa:", error);
    return null;
  }

  return data || null;
}

export async function getSessionConEmpresa() {
  const user = await getCurrentUser();
  if (!user) return null;

  const context = await getUserContext();
  if (!context) return null;

  if (context.super_admin === true && !context.empresa_id) {
    return {
      user,
      usuarioSistema: null,
      empresa: null,
      superAdmin: true
    };
  }

  return {
    user,
    usuarioSistema: {
      id: context.user?.id || user.id,
      rol: context.rol,
      empresa_id: context.empresa_id
    },
    empresa: await loadEmpresaById(context.empresa_id),
    superAdmin: context.super_admin === true
  };
}

export async function buildRequestHeaders({ includeTenant = true } = {}) {
  const headers = {};
  const accessToken = await resolveAccessToken();

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (includeTenant) {
    const context = await getUserContext();
    if (context?.empresa_id) headers["x-tenant-id"] = context.empresa_id;
    if (context?.user?.id) headers["x-user-id"] = context.user.id;
    if (context?.rol) headers["x-user-role"] = context.rol;
  }

  return headers;
}

if (typeof window !== "undefined") {
  window.getEmpresaActual = async () => {
    const session = await getSessionConEmpresa();
    return session?.empresa || null;
  };
}

import { supabase } from "./supabase.js";
import { getCurrentUser } from "./auth.js";

let cachedContext = null;
let authListenerInitialized = false;

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

  return {
    user: {
      id: userId,
      email,
      user_id: userId
    },
    empresa_id: data?.empresa_id || null,
    rol,
    nombre: data?.nombre || email || "Usuario",
    plan: String(data?.plan || "free").trim().toLowerCase() || "free",
    activa: data?.activa !== false,
    permisos: sanitizePermisos(data?.permisos),
    super_admin: rol === "admin_root"
  };
}

function ensureAuthCacheInvalidation() {
  if (authListenerInitialized) return;
  authListenerInitialized = true;

  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "USER_UPDATED") {
      cachedContext = null;
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
    super_admin: String(usuarioSistema.rol || "").trim().toLowerCase() === "admin_root"
  };
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

  const context = mapContextPayload(fallbackPayload, user);
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

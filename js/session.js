import { supabase } from "./supabase.js";
import { getCurrentUser } from "./auth.js";

function normalizeRole(value) {
  return String(value || "operativo").trim().toLowerCase() || "operativo";
}

/**
 * Obtiene contexto de usuario desde RPC segura en Supabase.
 */
export async function getUserContext() {
  const user = await getCurrentUser();
  if (!user) return null;

  const { data, error } = await supabase.rpc("get_my_context");
  if (error) {
    console.error("Error obteniendo contexto vía RPC get_my_context:", error);
    return null;
  }

  const row = Array.isArray(data) ? data[0] : null;

  return {
    user,
    rol: normalizeRole(row?.rol),
    empresa_id: row?.empresa_id || null,
    nombre: row?.nombre_completo || user.email,
    super_admin: normalizeRole(row?.rol) === "admin_root"
  };
}

export function clearUserContextCache() {
  // Sin cache local: se deja por compatibilidad con módulos existentes.
}

export async function getCurrentEmpresaId() {
  const context = await getUserContext();
  return context?.empresa_id || null;
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
  const { data } = await supabase.auth.getSession();
  const accessToken = data?.session?.access_token;

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

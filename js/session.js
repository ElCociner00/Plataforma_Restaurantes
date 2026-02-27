import { supabase } from "./supabase.js";

let cachedUserContext = null;

export async function getUserContext() {
  if (cachedUserContext) return cachedUserContext;

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from("usuarios_sistema")
    .select("rol, empresa_id, activo")
    .eq("id", user.id)
    .single();

  if (error || !data || data.activo === false) return null;

  cachedUserContext = {
    user,
    rol: data.rol,
    empresa_id: data.empresa_id
  };

  return cachedUserContext;
}

export async function getCurrentEmpresaId() {
  const context = await getUserContext();
  return context?.empresa_id || null;
}

export async function obtenerUsuarioActual() {
  const context = await getUserContext();
  return context?.user || null;
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

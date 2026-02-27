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

export async function getSessionConEmpresa() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: usuarioSistema, error } = await supabase
    .from("usuarios_sistema")
    .select(`
      id,
      rol,
      empresa_id,
      activo,
      empresas (
        id,
        nombre_comercial,
        razon_social,
        nit,
        plan,
        activo,
        mostrar_anuncio_impago,
        deuda_actual,
        correo_empresa
      )
    `)
    .eq("id", user.id)
    .single();

  if (error || !usuarioSistema || usuarioSistema.activo === false) return null;

  const empresa = Array.isArray(usuarioSistema.empresas)
    ? usuarioSistema.empresas[0]
    : usuarioSistema.empresas || null;

  return {
    user,
    usuarioSistema,
    empresa
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

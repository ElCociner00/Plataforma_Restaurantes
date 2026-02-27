import { supabase } from "./supabase.js";

let cachedUserContext = null;

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const isRecordActive = (record) => {
  if (!record || typeof record !== "object") return false;
  if (typeof record.activo === "boolean") return record.activo;
  if (typeof record.activa === "boolean") return record.activa;
  if (record.estado == null) return true;
  return String(record.estado).toLowerCase() !== "inactivo";
};

async function getSuperAdminContext(user) {
  const email = normalizeEmail(user?.email);
  if (user?.id === SUPER_ADMIN_ID || email === SUPER_ADMIN_EMAIL) {
    return {
      user,
      rol: "admin_root",
      empresa_id: null,
      super_admin: true
    };
  }

  const filters = [];
  if (user?.id) filters.push(`id.eq.${user.id}`);
  if (email) filters.push(`correo.eq.${email}`);
  if (!filters.length) return null;

  const queryFilter = filters.join(",");
  const tableCandidates = ["system_users", "system_user"];

  for (const tableName of tableCandidates) {
    const { data, error } = await supabase
      .from(tableName)
      .select("id, correo")
      .or(queryFilter)
      .limit(1);

    if (error) continue;
    if (Array.isArray(data) && data.length > 0) {
      return {
        user,
        rol: "admin_root",
        empresa_id: null,
        super_admin: true
      };
    }
  }

  return null;
}

export async function getUserContext() {
  if (cachedUserContext) return cachedUserContext;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: usuarioSistema, error: usuarioSistemaError } = await supabase
    .from("usuarios_sistema")
    .select("rol, empresa_id, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuarioSistemaError && usuarioSistema && isRecordActive(usuarioSistema)) {
    cachedUserContext = {
      user,
      rol: normalizeRole(usuarioSistema.rol),
      empresa_id: usuarioSistema.empresa_id,
      super_admin: false
    };
    return cachedUserContext;
  }

  const { data: otroUsuario, error: otroUsuarioError } = await supabase
    .from("otros_usuarios")
    .select("empresa_id, estado")
    .eq("id", user.id)
    .maybeSingle();

  if (!otroUsuarioError && otroUsuario && isRecordActive(otroUsuario)) {
    cachedUserContext = {
      user,
      rol: "revisor",
      empresa_id: otroUsuario.empresa_id,
      super_admin: false
    };
    return cachedUserContext;
  }

  const superAdminContext = await getSuperAdminContext(user);
  if (superAdminContext) {
    cachedUserContext = superAdminContext;
    return cachedUserContext;
  }

  return null;
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
        plan_actual,
        activo,
        activa,
        mostrar_anuncio_impago,
        deuda_actual,
        correo_empresa
      )
    `)
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  if (!usuarioSistema || usuarioSistema.activo === false) {
    const superAdminContext = await getSuperAdminContext(user);
    if (!superAdminContext) return null;
    return {
      user,
      usuarioSistema: null,
      empresa: null,
      superAdmin: true
    };
  }

  const empresa = Array.isArray(usuarioSistema.empresas)
    ? usuarioSistema.empresas[0]
    : usuarioSistema.empresas || null;

  return {
    user,
    usuarioSistema,
    empresa,
    superAdmin: false
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

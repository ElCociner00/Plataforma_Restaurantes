import { supabase } from "./supabase.js";

let cachedUserContext = null;

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const normalizeName = (value) => normalizeText(value).toLowerCase();

const isRecordActive = (record) => {
  if (!record || typeof record !== "object") return false;
  if (typeof record.activo === "boolean") return record.activo;
  if (typeof record.activa === "boolean") return record.activa;
  if (record.estado == null) return true;
  return String(record.estado).toLowerCase() !== "inactivo";
};

function getIdentityCandidates(user) {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
  const names = [
    metadata.nombre_completo,
    metadata.nombre,
    metadata.full_name,
    metadata.display_name,
    metadata.name
  ]
    .map(normalizeText)
    .filter(Boolean);

  const cedulas = [
    metadata.cedula,
    metadata.documento,
    metadata.document,
    metadata.dni
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return {
    names,
    namesNormalized: names.map(normalizeName),
    cedulas
  };
}

async function queryByName(table, select, namesNormalized = []) {
  for (const fullName of namesNormalized) {
    const response = await supabase
      .from(table)
      .select(select)
      .ilike("nombre_completo", fullName)
      .limit(1)
      .maybeSingle();

    if (!response.error && response.data) return response;
  }
  return { data: null, error: null };
}

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

  const identity = getIdentityCandidates(user);

  let { data: usuarioSistema, error: usuarioSistemaError } = await supabase
    .from("usuarios_sistema")
    .select("id, rol, empresa_id, activo, nombre_completo")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuarioSistema) {
    const byName = await queryByName(
      "usuarios_sistema",
      "id, rol, empresa_id, activo, nombre_completo",
      identity.namesNormalized
    );
    usuarioSistema = byName.data;
    usuarioSistemaError = byName.error;
  }

  if (!usuarioSistemaError && usuarioSistema && isRecordActive(usuarioSistema)) {
    cachedUserContext = {
      user,
      rol: normalizeRole(usuarioSistema.rol),
      empresa_id: usuarioSistema.empresa_id,
      super_admin: false
    };
    return cachedUserContext;
  }

  let { data: otroUsuario, error: otroUsuarioError } = await supabase
    .from("otros_usuarios")
    .select("id, empresa_id, estado, nombre_completo, cedula")
    .eq("id", user.id)
    .maybeSingle();

  if (!otroUsuario) {
    const byName = await queryByName(
      "otros_usuarios",
      "id, empresa_id, estado, nombre_completo, cedula",
      identity.namesNormalized
    );
    otroUsuario = byName.data;
    otroUsuarioError = byName.error;
  }

  if (!otroUsuario && identity.cedulas.length) {
    for (const cedula of identity.cedulas) {
      const byCedula = await supabase
        .from("otros_usuarios")
        .select("id, empresa_id, estado, nombre_completo, cedula")
        .eq("cedula", cedula)
        .limit(1)
        .maybeSingle();
      if (!byCedula.error && byCedula.data) {
        otroUsuario = byCedula.data;
        break;
      }
    }
  }

  if (!otroUsuarioError && otroUsuario && isRecordActive(otroUsuario)) {
    cachedUserContext = {
      user,
      rol: "revisor",
      empresa_id: otroUsuario.empresa_id,
      super_admin: false
    };
    return cachedUserContext;
  }

  let { data: empleado, error: empleadoError } = await supabase
    .from("empleados")
    .select("id, empresa_id, estado, nombre_completo, cedula")
    .eq("id", user.id)
    .maybeSingle();

  if (!empleado) {
    const byName = await queryByName(
      "empleados",
      "id, empresa_id, estado, nombre_completo, cedula",
      identity.namesNormalized
    );
    empleado = byName.data;
    empleadoError = byName.error;
  }

  if (!empleado && identity.cedulas.length) {
    for (const cedula of identity.cedulas) {
      const byCedula = await supabase
        .from("empleados")
        .select("id, empresa_id, estado, nombre_completo, cedula")
        .eq("cedula", cedula)
        .limit(1)
        .maybeSingle();
      if (!byCedula.error && byCedula.data) {
        empleado = byCedula.data;
        break;
      }
    }
  }

  if (!empleadoError && empleado && isRecordActive(empleado)) {
    cachedUserContext = {
      user,
      rol: "operativo",
      empresa_id: empleado.empresa_id,
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

async function loadEmpresaById(empresaId) {
  if (!empresaId) return null;
  const { data, error } = await supabase
    .from("empresas")
    .select("id, nombre_comercial, razon_social, nit, plan, plan_actual, activo, activa, mostrar_anuncio_impago, deuda_actual, correo_empresa")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

export async function getSessionConEmpresa() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const context = await getUserContext();
  if (!context?.empresa_id) {
    const superAdminContext = await getSuperAdminContext(user);
    if (!superAdminContext) return null;
    return {
      user,
      usuarioSistema: null,
      empresa: null,
      superAdmin: true
    };
  }

  if (context.super_admin === true) {
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

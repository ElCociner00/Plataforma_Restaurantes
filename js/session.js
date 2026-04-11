import { supabase } from "./supabase.js";

let cachedUserContext = null;
const USER_CONTEXT_STORAGE_KEY = "app_user_context_cache_v1";
const USER_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
let authSubscriptionInitialized = false;

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const normalizeName = (value) => normalizeText(value).toLowerCase();
const hasWindow = typeof window !== "undefined";

function clearStoredUserContext() {
  if (!hasWindow) return;
  window.localStorage.removeItem(USER_CONTEXT_STORAGE_KEY);
}

function sanitizeContextCandidate(context) {
  if (!context || typeof context !== "object") return null;

  const user = context.user && typeof context.user === "object"
    ? context.user
    : null;
  const userId = normalizeText(user?.id || user?.user_id);
  const userEmail = normalizeEmail(user?.email);
  const role = normalizeRole(context.rol);
  const isSuper = context.super_admin === true;
  const empresaId = isSuper ? null : normalizeText(context.empresa_id);

  if (!userId && !userEmail) return null;
  if (!role) return null;
  if (!isSuper && !empresaId) return null;

  return {
    user: {
      id: userId || null,
      user_id: userId || null,
      email: userEmail || null
    },
    rol: role,
    empresa_id: empresaId || null,
    super_admin: isSuper
  };
}

function saveUserContextToStorage(context) {
  if (!hasWindow) return null;
  const safeContext = sanitizeContextCandidate(context);
  if (!safeContext) return null;

  const payload = {
    expires_at: Date.now() + USER_CONTEXT_TTL_MS,
    context: safeContext
  };

  window.localStorage.setItem(USER_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
  return safeContext;
}

function readUserContextFromStorage(user) {
  if (!hasWindow) return null;

  const raw = window.localStorage.getItem(USER_CONTEXT_STORAGE_KEY);
  if (!raw) return null;

  try {
    const payload = JSON.parse(raw);
    const expiresAt = Number(payload?.expires_at);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      clearStoredUserContext();
      return null;
    }

    const safeContext = sanitizeContextCandidate(payload?.context);
    if (!safeContext) {
      clearStoredUserContext();
      return null;
    }

    const loginUserId = normalizeText(user?.id);
    const loginEmail = normalizeEmail(user?.email);
    const cachedUserId = normalizeText(safeContext?.user?.id || safeContext?.user?.user_id);
    const cachedEmail = normalizeEmail(safeContext?.user?.email);

    if (loginUserId && cachedUserId && loginUserId !== cachedUserId) {
      clearStoredUserContext();
      return null;
    }

    if (loginEmail && cachedEmail && loginEmail !== cachedEmail) {
      clearStoredUserContext();
      return null;
    }

    return safeContext;
  } catch (_error) {
    clearStoredUserContext();
    return null;
  }
}

function persistUserContext(context) {
  const safeContext = sanitizeContextCandidate(context);
  if (!safeContext) return null;
  cachedUserContext = safeContext;
  saveUserContextToStorage(safeContext);
  return safeContext;
}

function buildFallbackContextFromUser(user) {
  if (!user || typeof user !== "object") return null;

  const userId = normalizeText(user.id || user.user_id);
  const email = normalizeEmail(user.email);
  if (!userId && !email) return null;

  const userMeta = user.user_metadata || user.raw_user_meta_data || {};
  const appMeta = user.app_metadata || {};
  const roleCandidate = normalizeRole(
    userMeta.rol ||
    userMeta.role ||
    userMeta.user_role ||
    userMeta.tipo_usuario ||
    appMeta.rol ||
    appMeta.role
  );

  const role = roleCandidate || "operativo";
  const superAdmin = (
    userMeta.super_admin === true ||
    userMeta.is_super_admin === true ||
    appMeta.super_admin === true ||
    role === "admin_root"
  );

  const empresaId = superAdmin
    ? null
    : normalizeText(
      userMeta.empresa_id ||
      userMeta.tenant_id ||
      userMeta.company_id ||
      userMeta.id_empresa ||
      appMeta.empresa_id ||
      appMeta.tenant_id ||
      appMeta.company_id
    );

  if (!superAdmin && !empresaId) return null;

  return {
    user,
    rol: role,
    empresa_id: empresaId || null,
    super_admin: superAdmin
  };
}

function getIdentityCandidates(user) {
  const metadata = user?.user_metadata || user?.raw_user_meta_data || {};
  const email = normalizeEmail(user?.email);
  const emailAlias = email.includes("@") ? normalizeText(email.split("@")[0]) : "";

  const names = [
    metadata.nombre_completo,
    metadata.nombre,
    metadata.full_name,
    metadata.display_name,
    metadata.name,
    email,
    emailAlias
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
    cedulas,
    emails: [email].filter(Boolean)
  };
}

function initializeAuthSubscription() {
  if (!hasWindow || authSubscriptionInitialized) return;
  authSubscriptionInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    const nextUserId = normalizeText(session?.user?.id);
    const currentUserId = normalizeText(cachedUserContext?.user?.id || cachedUserContext?.user?.user_id);
    const eventName = String(event || "").toUpperCase();

    if (eventName === "SIGNED_OUT") {
      cachedUserContext = null;
      clearStoredUserContext();
      return;
    }

    if (currentUserId && nextUserId && currentUserId !== nextUserId) {
      cachedUserContext = null;
      clearStoredUserContext();
    }
  });
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
  initializeAuthSubscription();
  if (cachedUserContext) return cachedUserContext;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    cachedUserContext = null;
    clearStoredUserContext();
    return null;
  }

  const storedContext = readUserContextFromStorage(user);
  if (storedContext) {
    cachedUserContext = storedContext;
    return cachedUserContext;
  }

  const identity = getIdentityCandidates(user);

  let { data: usuarioSistema, error: usuarioSistemaError } = await supabase
    .from("usuarios_sistema")
    .select("id, rol, empresa_id, activo, nombre_completo")
    .eq("id", user.id)
    .maybeSingle();

  if (!usuarioSistema && identity.emails.length) {
    const byEmail = await queryByEmailOnNombre(
      "usuarios_sistema",
      "id, rol, empresa_id, activo, nombre_completo",
      identity.emails
    );
    usuarioSistema = byEmail.data;
    usuarioSistemaError = byEmail.error;
  }

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
    return persistUserContext({
      user,
      rol: normalizeRole(usuarioSistema.rol),
      empresa_id: usuarioSistema.empresa_id,
      super_admin: false
    });
  }

  let { data: otroUsuario, error: otroUsuarioError } = await supabase
    .from("otros_usuarios")
    .select("id, empresa_id, estado, nombre_completo, cedula")
    .eq("id", user.id)
    .maybeSingle();

  if (!otroUsuario && identity.emails.length) {
    const byEmail = await queryByEmailOnNombre(
      "otros_usuarios",
      "id, empresa_id, estado, nombre_completo, cedula",
      identity.emails
    );
    otroUsuario = byEmail.data;
    otroUsuarioError = byEmail.error;
  }

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
    return persistUserContext({
      user,
      rol: "revisor",
      empresa_id: otroUsuario.empresa_id,
      super_admin: false
    });
  }

  let { data: empleado, error: empleadoError } = await supabase
    .from("empleados")
    .select("id, empresa_id, estado, nombre_completo, cedula")
    .eq("id", user.id)
    .maybeSingle();

  if (!empleado && identity.emails.length) {
    const byEmail = await queryByEmailOnNombre(
      "empleados",
      "id, empresa_id, estado, nombre_completo, cedula",
      identity.emails
    );
    empleado = byEmail.data;
    empleadoError = byEmail.error;
  }

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
    return persistUserContext({
      user,
      rol: "operativo",
      empresa_id: empleado.empresa_id,
      super_admin: false
    });
  }

  const superAdminContext = await getSuperAdminContext(user);
  if (superAdminContext) {
    return persistUserContext(superAdminContext);
  }

  const companyEmailContext = await resolveEmpresaContextByCorreoEmpresa(user);
  if (companyEmailContext) {
    return persistUserContext(companyEmailContext);
  }

  const localFallback = buildFallbackContextFromUser(user);
  if (localFallback) {
    return persistUserContext(localFallback);
  }

  return null;
}

export function primeUserContextFromAuth(user) {
  if (!user) return null;

  const fallback = buildFallbackContextFromUser(user);
  if (!fallback) return null;
  return persistUserContext(fallback);
}

export function clearUserContextCache() {
  cachedUserContext = null;
  clearStoredUserContext();
}

async function queryByEmailOnNombre(table, select, emails = []) {
  for (const email of emails) {
    const response = await supabase
      .from(table)
      .select(select)
      .ilike("nombre_completo", email)
      .limit(1)
      .maybeSingle();

    if (!response.error && response.data) return response;
  }
  return { data: null, error: null };
}

async function resolveEmpresaContextByCorreoEmpresa(user) {
  const email = normalizeEmail(user?.email);
  if (!email) return null;

  const { data, error } = await supabase
    .from("empresas")
    .select("id, correo_empresa, activa, activo")
    .ilike("correo_empresa", email)
    .limit(2);

  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const empresa = data[0];
  if (!isRecordActive(empresa)) return null;

  return {
    user,
    rol: "admin",
    empresa_id: empresa.id,
    super_admin: false
  };
}
function isRecordActive(record) {
  if (!record || typeof record !== "object") return false;
  if (typeof record.activo === "boolean") return record.activo;
  if (typeof record.activa === "boolean") return record.activa;
  if (typeof record.estado === "boolean") return record.estado;
  if (record.estado == null) return true;
  return String(record.estado).toLowerCase() !== "inactivo";
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









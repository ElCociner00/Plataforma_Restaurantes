import { supabase } from "./supabase.js";

let cachedUserContext = null;
const CONTEXT_CACHE_KEY = "app_user_context_fallback_v1";
const MANUAL_CONTEXT_KEY = "app_manual_context_bootstrap_v1";
const TENANT_HINTS_KEY = "app_tenant_hints_v1";

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();

const isRecordActive = (record) => {
  if (!record || typeof record !== "object") return false;
  if (typeof record.activo === "boolean") return record.activo;
  if (typeof record.activa === "boolean") return record.activa;
  if (typeof record.estado === "boolean") return record.estado;
  if (record.estado == null) return true;
  return String(record.estado).toLowerCase() !== "inactivo";
};

async function findUsuarioSistema(user) {
  const userId = String(user?.id || "").trim();
  const email = normalizeEmail(user?.email);
  if (!userId && !email) return { data: null, error: null };

  if (userId) {
    const byId = await supabase
      .from("usuarios_sistema")
      .select("id, rol, empresa_id, activo, nombre_completo")
      .eq("id", userId)
      .maybeSingle();
    if (!byId.error && byId.data) return byId;
  }

  if (!email) return { data: null, error: null };
  return supabase
    .from("usuarios_sistema")
    .select("id, rol, empresa_id, activo, nombre_completo")
    .eq("nombre_completo", email)
    .maybeSingle();
}

async function findOtroUsuario(user) {
  const userId = String(user?.id || "").trim();
  const email = normalizeEmail(user?.email);
  if (!userId && !email) return { data: null, error: null };

  if (userId) {
    const byId = await supabase
      .from("otros_usuarios")
      .select("id, empresa_id, estado, nombre_completo")
      .eq("id", userId)
      .maybeSingle();
    if (!byId.error && byId.data) return byId;
  }

  if (!email) return { data: null, error: null };
  return supabase
    .from("otros_usuarios")
    .select("id, empresa_id, estado, nombre_completo")
    .eq("nombre_completo", email)
    .maybeSingle();
}

const saveContextFallback = (context) => {
  if (typeof window === "undefined" || !context?.user?.id) return;
  try {
    const payload = {
      user_id: context.user.id,
      email: normalizeEmail(context.user.email),
      rol: context.rol || "",
      empresa_id: context.empresa_id || null,
      saved_at: new Date().toISOString()
    };
    localStorage.setItem(CONTEXT_CACHE_KEY, JSON.stringify(payload));
    const hintsRaw = localStorage.getItem(TENANT_HINTS_KEY);
    const hints = hintsRaw ? JSON.parse(hintsRaw) : {};
    if (payload.email && payload.empresa_id) {
      hints[payload.email] = {
        empresa_id: payload.empresa_id,
        rol: payload.rol || "admin",
        saved_at: payload.saved_at
      };
      localStorage.setItem(TENANT_HINTS_KEY, JSON.stringify(hints));
    }
  } catch (_error) {
    // no-op
  }
};

const readContextFallback = (user) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONTEXT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.user_id !== user?.id) return null;
    return {
      user,
      rol: normalizeRole(parsed.rol || "admin"),
      empresa_id: parsed.empresa_id || null,
      super_admin: false,
      fallback: true
    };
  } catch (_error) {
    return null;
  }
};

const readTenantHintByEmail = (email) => {
  if (typeof window === "undefined") return null;
  try {
    const key = normalizeEmail(email);
    if (!key) return null;
    const raw = localStorage.getItem(TENANT_HINTS_KEY);
    if (!raw) return null;
    const hints = JSON.parse(raw);
    const hit = hints?.[key];
    if (!hit?.empresa_id) return null;
    return hit;
  } catch (_error) {
    return null;
  }
};

const resolveContextFromAuthClaims = (user) => {
  const appMeta = user?.app_metadata || user?.raw_app_meta_data || {};
  const userMeta = user?.user_metadata || user?.raw_user_meta_data || {};
  const empresaId = String(
    appMeta.empresa_id
    || appMeta.tenant_id
    || userMeta.empresa_id
    || userMeta.tenant_id
    || ""
  ).trim();
  if (!empresaId) return null;

  const rol = normalizeRole(
    appMeta.rol
    || appMeta.role
    || userMeta.rol
    || userMeta.role
    || "admin"
  );

  return {
    user,
    rol: rol || "admin",
    empresa_id: empresaId,
    super_admin: false,
    fallback: true,
    claim_bootstrap: true
  };
};

const readManualContext = (user) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MANUAL_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.user_id !== user?.id) return null;
    if (!parsed.empresa_id) return null;
    return {
      user,
      rol: normalizeRole(parsed.rol || "admin"),
      empresa_id: parsed.empresa_id,
      super_admin: false,
      fallback: true,
      manual_bootstrap: true
    };
  } catch (_error) {
    return null;
  }
};

async function resolveContextByIdentity({ user, email, cedula }) {
  const normalizedEmail = normalizeEmail(email || user?.email);
  const normalizedCedula = String(cedula || "").trim();

  if (normalizedEmail) {
    const { data: userByEmail } = await supabase
      .from("usuarios_sistema")
      .select("empresa_id, rol, activo, nombre_completo")
      .eq("nombre_completo", normalizedEmail)
      .maybeSingle();
    if (userByEmail && isRecordActive(userByEmail) && userByEmail.empresa_id) {
      return {
        user,
        rol: normalizeRole(userByEmail.rol || "admin"),
        empresa_id: userByEmail.empresa_id,
        super_admin: false,
        fallback: true
      };
    }
  }

  if (normalizedCedula) {
    const { data: empleadoByCedula } = await supabase
      .from("empleados")
      .select("empresa_id, estado")
      .eq("cedula", normalizedCedula)
      .maybeSingle();
    if (empleadoByCedula && isRecordActive(empleadoByCedula) && empleadoByCedula.empresa_id) {
      return {
        user,
        rol: "operativo",
        empresa_id: empleadoByCedula.empresa_id,
        super_admin: false,
        fallback: true
      };
    }

    const { data: otroByCedula } = await supabase
      .from("otros_usuarios")
      .select("empresa_id, estado")
      .eq("cedula", normalizedCedula)
      .maybeSingle();
    if (otroByCedula && isRecordActive(otroByCedula) && otroByCedula.empresa_id) {
      return {
        user,
        rol: "revisor",
        empresa_id: otroByCedula.empresa_id,
        super_admin: false,
        fallback: true
      };
    }
  }

  return null;
}

async function resolveContextByCreator(user) {
  const userId = String(user?.id || "").trim();
  if (!userId) return null;

  const tables = [
    { name: "usuarios_sistema", select: "empresa_id", role: "admin" },
    { name: "otros_usuarios", select: "empresa_id", role: "revisor" },
    { name: "empleados", select: "empresa_id", role: "operativo" }
  ];

  for (const table of tables) {
    const { data, error } = await supabase
      .from(table.name)
      .select(table.select)
      .eq("añadido_por", userId)
      .limit(1)
      .maybeSingle();
    if (!error && data?.empresa_id) {
      return {
        user,
        rol: table.role,
        empresa_id: data.empresa_id,
        super_admin: false,
        fallback: true
      };
    }
  }

  return null;
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

  const { data: usuarioSistema, error: usuarioSistemaError } = await findUsuarioSistema(user);

  if (!usuarioSistemaError && usuarioSistema && isRecordActive(usuarioSistema)) {
    cachedUserContext = {
      user,
      rol: normalizeRole(usuarioSistema.rol),
      empresa_id: usuarioSistema.empresa_id,
      super_admin: false
    };
    saveContextFallback(cachedUserContext);
    return cachedUserContext;
  }

  const { data: otroUsuario, error: otroUsuarioError } = await findOtroUsuario(user);

  if (!otroUsuarioError && otroUsuario && isRecordActive(otroUsuario)) {
    cachedUserContext = {
      user,
      rol: "revisor",
      empresa_id: otroUsuario.empresa_id,
      super_admin: false
    };
    saveContextFallback(cachedUserContext);
    return cachedUserContext;
  }

  const superAdminContext = await getSuperAdminContext(user);
  if (superAdminContext) {
    cachedUserContext = superAdminContext;
    saveContextFallback(cachedUserContext);
    return cachedUserContext;
  }

  const creatorContext = await resolveContextByCreator(user);
  if (creatorContext?.empresa_id) {
    cachedUserContext = creatorContext;
    saveContextFallback(cachedUserContext);
    return cachedUserContext;
  }

  const fallbackContext = readContextFallback(user);
  if (fallbackContext?.empresa_id) {
    cachedUserContext = fallbackContext;
    return cachedUserContext;
  }

  const manualContext = readManualContext(user);
  if (manualContext?.empresa_id) {
    cachedUserContext = manualContext;
    return cachedUserContext;
  }

  const claimsContext = resolveContextFromAuthClaims(user);
  if (claimsContext?.empresa_id) {
    cachedUserContext = claimsContext;
    saveContextFallback(cachedUserContext);
    return cachedUserContext;
  }

  const emailHint = readTenantHintByEmail(user?.email);
  if (emailHint?.empresa_id) {
    cachedUserContext = {
      user,
      rol: normalizeRole(emailHint.rol || "admin"),
      empresa_id: emailHint.empresa_id,
      super_admin: false,
      fallback: true,
      hint_bootstrap: true
    };
    saveContextFallback(cachedUserContext);
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

  const { data: usuarioSistema, error } = await findUsuarioSistema(user);

  if (!error && usuarioSistema && usuarioSistema.activo !== false) {
    return {
      user,
      usuarioSistema,
      empresa: await loadEmpresaById(usuarioSistema.empresa_id),
      superAdmin: false
    };
  }

  const { data: otroUsuario, error: otroUsuarioError } = await findOtroUsuario(user);

  if (!otroUsuarioError && otroUsuario && isRecordActive(otroUsuario)) {
    return {
      user,
      usuarioSistema: { ...otroUsuario, rol: "revisor" },
      empresa: await loadEmpresaById(otroUsuario.empresa_id),
      superAdmin: false
    };
  }

  const superAdminContext = await getSuperAdminContext(user);
  if (!superAdminContext) return null;
  return {
    user,
    usuarioSistema: null,
    empresa: null,
    superAdmin: true
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
  window.setManualContextBootstrap = (payload = {}) => {
    try {
      const userId = String(payload.user_id || "").trim();
      const empresaId = String(payload.empresa_id || "").trim();
      if (!userId || !empresaId) return false;
      localStorage.setItem(MANUAL_CONTEXT_KEY, JSON.stringify({
        user_id: userId,
        email: normalizeEmail(payload.email || ""),
        empresa_id: empresaId,
        rol: normalizeRole(payload.rol || "admin"),
        saved_at: new Date().toISOString()
      }));
      cachedUserContext = null;
      return true;
    } catch (_error) {
      return false;
    }
  };

  window.clearManualContextBootstrap = () => {
    localStorage.removeItem(MANUAL_CONTEXT_KEY);
    cachedUserContext = null;
  };

  window.bootstrapContextByIdentity = async (payload = {}) => {
    const { data: userData } = await supabase.auth.getUser();
    const authUser = userData?.user;
    if (!authUser) return null;
    const context = await resolveContextByIdentity({
      user: authUser,
      email: payload.email || authUser.email,
      cedula: payload.cedula || ""
    });
    if (!context?.empresa_id) return null;
    saveContextFallback(context);
    cachedUserContext = context;
    return context;
  };

  window.getEmpresaActual = async () => {
    const session = await getSessionConEmpresa();
    return session?.empresa || null;
  };
}

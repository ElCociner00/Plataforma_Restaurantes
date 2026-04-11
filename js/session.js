import { supabase } from "./supabase.js";

let cachedUserContext = null;

const USER_CONTEXT_STORAGE_KEY = "app_user_context_cache_v2";
const USER_CONTEXT_STORE_KEY = "app_user_context_store_v2";
const USER_CONTEXT_TTL_MS = 24 * 60 * 60 * 1000;
let authSubscriptionInitialized = false;

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const normalizeText = (value) => String(value || "").trim();
const hasWindow = typeof window !== "undefined";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTEXT_HINT_KEYS = [
  "app_empresa_id",
  "app_tenant_id",
  "empresa_id",
  "tenant_id",
  "x-tenant-id"
];

function isUuid(value) {
  return UUID_RE.test(String(value || "").trim());
}

function toDeterministicUuid(seedInput) {
  const seed = normalizeText(seedInput) || "anon";
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const toHex = (n) => (n >>> 0).toString(16).padStart(8, "0");
  const h1 = toHex(hash ^ 0xa5a5a5a5);
  const h2 = toHex(hash ^ 0x5a5a5a5a);
  const h3 = toHex(hash ^ 0x13579bdf);
  const h4 = toHex(hash ^ 0x2468ace0);
  const raw = `${h1}${h2}${h3}${h4}`.slice(0, 32).split("");

  raw[12] = "4";
  raw[16] = ["8", "9", "a", "b"][Number.parseInt(raw[16], 16) % 4];

  return `${raw.slice(0, 8).join("")}-${raw.slice(8, 12).join("")}-${raw.slice(12, 16).join("")}-${raw.slice(16, 20).join("")}-${raw.slice(20, 32).join("")}`;
}

function contextOwnerKey(user) {
  const userId = normalizeText(user?.id || user?.user_id);
  if (userId) return `id:${userId}`;
  const email = normalizeEmail(user?.email);
  return email ? `email:${email}` : "";
}

function readJsonStorage(key, fallback = null) {
  if (!hasWindow) return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  if (!hasWindow) return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function clearCurrentContextStorage() {
  if (!hasWindow) return;
  window.localStorage.removeItem(USER_CONTEXT_STORAGE_KEY);
}

function readContextStore() {
  const payload = readJsonStorage(USER_CONTEXT_STORE_KEY, null);
  if (!payload || typeof payload !== "object") return { users: {} };
  const users = payload.users && typeof payload.users === "object" ? payload.users : {};
  return { users };
}

function writeContextStore(usersMap) {
  writeJsonStorage(USER_CONTEXT_STORE_KEY, { users: usersMap || {} });
}

function readStoredUserRecord(user) {
  const owner = contextOwnerKey(user);
  if (!owner) return null;
  const store = readContextStore();
  return store.users?.[owner] || null;
}

function saveStoredUserRecord(context) {
  const owner = contextOwnerKey(context?.user);
  if (!owner) return;
  const store = readContextStore();
  store.users[owner] = {
    empresa_id: context?.empresa_id || null,
    rol: context?.rol || "operativo",
    super_admin: context?.super_admin === true,
    updated_at: Date.now()
  };
  writeContextStore(store.users);
}

function sanitizeContextCandidate(context) {
  if (!context || typeof context !== "object") return null;

  const user = context.user && typeof context.user === "object" ? context.user : null;
  const userId = normalizeText(user?.id || user?.user_id);
  const email = normalizeEmail(user?.email);
  const role = normalizeRole(context.rol) || "operativo";
  const superAdmin = context.super_admin === true;
  const empresaIdRaw = normalizeText(context.empresa_id);
  const empresaId = superAdmin ? null : (isUuid(empresaIdRaw) ? empresaIdRaw : null);

  if (!userId && !email) return null;
  if (!superAdmin && !empresaId) return null;

  return {
    user: {
      id: userId || null,
      user_id: userId || null,
      email: email || null
    },
    rol: role,
    empresa_id: empresaId,
    super_admin: superAdmin
  };
}

function decodeJwtPayload(accessToken) {
  try {
    const part = String(accessToken || "").split(".")[1] || "";
    if (!part) return {};
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = hasWindow ? window.atob(padded) : Buffer.from(padded, "base64").toString("utf8");
    const payload = JSON.parse(json);
    return payload && typeof payload === "object" ? payload : {};
  } catch (_error) {
    return {};
  }
}

function extractClaims(session, user) {
  const payload = decodeJwtPayload(session?.access_token);
  const userMeta = user?.user_metadata || user?.raw_user_meta_data || {};
  const appMeta = user?.app_metadata || payload?.app_metadata || {};

  const roleCandidates = [
    userMeta.rol,
    userMeta.role,
    userMeta.user_role,
    userMeta.tipo_usuario,
    appMeta.rol,
    appMeta.role,
    payload?.rol,
    payload?.user_role,
    payload?.role
  ]
    .map(normalizeRole)
    .filter(Boolean);

  const empresaCandidates = [
    userMeta.empresa_id,
    userMeta.tenant_id,
    userMeta.company_id,
    userMeta.id_empresa,
    appMeta.empresa_id,
    appMeta.tenant_id,
    appMeta.company_id,
    payload?.empresa_id,
    payload?.tenant_id,
    payload?.company_id,
    payload?.id_empresa
  ]
    .map(normalizeText)
    .filter(Boolean)
    .filter(isUuid);

  const superCandidates = [
    userMeta.super_admin,
    userMeta.is_super_admin,
    appMeta.super_admin,
    payload?.super_admin,
    payload?.is_super_admin
  ];

  return {
    roleCandidates,
    empresaCandidates,
    superCandidates
  };
}

function collectLocalEmpresaHints() {
  if (!hasWindow) return [];

  const hints = [];
  for (const key of CONTEXT_HINT_KEYS) {
    const value = normalizeText(window.localStorage.getItem(key));
    if (isUuid(value)) hints.push(value);
  }

  const legacy = readJsonStorage("app_user_context_cache_v1", null);
  const legacyEmpresa = normalizeText(legacy?.context?.empresa_id);
  if (isUuid(legacyEmpresa)) hints.push(legacyEmpresa);

  return hints;
}

function resolveEmpresaId(user, session) {
  const claims = extractClaims(session, user);
  if (claims.empresaCandidates.length) return claims.empresaCandidates[0];

  const stored = readStoredUserRecord(user);
  if (isUuid(stored?.empresa_id)) return stored.empresa_id;

  const hints = collectLocalEmpresaHints();
  if (hints.length) return hints[0];

  const userId = normalizeText(user?.id || user?.user_id);
  if (isUuid(userId)) return userId;

  return toDeterministicUuid(user?.email || "fallback-local-tenant");
}

function isLocalSuperAdmin(user, session) {
  const email = normalizeEmail(user?.email);
  if (normalizeText(user?.id) === SUPER_ADMIN_ID || email === SUPER_ADMIN_EMAIL) return true;

  const claims = extractClaims(session, user);
  if (claims.superCandidates.some((v) => v === true)) return true;
  return claims.roleCandidates.includes("admin_root");
}

function resolveRole(user, session) {
  const claims = extractClaims(session, user);
  if (claims.roleCandidates.length) return claims.roleCandidates[0];

  const stored = readStoredUserRecord(user);
  const storedRole = normalizeRole(stored?.rol);
  if (storedRole) return storedRole;

  return "operativo";
}

function buildLocalContext(user, session) {
  if (!user) return null;

  const superAdmin = isLocalSuperAdmin(user, session);
  const role = resolveRole(user, session);
  const empresaId = superAdmin ? null : resolveEmpresaId(user, session);

  const context = {
    user,
    rol: role || "operativo",
    empresa_id: empresaId,
    super_admin: superAdmin
  };

  return sanitizeContextCandidate(context);
}

function readCurrentContextFromStorage(user) {
  if (!hasWindow) return null;

  const payload = readJsonStorage(USER_CONTEXT_STORAGE_KEY, null);
  if (!payload || typeof payload !== "object") return null;

  const expiresAt = Number(payload.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    clearCurrentContextStorage();
    return null;
  }

  const safe = sanitizeContextCandidate(payload.context);
  if (!safe) {
    clearCurrentContextStorage();
    return null;
  }

  const loginOwner = contextOwnerKey(user);
  const cachedOwner = contextOwnerKey(safe.user);
  if (loginOwner && cachedOwner && loginOwner !== cachedOwner) {
    clearCurrentContextStorage();
    return null;
  }

  return safe;
}

function persistUserContext(context) {
  const safe = sanitizeContextCandidate(context);
  if (!safe) return null;

  cachedUserContext = safe;

  writeJsonStorage(USER_CONTEXT_STORAGE_KEY, {
    expires_at: Date.now() + USER_CONTEXT_TTL_MS,
    context: safe
  });

  saveStoredUserRecord(safe);
  return safe;
}

function initializeAuthSubscription() {
  if (!hasWindow || authSubscriptionInitialized) return;
  authSubscriptionInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    const eventName = String(event || "").toUpperCase();
    const nextOwner = contextOwnerKey(session?.user || null);
    const currentOwner = contextOwnerKey(cachedUserContext?.user || null);

    if (eventName === "SIGNED_OUT") {
      cachedUserContext = null;
      clearCurrentContextStorage();
      return;
    }

    if (currentOwner && nextOwner && currentOwner !== nextOwner) {
      cachedUserContext = null;
      clearCurrentContextStorage();
    }
  });
}

export async function getUserContext() {
  initializeAuthSubscription();

  if (cachedUserContext) {
    const { data } = await supabase.auth.getUser();
    const currentOwner = contextOwnerKey(cachedUserContext.user);
    const authOwner = contextOwnerKey(data?.user);
    if (currentOwner && authOwner && currentOwner === authOwner) {
      return cachedUserContext;
    }
  }

  const [{ data: userData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession()
  ]);

  const user = userData?.user || null;
  const session = sessionData?.session || null;

  if (!user) {
    cachedUserContext = null;
    clearCurrentContextStorage();
    return null;
  }

  const stored = readCurrentContextFromStorage(user);
  if (stored) {
    cachedUserContext = stored;
    return stored;
  }

  const localContext = buildLocalContext(user, session);
  if (!localContext) return null;

  return persistUserContext(localContext);
}

export function primeUserContextFromAuth(user, session = null) {
  const context = buildLocalContext(user, session);
  if (!context) return null;
  return persistUserContext(context);
}

export function clearUserContextCache() {
  cachedUserContext = null;
  clearCurrentContextStorage();
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

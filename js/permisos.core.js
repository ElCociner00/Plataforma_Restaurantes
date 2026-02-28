import { supabase } from "./supabase.js";
import { getUserContext, obtenerUsuarioActual } from "./session.js";
import { isEmpresaReadOnlyPlan, normalizeEmpresaActiva, resolveEmpresaPlan } from "./plan.js";

let permisosCache = null;
let permisosCacheKey = null;
const empresaPolicyCache = new Map();
const superAdminCache = new Map();

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const normalizePlan = (empresa) => {
  const raw = resolveEmpresaPlan(empresa);
  return String(raw).trim().toLowerCase() || "free";
};

const normalizeActiva = (empresa) => {
  if (!empresa || typeof empresa !== "object") return true;
  if (typeof empresa.activo === "boolean") return empresa.activo;
  if (typeof empresa.activa === "boolean") return empresa.activa;
  return true;
};

export async function getEmpresaPolicy(empresaId, forceRefresh = false) {
  if (!empresaId) {
    return {
      empresa_id: null,
      plan: "free",
      activa: true,
      solo_lectura: false
    };
  }

  if (!forceRefresh && empresaPolicyCache.has(empresaId)) {
    return empresaPolicyCache.get(empresaId);
  }

  const { data, error } = await supabase
    .from("empresas")
    .select("id, plan, plan_actual, activo, activa")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) throw error;

  const policy = {
    empresa_id: empresaId,
    plan: normalizePlan(data),
    activa: normalizeActiva(data),
    solo_lectura: isEmpresaReadOnlyPlan(data)
  };

  empresaPolicyCache.set(empresaId, policy);
  return policy;
}

export async function puedeEnviarDatos(empresaId, forceRefresh = false) {
  const policy = await getEmpresaPolicy(empresaId, forceRefresh);
  return policy.activa === true && policy.solo_lectura !== true;
}

export async function getPermisosEfectivos(usuarioId, empresaId, forceRefresh = false) {
  if (!usuarioId || !empresaId) return [];
  const cacheKey = `${usuarioId}:${empresaId}`;

  if (!forceRefresh && permisosCache && permisosCacheKey === cacheKey) {
    return permisosCache;
  }

  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("modulo, permitido")
    .eq("usuario_id", usuarioId)
    .eq("empresa_id", empresaId);

  if (error) throw error;

  const permisos = data || [];
  permisosCacheSet(permisos);
  permisosCacheKey = cacheKey;

  return permisos;
}

export function tienePermiso(modulo, permisos) {
  if (!modulo || !permisos) return false;

  if (Array.isArray(permisos)) {
    const item = permisos.find((permiso) => permiso.modulo === modulo);
    return item ? item.permitido === true : false;
  }

  if (typeof permisos === "object") {
    return permisos[modulo] === true;
  }

  return false;
}

export function permisosCacheSet(permisos) {
  permisosCache = permisos || null;
}

export function permisosCacheGet() {
  return permisosCache;
}

export function permisosCacheClear() {
  permisosCache = null;
  permisosCacheKey = null;
}

export async function esSuperAdmin() {
  const context = await getUserContext();
  const user = (await obtenerUsuarioActual()) || context?.user;
  const userId = user?.id || user?.user_id;
  const email = normalizeEmail(user?.email);
  if (!userId && !email) return false;

  const cacheKey = `${userId || ""}:${email}`;
  if (superAdminCache.has(cacheKey)) {
    return superAdminCache.get(cacheKey);
  }

  if (userId === SUPER_ADMIN_ID || email === SUPER_ADMIN_EMAIL) {
    superAdminCache.set(cacheKey, true);
    return true;
  }

  const filters = [];
  if (userId) filters.push(`id.eq.${userId}`);
  if (email) filters.push(`correo.eq.${email}`);
  if (!filters.length) {
    superAdminCache.set(cacheKey, false);
    return false;
  }

  for (const tableName of ["system_users", "system_user"]) {
    const { data, error } = await supabase
      .from(tableName)
      .select("id, correo")
      .or(filters.join(","))
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      superAdminCache.set(cacheKey, true);
      return true;
    }
  }

  superAdminCache.set(cacheKey, false);
  return false;
}


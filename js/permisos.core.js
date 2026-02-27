import { supabase } from "./supabase.js";
import { getUserContext, obtenerUsuarioActual } from "./session.js";

let permisosCache = null;
let permisosCacheKey = null;
const superAdminCache = new Map();

const SUPER_ADMIN_EMAIL = "santiagoelchameluco@gmail.com";
const SUPER_ADMIN_ID = "1e17e7c6-d959-4089-ab22-3f64b5b5be41";

export async function getPermisosEfectivos(usuarioId, empresaId, forceRefresh = false) {
  if (!usuarioId || !empresaId) return [];
  const cacheKey = `${usuarioId}:${empresaId}`;

  if (!forceRefresh && permisosCache && permisosCacheKey === cacheKey) {
    return permisosCache;
  }

  const { data: empresa } = await supabase
    .from("empresas")
    .select("plan, activo")
    .eq("id", empresaId)
    .maybeSingle();

  if (empresa && empresa.activo === false) {
    permisosCacheSet([]);
    permisosCacheKey = cacheKey;
    return [];
  }

  const { data, error } = await supabase
    .from("v_permisos_efectivos")
    .select("modulo, permitido")
    .eq("usuario_id", usuarioId)
    .eq("empresa_id", empresaId);

  if (error) throw error;

  let permisos = data || [];
  if (empresa?.plan === "free") {
    const soloLectura = new Set([
      "dashboard",
      "historico_cierre_turno",
      "historico_cierre_inventarios",
      "facturacion"
    ]);
    permisos = permisos.map((item) => ({
      ...item,
      permitido: soloLectura.has(item.modulo) ? item.permitido === true : false
    }));
  }

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
  const email = String(user?.email || "").toLowerCase();
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

  const { data, error } = await supabase
    .from("system_users")
    .select("id, correo")
    .or(filters.join(","))
    .limit(1);

  if (error) {
    superAdminCache.set(cacheKey, false);
    return false;
  }

  const isAllowed = Array.isArray(data) && data.length > 0;
  superAdminCache.set(cacheKey, isAllowed);
  return isAllowed;
}

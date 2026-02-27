import { supabase } from "./supabase.js";

let permisosCache = null;
let permisosCacheKey = null;

export async function getPermisosEfectivos(usuarioId, empresaId) {
  if (!usuarioId || !empresaId) return [];
  const cacheKey = `${usuarioId}:${empresaId}`;

  if (permisosCache && permisosCacheKey === cacheKey) {
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

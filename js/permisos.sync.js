import { supabase } from "./supabase.js";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions.js";

const PERMISOS_STORAGE_KEY = "app_user_permissions_cache_v2";
const PERMISOS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora

let permisosCacheados = null;
let permisosCacheLocked = false;

const DEFAULT_PERMISSIONS_BY_ROLE = {
    admin_root: { __all__: true },
    admin: { __all__: true },
    revisor: {
        dashboard: true, cierre_turno: true, historico_cierre_turno: true,
        cierre_inventarios: true, historico_cierre_inventarios: true,
        inventarios: true, dashboard_siigo: true, facturacion: true
    },
    operativo: { cierre_turno: true, cierre_inventarios: true }
};

export async function cargarYPersistirPermisosSync(usuarioId, empresaId, rol) {
    if (permisosCacheLocked) return permisosCacheados || {};
    permisosCacheLocked = true;
    console.log(`[PermisosSync] Cargando permisos para ${usuarioId}`);

    let permisosMap = {};
    try {
        const { data, error } = await supabase
            .from("v_permisos_efectivos")
            .select("modulo, permitido")
            .eq("usuario_id", usuarioId)
            .eq("empresa_id", empresaId);

        if (!error && Array.isArray(data)) {
            data.forEach(p => {
                permisosMap[String(p.modulo).toLowerCase()] = p.permitido === true;
            });
            console.log(`[PermisosSync] ✓ ${data.length} permisos cargados`);
        } else {
            console.warn("[PermisosSync] Error en query:", error?.message);
        }
    } catch (error) {
        console.error("[PermisosSync] Excepción:", error);
    }

    if (Object.keys(permisosMap).length === 0) {
        const defaultsForRole = DEFAULT_PERMISSIONS_BY_ROLE[String(rol).toLowerCase()] || DEFAULT_PERMISSIONS_BY_ROLE.operativo;
        permisosMap = { ...defaultsForRole };
        console.log(`[PermisosSync] Usando defaults para rol: ${rol}`);
    }

    const cachePayload = { timestamp: Date.now(), permisos: permisosMap, usuarioId, empresaId, rol };
    try {
        localStorage.setItem(PERMISOS_STORAGE_KEY, JSON.stringify(cachePayload));
    } catch (e) {
        console.warn("[PermisosSync] localStorage error:", e);
    }

    permisosCacheados = permisosMap;
    permisosCacheLocked = false;
    return permisosMap;
}

export function obtenerPermisosSync() {
    if (permisosCacheados && Object.keys(permisosCacheados).length > 0) return permisosCacheados;
    
    try {
        const raw = localStorage.getItem(PERMISOS_STORAGE_KEY);
        if (raw) {
            const { timestamp, permisos } = JSON.parse(raw);
            if (Date.now() - timestamp < PERMISOS_CACHE_TTL_MS) {
                permisosCacheados = permisos;
                return permisos;
            }
            localStorage.removeItem(PERMISOS_STORAGE_KEY);
        }
    } catch (e) {
        console.error("[PermisosSync] localStorage read error:", e);
    }
    
    return {};
}

export function tienePermisoSync(modulo) {
    if (!modulo) return false;
    const permisos = obtenerPermisosSync();
    const normalized = String(modulo).toLowerCase().trim();
    
    if (permisos.__all__ === true) {
        console.log(`[PermisosSync] ✓ Acceso total para: ${modulo}`);
        return true;
    }
    
    const hasAccess = permisos[normalized] === true;
    console.log(`[PermisosSync] ${hasAccess ? "✓" : "✗"} ${modulo}`);
    return hasAccess;
}

export function limpiarCachePermisosSync() {
    permisosCacheados = null;
    permisosCacheLocked = false;
    try {
        localStorage.removeItem(PERMISOS_STORAGE_KEY);
    } catch (e) {
        console.warn("[PermisosSync] localStorage clear error:", e);
    }
}

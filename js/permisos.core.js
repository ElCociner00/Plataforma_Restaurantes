import { supabase } from "./supabase.js";
import { getUserContext, obtenerUsuarioActual } from "./session.js";
import { isEmpresaReadOnlyPlan, normalizeEmpresaActiva, resolveEmpresaPlan } from "./plan.js";
import { DEFAULT_ROLE_PERMISSIONS } from "./permissions.js";
import { applyEmergencyRolePermissions } from "./permisos.emergencia.js";

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

async function getLatestBillingCycle(empresaId) {
  if (!empresaId) return null;
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("id, estado, fecha_vencimiento, periodo, banner_activo")
    .eq("empresa_id", empresaId)
    .order("periodo", { ascending: false })
    .order("fecha_vencimiento", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return data || null;
}

function parseYmd(value) {
  const match = String(value || "").match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtcMidday(ymd) {
  if (!ymd) return null;
  return Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0);
}

function diffDaysFromToday(value) {
  const target = parseYmd(value);
  if (!target) return null;
  const now = new Date();
  const today = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
  return Math.round((toUtcMidday(target) - toUtcMidday(today)) / 86400000);
}

function getSuspensionDate(fechaVencimiento) {
  const due = parseYmd(fechaVencimiento);
  if (!due) return null;
  const day = Math.max(due.day, 20);
  return `${due.year}-${String(due.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function resolveBillingReadOnlyState(cycle, empresa) {
  const estado = String(cycle?.estado || "").trim().toLowerCase();
  if (!cycle || !estado || estado === "paid_verified") {
    return { suspendida_por_facturacion: false, solo_lectura_por_facturacion: false, motivo: "" };
  }

  const suspensionDate = getSuspensionDate(cycle.fecha_vencimiento);
  const suspensionDiff = diffDaysFromToday(suspensionDate);
  const forcedSuspended = estado === "suspended";
  const suspended = forcedSuspended || (typeof suspensionDiff === "number" && suspensionDiff < 0);
  const readOnly = suspended;

  return {
    suspendida_por_facturacion: suspended,
    solo_lectura_por_facturacion: readOnly,
    motivo: readOnly ? "facturacion_suspendida" : ""
  };
}

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

  const response = await supabase
    .from("empresas")
    .select("id, plan, plan_actual, activo, activa, deuda_actual, mostrar_anuncio_impago")
    .eq("id", empresaId)
    .maybeSingle();

  let data = response?.data || null;
  const error = response?.error || null;

  if (!data && !error) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const retry = await supabase
      .from("empresas")
      .select("id, plan, plan_actual, activo, activa, deuda_actual, mostrar_anuncio_impago")
      .eq("id", empresaId)
      .maybeSingle();
    if (!retry?.error && retry?.data) {
      data = retry.data;
    }
  }

  if (error) throw error;

  if (!data) {
    const unresolvedError = new Error("No se pudo resolver el plan de la empresa. Recarga la pagina e intenta de nuevo.");
    unresolvedError.code = "PLAN_UNRESOLVED";
    throw unresolvedError;
  }


  const billingState = resolveBillingReadOnlyState(await getLatestBillingCycle(empresaId), data);

  const policy = {
    empresa_id: empresaId,
    plan: normalizePlan(data),
    activa: normalizeActiva(data),
    suspendida_por_facturacion: billingState.suspendida_por_facturacion,
    solo_lectura_plan: isEmpresaReadOnlyPlan(data),
    solo_lectura_por_facturacion: billingState.solo_lectura_por_facturacion,
    solo_lectura: isEmpresaReadOnlyPlan(data) || billingState.solo_lectura_por_facturacion,
    motivo_solo_lectura: isEmpresaReadOnlyPlan(data) ? "plan_free" : billingState.motivo
  };

  empresaPolicyCache.set(empresaId, policy);
  return policy;
}

export async function puedeEnviarDatos(empresaId, forceRefresh = false) {
  return true;
}

export async function getPermisosEfectivos(usuarioId, empresaId, forceRefresh = false) {
  if (!usuarioId || !empresaId) return [];
  const cacheKey = `${usuarioId}:${empresaId}`;

  if (!forceRefresh && permisosCache && permisosCacheKey === cacheKey) {
    return permisosCache;
  }

  const normalizeModuleKey = (value) => String(value || "").trim().toLowerCase();
  const normalizePermitido = (value) => value === true || value === 1 || String(value || "").trim().toLowerCase() === "true";
  const normalizePermisosArray = (rows) => (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      modulo: normalizeModuleKey(row?.modulo),
      permitido: normalizePermitido(row?.permitido)
    }))
    .filter((row) => Boolean(row.modulo));

  const resolveRole = async () => {
    const context = await getUserContext().catch(() => null);
    const contextRole = String(context?.rol || "").trim().toLowerCase();
    if (contextRole) return contextRole;

    const byEmpresa = await supabase
      .from("usuarios_sistema")
      .select("rol")
      .eq("id", usuarioId)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    if (!byEmpresa?.error && byEmpresa?.data?.rol) {
      return String(byEmpresa.data.rol).trim().toLowerCase();
    }

    const fallback = await supabase
      .from("usuarios_sistema")
      .select("rol")
      .eq("id", usuarioId)
      .maybeSingle();
    if (!fallback?.error && fallback?.data?.rol) {
      return String(fallback.data.rol).trim().toLowerCase();
    }

    return "operativo";
  };

  const rol = await resolveRole();

  const [effectiveResponse, roleResponse] = await Promise.all([
    supabase
      .from("v_permisos_efectivos")
      .select("modulo, permitido")
      .eq("usuario_id", usuarioId)
      .eq("empresa_id", empresaId),
    rol
      ? supabase
        .from("roles_permisos_modulo")
        .select("modulo, permitido")
        .eq("rol", rol)
      : Promise.resolve({ data: [], error: null })
  ]);

  const defaultsByRole = DEFAULT_ROLE_PERMISSIONS?.[rol] || {};
  const merged = new Map(
    Object.entries(defaultsByRole).map(([modulo, permitido]) => [normalizeModuleKey(modulo), permitido === true])
  );

  const applyRowsAsAvailabilitySource = (rows) => {
    normalizePermisosArray(rows).forEach((row) => {
      const module = normalizeModuleKey(row.modulo);
      const currentlyAllowed = merged.get(module) === true;
      merged.set(module, currentlyAllowed || normalizePermitido(row.permitido));
    });
  };

  applyRowsAsAvailabilitySource(roleResponse?.data);
  applyRowsAsAvailabilitySource(effectiveResponse?.data);

  let permisos = Array.from(merged.entries()).map(([modulo, permitido]) => ({ modulo, permitido }));
  permisos = applyEmergencyRolePermissions(rol, permisos);

  permisosCacheSet(permisos);
  permisosCacheKey = cacheKey;

  return permisos;
}

export function tienePermiso(modulo, permisos) {
  if (!modulo || !permisos) return false;

  const normalizedModulo = String(modulo || "").trim().toLowerCase();

  if (Array.isArray(permisos)) {
    const item = permisos.find((permiso) => String(permiso?.modulo || "").trim().toLowerCase() === normalizedModulo);
    return item ? item.permitido === true : false;
  }

  if (typeof permisos === "object") {
    return permisos[normalizedModulo] === true || permisos[modulo] === true;
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

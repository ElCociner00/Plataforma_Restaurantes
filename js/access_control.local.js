import { ENV_LOGGRO, ENV_SIIGO } from "./environment.js";
import { DEFAULT_ROLE_PERMISSIONS, PAGE_ENVIRONMENT } from "./permissions.js";
import { APP_URLS } from "./urls.js";

const normalizeRole = (value) => String(value || "").trim().toLowerCase() || "operativo";
const normalizeModule = (value) => String(value || "").trim().toLowerCase();

export const LOCAL_ROLE_ACCESS = {
  admin_root: { all: true },
  admin: { all: true },
  operativo: {
    cierre_turno: true,
    historico_cierre_turno: true,
    cierre_inventarios: true,
    historico_cierre_inventarios: true,
    inventarios: true,
    dashboard: false,
    configuracion: false,
    configuracion_siigo: false,
    gestion_usuarios: false,
    permisos: false,
    registro_empleados: false,
    registro_otros_usuarios: false
  }
};

export const MODULE_ROUTE_MAP = {
  dashboard: APP_URLS.dashboard,
  cierre_turno: APP_URLS.cierreTurno,
  historico_cierre_turno: APP_URLS.historicoCierreTurno,
  cierre_inventarios: APP_URLS.cierreInventarios,
  historico_cierre_inventarios: APP_URLS.historicoCierreInventarios,
  inventarios: APP_URLS.inventarios,
  configuracion: APP_URLS.configuracion,
  loggro: APP_URLS.loggro,
  visualizacion_cierre_turno: APP_URLS.visualizacionCierreTurno,
  visualizacion_cierre_turno_historico: APP_URLS.visualizacionCierreTurnoHistorico,
  visualizacion_cierre_inventarios: APP_URLS.visualizacionCierreInventarios,
  visualizacion_cierre_inventarios_historico: APP_URLS.visualizacionCierreInventariosHistorico,
  permisos: APP_URLS.permisos,
  registro_empleados: APP_URLS.registroEmpleados,
  registro_otros_usuarios: APP_URLS.registroOtrosUsuarios,
  gestion_usuarios: APP_URLS.gestionUsuarios,
  gestion_empresas: APP_URLS.gestionEmpresas,
  facturacion: APP_URLS.facturacion,
  dashboard_siigo: APP_URLS.dashboardSiigo,
  configuracion_siigo: APP_URLS.configuracionSiigo,
  subir_facturas_siigo: APP_URLS.subirFacturasSiigo,
  historico_facturas_siigo: APP_URLS.historicoFacturasSiigo,
  nomina: APP_URLS.nomina
};

const LOGGRO_PRIORITY = [
  "gestion_empresas",
  "gestion_usuarios",
  "dashboard",
  "cierre_turno",
  "cierre_inventarios",
  "historico_cierre_turno",
  "historico_cierre_inventarios",
  "inventarios",
  "configuracion",
  "permisos",
  "registro_empleados",
  "registro_otros_usuarios",
  "loggro",
  "visualizacion_cierre_turno",
  "visualizacion_cierre_turno_historico",
  "visualizacion_cierre_inventarios",
  "visualizacion_cierre_inventarios_historico"
];

const SIIGO_PRIORITY = [
  "dashboard_siigo",
  "facturacion",
  "subir_facturas_siigo",
  "historico_facturas_siigo",
  "nomina",
  "configuracion_siigo"
];

export const MODULE_ENV_MAP = {
  dashboard: ENV_LOGGRO,
  cierre_turno: ENV_LOGGRO,
  historico_cierre_turno: ENV_LOGGRO,
  cierre_inventarios: ENV_LOGGRO,
  historico_cierre_inventarios: ENV_LOGGRO,
  configuracion: ENV_LOGGRO,
  loggro: ENV_LOGGRO,
  inventarios: ENV_LOGGRO,
  permisos: ENV_LOGGRO,
  registro_empleados: ENV_LOGGRO,
  registro_otros_usuarios: ENV_LOGGRO,
  gestion_usuarios: ENV_LOGGRO,
  dashboard_siigo: ENV_SIIGO,
  subir_facturas_siigo: ENV_SIIGO,
  configuracion_siigo: ENV_SIIGO,
  historico_facturas_siigo: ENV_SIIGO,
  facturacion: ENV_SIIGO,
  nomina: ENV_SIIGO
};

export function hasLocalAccess(role, moduleKey) {
  const safeRole = normalizeRole(role);
  const module = normalizeModule(moduleKey);
  const policy = LOCAL_ROLE_ACCESS[safeRole] || {};
  if (policy.all === true) return true;
  return policy[module] === true;
}

export function getHomeByRole(role) {
  const safeRole = normalizeRole(role);
  if (safeRole === "admin_root") return APP_URLS.gestionEmpresas;
  if (safeRole === "operativo") return APP_URLS.cierreTurno;
  return APP_URLS.dashboard;
}

export function resolveDefaultRouteForRoleEnv(role, env) {
  const safeRole = normalizeRole(role);
  if (env === ENV_SIIGO) {
    if (safeRole === "admin_root") return APP_URLS.facturacion;
    if (safeRole === "operativo") return APP_URLS.cierreTurno;
    return APP_URLS.dashboardSiigo;
  }

  if (safeRole === "admin_root") return APP_URLS.gestionEmpresas;

  return safeRole === "operativo"
    ? APP_URLS.cierreTurno
    : APP_URLS.dashboard;
}

export function buildAccessMap(role, permisosRows = []) {
  const safeRole = normalizeRole(role);
  const defaults = { ...(DEFAULT_ROLE_PERMISSIONS?.[safeRole] || {}) };
  const merged = new Map(Object.entries(defaults).map(([module, allowed]) => [normalizeModule(module), allowed === true]));

  if (LOCAL_ROLE_ACCESS[safeRole]?.all === true) {
    Object.keys(PAGE_ENVIRONMENT || {}).forEach((module) => {
      merged.set(normalizeModule(module), true);
    });
  } else {
    Object.entries(LOCAL_ROLE_ACCESS[safeRole] || {}).forEach(([module, allowed]) => {
      if (module !== "all") merged.set(normalizeModule(module), allowed === true);
    });
  }

  (Array.isArray(permisosRows) ? permisosRows : []).forEach((row) => {
    const module = normalizeModule(row?.modulo);
    if (!module) return;
    merged.set(module, row?.permitido === true);
  });

  return merged;
}

export function resolveFirstAllowedRoute(role, env, permisosRows = []) {
  const safeRole = normalizeRole(role);
  const accessMap = buildAccessMap(safeRole, permisosRows);
  const candidates = env === ENV_SIIGO ? SIIGO_PRIORITY : LOGGRO_PRIORITY;
  const firstAllowed = candidates.find((module) => accessMap.get(module) === true && MODULE_ROUTE_MAP[module]);
  if (firstAllowed) return MODULE_ROUTE_MAP[firstAllowed];

  return resolveDefaultRouteForRoleEnv(safeRole, env);
}

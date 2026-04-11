import { ENV_LOGGRO, ENV_SIIGO } from "./environment.js";

const normalizeRole = (value) => String(value || "").trim().toLowerCase() || "admin";

export const LOCAL_ROLE_ACCESS = {
  admin_root: { all: true },
  admin: {
    dashboard: true,
    cierre_turno: true,
    historico_cierre_turno: true,
    cierre_inventarios: true,
    historico_cierre_inventarios: true,
    facturacion: true,
    dashboard_siigo: true,
    subir_facturas_siigo: true,
    historico_facturas_siigo: true,
    nomina: true,
    loggro: true,
    inventarios: true,
    configuracion: false,
    gestion_usuarios: false,
    permisos: false,
    registro_empleados: false,
    registro_otros_usuarios: false,
    configuracion_siigo: false,
    gestion_empresas: false
  },
  operativo: {
    cierre_turno: true,
    cierre_inventarios: true
  }
};

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
  const module = String(moduleKey || "").trim().toLowerCase();
  const policy = LOCAL_ROLE_ACCESS[safeRole] || {};
  if (policy.all === true) return true;
  return policy[module] === true;
}

export function getHomeByRole(role) {
  const safeRole = normalizeRole(role);
  if (safeRole === "operativo") return "/Plataforma_Restaurantes/cierre_turno/";
  return "/Plataforma_Restaurantes/dashboard/";
}

export function resolveDefaultRouteForRoleEnv(role, env) {
  const safeRole = normalizeRole(role);
  if (env === ENV_SIIGO) {
    if (safeRole === "operativo") return "/Plataforma_Restaurantes/cierre_turno/";
    return "/Plataforma_Restaurantes/siigo/dashboard_siigo/";
  }
  return safeRole === "operativo"
    ? "/Plataforma_Restaurantes/cierre_turno/"
    : "/Plataforma_Restaurantes/dashboard/";
}


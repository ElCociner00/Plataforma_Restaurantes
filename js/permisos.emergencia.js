/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/permisos.emergencia.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizeRole` (línea aprox. 1): Bloque funcional del módulo.
 * - `normalizeModule` (línea aprox. 2): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
const normalizeRole = (value) => String(value || "").trim().toLowerCase();
const normalizeModule = (value) => String(value || "").trim().toLowerCase();

export const EMERGENCY_ROLE_PERMISSIONS = {
  admin_root: {
    "*": true
  },
  admin: {
    dashboard: true,
    cierre_turno: true,
    historico_cierre_turno: true,
    cierre_inventarios: true,
    historico_cierre_inventarios: true,
    loggro: true,
    inventarios: true,
    facturacion: true,
    dashboard_siigo: true,
    subir_facturas_siigo: true,
    historico_facturas_siigo: true,
    nomina: true,
    configuracion: false,
    gestion_usuarios: false,
    permisos: false,
    registro_empleados: false,
    registro_otros_usuarios: false,
    configuracion_siigo: false
  },
  operativo: {
    cierre_turno: true,
    cierre_inventarios: true
  }
};

export function isEmergencyAllowed(role, moduleKey) {
  const roleKey = normalizeRole(role);
  const module = normalizeModule(moduleKey);
  if (!roleKey || !module) return false;

  const policy = EMERGENCY_ROLE_PERMISSIONS[roleKey] || {};
  if (policy["*"] === true) return true;
  return policy[module] === true;
}

export function getEmergencyHomeByRole(role) {
  const roleKey = normalizeRole(role);
  if (roleKey === "operativo") return APP_URLS.cierreTurno;
  return APP_URLS.dashboard;
}

export function applyEmergencyRolePermissions(role, permisos) {
  const roleKey = normalizeRole(role);
  const policy = EMERGENCY_ROLE_PERMISSIONS[roleKey];
  if (!policy || typeof policy !== "object") return Array.isArray(permisos) ? permisos : [];

  const current = new Map(
    (Array.isArray(permisos) ? permisos : [])
      .map((row) => [normalizeModule(row?.modulo), row?.permitido === true])
      .filter(([module]) => Boolean(module))
  );

  Object.entries(policy).forEach(([module, allowed]) => {
    if (module === "*") return;
    current.set(normalizeModule(module), allowed === true);
  });

  return Array.from(current.entries()).map(([modulo, permitido]) => ({ modulo, permitido }));
}
import { APP_URLS } from "./urls.js";


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
  if (roleKey === "operativo") return "/Plataforma_Restaurantes/cierre_turno/";
  return "/Plataforma_Restaurantes/dashboard/";
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


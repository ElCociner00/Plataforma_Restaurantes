// /js/permissions.js
export const PERMISSIONS = {
  dashboard: ["admin_root", "admin", "revisor"],
  cierre_turno: ["admin_root", "admin", "operativo", "revisor"],
  historico_cierre_turno: ["admin_root", "admin", "revisor"],
  cierre_inventarios: ["admin_root", "admin", "operativo", "revisor"],
  configuracion: ["admin_root", "admin"],
  loggro: ["admin_root", "admin"],
  visualizacion_cierre_turno: ["admin_root", "admin"],
  visualizacion_cierre_turno_historico: ["admin_root", "admin"],
  visualizacion_cierre_inventarios: ["admin_root", "admin"],
  inventarios: ["admin_root", "admin", "operativo", "revisor"],
  nomina: ["admin_root", "admin"],
  permisos: ["admin_root", "admin"]
};

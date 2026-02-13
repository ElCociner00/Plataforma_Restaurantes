// /js/permissions.js
export const PERMISSIONS = {
  dashboard: ["admin_root", "admin", "revisor"],
  cierre_turno: ["admin_root", "admin", "operativo", "revisor"],
  historico_cierre_turno: ["admin_root", "admin", "revisor"],
  cierre_inventarios: ["admin_root", "admin", "operativo", "revisor"],
  historico_cierre_inventarios: ["admin_root", "admin", "revisor"],
  configuracion: ["admin_root", "admin"],
  loggro: ["admin_root", "admin"],
  visualizacion_cierre_turno: ["admin_root", "admin"],
  visualizacion_cierre_turno_historico: ["admin_root", "admin"],
  visualizacion_cierre_inventarios: ["admin_root", "admin"],
  visualizacion_cierre_inventarios_historico: ["admin_root", "admin"],
  inventarios: ["admin_root", "admin", "operativo", "revisor"],
  dashboard_siigo: ["admin_root", "admin", "operativo", "revisor"],
  subir_facturas_siigo: ["admin_root", "admin", "operativo", "revisor"],
  configuracion_siigo: ["admin_root", "admin"],
  nomina: ["admin_root", "admin"],
  permisos: ["admin_root", "admin"]
};

export const PAGE_ENVIRONMENT = {
  dashboard: "loggro",
  cierre_turno: "loggro",
  historico_cierre_turno: "loggro",
  cierre_inventarios: "loggro",
  historico_cierre_inventarios: "loggro",
  configuracion: "loggro",
  loggro: "loggro",
  visualizacion_cierre_turno: "loggro",
  visualizacion_cierre_turno_historico: "loggro",
  visualizacion_cierre_inventarios: "loggro",
  visualizacion_cierre_inventarios_historico: "loggro",
  inventarios: "loggro",
  dashboard_siigo: "siigo",
  subir_facturas_siigo: "siigo",
  configuracion_siigo: "siigo"
};

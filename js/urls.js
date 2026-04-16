const PLATFORM_DEFAULT_ORIGIN = "https://restaurantes.enkrato.com";
const LEGACY_BASE_PATH = "/Plataforma_Restaurantes";

const hasWindow = typeof window !== "undefined";
const runtimePath = hasWindow ? String(window.location.pathname || "/") : "/";
const runtimeOrigin = hasWindow ? String(window.location.origin || PLATFORM_DEFAULT_ORIGIN) : PLATFORM_DEFAULT_ORIGIN;

const isLegacyPath = runtimePath === LEGACY_BASE_PATH || runtimePath.startsWith(`${LEGACY_BASE_PATH}/`);
const isGithubPages = runtimeOrigin.includes("github.io");

export const APP_ORIGIN = runtimeOrigin;
export const APP_BASE_PATH = (isLegacyPath || isGithubPages) ? LEGACY_BASE_PATH : "";

const normalizePath = (path) => {
  const raw = String(path || "/").trim();
  if (!raw) return "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
};

export const buildAppPath = (path) => {
  const normalized = normalizePath(path);
  if (!APP_BASE_PATH) return normalized;
  return `${APP_BASE_PATH}${normalized === "/" ? "/" : normalized}`;
};

export const buildAppUrl = (path) => `${APP_ORIGIN}${buildAppPath(path)}`;

export const APP_URLS = {
  root: buildAppPath("/"),
  login: buildAppPath("/index.html"),
  dashboard: buildAppPath("/dashboard/"),
  registroEmpresa: buildAppPath("/registro/index.html"),
  registroUsuario: buildAppPath("/registro/usuario.html"),
  cierreTurno: buildAppPath("/cierre_turno/"),
  historicoCierreTurno: buildAppPath("/cierre_turno/historico_cierre_turno.html"),
  cierreInventarios: buildAppPath("/cierre_inventarios/"),
  historicoCierreInventarios: buildAppPath("/cierre_inventarios/historico_cierre_inventarios.html"),
  inventarios: buildAppPath("/inventarios/"),
  configuracion: buildAppPath("/configuracion/"),
  loggro: buildAppPath("/configuracion/loggro.html"),
  visualizacionCierreTurno: buildAppPath("/configuracion/visualizacion_cierre_turno.html"),
  visualizacionCierreTurnoHistorico: buildAppPath("/configuracion/visualizacion_cierre_turno_historico.html"),
  visualizacionCierreInventarios: buildAppPath("/configuracion/visualizacion_cierre_inventarios.html"),
  visualizacionCierreInventariosHistorico: buildAppPath("/configuracion/visualizacion_cierre_inventarios_historico.html"),
  permisos: buildAppPath("/configuracion/permisos.html"),
  registroEmpleados: buildAppPath("/configuracion/registro_empleados.html"),
  registroOtrosUsuarios: buildAppPath("/configuracion/registro_otros_usuarios.html"),
  gestionUsuarios: buildAppPath("/configuracion/gestion_usuarios.html"),
  gestionEmpresas: buildAppPath("/gestion_empresas/"),
  facturacion: buildAppPath("/facturacion/"),
  revisionPagos: buildAppPath("/facturacion/revision_pagos.html"),
  dashboardSiigo: buildAppPath("/siigo/dashboard_siigo/"),
  configuracionSiigo: buildAppPath("/siigo/configuracion_siigo/"),
  subirFacturasSiigo: buildAppPath("/siigo/subir_facturas_siigo/"),
  historicoFacturasSiigo: buildAppPath("/siigo/subir_facturas_siigo/"),
  nomina: buildAppPath("/nomina/"),
  logoImage: buildAppPath("/images/Logo.webp"),
  mobileCss: buildAppPath("/css/mobile_native.css"),
  impagoBannerHtml: buildAppPath("/components/banner_impago.html"),
  impagoBannerCss: buildAppPath("/css/banner_impago.css"),
  legalTerminos: buildAppPath("/legal/terminos.html"),
  legalPrivacidad: buildAppPath("/legal/privacidad.html"),
  legalCookies: buildAppPath("/legal/cookies.html"),
  legalDatos: buildAppPath("/legal/datos.html"),
  legalResponsabilidad: buildAppPath("/legal/responsabilidad.html"),
  legalSeguridad: buildAppPath("/legal/seguridad.html"),
  legalConsentimientos: buildAppPath("/legal/consentimientos.html")
};

export const PUBLIC_PATHS = [
  APP_URLS.root,
  APP_URLS.login,
  APP_URLS.registroEmpresa,
  APP_URLS.registroUsuario
];

import { getUserContext } from "./session.js";
import { PAGE_ENVIRONMENT } from "./permissions.js";
import { esSuperAdmin, permisosCacheGet, tienePermiso } from "./permisos.core.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const SELECTOR_URL = "/Plataforma_Restaurantes/entorno/";
let isRedirecting = false;

const getForbiddenRedirect = (context) => {
  const env = localStorage.getItem("app_entorno_activo") || "loggro";
  if (env === "siigo") {
    return "/Plataforma_Restaurantes/siigo/subir_facturas_siigo/";
  }

  if (context?.rol === "operativo") {
    return "/Plataforma_Restaurantes/cierre_turno/";
  }

  return "/Plataforma_Restaurantes/dashboard/";
};

const safeRedirect = (targetUrl) => {
  if (!targetUrl || isRedirecting) return;

  const normalizePath = (value) => String(value || "").replace(/\/+$/, "");
  const currentPath = normalizePath(window.location.pathname);
  const targetPath = normalizePath(targetUrl);
  if (currentPath === targetPath) return;

  isRedirecting = true;
  window.location.href = targetUrl;
};

export async function guardPage(pageKey, permisosOverride = null) {
  const context = await getUserContext();

  if (!context) {
    safeRedirect(LOGIN_URL);
    return;
  }

  if (pageKey === "gestion_empresas" && !(await esSuperAdmin())) {
    console.warn("Acceso denegado a gestion empresas (solo super admin)");
    safeRedirect("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  const expectedEnvironment = pageKey === "facturacion" || pageKey === "gestion_empresas"
    ? null
    : PAGE_ENVIRONMENT[pageKey];
  const activeEnvironment = localStorage.getItem("app_entorno_activo");

  if (expectedEnvironment && !activeEnvironment) {
    safeRedirect(SELECTOR_URL);
    return;
  }

  if (expectedEnvironment && activeEnvironment && expectedEnvironment !== activeEnvironment) {
    alert("Este modulo pertenece a otro entorno.");
    safeRedirect(SELECTOR_URL);
    return;
  }

  const permisos = permisosOverride || permisosCacheGet();
  if (!context.empresa_id || !permisos) {
    safeRedirect(getForbiddenRedirect(context));
    return;
  }

  const allowed = tienePermiso(pageKey, permisos);

  if (!allowed) {
    alert("No tienes permisos para acceder a este modulo");
    safeRedirect(getForbiddenRedirect(context));
  }
}


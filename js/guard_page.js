import { getUserContext } from "./session.js";
import { PAGE_ENVIRONMENT } from "./permissions.js";
import { esSuperAdmin, getPermisosEfectivos, permisosCacheGet, permisosCacheSet, tienePermiso } from "./permisos.core.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const SELECTOR_URL = "/Plataforma_Restaurantes/entorno/";
let isRedirecting = false;

const FALLBACK_ROUTES = [
  "cierre_turno",
  "cierre_inventarios",
  "historico_cierre_turno",
  "historico_cierre_inventarios",
  "dashboard",
  "facturacion"
];

const toModulePath = (moduleKey) => {
  const map = {
    dashboard: "/Plataforma_Restaurantes/dashboard/",
    cierre_turno: "/Plataforma_Restaurantes/cierre_turno/",
    historico_cierre_turno: "/Plataforma_Restaurantes/cierre_turno/historico_cierre_turno.html",
    cierre_inventarios: "/Plataforma_Restaurantes/cierre_inventarios/",
    historico_cierre_inventarios: "/Plataforma_Restaurantes/cierre_inventarios/historico_cierre_inventarios.html",
    facturacion: "/Plataforma_Restaurantes/facturacion/"
  };
  return map[moduleKey] || SELECTOR_URL;
};

const getForbiddenRedirect = (context, permisos = null, isSuper = false) => {
  if (isSuper) return "/Plataforma_Restaurantes/gestion_empresas/";

  const env = localStorage.getItem("app_entorno_activo") || "loggro";
  if (env === "siigo") {
    return "/Plataforma_Restaurantes/siigo/dashboard_siigo/";
  }

  if (String(context?.rol || "").toLowerCase() === "operativo") {
    return "/Plataforma_Restaurantes/cierre_turno/";
  }

  const permisosArray = Array.isArray(permisos) ? permisos : [];
  for (const moduleKey of FALLBACK_ROUTES) {
    if (tienePermiso(moduleKey, permisosArray)) {
      return toModulePath(moduleKey);
    }
  }

  return SELECTOR_URL;
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

async function ensurePermisos(context, override) {
  if (override) return override;
  const cached = permisosCacheGet();
  if (cached) return cached;
  if (!context?.empresa_id || !context?.user) return null;
  const userId = context.user.id || context.user.user_id;
  if (!userId) return null;
  const permisos = await getPermisosEfectivos(userId, context.empresa_id).catch(() => null);
  permisosCacheSet(permisos);
  return permisos;
}

export async function guardPage(pageKey, permisosOverride = null) {
  const context = await getUserContext();
  const isSuper = await esSuperAdmin().catch(() => false);
  const userId = context?.user?.id || context?.user?.user_id;

  if (!context && !isSuper) {
    safeRedirect(LOGIN_URL);
    return;
  }

  if (pageKey === "gestion_empresas" && !isSuper) {
    console.warn("Acceso denegado a gestion empresas (solo super admin)");
    safeRedirect(getForbiddenRedirect(context));
    return;
  }

  const expectedEnvironment = pageKey === "facturacion" || pageKey === "gestion_empresas" || isSuper
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

  if (isSuper && (pageKey === "gestion_empresas" || pageKey === "facturacion")) {
    return;
  }

  const permisos = await ensurePermisos(context, permisosOverride);
  if (!context?.empresa_id || !permisos) {
    safeRedirect(getForbiddenRedirect(context, permisos, isSuper));
    return;
  }

  const allowed = tienePermiso(pageKey, permisos);

  if (!allowed) {
    alert("No tienes permisos para acceder a este modulo");
    safeRedirect(getForbiddenRedirect(context, permisos, isSuper));
  }
}


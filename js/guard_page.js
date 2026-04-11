import { getUserContext } from "./session.js";
import { esSuperAdmin, getPermisosEfectivos } from "./permisos.core.js";
import { getActiveEnvironment, setActiveEnvironment } from "./environment.js";
import {
  buildAccessMap,
  getHomeByRole,
  hasLocalAccess,
  MODULE_ENV_MAP,
  resolveFirstAllowedRoute
} from "./access_control.local.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const GUARD_REASON_KEY = "app_guard_reason";
let redirectInFlight = false;

const toRole = (context, isSuper) => {
  if (isSuper) return "admin_root";
  return String(context?.rol || "operativo").trim().toLowerCase() || "operativo";
};

const normalizePath = (value) => String(value || "")
  .replace(/\/index\.html$/i, "")
  .replace(/\/+$/, "") || "/";

const redirectWithReason = (url, reason) => {
  if (!url || redirectInFlight) return;
  const current = normalizePath(window.location.pathname);
  const target = normalizePath(url);
  if (current === target) return;

  try {
    if (reason) sessionStorage.setItem(GUARD_REASON_KEY, reason);
  } catch (_error) {
    // noop
  }

  redirectInFlight = true;
  window.location.href = url;
};

export async function guardPage(pageKey) {
  const context = await getUserContext().catch(() => null);
  const isSuper = await esSuperAdmin().catch(() => false);

  if (!context && !isSuper) {
    redirectWithReason(LOGIN_URL, "Sesion no valida. Inicia sesion de nuevo.");
    return;
  }

  const normalizedPage = String(pageKey || "").trim().toLowerCase();
  const requiredEnv = MODULE_ENV_MAP[normalizedPage] || "";
  let role = toRole(context, isSuper);
  const permisosRows = [];

  if (requiredEnv) {
    const activeEnv = getActiveEnvironment();
    if (activeEnv !== requiredEnv) {
      setActiveEnvironment(requiredEnv);
    }
  }

  if (pageKey === "gestion_empresas" && role !== "admin_root") {
    redirectWithReason(getHomeByRole(role), "Solo admin root puede entrar a Gestion de empresas.");
    return;
  }

  const accessMap = buildAccessMap(role, permisosRows);
  const hasEffectiveAccess = accessMap.get(normalizedPage) === true;
  const hasFallbackAccess = hasLocalAccess(role, normalizedPage);
  const canAccessPage = hasEffectiveAccess || hasFallbackAccess;

  if (!canAccessPage) {
    const redirectTarget = resolveFirstAllowedRoute(role, requiredEnv || getActiveEnvironment(), permisosRows);
    redirectWithReason(redirectTarget, "Tu rol no tiene acceso a este modulo.");
  }
}

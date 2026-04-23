/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/router.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizePath` (línea aprox. 15): Bloque funcional del módulo.
 * - `revealPage` (línea aprox. 22): Bloque funcional del módulo.
 * - `rememberRequestedPath` (línea aprox. 27): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { supabase } from "./supabase.js";
import { APP_ROUTES } from "./config.js";
import { resolvePostLoginRoute } from "./post_login_route.js";
import { PUBLIC_PATHS } from "./urls.js";

const LOGIN_URL = APP_ROUTES.login;
const DASHBOARD_URL = APP_ROUTES.dashboard;
const REDIRECT_AFTER_LOGIN_KEY = "redirect_after_login";

const DEFAULT_PUBLIC_PATHS = new Set(PUBLIC_PATHS);

let routerInitialized = false;


function normalizePath(pathname) {
  const normalized = String(pathname || "/")
    .replace(/\/index\.html$/i, "/")
    .replace(/\/+$/, "") || "/";
  return normalized;
}

function revealPage() {
  if (typeof document === "undefined" || !document.body) return;
  document.body.style.display = "block";
}

function rememberRequestedPath() {
  try {
    sessionStorage.setItem(REDIRECT_AFTER_LOGIN_KEY, window.location.pathname);
  } catch (_error) {
    // noop
  }
}

export function isPublicPath(customPublicPaths = []) {
  const current = normalizePath(window.location.pathname);
  const all = new Set([...DEFAULT_PUBLIC_PATHS, ...customPublicPaths]);
  for (const candidate of all) {
    if (normalizePath(candidate) === current) return true;
  }
  return false;
}

export async function protectCurrentPage({ loginUrl = LOGIN_URL, publicPaths = [] } = {}) {
  if (isPublicPath(publicPaths)) {
    revealPage();
    return true;
  }

  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    rememberRequestedPath();
    window.location.href = loginUrl;
    return false;
  }

  const deferReveal = document?.body?.dataset?.deferReveal === "true";
  if (!deferReveal) revealPage();
  return true;
}

export function initAuthRouter({ loginUrl = LOGIN_URL, publicPaths = [] } = {}) {
  if (routerInitialized) {
    return protectCurrentPage({ loginUrl, publicPaths });
  }

  routerInitialized = true;

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" && !isPublicPath(publicPaths)) {
      rememberRequestedPath();
      window.location.href = loginUrl;
      return;
    }

    if (event === "SIGNED_IN" && session && normalizePath(window.location.pathname) === normalizePath(loginUrl)) {
      resolvePostLoginRoute()
        .then((route) => { window.location.href = route; })
        .catch(() => { window.location.href = DASHBOARD_URL; });
    }
  });

  return protectCurrentPage({ loginUrl, publicPaths });
}

if (typeof window !== "undefined") {
  initAuthRouter().catch((error) => {
    console.error("Error inicializando auth router:", error);
    revealPage();
  });
}

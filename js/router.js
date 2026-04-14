import { supabase } from "./supabase.js";
import { APP_ROUTES } from "./config.js";

const LOGIN_URL = APP_ROUTES.login;
const DASHBOARD_URL = APP_ROUTES.dashboard;
const REDIRECT_AFTER_LOGIN_KEY = "redirect_after_login";

const DEFAULT_PUBLIC_PATHS = new Set([
  "/Plataforma_Restaurantes/index.html",
  "/Plataforma_Restaurantes/",
  "/Plataforma_Restaurantes/registro/",
  "/Plataforma_Restaurantes/registro/index.html",
  "/Plataforma_Restaurantes/registro/usuario.html"
]);

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

  revealPage();
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
      window.location.href = DASHBOARD_URL;
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

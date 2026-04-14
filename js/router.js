import { supabase } from "./supabase.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const DEFAULT_PUBLIC_PATHS = new Set([
  "/Plataforma_Restaurantes/index.html",
  "/Plataforma_Restaurantes/",
  "/Plataforma_Restaurantes/registro/",
  "/Plataforma_Restaurantes/registro/index.html",
  "/Plataforma_Restaurantes/registro/usuario.html"
]);

function normalizePath(pathname) {
  const normalized = String(pathname || "/")
    .replace(/\/index\.html$/i, "/")
    .replace(/\/+$/, "") || "/";
  return normalized;
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
  if (isPublicPath(publicPaths)) return true;

  const { data } = await supabase.auth.getSession();
  if (!data?.session) {
    window.location.href = loginUrl;
    return false;
  }

  return true;
}

export function initAuthRouter({ loginUrl = LOGIN_URL, publicPaths = [] } = {}) {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" && !isPublicPath(publicPaths)) {
      window.location.href = loginUrl;
    }

    if (event === "SIGNED_IN" && session && normalizePath(window.location.pathname) === normalizePath(loginUrl)) {
      window.location.href = "/Plataforma_Restaurantes/dashboard/";
    }
  });

  return protectCurrentPage({ loginUrl, publicPaths });
}

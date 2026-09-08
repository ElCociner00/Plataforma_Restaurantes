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
import { PUBLIC_PATHS, APP_URLS } from "./urls.js";
import { applyBrandingToDocumentTitle } from "./branding.js";
import { getUserContext } from "./session.js";

const LOGIN_URL = APP_ROUTES.login;
const DASHBOARD_URL = APP_ROUTES.dashboard;
const REDIRECT_AFTER_LOGIN_KEY = "redirect_after_login";

const DEFAULT_PUBLIC_PATHS = new Set(PUBLIC_PATHS);

/**
 * Rutas que siguen abiertas con la cuenta limitada.
 *
 * Una cuenta bloqueada por no activar, o dada de baja, conserva el acceso a
 * facturación: es desde donde el cliente activa su prueba, retoma el plan o
 * descarga sus datos. Cerrarle también esa puerta lo dejaría sin salida.
 * Ver docs/2026-08-25_plan_ciclo_de_vida_cliente.md §2.2.
 */
const RUTAS_SIEMPRE_ABIERTAS = ["/facturacion", "/legal", "/inicio", "/contexto_local"];

const rutaSiempreAbierta = (pathname) => {
  const ruta = normalizePath(pathname);
  return RUTAS_SIEMPRE_ABIERTAS.some((base) => ruta === base || ruta.startsWith(`${base}/`));
};

/**
 * Comprueba el nivel de acceso de la cuenta y, si está limitada, manda a
 * facturación con el motivo.
 *
 * Esta es solo la primera capa: la que de verdad corta es
 * exigir_acceso_escritura() en la base y exigirAccesoEscritura() en las Edge
 * Functions. Aquí se hace para que el usuario reciba una explicación en vez de
 * un error al intentar guardar algo.
 */
async function comprobarAccesoDeCuenta() {
  if (rutaSiempreAbierta(window.location.pathname)) return true;

  const { data, error } = await supabase.rpc("acceso_de_empresa", { p_empresa_id: null });

  // Ante la duda, se deja pasar: es peor bloquear a un cliente al día por un
  // fallo nuestro que dejar entrar a uno limitado, que igual no podrá escribir.
  if (error || !data) return true;
  if (data.nivel === "total") return true;

  try {
    sessionStorage.setItem("acceso_limitado_motivo", String(data.motivo || ""));
  } catch (_error) {
    // noop
  }

  window.location.replace(APP_URLS.facturacion);
  return false;
}

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

  const context = await getUserContext().catch(() => null);
  if (!context) {
    rememberRequestedPath();
    await supabase.auth.signOut().catch(() => {});
    window.location.href = loginUrl;
    return false;
  }

  // Ciclo de vida de la cuenta: sin activar o dada de baja -> a facturación.
  if (!(await comprobarAccesoDeCuenta())) return false;

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
  applyBrandingToDocumentTitle();
  initAuthRouter().catch((error) => {
    console.error("Error inicializando auth router:", error);
    revealPage();
  });
}

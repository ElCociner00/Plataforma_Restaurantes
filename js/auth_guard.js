import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";
import { esSuperAdmin, getPermisosEfectivos, permisosCacheSet } from "./permisos.core.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const SELECTOR_URL = "/Plataforma_Restaurantes/entorno/";
let permisosHydrated = false;

function redirectToLogin() {
  window.location.replace(LOGIN_URL);
}

function protectInteractions() {
  ["click", "keydown", "touchstart"].forEach((event) => {
    document.addEventListener(event, async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) redirectToLogin();
    });
  });
}

const enforceSessionAndEnvironment = (session) => {
  if (!session) {
    redirectToLogin();
    return false;
  }

  const currentPath = String(window.location.pathname || "");
  const isSelectorPage = window.location.pathname.includes("/entorno/");
  const isGlobalNoTenantPage = currentPath.includes("/gestion_empresas/") || currentPath.includes("/facturacion/");
  const entornoActivo = localStorage.getItem("app_entorno_activo");

  if (!isSelectorPage && !isGlobalNoTenantPage && !entornoActivo) {
    window.location.replace(SELECTOR_URL);
    return false;
  }

  return true;
};

const hydratePermisosCache = async () => {
  if (permisosHydrated) return;

  const context = await getUserContext();
  const isSuper = await esSuperAdmin().catch(() => false);
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id;
  if (isSuper && !empresaId) {
    permisosCacheSet([]);
    permisosHydrated = true;
    return;
  }
  if (!userId || !empresaId) return;

  const permisos = await getPermisosEfectivos(userId, empresaId);
  permisosCacheSet(permisos);
  permisosHydrated = true;
};

document.addEventListener("DOMContentLoaded", async () => {
  const { data: initial } = await supabase.auth.getSession();
  if (!enforceSessionAndEnvironment(initial.session)) return;
  await hydratePermisosCache().catch(() => {});

  document.body.style.display = "block";
  protectInteractions();

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!enforceSessionAndEnvironment(session)) return;
    hydratePermisosCache().catch(() => {});
    document.body.style.display = "block";
  });

  window.addEventListener("beforeunload", () => {
    listener.subscription.unsubscribe();
  });
});

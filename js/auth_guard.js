import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";
import { getPermisosEfectivos, permisosCacheSet } from "./permisos.core.js";

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

  const isSelectorPage = window.location.pathname.includes("/entorno/");
  const entornoActivo = localStorage.getItem("app_entorno_activo");

  if (!isSelectorPage && !entornoActivo) {
    window.location.replace(SELECTOR_URL);
    return false;
  }

  return true;
};

const hydratePermisosCache = async () => {
  if (permisosHydrated) return;

  const context = await getUserContext();
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id;
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

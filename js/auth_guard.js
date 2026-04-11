import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";
import { esSuperAdmin, getPermisosEfectivos, permisosCacheSet } from "./permisos.core.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
let permisosHydrated = false;
const GUARD_REASON_KEY = "app_guard_reason";

function redirectToLogin(reason = "Tu sesion no es valida. Inicia sesion nuevamente.") {
  try {
    sessionStorage.setItem(GUARD_REASON_KEY, reason);
  } catch (_error) {
    // noop
  }
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

const enforceSession = (session) => {
  if (!session) {
    redirectToLogin("Tu sesion ha finalizado o no existe.");
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
  if (!enforceSession(initial.session)) return;
  await hydratePermisosCache().catch(() => {});

  document.body.style.display = "block";
  protectInteractions();

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!enforceSession(session)) return;
    hydratePermisosCache().catch(() => {});
    document.body.style.display = "block";
  });

  window.addEventListener("beforeunload", () => {
    listener.subscription.unsubscribe();
  });
});

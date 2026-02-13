import { supabase } from "./supabase.js";

const LOGIN_URL = "/Plataforma_Restaurantes/index.html";
const SELECTOR_URL = "/Plataforma_Restaurantes/entorno/";

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

document.addEventListener("DOMContentLoaded", async () => {
  const { data: initial } = await supabase.auth.getSession();
  if (!enforceSessionAndEnvironment(initial.session)) return;

  document.body.style.display = "block";
  protectInteractions();

  const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
    if (!enforceSessionAndEnvironment(session)) return;
    document.body.style.display = "block";
  });

  window.addEventListener("beforeunload", () => {
    listener.subscription.unsubscribe();
  });
});

import { supabase } from "./supabase.js";
import { APP_ROUTES } from "./config.js";

const DASHBOARD_REDIRECT_PATH = APP_ROUTES.dashboard;
const LOGIN_URL = APP_ROUTES.login;
const REDIRECT_AFTER_LOGIN_KEY = "redirect_after_login";

/**
 * Obtiene el usuario actual desde la sesión activa de Supabase.
 */
export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("Error al obtener usuario actual:", error);
    return null;
  }
  return data?.user || null;
}

/**
 * Envía un Magic Link al correo indicado.
 */
export async function signInWithMagicLink(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw new Error("Debes indicar un correo válido.");

  const { data, error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      emailRedirectTo: `${window.location.origin}${DASHBOARD_REDIRECT_PATH}`,
      shouldCreateUser: true
    }
  });

  if (error) throw error;
  return data;
}

/**
 * Cierra sesión y redirige al login.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("Error al cerrar sesión:", error);
  }
  window.location.href = LOGIN_URL;
}

function consumeRedirectAfterLogin() {
  try {
    const nextPath = sessionStorage.getItem(REDIRECT_AFTER_LOGIN_KEY);
    if (!nextPath) return null;
    sessionStorage.removeItem(REDIRECT_AFTER_LOGIN_KEY);
    return nextPath;
  } catch (_error) {
    return null;
  }
}

function bindLoginForm() {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("emailInput") || document.getElementById("email");
  const statusEl = document.getElementById("status");

  if (!form || !emailInput) return;

  const pendingRedirect = consumeRedirectAfterLogin();
  if (statusEl && pendingRedirect) {
    statusEl.textContent = "Tu sesión expiró. Inicia nuevamente para continuar.";
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = emailInput.value.trim();
    if (statusEl) statusEl.textContent = "Enviando enlace mágico...";

    try {
      await signInWithMagicLink(email);
      if (statusEl) {
        statusEl.textContent = "✅ Revisa tu correo. Te enviamos un enlace para ingresar.";
      }
      emailInput.value = "";
    } catch (error) {
      console.error(error);
      if (statusEl) {
        statusEl.textContent = "❌ No pudimos enviar el enlace. Verifica el correo e intenta de nuevo.";
      }
    }
  });
}

if (typeof window !== "undefined") {
  bindLoginForm();
}

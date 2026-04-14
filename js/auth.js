import { supabase } from "./supabase.js";
import { APP_ROUTES } from "./config.js";

const LOGIN_URL = APP_ROUTES.login;
const DASHBOARD_URL = APP_ROUTES.dashboard;

/**
 * Verifica si hay una sesión activa.
 */
export async function getCurrentUser() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error) {
    console.error("Error al obtener usuario:", error);
    return null;
  }
  return user;
}

/**
 * Inicia sesión con Email y Contraseña.
 */
export async function signInWithPassword(email, password) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPassword = String(password || "");

  if (!normalizedEmail || !normalizedPassword) {
    throw new Error("Debes ingresar correo y contraseña.");
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizedEmail,
    password: normalizedPassword
  });

  if (error) throw error;
  return data;
}

/**
 * Cierra sesión y redirige al login.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error("Error al cerrar sesión:", error);
  window.location.href = LOGIN_URL;
}

function bindLoginForm() {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorEl = document.getElementById("error-message");

  if (!form || !emailInput || !passwordInput) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (errorEl) errorEl.textContent = "";

    try {
      await signInWithPassword(emailInput.value, passwordInput.value);
      window.location.href = DASHBOARD_URL;
    } catch (error) {
      console.error("Error de inicio de sesión:", error);
      if (!errorEl) return;

      const message = String(error?.message || "");
      if (message.toLowerCase().includes("invalid login credentials")) {
        errorEl.textContent = "Correo o contraseña incorrectos.";
      } else {
        errorEl.textContent = "Error de conexión. Inténtalo de nuevo.";
      }
    }
  });
}

if (typeof window !== "undefined") {
  bindLoginForm();
}

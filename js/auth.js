import { supabase } from "./supabase.js";
import { APP_ROUTES } from "./config.js";

const DASHBOARD_URL = '/Plataforma_Restaurantes/dashboard/';
const LOGIN_URL = APP_ROUTES.login;

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

  // Redirección inmediata tras autenticación exitosa.
  window.location.href = DASHBOARD_URL;
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

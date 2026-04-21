import { supabase } from "./supabase.js";
import { APP_URLS } from "./urls.js";

const LOGIN_URL = APP_URLS.login;

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

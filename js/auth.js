/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/auth.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - Este archivo está orientado a configuración/arranque sin funciones explícitas extensas.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
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

/**
 * Inicia sesión con Google (OAuth 2.0).
 *
 * El destino de retorno se deriva de la URL actual en lugar de construirse
 * con APP_URLS, para que el flujo funcione igual en produccion, en GitHub
 * Pages y en Live Server, donde la profundidad de carpeta puede variar.
 * Esa misma URL debe estar dada de alta en Supabase → Authentication →
 * URL Configuration → Redirect URLs, o el proveedor rechaza el retorno.
 *
 * No redirige por su cuenta: signInWithOAuth navega el navegador a Google.
 * Al volver, el cliente de Supabase captura la sesion automaticamente
 * gracias a detectSessionInUrl: true (ver js/supabase.js) y la persiste en
 * localStorage. Quien decide la ruta posterior es la vista de login.
 */
export async function signInWithGoogle({ redirectTo } = {}) {
  const target = redirectTo || `${window.location.origin}${window.location.pathname}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: target,
      queryParams: {
        prompt: "select_account"
      }
    }
  });

  if (error) throw error;
  return data;
}

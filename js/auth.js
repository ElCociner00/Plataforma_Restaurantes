import { supabase } from "./supabase.js";
import { APP_URLS } from "./urls.js";
import { getUserContext } from "./session.js";
import { getPermisosEfectivos } from "./permisos.core.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";
import { ENV_LOGGRO } from "./environment.js";

const DASHBOARD_URL = APP_URLS.dashboard;
const LOGIN_URL = APP_URLS.login;

async function resolvePostLoginRoute() {
  const context = await getUserContext().catch(() => null);
  if (!context) return DASHBOARD_URL;

  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id || null;
  const permisos = userId ? await getPermisosEfectivos(userId, empresaId).catch(() => []) : [];
  return resolveFirstAllowedRoute(context?.rol, ENV_LOGGRO, permisos);
}

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

  const targetRoute = await resolvePostLoginRoute().catch(() => DASHBOARD_URL);
  window.location.href = targetRoute;
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

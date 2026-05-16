import { supabase } from "./supabase.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const estado = document.getElementById("estadoReset");

const setEstado = (m) => { if (estado) estado.textContent = m || ""; };

const hasRecoveryTokens = () => {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  return Boolean(
    hash.get("access_token") || query.get("access_token") ||
    hash.get("token_hash") || query.get("token_hash")
  );
};

if (!hasRecoveryTokens()) {
  setEstado("Enlace de recuperación incompleto. Configura la plantilla de Supabase con token_hash/access_token y solicita un nuevo correo.");
}

const ensureRecoverySession = async () => {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");

  const access_token = hash.get("access_token") || query.get("access_token");
  const refresh_token = hash.get("refresh_token") || query.get("refresh_token");
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  const token_hash = hash.get("token_hash") || query.get("token_hash");
  const type = hash.get("type") || query.get("type");
  if (token_hash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: "recovery" });
    if (error) throw error;
    return;
  }

  const { data } = await supabase.auth.getSession();
  if (!data?.session) throw new Error("Auth session missing!");
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nueva = String(nuevaContrasena?.value || "").trim();
  if (!nueva) return setEstado("Ingresa una nueva contraseña.");

  try {
    await ensureRecoverySession();
  } catch (error) {
    return setEstado("Enlace inválido o expirado. Solicita un nuevo correo de recuperación.");
  }

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return setEstado(`No se pudo actualizar: ${error.message || "sin detalle"}`);

  setEstado("Contraseña actualizada. Inicia sesión nuevamente.");
  await supabase.auth.signOut();
  window.location.href = "../index.html";
});

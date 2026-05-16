import { supabase } from "./supabase.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const toggleNuevaContrasena = document.getElementById("toggleNuevaContrasena");
const estado = document.getElementById("estadoReset");

const setEstado = (m) => { if (estado) estado.textContent = m || ""; };

const getRecoveryParams = () => {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  return {
    access_token: hash.get("access_token") || query.get("access_token"),
    refresh_token: hash.get("refresh_token") || query.get("refresh_token"),
    token_hash: hash.get("token_hash") || query.get("token_hash"),
    type: hash.get("type") || query.get("type")
  };
};

const hasRecoveryTokens = () => {
  const params = getRecoveryParams();
  return Boolean(params.access_token || params.token_hash);
};

if (!hasRecoveryTokens()) {
  setEstado("Enlace inválido o incompleto. Solicita un nuevo correo de recuperación.");
}

const ensureRecoverySession = async () => {
  const { access_token, refresh_token, token_hash, type } = getRecoveryParams();

  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  if (token_hash && type === "recovery") {
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: "recovery" });
    if (error) throw error;
    return;
  }

  throw new Error("Missing recovery tokens");
};

toggleNuevaContrasena?.addEventListener("click", () => {
  if (!nuevaContrasena) return;
  const showing = nuevaContrasena.type === "text";
  nuevaContrasena.type = showing ? "password" : "text";
  toggleNuevaContrasena.textContent = showing ? "👁️" : "🙈";
  toggleNuevaContrasena.setAttribute("aria-label", showing ? "Mostrar contraseña" : "Ocultar contraseña");
});

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

  setEstado("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
  setTimeout(() => {
    window.location.href = "../index.html";
  }, 1200);
});

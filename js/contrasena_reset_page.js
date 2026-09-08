import { supabase } from "./supabase.js";
import { sendRecoveryForEmail } from "./contrasena.js";
import { APP_URLS } from "./urls.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const toggleNuevaContrasena = document.getElementById("toggleNuevaContrasena");
const estado = document.getElementById("estadoReset");
const recoveryEmail = document.getElementById("recoveryEmail");
const emailRecoveryInput = document.getElementById("emailRecovery");
const btnEnviarRecovery = document.getElementById("btnEnviarRecovery");
const identityHint = document.getElementById("identityHint");
const identityBlock = document.getElementById("identityBlock");

const setEstado = (message) => { if (estado) estado.textContent = message || ""; };
const setHint = (message) => { if (identityHint) identityHint.textContent = message || ""; };

const getRecoveryParams = () => {
  const hash = new URLSearchParams((window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search || "");
  return {
    access_token: hash.get("access_token") || query.get("access_token"),
    refresh_token: hash.get("refresh_token") || query.get("refresh_token"),
    token_hash: hash.get("token_hash") || query.get("token_hash"),
    type: hash.get("type") || query.get("type"),
    code: hash.get("code") || query.get("code")
  };
};

const hasRecoveryTokens = () => {
  const params = getRecoveryParams();
  return Boolean(params.access_token || params.token_hash || params.code);
};

if (recoveryEmail) recoveryEmail.value = String(new URLSearchParams(window.location.search || "").get("email") || "").trim();

btnEnviarRecovery?.addEventListener("click", async () => {
  const email = String(emailRecoveryInput?.value || "").trim();
  if (!email) {
    setEstado("Ingresa tu correo electrónico para enviarte el enlace.");
    return;
  }

  setHint("Enviando enlace...");
  btnEnviarRecovery.disabled = true;
  try {
    await sendRecoveryForEmail(email);
    if (recoveryEmail) recoveryEmail.value = email;
    setHint("");
    setEstado(`Enlace de recuperación enviado. Revisa la bandeja de entrada de ${email}.`);
  } catch (error) {
    setHint("");
    setEstado(`No fue posible enviar el enlace: ${error.message || "sin detalle"}`);
  } finally {
    btnEnviarRecovery.disabled = false;
  }
});

const ensureRecoverySession = async () => {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData?.session) return;

  const { access_token, refresh_token, token_hash, type, code } = getRecoveryParams();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

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

const toggleIdentityByToken = () => {
  const hideIdentity = hasRecoveryTokens();
  if (identityBlock) identityBlock.style.display = hideIdentity ? "none" : "block";
  if (hideIdentity) {
    setEstado("Ingresa tu nueva contraseña.");
  } else {
    setEstado("Ingresa tu correo para recuperar tu contraseña.");
  }
};

toggleIdentityByToken();

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
  if (nueva.length < 8) return setEstado("La nueva contraseña debe tener al menos 8 caracteres.");

  try {
    await ensureRecoverySession();
  } catch (_error) {
    return setEstado("Enlace inválido o expirado. Solicita uno nuevo.");
  }

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return setEstado(`No se pudo actualizar: ${error.message || "sin detalle"}`);

  setEstado("Contraseña actualizada con éxito. Redirigiendo...");
  setTimeout(() => {
    window.location.href = APP_URLS.login;
  }, 1200);
});

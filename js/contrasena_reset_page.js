import { supabase } from "./supabase.js";
import { sendRecoveryForEmail } from "./contrasena.js";
import { APP_URLS } from "./urls.js";
import { WEBHOOK_VERIFICAR_NIT_CEDULA } from "./webhooks.js";
import { enforceNumericInput } from "./input_utils.js";

const form = document.getElementById("resetPasswordForm");
const nuevaContrasena = document.getElementById("nuevaContrasena");
const toggleNuevaContrasena = document.getElementById("toggleNuevaContrasena");
const estado = document.getElementById("estadoReset");
const recoveryEmail = document.getElementById("recoveryEmail");
const cedulaRecovery = document.getElementById("cedulaRecovery");
const verificarCedulaBtn = document.getElementById("verificarCedulaBtn");
const identityHint = document.getElementById("identityHint");
const identityBlock = document.getElementById("identityBlock");

const setEstado = (message) => { if (estado) estado.textContent = message || ""; };
const setHint = (message) => { if (identityHint) identityHint.textContent = message || ""; };

enforceNumericInput([cedulaRecovery]);

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

const maskEmail = (email) => {
  const [name, domain] = String(email || "").split("@");
  if (!name || !domain) return "correo no disponible";
  return `${name.slice(0, 2)}***@${domain}`;
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_error) { return { ok: response.ok, raw: text }; }
};

const pickEmailFromVerification = (data) => {
  const candidates = [
    data?.email,
    data?.correo,
    data?.correo_usuario,
    data?.correo_login,
    data?.login,
    data?.usuario?.email,
    data?.usuario?.correo,
    data?.data?.email,
    data?.data?.correo,
    data?.data?.login
  ];
  return String(candidates.find((value) => String(value || "").includes("@")) || "").trim();
};

const verifyIdentityByWebhook = async (identificador) => {
  const response = await fetch(WEBHOOK_VERIFICAR_NIT_CEDULA, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identificador,
      cedula_o_nit: identificador,
      cedula: identificador,
      nit: identificador,
      origen: "recuperacion_contrasena_no_logueado"
    })
  });

  const data = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
  }

  return data;
};

if (recoveryEmail) recoveryEmail.value = String(new URLSearchParams(window.location.search || "").get("email") || "").trim();
setEstado("Ingresa tu nueva contraseña. Si el enlace falla, verifica tu cédula/NIT para solicitar uno nuevo.");

verificarCedulaBtn?.addEventListener("click", async () => {
  const identificador = String(cedulaRecovery?.value || "").trim();
  if (!identificador) {
    setEstado("Ingresa tu cédula o NIT antes de verificar.");
    return;
  }

  setHint("Verificando identidad en plataforma...");
  verificarCedulaBtn.disabled = true;
  try {
    const data = await verifyIdentityByWebhook(identificador);
    if (data?.ok !== true) {
      setHint(data?.message || data?.error || "El dato no fue aprobado para recuperación.");
      setEstado("No encontramos un usuario válido para generar token de recuperación. Verifica la cédula/NIT e intenta de nuevo.");
      return;
    }

    const email = pickEmailFromVerification(data);
    if (!email) {
      setHint("El webhook aprobó la identidad, pero no devolvió un correo/login para emitir el token de Supabase.");
      setEstado("Identidad verificada, pero falta el correo de login en la respuesta. Devuelve `email`, `correo` o `login` desde n8n para continuar.");
      return;
    }

    await sendRecoveryForEmail(email);
    if (recoveryEmail) recoveryEmail.value = email;
    setHint(data?.message || "Identidad validada por verificación externa.");
    setEstado(`Identidad verificada. Enviamos un nuevo enlace de recuperación a ${maskEmail(email)} para que puedas cambiar la contraseña con token válido.`);
  } catch (error) {
    setHint("");
    setEstado(`No fue posible verificar la identidad (${error.message || "sin detalle"}).`);
  } finally {
    verificarCedulaBtn.disabled = false;
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
    return setEstado("Enlace inválido o expirado. Usa 'Verificar' para solicitar uno nuevo.");
  }

  const { error } = await supabase.auth.updateUser({ password: nueva });
  if (error) return setEstado(`No se pudo actualizar: ${error.message || "sin detalle"}`);

  setEstado("Contraseña actualizada. Inicia sesión con tu nueva contraseña.");
  setTimeout(() => {
    window.location.href = APP_URLS.login;
  }, 1200);
});

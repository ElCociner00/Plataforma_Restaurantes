import { getUserContext } from "./session.js";
import { WEBHOOK_DUPLICAR_USUARIOS_LOCAL } from "./webhooks.js";
import { APP_URLS } from "./urls.js";

const status = document.getElementById("status");
const form = document.getElementById("registroUsuarioLocal");
const nombreVisibleInput = document.getElementById("nombre_visible");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const correoSugerido = document.getElementById("correoSugerido");

const localNIT = sessionStorage.getItem("local_dependiente_nit");
const localCorreo = sessionStorage.getItem("local_dependiente_correo");
const localEmpresaId = sessionStorage.getItem("local_dependiente_empresa_id");

const setStatus = (message) => {
  if (status) status.innerText = message || "";
};

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch (_error) { return { ok: response.ok, raw: text }; }
};

const canManageLocals = (userContext) => ["admin", "admin_root"].includes(String(userContext?.rol || "").toLowerCase());

let context = null;

const init = async () => {
  context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setStatus("No se pudo resolver la empresa activa. Vuelve a iniciar sesión antes de continuar.");
    form.style.display = "none";
    return;
  }

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para preparar usuarios de un nuevo local.");
    form.style.display = "none";
    return;
  }

  if (!localNIT) {
    setStatus("No se encontró el local recién registrado. Vuelve al paso Añadir local.");
    form.style.display = "none";
    return;
  }

  if (localCorreo && correoSugerido) {
    correoSugerido.textContent = `Sugerido: ${localCorreo}`;
    emailInput.value = localCorreo;
  }
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!canManageLocals(context)) {
    setStatus("No tienes permisos para preparar usuarios de un nuevo local.");
    return;
  }

  const emailValue = emailInput.value.trim();
  if (!emailValue || !emailInput.checkValidity()) {
    setStatus("Ingresa un correo válido.");
    return;
  }

  const payload = {
    nombre_visible: nombreVisibleInput.value.trim(),
    email: emailValue,
    password: passwordInput.value,
    nit: localNIT,
    local_nit: localNIT,
    local_correo: localCorreo,
    local_empresa_id: localEmpresaId,
    empresa_matriz_id: context?.empresa_id || null,
    usuario_solicitante_id: context?.user?.id || context?.user?.user_id || null,
    tipo_registro: "usuarios_local_dependiente"
  };

  setStatus("Preparando usuarios del nuevo local...");

  try {
    const res = await fetch(WEBHOOK_DUPLICAR_USUARIOS_LOCAL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await parseJsonResponse(res);

    if (!res.ok || data.ok === false) {
      setStatus(data.error || `No se pudo preparar usuarios del local (HTTP ${res.status}).`);
      return;
    }

    sessionStorage.removeItem("local_dependiente_nit");
    sessionStorage.removeItem("local_dependiente_correo");
    sessionStorage.removeItem("local_dependiente_empresa_id");

    alert("Local registrado. El flujo de usuarios quedó preparado para el nuevo tenant.");
    window.location.href = APP_URLS.configuracion;
  } catch (_error) {
    setStatus("Error inesperado preparando usuarios del local. Intenta nuevamente.");
  }
});

init();

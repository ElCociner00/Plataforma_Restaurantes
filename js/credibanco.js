/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/credibanco.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 */
import { getUserContext } from "./session.js";
import { buildRequestHeaders } from "./session.js";
import { WEBHOOK_REGISTRAR_CREDIBANCO } from "./webhooks.js";

const form = document.getElementById("credibancoForm");
const clientIdInput = document.getElementById("credibancoClientId");
const clientSecretInput = document.getElementById("credibancoClientSecret");
const toggleSecretBtn = document.getElementById("toggleCredibancoSecret");
const status = document.getElementById("status");
const getTimestamp = () => new Date().toISOString();

const clearCredentialFields = () => {
  if (clientIdInput) {
    clientIdInput.defaultValue = "";
    clientIdInput.value = "";
  }
  if (clientSecretInput) {
    clientSecretInput.defaultValue = "";
    clientSecretInput.value = "";
  }
};

clearCredentialFields();
window.addEventListener("pageshow", clearCredentialFields);
setTimeout(clearCredentialFields, 250);

const setStatus = (message) => {
  if (status) status.textContent = message || "";
};

const readResponseBody = async (res) => {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
};

toggleSecretBtn?.addEventListener("click", () => {
  const shouldShow = clientSecretInput.type === "password";
  clientSecretInput.type = shouldShow ? "text" : "password";
  toggleSecretBtn.textContent = shouldShow ? "🙈" : "👁";
  toggleSecretBtn.setAttribute("aria-label", shouldShow ? "Ocultar client secret" : "Mostrar client secret");
});

form?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const clientId = String(clientIdInput?.value || "").trim();
  const clientSecret = String(clientSecretInput?.value || "").trim();

  if (!clientId || !clientSecret) {
    setStatus("Ingresa Client ID y Client Secret antes de guardar.");
    return;
  }

  setStatus("Guardando credenciales de Credibanco...");

  const context = await getUserContext();
  if (!context?.empresa_id) {
    setStatus("No se pudo validar la sesión o el tenant activo.");
    return;
  }

  const userId = context.user?.id || context.user?.user_id;
  const payload = {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: userId,
    registrado_por: userId,
    timestamp: getTimestamp(),
    plataforma: "credibanco",
    client_id: clientId,
    client_secret: clientSecret
  };

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRAR_CREDIBANCO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponseBody(res);
    if (!res.ok) {
      setStatus(data.message || `No se pudieron guardar las credenciales de Credibanco (HTTP ${res.status}).`);
      return;
    }

    setStatus(data.message || "Credenciales de Credibanco guardadas.");
  } catch (error) {
    setStatus("Error de conexión al guardar credenciales de Credibanco.");
  }
});

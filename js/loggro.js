import { getUserContext } from "./session.js";
import { buildRequestHeaders } from "./session.js";
import { WEBHOOK_REGISTRO_CREDENCIALES } from "./webhooks.js";

const form = document.getElementById("loggroForm");
const tokenInput = document.getElementById("loggroToken");
const urlInput = document.getElementById("loggroUrl");
const status = document.getElementById("status");
const getTimestamp = () => new Date().toISOString();

const setStatus = (message) => {
  status.textContent = message;
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Guardando credenciales...");

  const context = await getUserContext();
  if (!context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  const payload = {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    registrado_por: context.user?.id || context.user?.user_id,
    timestamp: getTimestamp(),
    token: tokenInput.value.trim(),
    url: urlInput.value.trim()
  };

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRO_CREDENCIALES, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponseBody(res);
    if (!res.ok) {
      setStatus(data.message || `No se pudieron guardar las credenciales (HTTP ${res.status}).`);
      return;
    }

    setStatus(data.message || "Credenciales guardadas.");
  } catch (error) {
    setStatus("Error de conexión al guardar credenciales.");
  }
});

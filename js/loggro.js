/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/loggro.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 */
import { getUserContext } from "./session.js";
import { buildRequestHeaders } from "./session.js";
import { WEBHOOK_REGISTRO_CREDENCIALES } from "./webhooks.js";

const form = document.getElementById("loggroForm");
const emailInput = document.getElementById("loggroEmail");
const passwordInput = document.getElementById("loggroPassword");
const togglePasswordBtn = document.getElementById("toggleLoggroPassword");
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

togglePasswordBtn?.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";
  passwordInput.type = shouldShow ? "text" : "password";
  togglePasswordBtn.textContent = shouldShow ? "🙈" : "👁";
});

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
    plataforma: "loggro",
    url: "loggro.com",
    correo: emailInput.value.trim(),
    password: passwordInput.value
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

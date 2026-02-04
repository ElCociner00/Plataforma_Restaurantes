import { getUserContext } from "./session.js";
import { WEBHOOK_REGISTRO_CREDENCIALES } from "./webhooks.js";

const form = document.getElementById("loggroForm");
const tokenInput = document.getElementById("loggroToken");
const urlInput = document.getElementById("loggroUrl");
const status = document.getElementById("status");

const setStatus = (message) => {
  status.textContent = message;
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
    registrado_por: context.user?.id || context.user?.user_id,
    token: tokenInput.value.trim(),
    url: urlInput.value.trim()
  };

  try {
    const res = await fetch(WEBHOOK_REGISTRO_CREDENCIALES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    setStatus(data.message || "Credenciales guardadas.");
  } catch (error) {
    setStatus("Error de conexión al guardar credenciales.");
  }
});

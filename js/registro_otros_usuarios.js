import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { WEBHOOK_REGISTRO_OTROS_USUARIOS } from "./webhooks.js";

// ===============================
// REGISTRO DE ADMINS Y REVISORES
// ===============================

// ===============================
// ELEMENTOS
// ===============================
const form = document.getElementById("registroOtrosUsuariosForm");
const statusDiv = document.getElementById("status");
const cedulaInput = document.getElementById("cedula");
const emailInput = document.getElementById("email");
const rolSelect = document.getElementById("rol");
const getTimestamp = () => new Date().toISOString();

enforceNumericInput([cedulaInput]);

// ===============================
// ENVÍO DEL FORMULARIO
// ===============================
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailValue = emailInput.value.trim();

  if (!emailValue || !emailInput.checkValidity()) {
    statusDiv.textContent = "Ingresa un correo válido.";
    emailInput.focus();
    return;
  }

  if (!rolSelect.value) {
    statusDiv.textContent = "Selecciona un rol.";
    rolSelect.focus();
    return;
  }

  const context = await getUserContext();

  if (!context) {
    statusDiv.textContent = "No se pudo validar la sesión.";
    return;
  }

  const payload = {
    nombre: document.getElementById("nombre").value.trim(),
    cedula: cedulaInput.value.trim(),
    email: emailValue,
    password: document.getElementById("password").value,
    rol: rolSelect.value,
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    registrado_por: context.user?.id || context.user?.user_id,
    timestamp: getTimestamp()
  };

  statusDiv.textContent = "Enviando registro...";

  try {
    const res = await fetch(WEBHOOK_REGISTRO_OTROS_USUARIOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data?.ok === true) {
      statusDiv.textContent = data.message || "";
      form.reset();
    } else {
      statusDiv.textContent = data?.message || "";
    }
  } catch (err) {
    statusDiv.textContent = "Error de conexión con el servidor.";
  }
});

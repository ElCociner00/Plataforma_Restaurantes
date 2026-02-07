import { enforceNumericInput } from "./input_utils.js";
import { getUserContext } from "./session.js";
import { WEBHOOK_REGISTRAR_EMPLEADO } from "./webhooks.js";

// ===============================
// REGISTRO DE EMPLEADO
// ===============================

// ===============================
// ELEMENTOS
// ===============================
const form = document.getElementById("registroEmpleadoForm");
const btnRegistrar = document.getElementById("btnRegistrar");
const statusDiv = document.getElementById("status");
const nitInput = document.getElementById("nit_empresa");
const cedulaInput = document.getElementById("cedula");
const emailInput = document.getElementById("email");
const getTimestamp = () => new Date().toISOString();

enforceNumericInput([nitInput, cedulaInput]);

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

  const context = await getUserContext();

  if (!context) {
    statusDiv.textContent = "No se pudo validar la sesión.";
    return;
  }

  const payload = {
    nombre: document.getElementById("nombre").value.trim(),
    cedula: cedulaInput.value.trim(),
    fecha_ingreso: document.getElementById("fecha_ingreso").value,
    email: emailValue,
    password: document.getElementById("password").value,
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    registrado_por: context.user?.id || context.user?.user_id,
    timestamp: getTimestamp()
  };

  statusDiv.textContent = "Registrando empleado...";

  try {
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    const isSuccess = data?.success === true || data?.ok === true;

    if (isSuccess) {
      statusDiv.textContent =
        "Empleado registrado correctamente.";
      form.reset();
    } else {
      statusDiv.textContent =
        data.message || "Error al registrar empleado.";
    }

  } catch (err) {
    statusDiv.textContent =
      "Error de conexión con el servidor.";
  }
});

import { enforceNumericInput } from "./input_utils.js";
import { buildRequestHeaders, getUserContext } from "./session.js";
import { WEBHOOK_REGISTRO_OTROS_USUARIOS } from "./webhooks.js";

const form = document.getElementById("registroOtrosUsuariosForm");
const btnRegistrar = document.getElementById("btnRegistrar");
const statusDiv = document.getElementById("status");
const cedulaInput = document.getElementById("cedula");
const emailInput = document.getElementById("email");
const rolSelect = document.getElementById("rol");
const getTimestamp = () => new Date().toISOString();

enforceNumericInput([cedulaInput]);

const setSubmitting = (isSubmitting) => {
  if (!btnRegistrar) return;
  btnRegistrar.disabled = isSubmitting;
  btnRegistrar.textContent = isSubmitting ? "Registrando..." : "Registrar";
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

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailValue = emailInput?.value.trim();
  if (!emailValue || !emailInput?.checkValidity()) {
    statusDiv.textContent = "Ingresa un correo válido.";
    emailInput?.focus();
    return;
  }

  if (!rolSelect?.value) {
    statusDiv.textContent = "Selecciona un rol.";
    rolSelect?.focus();
    return;
  }

  const context = await getUserContext();
  if (!context?.empresa_id) {
    statusDiv.textContent = "No se pudo validar la sesión.";
    return;
  }

  const payload = {
    nombre: document.getElementById("nombre")?.value.trim() || "",
    cedula: cedulaInput?.value.trim() || "",
    email: emailValue,
    password: document.getElementById("password")?.value || "",
    rol: rolSelect.value,
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    registrado_por: context.user?.id || context.user?.user_id,
    timestamp: getTimestamp()
  };

  setSubmitting(true);
  statusDiv.textContent = "Enviando registro...";

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const res = await fetch(WEBHOOK_REGISTRO_OTROS_USUARIOS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponseBody(res);
    const isSuccess = res.ok && (data?.success === true || data?.ok === true || /registrad/i.test(String(data?.message || "")));

    if (isSuccess) {
      statusDiv.textContent = data?.message || "Usuario registrado correctamente.";
      form.reset();
    } else {
      statusDiv.textContent = data?.message || `Error registrando usuario (HTTP ${res.status}).`;
    }
  } catch {
    statusDiv.textContent = "Error de conexión. Intenta nuevamente.";
  } finally {
    setSubmitting(false);
  }
});

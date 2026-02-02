// ===============================
// REGISTRO DE EMPLEADO
// ===============================

// 🔗 WEBHOOKS
const WEBHOOK_VERIFICAR_NIT =
  "https://n8n.globalnexoshop.com/webhook/verificar_nit_empresa";

const WEBHOOK_REGISTRAR_EMPLEADO =
  "https://aqui_va_el_webhook@pegaloaqui";

// ===============================
// ELEMENTOS
// ===============================
const form = document.getElementById("registroEmpleadoForm");
const checkboxNit = document.getElementById("confirmarNit");
const btnRegistrar = document.getElementById("btnRegistrar");
const statusDiv = document.getElementById("status");
const nitInput = document.getElementById("nit_empresa");

// ===============================
// ESTADO INTERNO
// ===============================
let nitVerificado = false;
let verificandoNit = false;

// ===============================
// VERIFICACIÓN DE NIT
// ===============================
checkboxNit.addEventListener("change", async () => {
  statusDiv.textContent = "";

  if (!checkboxNit.checked) {
    nitVerificado = false;
    btnRegistrar.disabled = true;
    return;
  }

  const nit = nitInput.value.trim();

  if (!nit) {
    statusDiv.textContent = "Debes ingresar el NIT antes de confirmar.";
    checkboxNit.checked = false;
    return;
  }

  // Bloqueo mientras espera
  verificandoNit = true;
  btnRegistrar.disabled = true;
  checkboxNit.disabled = true;

  statusDiv.textContent = "Verificando NIT...";

  try {
    const res = await fetch(WEBHOOK_VERIFICAR_NIT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nit })
    });

    const data = await res.json();

    if (data.ok === true) {
      nitVerificado = true;
      statusDiv.textContent =
        data.message || "NIT verificado correctamente.";
    } else {
      nitVerificado = false;
      checkboxNit.checked = false;
      statusDiv.textContent =
        data.message || "El NIT no es válido.";
    }

  } catch (err) {
    nitVerificado = false;
    checkboxNit.checked = false;
    statusDiv.textContent = "Error al verificar el NIT.";
  }

  verificandoNit = false;
  checkboxNit.disabled = false;
  btnRegistrar.disabled = !nitVerificado;
});

// ===============================
// ENVÍO DEL FORMULARIO
// ===============================
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (verificandoNit) {
    statusDiv.textContent =
      "Espera a que termine la verificación del NIT.";
    return;
  }

  if (!nitVerificado) {
    statusDiv.textContent =
      "Debes verificar el NIT antes de registrar.";
    return;
  }

  const payload = {
    nombre: document.getElementById("nombre").value.trim(),
    cedula: document.getElementById("cedula").value.trim(),
    fecha_ingreso: document.getElementById("fecha_ingreso").value,
    username:
      document.getElementById("username").value.trim() +
      "@globalnexo.com",
    password: document.getElementById("password").value,
    nit_empresa: nitInput.value.trim()
  };

  statusDiv.textContent = "Registrando empleado...";

  try {
    const res = await fetch(WEBHOOK_REGISTRAR_EMPLEADO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (data.success === true) {
      statusDiv.textContent =
        "Empleado registrado correctamente.";
      form.reset();
      btnRegistrar.disabled = true;
      nitVerificado = false;
    } else {
      statusDiv.textContent =
        data.message || "Error al registrar empleado.";
    }

  } catch (err) {
    statusDiv.textContent =
      "Error de conexión con el servidor.";
  }
});

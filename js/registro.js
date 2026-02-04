import { enforceNumericInput } from "./input_utils.js";
import {
  WEBHOOK_CREAR_CODIGO_VERIFICACION,
  WEBHOOK_VERIFICAR_CODIGO,
  WEBHOOK_REGISTRO_EMPRESA
} from "./webhooks.js";

const form = document.getElementById("registroEmpresa");
const status = document.getElementById("status");
const verificacion = document.getElementById("verificacion");
const continuarBtn = document.getElementById("continuar");
const nombreComercialInput = document.getElementById("nombre_comercial");
const razonSocialInput = document.getElementById("razon_social");
const nitInput = document.getElementById("nit");
const correoEmpresaInput = document.getElementById("correo_empresa");
const codigoInput = document.getElementById("codigo");

enforceNumericInput([nitInput, codigoInput]);

let datosEmpresa = null;
let codigoValidado = false;

/* =========================
   1️⃣ Enviar código
========================= */
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  status.innerText = "Enviando código...";

  datosEmpresa = {
    nombre_comercial: nombreComercialInput.value.trim(),
    razon_social: razonSocialInput.value.trim(),
    nit: nitInput.value.trim(),
    correo_empresa: correoEmpresaInput.value.trim()
  };

  try {
    const res = await fetch(
      WEBHOOK_CREAR_CODIGO_VERIFICACION,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datosEmpresa)
      }
    );

    const data = await res.json();

    if (!data.ok) {
      status.innerText = data.error || "Error enviando el código";
      return;
    }

    status.innerText = "Código enviado. Revisa tu correo.";
    verificacion.style.display = "block";
    form.querySelectorAll("input").forEach(i => i.disabled = true);

  } catch (err) {
    status.innerText = "Error de conexión. Intenta de nuevo.";
  }
});

/* =========================
   2️⃣ Verificar código
========================= */
document.getElementById("verificarCodigo").addEventListener("click", async () => {
  status.innerText = "Verificando código...";

  try {
    const res = await fetch(
      WEBHOOK_VERIFICAR_CODIGO,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          correo_empresa: datosEmpresa.correo_empresa,
          codigo: codigoInput.value.trim()
        })
      }
    );

    const data = await res.json();

    if (!data.ok) {
      status.innerText = data.error || "Código inválido o expirado";
      return;
    }

    codigoValidado = true;
    status.innerText = "Correo verificado correctamente ✅";
    continuarBtn.style.display = "block";
    verificacion.style.display = "none";

  } catch (err) {
    status.innerText = "Error verificando el código.";
  }
});

/* =========================
   3️⃣ Continuar registro
   (aquí está la magia)
========================= */
continuarBtn.addEventListener("click", async () => {
  if (!codigoValidado) {
    status.innerText = "Debes verificar tu correo primero";
    return;
  }

  status.innerText = "Registrando empresa...";

  try {
    const res = await fetch(
      WEBHOOK_REGISTRO_EMPRESA,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datosEmpresa)
      }
    );

    const data = await res.json();

    // ❌ FALLA LÓGICA (empresa ya existe, etc.)
    if (!data.ok) {
      alert(data.error || "Esta empresa ya está registrada");
      window.location.reload(); // 🔄 RESET TOTAL
      return;
    }

    // ✅ ÉXITO
    sessionStorage.setItem("empresa_nit", datosEmpresa.nit);
    sessionStorage.setItem("empresa_correo", datosEmpresa.correo_empresa);
    window.location.href = "/Plataforma_Restaurantes/registro/usuario.html";

  } catch (err) {
    alert("Error inesperado. Intenta nuevamente.");
    window.location.reload(); // 🔄 RESET POR SEGURIDAD
  }
});

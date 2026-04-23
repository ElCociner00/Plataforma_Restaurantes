/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/usuario.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - Este archivo está orientado a configuración/arranque sin funciones explícitas extensas.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { WEBHOOK_REGISTRO_USUARIO } from "./webhooks.js";
import { APP_URLS } from "./urls.js";

const status = document.getElementById("status");
const form = document.getElementById("registroUsuario");
const nombreVisibleInput = document.getElementById("nombre_visible");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const correoSugerido = document.getElementById("correoSugerido");

// 🔍 Recuperamos el NIT de la sesión
const empresaNIT = sessionStorage.getItem("empresa_nit");
const empresaCorreo = sessionStorage.getItem("empresa_correo");

if (!empresaNIT) {
  status.innerText = "Error: no se encontró información de la empresa.";
  form.style.display = "none";
  throw new Error("NIT no encontrado en sessionStorage");
}

if (empresaCorreo && correoSugerido) {
  correoSugerido.textContent = `Sugerido: ${empresaCorreo}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const emailValue = emailInput.value.trim();

  if (!emailValue || !emailInput.checkValidity()) {
    status.innerText = "Ingresa un correo válido";
    return;
  }

  const payload = {
    nombre_visible: nombreVisibleInput.value.trim(),
    email: emailValue,
    password: passwordInput.value,
    nit: empresaNIT
  };

  status.innerText = "Creando usuario...";

  try {
    const res = await fetch(
      WEBHOOK_REGISTRO_USUARIO,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const data = await res.json();

    if (!data.ok) {
      status.innerText = data.error || "Error creando el usuario";
      return;
    }

    // 🧹 Limpieza de sesión
    sessionStorage.removeItem("empresa_nit");

    alert("Registro exitoso. Ahora puedes iniciar sesión.");
    window.location.href = APP_URLS.login;

  } catch (err) {
    status.innerText = "Error inesperado. Intenta nuevamente.";
  }
});

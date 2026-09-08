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
import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const form = document.getElementById("loggroForm");
const emailInput = document.getElementById("loggroEmail");
const passwordInput = document.getElementById("loggroPassword");
const togglePasswordBtn = document.getElementById("toggleLoggroPassword");
const status = document.getElementById("status");

const setStatus = (message) => {
  status.textContent = message;
};

document.addEventListener("DOMContentLoaded", async () => {
  const context = await getUserContext().catch(() => null);
  if (!context?.empresa_id) {
    setStatus("No se pudo validar la empresa actual.");
    return;
  }

  const rol = String(context?.rol || "").toLowerCase();
  const isAdmin = ["admin_root", "admin"].includes(rol);
  if (!isAdmin) {
    alert("Acceso denegado: No tienes permisos para configurar integraciones.");
    window.location.href = "../dashboard/";
    return;
  }

  // Consultar credenciales existentes
  try {
    const { data, error } = await supabase.functions.invoke("consultar-credenciales", {
      body: { plataforma: "loggro" }
    });
    
    const statusDiv = document.getElementById("status_existing") || (() => {
      const div = document.createElement("div");
      div.id = "status_existing";
      div.className = "ayuda";
      div.style.marginBottom = "15px";
      div.style.padding = "10px";
      div.style.borderRadius = "4px";
      form.parentNode.insertBefore(div, form);
      return div;
    })();

    if (error || !data?.ok) {
      statusDiv.style.backgroundColor = "#ffdddd";
      statusDiv.style.color = "#990000";
      statusDiv.textContent = "No se pudo verificar si existen credenciales previas.";
    } else if (data.existe) {
      statusDiv.style.backgroundColor = "#e6f4ea";
      statusDiv.style.color = "#1e8e3e";
      statusDiv.innerHTML = `✅ <b>Ya tienes una credencial guardada</b> para el correo: <code>${data.usuario}</code>. <br><small>Si guardas una nueva, se sobrescribirá la actual.</small>`;
    } else {
      statusDiv.style.backgroundColor = "#f1f3f4";
      statusDiv.style.color = "#5f6368";
      statusDiv.textContent = "ℹ️ No hay credenciales configuradas todavía.";
    }
  } catch (err) {
    console.error("Error consultando credenciales:", err);
  }
});


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

  try {
    const { data, error } = await supabase.functions.invoke("guardar-credenciales", {
      body: {
        plataforma: "loggro",
        correo: emailInput.value.trim(),
        password: passwordInput.value
      }
    });

    // Error HTTP (ej. 500, 401 sin cuerpo JSON válido) o de red devuelto por el cliente
    if (error) {
      console.error("[loggro] Error invocando función:", error);
      // Supabase-js intenta envolver el cuerpo de error si es JSON.
      // Si la función tira nuestra ErrorFuncion, el JSON de error suele estar en error.context o el mensaje parseado.
      setStatus("Hubo un problema de conexión o autenticación.");
      return;
    }

    // Error lógico devuelto por nuestra función en el JSON { ok: false, message: ... }
    if (!data?.ok) {
      setStatus(data?.message || "No se pudieron guardar las credenciales.");
      return;
    }

    setStatus(data.message || "Credenciales validadas y guardadas exitosamente.");
  } catch (err) {
    console.error("[loggro] Error inesperado:", err);
    setStatus("Error inesperado al comunicarse con el servidor.");
  }
});

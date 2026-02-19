import { getUserContext } from "./session.js";
import { WEBHOOK_REGISTRO_CREDENCIALES } from "./webhooks.js";

const form = document.getElementById("siigoApiForm");
const status = document.getElementById("status");

const getTimestamp = () => new Date().toISOString();
const setStatus = (message) => { status.textContent = message; };

const getValue = (id) => document.getElementById(id)?.value?.trim() || "";

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("Guardando configuración de API Siigo...");

  const context = await getUserContext();
  if (!context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  const responsableId = context.user?.id || context.user?.user_id || "";
  const now = getTimestamp();
  const payload = {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    usuario_id: responsableId,
    responsable_id: responsableId,
    registrado_por: responsableId,
    rol: context.rol,
    timestamp: now,
    timestampwithtimezone: now,
    integracion: "siigo",
    origen_modulo: "api_integraciones_siigo",
    entorno: "siigo",
    client_id: getValue("client_id"),
    project_id: getValue("project_id"),
    auth_url: getValue("auth_url"),
    token_url: getValue("token_url"),
    client_secret: getValue("client_secret")
  };

  try {
    const res = await fetch(WEBHOOK_REGISTRO_CREDENCIALES, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    setStatus(data.message || "Configuración de Siigo guardada.");
  } catch {
    setStatus("Error de conexión al guardar configuración de Siigo.");
  }
});

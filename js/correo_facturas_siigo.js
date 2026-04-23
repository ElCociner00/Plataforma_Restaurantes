/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/correo_facturas_siigo.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `setStatus` (línea aprox. 9): Asigna/actualiza estado.
 * - `getEmpresaId` (línea aprox. 13): Obtiene un valor o recurso.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";

const form = document.getElementById("correoFacturasForm");
const input = document.getElementById("correo");
const statusEl = document.getElementById("correoStatus");

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const getEmpresaId = async () => {
  const context = await getUserContext();
  return context?.empresa_id || null;
};

let currentRowId = null;

async function loadCurrentCorreo() {
  const empresaId = await getEmpresaId();
  if (!empresaId) {
    setStatus("No se pudo detectar la empresa activa.");
    return;
  }

  const { data, error } = await supabase
    .from("correos_empresas")
    .select("id, correo")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    setStatus("No se pudo consultar el correo actual.");
    return;
  }

  const row = Array.isArray(data) ? data[0] : null;
  currentRowId = row?.id || null;
  if (input && row?.correo) input.value = row.correo;
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const empresaId = await getEmpresaId();
  const correo = String(input?.value || "").trim();

  if (!empresaId) {
    setStatus("No se pudo detectar la empresa activa.");
    return;
  }

  if (!correo) {
    setStatus("Ingresa un correo válido.");
    return;
  }

  setStatus("Guardando correo...");

  let error = null;
  if (currentRowId) {
    ({ error } = await supabase
      .from("correos_empresas")
      .update({ correo })
      .eq("id", currentRowId));
  } else {
    const result = await supabase
      .from("correos_empresas")
      .insert({ empresa_id: empresaId, correo })
      .select("id")
      .single();

    error = result.error;
    currentRowId = result.data?.id || null;
  }
  if (error) {
    setStatus("No se pudo guardar el correo.");
    return;
  }

  setStatus("Correo guardado correctamente.");
});

document.addEventListener("DOMContentLoaded", loadCurrentCorreo);

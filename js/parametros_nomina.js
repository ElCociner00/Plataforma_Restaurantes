/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/parametros_nomina.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `loadCatalog` (línea aprox. 114): Carga catálogos de tiempos/conceptos desde webhooks n8n.
 * - `buildPayload` (línea aprox. 156): Construye el JSON enviado al webhook.
 * - `submitParametro` (línea aprox. 188): Envía el parámetro de nómina al webhook.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { buildRequestHeaders, getUserContext } from "./session.js";
import {
  WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR,
  WEBHOOK_NOMINA_PARAMETROS_REGISTRAR,
  WEBHOOK_NOMINA_TIEMPOS_CONSULTAR
} from "./webhooks.js";

const form = document.getElementById("parametrosNominaForm");
const tiempoSelect = document.getElementById("parametroTiempo");
const conceptoSelect = document.getElementById("parametroConcepto");
const valorInput = document.getElementById("parametroValor");
const btnGuardar = document.getElementById("btnGuardarParametroNomina");
const statusDiv = document.getElementById("parametrosNominaStatus");

const CATALOGS = {
  tiempos: {
    select: tiempoSelect,
    placeholder: "Selecciona un tiempo",
    loadingLabel: "Cargando tiempos...",
    url: WEBHOOK_NOMINA_TIEMPOS_CONSULTAR
  },
  conceptos: {
    select: conceptoSelect,
    placeholder: "Selecciona un concepto",
    loadingLabel: "Cargando conceptos...",
    url: WEBHOOK_NOMINA_CONCEPTOS_CONSULTAR
  }
};

let currentContext = null;
const catalogState = {
  tiempos: [],
  conceptos: []
};

const setStatus = (message) => {
  if (statusDiv) statusDiv.textContent = message || "";
};

const setSubmitting = (isSubmitting) => {
  if (!btnGuardar) return;
  btnGuardar.disabled = isSubmitting;
  btnGuardar.textContent = isSubmitting ? "Guardando..." : "Guardar parámetro";
};

const normalizeCatalogRow = (row) => {
  if (!row || typeof row !== "object") return null;
  const id = String(row.id || "").trim();
  const nombre = String(row.nombre || "").trim();
  if (!id || !nombre) return null;

  return {
    id,
    nombre,
    factor_conversion: row.factor_conversion ?? null,
    raw: row
  };
};

const fillSelect = (select, options, placeholder) => {
  if (!select) return;
  select.innerHTML = "";

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = placeholder;
  select.appendChild(emptyOption);

  options.forEach((option) => {
    const el = document.createElement("option");
    el.value = option.id;
    el.textContent = option.nombre;
    el.dataset.nombre = option.nombre;
    if (option.factor_conversion !== null && option.factor_conversion !== undefined) {
      el.dataset.factorConversion = String(option.factor_conversion);
    }
    select.appendChild(el);
  });
};

const readResponseBody = async (response) => {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { message: raw };
  }
};

const extractDataRows = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    if (value.every((item) => item && typeof item === "object" && !Array.isArray(item) && "id" in item && "nombre" in item)) {
      return value;
    }

    return value.flatMap((item) => extractDataRows(item));
  }

  if (typeof value === "object") {
    if (Array.isArray(value.data)) return extractDataRows(value.data);
    if (Array.isArray(value.body)) return extractDataRows(value.body);
    if (Array.isArray(value.result)) return extractDataRows(value.result);
  }

  return [];
};

const buildCatalogRequestPayload = () => ({
  tenant_id: currentContext?.empresa_id,
  empresa_id: currentContext?.empresa_id,
  usuario_id: currentContext?.user?.id || currentContext?.user?.user_id || null,
  origen: "configuracion_parametros_nomina",
  timestamp: new Date().toISOString()
});

const fetchCatalogRows = async (url) => {
  const authHeaders = await buildRequestHeaders({ includeTenant: true });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders
    },
    body: JSON.stringify(buildCatalogRequestPayload())
  });

  const data = await readResponseBody(response);
  if (!response.ok) throw new Error(data?.message || `HTTP ${response.status}`);

  return extractDataRows(data)
    .map(normalizeCatalogRow)
    .filter(Boolean);
};

const loadCatalog = async (catalogName) => {
  const config = CATALOGS[catalogName];
  fillSelect(config.select, [], config.loadingLabel);

  const rows = await fetchCatalogRows(config.url);
  if (!rows.length) {
    throw new Error(`El webhook de ${catalogName} respondió sin datos compatibles.`);
  }

  catalogState[catalogName] = rows;
  fillSelect(config.select, rows, config.placeholder);
  return rows;
};

const findSelectedCatalogItem = (catalogName, selectedId) => (
  (catalogState[catalogName] || []).find((item) => String(item.id) === String(selectedId)) || null
);

const buildPayload = () => {
  const tiempo = findSelectedCatalogItem("tiempos", tiempoSelect?.value);
  const concepto = findSelectedCatalogItem("conceptos", conceptoSelect?.value);
  const valor = Number(valorInput?.value);
  const userId = currentContext?.user?.id || currentContext?.user?.user_id || null;

  return {
    tenant_id: currentContext?.empresa_id,
    empresa_id: currentContext?.empresa_id,
    tiempo_id: tiempo?.id || tiempoSelect?.value,
    tiempo: tiempo?.nombre || tiempoSelect?.selectedOptions?.[0]?.textContent || "",
    tiempo_nombre: tiempo?.nombre || tiempoSelect?.selectedOptions?.[0]?.textContent || "",
    tiempo_factor_conversion: tiempo?.factor_conversion ?? null,
    concepto_id: concepto?.id || conceptoSelect?.value,
    concepto: concepto?.nombre || conceptoSelect?.selectedOptions?.[0]?.textContent || "",
    concepto_nombre: concepto?.nombre || conceptoSelect?.selectedOptions?.[0]?.textContent || "",
    valor,
    usuario_id: userId,
    registrado_por: userId,
    origen: "configuracion_parametros_nomina",
    timestamp: new Date().toISOString()
  };
};

const validatePayload = (payload) => {
  if (!payload.tenant_id) return "No se pudo validar la empresa activa.";
  if (!payload.tiempo_id) return "Selecciona un tiempo.";
  if (!payload.concepto_id) return "Selecciona un concepto.";
  if (!Number.isFinite(payload.valor) || payload.valor < 0) return "Ingresa un valor numérico válido.";
  return "";
};

const submitParametro = async (event) => {
  event.preventDefault();

  const payload = buildPayload();
  const validationMessage = validatePayload(payload);
  if (validationMessage) {
    setStatus(validationMessage);
    return;
  }

  setSubmitting(true);
  setStatus("Guardando parámetro de nómina...");

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOK_NOMINA_PARAMETROS_REGISTRAR, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const data = await readResponseBody(response);
    if (!response.ok || data?.success === false || data?.ok === false) {
      throw new Error(data?.message || `HTTP ${response.status}`);
    }

    setStatus(data?.message || "Parámetro de nómina enviado correctamente.");
    valorInput.value = "";
    valorInput.focus();
  } catch (error) {
    setStatus(`No se pudo guardar el parámetro: ${error?.message || "error de conexión"}.`);
  } finally {
    setSubmitting(false);
  }
};

const init = async () => {
  currentContext = await getUserContext();
  if (!currentContext?.empresa_id) {
    setStatus("No se pudo validar la empresa activa.");
    return;
  }

  await Promise.all([
    loadCatalog("tiempos"),
    loadCatalog("conceptos")
  ]);

  setStatus("Listas de tiempos y conceptos cargadas desde los webhooks de nómina.");
};

form?.addEventListener("submit", submitParametro);
init().catch((error) => {
  console.error("[parametros_nomina] Error inicializando módulo:", error);
  setStatus(`No se pudo cargar el módulo de parámetros de nómina: ${error?.message || "error de conexión"}.`);
});

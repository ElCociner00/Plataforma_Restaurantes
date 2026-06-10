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
 * - `loadCatalog` (línea aprox. 80): Carga catálogos de tiempos/conceptos desde Supabase.
 * - `buildPayload` (línea aprox. 164): Construye el JSON enviado al webhook.
 * - `submitParametro` (línea aprox. 193): Envía el parámetro de nómina al webhook.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { supabase } from "./supabase.js";
import { buildRequestHeaders, getUserContext } from "./session.js";
import { WEBHOOK_NOMINA_PARAMETROS_REGISTRAR } from "./webhooks.js";

const form = document.getElementById("parametrosNominaForm");
const tiempoSelect = document.getElementById("parametroTiempo");
const conceptoSelect = document.getElementById("parametroConcepto");
const valorInput = document.getElementById("parametroValor");
const btnGuardar = document.getElementById("btnGuardarParametroNomina");
const statusDiv = document.getElementById("parametrosNominaStatus");

const FALLBACK_TIEMPOS = [
  { id: "hora_diurna", nombre: "Hora diurna" },
  { id: "hora_nocturna", nombre: "Hora nocturna" },
  { id: "dominical_diurna", nombre: "Dominical diurna" },
  { id: "dominical_nocturna", nombre: "Dominical nocturna" }
];

const FALLBACK_CONCEPTOS = [
  { id: "devengo", nombre: "Devengo" },
  { id: "deduccion", nombre: "Deducción" },
  { id: "bono", nombre: "Bono" },
  { id: "descuento", nombre: "Descuento" }
];

const CATALOGS = {
  tiempos: {
    select: tiempoSelect,
    placeholder: "Selecciona un tiempo",
    fallback: FALLBACK_TIEMPOS,
    tables: ["nomina_tiempos", "nomina_tipos_tiempo", "nomina_catalogo_tiempos", "nomina_tiempo"]
  },
  conceptos: {
    select: conceptoSelect,
    placeholder: "Selecciona un concepto",
    fallback: FALLBACK_CONCEPTOS,
    tables: ["nomina_conceptos", "nomina_catalogo_conceptos", "nomina_concepto"]
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
  const rawId = row.id || row.uuid || row.codigo || row.code || row.slug || row.nombre || row.name || row.descripcion;
  const rawName = row.nombre || row.name || row.descripcion || row.label || row.codigo || row.code || row.slug || row.id;
  const id = String(rawId || "").trim();
  const nombre = String(rawName || "").trim();
  if (!id || !nombre) return null;

  return {
    id,
    nombre,
    raw: row
  };
};

const isRowVisibleForTenant = (row, tenantId) => {
  if (!row || typeof row !== "object") return false;
  if (row.activo === false || row.estado === false) return false;
  const rowTenant = row.tenant_id || row.empresa_id;
  return !rowTenant || !tenantId || String(rowTenant) === String(tenantId);
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
    select.appendChild(el);
  });
};

const mapCatalogRows = (data, tenantId) => (
  (Array.isArray(data) ? data : [])
    .filter((row) => isRowVisibleForTenant(row, tenantId))
    .map(normalizeCatalogRow)
    .filter(Boolean)
);

const readCatalogFromTable = async (tableName, tenantId) => {
  const tenantFilters = tenantId ? [
    `tenant_id.is.null,tenant_id.eq.${tenantId}`,
    `empresa_id.is.null,empresa_id.eq.${tenantId}`
  ] : [];

  for (const filter of tenantFilters) {
    const { data, error } = await supabase
      .from(tableName)
      .select("*")
      .or(filter)
      .limit(250);

    if (!error) return mapCatalogRows(data, tenantId);
    console.warn(`[parametros_nomina] Filtro ${filter} no aplicó en ${tableName}:`, error?.message || error);
  }

  const { data, error } = await supabase
    .from(tableName)
    .select("*")
    .limit(250);

  if (error) throw error;

  return mapCatalogRows(data, tenantId);
};

const loadCatalog = async (catalogName) => {
  const config = CATALOGS[catalogName];
  const tenantId = currentContext?.empresa_id;

  fillSelect(config.select, [], `Cargando ${catalogName}...`);

  for (const tableName of config.tables) {
    try {
      const rows = await readCatalogFromTable(tableName, tenantId);
      if (rows.length) {
        catalogState[catalogName] = rows;
        fillSelect(config.select, rows, config.placeholder);
        return { tableName, usedFallback: false };
      }
    } catch (error) {
      console.warn(`[parametros_nomina] No se pudo cargar ${catalogName} desde ${tableName}:`, error?.message || error);
    }
  }

  catalogState[catalogName] = config.fallback;
  fillSelect(config.select, config.fallback, config.placeholder);
  return { tableName: null, usedFallback: true };
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
    concepto_id: concepto?.id || conceptoSelect?.value,
    concepto: concepto?.nombre || conceptoSelect?.selectedOptions?.[0]?.textContent || "",
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

  const [tiemposResult, conceptosResult] = await Promise.all([
    loadCatalog("tiempos"),
    loadCatalog("conceptos")
  ]);

  const fallbackCatalogs = [
    tiemposResult.usedFallback ? "tiempos" : "",
    conceptosResult.usedFallback ? "conceptos" : ""
  ].filter(Boolean);

  setStatus(fallbackCatalogs.length
    ? `Listas cargadas con valores base para: ${fallbackCatalogs.join(" y ")}. Verifica las tablas de Supabase si esperabas datos personalizados.`
    : "Listas de tiempos y conceptos cargadas desde Supabase.");
};

form?.addEventListener("submit", submitParametro);
init().catch((error) => {
  console.error("[parametros_nomina] Error inicializando módulo:", error);
  setStatus("No se pudo cargar el módulo de parámetros de nómina.");
});

import { getUserContext } from "./session.js";
import { WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS } from "./webhooks.js";

const panelGeneral = document.getElementById("columnasGeneralesPanel");
const panelDetalle = document.getElementById("columnasDetallePanel");
const status = document.getElementById("status");

const MAX_LOADING_MS = 5000;
const EXCLUDED_GENERAL_FIELDS = new Set(["registrado_por", "total_variables", "diferencia_caja", "variables_detalle"]);
const EXCLUDED_DETAIL_FIELDS = new Set(["id"]);
const getTimestamp = () => new Date().toISOString();

const setStatus = (message) => {
  status.textContent = message;
};

const getGeneralVisibilityKey = (tenantId) => `historico_cierre_turno_visibilidad_${tenantId || "global"}`;
const getDetailVisibilityKey = (tenantId) => `historico_cierre_turno_detalle_visibilidad_${tenantId || "global"}`;

const loadSettings = (key) => {
  const stored = localStorage.getItem(key);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch {
    return {};
  }
};

const saveSettings = (key, settings) => {
  localStorage.setItem(key, JSON.stringify(settings));
  setStatus("Preferencias guardadas.");
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const normalizeRows = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((item) => item && typeof item === "object");

  if (typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "historico", "registros", "cierres"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
};

const buildColumns = (rows) => {
  const generalSet = new Set();
  const detailSet = new Set();

  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!EXCLUDED_GENERAL_FIELDS.has(key)) generalSet.add(key);
    });

    const details = Array.isArray(row?.variables_detalle) ? row.variables_detalle : [];
    details.forEach((item) => {
      Object.keys(item || {}).forEach((key) => {
        if (!EXCLUDED_DETAIL_FIELDS.has(key)) detailSet.add(key);
      });
    });
  });

  return {
    generales: Array.from(generalSet),
    detalles: Array.from(detailSet)
  };
};

const renderSwitches = (container, columns, settings, onSave) => {
  container.innerHTML = "";

  columns.forEach((columna) => {
    const key = String(columna);
    const visible = settings[key] !== false;

    const row = document.createElement("div");
    row.className = "vis-row";
    row.innerHTML = `
      <span>${key}</span>
      <label class="switch">
        <input type="checkbox" ${visible ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;

    const input = row.querySelector("input");
    input?.addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      onSave();
    });

    container.appendChild(row);
  });
};

const loadColumns = async () => {
  const context = await getUserContext();
  if (!context) return setStatus("No se pudo validar la sesión.");

  setStatus("Cargando campos...");

  try {
    const res = await fetchWithTimeout(WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: context.empresa_id,
        empresa_id: context.empresa_id,
        usuario_id: context.user?.id || context.user?.user_id,
        rol: context.rol,
        timestamp: getTimestamp()
      })
    });

    const data = await res.json();
    const rows = normalizeRows(data);
    const columnas = buildColumns(rows);

    const generalKey = getGeneralVisibilityKey(context.empresa_id);
    const detailKey = getDetailVisibilityKey(context.empresa_id);
    const generalSettings = loadSettings(generalKey);
    const detailSettings = loadSettings(detailKey);

    renderSwitches(panelGeneral, columnas.generales, generalSettings, () => saveSettings(generalKey, generalSettings));
    renderSwitches(panelDetalle, columnas.detalles, detailSettings, () => saveSettings(detailKey, detailSettings));

    setStatus("Campos cargados.");
  } catch (error) {
    setStatus(error?.name === "AbortError" ? "La carga tardó más de 5 segundos." : "Error cargando campos.");
  }
};

loadColumns();

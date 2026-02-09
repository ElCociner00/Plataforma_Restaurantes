import { getUserContext } from "./session.js";
import { WEBHOOK_HISTORICO_CIERRE_TURNO_COLUMNAS } from "./webhooks.js";

const panel = document.getElementById("columnasPanel");
const status = document.getElementById("status");

const MAX_LOADING_MS = 5000;
const getTimestamp = () => new Date().toISOString();

const setStatus = (message) => {
  status.textContent = message;
};

const getVisibilityKey = (tenantId) => `historico_cierre_turno_visibilidad_${tenantId || "global"}`;

const loadSettings = (tenantId) => {
  const stored = localStorage.getItem(getVisibilityKey(tenantId));
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    return {};
  }
};

const saveSettings = (tenantId, settings) => {
  localStorage.setItem(getVisibilityKey(tenantId), JSON.stringify(settings));
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

const normalizeColumns = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

    if (typeof raw[0] === "string") return raw;

    const fromObjects = raw
      .map((item) => item?.columna || item?.column || item?.name || item?.campo)
      .filter(Boolean);

    if (fromObjects.length) return fromObjects;

    if (raw[0] && typeof raw[0] === "object") {
      return Object.keys(raw[0]);
    }

    return [];
  }

  if (typeof raw === "object") {
    const candidates = ["columnas", "columns", "campos", "items"];
    for (const key of candidates) {
      if (Array.isArray(raw[key])) return normalizeColumns(raw[key]);
    }

    return Object.keys(raw).filter((key) => key !== "ok" && key !== "message");
  }

  return [];
};

const loadColumns = async () => {
  const context = await getUserContext();
  if (!context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Cargando columnas...");

  try {
    const res = await fetchWithTimeout(WEBHOOK_HISTORICO_CIERRE_TURNO_COLUMNAS, {
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
    const columnas = normalizeColumns(data);
    const settings = loadSettings(context.empresa_id);

    panel.innerHTML = "";

    columnas.forEach((columna) => {
      const key = String(columna);
      const visible = settings[key] !== false;

      const row = document.createElement("div");
      row.className = "vis-row";
      row.innerHTML = `
        <span>${key}</span>
        <label class="switch">
          <input type="checkbox" data-column="${key}" ${visible ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      `;

      const input = row.querySelector("input");
      input?.addEventListener("change", (event) => {
        settings[key] = event.target.checked;
        saveSettings(context.empresa_id, settings);
      });

      panel.appendChild(row);
    });

    setStatus(columnas.length ? "Columnas cargadas." : "No se recibieron columnas.");
  } catch (error) {
    setStatus(error?.name === "AbortError"
      ? "La carga tardó más de 5 segundos."
      : "Error cargando columnas.");
  }
};

loadColumns();

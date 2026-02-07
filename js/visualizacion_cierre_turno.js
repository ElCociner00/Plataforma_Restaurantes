import { getUserContext } from "./session.js";
import { WEBHOOK_CONSULTAR_GASTOS_VISUALIZACION } from "./webhooks.js";

const STORAGE_KEY = "cierre_turno_visibilidad";

const DEFAULT_SETTINGS = {
  efectivo: true,
  datafono: true,
  rappi: true,
  nequi: true,
  transferencias: true,
  bono_regalo: true,
  propina: true,
  domicilios: true,
};

const EXTRAS_STORAGE_KEY = "cierre_turno_extras_visibilidad";
const MAX_LOADING_MS = 5000;

const status = document.getElementById("status");
const extrasPanel = document.getElementById("extrasPanel");

const getSettings = () => {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
};

const saveSettings = (settings) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  status.textContent = "Preferencias guardadas.";
};

const loadExtrasSettings = () => {
  const stored = localStorage.getItem(EXTRAS_STORAGE_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    return {};
  }
};

const saveExtrasSettings = (settings) => {
  localStorage.setItem(EXTRAS_STORAGE_KEY, JSON.stringify(settings));
  status.textContent = "Preferencias guardadas.";
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

const normalizeExtras = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    if (raw[0] && typeof raw[0] === "object") return raw;
    return [];
  }

  if (typeof raw !== "object") return [];

  const keys = ["gastos", "extras", "items", "data"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  return Object.entries(raw)
    .filter(([key]) => key !== "ok" && key !== "message")
    .map(([id, value]) => ({ id, ...(typeof value === "object" ? value : { value }) }));
};

const settings = getSettings();

document.querySelectorAll("input[type='checkbox'][data-field]").forEach((toggle) => {
  const field = toggle.dataset.field;
  toggle.checked = settings[field] !== false;
  toggle.addEventListener("change", () => {
    settings[field] = toggle.checked;
    saveSettings(settings);
  });
});

const loadExtras = async () => {
  if (!extrasPanel) return;

  const context = await getUserContext();
  if (!context) {
    status.textContent = "No se pudo validar la sesión.";
    return;
  }

  try {
    const res = await fetchWithTimeout(WEBHOOK_CONSULTAR_GASTOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empresa_id: context.empresa_id,
        tenant_id: context.empresa_id,
        usuario_id: context.user?.id || context.user?.user_id,
        rol: context.rol
      })
    });

    const data = await res.json();
    const extras = normalizeExtras(data);
    const settings = loadExtrasSettings();

    extrasPanel.innerHTML = "";

    extras.forEach((item) => {
      const id = String(item.id ?? item.codigo ?? item.key ?? "");
      if (!id) return;
      const nombre = item.nombre ?? item.name ?? item.descripcion ?? id;
      const visible = settings[id] !== false;

      const row = document.createElement("div");
      row.className = "vis-row";
      row.innerHTML = `
        <span>${nombre}</span>
        <label class="switch">
          <input type="checkbox" data-extra="${id}" ${visible ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      `;

      const input = row.querySelector("input[data-extra]");
      input?.addEventListener("change", (event) => {
        settings[id] = event.target.checked;
        saveExtrasSettings(settings);
      });

      extrasPanel.appendChild(row);
    });
  } catch (error) {
    status.textContent = error?.name === "AbortError"
      ? "La carga de extras tardó más de 5 segundos."
      : "Error cargando extras.";
  }
};

loadExtras();

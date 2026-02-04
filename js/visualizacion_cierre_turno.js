const STORAGE_KEY = "cierre_turno_visibilidad";

const DEFAULT_SETTINGS = {
  efectivo: true,
  datafono: true,
  rappi: true,
  nequi: true,
  transferencias: true,
  propina: true,
  domicilios: true,
};

const status = document.getElementById("status");

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

const settings = getSettings();

document.querySelectorAll("input[type='checkbox'][data-field]").forEach((toggle) => {
  const field = toggle.dataset.field;
  toggle.checked = settings[field] !== false;
  toggle.addEventListener("change", () => {
    settings[field] = toggle.checked;
    saveSettings(settings);
  });
});

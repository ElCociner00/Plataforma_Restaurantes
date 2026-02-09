import { getUserContext } from "../js/session.js";
import { WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS } from "../js/webhooks.js";

const status = document.getElementById("status");
const panel = document.getElementById("productosPanel");
const getTimestamp = () => new Date().toISOString();

const setStatus = (message) => {
  status.textContent = message;
};

const normalizeList = (raw, keys = []) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

    for (const key of keys) {
      const nested = raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        if (Array.isArray(item[key])) return item[key];
        if (item[key] && typeof item[key] === "object") {
          return Object.entries(item[key]).map(([id, value]) => ({
            id,
            ...(typeof value === "object" ? value : { value })
          }));
        }
        return [];
      });
      if (nested.length) return nested;
    }

    return raw;
  }

  if (typeof raw !== "object") return [];

  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
    if (raw[key] && typeof raw[key] === "object") {
      return Object.entries(raw[key]).map(([id, item]) => ({
        id,
        ...(typeof item === "object" ? item : { value: item })
      }));
    }
  }

  return Object.entries(raw)
    .filter(([id]) => id !== "ok" && id !== "message")
    .map(([id, item]) => ({
      id,
      ...(typeof item === "object" ? item : { value: item })
    }));
};

const getVisibilityKey = (tenantId) => `cierre_inventarios_visibilidad_${tenantId || "global"}`;

const saveSettings = (tenantId, settings) => {
  localStorage.setItem(getVisibilityKey(tenantId), JSON.stringify(settings));
  setStatus("Preferencias guardadas.");
};

const loadSettings = (tenantId) => {
  const stored = localStorage.getItem(getVisibilityKey(tenantId));
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    return {};
  }
};

const loadProducts = async () => {
  const context = await getUserContext();
  if (!context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setStatus("Cargando productos...");

  try {
    const res = await fetch(WEBHOOK_CIERRE_INVENTARIOS_VISUALIZACION_PRODUCTOS, {
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

    const settings = loadSettings(context.empresa_id);
    const productos = normalizeList(data, ["productos", "items"]);

    panel.innerHTML = "";

    productos.forEach((item) => {
      const productId = String(item.id ?? item.producto_id ?? item.codigo ?? "");
      if (!productId) return;
      const nombre = item.nombre ?? item.name ?? item.descripcion ?? `Producto ${productId}`;
      const visible = settings[productId] !== false;

      const row = document.createElement("div");
      row.className = "vis-row";
      row.innerHTML = `
        <span>${nombre}</span>
        <label class="switch">
          <input type="checkbox" data-product-id="${productId}" ${visible ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      `;
      panel.appendChild(row);

      row.querySelector("input").addEventListener("change", (event) => {
        settings[productId] = event.target.checked;
        saveSettings(context.empresa_id, settings);
      });
    });

    setStatus(productos.length ? "Productos cargados." : "No se recibieron productos.");
  } catch (error) {
    setStatus("Error cargando productos de visualización.");
  }
};

loadProducts();

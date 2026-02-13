import { getUserContext } from "./session.js";
import { WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS } from "./webhooks.js";

const panelGeneral = document.getElementById("columnasGeneralesPanel");
const panelDetalle = document.getElementById("columnasDetallePanel");
const panelProductos = document.getElementById("productosPanel");
const panelFilas = document.getElementById("filasDetallePanel");
const status = document.getElementById("status");
const getTimestamp = () => new Date().toISOString();

const GENERAL_COLS = ["fecha_cierre", "total_productos", "stock_total_inicial", "consumo_total", "stock_total_final"];
const DETAIL_COLS = ["producto_nombre", "stock_inicial", "stock_gastado", "stock_restante", "hora_inicio", "hora_fin"];

const getGeneralVisibilityKey = (tenantId) => `historico_cierre_inventarios_visibilidad_${tenantId || "global"}`;
const getDetailVisibilityColumnsKey = (tenantId) => `historico_cierre_inventarios_columnas_detalle_visibilidad_${tenantId || "global"}`;
const getProductVisibilityKey = (tenantId) => `historico_cierre_inventarios_productos_visibilidad_${tenantId || "global"}`;
const getDetailRowVisibilityKey = (tenantId) => `historico_cierre_inventarios_detalle_visibilidad_${tenantId || "global"}`;
const getGeneralOrderKey = (tenantId) => `historico_cierre_inventarios_orden_general_${tenantId || "global"}`;
const getDetailOrderKey = (tenantId) => `historico_cierre_inventarios_orden_detalle_${tenantId || "global"}`;

const loadJson = (key, fallback = {}) => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
};

const saveJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
  status.textContent = "Preferencias guardadas.";
};

const normalizeRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "historico", "cierres", "inventarios"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
};

const renderList = (container, items, settings, onSave) => {
  container.innerHTML = "";
  items.forEach((item) => {
    const key = String(item.key);
    const visible = settings[key] !== false;
    const row = document.createElement("div");
    row.className = "vis-row";
    row.draggable = true;
    row.dataset.key = key;
    row.innerHTML = `
      <span>${item.label}</span>
      <label class="switch">
        <input type="checkbox" ${visible ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;

    row.querySelector("input")?.addEventListener("change", (event) => {
      settings[key] = event.target.checked;
      onSave();
    });

    row.addEventListener("dragstart", () => row.classList.add("dragging"));
    row.addEventListener("dragend", () => row.classList.remove("dragging"));
    row.addEventListener("dragover", (event) => event.preventDefault());
    row.addEventListener("drop", () => {
      const source = container.querySelector(".dragging")?.dataset.key;
      const target = key;
      if (!source || source === target) return;
      const order = items.map((x) => x.key);
      const from = order.indexOf(source);
      const to = order.indexOf(target);
      if (from < 0 || to < 0) return;
      order.splice(to, 0, order.splice(from, 1)[0]);
      onSave(order);
    });

    container.appendChild(row);
  });
};

const loadSettingsPanels = async () => {
  const context = await getUserContext();
  if (!context) {
    status.textContent = "No se pudo validar la sesión.";
    return;
  }

  const payload = {
    tenant_id: context.empresa_id,
    empresa_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    rol: context.rol,
    timestamp: getTimestamp()
  };

  status.textContent = "Cargando estructura histórica...";

  try {
    const res = await fetch(WEBHOOK_HISTORICO_CIERRE_INVENTARIOS_DATOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const rows = normalizeRows(await res.json());
    const products = new Map();
    const detailRows = [];

    rows.forEach((row) => {
      (Array.isArray(row.productos) ? row.productos : []).forEach((p) => {
        const productId = String(p.producto_id || "");
        if (productId && !products.has(productId)) products.set(productId, String(p.producto_nombre || productId));
        const detailKey = `${productId}|${p.hora_inicio || ""}|${p.hora_fin || ""}`;
        detailRows.push({
          key: detailKey,
          label: `${p.producto_nombre || productId} (${p.hora_inicio || "--"} - ${p.hora_fin || "--"})`
        });
      });
    });

    const generalVisibility = loadJson(getGeneralVisibilityKey(context.empresa_id), {});
    const detailColumnsVisibility = loadJson(getDetailVisibilityColumnsKey(context.empresa_id), {});
    const productsVisibility = loadJson(getProductVisibilityKey(context.empresa_id), {});
    const detailRowVisibility = loadJson(getDetailRowVisibilityKey(context.empresa_id), {});

    const generalOrder = loadJson(getGeneralOrderKey(context.empresa_id), GENERAL_COLS);
    const detailOrder = loadJson(getDetailOrderKey(context.empresa_id), DETAIL_COLS);

    const orderedGeneral = generalOrder.map((key) => ({ key, label: key })).filter((x) => GENERAL_COLS.includes(x.key));
    const orderedDetail = detailOrder.map((key) => ({ key, label: key })).filter((x) => DETAIL_COLS.includes(x.key));

    renderList(panelGeneral, orderedGeneral, generalVisibility, (order) => {
      if (Array.isArray(order)) saveJson(getGeneralOrderKey(context.empresa_id), order);
      saveJson(getGeneralVisibilityKey(context.empresa_id), generalVisibility);
      loadSettingsPanels();
    });

    renderList(panelDetalle, orderedDetail, detailColumnsVisibility, (order) => {
      if (Array.isArray(order)) saveJson(getDetailOrderKey(context.empresa_id), order);
      saveJson(getDetailVisibilityColumnsKey(context.empresa_id), detailColumnsVisibility);
      loadSettingsPanels();
    });

    renderList(panelProductos, Array.from(products.entries()).map(([key, label]) => ({ key, label })), productsVisibility, () => {
      saveJson(getProductVisibilityKey(context.empresa_id), productsVisibility);
    });

    renderList(panelFilas, detailRows, detailRowVisibility, () => {
      saveJson(getDetailRowVisibilityKey(context.empresa_id), detailRowVisibility);
    });

    status.textContent = "Configuración cargada.";
  } catch (error) {
    status.textContent = "Error cargando configuración histórica.";
  }
};

loadSettingsPanels();

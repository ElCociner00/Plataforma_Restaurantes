import { getUserContext } from "./session.js";
import {
  WEBHOOK_COMPRAS_VERIFICACION_FACTURAS,
  WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS,
  WEBHOOK_COMPRAS_SUBIR_MATCH
} from "./webhooks.js";

const statusEl = document.getElementById("comprasStatus");
const facturasWrap = document.getElementById("comprasFacturas");
const detalleWrap = document.getElementById("comprasDetalle");
const detalleTitulo = document.getElementById("detalleTitulo");
const detalleBody = document.getElementById("detalleBody");
const btnVolver = document.getElementById("volverFacturas");
const btnEnviar = document.getElementById("enviarCompras");

let context = null;
let inventarios = [];
let facturasBase = [];
let facturaActiva = null;

const setStatus = (msg) => { statusEl.textContent = msg || ""; };

const normalizeList = (raw) => {
  if (Array.isArray(raw?.[0]?.data)) return raw[0].data;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
};

const isIgnorableProduct = (name) => {
  const upper = String(name || "").toUpperCase();
  return upper.includes("BANCOLOMBIA") || upper.includes("IMPUESTO");
};

const getFacturaKey = (row) => String(row?.uuid || `${row["Prefijo Factura"] || ""}-${row["Consecutivo Factura"] || ""}`);

async function fetchFacturas() {
  const res = await fetch(WEBHOOK_COMPRAS_VERIFICACION_FACTURAS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ empresa_id: context.empresa_id, tenant_id: context.empresa_id })
  });
  const data = await res.json();
  return normalizeList(data).filter((r) => r && getFacturaKey(r));
}

async function fetchInventarios() {
  const res = await fetch(WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ empresa_id: context.empresa_id, tenant_id: context.empresa_id })
  });
  const data = await res.json();
  return normalizeList(data).filter((p) => p?.id && p?.nombre);
}

function groupFacturas(rows) {
  const byFactura = new Map();
  rows.forEach((row) => {
    const key = getFacturaKey(row);
    if (!byFactura.has(key)) {
      byFactura.set(key, {
        key,
        uuid: row.uuid || "",
        prefijo: row["Prefijo Factura"] || "",
        consecutivo: row["Consecutivo Factura"] || "",
        proveedor: row.Proveedor || "",
        fecha: row["Fecha Factura"] || "",
        revisada: String(row.Revisada || "").trim(),
        rows: []
      });
    }
    byFactura.get(key).rows.push(row);
  });
  return Array.from(byFactura.values());
}

function renderFacturas() {
  const groups = groupFacturas(facturasBase);
  facturasWrap.innerHTML = "";

  if (!groups.length) {
    facturasWrap.innerHTML = "<p>No hay facturas para esta empresa.</p>";
    return;
  }

  groups.forEach((f) => {
    const pendiente = !f.revisada;
    const card = document.createElement("article");
    card.className = "factura-card";
    card.innerHTML = `
      <div class="factura-card-head">
        <div><strong>Factura:</strong> ${f.prefijo} ${f.consecutivo}</div>
        <div><strong>Proveedor:</strong> ${f.proveedor}</div>
        <div><strong>Fecha:</strong> ${f.fecha}</div>
        <div><span class="factura-tag ${pendiente ? "pendiente" : "revisada"}">${pendiente ? "Pendiente" : "Revisada"}</span></div>
      </div>
    `;
    card.addEventListener("click", () => openDetalleFactura(f));
    facturasWrap.appendChild(card);
  });
}

function normalizeDetalleRows(rows) {
  return rows
    .filter((r) => String(r?.Producto || "").trim())
    .filter((r) => !isIgnorableProduct(r.Producto))
    .map((r) => ({
      producto: String(r.Producto || "").trim(),
      cantidadLlegada: Number(r.Cantidad || 0)
    }));
}

function buildInventarioOptions() {
  return ['<option value="">Seleccionar</option>']
    .concat(inventarios.map((p) => `<option value="${p.id}">${p.nombre}</option>`))
    .join("");
}

function renderDetalle(factura, detalleRows) {
  detalleTitulo.textContent = `Detalle factura ${factura.prefijo} ${factura.consecutivo}`;
  detalleBody.innerHTML = "";

  if (!detalleRows.length) {
    detalleBody.innerHTML = '<tr><td colspan="5">No hay productos inventariables en esta factura.</td></tr>';
    btnEnviar.disabled = true;
    return;
  }

  const options = buildInventarioOptions();
  detalleRows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.producto}</td>
      <td>${row.cantidadLlegada}</td>
      <td><select class="sel-prod" data-index="${index}">${options}</select></td>
      <td><input class="inp-cantidad" data-index="${index}" type="number" min="0" step="0.01" value="${row.cantidadLlegada}"></td>
      <td class="unidad-cell">-</td>
    `;
    detalleBody.appendChild(tr);
  });

  detalleBody.querySelectorAll(".sel-prod").forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest("tr");
      const inv = inventarios.find((p) => p.id === sel.value);
      tr.querySelector(".unidad-cell").textContent = inv?.unidad || "-";
    });
  });

  btnEnviar.disabled = false;
}

async function openDetalleFactura(factura) {
  facturaActiva = factura;
  setStatus("Cargando detalle de factura e inventario...");

  if (!inventarios.length) inventarios = await fetchInventarios();

  const detalleRows = normalizeDetalleRows(factura.rows);
  renderDetalle(factura, detalleRows);

  facturasWrap.closest("section")?.classList.add("is-hidden");
  detalleWrap.classList.remove("is-hidden");
  setStatus(`Factura ${factura.prefijo} ${factura.consecutivo} lista para match.`);
}

btnVolver.addEventListener("click", () => {
  detalleWrap.classList.add("is-hidden");
  facturasWrap.closest("section")?.classList.remove("is-hidden");
  facturaActiva = null;
  setStatus("Selecciona una factura para continuar.");
});

btnEnviar.addEventListener("click", async () => {
  if (!facturaActiva) return;

  const items = [];
  detalleBody.querySelectorAll("tr").forEach((tr) => {
    const sel = tr.querySelector(".sel-prod");
    const inp = tr.querySelector(".inp-cantidad");
    if (!sel || !inp || !sel.value) return;
    const inv = inventarios.find((p) => p.id === sel.value);
    items.push({
      factura_uuid: facturaActiva.uuid,
      factura_prefijo: facturaActiva.prefijo,
      factura_consecutivo: facturaActiva.consecutivo,
      producto_factura: tr.children[0].textContent,
      cantidad_llegada: Number(tr.children[1].textContent || 0),
      producto_loggro_id: sel.value,
      producto_loggro_nombre: inv?.nombre || "",
      locationStockId: inv?.locationStockId || "",
      cantidad_match: Number(inp.value || 0),
      unidad: inv?.unidad || ""
    });
  });

  if (!items.length) {
    setStatus("Debes seleccionar al menos un producto para enviar.");
    return;
  }

  setStatus("Enviando compras...");
  btnEnviar.disabled = true;
  try {
    const res = await fetch(WEBHOOK_COMPRAS_SUBIR_MATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresa_id: context.empresa_id, tenant_id: context.empresa_id, items })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    setStatus("Compra enviada correctamente.");
  } catch (error) {
    setStatus(`No se pudo enviar: ${error.message}`);
  } finally {
    btnEnviar.disabled = false;
  }
});

async function init() {
  setStatus("Cargando compras...");
  context = await getUserContext();
  if (!context?.empresa_id) {
    setStatus("No hay empresa activa.");
    return;
  }

  try {
    facturasBase = await fetchFacturas();
    renderFacturas();
    setStatus("Selecciona una factura para revisar detalle y enviar.");
  } catch (error) {
    setStatus(`Error cargando compras: ${error.message}`);
  }
}

init();

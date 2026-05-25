import { getUserContext } from "./session.js";
import {
  WEBHOOK_COMPRAS_VERIFICACION_FACTURAS,
  WEBHOOK_COMPRAS_DATOS_FACTURA,
  WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS,
  WEBHOOK_COMPRAS_SUBIR_MATCH
} from "./webhooks.js";

const statusEl = document.getElementById("comprasStatus");
const facturasWrap = document.getElementById("comprasFacturas");
const tabPrincipal = document.getElementById("tabComprasPrincipal");
const tabNoCorresponde = document.getElementById("tabComprasNoCorresponde");
const tabRevisadas = document.getElementById("tabComprasRevisadas");
const detalleWrap = document.getElementById("comprasDetalle");
const detalleTitulo = document.getElementById("detalleTitulo");
const detalleBody = document.getElementById("detalleBody");
const btnVolver = document.getElementById("volverFacturas");
const btnEnviar = document.getElementById("enviarCompras");
const btnNoCorresponde = document.getElementById("noCorrespondeCompras");
const saleDeCajaCheckbox = document.getElementById("saleDeCajaCompras");

let context = null;
let inventarios = [];
let facturasBase = [];
let facturaActiva = null;
let detalleSnapshot = [];
let detailRequestToken = 0;

const setStatus = (msg, type = "info") => {
  statusEl.textContent = msg || "";
  statusEl.className = `compras-status status-${type}`;
};

const normalizeList = (raw) => {
  if (Array.isArray(raw?.[0]?.data)) return raw[0].data;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw)) return raw;
  return [];
};

const normalizeTextKey = (value) => String(value || "").trim().toUpperCase();

const isIgnorableProduct = (name) => {
  const upper = normalizeTextKey(name);
  return upper.includes("BANCOLOMBIA") || upper.includes("IMPUESTO") || upper.includes("IVA");
};

const getFacturaKey = (row) => String(row?.uuid || `${row["Prefijo Factura"] || ""}-${row["Consecutivo Factura"] || ""}`);

const parseFechaFacturaToTime = (value) => {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return 0;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const time = new Date(year, month - 1, day).getTime();
  return Number.isFinite(time) ? time : 0;
};

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || `HTTP ${res.status}`);
  return data;
}

async function fetchFacturas() {
  const data = await postJson(WEBHOOK_COMPRAS_VERIFICACION_FACTURAS, {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id
  });
  return normalizeList(data).filter((r) => r && getFacturaKey(r));
}

async function fetchDetalleFactura(factura) {
  const data = await postJson(WEBHOOK_COMPRAS_DATOS_FACTURA, {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id,
    uuid: factura.uuid,
    prefijo_factura: factura.prefijo,
    consecutivo_factura: factura.consecutivo
  });
  return normalizeList(data);
}

async function fetchInventarios() {
  const data = await postJson(WEBHOOK_COMPRAS_CONSULTAR_INVENTARIOS, {
    empresa_id: context.empresa_id,
    tenant_id: context.empresa_id
  });
  return normalizeList(data).filter((p) => p?.id && p?.nombre);
}

const normalizeRevisionStatus = (value) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "false" || raw === "null" || raw === "undefined" || raw === "empty") return 0;
  if (raw === "2" || raw.includes("no corresponde")) return 2;
  if (raw === "1" || raw === "true" || raw.includes("revis")) return 1;
  return 0;
};

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
        revisionEstado: normalizeRevisionStatus(row.Revisada)
      });
    }
  });
  return Array.from(byFactura.values()).sort((a, b) => parseFechaFacturaToTime(b.fecha) - parseFechaFacturaToTime(a.fecha));
}

function renderFacturas(view = "principal") {
  const groups = groupFacturas(facturasBase)
    .filter((f) => {
      if (view === "no_corresponde") return f.revisionEstado === 2;
      if (view === "revisadas") return f.revisionEstado === 1;
      return f.revisionEstado === 0;
    });
  facturasWrap.innerHTML = "";

  if (!groups.length) {
    const emptyMessage = view === "no_corresponde"
      ? "No hay facturas marcadas como no corresponde."
      : view === "revisadas"
        ? "No hay facturas revisadas."
        : "No hay facturas pendientes para esta empresa.";
    facturasWrap.innerHTML = `<p>${emptyMessage}</p>`;
    return;
  }

  groups.forEach((f) => {
    const pendiente = f.revisionEstado === 0;
    const revisada = f.revisionEstado === 1;
    const noCorresponde = f.revisionEstado === 2;
    const card = document.createElement("article");
    card.className = `factura-card ${revisada ? "is-locked" : ""}`;
    card.innerHTML = `
      <div class="factura-card-head">
        <div><strong>Factura:</strong> ${f.prefijo} ${f.consecutivo}</div>
        <div><strong>Proveedor:</strong> ${f.proveedor}</div>
        <div><strong>Fecha:</strong> ${f.fecha}</div>
        <div><span class="factura-tag ${pendiente ? "pendiente" : revisada ? "revisada" : "no-corresponde"}">${pendiente ? "Pendiente" : revisada ? "Revisada" : "No corresponde"}</span></div>
      </div>
    `;
    if (revisada) {
      card.title = "Factura revisada: bloqueada para evitar doble subida.";
    }
    card.addEventListener("click", () => openDetalleFactura(f));
    facturasWrap.appendChild(card);
  });
}

function normalizeDetalleRows(rows, factura) {
  const mergedByProduct = new Map();
  const facturaUuid = String(factura?.uuid || "").trim();
  const prefijo = String(factura?.prefijo || "").trim();
  const consecutivo = String(factura?.consecutivo || "").trim();

  rows
    .filter((r) => String(r?.Producto || "").trim())
    .filter((r) => !isIgnorableProduct(r.Producto))
    .filter((r) => {
      const rowUuid = String(r?.uuid || "").trim();
      const rowPrefijo = String(r?.["Prefijo Factura"] || "").trim();
      const rowConsecutivo = String(r?.["Consecutivo Factura"] || "").trim();
      if (facturaUuid && rowUuid) return rowUuid === facturaUuid;
      return rowPrefijo === prefijo && rowConsecutivo === consecutivo;
    })
    .forEach((r) => {
      const producto = String(r.Producto || "").trim();
      const key = normalizeTextKey(producto);
      const cantidad = Number(r.Cantidad || 0);
      const safeCantidad = Number.isFinite(cantidad) ? cantidad : 0;

      if (!mergedByProduct.has(key)) {
        mergedByProduct.set(key, {
          producto,
          cantidadLlegada: safeCantidad,
          factura_uuid: String(r?.uuid || factura?.uuid || ""),
          factura_prefijo: String(r?.["Prefijo Factura"] || factura?.prefijo || ""),
          factura_consecutivo: Number(r?.["Consecutivo Factura"] || factura?.consecutivo || 0)
        });
        return;
      }

      const current = mergedByProduct.get(key);
      current.cantidadLlegada += safeCantidad;
    });

  return Array.from(mergedByProduct.values());
}

function buildInventarioOptions() {
  return ['<option value="">Seleccionar</option>']
    .concat(inventarios.map((p) => `<option value="${p.id}">${p.nombre}</option>`))
    .join("");
}

function renderDetalle(factura, detalleRows) {
  detalleTitulo.textContent = `Detalle factura ${factura.prefijo} ${factura.consecutivo}`;
  detalleBody.innerHTML = "";
  if (saleDeCajaCheckbox) saleDeCajaCheckbox.checked = false;

  if (!detalleRows.length) {
    detalleBody.innerHTML = '<tr><td colspan="5">No hay productos inventariables en esta factura.</td></tr>';
    btnEnviar.disabled = true;
    btnNoCorresponde.disabled = true;
    return;
  }

  const options = buildInventarioOptions();
  detalleRows.forEach((row, idx) => {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(idx);
    tr.innerHTML = `
      <td>${row.producto}</td>
      <td>${row.cantidadLlegada}</td>
      <td><select class="sel-prod">${options}</select></td>
      <td><input class="inp-cantidad" type="number" min="0" step="0.01" value="${row.cantidadLlegada}"></td>
      <td class="unidad-cell">unidad</td>
    `;
    detalleBody.appendChild(tr);
  });

  detalleBody.querySelectorAll(".sel-prod").forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest("tr");
      const inv = inventarios.find((p) => p.id === sel.value);
      const unidadRaw = String(inv?.unidad || "").trim();
      tr.querySelector(".unidad-cell").textContent = unidadRaw || "unidad";
    });
  });

  btnEnviar.disabled = false;
  btnNoCorresponde.disabled = false;
}

async function openDetalleFactura(factura) {
  if (factura?.revisionEstado === 1) {
    setStatus(`La factura ${factura.prefijo} ${factura.consecutivo} ya está revisada y no puede abrirse de nuevo.`, "error");
    return;
  }
  facturaActiva = factura;
  detalleSnapshot = [];
  const requestToken = ++detailRequestToken;
  setStatus("Consultando detalle de factura...", "info");

  try {
    if (!inventarios.length) inventarios = await fetchInventarios();
    const detalleRaw = await fetchDetalleFactura(factura);
    if (requestToken !== detailRequestToken) return;

    const detalleRows = normalizeDetalleRows(detalleRaw, factura);
    detalleSnapshot = detalleRows;
    renderDetalle(factura, detalleRows);

    facturasWrap.closest("section")?.classList.add("is-hidden");
    detalleWrap.classList.remove("is-hidden");
    setStatus(`Factura ${factura.prefijo} ${factura.consecutivo} lista para match.`, "info");
  } catch (error) {
    if (requestToken !== detailRequestToken) return;
    setStatus(`No se pudo cargar el detalle: ${error.message}`, "error");
  }
}

btnVolver.addEventListener("click", () => {
  detailRequestToken += 1;
  detalleWrap.classList.add("is-hidden");
  facturasWrap.closest("section")?.classList.remove("is-hidden");
  facturaActiva = null;
  detalleSnapshot = [];
  setStatus("Selecciona una factura para continuar.", "info");
});

btnNoCorresponde.addEventListener("click", async () => {
  if (!facturaActiva) return;

  const usuarioId = context?.user?.id || context?.user?.user_id || "";
  const saleDeCaja = Boolean(saleDeCajaCheckbox?.checked);

  setStatus("Enviando factura como no corresponde...", "info");
  btnEnviar.disabled = true;
  btnNoCorresponde.disabled = true;
  try {
    await postJson(WEBHOOK_COMPRAS_SUBIR_MATCH, {
      empresa_id: context.empresa_id,
      tenant_id: context.empresa_id,
      usuario_id: usuarioId,
      sale_de_caja: saleDeCaja,
      factura_uuid: facturaActiva.uuid,
      factura_prefijo: facturaActiva.prefijo,
      factura_consecutivo: facturaActiva.consecutivo,
      no_corresponde: true,
      items: []
    });
    setStatus("✅ Factura marcada como NO CORRESPONDE y enviada correctamente.", "success");
    facturasBase = await fetchFacturas();
    detalleWrap.classList.add("is-hidden");
    facturasWrap.closest("section")?.classList.remove("is-hidden");
    renderFacturas("principal");
  } catch (error) {
    setStatus(`No se pudo enviar no corresponde: ${error.message}`, "error");
  } finally {
    btnEnviar.disabled = false;
    btnNoCorresponde.disabled = false;
  }
});

btnEnviar.addEventListener("click", async () => {
  if (!facturaActiva || !detalleSnapshot.length) return;

  const usuarioId = context?.user?.id || context?.user?.user_id || "";
  const saleDeCaja = Boolean(saleDeCajaCheckbox?.checked);

  const items = [];
  detalleBody.querySelectorAll("tr").forEach((tr) => {
    const rowIndex = Number(tr.dataset.rowIndex || -1);
    const snapshotRow = detalleSnapshot[rowIndex];
    if (!snapshotRow) return;

    const sel = tr.querySelector(".sel-prod");
    const inp = tr.querySelector(".inp-cantidad");
    if (!sel || !inp || !sel.value) return;
    const inv = inventarios.find((p) => p.id === sel.value);

    items.push({
      factura_uuid: snapshotRow.factura_uuid || facturaActiva.uuid,
      factura_prefijo: snapshotRow.factura_prefijo || facturaActiva.prefijo,
      factura_consecutivo: snapshotRow.factura_consecutivo || Number(facturaActiva.consecutivo || 0),
      producto_factura: snapshotRow.producto,
      cantidad_llegada: snapshotRow.cantidadLlegada,
      producto_loggro_id: sel.value,
      producto_loggro_nombre: inv?.nombre || "",
      locationStockId: inv?.locationStockId || "",
      cantidad_match: Number(inp.value || 0),
      unidad: inv?.unidad || "",
      precio_compra: Number(inv?.precioCompra ?? 0)
    });
  });

  if (!items.length) {
    setStatus("Debes seleccionar al menos un producto para enviar.", "error");
    return;
  }

  setStatus("Enviando compras...", "info");
  btnEnviar.disabled = true;
  btnNoCorresponde.disabled = true;
  try {
    await postJson(WEBHOOK_COMPRAS_SUBIR_MATCH, {
      empresa_id: context.empresa_id,
      tenant_id: context.empresa_id,
      usuario_id: usuarioId,
      sale_de_caja: saleDeCaja,
      factura_uuid: facturaActiva.uuid,
      factura_prefijo: facturaActiva.prefijo,
      factura_consecutivo: facturaActiva.consecutivo,
      items
    });
    setStatus("✅ Compra enviada correctamente.", "success");
    facturasBase = await fetchFacturas();
    detalleWrap.classList.add("is-hidden");
    facturasWrap.closest("section")?.classList.remove("is-hidden");
    renderFacturas("principal");
  } catch (error) {
    setStatus(`No se pudo enviar: ${error.message}`, "error");
  } finally {
    btnEnviar.disabled = false;
    btnNoCorresponde.disabled = false;
  }
});

async function init() {
  setStatus("Cargando compras...", "info");
  context = await getUserContext();
  if (!context?.empresa_id) {
    setStatus("No hay empresa activa.", "error");
    return;
  }

  try {
    facturasBase = await fetchFacturas();
    const activateTab = (view) => {
      tabPrincipal?.classList.toggle("is-active", view === "principal");
      tabNoCorresponde?.classList.toggle("is-active", view === "no_corresponde");
      tabRevisadas?.classList.toggle("is-active", view === "revisadas");
      renderFacturas(view);
    };
    activateTab("principal");
    tabPrincipal?.addEventListener("click", () => activateTab("principal"));
    tabNoCorresponde?.addEventListener("click", () => activateTab("no_corresponde"));
    tabRevisadas?.addEventListener("click", () => activateTab("revisadas"));
    setStatus("Selecciona una factura para revisar detalle y enviar.", "info");
  } catch (error) {
    setStatus(`Error cargando compras: ${error.message}`, "error");
  }
}

init();

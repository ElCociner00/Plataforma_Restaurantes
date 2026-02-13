import { getUserContext } from "./session.js";
import {
  WEBHOOK_CARGAR_FACTURAS_CORREO,
  WEBHOOK_LISTAR_RESPONSABLES,
  WEBHOOK_SUBIR_SIIGO
} from "./webhooks.js";

const head = document.getElementById("facturasHead");
const body = document.getElementById("facturasBody");
const detalleFactura = document.getElementById("detalleFactura");
const status = document.getElementById("status");
const paginacion = document.getElementById("facturasPaginacion");

const responsable = document.getElementById("responsable");
const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroNumero = document.getElementById("filtroNumero");
const filtroProveedor = document.getElementById("filtroProveedor");
const filtroNit = document.getElementById("filtroNit");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const modoDescarga = document.getElementById("modoDescarga");
const btnDescargarFacturas = document.getElementById("descargarFacturas");

const getTimestamp = () => new Date().toISOString();
const DETAILS_ORDER_KEY = "siigo_facturas_detalle_order";
const PAGE_SIZE = 30;

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  selectedId: null,
  currentPage: 1,
  generalColumns: [
    "numero_factura", "fecha_iso", "proveedor", "nit", "estado", "tipo_factura", "debitos", "creditos", "balance"
  ],
  detailColumns: [
    "producto", "cantidad", "valor_unitario", "subtotal", "porcentaje_impuesto", "codigo_contable", "valor_debito", "valor_credito", "descripcion"
  ],
  detailOrderByInvoice: {}
};

const setStatus = (message) => { status.textContent = message; };
const format = (v) => (v === null || v === undefined || v === "" ? "-" : String(v));
const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const normalizeRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "facturas", "result"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
};

const buildContextPayload = () => ({
  tenant_id: state.context?.empresa_id,
  empresa_id: state.context?.empresa_id,
  usuario_id: state.context?.user?.id || state.context?.user?.user_id,
  rol: state.context?.rol,
  responsable_id: responsable.value || "",
  timestamp: getTimestamp()
});

const fetchJson = async (url, payload, method = "POST") => {
  const requestUrl = method === "GET" && payload
    ? `${url}?${new URLSearchParams(payload).toString()}`
    : url;

  const res = await fetch(requestUrl, {
    method,
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload) : undefined
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return res.json();

  const text = await res.text();
  if (!text) return [];

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
};

const fetchWebhookWithFallback = async (url, payload) => {
  try {
    return await fetchJson(url, payload, "POST");
  } catch {
    return fetchJson(url, payload, "GET");
  }
};

const invoiceId = (row, idx) => `${row.numero_factura || "sin-numero"}-${idx}`;

const detailRowWeight = (item) => {
  const name = String(item.producto || "").trim().toUpperCase();
  const hasCredit = Number(item.valor_credito || 0) > 0;
  if (hasCredit || name.includes("CREDITO") || name.includes("BANCO")) return 2;
  if (name === "IMPUESTO" || name.includes("IMPUESTO")) return 1;
  return 0;
};

const baseSortDetails = (items = []) => [...items].sort((a, b) => detailRowWeight(a) - detailRowWeight(b));

const getPaginatedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const getDetailsByInvoice = (invoice) => {
  const base = baseSortDetails(Array.isArray(invoice?.items) ? invoice.items : []);
  const saved = state.detailOrderByInvoice[invoice?.__id];
  if (!Array.isArray(saved) || !saved.length) return base;

  const map = new Map(base.map((item, index) => [String(item.id_unico || `${item.producto}-${index}`), item]));
  const ordered = [];
  saved.forEach((id) => {
    if (map.has(id)) {
      ordered.push(map.get(id));
      map.delete(id);
    }
  });
  map.forEach((item) => ordered.push(item));
  return ordered;
};

const getDetailsByInvoiceId = (id) => {
  const invoice = state.allRows.find((row) => row.__id === id);
  if (!invoice) return [];
  return getDetailsByInvoice(invoice);
};

const createDetailInlineRow = (row) => {
  const detailTr = document.createElement("tr");
  detailTr.className = "detail-inline-row";

  const detailTd = document.createElement("td");
  detailTd.colSpan = state.generalColumns.length + 1;
  detailTd.innerHTML = buildDetailTableHtml(row.__id);

  detailTr.appendChild(detailTd);
  return detailTr;
};

const bindInlineDetailDrag = () => {
  let draggingKey = null;
  const rows = body.querySelectorAll("tr[data-detail-key]");
  rows.forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      draggingKey = tr.dataset.detailKey;
      tr.classList.add("dragging");
    });
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
    tr.addEventListener("dragover", (event) => event.preventDefault());
    tr.addEventListener("drop", () => {
      const targetKey = tr.dataset.detailKey;
      if (!draggingKey || !targetKey || draggingKey === targetKey) return;
      const current = getDetailsByInvoiceId(state.selectedId)
        .map((item, idx) => String(item.id_unico || `${item.producto}-${idx}`));
      const from = current.indexOf(draggingKey);
      const to = current.indexOf(targetKey);
      if (from < 0 || to < 0) return;

      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.detailOrderByInvoice[state.selectedId] = next;
      localStorage.setItem(DETAILS_ORDER_KEY, JSON.stringify(state.detailOrderByInvoice));
      renderTable();
      updateDetailStatusText();
    });
  });
};

const buildDetailTableHtml = (invoiceIdValue) => {
  const items = getDetailsByInvoiceId(invoiceIdValue);
  const detailHead = ["↕", ...state.detailColumns].map((col) => `<th>${col}</th>`).join("");

  if (!items.length) {
    return `
      <div class="inline-detail-wrap">
        <table class="inline-detail-table">
          <thead><tr>${detailHead}</tr></thead>
          <tbody><tr><td colspan="${state.detailColumns.length + 1}">Sin items.</td></tr></tbody>
        </table>
      </div>
    `;
  }

  const detailRows = items.map((item, idx) => {
    const key = String(item.id_unico || `${item.producto}-${idx}`);
    const cols = state.detailColumns.map((col) => `<td>${format(item[col])}</td>`).join("");
    return `<tr draggable="true" data-detail-key="${key}"><td class="drag-col">⋮⋮</td>${cols}</tr>`;
  }).join("");

  return `
    <div class="inline-detail-wrap">
      <table class="inline-detail-table">
        <thead><tr>${detailHead}</tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
  `;
};

const updateDetailStatusText = () => {
  const selected = state.allRows.find((row) => row.__id === state.selectedId);
  detalleFactura.textContent = selected
    ? `Detalle de ${format(selected.numero_factura)} visible debajo de la fila seleccionada.`
    : "Selecciona una factura para ver items debajo de su fila.";
};

const bindColumnDrag = () => {
  head.querySelectorAll("th[data-column]").forEach((th) => {
    th.draggable = true;
    th.addEventListener("dragstart", () => th.classList.add("dragging"));
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (event) => event.preventDefault());
    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.dataset.column;
      const target = th.dataset.column;
      if (!source || !target || source === target) return;
      const from = state.generalColumns.indexOf(source);
      const to = state.generalColumns.indexOf(target);
      if (from < 0 || to < 0) return;
      const next = [...state.generalColumns];
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.generalColumns = next;
      renderTable();
    });
  });
};

const renderPagination = () => {
  if (!paginacion) return;
  paginacion.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
  for (let page = 1; page <= totalPages; page += 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = String(page);
    if (page === state.currentPage) button.classList.add("active");

    button.addEventListener("click", () => {
      state.currentPage = page;
      renderTable();
    });
    paginacion.appendChild(button);
  }
};

const renderTable = () => {
  const headers = ["subir_siigo", ...state.generalColumns];
  head.innerHTML = `<tr>${headers.map((col) => {
    if (col === "subir_siigo") return "<th>Siigo</th>";
    const className = col === "fecha_iso" ? " class=\"fecha-col\"" : "";
    return `<th data-column="${col}"${className}>${col}</th>`;
  }).join("")}</tr>`;

  body.innerHTML = "";
  const rows = getPaginatedRows();

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("selected", row.__id === state.selectedId);

    const tdSwitch = document.createElement("td");
    tdSwitch.innerHTML = `
      <label class="switch">
        <input type="checkbox" ${row.siigo_subido ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;

    tdSwitch.querySelector("input")?.addEventListener("change", async (event) => {
      const checked = event.target.checked;
      event.target.disabled = true;
      setStatus(checked ? "Subiendo factura a Siigo..." : "Revirtiendo factura en Siigo...");

      try {
        const payload = {
          ...buildContextPayload(),
          accion_subir_siigo: checked,
          factura: row
        };
        const data = await fetchJson(WEBHOOK_SUBIR_SIIGO, payload);
        row.siigo_subido = checked;
        setStatus(data?.message || (checked ? "La factura se ha registrado en Siigo." : "Factura marcada para reversión en Siigo."));
      } catch {
        event.target.checked = !checked;
        setStatus("Error enviando estado de factura a Siigo.");
      } finally {
        event.target.disabled = false;
      }
    });

    tr.appendChild(tdSwitch);

    state.generalColumns.forEach((col) => {
      const td = document.createElement("td");
      td.textContent = format(row[col]);
      if (col === "fecha_iso") td.classList.add("fecha-col");
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      state.selectedId = row.__id;
      renderTable();
      updateDetailStatusText();
    });

    body.appendChild(tr);

    if (row.__id === state.selectedId) {
      body.appendChild(createDetailInlineRow(row));
    }
  });

  bindColumnDrag();
  bindInlineDetailDrag();
  renderPagination();
};

const applyFilters = () => {
  const desde = filtroFechaDesde.value;
  const hasta = filtroFechaHasta.value;
  const numero = filtroNumero.value.trim().toLowerCase();
  const proveedor = filtroProveedor.value.trim().toLowerCase();
  const nit = filtroNit.value.trim().toLowerCase();

  state.filteredRows = state.allRows.filter((row) => {
    const fecha = String(row.fecha_iso || "");
    if (desde && fecha < desde) return false;
    if (hasta && fecha > hasta) return false;
    if (numero && !String(row.numero_factura || "").toLowerCase().includes(numero)) return false;
    if (proveedor && !String(row.proveedor || "").toLowerCase().includes(proveedor)) return false;
    if (nit && !String(row.nit || "").toLowerCase().includes(nit)) return false;
    return true;
  });

  if (!state.filteredRows.find((row) => row.__id === state.selectedId)) {
    state.selectedId = state.filteredRows[0]?.__id || null;
  }

  state.currentPage = 1;
  renderTable();
  updateDetailStatusText();
};

const downloadFile = (content, filename, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
};

const buildExportRows = (rows) => rows.map((row) => ({
  numero_factura: row.numero_factura,
  prefijo_factura: row.prefijo_factura,
  consecutivo_factura: row.consecutivo_factura,
  fecha_iso: row.fecha_iso,
  proveedor: row.proveedor,
  nit: row.nit,
  direccion: row.direccion,
  telefono: row.telefono,
  correo_empresa: row.correo_empresa,
  estado: row.estado,
  tipo_factura: row.tipo_factura,
  debitos: row.debitos,
  creditos: row.creditos,
  balance: row.balance,
  total_items: row.total_items,
  siigo_subido: row.siigo_subido ? "true" : "false"
}));

const buildUnifiedRows = (rows) => {
  const invoiceRows = buildExportRows(rows);
  return rows.flatMap((row, index) => {
    const invoiceData = invoiceRows[index];
    const details = getDetailsByInvoice(row);
    if (!details.length) {
      return [{ ...invoiceData }];
    }

    return details.map((item) => ({
      ...invoiceData,
      detalle_producto: item.producto,
      detalle_cantidad: item.cantidad,
      detalle_valor_unitario: item.valor_unitario,
      detalle_subtotal: item.subtotal,
      detalle_porcentaje_impuesto: item.porcentaje_impuesto,
      detalle_codigo_contable: item.codigo_contable,
      detalle_valor_debito: item.valor_debito,
      detalle_valor_credito: item.valor_credito,
      detalle_descripcion: item.descripcion
    }));
  });
};

const exportCsv = (rows) => {
  const mapped = buildUnifiedRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const lines = [headers.join(",")];
  mapped.forEach((row) => {
    lines.push(headers.map((key) => escapeCsv(row[key])).join(","));
  });
  downloadFile(lines.join("\n"), `facturas_siigo_${Date.now()}.csv`, "text/csv;charset=utf-8;");
};

const exportExcelUnified = (rows) => {
  const mapped = buildUnifiedRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const bodyRows = mapped
    .map((row) => `<tr>${headers.map((key) => `<td>${format(row[key])}</td>`).join("")}</tr>`)
    .join("");

  const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  downloadFile(html, `facturas_siigo_unificadas_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const exportExcelSeparated = (rows) => {
  if (!rows.length) return setStatus("No hay facturas para descargar.");

  const generalHeaders = Object.keys(buildExportRows(rows)[0] || {});
  const detailHeaders = state.detailColumns;

  const blocks = rows.map((row, index) => {
    const general = buildExportRows([row])[0];
    const details = getDetailsByInvoice(row);
    const spacerCols = "<td></td><td></td>";

    const generalHeader = `<tr>${spacerCols}${generalHeaders.map((h) => `<th>${h}</th>`).join("")}</tr>`;
    const generalValues = `<tr>${spacerCols}${generalHeaders.map((h) => `<td>${format(general[h])}</td>`).join("")}</tr>`;

    const detailHeader = `<tr>${spacerCols}${detailHeaders.map((h) => `<th>${h}</th>`).join("")}</tr>`;
    const detailRows = details.length
      ? details.map((item) => `<tr>${spacerCols}${detailHeaders.map((h) => `<td>${format(item[h])}</td>`).join("")}</tr>`).join("")
      : `<tr>${spacerCols}<td colspan="${detailHeaders.length}">Sin items.</td></tr>`;

    return `
      <tr>${spacerCols}<td colspan="${Math.max(generalHeaders.length, detailHeaders.length)}"><strong>Factura ${index + 1}: ${format(row.numero_factura)}</strong></td></tr>
      ${generalHeader}
      ${generalValues}
      <tr><td></td><td></td></tr>
      ${detailHeader}
      ${detailRows}
      <tr><td></td><td></td></tr>
      <tr><td></td><td></td></tr>
    `;
  }).join("");

  const html = `<table>${blocks}</table>`;
  downloadFile(html, `facturas_siigo_cuadros_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const handleDownload = () => {
  const mode = modoDescarga?.value || "excel_unificada_filtradas";
  const rows = state.filteredRows;
  if (!rows.length) return setStatus("No hay facturas para descargar con este modo.");

  if (mode === "csv_filtradas") exportCsv(rows);
  else if (mode === "excel_cuadros_filtradas") exportExcelSeparated(rows);
  else exportExcelUnified(rows);

  setStatus(`Descarga generada (${rows.length} factura(s)).`);
};

const loadResponsables = async () => {
  try {
    const data = await fetchJson(WEBHOOK_LISTAR_RESPONSABLES, buildContextPayload());
    const list = Array.isArray(data)
      ? data.flatMap((item) => item?.responsables || [])
      : (data?.responsables || []);

    list.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id ?? item.value ?? item.nombre ?? item.name ?? "";
      option.textContent = item.nombre ?? item.name ?? item.label ?? option.value;
      responsable.appendChild(option);
    });
  } catch {
    setStatus("No se pudieron cargar responsables, continuando...");
  }
};

const loadFacturas = async () => {
  setStatus("Consultando facturas del correo...");
  const data = await fetchWebhookWithFallback(WEBHOOK_CARGAR_FACTURAS_CORREO, buildContextPayload());
  const rows = normalizeRows(data).map((row, idx) => ({
    ...row,
    __id: invoiceId(row, idx),
    siigo_subido: Boolean(row.siigo_subido)
  }));

  state.allRows = rows;
  state.filteredRows = rows;
  state.selectedId = rows[0]?.__id || null;
  state.currentPage = 1;

  renderTable();
  updateDetailStatusText();
  setStatus(rows.length ? `Facturas cargadas: ${rows.length}` : "No hay facturas para mostrar.");
};

const init = async () => {
  if (!WEBHOOK_CARGAR_FACTURAS_CORREO || !WEBHOOK_SUBIR_SIIGO) {
    setStatus("Configuración de webhooks incompleta.");
    return;
  }

  state.context = await getUserContext();
  if (!state.context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  state.detailOrderByInvoice = JSON.parse(localStorage.getItem(DETAILS_ORDER_KEY) || "{}");

  await loadResponsables();

  try {
    await loadFacturas();
  } catch {
    setStatus("Error cargando facturas de correo.");
  }
};

btnAplicarFiltros.addEventListener("click", applyFilters);
btnLimpiarFiltros.addEventListener("click", () => {
  [filtroFechaDesde, filtroFechaHasta, filtroNumero, filtroProveedor, filtroNit].forEach((el) => {
    el.value = "";
  });
  applyFilters();
});
btnDescargarFacturas?.addEventListener("click", handleDownload);

init();

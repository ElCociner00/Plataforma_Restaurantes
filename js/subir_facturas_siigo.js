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

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  selectedId: null,
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

const downloadFile = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
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

const exportCsv = (rows) => {
  const mapped = buildExportRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const lines = [headers.join(",")];
  mapped.forEach((row) => {
    lines.push(headers.map((key) => escapeCsv(row[key])).join(","));
  });
  downloadFile(lines.join("
"), `facturas_siigo_${Date.now()}.csv`, "text/csv;charset=utf-8;");
};

const exportExcel = (rows) => {
  const mapped = buildExportRows(rows);
  if (!mapped.length) return setStatus("No hay facturas para descargar.");
  const headers = Object.keys(mapped[0]);
  const bodyRows = mapped.map((row) => `<tr>${headers.map((key) => `<td>${format(row[key])}</td>`).join("")}</tr>`).join("");
  const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${bodyRows}</tbody></table>`;
  downloadFile(html, `facturas_siigo_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const handleDownload = () => {
  const selected = state.allRows.find((row) => row.__id === state.selectedId);
  const mode = modoDescarga?.value || "excel_filtradas";
  const rows = mode.includes("seleccionada") ? (selected ? [selected] : []) : state.filteredRows;
  if (!rows.length) return setStatus("No hay facturas para descargar con este modo.");
  if (mode.startsWith("csv")) exportCsv(rows);
  else exportExcel(rows);
  setStatus(`Descarga generada (${rows.length} factura(s)).`);
};

const normalizeRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "facturas", "result"];
  for (const key of keys) if (Array.isArray(raw[key])) return raw[key];
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

const fetchJson = async (url, payload) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return res.json();
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

const getDetailsForSelected = () => {
  const selected = state.allRows.find((row) => row.__id === state.selectedId);
  if (!selected) return [];
  const base = baseSortDetails(Array.isArray(selected.items) ? selected.items : []);

  const saved = state.detailOrderByInvoice[selected.__id];
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

const renderDetail = () => {
  const selected = state.allRows.find((row) => row.__id === state.selectedId);
  if (!selected) {
    detalleFactura.textContent = "Selecciona una factura para ver items.";
    return;
  }

  const items = getDetailsForSelected();
  const headCols = ["↕", ...state.detailColumns].map((col) => `<th>${col}</th>`).join("");
  const rows = items.map((item, idx) => {
    const key = String(item.id_unico || `${item.producto}-${idx}`);
    const cols = state.detailColumns.map((col) => `<td>${format(item[col])}</td>`).join("");
    return `<tr draggable="true" data-detail-key="${key}"><td class="drag-col">⋮⋮</td>${cols}</tr>`;
  }).join("");

  detalleFactura.innerHTML = `
    <div class="tabla-wrap">
      <table>
        <thead><tr>${headCols}</tr></thead>
        <tbody id="detalleBodyRows">${rows || `<tr><td colspan="${state.detailColumns.length + 1}">Sin items.</td></tr>`}</tbody>
      </table>
    </div>
  `;

  let dragging = null;
  detalleFactura.querySelectorAll("tr[data-detail-key]").forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      dragging = tr.dataset.detailKey;
      tr.classList.add("dragging");
    });
    tr.addEventListener("dragend", () => tr.classList.remove("dragging"));
    tr.addEventListener("dragover", (event) => event.preventDefault());
    tr.addEventListener("drop", () => {
      const target = tr.dataset.detailKey;
      if (!dragging || !target || dragging === target) return;
      const current = getDetailsForSelected().map((item, idx) => String(item.id_unico || `${item.producto}-${idx}`));
      const from = current.indexOf(dragging);
      const to = current.indexOf(target);
      if (from < 0 || to < 0) return;
      const next = [...current];
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.detailOrderByInvoice[state.selectedId] = next;
      localStorage.setItem(DETAILS_ORDER_KEY, JSON.stringify(state.detailOrderByInvoice));
      renderDetail();
    });
  });
};

const renderTable = () => {
  const headers = ["subir_siigo", ...state.generalColumns];
  head.innerHTML = `<tr>${headers.map((col) => col === "subir_siigo" ? "<th>Siigo</th>" : `<th data-column="${col}">${col}</th>`).join("")}</tr>`;

  body.innerHTML = "";
  state.filteredRows.forEach((row) => {
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
      } catch (error) {
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
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      state.selectedId = row.__id;
      renderTable();
      renderDetail();
    });

    body.appendChild(tr);
  });

  bindColumnDrag();
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

const applyFilters = () => {
  const d = filtroFechaDesde.value;
  const h = filtroFechaHasta.value;
  const num = filtroNumero.value.trim().toLowerCase();
  const prov = filtroProveedor.value.trim().toLowerCase();
  const nit = filtroNit.value.trim().toLowerCase();

  state.filteredRows = state.allRows.filter((row) => {
    const fecha = String(row.fecha_iso || "");
    if (d && fecha < d) return false;
    if (h && fecha > h) return false;
    if (num && !String(row.numero_factura || "").toLowerCase().includes(num)) return false;
    if (prov && !String(row.proveedor || "").toLowerCase().includes(prov)) return false;
    if (nit && !String(row.nit || "").toLowerCase().includes(nit)) return false;
    return true;
  });

  if (!state.filteredRows.find((row) => row.__id === state.selectedId)) {
    state.selectedId = state.filteredRows[0]?.__id || null;
  }

  renderTable();
  renderDetail();
};

const loadResponsables = async () => {
  const data = await fetchJson(WEBHOOK_LISTAR_RESPONSABLES, buildContextPayload());
  const list = Array.isArray(data)
    ? data.flatMap((item) => item?.responsables || [])
    : (data?.responsables || []);
  list.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id ?? item.value ?? item.nombre ?? item.name ?? "";
    opt.textContent = item.nombre ?? item.name ?? item.label ?? opt.value;
    responsable.appendChild(opt);
  });
};

const loadFacturas = async () => {
  setStatus("Consultando facturas del correo...");
  const data = await fetchJson(WEBHOOK_CARGAR_FACTURAS_CORREO, buildContextPayload());
  const rows = normalizeRows(data).map((row, idx) => ({
    ...row,
    __id: invoiceId(row, idx),
    siigo_subido: Boolean(row.siigo_subido)
  }));

  state.allRows = rows;
  state.filteredRows = rows;
  state.selectedId = rows[0]?.__id || null;

  renderTable();
  renderDetail();
  setStatus(rows.length ? `Facturas cargadas: ${rows.length}` : "No hay facturas para mostrar.");
};

const init = async () => {
  state.context = await getUserContext();
  if (!WEBHOOK_CARGAR_FACTURAS_CORREO || !WEBHOOK_SUBIR_SIIGO) {
    setStatus("Configuración de webhooks incompleta.");
    return;
  }
  if (!state.context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  state.detailOrderByInvoice = JSON.parse(localStorage.getItem(DETAILS_ORDER_KEY) || "{}");

  try {
    await loadResponsables();
    await loadFacturas();
  } catch (error) {
    setStatus("Error cargando facturas de correo.");
  }
};

btnAplicarFiltros.addEventListener("click", applyFilters);
btnLimpiarFiltros.addEventListener("click", () => {
  [filtroFechaDesde, filtroFechaHasta, filtroNumero, filtroProveedor, filtroNit].forEach((el) => { el.value = ""; });
  applyFilters();
});

btnDescargarFacturas?.addEventListener("click", handleDownload);

init();

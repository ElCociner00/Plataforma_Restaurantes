import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const head = document.getElementById("historicoHead");
const body = document.getElementById("historicoBody");
const paginacion = document.getElementById("paginacion");
const detalleInventario = document.getElementById("detalleInventario");
const status = document.getElementById("status");

const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroHoraInicio = document.getElementById("filtroHoraInicio");
const filtroHoraFin = document.getElementById("filtroHoraFin");
const filtroProducto = document.getElementById("filtroProducto");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const tipoDescarga = document.getElementById("tipoDescarga");
const btnDescargarDatos = document.getElementById("descargarDatos");

const PAGE_SIZE = 20;
const getTimestamp = () => new Date().toISOString();
const getGeneralVisibilityKey = (tenantId) => `historico_cierre_inventarios_visibilidad_${tenantId || "global"}`;
const getDetailVisibilityKey = (tenantId) => `historico_cierre_inventarios_detalle_visibilidad_${tenantId || "global"}`;
const getDetailProductVisibilityKey = (tenantId) => `historico_cierre_inventarios_productos_visibilidad_${tenantId || "global"}`;
const getDetailColumnsVisibilityKey = (tenantId) => `historico_cierre_inventarios_columnas_detalle_visibilidad_${tenantId || "global"}`;
const getGeneralOrderKey = (tenantId) => `historico_cierre_inventarios_orden_general_${tenantId || "global"}`;
const getDetailOrderKey = (tenantId) => `historico_cierre_inventarios_orden_detalle_${tenantId || "global"}`;

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  visibleGeneralColumns: ["fecha_cierre", "total_productos", "stock_total_inicial", "consumo_total", "stock_total_final"],
  visibleDetailColumns: ["producto_nombre", "stock_inicial", "stock_gastado", "stock_restante", "hora_inicio", "hora_fin"],
  selectedRowIds: new Set(),
  expandedRowId: null,
  currentPage: 1
};

const loadJson = (key, fallback) => {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
};

const setStatus = (message) => { status.textContent = message; };
const formatValue = (value) => value === null || value === undefined || value === "" ? "-" : String(value);

const toDateValue = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const latamMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (latamMatch) {
    const [, d, m, y] = latamMatch;
    return new Date(Number(y), Number(m) - 1, Number(d));
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

const normalizeTime = (value) => String(value || "").trim().slice(0, 5);

const normalizeRows = (raw) => {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "historico", "cierres", "inventarios"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
};

const filteredProducts = (row) => {
  const detailVisibility = loadJson(getDetailVisibilityKey(state.context?.tenant_id), {});
  const productVisibility = loadJson(getDetailProductVisibilityKey(state.context?.tenant_id), {});
  return (Array.isArray(row.productos) ? row.productos : []).filter((item) => {
    const productId = String(item.producto_id || "");
    if (productId && productVisibility[productId] === false) return false;
    const detailKey = `${productId}|${item.hora_inicio || ""}|${item.hora_fin || ""}`;
    return detailVisibility[detailKey] !== false;
  });
};

const renderDetail = () => {
  const row = state.allRows.find((item) => item.id === state.expandedRowId);
  if (!row) {
    detalleInventario.textContent = "Selecciona un cierre para ver productos.";
    return;
  }

  const productos = filteredProducts(row);
  const ths = ["::", ...state.visibleDetailColumns].map((col) => `<th>${col}</th>`).join("");
  const trs = productos.map((item) => {
    const key = `${item.producto_id || ""}|${item.hora_inicio || ""}|${item.hora_fin || ""}`;
    const tds = state.visibleDetailColumns.map((col) => `<td>${formatValue(item[col])}</td>`).join("");
    return `<tr draggable="true" data-detail-key="${key}"><td class="drag-col">::</td>${tds}</tr>`;
  }).join("");

  detalleInventario.innerHTML = `<div class="tabla-wrap"><table><thead><tr>${ths}</tr></thead><tbody id="detalleBodyRows">${trs || `<tr><td colspan="${state.visibleDetailColumns.length + 1}">Sin filas visibles.</td></tr>`}</tbody></table></div>`;
};

const getPagedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const renderPagination = () => {
  paginacion.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
  for (let i = 1; i <= totalPages; i += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(i);
    btn.disabled = i === state.currentPage;
    btn.addEventListener("click", () => {
      state.currentPage = i;
      renderTable();
    });
    paginacion.appendChild(btn);
  }
};

const bindHeaderDrag = () => {
  head.querySelectorAll("th[data-column]").forEach((th) => {
    th.draggable = true;
    th.addEventListener("dragstart", () => th.classList.add("dragging"));
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (event) => event.preventDefault());
    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.dataset.column;
      const target = th.dataset.column;
      if (!source || !target || source === target) return;
      const next = [...state.visibleGeneralColumns];
      const from = next.indexOf(source);
      const to = next.indexOf(target);
      if (from < 0 || to < 0) return;
      next.splice(to, 0, next.splice(from, 1)[0]);
      state.visibleGeneralColumns = next;
      localStorage.setItem(getGeneralOrderKey(state.context?.tenant_id), JSON.stringify(next));
      renderTable();
    });
  });
};

const renderTable = () => {
  const cols = state.visibleGeneralColumns;
  const headCells = ["Sel", ...cols].map((col) => col === "Sel" ? "<th>Sel</th>" : `<th data-column="${col}">${col}</th>`).join("");
  head.innerHTML = `<tr>${headCells}</tr>`;

  const rows = getPagedRows();
  body.innerHTML = "";
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("selected", row.id === state.expandedRowId);

    const tdSelect = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedRowIds.has(row.id);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selectedRowIds.add(row.id);
      else state.selectedRowIds.delete(row.id);
    });
    tdSelect.appendChild(checkbox);
    tr.appendChild(tdSelect);

    cols.forEach((col) => {
      const td = document.createElement("td");
      td.textContent = formatValue(row[col]);
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      state.expandedRowId = row.id;
      renderTable();
      renderDetail();
    });

    body.appendChild(tr);
  });

  bindHeaderDrag();
  renderPagination();
};

const applyFilters = () => {
  const desde = filtroFechaDesde.value;
  const hasta = filtroFechaHasta.value;
  const hi = filtroHoraInicio.value;
  const hf = filtroHoraFin.value;
  const producto = filtroProducto.value.trim().toLowerCase();

  state.filteredRows = state.allRows.filter((row) => {
    const rowDate = toDateValue(row.fecha_cierre);
    if (desde) {
      const from = toDateValue(desde);
      if (!rowDate || (from && rowDate < from)) return false;
    }
    if (hasta) {
      const to = toDateValue(hasta);
      if (!rowDate || (to && rowDate > to)) return false;
    }

    const productos = Array.isArray(row.productos) ? row.productos : [];
    if (hi) {
      const hiNorm = normalizeTime(hi);
      if (!productos.some((p) => {
        const ini = normalizeTime(p.hora_inicio);
        return ini && ini >= hiNorm;
      })) return false;
    }
    if (hf) {
      const hfNorm = normalizeTime(hf);
      if (!productos.some((p) => {
        const fin = normalizeTime(p.hora_fin);
        return fin && fin <= hfNorm;
      })) return false;
    }
    if (producto && !productos.some((p) => String(p.producto_nombre || "").toLowerCase().includes(producto))) return false;

    return true;
  });

  state.currentPage = 1;
  state.expandedRowId = state.filteredRows[0]?.id || null;
  renderTable();
  renderDetail();
};

const buildExportRows = (rows) => rows.flatMap((row) => {
  const productos = filteredProducts(row);
  if (!productos.length) return [{ ...row, producto_nombre: "", stock_inicial: "", stock_gastado: "", stock_restante: "", hora_inicio: "", hora_fin: "" }];
  return productos.map((p) => ({ ...row, ...p }));
});

const downloadFile = (content, filename, mime) => {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
};

const exportCsv = (rows) => {
  const headers = [...state.visibleGeneralColumns, ...state.visibleDetailColumns];
  const lines = [headers.join(",")];
  buildExportRows(rows).forEach((item) => {
    lines.push(headers.map((h) => `"${String(item[h] ?? "").replaceAll('"', '""')}"`).join(","));
  });
  downloadFile(lines.join("\n"), `historico_inventarios_${Date.now()}.csv`, "text/csv;charset=utf-8;");
};


const exportPng = (row) => {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1600;
  const ctx = canvas.getContext("2d");
  if (!ctx) return setStatus("No se pudo generar PNG.");

  ctx.fillStyle = "#eef2ff";
  ctx.fillRect(0, 0, 1080, 1600);
  ctx.fillStyle = "#fff";
  ctx.fillRect(40, 40, 1000, 1520);
  ctx.strokeStyle = "#93c5fd";
  ctx.strokeRect(40, 40, 1000, 1520);

  let y = 100;
  ctx.fillStyle = "#1e3a8a";
  ctx.font = "bold 40px Arial";
  ctx.fillText("HISTORICO CIERRE INVENTARIOS", 70, y);
  y += 50;
  ctx.fillStyle = "#1f2937";
  ctx.font = "24px Arial";
  state.visibleGeneralColumns.forEach((col) => {
    if (y > 1480) return;
    ctx.fillText(`${col}: ${formatValue(row[col])}`, 70, y);
    y += 34;
  });

  const a = document.createElement("a");
  a.download = `inventarios_${row.id || Date.now()}.png`;
  a.href = canvas.toDataURL("image/png");
  a.click();
  setStatus("PNG del turno descargado.");
};

const exportExcel = (rows) => {
  const headers = [...state.visibleGeneralColumns, ...state.visibleDetailColumns];
  const trs = buildExportRows(rows).map((item) => `<tr>${headers.map((h) => `<td>${formatValue(item[h])}</td>`).join("")}</tr>`).join("");
  const html = `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${trs}</tbody></table>`;
  downloadFile(html, `historico_inventarios_${Date.now()}.xls`, "application/vnd.ms-excel;charset=utf-8;");
};

const getRowsByDownloadMode = () => {
  const current = state.allRows.find((row) => row.id === state.expandedRowId);
  const selected = state.allRows.filter((row) => state.selectedRowIds.has(row.id));
  const paged = getPagedRows();
  const mode = tipoDescarga.value;
  if (mode === "abierto_png") return current ? [current] : [];
  if (mode.includes("abierto")) return current ? [current] : [];
  if (mode.includes("marcados")) return selected;
  if (mode.includes("pagina")) return paged;
  return state.filteredRows;
};

const loadData = async () => {
  const context = await getUserContext();
  if (!context) return setStatus("No se pudo validar la sesión.");

  state.context = {
    tenant_id: context.empresa_id,
    empresa_id: context.empresa_id,
    usuario_id: context.user?.id || context.user?.user_id,
    rol: context.rol,
    timestamp: getTimestamp()
  };

  setStatus("Cargando historico de inventarios...");

  try {
    const { data: rowsData, error: rowsError } = await supabase
      .from("inventario_diario_resumen")
      .select("*")
      .eq("empresa_id", state.context.empresa_id)
      .order("fecha_cierre", { ascending: false });

    if (rowsError) throw rowsError;

    const rows = normalizeRows(rowsData).map((item, idx) => ({ id: item.id || item._id || `inv-${idx}`, ...item }));
    state.allRows = rows;

    const savedGeneralOrder = loadJson(getGeneralOrderKey(state.context.tenant_id), null);
    const generalVisibility = loadJson(getGeneralVisibilityKey(state.context.tenant_id), {});
    if (Array.isArray(savedGeneralOrder) && savedGeneralOrder.length) {
      state.visibleGeneralColumns = savedGeneralOrder.filter((col) => generalVisibility[col] !== false);
    } else {
      state.visibleGeneralColumns = state.visibleGeneralColumns.filter((col) => generalVisibility[col] !== false);
    }

    const detailColumns = ["producto_nombre", "stock_inicial", "stock_gastado", "stock_restante", "hora_inicio", "hora_fin"];
    const savedDetailOrder = loadJson(getDetailOrderKey(state.context.tenant_id), null);
    const detailColumnsVisibility = loadJson(getDetailColumnsVisibilityKey(state.context.tenant_id), {});
    const ordered = Array.isArray(savedDetailOrder) && savedDetailOrder.length ? savedDetailOrder : detailColumns;
    state.visibleDetailColumns = ordered.filter((col) => detailColumnsVisibility[col] !== false);

    applyFilters();
    setStatus(rows.length ? "historico cargado." : "No hay datos historicos.");
  } catch (error) {
    setStatus("Error cargando historico de inventarios.");
  }
};

btnAplicarFiltros.addEventListener("click", applyFilters);
btnLimpiarFiltros.addEventListener("click", () => {
  [filtroFechaDesde, filtroFechaHasta, filtroHoraInicio, filtroHoraFin, filtroProducto].forEach((el) => { el.value = ""; });
  applyFilters();
});

btnDescargarDatos.addEventListener("click", () => {
  const rows = getRowsByDownloadMode();
  if (!rows.length) return setStatus("No hay datos para descargar.");
  if (tipoDescarga.value === "abierto_png") exportPng(rows[0]);
  else if (tipoDescarga.value.endsWith("csv")) exportCsv(rows);
  else exportExcel(rows);
  setStatus(`Descarga generada (${rows.length} turno(s)).`);
});

loadData();

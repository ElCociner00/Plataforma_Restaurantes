import { getUserContext } from "./session.js";
import { WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS } from "./webhooks.js";

const head = document.getElementById("historicoHead");
const body = document.getElementById("historicoBody");
const status = document.getElementById("status");
const paginacion = document.getElementById("paginacion");
const loadingOverlay = document.getElementById("loadingOverlay");
const columnasPanel = document.getElementById("columnasPanel");
const detallesPanel = document.getElementById("detallesPanel");
const detalleTurno = document.getElementById("detalleTurno");

const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroHoraInicio = document.getElementById("filtroHoraInicio");
const filtroHoraFin = document.getElementById("filtroHoraFin");
const filtroFila = document.getElementById("filtroFila");
const filtroNombreTurno = document.getElementById("filtroNombreTurno");
const filtroNumeroTurno = document.getElementById("filtroNumeroTurno");
const filtroBusquedaGeneral = document.getElementById("filtroBusquedaGeneral");
const coincidenciasSimilares = document.getElementById("coincidenciasSimilares");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const tipoDescarga = document.getElementById("tipoDescarga");
const btnDescargarDatos = document.getElementById("descargarDatos");

const PAGE_SIZE = 20;
const MAX_LOADING_MS = 5000;
const EXCLUDED_GENERAL_FIELDS = new Set(["registrado_por", "total_variables", "diferencia_caja", "variables_detalle"]);
const EXCLUDED_DETAIL_FIELDS = new Set(["id"]);
const getTimestamp = () => new Date().toISOString();

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  allGeneralColumns: [],
  visibleGeneralColumns: [],
  allDetailColumns: [],
  visibleDetailColumns: [],
  allDetailItemKeys: [],
  visibleDetailItemKeys: [],
  detailOrderByRowId: {},
  currentPage: 1,
  selectedRowIds: new Set(),
  expandedRowId: null
};

let loadingSafetyTimeoutId = null;

const setStatus = (message) => {
  status.textContent = message;
};

const setLoading = (isLoading, message = "") => {
  if (loadingSafetyTimeoutId) {
    clearTimeout(loadingSafetyTimeoutId);
    loadingSafetyTimeoutId = null;
  }

  loadingOverlay?.classList.toggle("is-hidden", !isLoading);

  if (isLoading) {
    loadingSafetyTimeoutId = setTimeout(() => {
      loadingOverlay?.classList.add("is-hidden");
      setStatus("Carga finalizada por límite de 5 segundos.");
      loadingSafetyTimeoutId = null;
    }, MAX_LOADING_MS);
  }

  if (message) setStatus(message);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
};

const getGeneralVisibilityKey = (tenantId) => `historico_cierre_turno_visibilidad_${tenantId || "global"}`;
const getGeneralOrderKey = (tenantId) => `historico_cierre_turno_orden_${tenantId || "global"}`;
const getDetailVisibilityKey = (tenantId) => `historico_cierre_turno_detalle_visibilidad_${tenantId || "global"}`;
const getDetailItemVisibilityKey = (tenantId) => `historico_cierre_turno_detalle_items_visibilidad_${tenantId || "global"}`;

const loadJson = (key, fallback) => {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  try {
    return JSON.parse(stored);
  } catch {
    return fallback;
  }
};

const saveJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

const normalizeRows = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    const keys = ["rows", "data", "items", "historico", "registros", "cierres"];
    for (const key of keys) {
      const nested = raw.flatMap((item) => (Array.isArray(item?.[key]) ? item[key] : []));
      if (nested.length) return nested;
    }
    return raw.filter((item) => item && typeof item === "object");
  }

  if (typeof raw !== "object") return [];
  const keys = ["rows", "data", "items", "historico", "registros", "cierres"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return raw[key];
  }

  return Object.entries(raw)
    .filter(([key]) => key !== "ok" && key !== "message")
    .map(([, value]) => value)
    .filter((item) => item && typeof item === "object");
};

const formatCellValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return new Intl.NumberFormat("es-CO").format(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const toReadableLabel = (value) => String(value || "")
  .replace(/[_-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const normalizeSearchText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .trim();

const calculateSimilarity = (a, b) => {
  const left = normalizeSearchText(a);
  const right = normalizeSearchText(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.95;

  const bigrams = (text) => {
    if (text.length < 2) return [text];
    const out = [];
    for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
    return out;
  };

  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  const map = new Map();
  leftBigrams.forEach((item) => map.set(item, (map.get(item) || 0) + 1));
  let overlap = 0;
  rightBigrams.forEach((item) => {
    const count = map.get(item) || 0;
    if (count > 0) {
      overlap += 1;
      map.set(item, count - 1);
    }
  });

  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
};

const fuzzyMatches = (query, value, threshold = 0.8) => {
  if (!query) return true;
  const score = calculateSimilarity(query, value);
  return score >= threshold;
};

const getDisplayValue = (value) => toReadableLabel(formatCellValue(value));

const getRowId = (row, index) => String(row.turno_nombre || `${row.fecha_turno || "sin_fecha"}-${row.numero_turno || "sin_turno"}-${index}`);

const getDetailItemKey = (detail) => `${String(detail.variable || "")}|${String(detail.categoria || "")}`;

const detailCategoryWeight = (categoria) => {
  const c = String(categoria || "").toLowerCase();
  if (c === "sistema") return 1;
  if (c === "real") return 2;
  return 3;
};

const isGasto = (detail) => String(detail.variable || "").toLowerCase().includes("gasto");

const sortDetailsBase = (details) => [...details].sort((a, b) => {
  const gastoA = isGasto(a);
  const gastoB = isGasto(b);
  if (gastoA !== gastoB) return gastoA ? 1 : -1;

  const varA = String(a.variable || "").toLowerCase();
  const varB = String(b.variable || "").toLowerCase();
  if (varA !== varB) return varA.localeCompare(varB);

  return detailCategoryWeight(a.categoria) - detailCategoryWeight(b.categoria);
});

const sanitizeRow = (rawRow, index) => {
  const general = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    if (!EXCLUDED_GENERAL_FIELDS.has(key)) general[key] = value;
  });

  const detailsRaw = Array.isArray(rawRow?.variables_detalle) ? rawRow.variables_detalle : [];
  const details = sortDetailsBase(detailsRaw.map((item) => {
    const clean = {};
    Object.entries(item || {}).forEach(([key, value]) => {
      if (!EXCLUDED_DETAIL_FIELDS.has(key)) clean[key] = value;
    });
    return clean;
  }));

  return {
    id: getRowId(rawRow, index),
    general,
    details
  };
};

const inferColumns = (rows, picker) => {
  const set = new Set();
  rows.forEach((row) => picker(row).forEach((key) => set.add(key)));
  return Array.from(set);
};

const mergeColumns = (baseColumns, orderColumns) => {
  const available = baseColumns.filter(Boolean);
  const ordered = orderColumns.filter((col) => available.includes(col));
  const missing = available.filter((col) => !ordered.includes(col));
  return [...ordered, ...missing];
};

const getCandidateColumn = (columns, candidates) => {
  const normalized = columns.map((col) => ({
    raw: col,
    val: String(col).toLowerCase().replace(/\s+/g, "_")
  }));

  for (const candidate of candidates) {
    const found = normalized.find((item) => item.val.includes(candidate.toLowerCase()));
    if (found) return found.raw;
  }
  return null;
};

const toDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getPaginatedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const getDetailRowsFor = (row) => {
  const base = row.details.filter((detail) => state.visibleDetailItemKeys.includes(getDetailItemKey(detail)));
  const orderKeys = state.detailOrderByRowId[row.id] || base.map(getDetailItemKey);
  const map = new Map(base.map((detail) => [getDetailItemKey(detail), detail]));
  const ordered = [];

  orderKeys.forEach((key) => {
    if (map.has(key)) ordered.push(map.get(key));
    map.delete(key);
  });

  map.forEach((detail) => ordered.push(detail));
  return ordered;
};

const renderDetailSection = () => {
  const selected = state.allRows.find((row) => row.id === state.expandedRowId);
  if (!selected) {
    detalleTurno.textContent = "Selecciona un turno para ver su detalle.";
    return;
  }

  const generalHtml = state.visibleGeneralColumns
    .map((key) => `<div class="kv"><strong>${toReadableLabel(key)}</strong><span>${formatCellValue(selected.general[key])}</span></div>`)
    .join("");

  const detailRows = getDetailRowsFor(selected);

  const detailHead = ["↕", ...state.visibleDetailColumns].map((col) => `<th>${toReadableLabel(col)}</th>`).join("");
  const detailBody = detailRows.map((detail) => {
    const detailKey = getDetailItemKey(detail);
    const cells = state.visibleDetailColumns.map((col) => `<td>${formatCellValue(detail[col])}</td>`).join("");
    return `<tr draggable="true" data-detail-key="${detailKey}"><td class="drag-col">⋮⋮</td>${cells}</tr>`;
  }).join("");

  detalleTurno.innerHTML = `
    <h3>${formatCellValue(selected.general.turno_nombre || selected.id)}</h3>
    <div class="kv-grid">${generalHtml || "<p>Sin datos generales visibles.</p>"}</div>
    <div class="tabla-wrap detalle-wrap">
      <table>
        <thead><tr>${detailHead}</tr></thead>
        <tbody id="detalleBodyRows">${detailBody || "<tr><td colspan='10'>Sin detalle visible.</td></tr>"}</tbody>
      </table>
    </div>
  `;

  let draggingKey = null;
  detalleTurno.querySelectorAll("tr[data-detail-key]").forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      draggingKey = tr.dataset.detailKey;
      tr.classList.add("dragging");
    });
    tr.addEventListener("dragend", () => {
      tr.classList.remove("dragging");
      draggingKey = null;
    });
    tr.addEventListener("dragover", (event) => event.preventDefault());
    tr.addEventListener("drop", () => {
      const targetKey = tr.dataset.detailKey;
      if (!draggingKey || !targetKey || draggingKey === targetKey) return;
      const current = getDetailRowsFor(selected).map(getDetailItemKey);
      const from = current.indexOf(draggingKey);
      const to = current.indexOf(targetKey);
      if (from < 0 || to < 0) return;
      const next = [...current];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      state.detailOrderByRowId[selected.id] = next;
      renderDetailSection();
    });
  });
};

const moveColumn = (source, target) => {
  const srcIndex = state.visibleGeneralColumns.indexOf(source);
  const targetIndex = state.visibleGeneralColumns.indexOf(target);
  if (srcIndex < 0 || targetIndex < 0 || srcIndex === targetIndex) return;

  const next = [...state.visibleGeneralColumns];
  const [picked] = next.splice(srcIndex, 1);
  next.splice(targetIndex, 0, picked);
  state.visibleGeneralColumns = next;

  saveJson(getGeneralOrderKey(state.context?.tenant_id), next);
  renderTable();
};

const renderHead = () => {
  head.innerHTML = "";
  const tr = document.createElement("tr");
  tr.innerHTML = "<th>#</th><th>✔</th>";

  state.visibleGeneralColumns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = toReadableLabel(column);
    th.dataset.column = column;
    th.draggable = true;
    th.addEventListener("dragstart", () => th.classList.add("dragging"));
    th.addEventListener("dragend", () => th.classList.remove("dragging"));
    th.addEventListener("dragover", (event) => event.preventDefault());
    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.dataset.column;
      if (source) moveColumn(source, column);
    });
    tr.appendChild(th);
  });

  head.appendChild(tr);
};

const renderBody = () => {
  body.innerHTML = "";
  const rows = getPaginatedRows();
  const start = (state.currentPage - 1) * PAGE_SIZE;

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    tr.classList.toggle("selected", row.id === state.expandedRowId);

    const numberCell = document.createElement("td");
    numberCell.textContent = String(start + index + 1);
    tr.appendChild(numberCell);

    const selectCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedRowIds.has(row.id);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      if (checkbox.checked) state.selectedRowIds.add(row.id);
      else state.selectedRowIds.delete(row.id);
    });
    selectCell.appendChild(checkbox);
    tr.appendChild(selectCell);

    state.visibleGeneralColumns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row.general[column]);
      tr.appendChild(td);
    });

    tr.addEventListener("click", () => {
      state.expandedRowId = row.id;
      renderBody();
      renderDetailSection();
    });

    body.appendChild(tr);
  });
};

const renderPagination = () => {
  paginacion.innerHTML = "";
  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const addButton = (label, onClick, disabled = false, active = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled;
    button.classList.toggle("active", active);
    button.addEventListener("click", onClick);
    paginacion.appendChild(button);
  };

  addButton("← Anterior", () => {
    state.currentPage -= 1;
    renderTable();
  }, state.currentPage <= 1);

  for (let page = 1; page <= totalPages; page += 1) {
    addButton(String(page), () => {
      state.currentPage = page;
      renderTable();
    }, false, page === state.currentPage);
  }

  addButton("Siguiente →", () => {
    state.currentPage += 1;
    renderTable();
  }, state.currentPage >= totalPages);
};

const renderSwitches = (container, columns, visibleColumns, onToggle) => {
  container.innerHTML = "";
  columns.forEach((column) => {
    const row = document.createElement("div");
    row.className = "vis-row";
    row.innerHTML = `
      <span>${toReadableLabel(column)}</span>
      <label class="switch">
        <input type="checkbox" ${visibleColumns.includes(column) ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;
    row.querySelector("input")?.addEventListener("change", (event) => onToggle(column, event.target.checked));
    container.appendChild(row);
  });
};

const renderColumnControls = () => {
  const generalSettings = loadJson(getGeneralVisibilityKey(state.context?.tenant_id), {});
  const detailItemSettings = loadJson(getDetailItemVisibilityKey(state.context?.tenant_id), {});

  renderSwitches(columnasPanel, state.allGeneralColumns, state.visibleGeneralColumns, (key, checked) => {
    generalSettings[key] = checked;
    saveJson(getGeneralVisibilityKey(state.context?.tenant_id), generalSettings);
    state.visibleGeneralColumns = state.allGeneralColumns.filter((col) => generalSettings[col] !== false);
    if (!state.visibleGeneralColumns.length) state.visibleGeneralColumns = [...state.allGeneralColumns];
    renderTable();
  });

  renderSwitches(detallesPanel, state.allDetailItemKeys, state.visibleDetailItemKeys, (key, checked) => {
    detailItemSettings[key] = checked;
    saveJson(getDetailItemVisibilityKey(state.context?.tenant_id), detailItemSettings);
    state.visibleDetailItemKeys = state.allDetailItemKeys.filter((itemKey) => detailItemSettings[itemKey] !== false);
    if (!state.visibleDetailItemKeys.length) state.visibleDetailItemKeys = [...state.allDetailItemKeys];
    renderDetailSection();
  });
};

const renderTable = () => {
  renderHead();
  renderBody();
  renderPagination();
  renderColumnControls();
  renderDetailSection();
  setStatus(`Mostrando ${state.filteredRows.length} turno(s). Página ${state.currentPage}.`);
};

const renderSimilarMatches = (rows, query, label) => {
  if (!coincidenciasSimilares) return;
  if (!query || !rows.length) {
    coincidenciasSimilares.innerHTML = "";
    return;
  }

  const items = rows.slice(0, 5).map((row) => {
    const nombre = formatCellValue(row.general.turno_nombre || row.general.nombre_turno || row.id);
    const numero = formatCellValue(row.general.numero_turno || "-");
    return `<li><strong>${nombre}</strong> · Turno ${numero}</li>`;
  }).join("");

  coincidenciasSimilares.innerHTML = `
    <h3>Coincidencias similares para ${label}</h3>
    <ul>${items}</ul>
  `;
};

const applyFilters = () => {
  const fechaDesde = filtroFechaDesde.value;
  const fechaHasta = filtroFechaHasta.value;
  const horaInicio = filtroHoraInicio.value;
  const horaFin = filtroHoraFin.value;
  const filaExacta = Number(filtroFila.value || 0);
  const nombreTurno = filtroNombreTurno?.value?.trim() || "";
  const numeroTurno = filtroNumeroTurno?.value?.trim() || "";
  const busquedaGeneral = filtroBusquedaGeneral?.value?.trim() || "";

  const fechaCol = getCandidateColumn(state.allGeneralColumns, ["fecha", "date"]);
  const horaInicioCol = getCandidateColumn(state.allGeneralColumns, ["hora_inicio", "inicio"]);
  const horaFinCol = getCandidateColumn(state.allGeneralColumns, ["hora_fin", "fin"]);
  const nombreCol = getCandidateColumn(state.allGeneralColumns, ["nombre_turno", "turno_nombre", "nombre"]);
  const numeroCol = getCandidateColumn(state.allGeneralColumns, ["numero_turno", "turno", "numero"]);

  const similarRows = [];

  state.filteredRows = state.allRows.filter((row, index) => {
    const rowNumber = index + 1;
    if (filaExacta > 0 && rowNumber !== filaExacta) return false;

    if (fechaCol && (fechaDesde || fechaHasta)) {
      const rowDate = toDateValue(row.general[fechaCol]);
      if (!rowDate) return false;
      if (fechaDesde) {
        const from = toDateValue(fechaDesde);
        if (from && rowDate < from) return false;
      }
      if (fechaHasta) {
        const to = toDateValue(fechaHasta);
        if (to && rowDate > new Date(to.getTime() + 86399999)) return false;
      }
    }

    if (horaInicio && horaInicioCol) {
      const value = String(row.general[horaInicioCol] ?? "").slice(0, 5);
      if (value !== horaInicio) {
        if (fuzzyMatches(horaInicio, value, 0.6)) similarRows.push(row);
        return false;
      }
    }

    if (horaFin && horaFinCol) {
      const value = String(row.general[horaFinCol] ?? "").slice(0, 5);
      if (value !== horaFin) {
        if (fuzzyMatches(horaFin, value, 0.6)) similarRows.push(row);
        return false;
      }
    }

    if (nombreTurno) {
      const value = getDisplayValue(row.general[nombreCol] || row.general.turno_nombre || row.id);
      if (!fuzzyMatches(nombreTurno, value, 0.8)) return false;
    }

    if (numeroTurno) {
      const value = getDisplayValue(row.general[numeroCol] || row.general.numero_turno || "");
      if (!fuzzyMatches(numeroTurno, value, 0.8)) return false;
    }

    if (busquedaGeneral) {
      const hayMatchGeneral = state.allGeneralColumns.some((col) => {
        const value = getDisplayValue(row.general[col]);
        return fuzzyMatches(busquedaGeneral, value, 0.8);
      });
      if (!hayMatchGeneral) return false;
    }

    return true;
  });

  state.currentPage = 1;
  renderTable();
  renderSimilarMatches(similarRows, horaInicio || horaFin, "horario");
};

const escapeHtml = (value) => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/\"/g, "&quot;")
  .replace(/'/g, "&#039;");

const escapeCsv = (value) => {
  const str = String(value ?? "");
  return /[,"\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const buildRowsForExport = (rows) => rows.map((row) => {
  const details = getDetailRowsFor(row);
  return {
    turno: row,
    details: details.length ? details : [{}]
  };
});

const downloadExcel = (rows, fileName) => {
  if (!rows.length) return setStatus("No hay turnos para descargar con esos criterios.");

  const exports = buildRowsForExport(rows);
  const blocks = exports.map(({ turno, details }, index) => {
    const headers = [...state.visibleGeneralColumns, ...state.visibleDetailColumns];
    const headRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
    const bodyRows = details.map((detail) => {
      const generalCells = state.visibleGeneralColumns.map((col) => `<td>${escapeHtml(formatCellValue(turno.general[col]))}</td>`).join("");
      const detailCells = state.visibleDetailColumns.map((col) => `<td>${escapeHtml(formatCellValue(detail[col]))}</td>`).join("");
      return `<tr>${generalCells}${detailCells}</tr>`;
    }).join("");

    const spacer = index < exports.length - 1
      ? `<tr><td colspan="${headers.length}">&nbsp;</td></tr><tr><td colspan="${headers.length}">&nbsp;</td></tr>`
      : "";

    return `
      <tr><td colspan="${headers.length}"><strong>${escapeHtml(formatCellValue(turno.general.turno_nombre || turno.id))}</strong></td></tr>
      <tr>${headRow}</tr>
      ${bodyRows}
      ${spacer}
    `;
  }).join("");

  const html = `<html><head><meta charset="utf-8"/></head><body><table>${blocks}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

const downloadCsv = (rows, fileName) => {
  if (!rows.length) return setStatus("No hay turnos para descargar con esos criterios.");

  const headers = [...state.visibleGeneralColumns, ...state.visibleDetailColumns];
  const lines = [headers.map(escapeCsv).join(",")];

  buildRowsForExport(rows).forEach(({ turno, details }) => {
    details.forEach((detail) => {
      const general = state.visibleGeneralColumns.map((col) => escapeCsv(formatCellValue(turno.general[col])));
      const detailVals = state.visibleDetailColumns.map((col) => escapeCsv(formatCellValue(detail[col])));
      lines.push([...general, ...detailVals].join(","));
    });
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

const loadInitialData = async () => {
  state.context = await getUserContext();
  if (!state.context) return setStatus("No se pudo validar la sesión.");

  setLoading(true, "Cargando histórico...");
  try {
    const payload = {
      tenant_id: state.context.empresa_id,
      empresa_id: state.context.empresa_id,
      usuario_id: state.context.user?.id || state.context.user?.user_id,
      rol: state.context.rol,
      timestamp: getTimestamp()
    };

    const generalSettings = loadJson(getGeneralVisibilityKey(payload.tenant_id), {});
    const detailSettings = loadJson(getDetailVisibilityKey(payload.tenant_id), {});
    const detailItemSettings = loadJson(getDetailItemVisibilityKey(payload.tenant_id), {});
    const orderSettings = loadJson(getGeneralOrderKey(payload.tenant_id), []);

    const rowsRes = await fetchWithTimeout(WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const rowsData = await rowsRes.json();

    state.allRows = normalizeRows(rowsData).map(sanitizeRow);
    state.filteredRows = [...state.allRows];

    const inferredGeneral = inferColumns(state.allRows, (row) => Object.keys(row.general));
    const inferredDetailColumns = inferColumns(state.allRows, (row) => row.details.flatMap((detail) => Object.keys(detail)));
    const inferredDetailItems = inferColumns(state.allRows, (row) => row.details.map((detail) => getDetailItemKey(detail)));

    state.allGeneralColumns = mergeColumns([...new Set(inferredGeneral)], orderSettings);
    state.allDetailColumns = [...new Set(inferredDetailColumns)];
    state.allDetailItemKeys = [...new Set(inferredDetailItems)];

    state.visibleGeneralColumns = state.allGeneralColumns.filter((col) => generalSettings[col] !== false);
    state.visibleDetailColumns = state.allDetailColumns.filter((col) => detailSettings[col] !== false);
    state.visibleDetailItemKeys = state.allDetailItemKeys.filter((key) => {
      if (key in detailItemSettings) return detailItemSettings[key] !== false;
      const categoria = (key.split("|")[1] || "").toLowerCase();
      return categoria === "real" || categoria === "sistema";
    });

    if (!state.visibleGeneralColumns.length) state.visibleGeneralColumns = [...state.allGeneralColumns];
    if (!state.visibleDetailColumns.length) state.visibleDetailColumns = [...state.allDetailColumns];
    if (!state.visibleDetailItemKeys.length) state.visibleDetailItemKeys = [...state.allDetailItemKeys];

    state.expandedRowId = state.filteredRows[0]?.id || null;
    state.currentPage = 1;

    renderTable();
    setStatus(state.allRows.length ? "Histórico cargado." : "No se recibieron cierres.");
  } catch (error) {
    setStatus(error?.name === "AbortError" ? "La carga tardó más de 5 segundos." : "Error cargando histórico.");
  } finally {
    setLoading(false);
  }
};

btnAplicarFiltros.addEventListener("click", applyFilters);

btnLimpiarFiltros.addEventListener("click", () => {
  filtroFechaDesde.value = "";
  filtroFechaHasta.value = "";
  filtroHoraInicio.value = "";
  filtroHoraFin.value = "";
  filtroFila.value = "";
  if (filtroNombreTurno) filtroNombreTurno.value = "";
  if (filtroNumeroTurno) filtroNumeroTurno.value = "";
  if (filtroBusquedaGeneral) filtroBusquedaGeneral.value = "";
  if (coincidenciasSimilares) coincidenciasSimilares.innerHTML = "";
  state.filteredRows = [...state.allRows];
  state.currentPage = 1;
  renderTable();
});

btnDescargarDatos.addEventListener("click", () => {
  const value = tipoDescarga.value;
  const current = state.allRows.find((row) => row.id === state.expandedRowId);
  const selected = state.allRows.filter((row) => state.selectedRowIds.has(row.id));

  if (value === "turno_seleccionado") return downloadExcel(current ? [current] : [], "turno_seleccionado.xls");
  if (value === "turnos_marcados") return downloadExcel(selected, "turnos_marcados.xls");
  if (value === "turnos_filtrados") return downloadExcel(state.filteredRows, "turnos_filtrados.xls");
  if (value === "turnos_pagina") return downloadExcel(getPaginatedRows(), `turnos_pagina_${state.currentPage}.xls`);
  if (value === "turnos_filtrados_csv") return downloadCsv(state.filteredRows, "turnos_filtrados.csv");

  return setStatus("Selecciona un tipo de descarga válido.");
});

loadInitialData();

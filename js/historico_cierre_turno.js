import { buildRequestHeaders, getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
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
const filtroNumeroTurno = document.getElementById("filtroNumeroTurno");
const coincidenciasSimilares = document.getElementById("coincidenciasSimilares");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const btnDescargarTurnoSeleccionado = document.getElementById("descargarTurnoSeleccionado");
const btnDescargarTurnosSeleccionados = document.getElementById("descargarTurnosSeleccionados");
const btnDescargarTurnosFiltrados = document.getElementById("descargarTurnosFiltrados");
const btnDescargarTodosTurnos = document.getElementById("descargarTodosTurnos");

const PAGE_SIZE = 20;
const MAX_LOADING_MS = 5000;
const EXCLUDED_GENERAL_FIELDS = new Set(["empresa_id", "registrado_por", "responsable_id", "total_variables", "diferencia_caja", "variables_detalle", "created_at", "turno_nombre"]);
const EXCLUDED_DETAIL_FIELDS = new Set(["id"]);
const normalizeFieldKey = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const shouldExcludeGeneralField = (key) => EXCLUDED_GENERAL_FIELDS.has(key) || normalizeFieldKey(key).includes("responsableid");
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
      setStatus("Carga finalizada por limite de 5 segundos.");
      loadingSafetyTimeoutId = null;
    }, MAX_LOADING_MS);
  }

  if (message) setStatus(message);
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

const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => { const controller = new AbortController(); const timeoutId = setTimeout(() => controller.abort(), timeoutMs); try { return await fetch(url, { ...options, signal: controller.signal }); } finally { clearTimeout(timeoutId); } };

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

const normalizeInlineText = (value) => String(value || "")
  .replace(/\r\n/g, " ")
  .replace(/\n/g, " ")
  .replace(/\r/g, " ")
  .replace(/\\r\\n/g, " ")
  .replace(/\\n/g, " ")
  .replace(/\\r/g, " ")
  .replace(/\s+/g, " ")
  .trim();

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

const getGeneralValue = (obj, candidates = []) => {
  for (const key of candidates) {
    if (obj && obj[key] !== undefined && obj[key] !== null && String(obj[key]).trim() !== "") return obj[key];
  }
  return "";
};

const resolveResponsableName = (rawRow = {}) => {
  const direct = getGeneralValue(rawRow, ["responsable", "responsable_nombre", "nombre_responsable", "responsableName"]);
  if (direct) return direct;

  for (const [key, value] of Object.entries(rawRow)) {
    const normalized = normalizeFieldKey(key);
    if (normalized.includes("responsable") && !normalized.includes("id") && String(value || "").trim()) {
      return value;
    }
  }

  return "";
};

const sanitizeRow = (rawRow, index) => {
  const general = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    if (!shouldExcludeGeneralField(key)) general[key] = value;
  });

  general.responsable = resolveResponsableName(rawRow);

  const detailsRaw = Array.isArray(rawRow?.variables_detalle) ? rawRow.variables_detalle : (typeof rawRow?.variables_detalle === "string" ? (() => { try { const parsed = JSON.parse(rawRow.variables_detalle); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })() : []);
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

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

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

const toNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const summarizeDetailByVariable = (row) => {
  const summary = new Map();
  getDetailRowsFor(row).forEach((detail) => {
    const variable = normalizeInlineText(detail.variable || detail.nombre || "variable");
    const categoria = normalizeInlineText(detail.categoria || "").toLowerCase();
    const valor = toNumber(detail.valor);
    if (!variable || valor === null) return;

    if (!summary.has(variable)) {
      summary.set(variable, { variable, sistema: 0, real: 0, otros: 0 });
    }

    const item = summary.get(variable);
    if (categoria === "sistema") item.sistema += valor;
    else if (categoria === "real") item.real += valor;
    else item.otros += valor;
  });

  return Array.from(summary.values())
    .map((item) => ({ ...item, diferencia: item.real - item.sistema }))
    .sort((a, b) => a.variable.localeCompare(b.variable));
};

const renderDetailSection = () => {
  const selected = state.allRows.find((row) => row.id === state.expandedRowId);
  if (!selected) {
    detalleTurno.textContent = "Selecciona un turno para ver su detalle.";
    return;
  }

  const financialKeys = ["domicilios", "propinas", "efectivo_inicial", "ventas_brutas", "bolsa", "caja_final"];
  const hiddenInSummary = new Set(["created_at", "turno_nombre", ...financialKeys]);

  const summaryRows = state.visibleGeneralColumns
    .filter((key) => !hiddenInSummary.has(key))
    .map((key) => `<div class="resumen-kv-item"><span>${toReadableLabel(key)}</span><strong>${escapeHtml(normalizeInlineText(formatCellValue(selected.general[key])))}</strong></div>`)
    .join("");

  const finCells = financialKeys.map((key) => {
    const val = selected.general[key];
    return `<div class="fin-kpi"><span>${toReadableLabel(key)}</span><strong>${escapeHtml(normalizeInlineText(formatCellValue(val)))}</strong></div>`;
  }).join("");

  const groupedDetails = summarizeDetailByVariable(selected);
  const groupedBody = groupedDetails.map((item) => `
    <tr>
      <td>${escapeHtml(toReadableLabel(item.variable))}</td>
      <td class="is-num">${escapeHtml(formatCellValue(item.sistema))}</td>
      <td class="is-num">${escapeHtml(formatCellValue(item.real))}</td>
      <td class="is-num ${item.diferencia < 0 ? "is-negative" : "is-positive"}">${escapeHtml(formatCellValue(item.diferencia))}</td>
    </tr>
  `).join("");

  detalleTurno.innerHTML = `
    <div class="detalle-header-actions">
      <h3>${escapeHtml(normalizeInlineText(formatCellValue(selected.general.turno_nombre || selected.id)))}</h3>
      <button type="button" class="icon-download-btn" id="descargarResumenActual" aria-label="Descargar resumen del turno" title="Descargar resumen PNG">⬇</button>
    </div>

    <div class="resumen-kv-grid">${summaryRows || "<p class='hint'>Sin datos de resumen.</p>"}</div>

    <div class="fin-kpi-grid">${finCells}</div>

    <div class="detalle-card-grid">
      <div class="tabla-wrap detalle-wrap detalle-comparativo-wrap">
        <table>
          <thead>
            <tr><th>Variable</th><th class="is-num">Sistema</th><th class="is-num">Real</th><th class="is-num">Diferencia</th></tr>
          </thead>
          <tbody>
            ${groupedBody || "<tr><td colspan='4'>Sin detalle visible.</td></tr>"}
          </tbody>
        </table>
      </div>
    </div>
  `;

  detalleTurno.querySelector("#descargarResumenActual")?.addEventListener("click", () => downloadTurnoPng(selected));
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
  tr.innerHTML = "<th>#</th><th>OK</th>";

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
      td.textContent = normalizeInlineText(formatCellValue(row.general[column]));
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

  addButton("Anterior", () => {
    state.currentPage -= 1;
    renderTable();
  }, state.currentPage <= 1);

  for (let page = 1; page <= totalPages; page += 1) {
    addButton(String(page), () => {
      state.currentPage = page;
      renderTable();
    }, false, page === state.currentPage);
  }

  addButton("Siguiente", () => {
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
  setStatus(`Mostrando ${state.filteredRows.length} turno(s). Pagina ${state.currentPage}.`);
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
    return `<li><strong>${nombre}</strong> - Turno ${numero}</li>`;
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
  const numeroTurno = filtroNumeroTurno?.value?.trim() || "";

  const fechaCol = getCandidateColumn(state.allGeneralColumns, ["fecha", "date"]);
  const horaInicioCol = getCandidateColumn(state.allGeneralColumns, ["hora_inicio", "inicio"]);
  const horaFinCol = getCandidateColumn(state.allGeneralColumns, ["hora_fin", "fin"]);
  const numeroCol = getCandidateColumn(state.allGeneralColumns, ["numero_turno", "turno", "numero"]);

  const similarRows = [];

  state.filteredRows = state.allRows.filter((row) => {

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
      if (value && value < horaInicio) {
        if (fuzzyMatches(horaInicio, value, 0.6)) similarRows.push(row);
        return false;
      }
    }

    if (horaFin && horaFinCol) {
      const value = String(row.general[horaFinCol] ?? "").slice(0, 5);
      if (value && value > horaFin) {
        if (fuzzyMatches(horaFin, value, 0.6)) similarRows.push(row);
        return false;
      }
    }

    if (numeroTurno) {
      const value = getDisplayValue(row.general[numeroCol] || row.general.numero_turno || "");
      if (!value.toLowerCase().includes(numeroTurno.toLowerCase())) return false;
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


const toNumericValue = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.trim().replace(/\s+/g, "").replace(/\./g, "").replace(/,/g, ".");
    if (!normalized) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const buildDifferenceSummary = (rows) => {
  const summary = new Map();

  rows.forEach((row) => {
    const general = row?.general || {};
    Object.keys(general).forEach((key) => {
      if (!key.endsWith("_sistema")) return;
      const base = key.slice(0, -"_sistema".length);
      const realKey = `${base}_real`;
      if (!(realKey in general)) return;

      const sistemaNum = toNumericValue(general[key]);
      const realNum = toNumericValue(general[realKey]);
      if (sistemaNum === null || realNum === null) return;

      const current = summary.get(base) || { sistema: 0, real: 0 };
      current.sistema += sistemaNum;
      current.real += realNum;
      summary.set(base, current);
    });
  });

  return Array.from(summary.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([base, totals]) => ({
      base,
      sistema: totals.sistema,
      real: totals.real,
      diferencia: totals.real - totals.sistema
    }));
};

const buildDifferenceRowsHtml = (rows, colspan, title) => {
  const summary = buildDifferenceSummary(rows);
  if (!summary.length) return "";

  const rowsHtml = summary
    .map(({ base, sistema, real, diferencia }) => `
      <tr><td colspan="${colspan}"><strong>${escapeHtml(base)}_diferencia:</strong> ${escapeHtml(formatCellValue(diferencia))} <span style="color:#6b7280;">(sistema: ${escapeHtml(formatCellValue(sistema))}, real: ${escapeHtml(formatCellValue(real))})</span></td></tr>
    `)
    .join("");

  return `
    <tr><td colspan="${colspan}"><strong>${escapeHtml(title)}</strong></td></tr>
    ${rowsHtml}
  `;
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
  const headers = [...state.visibleGeneralColumns, ...state.visibleDetailColumns];
  const blocks = exports.map(({ turno, details }, index) => {
    const headRow = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
    const bodyRows = details.map((detail) => {
      const generalCells = state.visibleGeneralColumns.map((col) => `<td>${escapeHtml(formatCellValue(turno.general[col]))}</td>`).join("");
      const detailCells = state.visibleDetailColumns.map((col) => `<td>${escapeHtml(formatCellValue(detail[col]))}</td>`).join("");
      return `<tr>${generalCells}${detailCells}</tr>`;
    }).join("");

    const rowDiffBlock = buildDifferenceRowsHtml([turno], headers.length, "Diferencias del turno");

    const spacer = index < exports.length - 1
      ? `<tr><td colspan="${headers.length}">&nbsp;</td></tr><tr><td colspan="${headers.length}">&nbsp;</td></tr>`
      : "";

    return `
      <tr><td colspan="${headers.length}"><strong>${escapeHtml(formatCellValue(turno.general.turno_nombre || turno.id))}</strong></td></tr>
      <tr>${headRow}</tr>
      ${bodyRows}
      ${rowDiffBlock}
      ${spacer}
    `;
  }).join("");

  const consolidatedDiffBlock = rows.length > 1
    ? buildDifferenceRowsHtml(rows, headers.length, "Diferencias consolidadas (turnos exportados)")
    : "";

  const html = `<html><head><meta charset="utf-8"/></head><body><table>${blocks}${consolidatedDiffBlock}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};


const downloadTurnoPng = (row) => {
  if (!row) return setStatus("Selecciona un turno para descargar en PNG.");

  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  const ctx = canvas.getContext("2d");
  if (!ctx) return setStatus("No se pudo generar PNG del turno.");

  const details = getDetailRowsFor(row);

  ctx.fillStyle = "#f3edff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cardX = 46;
  const cardY = 46;
  const cardW = canvas.width - 92;
  const cardH = canvas.height - 92;

  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#b8a6f8";
  ctx.lineWidth = 4;
  ctx.fillRect(cardX, cardY, cardW, cardH);
  ctx.strokeRect(cardX, cardY, cardW, cardH);

  let y = cardY + 54;
  ctx.fillStyle = "#4c1d95";
  ctx.font = "bold 40px Arial";
  ctx.fillText("RESUMEN CIERRE DE TURNO", cardX + 28, y);

  y += 36;
  ctx.fillStyle = "#6d28d9";
  ctx.font = "24px Arial";
  ctx.fillText(String(row.general?.turno_nombre || row.id || "Turno"), cardX + 28, y);

  y += 30;
  ctx.strokeStyle = "#ddd6fe";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cardX + 24, y);
  ctx.lineTo(cardX + cardW - 24, y);
  ctx.stroke();

  y += 28;
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 22px Arial";
  ctx.fillText("Datos generales", cardX + 28, y);

  y += 16;
  const generalCols = state.visibleGeneralColumns.slice(0, 14);
  ctx.font = "18px Arial";
  generalCols.forEach((col) => {
    if (y > cardY + cardH - 360) return;
    const label = toReadableLabel(col);
    const value = normalizeInlineText(formatCellValue(row.general?.[col]));
    const line = `${label}: ${value}`;
    ctx.fillStyle = "#374151";
    ctx.fillText(line.slice(0, 100), cardX + 30, y);
    y += 30;
  });

  y += 12;
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 22px Arial";
  ctx.fillText("Detalle tabular", cardX + 28, y);

  y += 20;
  const tableX = cardX + 24;
  const tableW = cardW - 48;
  const rowH = 30;
  const cols = ["variable", "categoria", "sistema", "real", "diferencia"];
  const colW = [0.28, 0.18, 0.18, 0.18, 0.18].map((x) => x * tableW);

  ctx.fillStyle = "#ede9fe";
  ctx.fillRect(tableX, y, tableW, rowH);
  ctx.strokeStyle = "#d1d5db";
  ctx.strokeRect(tableX, y, tableW, rowH);

  let x = tableX;
  ctx.fillStyle = "#1f2937";
  ctx.font = "bold 16px Arial";
  cols.forEach((col, i) => {
    const title = toReadableLabel(col).toUpperCase();
    ctx.fillText(title, x + 8, y + 20);
    x += colW[i];
  });

  y += rowH;
  ctx.font = "15px Arial";
  details.slice(0, 24).forEach((detail) => {
    if (y > cardY + cardH - 80) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(tableX, y, tableW, rowH);
    ctx.strokeStyle = "#e5e7eb";
    ctx.strokeRect(tableX, y, tableW, rowH);

    let cx = tableX;
    cols.forEach((col, i) => {
      const raw = normalizeInlineText(formatCellValue(detail[col]));
      const txt = raw.length > 22 ? `${raw.slice(0, 22)}…` : raw;
      ctx.fillStyle = "#111827";
      ctx.fillText(txt, cx + 8, y + 20);
      cx += colW[i];
    });
    y += rowH;
  });

  const link = document.createElement("a");
  link.download = `turno_historico_${row.id || Date.now()}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  setStatus("PNG del turno descargado.");
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

  setLoading(true, "Cargando historico...");
  try {
    const payload = {
      tenant_id: state.context.empresa_id,
      empresa_id: state.context.empresa_id,
      usuario_id: state.context.user?.id || state.context.user?.user_id,
      rol: state.context.rol,
      timestamp: getTimestamp()
    };

    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.access_token) throw new Error("No hay JWT activo para consultar el historico.");

    const generalSettings = loadJson(getGeneralVisibilityKey(payload.tenant_id), {});
    const detailSettings = loadJson(getDetailVisibilityKey(payload.tenant_id), {});
    const detailItemSettings = loadJson(getDetailItemVisibilityKey(payload.tenant_id), {});
    const orderSettings = loadJson(getGeneralOrderKey(payload.tenant_id), []);

    let rowsData = null;
    let sourceLabel = "supabase";

    const query = supabase
      .from("turnos_agrupados")
      .select("*")
      .order("fecha_turno", { ascending: false })
      .order("numero_turno", { ascending: false });

    if (state.context.empresa_id) {
      query.eq("empresa_id", state.context.empresa_id);
    }

    const { data: directRows, error: rowsError } = await query;
    const hasDirectRows = Array.isArray(directRows) && directRows.length > 0;

    if (!rowsError && hasDirectRows) {
      rowsData = directRows;
    } else {
      const headers = await buildRequestHeaders({ includeTenant: true });
      const webhookResponse = await fetchWithTimeout(
        WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(payload)
        }
      );

      if (webhookResponse.ok) {
        rowsData = await webhookResponse.json();
        sourceLabel = "webhook";
      } else if (!rowsError) {
        rowsData = directRows || [];
      } else {
        throw new Error(
          "Fallo Supabase y webhook historico (" + webhookResponse.status + "). " +
          (rowsError.message || rowsError.code || "Sin detalle.")
        );
      }
    }

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
    setStatus(state.allRows.length ? `Historico cargado (${sourceLabel}).` : "No se recibieron cierres.");
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("La carga tardo mas de 5 segundos.");
    } else {
      const message = error?.message || "Error desconocido";
      const isRlsError = /permission|rls|jwt|not authorized|forbidden/i.test(message);
      setStatus((isRlsError ? "Error de permisos/JWT en historico: " : "Error cargando historico: ") + message);
    }
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
  if (filtroNumeroTurno) filtroNumeroTurno.value = "";
  if (coincidenciasSimilares) coincidenciasSimilares.innerHTML = "";
  state.filteredRows = [...state.allRows];
  state.currentPage = 1;
  renderTable();
});

const getCurrentRow = () => state.allRows.find((row) => row.id === state.expandedRowId);
const getSelectedRows = () => state.allRows.filter((row) => state.selectedRowIds.has(row.id));

btnDescargarTurnoSeleccionado?.addEventListener("click", () => {
  const current = getCurrentRow();
  return downloadExcel(current ? [current] : [], "turno_seleccionado.xls");
});

btnDescargarTurnosSeleccionados?.addEventListener("click", () => {
  return downloadExcel(getSelectedRows(), "turnos_seleccionados.xls");
});

btnDescargarTurnosFiltrados?.addEventListener("click", () => {
  return downloadExcel(state.filteredRows, "turnos_filtrados.xls");
});

btnDescargarTodosTurnos?.addEventListener("click", () => {
  return downloadExcel(state.allRows, "turnos_todos.xls");
});

loadInitialData();

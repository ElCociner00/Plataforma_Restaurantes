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

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const tipoDescarga = document.getElementById("tipoDescarga");
const btnDescargarDatos = document.getElementById("descargarDatos");

const PAGE_SIZE = 20;
const MAX_LOADING_MS = 5000;
const EXCLUDED_GENERAL_FIELDS = new Set(["registrado_por", "total_variables", "diferencia_caja", "variables_detalle"]);
const EXCLUDED_DETAIL_FIELDS = new Set(["id"]);
const getTimestamp = () => new Date().toISOString();

let loadingSafetyTimeoutId = null;

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  allGeneralColumns: [],
  visibleGeneralColumns: [],
  allDetailColumns: [],
  visibleDetailColumns: [],
  currentPage: 1,
  selectedRowIds: new Set(),
  expandedRowId: null
};

const setStatus = (message) => {
  status.textContent = message;
};

const setLoading = (isLoading, message = "") => {
  if (loadingSafetyTimeoutId) {
    clearTimeout(loadingSafetyTimeoutId);
    loadingSafetyTimeoutId = null;
  }

  if (loadingOverlay) {
    loadingOverlay.classList.toggle("is-hidden", !isLoading);

    if (isLoading) {
      loadingSafetyTimeoutId = setTimeout(() => {
        loadingOverlay.classList.add("is-hidden");
        setStatus("Carga finalizada por límite de 5 segundos.");
        loadingSafetyTimeoutId = null;
      }, MAX_LOADING_MS);
    }
  }

  if (message) setStatus(message);
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = MAX_LOADING_MS) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
};

const getGeneralVisibilityKey = (tenantId) => `historico_cierre_turno_visibilidad_${tenantId || "global"}`;
const getGeneralOrderKey = (tenantId) => `historico_cierre_turno_orden_${tenantId || "global"}`;
const getDetailVisibilityKey = (tenantId) => `historico_cierre_turno_detalle_visibilidad_${tenantId || "global"}`;

const loadJson = (key, fallback) => {
  const stored = localStorage.getItem(key);
  if (!stored) return fallback;
  try {
    return JSON.parse(stored);
  } catch {
    return fallback;
  }
};

const saveJson = (key, value) => {
  localStorage.setItem(key, JSON.stringify(value));
};

const normalizeRows = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

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
    .map(([, item]) => item)
    .filter((item) => item && typeof item === "object");
};

const formatCellValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return new Intl.NumberFormat("es-CO").format(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const getRowId = (row, index) => String(row.turno_nombre || `${row.fecha_turno || "sin_fecha"}-${row.numero_turno || "sin_turno"}-${index}`);

const sanitizeRow = (rawRow, index) => {
  const general = {};
  Object.entries(rawRow || {}).forEach(([key, value]) => {
    if (!EXCLUDED_GENERAL_FIELDS.has(key)) general[key] = value;
  });

  const detailsRaw = Array.isArray(rawRow?.variables_detalle) ? rawRow.variables_detalle : [];
  const details = detailsRaw.map((item) => {
    const clean = {};
    Object.entries(item || {}).forEach(([key, value]) => {
      if (!EXCLUDED_DETAIL_FIELDS.has(key)) clean[key] = value;
    });
    return clean;
  });

  return {
    id: getRowId(rawRow, index),
    general,
    details,
    raw: rawRow
  };
};

const inferColumns = (rows, pick) => {
  const keys = new Set();
  rows.forEach((row) => {
    pick(row).forEach((key) => keys.add(key));
  });
  return Array.from(keys);
};

const getCandidateColumn = (columns, candidates) => {
  const lower = columns.map((col) => ({
    raw: col,
    normalized: String(col).toLowerCase().replace(/\s+/g, "_")
  }));

  for (const candidate of candidates) {
    const found = lower.find((item) => item.normalized.includes(candidate.toLowerCase()));
    if (found) return found.raw;
  }

  return null;
};

const toDateValue = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const getPaginatedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const renderDetailSection = () => {
  const selected = state.allRows.find((row) => row.id === state.expandedRowId);
  if (!selected) {
    detalleTurno.textContent = "Selecciona un turno para ver su detalle.";
    return;
  }

  const generalHtml = state.visibleGeneralColumns
    .map((key) => `<div class="kv"><strong>${key}</strong><span>${formatCellValue(selected.general[key])}</span></div>`)
    .join("");

  const detailHead = state.visibleDetailColumns.map((col) => `<th>${col}</th>`).join("");
  const detailRows = (selected.details.length ? selected.details : [{}])
    .map((detail) => {
      const cells = state.visibleDetailColumns.map((col) => `<td>${formatCellValue(detail[col])}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  detalleTurno.innerHTML = `
    <h3>${formatCellValue(selected.general.turno_nombre || selected.id)}</h3>
    <div class="kv-grid">${generalHtml || "<p>Sin datos generales visibles.</p>"}</div>
    <div class="tabla-wrap detalle-wrap">
      <table>
        <thead><tr>${detailHead || "<th>Sin campos visibles</th>"}</tr></thead>
        <tbody>${detailRows}</tbody>
      </table>
    </div>
  `;
};

const moveColumn = (source, target) => {
  const srcIndex = state.visibleGeneralColumns.indexOf(source);
  const targetIndex = state.visibleGeneralColumns.indexOf(target);
  if (srcIndex < 0 || targetIndex < 0 || srcIndex === targetIndex) return;

  const next = [...state.visibleGeneralColumns];
  const [picked] = next.splice(srcIndex, 1);
  next.splice(targetIndex, 0, picked);
  state.visibleGeneralColumns = next;

  saveJson(getGeneralOrderKey(state.context?.tenant_id), state.visibleGeneralColumns);
  renderTable();
};

const renderHead = () => {
  head.innerHTML = "";

  const tr = document.createElement("tr");
  tr.innerHTML = "<th>#</th><th>✔</th>";

  state.visibleGeneralColumns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    th.draggable = true;

    th.addEventListener("dragstart", () => {
      th.classList.add("dragging");
    });

    th.addEventListener("dragend", () => {
      th.classList.remove("dragging");
    });

    th.addEventListener("dragover", (event) => event.preventDefault());

    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.textContent;
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

    const selectedCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.selectedRowIds.has(row.id);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      if (checkbox.checked) state.selectedRowIds.add(row.id);
      else state.selectedRowIds.delete(row.id);
    });
    selectedCell.appendChild(checkbox);
    tr.appendChild(selectedCell);

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

  const addButton = (label, action, disabled = false, active = false) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.classList.toggle("active", active);
    btn.addEventListener("click", action);
    paginacion.appendChild(btn);
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

const renderVisibilityPanel = (container, columns, visibleColumns, onToggle) => {
  container.innerHTML = "";

  columns.forEach((column) => {
    const key = String(column);
    const visible = visibleColumns.includes(column);

    const row = document.createElement("div");
    row.className = "vis-row";
    row.innerHTML = `
      <span>${key}</span>
      <label class="switch">
        <input type="checkbox" ${visible ? "checked" : ""}>
        <span class="slider"></span>
      </label>
    `;

    row.querySelector("input")?.addEventListener("change", (event) => {
      onToggle(key, event.target.checked);
    });

    container.appendChild(row);
  });
};

const renderColumnControls = () => {
  const generalSettings = loadJson(getGeneralVisibilityKey(state.context?.tenant_id), {});
  const detailSettings = loadJson(getDetailVisibilityKey(state.context?.tenant_id), {});

  renderVisibilityPanel(columnasPanel, state.allGeneralColumns, state.visibleGeneralColumns, (key, checked) => {
    generalSettings[key] = checked;
    saveJson(getGeneralVisibilityKey(state.context?.tenant_id), generalSettings);
    state.visibleGeneralColumns = state.allGeneralColumns.filter((col) => generalSettings[col] !== false);
    if (!state.visibleGeneralColumns.length) state.visibleGeneralColumns = [...state.allGeneralColumns];
    renderTable();
  });

  renderVisibilityPanel(detallesPanel, state.allDetailColumns, state.visibleDetailColumns, (key, checked) => {
    detailSettings[key] = checked;
    saveJson(getDetailVisibilityKey(state.context?.tenant_id), detailSettings);
    state.visibleDetailColumns = state.allDetailColumns.filter((col) => detailSettings[col] !== false);
    if (!state.visibleDetailColumns.length) state.visibleDetailColumns = [...state.allDetailColumns];
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

const applyFilters = () => {
  const fechaDesde = filtroFechaDesde.value;
  const fechaHasta = filtroFechaHasta.value;
  const horaInicio = filtroHoraInicio.value;
  const horaFin = filtroHoraFin.value;
  const filaExacta = Number(filtroFila.value || 0);

  const fechaCol = getCandidateColumn(state.allGeneralColumns, ["fecha", "date"]);
  const horaInicioCol = getCandidateColumn(state.allGeneralColumns, ["hora_inicio", "inicio"]);
  const horaFinCol = getCandidateColumn(state.allGeneralColumns, ["hora_fin", "fin"]);

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
      const value = String(row.general[horaInicioCol] ?? "");
      if (value && value < horaInicio) return false;
    }

    if (horaFin && horaFinCol) {
      const value = String(row.general[horaFinCol] ?? "");
      if (value && value > horaFin) return false;
    }

    return true;
  });

  state.currentPage = 1;
  renderTable();
};

const escapeCsv = (value) => {
  const str = String(value ?? "");
  if (/[,"\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const buildFlatRowsForExport = (rows) => {
  const general = state.visibleGeneralColumns;
  const detail = state.visibleDetailColumns;
  const headers = [...general, ...detail];

  const data = rows.flatMap((row) => {
    const details = row.details.length ? row.details : [{}];
    return details.map((item) => {
      const result = {};
      general.forEach((col) => { result[col] = row.general[col]; });
      detail.forEach((col) => { result[col] = item[col] ?? ""; });
      return result;
    });
  });

  return { headers, data };
};

const downloadExcel = (rows, fileName) => {
  if (!rows.length) return setStatus("No hay turnos para descargar con esos criterios.");

  const { headers, data } = buildFlatRowsForExport(rows);
  const head = headers.map((h) => `<th>${h}</th>`).join("");
  const bodyRows = data.map((line) => `<tr>${headers.map((h) => `<td>${formatCellValue(line[h])}</td>`).join("")}</tr>`).join("");

  const html = `
    <html><head><meta charset="utf-8"/></head><body>
    <table><thead><tr>${head}</tr></thead><tbody>${bodyRows}</tbody></table>
    </body></html>
  `;

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

  const { headers, data } = buildFlatRowsForExport(rows);
  const csv = [
    headers.map(escapeCsv).join(","),
    ...data.map((line) => headers.map((h) => escapeCsv(line[h])).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
};

const mergeColumns = (baseColumns, orderColumns) => {
  const available = baseColumns.filter(Boolean);
  const ordered = orderColumns.filter((col) => available.includes(col));
  const missing = available.filter((col) => !ordered.includes(col));
  return [...ordered, ...missing];
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
    const inferredDetail = inferColumns(state.allRows, (row) => row.details.flatMap((item) => Object.keys(item)));

    state.allGeneralColumns = mergeColumns([...new Set(inferredGeneral)], orderSettings);
    state.allDetailColumns = [...new Set(inferredDetail)];

    state.visibleGeneralColumns = state.allGeneralColumns.filter((col) => generalSettings[col] !== false);
    state.visibleDetailColumns = state.allDetailColumns.filter((col) => detailSettings[col] !== false);

    if (!state.visibleGeneralColumns.length) state.visibleGeneralColumns = [...state.allGeneralColumns];
    if (!state.visibleDetailColumns.length) state.visibleDetailColumns = [...state.allDetailColumns];

    state.expandedRowId = state.filteredRows[0]?.id || null;
    state.currentPage = 1;

    renderTable();
    setStatus(state.allRows.length ? "Histórico cargado." : "No se recibieron cierres.");
  } catch (error) {
    setStatus(error?.name === "AbortError" ? "La carga tardó más de 5 segundos." : "Error cargando histórico.");
    console.error("Error cargando histórico de cierre de turno:", error);
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

import { getUserContext } from "./session.js";
import {
  WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS,
  WEBHOOK_HISTORICO_CIERRE_TURNO_COLUMNAS
} from "./webhooks.js";

const head = document.getElementById("historicoHead");
const body = document.getElementById("historicoBody");
const status = document.getElementById("status");
const paginacion = document.getElementById("paginacion");
const loadingOverlay = document.getElementById("loadingOverlay");

const filtroFechaDesde = document.getElementById("filtroFechaDesde");
const filtroFechaHasta = document.getElementById("filtroFechaHasta");
const filtroHoraInicio = document.getElementById("filtroHoraInicio");
const filtroHoraFin = document.getElementById("filtroHoraFin");
const filtroFila = document.getElementById("filtroFila");

const btnAplicarFiltros = document.getElementById("aplicarFiltros");
const btnLimpiarFiltros = document.getElementById("limpiarFiltros");
const btnDescargarPagina = document.getElementById("descargarPagina");
const btnDescargarFiltrado = document.getElementById("descargarFiltrado");
const btnDescargarFila = document.getElementById("descargarFila");

const PAGE_SIZE = 20;
const MAX_LOADING_MS = 5000;

let loadingSafetyTimeoutId = null;

const state = {
  context: null,
  allRows: [],
  filteredRows: [],
  allColumns: [],
  visibleColumns: [],
  currentPage: 1
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

const getVisibilityKey = (tenantId) => `historico_cierre_turno_visibilidad_${tenantId || "global"}`;
const getOrderKey = (tenantId) => `historico_cierre_turno_orden_${tenantId || "global"}`;

const loadVisibilitySettings = (tenantId) => {
  const stored = localStorage.getItem(getVisibilityKey(tenantId));
  if (!stored) return {};
  try {
    return JSON.parse(stored);
  } catch (error) {
    return {};
  }
};

const loadOrderSettings = (tenantId) => {
  const stored = localStorage.getItem(getOrderKey(tenantId));
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
};

const saveOrderSettings = (tenantId, columns) => {
  localStorage.setItem(getOrderKey(tenantId), JSON.stringify(columns));
};

const normalizeRows = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];

    const keys = ["rows", "data", "items", "historico", "registros", "cierres"];
    for (const key of keys) {
      const nested = raw.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        if (Array.isArray(item[key])) return item[key];
        return [];
      });
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

const normalizeColumns = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (!raw.length) return [];
    if (typeof raw[0] === "string") return raw;

    const picked = raw
      .map((item) => item?.columna || item?.column || item?.name || item?.campo)
      .filter(Boolean);

    if (picked.length) return picked;
    if (raw[0] && typeof raw[0] === "object") return Object.keys(raw[0]);
    return [];
  }

  if (typeof raw !== "object") return [];

  const keys = ["columnas", "columns", "campos", "items"];
  for (const key of keys) {
    if (Array.isArray(raw[key])) return normalizeColumns(raw[key]);
  }

  return Object.keys(raw).filter((key) => key !== "ok" && key !== "message");
};

const inferColumnsFromRows = (rows) => {
  const set = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => set.add(key));
  });
  return Array.from(set);
};

const formatCellValue = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const getCandidateColumn = (columns, candidates) => {
  const lower = columns.map((col) => ({
    raw: col,
    normalized: String(col).toLowerCase().replace(/\s+/g, "_")
  }));

  for (const candidate of candidates) {
    const target = candidate.toLowerCase();
    const found = lower.find((item) => item.normalized.includes(target));
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

const applyFilters = () => {
  const fechaDesde = filtroFechaDesde.value;
  const fechaHasta = filtroFechaHasta.value;
  const horaInicio = filtroHoraInicio.value;
  const horaFin = filtroHoraFin.value;
  const filaExacta = Number(filtroFila.value || 0);

  const fechaCol = getCandidateColumn(state.allColumns, ["fecha", "date"]);
  const horaInicioCol = getCandidateColumn(state.allColumns, ["hora_inicio", "inicio"]);
  const horaFinCol = getCandidateColumn(state.allColumns, ["hora_fin", "fin"]);

  state.filteredRows = state.allRows.filter((row, index) => {
    const rowNumber = index + 1;

    if (filaExacta > 0 && rowNumber !== filaExacta) return false;

    if (fechaCol && (fechaDesde || fechaHasta)) {
      const rowDate = toDateValue(row[fechaCol]);
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
      const value = String(row[horaInicioCol] ?? "");
      if (value && value < horaInicio) return false;
    }

    if (horaFin && horaFinCol) {
      const value = String(row[horaFinCol] ?? "");
      if (value && value > horaFin) return false;
    }

    return true;
  });

  state.currentPage = 1;
  renderTable();
};

const moveColumn = (source, target) => {
  const srcIndex = state.visibleColumns.indexOf(source);
  const targetIndex = state.visibleColumns.indexOf(target);
  if (srcIndex < 0 || targetIndex < 0 || srcIndex === targetIndex) return;

  const next = [...state.visibleColumns];
  const [picked] = next.splice(srcIndex, 1);
  next.splice(targetIndex, 0, picked);
  state.visibleColumns = next;

  saveOrderSettings(state.context?.tenant_id, state.visibleColumns);
  renderTable();
};

const renderHead = () => {
  head.innerHTML = "";

  const tr = document.createElement("tr");
  const rowNumberHeader = document.createElement("th");
  rowNumberHeader.textContent = "#";
  tr.appendChild(rowNumberHeader);

  state.visibleColumns.forEach((column) => {
    const th = document.createElement("th");
    th.textContent = column;
    th.draggable = true;

    th.addEventListener("dragstart", () => {
      th.classList.add("dragging");
      th.dataset.dragColumn = column;
    });

    th.addEventListener("dragend", () => {
      th.classList.remove("dragging");
      th.dataset.dragColumn = "";
    });

    th.addEventListener("dragover", (event) => {
      event.preventDefault();
    });

    th.addEventListener("drop", () => {
      const source = head.querySelector("th.dragging")?.textContent;
      if (!source) return;
      moveColumn(source, column);
    });

    tr.appendChild(th);
  });

  head.appendChild(tr);
};

const getPaginatedRows = () => {
  const start = (state.currentPage - 1) * PAGE_SIZE;
  return state.filteredRows.slice(start, start + PAGE_SIZE);
};

const renderBody = () => {
  body.innerHTML = "";
  const rows = getPaginatedRows();
  const start = (state.currentPage - 1) * PAGE_SIZE;

  rows.forEach((row, index) => {
    const tr = document.createElement("tr");

    const numberCell = document.createElement("td");
    numberCell.textContent = String(start + index + 1);
    tr.appendChild(numberCell);

    state.visibleColumns.forEach((column) => {
      const td = document.createElement("td");
      td.textContent = formatCellValue(row[column]);
      tr.appendChild(td);
    });

    body.appendChild(tr);
  });
};

const renderPagination = () => {
  paginacion.innerHTML = "";

  const totalPages = Math.max(1, Math.ceil(state.filteredRows.length / PAGE_SIZE));
  if (state.currentPage > totalPages) state.currentPage = totalPages;

  const prev = document.createElement("button");
  prev.type = "button";
  prev.textContent = "← Anterior";
  prev.disabled = state.currentPage <= 1;
  prev.addEventListener("click", () => {
    state.currentPage -= 1;
    renderTable();
  });
  paginacion.appendChild(prev);

  for (let page = 1; page <= totalPages; page += 1) {
    const pageBtn = document.createElement("button");
    pageBtn.type = "button";
    pageBtn.textContent = String(page);
    pageBtn.classList.toggle("active", page === state.currentPage);
    pageBtn.addEventListener("click", () => {
      state.currentPage = page;
      renderTable();
    });
    paginacion.appendChild(pageBtn);
  }

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "Siguiente →";
  next.disabled = state.currentPage >= totalPages;
  next.addEventListener("click", () => {
    state.currentPage += 1;
    renderTable();
  });
  paginacion.appendChild(next);
};

const renderTable = () => {
  renderHead();
  renderBody();
  renderPagination();
  setStatus(`Mostrando ${state.filteredRows.length} fila(s). Página ${state.currentPage}.`);
};

const buildExcelBlob = (rows) => {
  const headers = ["#", ...state.visibleColumns];
  const lines = [headers.join("\t")];

  rows.forEach((row, idx) => {
    const rowNumber = String(idx + 1);
    const values = state.visibleColumns.map((col) => {
      const value = formatCellValue(row[col]).replace(/\t|\n/g, " ");
      return value;
    });
    lines.push([rowNumber, ...values].join("\t"));
  });

  return new Blob([`\uFEFF${lines.join("\n")}`], {
    type: "application/vnd.ms-excel;charset=utf-8;"
  });
};

const downloadRows = (rows, fileName) => {
  if (!rows.length) {
    setStatus("No hay filas para descargar con esos criterios.");
    return;
  }

  const blob = buildExcelBlob(rows);
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
  if (!state.context) {
    setStatus("No se pudo validar la sesión.");
    return;
  }

  setLoading(true, "Cargando configuración de columnas...");

  try {
    const payload = {
      tenant_id: state.context.empresa_id,
      empresa_id: state.context.empresa_id,
      usuario_id: state.context.user?.id || state.context.user?.user_id,
      rol: state.context.rol
    };

    const visibilitySettings = loadVisibilitySettings(payload.tenant_id);
    const orderSettings = loadOrderSettings(payload.tenant_id);

    setStatus("Consultando columnas dinámicas...");
    const columnsRes = await fetchWithTimeout(WEBHOOK_HISTORICO_CIERRE_TURNO_COLUMNAS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const columnsData = await columnsRes.json();

    setStatus("Consultando datos históricos...");
    const rowsRes = await fetchWithTimeout(WEBHOOK_HISTORICO_CIERRE_TURNO_DATOS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const rowsData = await rowsRes.json();

    const webhookColumns = normalizeColumns(columnsData);
    const rows = normalizeRows(rowsData);
    const inferredColumns = inferColumnsFromRows(rows);

    state.allRows = rows;
    state.allColumns = mergeColumns([...new Set([...webhookColumns, ...inferredColumns])], orderSettings);
    state.visibleColumns = state.allColumns.filter((column) => visibilitySettings[column] !== false);

    if (!state.visibleColumns.length) {
      state.visibleColumns = [...state.allColumns];
    }

    state.filteredRows = [...state.allRows];
    state.currentPage = 1;

    renderTable();
    setStatus(state.allRows.length ? "Histórico cargado." : "No se recibieron filas históricas.");
  } catch (error) {
    setStatus(error?.name === "AbortError"
      ? "La carga tardó más de 5 segundos."
      : "Error cargando histórico.");
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

btnDescargarPagina.addEventListener("click", () => {
  downloadRows(getPaginatedRows(), `historico_cierre_turno_pagina_${state.currentPage}.xls`);
});

btnDescargarFiltrado.addEventListener("click", () => {
  downloadRows(state.filteredRows, "historico_cierre_turno_filtrado.xls");
});

btnDescargarFila.addEventListener("click", () => {
  const rowNumber = Number(filtroFila.value || 0);
  if (!rowNumber || rowNumber < 1 || rowNumber > state.allRows.length) {
    setStatus("Ingresa un número de fila válido para descargar.");
    return;
  }

  const row = state.allRows[rowNumber - 1];
  downloadRows([row], `historico_cierre_turno_fila_${rowNumber}.xls`);
});

loadInitialData();

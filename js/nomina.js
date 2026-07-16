/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/nomina.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `fmtMoney` (línea aprox. 36): Bloque funcional del módulo.
 * - `setStatus` (línea aprox. 42): Asigna/actualiza estado.
 * - `setDefaultDates` (línea aprox. 46): Asigna/actualiza estado.
 * - `renderEmpleadoOptions` (línea aprox. 55): Renderiza/actualiza UI.
 * - `renderResumen` (línea aprox. 66): Renderiza/actualiza UI.
 * - `renderMovimientos` (línea aprox. 82): Renderiza/actualiza UI.
 * - `renderComprobanteHeader` (línea aprox. 113): Renderiza/actualiza UI.
 * - `consultarNomina` (línea aprox. 130): Gestiona información financiera o de pagos.
 * - `descargarComprobante` (línea aprox. 166): Bloque funcional del módulo.
 * - `drawTable` (línea aprox. 221): Bloque funcional del módulo.
 * - `init` (línea aprox. 269): Inicializa/configura comportamiento.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { buildRequestHeaders, getUserContext } from "./session.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { getActiveEnvironment } from "./environment.js";
import { supabase } from "./supabase.js";
import { WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO, WEBHOOK_NOMINA_HISTORICO_GUARDAR } from "./webhooks.js";
import { drawPngBrandWatermark } from "./png_branding.js";
import { nominaLog, nominaWarn } from "./nomina.debug.js";

const fechaInicioInput = document.getElementById("nominaFechaInicio");
const fechaFinInput = document.getElementById("nominaFechaFin");
const corteSelect = document.getElementById("nominaCorte");
const empleadoSelect = document.getElementById("nominaEmpleado");
const consultarBtn = document.getElementById("consultarNomina");
const descargarBtn = document.getElementById("descargarComprobanteNomina");
const descargarExcelEmpleadoBtn = document.getElementById("descargarExcelEmpleadoNomina");

const totalDevengadoEl = document.getElementById("nominaTotalDevengado");
const totalDeduccionesEl = document.getElementById("nominaTotalDeducciones");
const totalNetoEl = document.getElementById("nominaTotalNeto");
const statusEl = document.getElementById("nominaStatus");

const empresaNombreEl = document.getElementById("nominaEmpresaNombre");
const empresaNitEl = document.getElementById("nominaEmpresaNit");
const empleadoDataEl = document.getElementById("nominaEmpleadoData");
const horasBody = document.getElementById("nominaHorasBody");
const totalHorasTablaEl = document.getElementById("nominaTotalHorasTabla");
const ingresosBody = document.getElementById("nominaIngresosBody");
const deduccionesBody = document.getElementById("nominaDeduccionesBody");
const totalIngresosTablaEl = document.getElementById("nominaTotalIngresosTabla");
const totalDeduccionesTablaEl = document.getElementById("nominaTotalDeduccionesTabla");
const netoPagarEl = document.getElementById("nominaNetoPagarComprobante");
const parametrosBody = document.getElementById("nominaParametrosBody");
const detalleCalculoBody = document.getElementById("nominaDetalleCalculoBody");
const parametrosTiempoBody = document.getElementById("nominaParametrosTiempoBody");
const parametrosCalculoBody = document.getElementById("nominaParametrosCalculoBody");
const detallesCalculosBody = document.getElementById("nominaDetallesCalculosBody");
const auxiliaresPanel = document.getElementById("nominaAuxiliaresPanel");
const apoyosBody = document.getElementById("nominaApoyosBody");

const state = {
  context: null,
  responsables: [],
  empresa: null,
  movimientos: [],
  empleadoDetalle: null,
  periodoDetalle: null,
  horasDetalle: null,
  parametrosDetalle: [],
  detalleCalculo: [],
  apoyosDetalle: [],
  excelTotales: null,
  parametrosTiempo: [
    { key: "diurnas", momento: "Diurnas", inicio: "06:00", fin: "18:00" },
    { key: "nocturnas", momento: "Nocturnas", inicio: "18:00", fin: "24:00" }
  ],
  parametrosCalculo: {},
  ingresosAuxiliares: [],
  deduccionesAuxiliares: [],
  payrollOverrides: {
    diurnas: { source: "diurnas", multiplier: 1 },
    nocturnas: { source: "nocturnas", multiplier: 1 },
    dominicales_diurnas: { source: "dominicales_diurnas", multiplier: 1 },
    dominicales_nocturnas: { source: "dominicales_nocturnas", multiplier: 1 }
  }
};


const toNumeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null || value === undefined) return 0;
  let text = String(value).trim();
  if (!text) return 0;
  text = text.replace(/\$/g, "").replace(/\s+/g, "");
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) {
    // 1.234.567,89 -> 1234567.89 | 1,234,567.89 -> 1234567.89
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    text = text.replace(/\./g, "").replace(/,/g, ".");
  }
  const parsed = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
};


const PAYROLL_HOUR_FIELDS = [
  ["diurnas", "Horas diurnas"],
  ["nocturnas", "Horas nocturnas"],
  ["dominicales_diurnas", "Dominicales diurnas"],
  ["dominicales_nocturnas", "Dominicales nocturnas"]
];

const getPayrollOverride = (key) => {
  const current = state.payrollOverrides?.[key] || {};
  const source = PAYROLL_HOUR_FIELDS.some(([field]) => field === current.source) ? current.source : key;
  const multiplier = Number.isFinite(Number(current.multiplier)) ? Number(current.multiplier) : 1;
  return { source, multiplier };
};

const applyPayrollHourOverride = (key, horas) => {
  const override = getPayrollOverride(key);
  return toNumeric(horas?.[override.source]) * override.multiplier;
};

const hasMeaningfulCell = (value) => {
  if (value === null || value === undefined) return false;
  const text = String(value).trim();
  if (!text || ["-", "null", "undefined", "empty"].includes(text.toLowerCase())) return false;
  if (/^0+(?:[.,]0+)?$/.test(text) || /^00:00$/.test(text)) return false;
  return true;
};

const filterEmptyColumns = (headers, rows, protectedIndexes = []) => {
  const keep = headers.map((_header, index) => protectedIndexes.includes(index) || rows.some((row) => hasMeaningfulCell(row[index])));
  return {
    headers: headers.filter((_header, index) => keep[index]),
    rows: rows.map((row) => row.filter((_cell, index) => keep[index]))
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const fmtMoney = (value) => Number(value || 0).toLocaleString("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});
const fmtHours = (value) => Number(value || 0).toFixed(2);

const parseHoursToDecimal = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const match = text.match(/^(\d+):(\d{1,2})$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return (Number.isFinite(hours) ? hours : 0) + ((Number.isFinite(minutes) ? minutes : 0) / 60);
  }
  return toNumeric(text);
};

const minutesToHourText = (minutes) => {
  const safeMinutes = Math.max(0, Math.round(toNumeric(minutes)));
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};

const hoursToMinutes = (value) => {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d+):(\d{1,2})$/);
  if (match) return (Number(match[1]) * 60) + Number(match[2]);
  return Math.round(toNumeric(value) * 60);
};

const normalizeConcept = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();


const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

const buildTimeOptions = () => {
  const items = [];
  for (let minutes = 0; minutes <= 24 * 60; minutes += 5) {
    const value = minutes === 24 * 60 ? "24:00" : minutesToHourText(minutes);
    const hour24 = minutes === 24 * 60 ? 24 : Math.floor(minutes / 60);
    const mm = String(minutes % 60).padStart(2, "0");
    const suffix = hour24 >= 12 && hour24 < 24 ? "pm" : "am";
    const hour12 = hour24 === 0 || hour24 === 24 ? 12 : (hour24 > 12 ? hour24 - 12 : hour24);
    items.push(`<option value="${value}">${hour12}:${mm} ${suffix}</option>`);
  }
  return items.join("");
};

const dateToDayName = (value) => {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-CO", { weekday: "long" }).format(date);
};

const isWeekendPayrollDay = (dayName) => ["sábado", "sabado", "domingo"].includes(normalizeConcept(dayName));

const getTimeParam = (key, fallback) => state.parametrosTiempo.find((item) => item.key === key) || fallback;

const overlapMinutes = (startA, endA, startB, endB) => {
  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  return Math.max(0, end - start);
};

const calculateWorkedMinutesInRange = (workStart, workEnd, rangeStart, rangeEnd) => {
  const ranges = rangeEnd <= rangeStart ? [[rangeStart, 1440], [0, rangeEnd]] : [[rangeStart, rangeEnd]];
  return ranges.reduce((acc, [start, end]) => acc + overlapMinutes(workStart, workEnd, start, end), 0);
};

const calculateDetalleTimes = (row) => {
  const workStart = hoursToMinutes(row.hora_inicio_valida || row.hora_inicio);
  let workEnd = hoursToMinutes(row.hora_fin_valida || row.hora_fin);
  if (workEnd < workStart) workEnd += 1440;
  const dayName = row.dia || dateToDayName(row.fecha);
  const diurna = getTimeParam("diurnas", { inicio: "06:00", fin: "18:00" });
  const nocturna = getTimeParam("nocturnas", { inicio: "18:00", fin: "24:00" });
  const diurnaMinutes = calculateWorkedMinutesInRange(workStart, workEnd, hoursToMinutes(diurna.inicio), hoursToMinutes(diurna.fin));
  const nocturnaMinutes = calculateWorkedMinutesInRange(workStart, workEnd, hoursToMinutes(nocturna.inicio), hoursToMinutes(nocturna.fin));
  const weekend = isWeekendPayrollDay(dayName);
  return {
    dia: dayName,
    horas_diurnas: weekend ? "00:00" : minutesToHourText(diurnaMinutes),
    horas_nocturnas: weekend ? "00:00" : minutesToHourText(nocturnaMinutes),
    horas_dominicales_diurnas: weekend ? minutesToHourText(diurnaMinutes) : "00:00",
    horas_dominicales_nocturnas: weekend ? minutesToHourText(nocturnaMinutes) : "00:00"
  };
};


const PAYROLL_DETAIL_FIELDS = [
  ["horas_diurnas", "Diurnas"],
  ["horas_nocturnas", "Nocturnas"],
  ["horas_dominicales_diurnas", "Dom. diurnas"],
  ["horas_dominicales_nocturnas", "Dom. nocturnas"]
];

const getValidShiftTime = (row, field) => {
  const value = row?.[field];
  if (value !== null && value !== undefined && String(value).trim() !== "") return value;
  return field === "hora_fin_valida" ? (row?.hora_fin || "") : (row?.hora_inicio || "");
};

const buildDuplicateKey = (row) => [row?.fecha, row?.hora_inicio, row?.hora_fin, row?.responsable || row?.responsable_id || empleadoSelect?.value || ""].map((value) => String(value || "").trim()).join("|");

const markDuplicateDetailRows = () => {
  const counts = new Map();
  (state.detalleCalculo || []).forEach((row) => {
    const key = buildDuplicateKey(row);
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  (state.detalleCalculo || []).forEach((row) => {
    const duplicate = counts.get(buildDuplicateKey(row)) > 1;
    row.duplicado = duplicate;
    if (duplicate && row.incluidoTransporte === undefined) row.incluidoTransporte = false;
    if (!duplicate && row.incluidoTransporte === undefined) row.incluidoTransporte = true;
  });
};

const defaultParametroCalculo = (concepto) => {
  const normalized = normalizeConcept(concepto);
  if (normalized.includes("auxilio") && normalized.includes("transporte")) return "dia";
  if (normalized.includes("dominical") && normalized.includes("hora nocturna")) return "horas_dominicales_nocturnas";
  if (normalized.includes("dominical") && normalized.includes("hora diurna")) return "horas_dominicales_diurnas";
  if (normalized.includes("hora nocturna")) return "horas_nocturnas";
  if (normalized.includes("hora diurna")) return "horas_diurnas";
  return "horas_diurnas";
};

const ensureParametroCalculo = () => {
  (state.parametrosDetalle || []).forEach((param, index) => {
    const key = param.row_id || `${param.concepto || param.nombre || "param"}-${index}`;
    param.row_id = key;
    if (!state.parametrosCalculo[key]) state.parametrosCalculo[key] = defaultParametroCalculo(param.concepto || param.nombre);
  });
};

const calculateAuxilioQuantity = (match, days) => {
  const safeDays = Math.max(0, days);
  if (match === "semana") return safeDays / 7;
  if (match === "mes") return safeDays / 30;
  if (match === "trimestre") return safeDays / 90;
  if (match === "semestre") return safeDays / 180;
  return safeDays;
};

const toDateSortValue = (value) => {
  const date = new Date(`${value || ""}T12:00:00`);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
};

const sortByDateDesc = (rows, field = "fecha") => [...(rows || [])].sort((a, b) => toDateSortValue(b?.[field]) - toDateSortValue(a?.[field]));

const findParamValue = (parametros, matcher) => {
  const found = (parametros || []).find((param) => matcher(normalizeConcept(param?.concepto || param?.nombre)));
  return toNumeric(found?.valor);
};

const resolveResponsableName = (id, fallback = "-") => {
  const safeId = String(id || "").trim();
  if (!safeId) return fallback;
  const found = state.responsables.find((item) => String(item.id || "") === safeId);
  return found?.nombre_completo || fallback || safeId;
};

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
  nominaLog("status", message || "");
};

const parseWebhookResponseSafe = async (response) => {
  try {
    const rawText = await response.text();
    nominaLog("webhook.rawText.head", (rawText || "").slice(0, 220));
    if (!rawText || !rawText.trim()) return null;

    const parseRecursively = (value, depth = 0) => {
      if (depth > 8) return value;
      if (typeof value !== "string") return value;
      const t = value.trim();
      if (!t) return null;
      try {
        return parseRecursively(JSON.parse(t), depth + 1);
      } catch (_e) {
        // intento extra: extraer JSON embebido entre texto
        const first = t.indexOf("[");
        const last = t.lastIndexOf("]");
        const firstObj = t.indexOf("{");
        const lastObj = t.lastIndexOf("}");
        const candidate = (first >= 0 && last > first) ? t.slice(first, last + 1) : ((firstObj >=0 && lastObj > firstObj) ? t.slice(firstObj, lastObj + 1) : null);
        if (candidate) {
          try { return parseRecursively(JSON.parse(candidate), depth + 1); } catch (_e2) {}
        }
        return value;
      }
    };

    const parsed = parseRecursively(rawText);
    nominaLog("webhook.parsed.type", Array.isArray(parsed) ? `array(${parsed.length})` : typeof parsed);
    return parsed;
  } catch (_error) {
    nominaWarn("webhook.parse.error", _error?.message || _error);
    return null;
  }
};

const deepExtractPayrollArray = (node, depth = 0, maxDepth = 12) => {
  if (depth > maxDepth || node === null || node === undefined) return null;
  if (typeof node === "string") {
    try {
      const parsed = JSON.parse(node);
      return deepExtractPayrollArray(parsed, depth + 1, maxDepth);
    } catch (_e) {
      return null;
    }
  }
  if (Array.isArray(node)) {
    if (node.length && node.some((item) => item && typeof item === "object" && (item.horas_dinero || item.horas_valor))) {
      return node;
    }
    for (const item of node) {
      const found = deepExtractPayrollArray(item, depth + 1, maxDepth);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) {
      const found = deepExtractPayrollArray(value, depth + 1, maxDepth);
      if (found) return found;
    }
  }
  return null;
};

const deepExtractPayrollObject = (node, depth = 0, maxDepth = 12, visited = new WeakSet()) => {
  if (depth > maxDepth || node === null || node === undefined) return null;
  if (typeof node === "string") {
    try {
      const parsed = JSON.parse(node);
      return deepExtractPayrollObject(parsed, depth + 1, maxDepth, visited);
    } catch (_e) {
      return null;
    }
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = deepExtractPayrollObject(item, depth + 1, maxDepth, visited);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === "object") {
    if (visited.has(node)) return null;
    visited.add(node);
    if (node.horas_dinero || node.horas_valor || node.extras) return node;
    for (const value of Object.values(node)) {
      const found = deepExtractPayrollObject(value, depth + 1, maxDepth, visited);
      if (found) return found;
    }
  }
  return null;
};

const normalizeJsonLikeValue = (value, maxDepth = 8) => {
  let current = value;
  for (let depth = 0; depth < maxDepth && typeof current === "string"; depth += 1) {
    const text = current.trim();
    if (!text) return null;
    try {
      current = JSON.parse(text);
    } catch (_error) {
      return value;
    }
  }
  return current;
};

const extractPayrollArrayCandidates = (value, maxDepth = 8) => {
  const visited = new WeakSet();
  const queue = [{ node: value, depth: 0 }];

  while (queue.length) {
    const { node, depth } = queue.shift();
    if (depth > maxDepth || node === null || node === undefined) continue;

    if (Array.isArray(node) && node.length && node.some((item) => item && typeof item === "object" && item.horas_dinero)) {
      return node;
    }

    if (typeof node === "string") {
      const parsed = normalizeJsonLikeValue(node, maxDepth - depth);
      if (parsed !== node) queue.push({ node: parsed, depth: depth + 1 });
      continue;
    }

    if (typeof node === "object") {
      if (visited.has(node)) continue;
      visited.add(node);
      Object.values(node).forEach((child) => queue.push({ node: child, depth: depth + 1 }));
    }
  }

  return null;
};
const setDefaultDates = () => {
  if (corteSelect) corteSelect.value = "quincenal";
  updateDatesByCut();
};

const toIsoDate = (value) => new Date(value.getTime() - (value.getTimezoneOffset() * 60000)).toISOString().slice(0, 10);

const CUT_BACK_DAYS = {
  semanal: 6,
  quincenal: 14,
  mensual: 29,
  trimestral: 89,
  semestral: 181,
  anual: 364
};

const getTodayStart = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
};

function updateDatesByCut() {
  const today = getTodayStart();
  const cut = corteSelect?.value || "quincenal";
  const backDays = CUT_BACK_DAYS[cut] ?? CUT_BACK_DAYS.quincenal;
  const start = new Date(today);
  start.setDate(today.getDate() - backDays);

  const todayIso = toIsoDate(today);
  fechaFinInput.max = todayIso;
  fechaInicioInput.max = todayIso;
  fechaFinInput.value = todayIso;
  fechaInicioInput.value = toIsoDate(start);
}

function clampDatesToToday() {
  const todayIso = toIsoDate(getTodayStart());
  if (fechaFinInput.value > todayIso) fechaFinInput.value = todayIso;
  if (fechaInicioInput.value > fechaFinInput.value) fechaInicioInput.value = fechaFinInput.value;
}

const renderEmpleadoOptions = () => {
  if (!empleadoSelect) return;
  empleadoSelect.innerHTML = '<option value="">Selecciona un empleado</option>';
  state.responsables.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.nombre_completo;
    empleadoSelect.appendChild(option);
  });
};

const renderResumen = () => {
  const ingresos = state.movimientos
    .filter((item) => String(item.naturaleza || "").toLowerCase().includes("devengo"))
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);
  const deducciones = state.movimientos
    .filter((item) => String(item.naturaleza || "").toLowerCase().includes("dedu"))
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  totalDevengadoEl.textContent = fmtMoney(ingresos);
  totalDeduccionesEl.textContent = fmtMoney(deducciones);
  totalNetoEl.textContent = fmtMoney(ingresos - deducciones);
  totalIngresosTablaEl.textContent = fmtMoney(ingresos);
  totalDeduccionesTablaEl.textContent = fmtMoney(deducciones);
  netoPagarEl.textContent = fmtMoney(ingresos - deducciones);
};

const renderMovimientos = () => {
  const horas = state.horasDetalle || {};
  const horasRows = [
    ["Diurnas", horas.diurnas],
    ["Nocturnas", horas.nocturnas],
    ["Dominicales diurnas", horas.dominicales_diurnas],
    ["Dominicales nocturnas", horas.dominicales_nocturnas]
  ];
  if (horasBody) {
    horasBody.innerHTML = horasRows.map(([label, value]) => `<tr><td>${label}</td><td>${fmtHours(value)}</td></tr>`).join("");
  }
  if (totalHorasTablaEl) totalHorasTablaEl.textContent = fmtHours(horas.total || 0);

  if (!state.movimientos.length) {
    ingresosBody.innerHTML = "<tr><td>Sin ingresos</td><td>0</td><td>$0</td></tr>";
    deduccionesBody.innerHTML = "<tr><td>Sin deducciones</td><td>0</td><td>$0</td></tr>";
    renderResumen();
    renderParametrosYDetalle();
    renderApoyos();
    return;
  }

  const ingresos = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("devengo"));
  const deducciones = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("dedu"));

  ingresosBody.innerHTML = (ingresos.length ? ingresos : [{ tipo: "Sin ingresos", valor: 0, cantidad: 0, unidad: "" }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>${fmtHours(item.cantidad ?? 0)} ${item.unidad || ""}</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");
  deduccionesBody.innerHTML = (deducciones.length ? deducciones : [{ tipo: "Sin deducciones", valor: 0, cantidad: 0, unidad: "" }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>${fmtHours(item.cantidad ?? 0)} ${item.unidad || ""}</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");

  renderResumen();
  renderParametrosYDetalle();
  renderApoyos();
};


const parseExcelWebhookPayload = (value, depth = 0) => {
  if (depth > 10 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;
    try { return parseExcelWebhookPayload(JSON.parse(text), depth + 1); } catch (_e) { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseExcelWebhookPayload(item, depth + 1);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value === "object") {
    if (Array.isArray(value.parametros) || Array.isArray(value.detalle) || Array.isArray(value.apoyos) || value.resumen || value.totales) return value;
    for (const child of Object.values(value)) {
      const parsed = parseExcelWebhookPayload(child, depth + 1);
      if (parsed) return parsed;
    }
  }
  return null;
};

const buildExcelWebhookPayload = (empleadoId) => ({
  empresa_id: state.context?.empresa_id || "",
  tenant_id: state.context?.empresa_id || "",
  responsable_id: empleadoId,
  empleado_id: empleadoId,
  usuario_id: empleadoId,
  corte: corteSelect?.value || "quincenal",
  fecha_inicio: fechaInicioInput.value || "",
  fecha_fin: fechaFinInput.value || "",
  entorno: getActiveEnvironment() || "global"
});


const calculateMoneyByDetail = () => {
  ensureParametroCalculo();
  const rowsIncluidas = sortByDateDesc((state.detalleCalculo || []).filter((row) => row.incluido !== false), "fecha");
  const parametros = state.parametrosDetalle || [];
  const transporteRows = (state.detalleCalculo || []).filter((row) => row.incluido !== false && row.incluidoTransporte !== false);
  const uniqueDays = new Set(transporteRows.map((row) => String(row.fecha || "").trim()).filter(Boolean));
  const diasTrabajados = uniqueDays.size || transporteRows.length;

  const detailRows = rowsIncluidas.map((row) => {
    const calculatedTimes = calculateDetalleTimes(row);
    const base = { ...row, ...calculatedTimes };
    const values = { horas_diurnas: 0, horas_nocturnas: 0, horas_dominicales_diurnas: 0, horas_dominicales_nocturnas: 0, total: 0 };
    parametros.forEach((param) => {
      const match = state.parametrosCalculo[param.row_id] || defaultParametroCalculo(param.concepto || param.nombre);
      const unitValue = toNumeric(param.valor);
      const normalized = normalizeConcept(param.concepto || param.nombre);
      if (normalized.includes("auxilio") && normalized.includes("transporte")) return;
      if (!Object.prototype.hasOwnProperty.call(values, match)) return;
      values[match] += parseHoursToDecimal(base[match]) * unitValue;
    });
    values.total = values.horas_diurnas + values.horas_nocturnas + values.horas_dominicales_diurnas + values.horas_dominicales_nocturnas;
    return { ...base, calculos: values };
  });

  const totals = detailRows.reduce((acc, row) => {
    acc.horas_diurnas += parseHoursToDecimal(row.horas_diurnas);
    acc.horas_nocturnas += parseHoursToDecimal(row.horas_nocturnas);
    acc.horas_dominicales_diurnas += parseHoursToDecimal(row.horas_dominicales_diurnas);
    acc.horas_dominicales_nocturnas += parseHoursToDecimal(row.horas_dominicales_nocturnas);
    acc.valor_diurnas += row.calculos.horas_diurnas;
    acc.valor_nocturnas += row.calculos.horas_nocturnas;
    acc.valor_dominical_diurnas += row.calculos.horas_dominicales_diurnas;
    acc.valor_dominical_nocturnas += row.calculos.horas_dominicales_nocturnas;
    return acc;
  }, { horas_diurnas: 0, horas_nocturnas: 0, horas_dominicales_diurnas: 0, horas_dominicales_nocturnas: 0, valor_diurnas: 0, valor_nocturnas: 0, valor_dominical_diurnas: 0, valor_dominical_nocturnas: 0 });

  const auxParam = parametros.find((param) => {
    const normalized = normalizeConcept(param.concepto || param.nombre);
    return normalized.includes("auxilio") && normalized.includes("transporte");
  });
  const auxMatch = auxParam ? (state.parametrosCalculo[auxParam.row_id] || "dia") : "dia";
  const transporteCantidad = calculateAuxilioQuantity(auxMatch, diasTrabajados);
  const transporteCalculado = auxParam ? toNumeric(auxParam.valor) * transporteCantidad : toNumeric(state.excelTotales?.transporte);

  return { rows: detailRows, totals, diasTrabajados, transporteCantidad, transporteCalculado, auxMatch };
};

const buildPayrollRowsFromEditableDetail = () => {
  const calculation = calculateMoneyByDetail();
  const apoyosIncluidos = (state.apoyosDetalle || []).filter((row) => row.incluido !== false);
  const totalPropinasDetalle = (state.detalleCalculo || []).filter((row) => row.incluido !== false && !row.es_apoyo).reduce((acc, row) => acc + toNumeric(row.propina), 0);
  const totalApoyoPropinas = apoyosIncluidos.reduce((acc, row) => acc + toNumeric(row.propina), 0);

  state.horasDetalle = {
    diurnas: calculation.totals.horas_diurnas,
    nocturnas: calculation.totals.horas_nocturnas,
    dominicales_diurnas: calculation.totals.horas_dominicales_diurnas,
    dominicales_nocturnas: calculation.totals.horas_dominicales_nocturnas,
    total: calculation.totals.horas_diurnas + calculation.totals.horas_nocturnas + calculation.totals.horas_dominicales_diurnas + calculation.totals.horas_dominicales_nocturnas
  };

  return [
    { tipo: "Horas diurnas", naturaleza: "Devengo", valor: calculation.totals.valor_diurnas, cantidad: calculation.totals.horas_diurnas, unidad: "h", fuente: "web" },
    { tipo: "Horas nocturnas", naturaleza: "Devengo", valor: calculation.totals.valor_nocturnas, cantidad: calculation.totals.horas_nocturnas, unidad: "h", fuente: "web" },
    { tipo: "Dominicales diurnas", naturaleza: "Devengo", valor: calculation.totals.valor_dominical_diurnas, cantidad: calculation.totals.horas_dominicales_diurnas, unidad: "h", fuente: "web" },
    { tipo: "Dominicales nocturnas", naturaleza: "Devengo", valor: calculation.totals.valor_dominical_nocturnas, cantidad: calculation.totals.horas_dominicales_nocturnas, unidad: "h", fuente: "web" },
    { tipo: "Propinas", naturaleza: "Devengo", valor: totalPropinasDetalle + totalApoyoPropinas, cantidad: (state.detalleCalculo || []).filter((row) => row.incluido !== false && !row.es_apoyo && toNumeric(row.propina) > 0).length + apoyosIncluidos.filter((row) => toNumeric(row.propina) > 0).length, unidad: "registro(s)", fuente: "web" },
    { tipo: "Auxilio de transporte", naturaleza: "Devengo", valor: calculation.transporteCalculado, cantidad: calculation.transporteCantidad, unidad: calculation.auxMatch, fuente: "web" },
    ...state.ingresosAuxiliares.map((item) => ({ ...item, valor: toNumeric(item.valor) * (toNumeric(item.cantidad) || 1), naturaleza: "Devengo", fuente: "auxiliar" })),
    ...state.deduccionesAuxiliares.map((item) => ({ ...item, valor: toNumeric(item.valor) * (toNumeric(item.cantidad) || 1), naturaleza: "Deducción", fuente: "auxiliar" }))
  ];
};

const recalculatePayrollFromEditableDetail = () => {
  state.movimientos = buildPayrollRowsFromEditableDetail().map((item) => ({
    ...item,
    empleado_nombre: state.empleadoDetalle?.nombre || "Empleado",
    estado: "Liquidable"
  }));
  renderMovimientos();
};

const normalizeExcelPayrollForUi = (data, empleadoSeleccionado = null) => {
  const parametros = Array.isArray(data?.parametros) ? data.parametros : [];
  const detalle = Array.isArray(data?.detalle) ? data.detalle : [];
  const totales = data?.totales && typeof data.totales === "object" ? data.totales : {};
  const apoyos = Array.isArray(data?.apoyos) ? data.apoyos : [];

  state.parametrosDetalle = parametros.map((param, index) => ({
    ...param,
    row_id: param.row_id || `${param.concepto || param.nombre || "param"}-${index}`,
    valor: toNumeric(param.valor)
  }));
  state.parametrosCalculo = {};
  state.excelTotales = totales;
  state.apoyosDetalle = sortByDateDesc(apoyos, "fecha_turno").map((row, index) => ({
    ...row,
    row_id: row.row_id || `${row.fecha_turno || "apoyo"}-${row.hora_inicio || "inicio"}-${row.hora_fin || "fin"}-${index}`,
    incluido: row.incluido !== false,
    tiempo_minutos: toNumeric(row.tiempo_minutos) || hoursToMinutes(row.tiempo_horas),
    propina: toNumeric(row.propina)
  }));
  const detalleNormal = detalle.map((row, index) => ({
    ...row,
    row_id: row.row_id || `${row.fecha || "fila"}-${row.hora_inicio || "inicio"}-${row.hora_fin || "fin"}-${index}`,
    incluido: row.incluido !== false,
    incluidoTransporte: row.incluidoTransporte,
    dia: row.dia || dateToDayName(row.fecha),
    propina: toNumeric(row.propina ?? row.propinas),
    hora_inicio_valida: row.hora_inicio_valida || row.hora_inicio || "",
    hora_fin_valida: row.hora_fin_valida || row.hora_fin || "",
    horas_dominicales_diurnas: row.horas_dominicales_diurnas ?? row.horas_dom_diurnas ?? "00:00",
    horas_dominicales_nocturnas: row.horas_dominicales_nocturnas ?? row.horas_dom_nocturnas ?? "00:00"
  }));
  const detalleApoyos = state.apoyosDetalle.map((row, index) => ({
    row_id: `apoyo-${row.row_id || index}`,
    fecha: row.fecha_turno,
    dia: dateToDayName(row.fecha_turno),
    hora_inicio: row.hora_inicio || "",
    hora_fin: row.hora_fin || "",
    hora_inicio_valida: row.hora_inicio || "",
    hora_fin_valida: row.hora_fin || "",
    propina: toNumeric(row.propina),
    incluido: row.incluido !== false,
    incluidoTransporte: row.incluido !== false,
    es_apoyo: true
  }));
  state.detalleCalculo = sortByDateDesc([...detalleNormal, ...detalleApoyos], "fecha");
  markDuplicateDetailRows();
  ensureParametroCalculo();

  state.empleadoDetalle = { nombre: empleadoSeleccionado?.nombre_completo || data?.empleado?.nombre || "-", cargo: empleadoSeleccionado?.rol || data?.empleado?.cargo || "-" };
  state.periodoDetalle = { inicio: data?.periodo?.inicio || fechaInicioInput.value, fin: data?.periodo?.fin || fechaFinInput.value };
  return buildPayrollRowsFromEditableDetail();
};

const getPayrollTarifas = () => {
  const parametros = state.parametrosDetalle || [];
  return {
    diurnas: findParamValue(parametros, (concepto) => concepto.includes("hora diurna") && !concepto.includes("dominical")),
    nocturnas: findParamValue(parametros, (concepto) => concepto.includes("hora nocturna") && !concepto.includes("dominical")),
    dominicales_diurnas: findParamValue(parametros, (concepto) => concepto.includes("dominical") && concepto.includes("hora diurna")),
    dominicales_nocturnas: findParamValue(parametros, (concepto) => concepto.includes("dominical") && concepto.includes("hora nocturna"))
  };
};

const calculateDetalleRowValue = (row) => {
  const tarifas = getPayrollTarifas();
  const calculated =
    (parseHoursToDecimal(row.horas_diurnas) * tarifas.diurnas) +
    (parseHoursToDecimal(row.horas_nocturnas) * tarifas.nocturnas) +
    (parseHoursToDecimal(row.horas_dominicales_diurnas) * tarifas.dominicales_diurnas) +
    (parseHoursToDecimal(row.horas_dominicales_nocturnas) * tarifas.dominicales_nocturnas);
  const fallback = toNumeric(row.valor_diurnas) + toNumeric(row.valor_nocturnas) + toNumeric(row.valor_dominical_diurnas) + toNumeric(row.valor_dominical_nocturnas);
  return calculated > 0 ? calculated : fallback;
};


const renderApoyos = () => {
  if (!apoyosBody) return;
  apoyosBody.innerHTML = (state.apoyosDetalle.length ? state.apoyosDetalle : [{ fecha_turno: "-", responsable_turno_id: "", apoyo_responsable_id: "", tiempo_minutos: 0, hora_inicio: "-", hora_fin: "-", propina: 0 }])
    .map((row, index) => {
      const disabled = state.apoyosDetalle.length ? "" : "disabled";
      const apoyoNombre = resolveResponsableName(row.apoyo_responsable_id, state.empleadoDetalle?.nombre || "-");
      const responsableNombre = resolveResponsableName(row.responsable_turno_id, "-");
      return `<tr data-apoyo-index="${index}" class="${row.incluido === false ? "nomina-row-descartada" : ""}">
        <td><input type="checkbox" class="nomina-apoyo-validar" ${row.incluido !== false ? "checked" : ""} ${disabled} aria-label="Validar apoyo ${row.fecha_turno || index + 1}"></td>
        <td>${row.fecha_turno || "-"}</td>
        <td>${responsableNombre}</td>
        <td>${apoyoNombre}</td>
        <td><input class="nomina-apoyo-tiempo" value="${minutesToHourText(row.tiempo_minutos)}" ${disabled}></td>
        <td>${row.hora_inicio || "-"}</td>
        <td>${row.hora_fin || "-"}</td>
        <td><input class="nomina-apoyo-propina" type="number" min="0" step="0.01" value="${toNumeric(row.propina)}" ${disabled}></td>
      </tr>`;
    }).join("");
};


const renderAuxiliaresPanel = () => {
  if (!auxiliaresPanel) return;
  const renderRows = (rows, type) => rows.length ? rows.map((row, index) => `
    <tr data-aux-type="${type}" data-aux-index="${index}">
      <td><input class="nomina-aux-concepto" placeholder="Concepto" value="${escapeHtml(row.tipo || "")}"></td>
      <td><input class="nomina-aux-cantidad" type="number" step="0.01" value="${toNumeric(row.cantidad ?? 1)}"></td>
      <td><input class="nomina-aux-unidad" placeholder="Unidad" value="${escapeHtml(row.unidad || "")}"></td>
      <td><input class="nomina-aux-valor" type="number" step="0.01" value="${toNumeric(row.valor)}"></td>
      <td><button type="button" class="nomina-remove-aux">Eliminar</button></td>
    </tr>`).join("") : '<tr><td colspan="5" class="nomina-aux-empty">Sin auxiliares. Usa el botón para añadir una fila editable.</td></tr>';
  auxiliaresPanel.innerHTML = `
    <div class="nomina-aux-grid">
      <div><h3>Ingresos auxiliares</h3><p>No se guardan; afectan el comprobante actual.</p><table><thead><tr><th>Concepto</th><th>Cantidad</th><th>Unidad</th><th>Valor</th><th></th></tr></thead><tbody>${renderRows(state.ingresosAuxiliares, "ingreso")}</tbody></table><button type="button" data-add-aux="ingreso">Añadir ingreso auxiliar</button></div>
      <div><h3>Deducciones auxiliares</h3><p>No se guardan; descuentan del neto actual.</p><table><thead><tr><th>Concepto</th><th>Cantidad</th><th>Unidad</th><th>Valor</th><th></th></tr></thead><tbody>${renderRows(state.deduccionesAuxiliares, "deduccion")}</tbody></table><button type="button" data-add-aux="deduccion">Añadir deducción auxiliar</button></div>
    </div>`;
};

const renderParametrosYDetalle = () => {
  ensureParametroCalculo();
  renderAuxiliaresPanel();
  const timeOptions = buildTimeOptions();
  if (parametrosBody) {
    parametrosBody.innerHTML = (state.parametrosDetalle.length ? state.parametrosDetalle : [{ concepto: "Sin parámetros", valor: 0, unidad: "-", row_id: "empty" }])
      .map((param, index) => {
        const isAux = param.auxiliar === true;
        return `<tr data-param-index="${index}" class="${isAux ? "nomina-parametro-auxiliar" : ""}">
          <td><input class="nomina-param-concepto" value="${escapeHtml(param.concepto || param.nombre || "-")}" ${isAux ? "" : "readonly"}></td>
          <td><input class="nomina-param-valor" type="number" step="0.01" value="${toNumeric(param.valor)}"></td>
          <td><input class="nomina-param-unidad" value="${escapeHtml(param.unidad || (normalizeConcept(param.concepto).includes("dia") ? "día" : "hora"))}"></td>
          <td>${isAux ? '<button type="button" class="nomina-remove-param">Eliminar</button>' : '-'}</td>
        </tr>${isAux ? '<tr class="nomina-parametro-aviso"><td colspan="4">los parámetros auxiliares no se guardan y la próxima vez que quieras usarlo tendrás que añadirlo manualmente denuevo</td></tr>' : ''}`;
      }).join("");
  }
  if (parametrosTiempoBody) {
    parametrosTiempoBody.innerHTML = state.parametrosTiempo.map((row, index) => `<tr data-time-index="${index}"><td>${row.momento}</td><td><select class="nomina-time-start">${timeOptions}</select></td><td><select class="nomina-time-end">${timeOptions}</select></td></tr>`).join("");
    parametrosTiempoBody.querySelectorAll("tr[data-time-index]").forEach((tr) => {
      const row = state.parametrosTiempo[Number(tr.dataset.timeIndex)];
      tr.querySelector(".nomina-time-start").value = row.inicio;
      tr.querySelector(".nomina-time-end").value = row.fin;
    });
  }
  if (detalleCalculoBody) {
    detalleCalculoBody.innerHTML = (state.detalleCalculo.length ? state.detalleCalculo : [{ fecha: "-", hora_inicio: "-", hora_fin: "-" }])
      .map((row, index) => {
        const calculated = calculateDetalleTimes(row);
        const disabled = state.detalleCalculo.length ? "" : "disabled";
        const rowClasses = [row.incluido === false ? "nomina-row-descartada" : "", row.duplicado ? (row.incluidoTransporte === false ? "nomina-row-duplicada" : "nomina-row-validada") : "", row.es_apoyo ? "nomina-row-apoyo" : ""].filter(Boolean).join(" ");
        return `<tr data-detail-index="${index}" class="${rowClasses}">
          <td><input type="checkbox" class="nomina-detalle-validar" ${row.incluidoTransporte !== false ? "checked" : ""} ${disabled} aria-label="Validar transporte ${row.fecha || index + 1}"></td>
          <td>${row.fecha || "-"}</td><td>${calculated.dia}</td><td>${row.hora_inicio || "-"} - ${row.hora_fin || "-"}${row.es_apoyo ? "<br><small>Apoyo</small>" : ""}</td><td>${fmtMoney(row.propina || 0)}</td>
          <td>${calculated.horas_diurnas}</td><td>${calculated.horas_nocturnas}</td><td>${calculated.horas_dominicales_diurnas}</td><td>${calculated.horas_dominicales_nocturnas}</td>
          <td><input class="nomina-detalle-hora-valida" data-field="hora_inicio_valida" value="${escapeHtml(getValidShiftTime(row, "hora_inicio_valida"))}" ${disabled} aria-label="Inicio válido ${row.fecha || index + 1}"></td>
          <td><input class="nomina-detalle-hora-valida" data-field="hora_fin_valida" value="${escapeHtml(getValidShiftTime(row, "hora_fin_valida"))}" ${disabled} aria-label="Fin válido ${row.fecha || index + 1}"></td>
        </tr>`;
      }).join("");
  }
  if (parametrosCalculoBody) {
    const detailOptions = '<option value="horas_diurnas">Diurnas</option><option value="horas_nocturnas">Nocturnas</option><option value="horas_dominicales_diurnas">Dom. diurnas</option><option value="horas_dominicales_nocturnas">Dom. nocturnas</option>';
    const periodOptions = '<option value="dia">día</option><option value="semana">semana</option><option value="mes">mes</option><option value="trimestre">trimestre</option><option value="semestre">semestre</option>';
    parametrosCalculoBody.innerHTML = (state.parametrosDetalle || []).map((param) => {
      const normalized = normalizeConcept(param.concepto || param.nombre);
      const options = normalized.includes("auxilio") && normalized.includes("transporte") ? periodOptions : detailOptions;
      return `<tr data-calc-param="${param.row_id}"><td>${escapeHtml(param.concepto || param.nombre || "-")}</td><td><select class="nomina-calc-match">${options}</select></td></tr>`;
    }).join("");
    parametrosCalculoBody.querySelectorAll("tr[data-calc-param]").forEach((tr) => { tr.querySelector("select").value = state.parametrosCalculo[tr.dataset.calcParam] || "horas_diurnas"; });
  }
  if (detallesCalculosBody) {
    const calculation = calculateMoneyByDetail();
    const rows = calculation.rows.map((row) => `<tr><td>${row.fecha || "-"}</td><td>${row.dia || "-"}</td><td>${row.hora_inicio || "-"} - ${row.hora_fin || "-"}</td><td>${fmtMoney(row.calculos.horas_diurnas)}</td><td>${fmtMoney(row.calculos.horas_nocturnas)}</td><td>${fmtMoney(row.calculos.horas_dominicales_diurnas)}</td><td>${fmtMoney(row.calculos.horas_dominicales_nocturnas)}</td><td>${fmtMoney(row.calculos.total)}</td></tr>`);
    const total = calculation.rows.reduce((acc, row) => acc + row.calculos.total, 0);
    rows.push(`<tr class="nomina-total-row"><td colspan="7">Total</td><td>${fmtMoney(total)}</td></tr>`);
    detallesCalculosBody.innerHTML = rows.join("");
  }
};
const renderComprobanteHeader = (empleado) => {
  const empleadoNombre = state.empleadoDetalle?.nombre || empleado?.nombre_completo || "-";
  const empleadoCargo = state.empleadoDetalle?.cargo || empleado?.rol || "-";
  const periodoInicio = state.periodoDetalle?.inicio || fechaInicioInput.value || "-";
  const periodoFin = state.periodoDetalle?.fin || fechaFinInput.value || "-";
  empleadoDataEl.innerHTML = `
    <div><strong>${empleadoNombre}</strong></div>
    <div>Cargo: ${empleadoCargo}</div>
    <div>Periodo: ${periodoInicio} - ${periodoFin}</div>
    <div>Fecha: ${periodoFin}</div>
  `;
};

const normalizeNominaWebhookRows = async (payload, empleadoSeleccionado = null) => {

  const fromCurrentPayrollJson = (candidate) => {
    const item = Array.isArray(candidate) ? candidate[0] : candidate;
    if (!item || typeof item !== "object" || (!item?.horas_dinero && !item?.horas_valor && !item?.extras)) return null;
    const horasDinero = item?.horas_dinero || {};
    const extras = item?.extras || {};
    const horasValor = item?.horas_valor || {};

    const rows = [
      { tipo: "Horas diurnas por tarifa", naturaleza: "Devengo", valor: toNumeric(horasDinero.diurnas_por_tarifa), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Horas nocturnas por tarifa", naturaleza: "Devengo", valor: toNumeric(horasDinero.nocturnas_por_tarifa), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Dominicales diurnas por tarifa", naturaleza: "Devengo", valor: toNumeric(horasDinero.dominicales_diurnas_por_tarifa), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Dominicales nocturnas por tarifa", naturaleza: "Devengo", valor: toNumeric(horasDinero.dominicales_nocturnas_por_tarifa), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Propinas", naturaleza: "Devengo", valor: toNumeric(extras.propinas), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Auxilio de transporte", naturaleza: "Devengo", valor: toNumeric(extras.auxilio_de_transporte), fuente: "webhook", metadata: null, created_at: new Date().toISOString() },
      { tipo: "Diferencia de caja", naturaleza: "Deducción", valor: Math.abs(toNumeric(extras.diferencia_caja)), fuente: "webhook", metadata: { original: toNumeric(extras.diferencia_caja) }, created_at: new Date().toISOString() }
    ].filter((row) => row.valor > 0);

    state.empleadoDetalle = {
      nombre: empleadoSeleccionado?.nombre_completo || "-",
      cargo: empleadoSeleccionado?.rol || "-"
    };
    state.periodoDetalle = { inicio: fechaInicioInput.value, fin: fechaFinInput.value };
    state.horasDetalle = {
      total: toNumeric(horasValor.total),
      diurnas: toNumeric(horasValor.diurnas),
      nocturnas: toNumeric(horasValor.nocturnas),
      dominicales_diurnas: toNumeric(horasValor.dominicales_diurnas),
      dominicales_nocturnas: toNumeric(horasValor.dominicales_nocturnas)
    };
    return rows;
  };
  const fromPrototypePayload = (candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const hasPrototype = candidate?.empleado && candidate?.periodo && candidate?.detalle_horas;
    if (!hasPrototype) return null;

    const horas = Object.entries(candidate.detalle_horas || {}).map(([tipo, value]) => ({
      tipo: `Horas ${String(tipo).replace(/_/g, " ")}`,
      naturaleza: "Devengo",
      valor: toNumeric(value?.total),
      fuente: "webhook",
      metadata: { horas: toNumeric(value?.horas), valor_unitario: toNumeric(value?.valor_unitario) },
      created_at: new Date().toISOString()
    }));

    const ingresosExtra = [
      { key: "auxilio_transporte", label: "Auxilio de transporte" },
      { key: "propinas", label: "Propinas" }
    ].map((item) => ({
      tipo: item.label,
      naturaleza: "Devengo",
      valor: toNumeric(candidate?.[item.key]),
      fuente: "webhook",
      metadata: null,
      created_at: new Date().toISOString()
    })).filter((item) => item.valor > 0);

    const descuentos = (Array.isArray(candidate?.descuentos) ? candidate.descuentos : []).map((item) => ({
      tipo: item?.concepto || "Descuento",
      naturaleza: "Deducción",
      valor: toNumeric(item?.monto),
      fuente: "webhook",
      metadata: null,
      created_at: new Date().toISOString()
    }));

    const diferenciaCaja = toNumeric(candidate?.diferencias_caja);
    if (diferenciaCaja !== 0) {
      descuentos.push({
        tipo: "Diferencias de caja",
        naturaleza: "Deducción",
        valor: Math.abs(diferenciaCaja),
        fuente: "webhook",
        metadata: { original: diferenciaCaja },
        created_at: new Date().toISOString()
      });
    }

    state.empleadoDetalle = {
      nombre: candidate?.empleado?.nombre || empleadoSeleccionado?.nombre_completo || "-",
      cargo: candidate?.empleado?.cargo || empleadoSeleccionado?.rol || "-"
    };
    state.periodoDetalle = {
      inicio: candidate?.periodo?.inicio || fechaInicioInput.value,
      fin: candidate?.periodo?.fin || fechaFinInput.value
    };

    return [...horas, ...ingresosExtra, ...descuentos];
  };

  const directPayrollArray = deepExtractPayrollArray(payload);
  const rootPayrollObject = deepExtractPayrollObject(payload);
  const payrollCandidate = directPayrollArray || rootPayrollObject || payload;
  nominaLog("normalize.directPayrollArray", Array.isArray(payrollCandidate) ? `array(${payrollCandidate.length})` : typeof payrollCandidate);
  const fromCurrent = fromCurrentPayrollJson(payrollCandidate);
  if (fromCurrent) { nominaLog("normalize.fromCurrent.rows", fromCurrent.length); return fromCurrent; }
  if (rootPayrollObject) nominaWarn("normalize.rootPayrollObject.noRows", rootPayrollObject);

  const fromPrototype = fromPrototypePayload(payload);
  if (fromPrototype) { nominaLog("normalize.fromPrototype.rows", fromPrototype.length); return fromPrototype; }

  const pickRows = (candidate) => {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.data)) return candidate.data;
    if (Array.isArray(candidate?.items)) return candidate.items;
    if (Array.isArray(candidate?.movimientos)) return candidate.movimientos;
    if (candidate && typeof candidate === "object") {
      for (const value of Object.values(candidate)) {
        if (Array.isArray(value)) return value;
      }
    }
    return [];
  };

  const rows = pickRows(payload);
  state.empleadoDetalle = {
    nombre: payload?.empleado?.nombre || empleadoSeleccionado?.nombre_completo || "-",
    cargo: payload?.empleado?.cargo || empleadoSeleccionado?.rol || "-"
  };
  state.periodoDetalle = {
    inicio: payload?.periodo?.inicio || fechaInicioInput.value,
    fin: payload?.periodo?.fin || fechaFinInput.value
  };
  state.horasDetalle = null;
  const mapped = rows.map((item) => ({
    tipo: item?.tipo || item?.concepto || "-",
    naturaleza: item?.naturaleza || item?.categoria || "-",
    valor: toNumeric(item?.valor ?? item?.monto ?? 0),
    fuente: item?.fuente || item?.origen || "webhook",
    metadata: item?.metadata || null,
    created_at: item?.created_at || item?.fecha || new Date().toISOString()
  }));
  nominaLog("normalize.generic.rows", mapped.length);
  return mapped;
};


function hasMeaningfulRows(rows) { return Array.isArray(rows) && rows.some((row) => toNumeric(row?.valor ?? 0) > 0); }

const normalizeWithRetries = async (webhookData, empleadoSeleccionado, retries = 3) => {
  let lastRows = [];
  for (let i = 0; i < retries; i += 1) {
    lastRows = await normalizeNominaWebhookRows(webhookData, empleadoSeleccionado);
    if (hasMeaningfulRows(lastRows)) return lastRows;
    await sleep(150);
  }
  return lastRows;
};



const startMappingRecoveryLoop = (webhookData, empleadoSeleccionado) => {
  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    const rows = await normalizeNominaWebhookRows(webhookData, empleadoSeleccionado);
    if (hasMeaningfulRows(rows)) {
      state.movimientos = rows.map((item) => ({ ...item, empleado_nombre: empleadoSeleccionado?.nombre_completo || "Empleado", estado: "Liquidable" }));
      nominaLog("consultar.movimientos.final", state.movimientos.length);
  renderMovimientos();
      renderComprobanteHeader(empleadoSeleccionado);
      setStatus(`Consulta completada. ${state.movimientos.length} movimientos encontrados.`);
      clearInterval(timer);
      return;
    }
    if (attempts >= 4) clearInterval(timer);
  }, 2000);
};

const consultarNomina = async () => {
  const empleadoId = empleadoSelect.value;
  if (!empleadoId) {
    setStatus("Selecciona un empleado para consultar su nómina.");
    return;
  }

  state.periodoDetalle = { inicio: fechaInicioInput.value || "-", fin: fechaFinInput.value || "-" };
  const empleadoSeleccionado = state.responsables.find((item) => item.id === empleadoId);
  state.empleadoDetalle = { nombre: empleadoSeleccionado?.nombre_completo || "-", cargo: empleadoSeleccionado?.rol || "-" };
  setStatus("Consultando movimientos de nómina...");
  const loadingStart = Date.now();
  const payload = buildExcelWebhookPayload(empleadoId);

  let rows = [];

  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const webhookData = await parseWebhookResponseSafe(response);
    const excelData = parseExcelWebhookPayload(webhookData);
    setStatus("Datos recibidos del webhook del Excel. Procesando nómina para interfaz...");
    rows = excelData ? normalizeExcelPayrollForUi(excelData, empleadoSeleccionado) : await normalizeWithRetries(webhookData, empleadoSeleccionado, 4);
    nominaLog("consultar.rows.afterRetries", rows.length);
    if (!hasMeaningfulRows(rows) && webhookData) startMappingRecoveryLoop(webhookData, empleadoSeleccionado);
    if (!rows.length) {
      const shape = Array.isArray(webhookData) ? "array" : typeof webhookData;
      const preview = typeof webhookData === "string" ? webhookData.slice(0, 120) : JSON.stringify(webhookData || {}).slice(0, 120);
      setStatus(`Respuesta recibida (${shape}) pero sin filas compatibles. Vista previa: ${preview}`);
    }
  } catch (_error) {
    const { data, error } = await supabase
      .from("nomina_movimientos")
      .select("tipo,naturaleza,valor,fuente,metadata,created_at")
      .eq("empresa_id", state.context.empresa_id)
      .eq("usuario_id", empleadoId)
      .gte("created_at", `${fechaInicioInput.value}T00:00:00Z`)
      .lte("created_at", `${fechaFinInput.value}T23:59:59Z`)
      .order("created_at", { ascending: true });

    if (error) {
      state.movimientos = [];
      renderMovimientos();
      setStatus(`Error consultando nómina: ${error.message || "sin detalle"}`);
      return;
    }

    rows = Array.isArray(data) ? data : [];
    setStatus("Procesando datos de respaldo (Supabase)...");
    state.empleadoDetalle = null;
    state.periodoDetalle = null;
    state.horasDetalle = null;
    state.parametrosDetalle = [];
    state.detalleCalculo = [];
    state.apoyosDetalle = [];
    state.excelTotales = null;
  }

  const elapsed = Date.now() - loadingStart;
  if (elapsed < 1000) await sleep(1000 - elapsed);

  const empleado = empleadoSeleccionado;
  state.movimientos = rows.map((item) => ({
    ...item,
    empleado_nombre: empleado?.nombre_completo || "Empleado",
    estado: "Liquidable"
  }));

  renderMovimientos();
  renderComprobanteHeader(empleado);
  setStatus(`Consulta completada. ${state.movimientos.length} movimientos encontrados.`);
};

const descargarComprobante = () => {
  const empleado = state.responsables.find((item) => item.id === empleadoSelect.value);
  if (!empleado) {
    setStatus("Selecciona un empleado antes de descargar el comprobante.");
    return;
  }

  const ingresos = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("devengo"));
  const deducciones = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("dedu"));
  const totalIngresos = ingresos.reduce((acc, item) => acc + Number(item.valor || 0), 0);
  const totalDeducciones = deducciones.reduce((acc, item) => acc + Number(item.valor || 0), 0);
  const neto = totalIngresos - totalDeducciones;

  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 54px Arial";
  ctx.textAlign = "center";
  ctx.fillText("Comprobante de Nómina", canvas.width / 2, 76);
  ctx.textAlign = "left";

  const leftX = 70;
  let y = 140;
  ctx.font = "bold 24px Arial";
  ctx.fillText(state.empresa?.nombre_comercial || "EMPRESA", leftX, y);
  y += 36;
  ctx.font = "20px Arial";
  ctx.fillText(`NIT ${state.empresa?.nit || "-"}`, leftX, y);

  let ry = 140;
  const empleadoNombre = state.empleadoDetalle?.nombre || empleado.nombre_completo || "-";
  const empleadoCargo = state.empleadoDetalle?.cargo || empleado.rol || "-";
  const periodoInicio = state.periodoDetalle?.inicio || fechaInicioInput.value || "-";
  const periodoFin = state.periodoDetalle?.fin || fechaFinInput.value || "-";
  const lines = [
    `Nombre: ${empleadoNombre}`,
    `Cargo: ${empleadoCargo}`,
    `Periodo: ${periodoInicio} - ${periodoFin}`,
    `Fecha: ${periodoFin}`
  ];
  ctx.textAlign = "right";
  lines.forEach((line, index) => {
    ctx.font = index === 0 ? "bold 22px Arial" : "20px Arial";
    ctx.fillText(line, 1820, ry);
    ry += 34;
  });
  ctx.textAlign = "left";

  const tableTop = 360;
  const tableHeight = 490;
  const tableWidth = 860;
  const drawTable = (x, title, rows, total) => {
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(x, tableTop, tableWidth, 44);
    ctx.fillStyle = "#111827";
    ctx.font = "bold 24px Arial";
    ctx.fillText(title, x + 12, tableTop + 30);

    ctx.font = "bold 18px Arial";
    ctx.fillText("Concepto", x + 12, tableTop + 72);
    ctx.fillText("Cant.", x + 520, tableTop + 72);
    ctx.fillText("Valor", x + 650, tableTop + 72);

    let rowY = tableTop + 104;
    (rows.length ? rows : [{ tipo: "Sin datos", valor: 0 }]).forEach((item) => {
      ctx.font = "17px Arial";
      ctx.fillText(item.tipo || "-", x + 12, rowY);
      ctx.fillText("1", x + 520, rowY);
      ctx.fillText(fmtMoney(item.valor || 0), x + 650, rowY);
      rowY += 34;
    });

    ctx.font = "bold 20px Arial";
    ctx.fillText(`Total ${title.toLowerCase()}: ${fmtMoney(total)}`, x + 12, tableTop + tableHeight);
  };

  drawTable(70, "Ingresos", ingresos, totalIngresos);
  drawTable(980, "Deducciones", deducciones, totalDeducciones);

  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(1180, 910, 670, 82);
  ctx.fillStyle = "#111827";
  ctx.font = "bold 30px Arial";
  ctx.fillText("NETO A PAGAR", 1210, 962);
  ctx.textAlign = "right";
  ctx.fillText(fmtMoney(neto), 1820, 962);
  ctx.textAlign = "left";

  ctx.fillStyle = "#6b7280";
  ctx.font = "16px Arial";
  drawPngBrandWatermark(ctx, {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    empresaNombre: state.empresa?.nombre_comercial || "EMPRESA",
    moduloNombre: "Comprobante de Nómina",
    fechaTexto: fechaFinInput.value || new Date().toISOString().slice(0, 10)
  });

  const link = document.createElement("a");
  link.download = `comprobante_nomina_${(fechaFinInput.value || new Date().toISOString().slice(0, 10))}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
  setStatus("Comprobante descargado correctamente.");
};


const descargarExcelEmpleado = async () => {
  const empleadoId = empleadoSelect.value;
  if (!empleadoId) {
    setStatus("Selecciona un empleado antes de solicitar el Excel.");
    return;
  }

  if (!fechaInicioInput.value || !fechaFinInput.value) {
    setStatus("Selecciona un rango de fechas válido para exportar el Excel.");
    return;
  }

  const payload = buildExcelWebhookPayload(empleadoId);

  const empleadoSeleccionado = state.responsables.find((item) => item.id === empleadoId);
  const periodoInicio = fechaInicioInput.value || "inicio";
  const periodoFin = fechaFinInput.value || "fin";

  const removeEmailDomainNoise = (value) => String(value || "")
    .replace(/@/g, "_")
    .replace(/(?:\.com|\.co|\.net|\.org|\.edu|\.es)+$/i, "");

  const normalizeFilePart = (value, fallback, { stripDomain = false } = {}) => {
    const baseValue = stripDomain ? removeEmailDomainNoise(value) : value;
    const text = String(baseValue || fallback || "archivo")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\./g, "_")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return text || fallback || "archivo";
  };

  const buildExcelFilename = () => {
    const empleadoNombre = empleadoSeleccionado?.nombre_completo || state.empleadoDetalle?.nombre || empleadoId || "empleado";
    return `nomina_${normalizeFilePart(empleadoNombre, "empleado", { stripDomain: true })}_${normalizeFilePart(periodoInicio, "inicio")}_a_${normalizeFilePart(periodoFin, "fin")}.xls`;
  };

  const escHtml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const parseWebhookPayload = (value, depth = 0) => {
    if (depth > 8 || value === null || value === undefined) return null;
    if (typeof value === "string") {
      const text = value.trim();
      if (!text) return null;
      try { return parseWebhookPayload(JSON.parse(text), depth + 1); } catch (_e) { return null; }
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const parsed = parseWebhookPayload(item, depth + 1);
        if (parsed) return parsed;
      }
      return null;
    }
    if (typeof value === "object") {
      if (Array.isArray(value.parametros) || Array.isArray(value.detalle) || Array.isArray(value.apoyos) || value.resumen || value.totales) return value;
      for (const child of Object.values(value)) {
        const parsed = parseWebhookPayload(child, depth + 1);
        if (parsed) return parsed;
      }
    }
    return null;
  };

  const toMoneyNumber = (value) => {
    const number = toNumeric(value);
    return Number.isFinite(number) ? number : 0;
  };

  const tableRows = (rows) => rows.join("\n");

  const renderHeaderRow = (headers) => `<tr>${headers.map((header) => `<th>${escHtml(header)}</th>`).join("")}</tr>`;

  const moneyCell = (value, className = "money calculated") => `<td class="${className}">${toMoneyNumber(value)}</td>`;
  const textCell = (value, className = "") => `<td${className ? ` class="${className}"` : ""}>${escHtml(value)}</td>`;

  const worksheetXml = (names) => names.map((name) => `
    <x:ExcelWorksheet>
      <x:Name>${escHtml(name)}</x:Name>
      <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet>`).join("");

  const renderSheet = (name, title, tableHtml) => `
    <div class="sheet">
      <!--[if gte mso 9]><xml><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></xml><![endif]-->
      <h1>${escHtml(title)}</h1>
      ${tableHtml}
    </div>`;

  const buildExcelHtml = (data) => {
    const parametros = Array.isArray(data.parametros) ? data.parametros : [];
    const detalle = Array.isArray(data.detalle) ? data.detalle : [];
    const apoyos = Array.isArray(data.apoyos) ? data.apoyos : [];
    const resumen = data.resumen && typeof data.resumen === "object" ? data.resumen : {};
    const totales = data.totales && typeof data.totales === "object" ? data.totales : {};
    const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};

    const parametrosTable = `<table>
      <thead>${renderHeaderRow(["Concepto", "Valor por unidad", "Unidad", "Valor formateado"])}</thead>
      <tbody>${tableRows(parametros.map((param) => `<tr>${textCell(param.concepto)}${moneyCell(param.valor, "money")}${textCell("COP")}${textCell(param.valorFormateado)}</tr>`))}</tbody>
    </table>`;

    const detalleHeadersBase = [
      "Responsable", "Día", "Fecha", "Hora Inicio", "Hora Fin", "Horas Totales", "Horas Diurnas", "Horas Nocturnas",
      "Valor Diurnas", "Valor Nocturnas", "Valor Dom. Diurnas", "Valor Dom. Nocturnas", "Total Fila"
    ];
    const detalleMatrix = detalle.map((row) => {
      const totalFila = toMoneyNumber(row.valor_diurnas) + toMoneyNumber(row.valor_nocturnas) + toMoneyNumber(row.valor_dominical_diurnas) + toMoneyNumber(row.valor_dominical_nocturnas);
      return [row.responsable, row.dia, row.fecha, row.hora_inicio, row.hora_fin, row.horas_totales, row.horas_diurnas, row.horas_nocturnas, row.valor_diurnas, row.valor_nocturnas, row.valor_dominical_diurnas, row.valor_dominical_nocturnas, totalFila];
    });
    const detalleFiltered = filterEmptyColumns(detalleHeadersBase, detalleMatrix, [2]);
    const moneyHeaders = new Set(["Valor Diurnas", "Valor Nocturnas", "Valor Dom. Diurnas", "Valor Dom. Nocturnas", "Total Fila"]);
    const detalleRows = detalleFiltered.rows.map((row) => `<tr>${row.map((cell, index) => moneyHeaders.has(detalleFiltered.headers[index]) ? moneyCell(cell) : textCell(cell, detalleFiltered.headers[index] === "Fecha" ? "date-text" : "")).join("")}</tr>`);
    const detalleTable = `<table>
      <thead>${renderHeaderRow(detalleFiltered.headers)}</thead>
      <tbody>${tableRows(detalleRows)}</tbody>
    </table>`;

    const subtotalHoras = toMoneyNumber(resumen.total_diurnas) + toMoneyNumber(resumen.total_nocturnas) + toMoneyNumber(resumen.total_dominical_diurnas) + toMoneyNumber(resumen.total_dominical_nocturnas);
    const resumenItems = [
      ["Total Horas Diurnas", resumen.total_diurnas, resumen.total_diurnas_formato],
      ["Total Horas Nocturnas", resumen.total_nocturnas, resumen.total_nocturnas_formato],
      ["Total Dominicales Diurnas", resumen.total_dominical_diurnas, resumen.total_dominical_diurnas_formato],
      ["Total Dominicales Nocturnas", resumen.total_dominical_nocturnas, resumen.total_dominical_nocturnas_formato],
      ["SUBTOTAL HORAS", subtotalHoras, fmtMoney(subtotalHoras), "subtotal"]
    ];
    const resumenTable = `<table>
      <thead>${renderHeaderRow(["Concepto", "Valor calculado", "Valor formateado"])}</thead>
      <tbody>${tableRows(resumenItems.map(([label, value, formatted, extraClass]) => `<tr class="${extraClass || ""}">${textCell(label)}${moneyCell(value, "money")}${textCell(formatted)}</tr>`))}</tbody>
    </table>`;

    const totalesItems = [
      ["Días trabajados", totales.dias_trabajados, ""],
      ["Horas trabajadas", totales.horas_trabajadas_formato || totales.horas_trabajadas, ""],
      ["Valor total horas", totales.valor_horas, totales.valor_horas_formato, "money"],
      ["Auxilio de transporte", totales.transporte, totales.transporte_formato, "money"],
      ["TOTAL A PAGAR", totales.total_general, totales.total_general_formato, "money total"]
    ];
    const metadataRows = [
      ["Filas procesadas", metadata.total_filas_procesadas ?? detalle.length],
      ["Fecha proceso", metadata.fecha_proceso || ""]
    ];
    const totalesTable = `<table>
      <thead>${renderHeaderRow(["Concepto", "Valor", "Valor formateado"])} </thead>
      <tbody>${tableRows(totalesItems.map(([label, value, formatted, type]) => `<tr class="${String(type || "").includes("total") ? "total-row" : ""}">${textCell(label)}${type ? moneyCell(value, type) : textCell(value)}${textCell(formatted)}</tr>`))}</tbody>
    </table>
    <h2>Metadata</h2>
    <table>
      <thead>${renderHeaderRow(["Campo", "Valor"])}</thead>
      <tbody>${tableRows(metadataRows.map(([label, value]) => `<tr>${textCell(label)}${textCell(value)}</tr>`))}</tbody>
    </table>`;


    const apoyosHeaders = ["fecha turno", "responsable turno", "apoyo", "tiempo", "hora inicio", "hora fin", "propina"];
    const apoyosRows = apoyos.map((row) => `<tr>
      ${textCell(row.fecha_turno)}${textCell(resolveResponsableName(row.responsable_turno_id, row.responsable_turno_id))}${textCell(resolveResponsableName(row.apoyo_responsable_id, empleadoSeleccionado?.nombre_completo || row.apoyo_responsable_id))}${textCell(minutesToHourText(row.tiempo_minutos || hoursToMinutes(row.tiempo_horas)))}${textCell(row.hora_inicio)}${textCell(row.hora_fin)}${moneyCell(row.propina)}
    </tr>`);
    const apoyosTable = `<table>
      <thead>${renderHeaderRow(apoyosHeaders)}</thead>
      <tbody>${tableRows(apoyosRows.length ? apoyosRows : [`<tr>${textCell("Sin apoyos")}${textCell("")}${textCell("")}${textCell("00:00")}${textCell("")}${textCell("")}${moneyCell(0)}</tr>`])}</tbody>
    </table>`;

    const sheetNames = ["Parámetros", "Detalle Nómina", "Resumen", "Totales Generales", "Apoyos"];
    return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
<head>
  <meta charset="UTF-8" />
  <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets>${worksheetXml(sheetNames)}</x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
  <style>
    body{font-family:Arial,sans-serif;font-size:12px;color:#111827;}
    .sheet{page-break-after:always;}
    h1{font-size:18px;text-align:center;margin:12px 0 16px;}
    h2{font-size:14px;margin:18px 0 8px;}
    table{border-collapse:collapse;margin-bottom:16px;}
    th,td{border:1px solid #cbd5e1;padding:6px 8px;text-align:left;vertical-align:middle;}
    th{background:#4472C4;color:#fff;font-weight:700;text-align:center;}
    .money{mso-number-format:'$\\#\\,\\#\\#0.00';text-align:right;}
    .calculated{background:#E2EFDA;}
    .subtotal td{background:#D9E1F2;font-weight:700;}
    .total-row td{background:#FFC000;font-weight:700;font-size:13px;}
    .date-text{mso-number-format:'@';}
  </style>
</head>
<body>
  ${renderSheet("Parámetros", "PARÁMETROS DE NÓMINA", parametrosTable)}
  ${renderSheet("Detalle Nómina", "DETALLE DE NÓMINA", detalleTable)}
  ${renderSheet("Resumen", "RESUMEN DE NÓMINA", resumenTable)}
  ${renderSheet("Totales Generales", "TOTALES GENERALES", totalesTable)}
  ${renderSheet("Apoyos", "APOYOS", apoyosTable)}
</body>
</html>`;
  };

  const triggerExcelDownload = (excelHtml, detalleCount) => {
    const blob = new Blob(["\ufeff" + excelHtml], { type: "application/vnd.ms-excel;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = buildExcelFilename();
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    setStatus(`Excel de nómina generado con ${detalleCount} filas de detalle y 4 tablas.`);
  };

  const buildCurrentCalculatedData = () => {
    const calculation = calculateMoneyByDetail();
    const detalle = calculation.rows.map((row) => ({
      responsable: empleadoId,
      dia: row.dia,
      fecha: row.fecha,
      hora_inicio: row.hora_inicio,
      hora_fin: row.hora_fin,
      horas_totales: row.horas_totales,
      horas_diurnas: row.horas_diurnas,
      horas_nocturnas: row.horas_nocturnas,
      horas_dominicales_diurnas: row.horas_dominicales_diurnas,
      horas_dominicales_nocturnas: row.horas_dominicales_nocturnas,
      valor_diurnas: row.calculos.horas_diurnas,
      valor_nocturnas: row.calculos.horas_nocturnas,
      valor_dominical_diurnas: row.calculos.horas_dominicales_diurnas,
      valor_dominical_nocturnas: row.calculos.horas_dominicales_nocturnas
    }));
    const totalHoras = calculation.totals.valor_diurnas + calculation.totals.valor_nocturnas + calculation.totals.valor_dominical_diurnas + calculation.totals.valor_dominical_nocturnas;
    return {
      parametros: state.parametrosDetalle,
      detalle,
      apoyos: state.apoyosDetalle,
      resumen: {
        total_diurnas: calculation.totals.valor_diurnas,
        total_nocturnas: calculation.totals.valor_nocturnas,
        total_dominical_diurnas: calculation.totals.valor_dominical_diurnas,
        total_dominical_nocturnas: calculation.totals.valor_dominical_nocturnas
      },
      totales: {
        dias_trabajados: calculation.diasTrabajados,
        horas_trabajadas: state.horasDetalle?.total,
        horas_trabajadas_formato: fmtHours(state.horasDetalle?.total),
        valor_horas: totalHoras,
        transporte: calculation.transporteCalculado,
        total_general: totalHoras + calculation.transporteCalculado
      },
      metadata: { total_filas_procesadas: detalle.length, fecha_proceso: new Date().toISOString(), fuente: "interfaz_web" }
    };
  };

  if (state.detalleCalculo.length) {
    const currentData = buildCurrentCalculatedData();
    triggerExcelDownload(buildExcelHtml(currentData), currentData.detalle.length);
    return;
  }

  setStatus("Solicitando nómina calculada del empleado...");
  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOK_NOMINA_CONSULTAR_HISTORICO_EMPLEADO, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}${rawText ? ` - ${rawText.slice(0, 200)}` : ""}`);
    }

    let parsed = null;
    try {
      parsed = rawText ? JSON.parse(rawText) : null;
    } catch (_e) {
      parsed = rawText;
    }

    const data = parseWebhookPayload(parsed);
    if (!data) {
      throw new Error(`El webhook respondió sin estructura de nómina exportable. Vista previa: ${(rawText || "").slice(0, 180)}`);
    }

    const detalleCount = Array.isArray(data.detalle) ? data.detalle.length : 0;
    const excelHtml = buildExcelHtml(data);
    triggerExcelDownload(excelHtml, detalleCount);
  } catch (error) {
    setStatus(`No fue posible generar el Excel en este momento (${error.message}).`);
    nominaWarn("excel_empleado.error", error?.message || error);
  }
};

const init = async () => {
  setDefaultDates();
  state.context = await getUserContext().catch(() => null);
  if (!state.context?.empresa_id) {
    setStatus("No se pudo resolver la empresa activa para este módulo.");
    return;
  }

  state.responsables = await fetchResponsablesActivos(state.context.empresa_id).catch(() => []);
  renderEmpleadoOptions();

  const { data: empresa } = await supabase
    .from("empresas")
    .select("nombre_comercial,razon_social,nit")
    .eq("id", state.context.empresa_id)
    .maybeSingle();
  state.empresa = empresa || null;
  empresaNombreEl.textContent = state.empresa?.razon_social || state.empresa?.nombre_comercial || "EMPRESA";
  empresaNitEl.textContent = `NIT ${state.empresa?.nit || "-"}`;
  renderMovimientos();
  renderComprobanteHeader(null);
};

consultarBtn?.addEventListener("click", consultarNomina);
descargarBtn?.addEventListener("click", () => { descargarComprobante(); guardarHistoricoNomina(); });
descargarExcelEmpleadoBtn?.addEventListener("click", descargarExcelEmpleado);
corteSelect?.addEventListener("change", updateDatesByCut);
fechaInicioInput?.addEventListener("change", clampDatesToToday);
fechaFinInput?.addEventListener("change", clampDatesToToday);
apoyosBody?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-apoyo-index]");
  if (!rowEl) return;
  const index = Number(rowEl.dataset.apoyoIndex);
  const row = state.apoyosDetalle[index];
  if (!row) return;

  if (event.target.classList.contains("nomina-apoyo-validar")) row.incluido = event.target.checked;
  if (event.target.classList.contains("nomina-apoyo-tiempo")) row.tiempo_minutos = hoursToMinutes(event.target.value);
  if (event.target.classList.contains("nomina-apoyo-propina")) row.propina = toNumeric(event.target.value);

  recalculatePayrollFromEditableDetail();
});

detalleCalculoBody?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-detail-index]");
  if (!rowEl) return;
  const index = Number(rowEl.dataset.detailIndex);
  const row = state.detalleCalculo[index];
  if (!row) return;

  if (event.target.classList.contains("nomina-detalle-validar")) {
    row.incluidoTransporte = event.target.checked;
  }

  if (event.target.classList.contains("nomina-detalle-hora-valida")) {
    const field = event.target.dataset.field;
    if (field) row[field] = event.target.value;
  }

  recalculatePayrollFromEditableDetail();
});

document.getElementById("nominaPayrollOverrides")?.addEventListener("change", (event) => {
  const field = event.target?.dataset?.field;
  if (!field || !state.payrollOverrides[field]) return;
  if (event.target.classList.contains("nomina-override-source")) state.payrollOverrides[field].source = event.target.value;
  if (event.target.classList.contains("nomina-override-multiplier")) state.payrollOverrides[field].multiplier = Math.max(0, toNumeric(event.target.value) || 0);
  if (state.detalleCalculo.length) recalculatePayrollFromEditableDetail();
});


parametrosBody?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-param-index]");
  if (!rowEl) return;
  const param = state.parametrosDetalle[Number(rowEl.dataset.paramIndex)];
  if (!param) return;
  if (event.target.classList.contains("nomina-param-concepto")) param.concepto = event.target.value;
  if (event.target.classList.contains("nomina-param-valor")) param.valor = toNumeric(event.target.value);
  if (event.target.classList.contains("nomina-param-unidad")) param.unidad = event.target.value;
  if (state.detalleCalculo.length) recalculatePayrollFromEditableDetail();
});

document.getElementById("nominaAddParametroAux")?.addEventListener("click", () => {
  const index = state.parametrosDetalle.length;
  state.parametrosDetalle.push({ row_id: `auxiliar-${Date.now()}`, concepto: "Parámetro auxiliar", valor: 0, unidad: "unidad", auxiliar: true });
  ensureParametroCalculo();
  renderMovimientos();
});

parametrosBody?.addEventListener("click", (event) => {
  if (event.target?.classList?.contains("nomina-remove-param")) {
    const rowEl = event.target.closest("tr[data-param-index]");
    const index = Number(rowEl?.dataset?.paramIndex);
    if (state.parametrosDetalle[index]?.auxiliar) state.parametrosDetalle.splice(index, 1);
    renderMovimientos();
  }
});

parametrosTiempoBody?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-time-index]");
  const row = state.parametrosTiempo[Number(rowEl?.dataset?.timeIndex)];
  if (!row) return;
  if (event.target.classList.contains("nomina-time-start")) row.inicio = event.target.value;
  if (event.target.classList.contains("nomina-time-end")) row.fin = event.target.value;
  if (state.detalleCalculo.length) recalculatePayrollFromEditableDetail();
});

parametrosCalculoBody?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-calc-param]");
  if (!rowEl || !event.target.classList.contains("nomina-calc-match")) return;
  state.parametrosCalculo[rowEl.dataset.calcParam] = event.target.value;
  if (state.detalleCalculo.length) recalculatePayrollFromEditableDetail();
});

auxiliaresPanel?.addEventListener("click", (event) => {
  const addType = event.target?.dataset?.addAux;
  if (addType) {
    const target = addType === "deduccion" ? state.deduccionesAuxiliares : state.ingresosAuxiliares;
    target.push({ tipo: addType === "deduccion" ? "Deducción auxiliar" : "Ingreso auxiliar", cantidad: 1, unidad: "unidad", valor: 0 });
    recalculatePayrollFromEditableDetail();
    return;
  }
  if (event.target?.classList?.contains("nomina-remove-aux")) {
    const rowEl = event.target.closest("tr[data-aux-type]");
    const target = rowEl.dataset.auxType === "deduccion" ? state.deduccionesAuxiliares : state.ingresosAuxiliares;
    target.splice(Number(rowEl.dataset.auxIndex), 1);
    recalculatePayrollFromEditableDetail();
  }
});

auxiliaresPanel?.addEventListener("change", (event) => {
  const rowEl = event.target?.closest?.("tr[data-aux-type]");
  if (!rowEl) return;
  const target = rowEl.dataset.auxType === "deduccion" ? state.deduccionesAuxiliares : state.ingresosAuxiliares;
  const row = target[Number(rowEl.dataset.auxIndex)];
  if (!row) return;
  if (event.target.classList.contains("nomina-aux-concepto")) row.tipo = event.target.value;
  if (event.target.classList.contains("nomina-aux-cantidad")) row.cantidad = toNumeric(event.target.value);
  if (event.target.classList.contains("nomina-aux-unidad")) row.unidad = event.target.value;
  if (event.target.classList.contains("nomina-aux-valor")) row.valor = toNumeric(event.target.value);
  recalculatePayrollFromEditableDetail();
});

const guardarHistoricoNomina = async () => {
  if (!state.movimientos.length || !empleadoSelect.value) return;
  try {
    const calculation = calculateMoneyByDetail();
    const base = { ...buildExcelWebhookPayload(empleadoSelect.value), empresa: state.empresa, empleado: state.empleadoDetalle, periodo: state.periodoDetalle, generado_en: new Date().toISOString() };
    const bloques = [
      ["resumen", { movimientos: state.movimientos, horas: state.horasDetalle, totales: calculation.totals, neto: netoPagarEl?.textContent || "" }],
      ["detalle", calculation.rows],
      ["apoyos", state.apoyosDetalle],
      ["parametros", state.parametrosDetalle],
      ["parametros_tiempo", state.parametrosTiempo]
    ];
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    for (const [bloque, contenido] of bloques) {
      await fetch(WEBHOOK_NOMINA_HISTORICO_GUARDAR, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ ...base, bloque, contenido })
      });
    }
    setStatus("Comprobante descargado y nómina enviada al histórico por bloques.");
  } catch (error) {
    nominaWarn("historico.guardar.error", error?.message || error);
    setStatus("Comprobante descargado. No fue posible enviar el histórico de nómina en este momento.");
  }
};

init();

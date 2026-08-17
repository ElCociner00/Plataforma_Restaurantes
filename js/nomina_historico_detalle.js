/**
 * MANTENIMIENTO — Detalle Histórico Nómina
 * Archivo aislado usado solo por `nomina/historico_detalle.html`.
 * Recibe el ID por querystring, consulta WEBHOOK_NOMINA_HISTORICO_RENDERIZAR
 * y renderiza tablas limpias equivalentes al módulo de nómina, sin exponer IDs.
 */
import { buildRequestHeaders, getUserContext, listAvailableLocalContexts } from "./session.js";
import { WEBHOOK_NOMINA_HISTORICO_RENDERIZAR } from "./webhooks.js";

const tituloEl = document.getElementById("historicoNominaDetalleTitulo");
const resumenEl = document.getElementById("historicoNominaDetalleResumen");
const tablasEl = document.getElementById("historicoNominaDetalleTablas");
const statusEl = document.getElementById("historicoNominaDetalleStatus");

const MONEY_KEYS = new Set(["valor", "total", "neto", "propina", "propinas", "valor_diurnas", "valor_nocturnas", "valor_dominical_diurnas", "valor_dominical_nocturnas"]);
const HOUR_VALUE_PAIRS = [
  ["horas_diurnas", "valor_diurnas"],
  ["horas_nocturnas", "valor_nocturnas"],
  ["horas_dominicales_diurnas", "valor_dominical_diurnas"],
  ["horas_dominicales_nocturnas", "valor_dominical_nocturnas"]
];
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const money = (value) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
const numberText = (value) => new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
const formatDateLong = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Fecha sin definir";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};
const setStatus = (message) => { if (statusEl) statusEl.textContent = message || ""; };
const parseJsonLike = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
};
const labelize = (value) => String(value || "")
  .replace(/_/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .replace(/\b\p{L}/gu, (char) => char.toLocaleUpperCase("es-CO"));
const cleanName = (value) => {
  const text = String(value || "").trim();
  return text && !uuidPattern.test(text) ? text : "";
};
const normalizeUnit = (value) => {
  const unit = String(value || "").trim().toLowerCase();
  if (["h", "hr", "hrs", "hora", "horas"].includes(unit)) return "horas";
  if (["d", "dia", "día", "dias", "días"].includes(unit)) return "días";
  if (unit.includes("registro")) return "registros";
  return unit || "-";
};
const formatValue = (value, key = "") => {
  if (value === null || value === undefined || value === "") return "-";
  if (MONEY_KEYS.has(key) || String(key).startsWith("valor_")) return money(value);
  if (typeof value === "number") return numberText(value);
  return String(value);
};

const firstArrayFromObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  for (const key of ["data", "nominas", "rows", "items", "result", "payload", "body", "records"]) {
    const parsed = parseJsonLike(value[key]);
    if (Array.isArray(parsed)) return parsed;
    const nested = firstArrayFromObject(parsed);
    if (nested) return nested;
  }
  return null;
};
const extractRows = (payload) => {
  const parsed = parseJsonLike(payload);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed.flatMap((item) => {
    const parsedItem = parseJsonLike(item);
    const nested = parsedItem && typeof parsedItem === "object" && !Array.isArray(parsedItem) ? firstArrayFromObject(parsedItem) : null;
    return nested ? extractRows(nested) : [parsedItem];
  });
  const nested = firstArrayFromObject(parsed);
  return nested ? extractRows(nested) : [parsed];
};
const arrayFromAny = (value) => {
  const parsed = parseJsonLike(value);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") return Object.values(parsed).flatMap((item) => Array.isArray(parseJsonLike(item)) ? parseJsonLike(item) : []);
  return [];
};
const getTablaRows = (row, name) => {
  const tablas = parseJsonLike(row?.tablas) || {};
  const direct = arrayFromAny(row?.[name]);
  const nested = arrayFromAny(tablas?.[name]);
  return direct.length ? direct : nested;
};
const normalizeNomina = (raw) => {
  const row = parseJsonLike(raw) || {};
  const tablas = parseJsonLike(row.tablas) || {};
  const deducciones = getTablaRows(row, "deducciones");
  return {
    ...row,
    totales: parseJsonLike(row.totales) || parseJsonLike(tablas.totales) || {},
    detalles: getTablaRows(row, "detalles").length ? getTablaRows(row, "detalles") : getTablaRows(row, "detalle"),
    ingresos: getTablaRows(row, "ingresos"),
    deducciones: deducciones.length ? deducciones : getTablaRows(row, "deducciones_ley"),
    parametros: getTablaRows(row, "parametros")
  };
};

const normalizeLocal = (local = {}) => {
  const id = String(local.empresa_id || local.tenant_id || local.id || "").trim();
  const nombre = cleanName(local.nombre) || cleanName(local.nombre_comercial) || cleanName(local.razon_social);
  return id && nombre ? { id, nombre } : null;
};
const resolveSedeNames = (row, locales) => {
  const direct = cleanName(row?.empresa_nombre) || cleanName(row?.sede_nombre) || cleanName(row?.local_nombre) || cleanName(row?.empresa?.nombre_comercial) || cleanName(row?.empresa?.razon_social) || cleanName(row?.locales?.[0]?.nombre);
  if (direct) return direct;
  const ids = [row?.empresa_id, row?.sede, row?.sede_id, row?.local_id, row?.tenant_id, ...(Array.isArray(row?.consultado) ? row.consultado : [])].map((value) => String(value || ""));
  const names = ids.map((id) => locales.find((local) => local.id === id)?.nombre || "").filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(", ") : "Sede sin resolver";
};
const resolveDetalleSede = (item, parent, locales) => {
  const direct = cleanName(item?.sede_nombre) || cleanName(item?.local_nombre) || cleanName(item?.sede) || cleanName(item?.local);
  if (direct) return direct;
  return resolveSedeNames({ ...parent, empresa_id: item?.sede || item?.empresa_id || item?.tenant_id || parent?.empresa_id }, locales);
};
const rowType = (item = {}) => item.es_apoyo || item.tipo === "apoyo" ? "Apoyo" : "Turno normal";
const calcValue = (item, key) => Number(parseJsonLike(item?.calculos)?.[key] || 0);
const turnTotal = (item) => calcValue(item, "total") || ["horas_diurnas", "horas_nocturnas", "horas_dominicales_diurnas", "horas_dominicales_nocturnas"].reduce((sum, key) => sum + calcValue(item, key), 0);
const renderCard = (label, value) => `<div class="nomina-detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
const table = (title, headers, rows, className = "") => `<div class="comprobante-col nomina-historico-detail-table"><h3>${escapeHtml(title)}</h3><table class="${escapeHtml(className)}"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}">Sin datos recibidos para esta tabla.</td></tr>`}</tbody></table></div>`;
const td = (value) => `<td>${escapeHtml(value)}</td>`;

const renderResumenTotales = (totales = {}) => {
  const rows = HOUR_VALUE_PAIRS.map(([hoursKey, valueKey]) => `<tr>${td(labelize(hoursKey))}${td(numberText(totales[hoursKey]))}${td(labelize(valueKey))}${td(money(totales[valueKey]))}</tr>`);
  return table("Resumen de totales", ["Concepto horas", "Horas", "Concepto valor", "Valor"], rows, "nomina-summary-comparison");
};
const renderDetalles = (nomina, locales) => {
  const rows = nomina.detalles.map((item) => `<tr class="${item.es_apoyo ? "nomina-row-apoyo" : "nomina-row-turno"}">${[
    rowType(item),
    resolveDetalleSede(item, nomina, locales),
    item.fecha || "-",
    labelize(item.dia || "-"),
    `${item.hora_inicio || "-"} - ${item.hora_fin || "-"}`,
    item.horas_diurnas || "00:00",
    item.horas_nocturnas || "00:00",
    item.horas_dominicales_diurnas || "00:00",
    item.horas_dominicales_nocturnas || "00:00",
    item.hora_inicio_valida || item.hora_inicio || "-",
    item.hora_fin_valida || item.hora_fin || "-",
    money(item.propina || 0)
  ].map(td).join("")}</tr>`);
  return table("Detalles", ["Tipo", "Sede", "Fecha", "Día", "Horario", "Diurnas", "Nocturnas", "Dom. diurnas", "Dom. nocturnas", "Inicio válido", "Fin válido", "Propinas"], rows);
};
const renderCalculos = (nomina, locales) => {
  const rows = nomina.detalles.map((item) => `<tr class="${item.es_apoyo ? "nomina-row-apoyo" : "nomina-row-turno"}">${[
    item.fecha || "-",
    labelize(item.dia || "-"),
    rowType(item),
    resolveDetalleSede(item, nomina, locales),
    `${item.hora_inicio || "-"} - ${item.hora_fin || "-"}`,
    money(calcValue(item, "horas_diurnas")),
    money(calcValue(item, "horas_nocturnas")),
    money(calcValue(item, "horas_dominicales_diurnas")),
    money(calcValue(item, "horas_dominicales_nocturnas")),
    money(item.propina || 0),
    money(turnTotal(item) + Number(item.propina || 0))
  ].map(td).join("")}</tr>`);
  return table("Detalles cálculos", ["Fecha", "Día", "Tipo", "Sede", "Horario", "Diurnas", "Nocturnas", "Dom. diurnas", "Dom. nocturnas", "Propinas", "Total"], rows);
};
const renderConceptos = (title, rows) => table(title, ["Concepto", "Cantidad", "Unidad", "Valor", "Responsable"], rows.map((item) => `<tr>${[
  labelize(item.tipo || item.concepto || item.nombre || "Concepto"),
  formatValue(item.cantidad ?? item.horas ?? item.dias ?? "-"),
  normalizeUnit(item.unidad),
  money(item.valor || item.total || item.valor_empleado || 0),
  cleanName(item.empleado_nombre) || cleanName(item.responsable_nombre) || "-"
].map(td).join("")}</tr>`));
const renderParametros = (rows) => table("Parámetros", ["Concepto", "Valor", "Unidad"], rows.map((item) => `<tr>${[
  labelize(item.concepto || item.tipo || item.nombre || "Parámetro"),
  money(item.valor ?? item.valorFormateado ?? 0),
  normalizeUnit(item.unidad)
].map(td).join("")}</tr>`));

const consultarDetalle = async (id) => {
  const context = await getUserContext().catch(() => null);
  const locales = (await listAvailableLocalContexts().catch(() => [])).map(normalizeLocal).filter(Boolean);
  const authHeaders = await buildRequestHeaders({ includeTenant: true });
  const payload = { id, nomina_id: id, row_id: id, empresa_id: context?.empresa_id || "", tenant_id: context?.empresa_id || "", origen: "nomina_historico_detalle" };
  const response = await fetch(WEBHOOK_NOMINA_HISTORICO_RENDERIZAR, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(payload) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const [raw] = extractRows(await response.json().catch(() => null));
  return { row: normalizeNomina(raw), locales };
};
const renderDetalle = (row, locales) => {
  const ingresosTotal = row.ingresos.reduce((acc, item) => acc + Number(item.valor || item.total || item.valor_empleado || 0), 0);
  const deduccionesTotal = row.deducciones.reduce((acc, item) => acc + Number(item.valor || item.total || item.valor_empleado || 0), 0);
  tituloEl.textContent = "Detalle de nómina histórica";
  resumenEl.innerHTML = [
    renderCard("Fecha de expedición", formatDateLong(row.fecha)),
    renderCard("Empresa / sede", resolveSedeNames(row, locales)),
    renderCard("Ingresos", money(ingresosTotal)),
    renderCard("Deducciones", money(deduccionesTotal)),
    renderCard("Neto estimado", money(ingresosTotal - deduccionesTotal))
  ].join("");
  tablasEl.innerHTML = [
    renderResumenTotales(row.totales),
    renderDetalles(row, locales),
    renderCalculos(row, locales),
    renderConceptos("Ingresos", row.ingresos),
    renderConceptos("Deducciones", row.deducciones),
    renderParametros(row.parametros)
  ].join("");
  setStatus("Detalle histórico consultado correctamente.");
};

const init = async () => {
  const id = new URLSearchParams(window.location.search).get("id") || "";
  if (!id) {
    setStatus("No se recibió el ID de la nómina histórica. Vuelve al listado y selecciona una nómina.");
    return;
  }
  setStatus("Consultando detalle histórico...");
  try {
    const { row, locales } = await consultarDetalle(id);
    renderDetalle(row, locales);
  } catch (error) {
    setStatus(`No fue posible consultar el detalle (${error.message || "sin detalle"}).`);
  }
};

init();

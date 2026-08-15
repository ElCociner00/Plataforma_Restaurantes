/**
 * MANTENIMIENTO — Detalle Histórico Nómina
 * Archivo aislado usado solo por `nomina/historico_detalle.html`.
 * Recibe el ID por querystring, consulta WEBHOOK_NOMINA_HISTORICO_RENDERIZAR
 * y renderiza las tablas explícitas de la nómina histórica.
 */
import { buildRequestHeaders, getUserContext, listAvailableLocalContexts } from "./session.js";
import { WEBHOOK_NOMINA_HISTORICO_RENDERIZAR } from "./webhooks.js";

const tituloEl = document.getElementById("historicoNominaDetalleTitulo");
const resumenEl = document.getElementById("historicoNominaDetalleResumen");
const tablasEl = document.getElementById("historicoNominaDetalleTablas");
const statusEl = document.getElementById("historicoNominaDetalleStatus");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const money = (value) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));
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
  if (Array.isArray(parsed)) {
    return parsed.flatMap((item) => {
      const parsedItem = parseJsonLike(item);
      if (parsedItem && typeof parsedItem === "object" && !Array.isArray(parsedItem)) {
        const nested = firstArrayFromObject(parsedItem);
        if (nested) return extractRows(nested);
      }
      return [parsedItem];
    });
  }
  const nested = firstArrayFromObject(parsed);
  return nested ? extractRows(nested) : [parsed];
};
const getTablaRows = (row, name) => {
  const tablas = parseJsonLike(row?.tablas) || {};
  const direct = parseJsonLike(row?.[name]);
  const nested = parseJsonLike(tablas?.[name]);
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(nested)) return nested;
  return [];
};
const normalizeNomina = (raw) => {
  const row = parseJsonLike(raw) || {};
  const tablas = parseJsonLike(row.tablas) || {};
  return {
    ...row,
    totales: parseJsonLike(row.totales) || parseJsonLike(tablas.totales) || {},
    detalles: getTablaRows(row, "detalles").length ? getTablaRows(row, "detalles") : getTablaRows(row, "detalle"),
    ingresos: getTablaRows(row, "ingresos"),
    deducciones: getTablaRows(row, "deducciones"),
    parametros: getTablaRows(row, "parametros"),
    locales: getTablaRows(row, "locales")
  };
};

const normalizeLocal = (local = {}) => {
  const id = String(local.empresa_id || local.tenant_id || local.id || "").trim();
  const nombre = String(local.nombre || local.nombre_comercial || local.razon_social || "").trim();
  return id && nombre ? { id, nombre } : null;
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cleanName = (value) => {
  const text = String(value || "").trim();
  return text && !uuidPattern.test(text) ? text : "";
};
const resolveSedeNames = (row, locales) => {
  const direct = cleanName(row?.empresa_nombre) || cleanName(row?.sede_nombre) || cleanName(row?.local_nombre) || cleanName(row?.empresa?.nombre_comercial) || cleanName(row?.empresa?.razon_social) || cleanName(row?.locales?.[0]?.nombre);
  if (direct) return direct;
  const ids = [row?.empresa_id, row?.sede_id, row?.local_id, row?.tenant_id, ...(Array.isArray(row?.consultado) ? row.consultado : [])].map((value) => String(value || ""));
  const names = ids.map((id) => locales.find((local) => local.id === id)?.nombre || "").filter(Boolean);
  return names.length ? Array.from(new Set(names)).join(", ") : "Sede sin resolver";
};

const renderCard = (label, value) => `<div class="nomina-detail-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
const renderTable = (title, rows) => {
  if (!Array.isArray(rows) || !rows.length) return `<div class="comprobante-col"><h3>${escapeHtml(title)}</h3><p class="nomina-help">Sin datos recibidos para esta tabla.</p></div>`;
  const keys = Array.from(rows.reduce((set, item) => {
    Object.keys(item || {}).forEach((key) => set.add(key));
    return set;
  }, new Set()));
  const cell = (value) => {
    if (value && typeof value === "object") return escapeHtml(JSON.stringify(value));
    return escapeHtml(value ?? "-");
  };
  return `<div class="comprobante-col"><h3>${escapeHtml(title)}</h3><table><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead><tbody>${rows.map((item) => `<tr>${keys.map((key) => `<td>${cell(item?.[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
};
const objectToRows = (obj = {}) => Object.entries(obj || {}).map(([concepto, valor]) => ({ concepto, valor: typeof valor === "number" ? money(valor) : valor }));

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
  const ingresosTotal = row.ingresos.reduce((acc, item) => acc + Number(item.valor || item.total || 0), 0);
  const deduccionesTotal = row.deducciones.reduce((acc, item) => acc + Number(item.valor || item.total || 0), 0);
  tituloEl.textContent = `Detalle de nómina ${row.periodo || "histórica"}`;
  resumenEl.innerHTML = [
    renderCard("Fecha", formatDateLong(row.fecha)),
    renderCard("Periodo", row.periodo || "Sin periodo"),
    renderCard("Empresa / sede", resolveSedeNames(row, locales)),
    renderCard("Ingresos", money(ingresosTotal)),
    renderCard("Deducciones", money(deduccionesTotal)),
    renderCard("Neto estimado", money(ingresosTotal - deduccionesTotal))
  ].join("");
  tablasEl.innerHTML = [
    renderTable("Resumen de totales", objectToRows(row.totales)),
    renderTable("Detalle de turnos", row.detalles),
    renderTable("Ingresos", row.ingresos),
    renderTable("Deducciones", row.deducciones),
    renderTable("Parámetros de liquidación", row.parametros),
    renderTable("Locales", row.locales)
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

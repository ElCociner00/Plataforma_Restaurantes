/**
 * MANTENIMIENTO — Histórico Nómina
 * Archivo aislado usado solo por `nomina/historico.html`.
 * Conexiones: `js/webhooks.js` aporta WEBHOOK_NOMINA_HISTORICO_RENDERIZAR y
 * `js/session.js` aporta headers/tenant. Si el backend cambia la estructura,
 * ajustar únicamente los normalizadores de este archivo.
 */
import { buildRequestHeaders, getUserContext, listAvailableLocalContexts } from "./session.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { WEBHOOK_NOMINA_HISTORICO_VISTA, WEBHOOK_NOMINA_HISTORICO_RENDERIZAR, WEBHOOK_NOMINA_HISTORICO_BORRAR } from "./webhooks.js";

const empleadoInput = document.getElementById("historicoNominaEmpleado");
const desdeInput = document.getElementById("historicoNominaDesde");
const hastaInput = document.getElementById("historicoNominaHasta");
const sedeInput = document.getElementById("historicoNominaSede");
const consultarBtn = document.getElementById("consultarHistoricoNomina");
const volverBtn = document.getElementById("historicoNominaVolver");
const tbody = document.getElementById("historicoNominaBody");
const statusEl = document.getElementById("historicoNominaStatus");
const listadoPanel = document.getElementById("historicoNominaListadoPanel");
const detallePanel = document.getElementById("historicoNominaDetallePanel");
const detalleTitulo = document.getElementById("historicoNominaDetalleTitulo");
const detalleResumen = document.getElementById("historicoNominaDetalleResumen");

const state = { context: null, responsables: [], locales: [], nominas: [], detalles: new Map(), ocultasSesion: new Set() };

const setStatus = (message) => { if (statusEl) statusEl.textContent = message || ""; };
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const toIsoDate = (date) => date.toISOString().slice(0, 10);
const formatDateLong = (value) => {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "Fecha sin definir";
  return new Intl.DateTimeFormat("es-CO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
};
const money = (value) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(value || 0));

const setDefaultDates = () => {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  if (desdeInput && !desdeInput.value) desdeInput.value = toIsoDate(start);
  if (hastaInput && !hastaInput.value) hastaInput.value = toIsoDate(today);
};

const getResponsableNombre = (id) => {
  const safeId = String(id || "");
  return state.responsables.find((item) => [item.id, item.usuario_id, item.user_id, item.responsable_id, item.id_principal, item.usuario_principal_id].some((value) => String(value || "") === safeId))?.nombre_completo || "";
};
const getEmpleadoId = (row = {}) => row?.empleado_id || row?.usuario_id || row?.responsable_id || row?.responsable || row?.empleado?.id || row?.empleado?.usuario_id || row?.resumen?.empleado_id || row?.resumen?.usuario_id || row?.detalles?.find?.((item) => item?.responsable)?.responsable || row?.ingresos?.find?.((item) => item?.empleado_id)?.empleado_id || "";
const getEmpleadoNombre = (row) => row?.empleado?.nombre || row?.empleado?.nombre_completo || row?.resumen?.empleado || row?.resumen?.empleado_nombre || row?.empleado_nombre || row?.nombre_empleado || row?.responsable_nombre || getResponsableNombre(getEmpleadoId(row)) || row?.ingresos?.find?.((item) => item.empleado_nombre)?.empleado_nombre || "Responsable sin resolver";
const getRowDate = (row) => row?.fecha || row?.fecha_nomina || row?.resumen?.fecha || row?.resumen?.fecha_fin || row?.created_at || row?.updated_at || row?.fecha_fin || row?.fin || row?.detalles?.[0]?.fecha || "";

const getSedeHistorico = (row = {}) => row?.empresa_nombre || row?.sede_nombre || row?.local_nombre || row?.empresa?.nombre_comercial || row?.empresa?.razon_social || row?.resumen?.sede || row?.locales?.[0]?.nombre || row?.consultado?.[0] || row?.empresa_id || "Sede sin resolver";
const getPeriodoHistorico = (row = {}) => row?.periodo || row?.resumen?.periodo || [row?.periodo_inicio, row?.periodo_fin].filter(Boolean).join(" - ") || "Sin periodo";

const parseJsonLike = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return value;
  try { return JSON.parse(trimmed); } catch { return value; }
};

const firstArrayFromObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const preferredKeys = ["data", "nominas", "rows", "items", "result", "payload", "body", "records"];
  for (const key of preferredKeys) {
    const parsed = parseJsonLike(value[key]);
    if (Array.isArray(parsed)) return parsed;
    const nested = firstArrayFromObject(parsed);
    if (nested) return nested;
  }
  for (const item of Object.values(value)) {
    const parsed = parseJsonLike(item);
    if (Array.isArray(parsed)) return parsed;
    const nested = firstArrayFromObject(parsed);
    if (nested) return nested;
  }
  return null;
};

const getTablaRows = (row, name) => {
  const tablas = parseJsonLike(row?.tablas) || {};
  const direct = parseJsonLike(row?.[name]);
  const nested = parseJsonLike(tablas?.[name]);
  if (Array.isArray(direct)) return direct;
  if (Array.isArray(nested)) return nested;
  return [];
};

const normalizeHistoricoRow = (raw) => {
  const row = parseJsonLike(raw) || {};
  const tablas = parseJsonLike(row.tablas) || {};
  const resumen = parseJsonLike(row.resumen) || parseJsonLike(tablas.resumen) || {};
  return {
    ...row,
    resumen,
    detalles: getTablaRows(row, "detalle").length ? getTablaRows(row, "detalle") : getTablaRows(row, "detalles"),
    ingresos: getTablaRows(row, "ingresos"),
    deducciones: getTablaRows(row, "deducciones"),
    apoyos: getTablaRows(row, "apoyos"),
    parametros: getTablaRows(row, "parametros"),
    parametros_tiempo: getTablaRows(row, "parametros_tiempo"),
    parametros_calculo: getTablaRows(row, "parametros_calculo").length ? getTablaRows(row, "parametros_calculo") : (parseJsonLike(row.parametros_calculo) || parseJsonLike(tablas.parametros_calculo) || {}),
    auxiliares: parseJsonLike(row.auxiliares) || parseJsonLike(tablas.auxiliares) || {},
    locales: getTablaRows(row, "locales"),
    tipo_filas: getTablaRows(row, "tipo_filas"),
    deducciones_ley: getTablaRows(row, "deducciones_ley")
  };
};

const normalizeHistoricoRows = (payload) => {
  const parsed = parseJsonLike(payload);
  const rows = Array.isArray(parsed) ? parsed : firstArrayFromObject(parsed) || [];
  return rows.map(normalizeHistoricoRow).filter((row) => row && typeof row === "object");
};

const normalizeResponsablesPayload = (rows) => rows.map((item) => ({ id: String(item?.id || ""), nombre_completo: item?.nombre_completo || item?.nombre || item?.empleado_nombre || item?.id || "Responsable" })).filter((item) => item.id);

const cargarResponsables = async () => {
  const empresaId = state.context?.empresa_id || "";
  state.responsables = normalizeResponsablesPayload(await fetchResponsablesActivos(empresaId).catch(() => []));
  if (!empleadoInput || empleadoInput.tagName !== "SELECT") return;
  empleadoInput.innerHTML = '<option value="">Todos los responsables</option>';
  state.responsables.forEach((item) => {
    const option = document.createElement("option");
    option.value = item.id;
    option.textContent = item.nombre_completo;
    empleadoInput.appendChild(option);
  });
};

const normalizeSedeOption = (local = {}) => {
  const id = String(local.empresa_id || local.tenant_id || local.id || "").trim();
  const nombre = String(local.nombre || local.nombre_comercial || local.razon_social || id || "Sede").trim();
  return id ? { id, nombre } : null;
};

const cargarSedes = async () => {
  state.locales = (await listAvailableLocalContexts().catch(() => []))
    .map(normalizeSedeOption)
    .filter(Boolean);
  if (!state.locales.length && state.context?.empresa_id) {
    state.locales = [{ id: state.context.empresa_id, nombre: "Sede actual" }];
  }
  if (!sedeInput || sedeInput.tagName !== "SELECT") return;
  sedeInput.innerHTML = '<option value="">Todas las sedes</option>';
  state.locales.forEach((local) => {
    const option = document.createElement("option");
    option.value = local.id;
    option.textContent = local.nombre;
    sedeInput.appendChild(option);
  });
};

const buildHistoricoVistaPayload = () => ({
  empresa_id: state.context?.empresa_id || "",
  tenant_id: state.context?.empresa_id || "",
  entorno: state.context?.entorno || state.context?.environment || "",
  origen: "nomina_historico_vista"
});

const buildHistoricoRequestPayload = () => ({
  ...buildHistoricoVistaPayload(),
  responsable_id: empleadoInput?.value || "",
  empleado_id: empleadoInput?.value || "",
  usuario_id: empleadoInput?.value || "",
  empleado: empleadoInput?.value || "",
  fecha_inicio: desdeInput?.value || "",
  fecha_fin: hastaInput?.value || "",
  sede: sedeInput?.value || "",
  sede_id: sedeInput?.value || "",
  local_id: sedeInput?.value || ""
});

const filterHistoricoRows = (rows) => rows.filter((row) => {
  const rowDate = getRowDate(row).slice(0, 10);
  const responsable = String(getEmpleadoId(row) || "");
  if (desdeInput?.value && rowDate && rowDate < desdeInput.value) return false;
  if (hastaInput?.value && rowDate && rowDate > hastaInput.value) return false;
  if (empleadoInput?.value && responsable && responsable !== empleadoInput.value) return false;
  if (sedeInput?.value) {
    const selected = String(sedeInput.value);
    const sedeValues = [row?.empresa_id, row?.sede, row?.sede_id, row?.local_id, row?.tenant_id, row?.locales?.[0]?.empresa_id, row?.locales?.[0]?.tenant_id].map((value) => String(value || ""));
    if (!sedeValues.includes(selected)) return false;
  }
  return true;
});

const renderHistoricoRows = (rows) => {
  if (!tbody) return;
  const filtered = filterHistoricoRows(rows).filter((row) => !state.ocultasSesion.has(String(row.id || "")));
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin nóminas históricas para los filtros seleccionados.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map((row) => { const originalIndex = state.nominas.indexOf(row); return `<tr class="nomina-historico-row" data-nomina-index="${originalIndex}" data-nomina-id="${escapeHtml(row.id || "")}"><td>${escapeHtml(formatDateLong(getRowDate(row)))}</td><td>${escapeHtml(getEmpleadoNombre(row))}</td><td>${escapeHtml(getSedeHistorico(row))}</td><td>${escapeHtml(getPeriodoHistorico(row))}</td><td><button type="button" class="nomina-historico-delete" data-delete-id="${escapeHtml(row.id || "")}">Borrar</button></td></tr>`; }).join("");
};


const renderGenericTable = (title, rows) => {
  if (!Array.isArray(rows) || !rows.length) return "";
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

const renderDetalle = async (row) => {
  if (!row || !listadoPanel || !detallePanel) return;
  row = await consultarDetalleHistorico(row);
  const detalles = Array.isArray(row.detalles) ? row.detalles : [];
  const ingresos = Array.isArray(row.ingresos) ? row.ingresos : [];
  const deducciones = Array.isArray(row.deducciones) ? row.deducciones : [];
  detalleTitulo.textContent = `Nómina de ${getEmpleadoNombre(row)}`;
  const totalIngresos = ingresos.reduce((acc, item) => acc + Number(item.valor || item.total || item.valor_empleado || 0), 0);
  const totalDeducciones = deducciones.reduce((acc, item) => acc + Number(item.valor || item.total || item.valor_empleado || 0), 0);
  detalleResumen.innerHTML = `
    <div class="nomina-detail-card"><span>Fecha</span><strong>${escapeHtml(formatDateLong(getRowDate(row)))}</strong></div>
    <div class="nomina-detail-card"><span>Responsable</span><strong>${escapeHtml(getEmpleadoNombre(row))}</strong></div>
    <div class="nomina-detail-card"><span>Periodo</span><strong>${escapeHtml(getPeriodoHistorico(row))}</strong></div>
    <div class="nomina-detail-card"><span>Ingresos</span><strong>${escapeHtml(money(totalIngresos))}</strong></div>
    <div class="nomina-detail-card"><span>Deducciones</span><strong>${escapeHtml(money(totalDeducciones))}</strong></div>
    <div class="nomina-detail-card"><span>Neto</span><strong>${escapeHtml(money(row.resumen?.neto || row.neto || (totalIngresos - totalDeducciones)))}</strong></div>
    <div class="comprobante-table nomina-wide-panel">
      ${renderGenericTable("Ingresos", ingresos)}
      ${renderGenericTable("Deducciones", deducciones)}
      ${renderGenericTable("Detalles recibidos", detalles)}
      ${renderGenericTable("Locales", row.locales)}
      ${renderGenericTable("Tipos de filas", row.tipo_filas)}
      ${renderGenericTable("Apoyos", row.apoyos)}
      ${renderGenericTable("Parametros", row.parametros)}
      ${renderGenericTable("Parametros tiempo", row.parametros_tiempo)}
      ${renderGenericTable("Parametros calculo", Array.isArray(row.parametros_calculo) ? row.parametros_calculo : Object.entries(row.parametros_calculo || {}).map(([parametro, match]) => ({ parametro, match })))}
      ${renderGenericTable("Deducciones de ley", row.deducciones_ley)}
    </div>`;
  listadoPanel.hidden = true;
  detallePanel.hidden = false;
};

const borrarNominaHistorica = async (row) => {
  if (!row?.id) return setStatus("La nómina seleccionada no tiene ID para borrar.");
  setStatus("Solicitando borrado de nómina histórica...");
  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const payload = { empresa_id: state.context?.empresa_id || "", tenant_id: state.context?.empresa_id || "", nomina_id: row.id, id: row.id, empleado_id: getEmpleadoId(row), fecha: getRowDate(row) };
    const response = await fetch(WEBHOOK_NOMINA_HISTORICO_BORRAR, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.ocultasSesion.add(String(row.id));
    renderHistoricoRows(state.nominas);
    setStatus("Nómina ocultada en esta sesión y solicitud de borrado enviada al webhook.");
  } catch (error) {
    setStatus(`No fue posible solicitar el borrado (${error.message || "sin detalle"}). Verifica ${WEBHOOK_NOMINA_HISTORICO_BORRAR}.`);
  }
};

const consultarDetalleHistorico = async (row) => {
  const id = String(row?.id || "");
  if (!id) return row;
  if (state.detalles.has(id)) return state.detalles.get(id);
  setStatus("Consultando detalle completo de nómina histórica...");
  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const payload = { ...buildHistoricoRequestPayload(), id, nomina_id: id, row_id: id };
    const response = await fetch(WEBHOOK_NOMINA_HISTORICO_RENDERIZAR, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const [detalle] = normalizeHistoricoRows(await response.json().catch(() => null));
    const merged = normalizeHistoricoRow({ ...row, ...(detalle || {}) });
    state.detalles.set(id, merged);
    setStatus("Detalle histórico consultado correctamente.");
    return merged;
  } catch (error) {
    setStatus(`No fue posible consultar el detalle (${error.message || "sin detalle"}). Se muestra la vista resumida.`);
    return row;
  }
};

const consultarHistoricoNomina = async () => {
  setStatus("Consultando histórico de nómina...");
  try {
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOK_NOMINA_HISTORICO_VISTA, { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders }, body: JSON.stringify(buildHistoricoVistaPayload()) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.nominas = normalizeHistoricoRows(await response.json().catch(() => null));
    renderHistoricoRows(state.nominas);
    setStatus(`Histórico consultado. ${state.nominas.length} nómina(s) recibida(s).`);
  } catch (error) {
    state.nominas = [];
    renderHistoricoRows([]);
    setStatus(`No fue posible consultar el histórico (${error.message || "sin detalle"}). Verifica el webhook ${WEBHOOK_NOMINA_HISTORICO_VISTA}.`);
  }
};

const init = async () => {
  setDefaultDates();
  state.context = await getUserContext().catch(() => null);
  await cargarResponsables();
  await cargarSedes();
  consultarBtn?.addEventListener("click", () => { renderHistoricoRows(state.nominas); setStatus(`Filtros aplicados. ${filterHistoricoRows(state.nominas).length} nómina(s) visibles.`); });
  tbody?.addEventListener("click", (event) => {
    const rowEl = event.target.closest("tr[data-nomina-id]");
    if (!rowEl) return;
    const row = state.nominas[Number(rowEl.dataset.nominaIndex)] || state.nominas.find((item) => String(item.id || "") === rowEl.dataset.nominaId);
    if (event.target.closest(".nomina-historico-delete")) { borrarNominaHistorica(row); return; }
    renderDetalle(row);
  });
  volverBtn?.addEventListener("click", () => { detallePanel.hidden = true; listadoPanel.hidden = false; });
  consultarHistoricoNomina();
};

init();

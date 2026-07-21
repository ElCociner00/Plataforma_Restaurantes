/**
 * MANTENIMIENTO — Histórico Nómina
 * Archivo aislado usado solo por `nomina/historico.html`.
 * Conexiones: `js/webhooks.js` aporta WEBHOOK_NOMINA_HISTORICO_RENDERIZAR y
 * `js/session.js` aporta headers/tenant. Si el backend cambia la estructura,
 * ajustar únicamente `normalizeHistoricoRows()` y `renderHistoricoRows()`.
 */
import { buildRequestHeaders, getUserContext } from "./session.js";
import { WEBHOOK_NOMINA_HISTORICO_RENDERIZAR } from "./webhooks.js";

const empleadoInput = document.getElementById("historicoNominaEmpleado");
const desdeInput = document.getElementById("historicoNominaDesde");
const hastaInput = document.getElementById("historicoNominaHasta");
const sedeInput = document.getElementById("historicoNominaSede");
const consultarBtn = document.getElementById("consultarHistoricoNomina");
const tbody = document.getElementById("historicoNominaBody");
const statusEl = document.getElementById("historicoNominaStatus");

// MANTENIMIENTO UI: actualizar mensajes del submódulo histórico sin tocar HTML.
const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

// MANTENIMIENTO FECHAS: rango por defecto para probar el webhook de histórico.
const toIsoDate = (date) => date.toISOString().slice(0, 10);
const setDefaultDates = () => {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 30);
  if (desdeInput && !desdeInput.value) desdeInput.value = toIsoDate(start);
  if (hastaInput && !hastaInput.value) hastaInput.value = toIsoDate(today);
};

// MANTENIMIENTO PAYLOAD: campos enviados al webhook vacío de BD/n8n para listar nóminas.
const buildHistoricoRequestPayload = async () => {
  const context = await getUserContext().catch(() => null);
  return {
    empresa_id: context?.empresa_id || "",
    tenant_id: context?.empresa_id || "",
    empleado: empleadoInput?.value?.trim() || "",
    fecha_inicio: desdeInput?.value || "",
    fecha_fin: hastaInput?.value || "",
    sede: sedeInput?.value?.trim() || ""
  };
};

// MANTENIMIENTO NORMALIZACIÓN: adaptar aquí cuando el webhook devuelva otra estructura.
const normalizeHistoricoRows = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.nominas)) return payload.nominas;
  if (Array.isArray(payload?.rows)) return payload.rows;
  return [];
};

// MANTENIMIENTO RENDER: columnas visibles del histórico; conecta con `nomina/historico.html` tbody.
const renderHistoricoRows = (rows) => {
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5">Sin nóminas históricas para los filtros seleccionados.</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((row, index) => {
    const periodo = row.periodo || `${row.fecha_inicio || row.inicio || "-"} - ${row.fecha_fin || row.fin || "-"}`;
    const empleado = row.empleado?.nombre || row.empleado_nombre || row.nombre_empleado || row.responsable || "-";
    const sedes = Array.isArray(row.sedes) ? row.sedes.map((sede) => sede.nombre || sede.sede_nombre || sede.tenant_id || sede).join(", ") : (row.sede_nombre || row.sede || "-");
    const estado = row.estado || row.status || "Guardada";
    return `<tr><td><input type="radio" name="historicoNominaSeleccion" value="${row.id || index}"></td><td>${periodo}</td><td>${empleado}</td><td>${sedes}</td><td>${estado}</td></tr>`;
  }).join("");
};

// MANTENIMIENTO CONSULTA: auto-carga al abrir y click manual; si falla, no rompe la página.
const consultarHistoricoNomina = async () => {
  setStatus("Consultando histórico de nómina...");
  try {
    const payload = await buildHistoricoRequestPayload();
    const authHeaders = await buildRequestHeaders({ includeTenant: true });
    const response = await fetch(WEBHOOK_NOMINA_HISTORICO_RENDERIZAR, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json().catch(() => null);
    const rows = normalizeHistoricoRows(data);
    renderHistoricoRows(rows);
    setStatus(`Histórico consultado. ${rows.length} nómina(s) recibida(s).`);
  } catch (error) {
    renderHistoricoRows([]);
    setStatus(`No fue posible consultar el histórico todavía (${error.message || "sin detalle"}). Verifica el webhook ${WEBHOOK_NOMINA_HISTORICO_RENDERIZAR}.`);
  }
};

setDefaultDates();
consultarBtn?.addEventListener("click", consultarHistoricoNomina);
consultarHistoricoNomina();

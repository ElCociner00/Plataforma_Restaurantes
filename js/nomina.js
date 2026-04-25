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
import { getUserContext } from "./session.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { getActiveEnvironment } from "./environment.js";
import { supabase } from "./supabase.js";
import { WEBHOOK_NOMINA_CONSULTAR } from "./webhooks.js";
import { drawPngBrandWatermark } from "./png_branding.js";

const fechaInicioInput = document.getElementById("nominaFechaInicio");
const fechaFinInput = document.getElementById("nominaFechaFin");
const corteSelect = document.getElementById("nominaCorte");
const empleadoSelect = document.getElementById("nominaEmpleado");
const consultarBtn = document.getElementById("consultarNomina");
const descargarBtn = document.getElementById("descargarComprobanteNomina");

const totalDevengadoEl = document.getElementById("nominaTotalDevengado");
const totalDeduccionesEl = document.getElementById("nominaTotalDeducciones");
const totalNetoEl = document.getElementById("nominaTotalNeto");
const statusEl = document.getElementById("nominaStatus");

const empresaNombreEl = document.getElementById("nominaEmpresaNombre");
const empresaNitEl = document.getElementById("nominaEmpresaNit");
const empleadoDataEl = document.getElementById("nominaEmpleadoData");
const ingresosBody = document.getElementById("nominaIngresosBody");
const deduccionesBody = document.getElementById("nominaDeduccionesBody");
const totalIngresosTablaEl = document.getElementById("nominaTotalIngresosTabla");
const totalDeduccionesTablaEl = document.getElementById("nominaTotalDeduccionesTabla");
const netoPagarEl = document.getElementById("nominaNetoPagarComprobante");

const state = {
  context: null,
  responsables: [],
  empresa: null,
  movimientos: [],
  empleadoDetalle: null,
  periodoDetalle: null
};

const fmtMoney = (value) => Number(value || 0).toLocaleString("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const setDefaultDates = () => {
  corteSelect.value = "quincenal";
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
  const cut = corteSelect.value || "quincenal";
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
  if (!state.movimientos.length) {
    ingresosBody.innerHTML = "<tr><td>Sin ingresos</td><td>0</td><td>$0</td></tr>";
    deduccionesBody.innerHTML = "<tr><td>Sin deducciones</td><td>0</td><td>$0</td></tr>";
    renderResumen();
    return;
  }

  const ingresos = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("devengo"));
  const deducciones = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("dedu"));

  ingresosBody.innerHTML = (ingresos.length ? ingresos : [{ tipo: "Sin ingresos", valor: 0 }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>1</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");
  deduccionesBody.innerHTML = (deducciones.length ? deducciones : [{ tipo: "Sin deducciones", valor: 0 }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>1</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");

  renderResumen();
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

const normalizeNominaWebhookRows = (payload, empleadoSeleccionado = null) => {
  const fromPrototypePayload = (candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const hasPrototype = candidate?.empleado && candidate?.periodo && candidate?.detalle_horas;
    if (!hasPrototype) return null;

    const horas = Object.entries(candidate.detalle_horas || {}).map(([tipo, value]) => ({
      tipo: `Horas ${tipo.replaceAll("_", " ")}`,
      naturaleza: "Devengo",
      valor: Number(value?.total || 0),
      fuente: "webhook",
      metadata: { horas: Number(value?.horas || 0), valor_unitario: Number(value?.valor_unitario || 0) },
      created_at: new Date().toISOString()
    }));

    const ingresosExtra = [
      { key: "auxilio_transporte", label: "Auxilio de transporte" },
      { key: "propinas", label: "Propinas" }
    ].map((item) => ({
      tipo: item.label,
      naturaleza: "Devengo",
      valor: Number(candidate?.[item.key] || 0),
      fuente: "webhook",
      metadata: null,
      created_at: new Date().toISOString()
    })).filter((item) => item.valor > 0);

    const descuentos = (Array.isArray(candidate?.descuentos) ? candidate.descuentos : []).map((item) => ({
      tipo: item?.concepto || "Descuento",
      naturaleza: "Deducción",
      valor: Number(item?.monto || 0),
      fuente: "webhook",
      metadata: null,
      created_at: new Date().toISOString()
    }));

    const diferenciaCaja = Number(candidate?.diferencias_caja || 0);
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

  const fromPrototype = fromPrototypePayload(payload);
  if (fromPrototype) return fromPrototype;

  const pickRows = (candidate) => {
    if (Array.isArray(candidate)) return candidate;
    if (Array.isArray(candidate?.data)) return candidate.data;
    if (Array.isArray(candidate?.items)) return candidate.items;
    if (Array.isArray(candidate?.movimientos)) return candidate.movimientos;
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
  return rows.map((item) => ({
    tipo: item?.tipo || item?.concepto || "-",
    naturaleza: item?.naturaleza || item?.categoria || "-",
    valor: Number(item?.valor || item?.monto || 0),
    fuente: item?.fuente || item?.origen || "webhook",
    metadata: item?.metadata || null,
    created_at: item?.created_at || item?.fecha || new Date().toISOString()
  }));
};

const consultarNomina = async () => {
  const empleadoId = empleadoSelect.value;
  if (!empleadoId) {
    setStatus("Selecciona un empleado para consultar su nómina.");
    return;
  }

  setStatus("Consultando movimientos de nómina...");
  const payload = {
    empresa_id: state.context.empresa_id,
    usuario_id: empleadoId,
    fecha_inicio: fechaInicioInput.value,
    fecha_fin: fechaFinInput.value,
    corte: corteSelect.value || "quincenal",
    entorno: getActiveEnvironment() || "global"
  };

  let rows = [];

  try {
    const response = await fetch(WEBHOOK_NOMINA_CONSULTAR, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const webhookData = await response.json().catch(() => []);
    rows = normalizeNominaWebhookRows(webhookData, state.responsables.find((item) => item.id === empleadoId));
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
    state.empleadoDetalle = null;
    state.periodoDetalle = null;
  }

  const empleado = state.responsables.find((item) => item.id === empleadoId);
  state.movimientos = rows.map((item) => ({
    ...item,
    empleado_nombre: empleado?.nombre_completo || "Empleado",
    estado: "Liquidable"
  }));

  renderMovimientos();
  renderComprobanteHeader(empleado);
  setStatus(`Consulta completada. ${state.movimientos.length} movimientos encontrados en ${getActiveEnvironment() || "global"}.`);
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
    .select("nombre_comercial,nit")
    .eq("id", state.context.empresa_id)
    .maybeSingle();
  state.empresa = empresa || null;
  empresaInput.value = state.empresa?.nombre_comercial || "";
  empresaNombreEl.textContent = state.empresa?.nombre_comercial || "EMPRESA";
  empresaNitEl.textContent = `NIT ${state.empresa?.nit || "-"}`;
  renderMovimientos();
  renderComprobanteHeader(null);
};

consultarBtn?.addEventListener("click", consultarNomina);
descargarBtn?.addEventListener("click", descargarComprobante);
corteSelect?.addEventListener("change", updateDatesByCut);
fechaInicioInput?.addEventListener("change", clampDatesToToday);
fechaFinInput?.addEventListener("change", clampDatesToToday);

init();

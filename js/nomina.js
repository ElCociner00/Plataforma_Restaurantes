import { getUserContext } from "./session.js";
import { fetchResponsablesActivos } from "./responsables.js";
import { getActiveEnvironment } from "./environment.js";
import { supabase } from "./supabase.js";

const empresaInput = document.getElementById("nominaEmpresa");
const fechaInicioInput = document.getElementById("nominaFechaInicio");
const fechaFinInput = document.getElementById("nominaFechaFin");
const corteSelect = document.getElementById("nominaCorte");
const empleadoSelect = document.getElementById("nominaEmpleado");
const consultarBtn = document.getElementById("consultarNomina");
const descargarBtn = document.getElementById("descargarComprobanteNomina");

const totalDevengadoEl = document.getElementById("nominaTotalDevengado");
const totalDeduccionesEl = document.getElementById("nominaTotalDeducciones");
const totalNetoEl = document.getElementById("nominaTotalNeto");
const movimientosBody = document.getElementById("nominaMovimientosBody");
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
  movimientos: []
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
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), 15);
  fechaInicioInput.value = start.toISOString().slice(0, 10);
  fechaFinInput.value = end.toISOString().slice(0, 10);
  corteSelect.value = "quincenal";
};

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
    movimientosBody.innerHTML = "<tr><td colspan='6'>No hay movimientos para este período y empleado.</td></tr>";
    ingresosBody.innerHTML = "<tr><td>Sin ingresos</td><td>0</td><td>$0</td></tr>";
    deduccionesBody.innerHTML = "<tr><td>Sin deducciones</td><td>0</td><td>$0</td></tr>";
    renderResumen();
    return;
  }

  movimientosBody.innerHTML = state.movimientos.map((item) => `
    <tr>
      <td>${item.empleado_nombre || "-"}</td>
      <td>${item.tipo || "-"}</td>
      <td>${item.naturaleza || "-"}</td>
      <td>${fmtMoney(item.valor)}</td>
      <td>${item.fuente || "-"}</td>
      <td>${item.estado || "Registrado"}</td>
    </tr>
  `).join("");

  const ingresos = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("devengo"));
  const deducciones = state.movimientos.filter((item) => String(item.naturaleza || "").toLowerCase().includes("dedu"));

  ingresosBody.innerHTML = (ingresos.length ? ingresos : [{ tipo: "Sin ingresos", valor: 0 }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>1</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");
  deduccionesBody.innerHTML = (deducciones.length ? deducciones : [{ tipo: "Sin deducciones", valor: 0 }])
    .map((item) => `<tr><td>${item.tipo || "-"}</td><td>1</td><td>${fmtMoney(item.valor || 0)}</td></tr>`).join("");

  renderResumen();
};

const renderComprobanteHeader = (empleado) => {
  const periodo = `${fechaInicioInput.value || "-"} - ${fechaFinInput.value || "-"}`;
  const comprobanteNumero = `NOM-${(Date.now()).toString().slice(-6)}`;
  const salarioBase = state.movimientos
    .filter((item) => String(item.tipo || "").toLowerCase().includes("base"))
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  empleadoDataEl.innerHTML = `
    <div>Periodo de Pago: ${periodo}</div>
    <div>Comprobante Número: ${comprobanteNumero}</div>
    <div><strong>Nombre: ${empleado?.nombre_completo || "-"}</strong></div>
    <div>Identificación: ${empleado?.cedula || "-"}</div>
    <div>Cargo: ${empleado?.rol || "operativo"}</div>
    <div>Salario básico: ${fmtMoney(salarioBase)}</div>
  `;
};

const consultarNomina = async () => {
  const empleadoId = empleadoSelect.value;
  if (!empleadoId) {
    setStatus("Selecciona un empleado para consultar su nómina.");
    return;
  }

  setStatus("Consultando movimientos de nómina...");
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

  const empleado = state.responsables.find((item) => item.id === empleadoId);
  state.movimientos = (Array.isArray(data) ? data : []).map((item) => ({
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
  const rightX = 1040;
  let y = 140;
  ctx.font = "bold 24px Arial";
  ctx.fillText(state.empresa?.nombre_comercial || "EMPRESA", leftX, y);
  y += 36;
  ctx.font = "20px Arial";
  ctx.fillText(`NIT ${state.empresa?.nit || "-"}`, leftX, y);

  let ry = 140;
  const periodo = `${fechaInicioInput.value || "-"} - ${fechaFinInput.value || "-"}`;
  const lines = [
    `Periodo de Pago: ${periodo}`,
    `Comprobante Número: NOM-${Date.now().toString().slice(-6)}`,
    `Nombre: ${empleado.nombre_completo || "-"}`,
    `Identificación: ${empleado.cedula || "-"}`,
    `Cargo: ${empleado.rol || "operativo"}`,
    `Salario básico: ${fmtMoney(ingresos.filter((i) => String(i.tipo || "").toLowerCase().includes("base")).reduce((a, i) => a + Number(i.valor || 0), 0))}`
  ];
  lines.forEach((line, index) => {
    ctx.font = index === 2 ? "bold 22px Arial" : "20px Arial";
    ctx.fillText(line, rightX, ry);
    ry += 34;
  });

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
  ctx.fillText("Este comprobante fue generado por AXIOMA.", 70, 1030);

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

  empresaInput.value = state.context.empresa_id;
  state.responsables = await fetchResponsablesActivos(state.context.empresa_id).catch(() => []);
  renderEmpleadoOptions();

  const { data: empresa } = await supabase
    .from("empresas")
    .select("nombre_comercial,nit")
    .eq("id", state.context.empresa_id)
    .maybeSingle();
  state.empresa = empresa || null;
  empresaNombreEl.textContent = state.empresa?.nombre_comercial || "EMPRESA";
  empresaNitEl.textContent = `NIT ${state.empresa?.nit || "-"}`;
  renderMovimientos();
  setStatus(`Módulo de nómina listo en modo compartido (${getActiveEnvironment() || "global"}).`);
};

consultarBtn?.addEventListener("click", consultarNomina);
descargarBtn?.addEventListener("click", descargarComprobante);

init();

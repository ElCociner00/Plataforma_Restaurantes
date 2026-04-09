import { getUserContext } from "./session.js";

const empresaInput = document.getElementById("nominaEmpresa");
const fechaInicioInput = document.getElementById("nominaFechaInicio");
const fechaFinInput = document.getElementById("nominaFechaFin");
const corteSelect = document.getElementById("nominaCorte");

const totalDevengadoEl = document.getElementById("nominaTotalDevengado");
const totalDeduccionesEl = document.getElementById("nominaTotalDeducciones");
const totalNetoEl = document.getElementById("nominaTotalNeto");

const movimientosBody = document.getElementById("nominaMovimientosBody");
const statusEl = document.getElementById("nominaStatus");

const fmtMoney = (value) => Number(value || 0).toLocaleString("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0
});

const demoMovimientos = [
  { empleado: "Operario A", tipo: "Base", naturaleza: "Devengo", valor: 950000, fuente: "Sistema", estado: "Pendiente" },
  { empleado: "Operario A", tipo: "Propina", naturaleza: "Devengo", valor: 180000, fuente: "Cierre turno", estado: "Pendiente" },
  { empleado: "Operario A", tipo: "Faltante inventario", naturaleza: "Deducción", valor: 30000, fuente: "Inventarios", estado: "Pendiente" },
  { empleado: "Operario B", tipo: "Bono apoyo", naturaleza: "Devengo", valor: 10500, fuente: "Apoyos", estado: "Pendiente" }
];

const renderResumen = () => {
  const devengado = demoMovimientos
    .filter((item) => item.naturaleza === "Devengo")
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);
  const deducciones = demoMovimientos
    .filter((item) => item.naturaleza === "Deducción")
    .reduce((acc, item) => acc + Number(item.valor || 0), 0);

  if (totalDevengadoEl) totalDevengadoEl.textContent = fmtMoney(devengado);
  if (totalDeduccionesEl) totalDeduccionesEl.textContent = fmtMoney(deducciones);
  if (totalNetoEl) totalNetoEl.textContent = fmtMoney(devengado - deducciones);
};

const renderMovimientos = () => {
  if (!movimientosBody) return;
  movimientosBody.innerHTML = demoMovimientos.map((item) => `
    <tr>
      <td>${item.empleado}</td>
      <td>${item.tipo}</td>
      <td>${item.naturaleza}</td>
      <td>${fmtMoney(item.valor)}</td>
      <td>${item.fuente}</td>
      <td>${item.estado}</td>
    </tr>
  `).join("");
};

const setDefaultDates = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month, 15);
  fechaInicioInput.value = start.toISOString().slice(0, 10);
  fechaFinInput.value = end.toISOString().slice(0, 10);
  corteSelect.value = "quincenal";
};

const init = async () => {
  setDefaultDates();
  renderResumen();
  renderMovimientos();

  const ctx = await getUserContext().catch(() => null);
  if (!ctx?.empresa_id) {
    statusEl.textContent = "No se pudo resolver la empresa activa para este módulo.";
    return;
  }

  empresaInput.value = ctx.empresa_id;
  statusEl.textContent = "Módulo nómina disponible en modo borrador funcional. Próximo paso: conectar tablas y workflows n8n.";
};

init();

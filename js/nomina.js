import { getUserContext } from "./session.js";

const payloadPreview = document.getElementById("payloadNominaPreview");
const checklistEl = document.getElementById("nominaChecklist");
const statusEl = document.getElementById("nominaStatus");

const payloadEjemplo = {
  empresa_id: "<UUID_EMPRESA>",
  periodo: {
    fecha_inicio: "2026-04-01",
    fecha_fin: "2026-04-15",
    corte: "quincenal"
  },
  empleado_id: "<UUID_USUARIO>",
  entradas: {
    salario_base_proporcional: 950000,
    horas_extras_valor: 120000,
    propinas_valor: 180000,
    bonos_apoyo_valor: 50000
  },
  descuentos: {
    inventario_valor: 30000,
    otros_descuentos_valor: 10000
  },
  reglas: {
    porcentaje_descuento_fallas: 100,
    reconocimiento_apoyo_por_hora: 7000
  },
  neto_estimado: 1260000,
  fuentes: {
    cierres_turno: ["<id_cierre_1>", "<id_cierre_2>"],
    cierres_inventario: ["<id_inv_1>"],
    apoyos_turno: ["<id_apoyo_1>"]
  }
};

const checklist = [
  "Crear tablas SQL del módulo nómina (004_nomina_core.sql).",
  "Insertar datos de prueba para empresa test (005_nomina_seed_test.sql).",
  "Crear workflow n8n: consolidación de movimientos y desprendible.",
  "Crear UI final de liquidación y aprobación por periodo."
];

const render = async () => {
  payloadPreview.textContent = JSON.stringify(payloadEjemplo, null, 2);
  checklistEl.innerHTML = checklist.map((item) => `<li>${item}</li>`).join("");

  const ctx = await getUserContext().catch(() => null);
  if (!ctx?.empresa_id) {
    statusEl.textContent = "No se pudo resolver la empresa activa para esta sesión.";
    return;
  }

  statusEl.textContent = `Empresa activa detectada: ${ctx.empresa_id}. Este módulo está en fase borrador y listo para conectarse a BD.`;
};

render();

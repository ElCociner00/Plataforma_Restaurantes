/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/apoyos.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `asInt` (línea aprox. 5): Bloque funcional del módulo.
 * - `toMinutes` (línea aprox. 11): Bloque funcional del módulo.
 * - `normalizeRange` (línea aprox. 17): Bloque funcional del módulo.
 * - `normalizeResponseData` (línea aprox. 25): Bloque funcional del módulo.
 * - `roundToNearest` (línea aprox. 36): Bloque funcional del módulo.
 * - `distributeByTimeline` (línea aprox. 41): Bloque funcional del módulo.
 * - `getApoyoRows` (línea aprox. 151): Obtiene un valor o recurso.
 * - `ensureReadonlyApoyoPropinas` (línea aprox. 153): Bloque funcional del módulo.
 * - `reset` (línea aprox. 163): Restablece estado.
 * - `buildConsultaPayload` (línea aprox. 168): Construye estructuras de datos.
 * - `applyDistribucion` (línea aprox. 183): Aplica reglas o cambios.
 * - `notifyResetIfNeeded` (línea aprox. 260): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
const WEBHOOK_CONSULTAR_PROPINA_APOYO = "https://n8n.enkrato.com/webhook/consultar_propina_apoyo";

const asInt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
};

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return (h * 60) + m;
};

const normalizeRange = (start, end) => {
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s == null || e == null) return null;
  const safeEnd = e >= s ? e : e + (24 * 60);
  return { start: s, end: safeEnd };
};

const normalizeResponseData = (payload) => {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    const first = payload[0];
    if (Array.isArray(first?.data)) return first.data;
    return payload;
  }
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
};

const parseWebhookDetalleRows = (webhookPayload) => {
  const normalized = normalizeResponseData(webhookPayload);
  const sourceRows = [];

  normalized.forEach((row) => {
    if (Array.isArray(row?.detalles)) {
      row.detalles.forEach((detalle) => sourceRows.push(detalle));
      return;
    }
    sourceRows.push(row);
  });

  return sourceRows
    .map((row) => {
      const tipo = String(row?.tipo || '').toLowerCase();
      const id = String(row?.id || row?.apoyo_responsable_id || '');
      const propina = asInt(row?.propina_correspondiente ?? row?.total_propina_periodo);
      return { id, tipo, propina };
    })
    .filter((row) => row.id);
};

const extractWebhookTotals = (webhookPayload) => {
  const normalized = normalizeResponseData(webhookPayload);
  let totalDia = 0;
  let totalDistribuida = 0;

  normalized.forEach((row) => {
    totalDia = Math.max(totalDia, asInt(row?.total_propina_dia));
    totalDistribuida = Math.max(totalDistribuida, asInt(row?.total_propina_distribuida));
  });

  return { totalDia, totalDistribuida };
};

export function initApoyosPropinaManager({
  apoyoHubo,
  apoyoCantidad,
  apoyoRowsContainer,
  propinaInput,
  btnConsultarPropina,
  noteEl,
  setStatus,
  getContextPayload,
  buildApoyoPayload,
  validateApoyoRows,
  marcarComoNoVerificado
}) {
  if (!btnConsultarPropina || !apoyoRowsContainer || !propinaInput) {
    return { reset: () => {} };
  }

  let repartoActivo = false;

  const getApoyoRows = () => Array.from(apoyoRowsContainer.querySelectorAll(".apoyo-row"));

  const ensureReadonlyApoyoPropinas = () => {
    getApoyoRows().forEach((row) => {
      const input = row.querySelector('[data-field="propina"]');
      if (!input) return;
      input.readOnly = true;
      input.setAttribute("readonly", "readonly");
      input.title = "Propina calculada automáticamente desde consulta de apoyos";
    });
  };

  const reset = () => {
    repartoActivo = false;
    ensureReadonlyApoyoPropinas();
  };

  const buildConsultaPayload = async () => {
    const context = await getContextPayload();
    if (!context) return null;

    const apoyo = buildApoyoPayload(context);

    return {
      empresa_id: context.empresa_id,
      usuario_id: context.usuario_id,
      rol: context.rol,
      timestamp: context.timestamp,
      apoyo
    };
  };

  const applyDistribucion = ({ consultaPayload, webhookPayload }) => {
    const apoyo = consultaPayload?.apoyo || {};
    const responsableId = String(apoyo?.responsable_turno_id || "");
    const detalleRows = parseWebhookDetalleRows(webhookPayload);
    const { totalDia, totalDistribuida } = extractWebhookTotals(webhookPayload);

    const tipsById = new Map(detalleRows.map((row) => [row.id, row.propina]));
    const responsableRow = detalleRows.find((row) => row.tipo === "responsable" && (!responsableId || row.id === responsableId));

    getApoyoRows().forEach((row) => {
      const apoyoId = String(row.querySelector('[data-field="responsable"]')?.value || "");
      const input = row.querySelector('[data-field="propina"]');
      if (!input) return;
      input.value = String(asInt(tipsById.get(apoyoId) || 0));
    });

    const responsableTip = asInt(responsableRow?.propina ?? tipsById.get(responsableId) ?? 0);
    propinaInput.value = String(responsableTip);

    ensureReadonlyApoyoPropinas();
    repartoActivo = true;
    marcarComoNoVerificado();

    const supportTotal = getApoyoRows().reduce((acc, row) => {
      const input = row.querySelector('[data-field="propina"]');
      return acc + asInt(input?.value || 0);
    }, 0);
    const sumaRepartida = responsableTip + supportTotal;
    const totalComparacion = totalDistribuida || totalDia;
    const coherente = totalComparacion > 0 ? sumaRepartida === totalComparacion : true;

    setStatus(
      `Propina aplicada desde BD/webhook. Responsable: ${responsableTip}. Apoyos: ${supportTotal}. `
      + `Suma reparto: ${sumaRepartida}${totalComparacion > 0 ? ` / Total referencia: ${totalComparacion}` : ""}. `
      + `${coherente ? "Coherencia OK." : "Advertencia: la suma no coincide con el total de referencia."}`
    );
  };

  btnConsultarPropina.addEventListener("click", async () => {
    if ((apoyoHubo?.value || "no") !== "si") {
      setStatus("Activa '¿Hubo apoyos?' en SI para consultar propina de apoyos.");
      return;
    }

    if (!validateApoyoRows()) {
      setStatus("Completa los datos de apoyos antes de consultar propina (responsable y horario). No se llena propina manual.");
      return;
    }

    const consultaPayload = await buildConsultaPayload();
    if (!consultaPayload) return;

    setStatus("Consultando propina de apoyos...");
    btnConsultarPropina.disabled = true;

    try {
      const response = await fetch(WEBHOOK_CONSULTAR_PROPINA_APOYO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(consultaPayload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data?.message || `No se pudo consultar propina de apoyos (HTTP ${response.status}).`);
        return;
      }

      applyDistribucion({ consultaPayload, webhookPayload: data });
    } catch (error) {
      setStatus(`Error consultando propina de apoyos: ${error?.message || "sin detalle"}`);
    } finally {
      btnConsultarPropina.disabled = false;
    }
  });

  const notifyResetIfNeeded = () => {
    ensureReadonlyApoyoPropinas();
    if (!repartoActivo) return;
    reset();
    setStatus("Se detectaron cambios en apoyos; vuelve a consultar propina para recalcular reparto.");
  };

  apoyoRowsContainer.addEventListener("input", notifyResetIfNeeded);
  apoyoRowsContainer.addEventListener("change", notifyResetIfNeeded);
  apoyoHubo?.addEventListener("change", notifyResetIfNeeded);
  apoyoCantidad?.addEventListener("change", notifyResetIfNeeded);

  if (noteEl) {
    noteEl.textContent = "Antes de consultar, completa los datos de apoyos (responsable + horario). La propina de apoyos/responsable viene desde BD por webhook y no es editable.";
  }

  ensureReadonlyApoyoPropinas();
  const observer = new MutationObserver(() => {
    ensureReadonlyApoyoPropinas();
  });
  observer.observe(apoyoRowsContainer, { childList: true, subtree: true });

  return { reset };
}

export const APOYOS_PROPINA_RESPONSE_SAMPLE = [
  {
    ok: true,
    fecha: "2026-05-05",
    total_propina_dia: 70798,
    detalles: [
      {
        id: "responsable_id",
        tipo: "responsable",
        propina_correspondiente: 47267
      },
      {
        id: "apoyo_id",
        tipo: "apoyo",
        propina_correspondiente: 0
      }
    ],
    total_propina_distribuida: 47267,
    coinciden_totales: false
  }
];

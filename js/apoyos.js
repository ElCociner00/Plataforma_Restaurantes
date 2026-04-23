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
const BLOCK_MINUTES = 5;
const ROUND_UNIT = 50;

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

const roundToNearest = (value, unit = ROUND_UNIT) => {
  if (!unit || unit <= 1) return asInt(value);
  return Math.round(asInt(value) / unit) * unit;
};

const distributeByTimeline = ({
  totalTurnoPropina,
  turnoRange,
  responsableId,
  supportRows,
  webhookRows
}) => {
  const totalTurno = asInt(totalTurnoPropina);
  if (!turnoRange) {
    return {
      responsibleTip: totalTurno,
      supportTips: Object.fromEntries(supportRows.map((row) => [row.apoyo_responsable_id, 0]))
    };
  }

  const webhookMap = new Map(
    (webhookRows || []).map((row) => [String(row?.apoyo_responsable_id || ""), asInt(row?.total_propina_periodo)])
  );

  const startCumulativeMap = new Map();
  startCumulativeMap.set(turnoRange.start, totalTurno);

  supportRows.forEach((row) => {
    const key = String(row.apoyo_responsable_id || "");
    const cumulative = webhookMap.get(key) || 0;
    const current = startCumulativeMap.get(row.range.start);
    if (current == null) {
      startCumulativeMap.set(row.range.start, cumulative);
      return;
    }
    // Si hay dos apoyos iniciando a la misma hora, debe coincidir. Se toma el mayor para no subestimar.
    startCumulativeMap.set(row.range.start, Math.max(current, cumulative));
  });

  const sortedStarts = Array.from(startCumulativeMap.entries()).sort((a, b) => a[0] - b[0]);
  const segmentTotals = [];

  for (let i = 0; i < sortedStarts.length; i += 1) {
    const [startMinute, currentCumulative] = sortedStarts[i];
    const next = sortedStarts[i + 1];
    const segmentEnd = next ? next[0] : turnoRange.end;
    const nextCumulative = next ? next[1] : 0;
    if (segmentEnd <= startMinute) continue;

    const amount = Math.max(0, asInt(currentCumulative) - asInt(nextCumulative));
    segmentTotals.push({ start: startMinute, end: segmentEnd, amount });
  }

  const totalsByPerson = new Map();
  totalsByPerson.set(responsableId, 0);
  supportRows.forEach((row) => totalsByPerson.set(String(row.apoyo_responsable_id || ""), 0));

  segmentTotals.forEach((segment) => {
    const duration = segment.end - segment.start;
    const blocks = Math.max(1, Math.ceil(duration / BLOCK_MINUTES));
    const blockValue = segment.amount / blocks;

    for (let block = 0; block < blocks; block += 1) {
      const blockStart = segment.start + (block * BLOCK_MINUTES);
      const blockEnd = Math.min(segment.end, blockStart + BLOCK_MINUTES);
      if (blockEnd <= blockStart) continue;

      const present = [responsableId];
      supportRows.forEach((row) => {
        if (blockStart >= row.range.start && blockStart < row.range.end) {
          present.push(String(row.apoyo_responsable_id || ""));
        }
      });

      const share = blockValue / present.length;
      present.forEach((id) => {
        totalsByPerson.set(id, (totalsByPerson.get(id) || 0) + share);
      });
    }
  });

  const roundedSupport = {};
  supportRows.forEach((row) => {
    const key = String(row.apoyo_responsable_id || "");
    roundedSupport[key] = roundToNearest(totalsByPerson.get(key) || 0);
  });

  const roundedSupportTotal = Object.values(roundedSupport).reduce((acc, value) => acc + asInt(value), 0);
  const responsibleRounded = Math.max(0, totalTurno - roundedSupportTotal);

  return {
    responsibleTip: responsibleRounded,
    supportTips: roundedSupport
  };
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
    const turnoRange = normalizeRange(apoyo?.hora_inicio, apoyo?.hora_fin);

    const supportRows = (apoyo?.registros || [])
      .map((row) => ({
        ...row,
        apoyo_responsable_id: String(row?.apoyo_responsable_id || ""),
        range: normalizeRange(row?.rango_hora_inicio_simple, row?.rango_hora_fin_simple)
      }))
      .filter((row) => row.apoyo_responsable_id && row.range);

    const result = distributeByTimeline({
      totalTurnoPropina: propinaInput.value,
      turnoRange,
      responsableId: String(apoyo?.responsable_turno_id || "responsable_turno"),
      supportRows,
      webhookRows: normalizeResponseData(webhookPayload)
    });

    getApoyoRows().forEach((row) => {
      const apoyoId = String(row.querySelector('[data-field="responsable"]')?.value || "");
      const input = row.querySelector('[data-field="propina"]');
      if (!input) return;
      input.value = String(asInt(result.supportTips[apoyoId] || 0));
    });

    propinaInput.value = String(asInt(result.responsibleTip));
    ensureReadonlyApoyoPropinas();
    repartoActivo = true;
    marcarComoNoVerificado();

    const supportTotal = Object.values(result.supportTips).reduce((acc, value) => acc + asInt(value), 0);
    setStatus(
      `Propina apoyos distribuida por bloques de 5 minutos. `
      + `Responsable: ${result.responsibleTip}. Apoyos: ${supportTotal}.`
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
    noteEl.textContent = "Antes de consultar, completa los datos de apoyos (responsable + horario). La propina de apoyos es automática y no editable.";
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
    data: [
      {
        empresa_id: "empresa_id",
        apoyo_responsable_id: "usuario_apoyo_id",
        total_propina_periodo: 0
      }
    ]
  }
];

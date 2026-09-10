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
import { supabase } from "./supabase.js";
import { mensajeDeError } from "./edge_function_error.js";

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
  if (typeof payload === 'object' && payload !== null) return [payload];
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
  let totalRecibido = 0;
  let totalHuerfano = 0;

  normalized.forEach((row) => {
    totalDia = Math.max(totalDia, asInt(row?.total_propina_dia));
    totalDistribuida = Math.max(totalDistribuida, asInt(row?.total_propina_distribuida));
    // `total_recibido`/`total_huerfano`: toda la propina de la consulta, y la
    // parte de esa propina que no cayó en el horario de nadie registrado.
    // Pueden faltar en una Edge Function desplegada antes de este cambio; el
    // resto del código ya asume 0 cuando no vienen.
    totalRecibido = Math.max(totalRecibido, asInt(row?.total_recibido));
    totalHuerfano = Math.max(totalHuerfano, asInt(row?.total_huerfano));
  });

  return { totalDia, totalDistribuida, totalRecibido, totalHuerfano };
};

const rebalanceIfExceedsTotal = (items, totalDia) => {
  const total = asInt(totalDia);
  const suma = items.reduce((acc, item) => acc + asInt(item.propina), 0);
  if (!total || suma <= total) return items.map((item) => ({ ...item, propina: asInt(item.propina) }));

  let remaining = total;
  return items.map((item, index) => {
    const value = index === items.length - 1
      ? remaining
      : Math.floor((asInt(item.propina) * total) / suma);
    remaining -= value;
    return { ...item, propina: Math.max(0, value) };
  });
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
  marcarComoNoVerificado,
  // Opcional. Recibe la respuesta completa del reparto (incluida la traza
  // `eventos`) para pintarla, o null cuando el reparto deja de ser válido.
  // El reparto no depende de esto: si no se pasa, todo funciona igual.
  onReparto
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
    delete propinaInput.dataset.propinaResponsable;
    ensureReadonlyApoyoPropinas();
    // Si el reparto deja de ser válido, el desglose en pantalla también:
    // dejarlo visible mostraría un reparto que ya no corresponde a los apoyos.
    try {
      onReparto?.(null);
    } catch (errorVista) {
      console.error("[apoyos] no se pudo limpiar el desglose de propinas", errorVista);
    }
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
    const { totalDia, totalDistribuida, totalRecibido, totalHuerfano } = extractWebhookTotals(webhookPayload);

    const apoyoRows = getApoyoRows();
    const responsableRow = detalleRows.find((row) => row.tipo === "responsable" && (!responsableId || row.id === responsableId));
    const items = [
      { id: responsableId, tipo: "responsable", propina: responsableRow?.propina ?? detalleRows.find((row) => row.id === responsableId)?.propina ?? 0 },
      ...apoyoRows.map((row) => ({
        id: String(row.querySelector('[data-field="responsable"]')?.value || ""),
        tipo: "apoyo",
        propina: detalleRows.find((detalle) => detalle.id === String(row.querySelector('[data-field="responsable"]')?.value || ""))?.propina ?? 0
      }))
    ];
    const adjustedItems = rebalanceIfExceedsTotal(items, totalDia || totalDistribuida);
    const tipsById = new Map(adjustedItems.map((row) => [row.id, row.propina]));

    apoyoRows.forEach((row) => {
      const apoyoId = String(row.querySelector('[data-field="responsable"]')?.value || "");
      const input = row.querySelector('[data-field="propina"]');
      if (!input) return;
      input.value = String(asInt(tipsById.get(apoyoId) || 0));
    });

    const responsableTip = asInt(tipsById.get(responsableId) || 0);

    // La propina real del turno (la que trajo "Consultar Loggro", si ya se
    // había hecho) NUNCA se sobreescribe con lo que la consulta de apoyos
    // alcanzó a repartir. Antes se pisaba con `totalDia`/`totalDistribuida`
    // -que es SOLO la parte que cayó en el horario de alguien registrado- y
    // eso es lo que hacía que la propina "cambiara sola" al confirmar apoyos:
    // no cambiaba, una parte se estaba perdiendo de la vista en silencio.
    const propinaRealPrevia = asInt(propinaInput.value);
    const totalTurno = propinaRealPrevia || asInt(totalRecibido || totalDia || totalDistribuida || responsableTip);
    propinaInput.value = String(totalTurno);
    propinaInput.dataset.propinaResponsable = String(responsableTip);

    ensureReadonlyApoyoPropinas();
    repartoActivo = true;
    marcarComoNoVerificado();

    const supportTotal = apoyoRows.reduce((acc, row) => acc + asInt(row.querySelector('[data-field="propina"]')?.value || 0), 0);
    const sumaRepartida = responsableTip + supportTotal;
    // Si la Edge Function ya avisa de un hueco (`totalHuerfano`), o si el
    // reparto simplemente no alcanza a cubrir la propina real conocida,
    // se informa: hay plata que no quedó asignada a nadie porque no coincide
    // con el horario de ningún registrado, y hay que revisar los rangos.
    const huerfano = Math.max(asInt(totalHuerfano), totalTurno - sumaRepartida);

    if (huerfano > 0) {
      setStatus(
        `⚠ Propina real del turno: ${totalTurno}. Solo se repartieron ${sumaRepartida} `
        + `(responsable: ${responsableTip}, apoyos: ${supportTotal}). `
        + `${huerfano} en propinas no coinciden con el horario de responsable ni apoyos registrado — `
        + "revisa los rangos antes de confirmar."
      );
    } else {
      setStatus(`Propina aplicada desde BD/webhook. Total turno: ${totalTurno}. Responsable: ${responsableTip}. Apoyos: ${supportTotal}. Suma reparto: ${sumaRepartida}.`);
    }
  };

  btnConsultarPropina.addEventListener("click", async () => {
    if ((apoyoHubo?.value || "no") !== "si") {
      setStatus("Activa '¿Hubo apoyos?' en SI para consultar propina de apoyos.");
      return;
    }

    // validateApoyoRows ya deja escrito el motivo concreto (qué apoyo falta
    // o cuál se sale del horario del turno). Pisarlo aquí con un mensaje
    // genérico dejaba a la persona sin saber qué corregir.
    if (!validateApoyoRows()) return;

    const consultaPayload = await buildConsultaPayload();
    if (!consultaPayload) return;

    setStatus("Consultando propina de apoyos...");
    btnConsultarPropina.disabled = true;

    try {
      const { data, error } = await supabase.functions.invoke("consultar-propina-apoyos", { body: consultaPayload });

      if (error || !data || data.ok === false) {
        setStatus(await mensajeDeError(error, data, "No se pudo consultar propina de apoyos."));
        return;
      }

      applyDistribucion({ consultaPayload, webhookPayload: data });

      // La vista de reparto es un espectador: si falla al pintarse, el reparto
      // ya está aplicado y el cierre no se ve afectado.
      try {
        onReparto?.({ consultaPayload, respuesta: data });
      } catch (errorVista) {
        console.error("[apoyos] no se pudo pintar el desglose de propinas", errorVista);
      }
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

  return { reset, isConsultaConfirmada: () => repartoActivo };
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

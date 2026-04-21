const WEBHOOK_CONSULTAR_PROPINA_APOYO = "https://n8n.enkrato.com/webhook/consultar_propina_apoyo";

const asInt = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
};

const extractPropinaApoyos = (payload) => {
  const candidates = [
    payload?.propina_apoyos,
    payload?.propina_apoyo,
    payload?.valor_propina_apoyos,
    payload?.valor,
    payload?.propina,
    payload?.data?.propina_apoyos,
    payload?.data?.valor,
    payload?.result?.propina_apoyos,
    payload?.result?.valor
  ];

  const found = candidates.find((item) => item != null && item !== "");
  return asInt(found);
};

const repartirPropina = ({ totalTurno, propinaApoyos, cantidadApoyos }) => {
  const total = asInt(totalTurno);
  const apoyoTotal = Math.min(total, asInt(propinaApoyos));
  const personas = Math.max(1, asInt(cantidadApoyos) + 1);

  const porPersona = Math.floor(apoyoTotal / personas);
  const residual = apoyoTotal - (porPersona * personas);

  const propinaBaseTurno = total - apoyoTotal;
  const propinaFinalTurno = propinaBaseTurno + porPersona + residual;

  return {
    totalTurno: total,
    apoyoTotal,
    porPersona,
    propinaFinalTurno
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

    return {
      empresa_id: context.empresa_id,
      usuario_id: context.usuario_id,
      rol: context.rol,
      timestamp: context.timestamp,
      apoyo: buildApoyoPayload(context)
    };
  };

  const applyDistribucion = ({ propinaApoyosWebhook }) => {
    const rows = getApoyoRows();
    const cantidadApoyos = rows.length;

    const distribution = repartirPropina({
      totalTurno: propinaInput.value,
      propinaApoyos: propinaApoyosWebhook,
      cantidadApoyos
    });

    rows.forEach((row) => {
      const input = row.querySelector('[data-field="propina"]');
      if (input) input.value = String(distribution.porPersona);
    });

    propinaInput.value = String(distribution.propinaFinalTurno);
    ensureReadonlyApoyoPropinas();
    repartoActivo = true;
    marcarComoNoVerificado();

    setStatus(
      `Propina apoyos consultada: ${distribution.apoyoTotal}. `
      + `Reparto: ${distribution.porPersona} por persona. `
      + `Propina final del turno: ${distribution.propinaFinalTurno}.`
    );
  };

  btnConsultarPropina.addEventListener("click", async () => {
    if ((apoyoHubo?.value || "no") !== "si") {
      setStatus("Activa '¿Hubo apoyos?' en SI para consultar propina de apoyos.");
      return;
    }

    if (!validateApoyoRows()) {
      setStatus("Completa los datos de apoyos antes de consultar propina (responsable, horario y filas completas).");
      return;
    }

    const payload = await buildConsultaPayload();
    if (!payload) return;

    setStatus("Consultando propina de apoyos...");
    btnConsultarPropina.disabled = true;

    try {
      const response = await fetch(WEBHOOK_CONSULTAR_PROPINA_APOYO, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data?.message || `No se pudo consultar propina de apoyos (HTTP ${response.status}).`);
        return;
      }

      const propinaApoyos = extractPropinaApoyos(data);
      applyDistribucion({ propinaApoyosWebhook: propinaApoyos });
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
    noteEl.textContent = "Antes de consultar, completa los datos de apoyos (responsable + horario) para enviarlos al webhook.";
  }

  ensureReadonlyApoyoPropinas();
  const observer = new MutationObserver(() => {
    ensureReadonlyApoyoPropinas();
  });
  observer.observe(apoyoRowsContainer, { childList: true, subtree: true });

  return { reset };
}

export const APOYOS_PROPINA_RESPONSE_SAMPLE = {
  header: "propina_apoyos",
  valor: 3000
};

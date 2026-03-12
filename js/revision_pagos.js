
import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getUserContext } from "./session.js";

const bodyEl = document.getElementById("revisionBody");
const statusEl = document.getElementById("statusRevision");
const btnReload = document.getElementById("btnRecargarRevision");
const state = {
  rows: []
};

const setStatus = (message) => {
  if (statusEl) statusEl.textContent = message || "";
};

const fmtMoney = (value) => Number(value || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDateTime = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-CO");
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

async function getSignedUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase
    .storage
    .from("comprobantes_pago")
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl || null;
}

async function hydrateSignedUrls(rows) {
  return Promise.all(rows.map(async (row) => {
    const signed = row.comprobante_url
      ? await getSignedUrl(row.comprobante_url)
      : null;
    return { ...row, comprobante_signed: signed };
  }));
}

function render(rows) {
  if (!bodyEl) return;
  if (!rows.length) {
    bodyEl.innerHTML = '<tr><td colspan="8">No hay pagos pendientes.</td></tr>';
    return;
  }

  bodyEl.innerHTML = rows.map((row) => {
    const empresaNombre = row.empresas?.nombre_comercial || row.empresas?.razon_social || row.empresa_id;
    const periodo = row.billing_cycles?.periodo || "-";
    const comprobanteLink = row.comprobante_signed
      ? `<a class="link-comprobante" href="${escapeHtml(row.comprobante_signed)}" target="_blank" rel="noopener noreferrer">Ver comprobante</a>`
      : "-";

    return `
      <tr>
        <td>${escapeHtml(empresaNombre)}</td>
        <td>${escapeHtml(periodo)}</td>
        <td>${escapeHtml(fmtMoney(row.monto_reportado))}</td>
        <td>${escapeHtml(fmtDateTime(row.created_at))}</td>
        <td>${escapeHtml(row.canal || "-")}</td>
        <td>${comprobanteLink}</td>
        <td><textarea class="observaciones-input" data-obs-id="${row.id}" placeholder="Observaciones..."></textarea></td>
        <td>
          <div class="actions">
            <button data-action="aprobar" data-id="${row.id}">Aprobar</button>
            <button data-action="rechazar" data-id="${row.id}">Rechazar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadRows() {
  setStatus("Cargando pagos en revision...");
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id, empresa_id, billing_cycle_id, canal, referencia_externa, monto_reportado, created_at, comprobante_url, estado, billing_cycles ( periodo, estado, monto ), empresas ( nombre_comercial, razon_social, correo_empresa )")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus("No se pudieron cargar pagos.");
    render([]);
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const hydrated = await hydrateSignedUrls(rows);
  state.rows = hydrated;
  render(hydrated);
  setStatus(`${hydrated.length} pago(s) pendiente(s).`);
}

async function registrarEvento({ empresaId, billingCycleId, tipo, actor, payload }) {
  const { error } = await supabase
    .from("billing_events")
    .insert({
      empresa_id: empresaId,
      billing_cycle_id: billingCycleId,
      tipo_evento: tipo,
      payload_json: payload || {},
      actor: actor || "superadmin"
    });
  if (error) throw error;
}

async function aprobarPago(row, observaciones, revisadoPor) {
  const { error: attemptError } = await supabase
    .from("payment_attempts")
    .update({
      estado: "aprobado",
      revisado_por: revisadoPor || null,
      observaciones: observaciones || null
    })
    .eq("id", row.id);

  if (attemptError) throw attemptError;

  const { error: cycleError } = await supabase
    .from("billing_cycles")
    .update({
      estado: "paid_verified",
      banner_activo: false
    })
    .eq("id", row.billing_cycle_id);

  if (cycleError) throw cycleError;

  await registrarEvento({
    empresaId: row.empresa_id,
    billingCycleId: row.billing_cycle_id,
    tipo: "pago_aprobado",
    actor: revisadoPor,
    payload: {
      attempt_id: row.id,
      observaciones: observaciones || null
    }
  });
}

async function rechazarPago(row, observaciones, revisadoPor) {
  const { error: attemptError } = await supabase
    .from("payment_attempts")
    .update({
      estado: "rechazado",
      revisado_por: revisadoPor || null,
      observaciones: observaciones || null
    })
    .eq("id", row.id);

  if (attemptError) throw attemptError;

  await registrarEvento({
    empresaId: row.empresa_id,
    billingCycleId: row.billing_cycle_id,
    tipo: "pago_rechazado",
    actor: revisadoPor,
    payload: {
      attempt_id: row.id,
      observaciones: observaciones || null
    }
  });
}

function getObservaciones(id) {
  const input = bodyEl?.querySelector(`textarea[data-obs-id="${id}"]`);
  return input?.value?.trim() || null;
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await esSuperAdmin().catch(() => false);
  if (!ok) {
    window.location.replace("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  await loadRows();
  btnReload?.addEventListener("click", loadRows);

  bodyEl?.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;

    const id = btn.dataset.id;
    const row = state.rows.find((item) => item.id === id);
    if (!row) return;

    const ctx = await getUserContext().catch(() => null);
    const revisadoPor = ctx?.user?.id || null;
    const observaciones = getObservaciones(id);

    try {
      if (btn.dataset.action === "aprobar") {
        await aprobarPago(row, observaciones, revisadoPor);
      } else {
        await rechazarPago(row, observaciones, revisadoPor);
      }
      await loadRows();
      setStatus("Pago procesado.");
    } catch (_error) {
      setStatus("No se pudo procesar el pago.");
    }
  });
});

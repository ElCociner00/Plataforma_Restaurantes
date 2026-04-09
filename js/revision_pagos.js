import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getUserContext } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const bodyEl = document.getElementById("revisionBody");
const statusEl = document.getElementById("statusRevision");
const btnReload = document.getElementById("btnRecargarRevision");
const state = {
  rows: []
};

const setStatus = (m) => { if (statusEl) statusEl.textContent = m || ""; };
const fmtMoney = (v) => Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-CO");
};
const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

async function signedUrl(path) {
  if (!path) return "";
  const { data } = await supabase.storage.from("comprobantes_pago").createSignedUrl(path, 60 * 20);
  return data?.signedUrl || "";
}

function render(rows) {
  if (!bodyEl) return;
  if (!rows.length) {
    bodyEl.innerHTML = '<tr><td colspan="7">No hay pagos pendientes.</td></tr>';
    return;
  }

  bodyEl.innerHTML = rows.map((r) => {
    const empresaName = r.empresas?.nombre_comercial || r.empresas?.razon_social || r.empresa_id;
    return `
      <tr>
        <td>${escapeHtml(empresaName)}</td>
        <td>${escapeHtml(r.billing_cycles?.periodo || "-")}</td>
        <td>${fmtMoney(r.monto_reportado)}</td>
        <td>${fmtDate(r.fecha_reportada || r.created_at)}</td>
        <td>${r.comprobante_signed_url ? `<a href="${r.comprobante_signed_url}" target="_blank" rel="noopener noreferrer">Ver adjunto</a>` : "-"}</td>
        <td><input class="obs-input" type="text" data-obs-for="${r.id}" placeholder="Observaciones (opcional)"></td>
        <td>
          <div class="actions">
            <button data-action="aprobar" data-id="${r.id}">Aprobar</button>
            <button data-action="rechazar" data-id="${r.id}">Rechazar</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

async function loadRows() {
  setStatus("Cargando pagos en revisión...");
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id, empresa_id, billing_cycle_id, monto_reportado, fecha_reportada, comprobante_url, estado, created_at, empresas ( nombre_comercial, razon_social ), billing_cycles ( id, periodo )")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true });

  if (error) {
    setStatus("No se pudieron cargar pagos.");
    render([]);
    return;
  }

  const rows = await Promise.all((data || []).map(async (item) => ({
    ...item,
    comprobante_signed_url: await signedUrl(item.comprobante_url).catch(() => "")
  })));

  render(rows);
  setStatus(`${rows.length} pago(s) pendiente(s).`);
}

async function insertEvent({ empresaId, cycleId, tipo, actor, payload }) {
  await supabase.from("billing_events").insert({
    empresa_id: empresaId,
    billing_cycle_id: cycleId,
    tipo_evento: tipo,
    actor,
    payload_json: payload || {}
  });
}

async function resolver(tryRpcName, payload, fallback) {
  const { error } = await supabase.rpc(tryRpcName, payload);
  if (!error) return true;
  await fallback();
  return false;
}

async function aprobar({ attemptId, revisadoPor, observaciones }) {
  return resolver("aprobar_pago", {
    p_attempt_id: attemptId,
    p_revisado_por: revisadoPor,
    p_observaciones: observaciones || null
  }, async () => {
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("id, empresa_id, billing_cycle_id")
      .eq("id", attemptId)
      .maybeSingle();

    await supabase.from("payment_attempts")
      .update({ estado: "aprobado", revisado_por: revisadoPor, observaciones: observaciones || null, updated_at: new Date().toISOString() })
      .eq("id", attemptId);

    if (attempt?.billing_cycle_id) {
      await supabase.from("billing_cycles")
        .update({ estado: "paid_verified", banner_activo: false, suspension_aplicada: false, updated_at: new Date().toISOString() })
        .eq("id", attempt.billing_cycle_id);
    }

    if (attempt?.empresa_id) {
      await supabase.from("empresas").update({ mostrar_anuncio_impago: false, activa: true, activo: true }).eq("id", attempt.empresa_id);
    }

    await insertEvent({
      empresaId: attempt?.empresa_id,
      cycleId: attempt?.billing_cycle_id,
      tipo: "pago_aprobado",
      actor: revisadoPor,
      payload: { attempt_id: attemptId, observaciones }
    });
  });
}

async function rechazar({ attemptId, revisadoPor, observaciones }) {
  return resolver("rechazar_pago", {
    p_attempt_id: attemptId,
    p_revisado_por: revisadoPor,
    p_observaciones: observaciones || null
  }, async () => {
    const { data: attempt } = await supabase
      .from("payment_attempts")
      .select("id, empresa_id, billing_cycle_id")
      .eq("id", attemptId)
      .maybeSingle();

    await supabase.from("payment_attempts")
      .update({ estado: "rechazado", revisado_por: revisadoPor, observaciones: observaciones || null, updated_at: new Date().toISOString() })
      .eq("id", attemptId);

    await insertEvent({
      empresaId: attempt?.empresa_id,
      cycleId: attempt?.billing_cycle_id,
      tipo: "pago_rechazado",
      actor: revisadoPor,
      payload: { attempt_id: attemptId, observaciones }
    });
  });
}

async function notificarWebhook({ tipo, attemptId, observaciones }) {
  const webhook = WEBHOOKS?.BILLING_NOTIFICACIONES_PAGOS;
  if (!webhook?.url || webhook.url.includes("tu-n8n-instancia.com")) return;
  await fetch(webhook.url, {
    method: webhook.metodo || "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, attempt_id: attemptId, observaciones, fecha: new Date().toISOString() })
  }).catch(() => {});
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
    const action = btn.dataset.action;
    const obsInput = document.querySelector(`input[data-obs-for="${id}"]`);
    const observaciones = String(obsInput?.value || "").trim();

    btn.disabled = true;
    const ctx = await getUserContext().catch(() => null);
    const revisadoPor = ctx?.user?.email || ctx?.user?.id || "superadmin";

    try {
      if (action === "aprobar") {
        await aprobar({ attemptId: id, revisadoPor, observaciones });
        await notificarWebhook({ tipo: "pago_aprobado", attemptId: id, observaciones });
      }
      if (action === "rechazar") {
        await rechazar({ attemptId: id, revisadoPor, observaciones });
        await notificarWebhook({ tipo: "pago_rechazado", attemptId: id, observaciones });
      }

      await loadRows();
      setStatus("Pago procesado correctamente.");
    } catch (error) {
      setStatus(`No se pudo procesar el pago: ${error?.message || "error"}`);
    } finally {
      btn.disabled = false;
    }
  });
});

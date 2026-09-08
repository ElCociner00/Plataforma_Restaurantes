/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/revision_pagos.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `setStatus` (línea aprox. 14): Asigna/actualiza estado.
 * - `fmtMoney` (línea aprox. 15): Bloque funcional del módulo.
 * - `fmtDate` (línea aprox. 16): Bloque funcional del módulo.
 * - `escapeHtml` (línea aprox. 20): Bloque funcional del módulo.
 * - `render` (línea aprox. 33): Renderiza/actualiza UI.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getUserContext } from "./session.js";
import { WEBHOOKS, motivoObsoleto, webhookVigente } from "./webhooks.js";
import { APP_URLS } from "./urls.js";

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

/**
 * Aprobar y rechazar comprobantes.
 *
 * Antes esto tenía un "resolver" que intentaba el RPC y, si fallaba, caía a un
 * fallback que escribía a mano en las tablas. El RPC no existía en la base y el
 * fallback escribía el CORREO del revisor en revisado_por, que es uuid: el
 * UPDATE fallaba, nadie comprobaba el error, y las sentencias siguientes daban
 * la empresa por pagada igualmente (§3.5 del plan de facturación).
 *
 * Ahora el RPC existe, es transaccional, deduce el revisor de la sesión y
 * registra el pago también contra el modelo de cuentas moviendo la vigencia.
 * Si falla, se ve: se lanza el error en vez de tragárselo.
 */
async function aprobar({ attemptId, observaciones }) {
  const { data, error } = await supabase.rpc("aprobar_pago", {
    p_attempt_id: attemptId,
    p_observaciones: observaciones || null
  });
  if (error) throw error;
  return data;
}

async function rechazar({ attemptId, observaciones }) {
  const { data, error } = await supabase.rpc("rechazar_pago", {
    p_attempt_id: attemptId,
    p_observaciones: observaciones || null
  });
  if (error) throw error;
  return data;
}

async function notificarWebhook({ tipo, attemptId, observaciones }) {
  const webhook = WEBHOOKS?.BILLING_NOTIFICACIONES_PAGOS;
  // El webhook de n8n ya no existe. No se sustituye por nada: la aprobación o
  // el rechazo quedan registrados en payment_attempts y en la tabla de eventos
  // unas líneas más arriba, que es lo que consulta la pantalla de facturación.
  if (!webhookVigente(webhook?.url)) {
    console.info("[revision_pagos] Notificación omitida:", motivoObsoleto(webhook?.url));
    return;
  }
  await fetch(webhook.url, {
    method: webhook.metodo || "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tipo, attempt_id: attemptId, observaciones, fecha: new Date().toISOString() })
  }).catch(() => {});
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await esSuperAdmin().catch(() => false);
  if (!ok) {
    window.location.replace(APP_URLS.dashboard);
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

    try {
      // El revisor NO se envía desde el navegador: el RPC lo toma de auth.uid().
      if (action === "aprobar") {
        await aprobar({ attemptId: id, observaciones });
        await notificarWebhook({ tipo: "pago_aprobado", attemptId: id, observaciones });
      }
      if (action === "rechazar") {
        await rechazar({ attemptId: id, observaciones });
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

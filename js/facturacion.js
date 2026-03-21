import { supabase } from "./supabase.js";
import { buildRequestHeaders, getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";
import { BILLING_PAYMENT_URL } from "./billing_config.js";

const getFacturaRoot = () => {
  const existing = document.getElementById("factura-contenido");
  if (existing) return existing;

  const fallback = document.createElement("section");
  fallback.id = "factura-contenido";
  fallback.className = "factura-shell";
  const main = document.querySelector(".facturacion-main");
  if (main) main.appendChild(fallback);
  else document.body.appendChild(fallback);
  return fallback;
};

const fmtMoney = (v) => Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-CO");
};
const fmtDateTime = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-CO");
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const normalizeInlineText = (value) => String(value || "")
  .replace(/\r\n/g, " ")
  .replace(/\n/g, " ")
  .replace(/\r/g, " ")
  .replace(/\\r\\n/g, " ")
  .replace(/\\n/g, " ")
  .replace(/\\r/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const getCurrentPeriod = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

async function loadFacturaByWebhook(empresaId) {
  const webhook = WEBHOOKS?.FACTURACION_RESUMEN;
  const url = webhook?.url || "";
  if (!url || url.includes("tu-n8n-instancia.com")) return null;

  const headers = await buildRequestHeaders({ includeTenant: true });
  headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method: webhook.metodo || "POST",
    headers,
    body: JSON.stringify({ empresa_id: empresaId })
  });

  if (!response.ok) throw new Error(`Webhook facturacion fallo: ${response.status}`);
  const data = await response.json().catch(() => null);
  return data?.factura || data || null;
}

async function loadBillingCycle(empresaId, periodo) {
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("*")
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadLegacyFactura(empresaId) {
  const { data, error } = await supabase
    .from("facturacion")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadPaymentAttempts(empresaId, limit = 20) {
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id, billing_cycle_id, canal, referencia_externa, monto_reportado, fecha_reportada, comprobante_url, estado, observaciones, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

async function loadBillingHistory(empresaId, limit = 12) {
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("id, periodo, fecha_vencimiento, monto, estado, banner_activo")
    .eq("empresa_id", empresaId)
    .order("periodo", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

function amountInWordsEs() {
  return "CINCUENTA Y NUEVE MIL NOVECIENTOS PESOS COLOMBIANOS";
}

function attemptStatusBadge(status) {
  const normalized = String(status || "pendiente").toLowerCase();
  if (normalized === "aprobado") return { klass: "badge ok", label: "Aprobado" };
  if (normalized === "rechazado") return { klass: "badge bad", label: "Rechazado" };
  return { klass: "badge warn", label: "Pendiente" };
}

function cycleStatusLabel(status) {
  const map = {
    draft: "Borrador",
    pending_payment: "Pendiente",
    proof_submitted: "Comprobante enviado",
    paid_verified: "Pago verificado",
    past_due: "Vencido",
    suspended: "Suspendido",
    grace_manual: "Gracia manual"
  };
  return map[String(status || "").toLowerCase()] || String(status || "-");
}

async function resolveComprobanteUrl(path) {
  if (!path) return "";
  const { data } = await supabase.storage.from("comprobantes_pago").createSignedUrl(path, 60 * 20);
  return data?.signedUrl || "";
}

function renderFactura({ descripcion, valorTotal, paymentMethod }) {
  return `
    <article class="factura-sheet">
      <section class="factura-header">
        <div class="factura-block">
          <h3 class="factura-title">Información del Emisor</h3>
          <dl class="kv-list">
            <div class="kv-line"><dt>Empresa</dt><dd>AXIOMA by Global Nexo Shop</dd></div>
            <div class="kv-line"><dt>Dirección</dt><dd>Barranquilla, Atlántico, Colombia</dd></div>
            <div class="kv-line"><dt>Ciudad</dt><dd>Barranquilla</dd></div>
            <div class="kv-line"><dt>Teléfonos</dt><dd>304 439 4874</dd></div>
            <div class="kv-line"><dt>Correo</dt><dd>santiagozamora903jm@outlook.com</dd></div>
            <div class="kv-line"><dt>Actividad económica</dt><dd>Servicios de software</dd></div>
          </dl>
        </div>

        <div class="factura-block">
          <h3 class="factura-title">Factura electrónica de venta</h3>
          <dl class="kv-list">
            <div class="kv-line"><dt>Tipo</dt><dd>Factura electrónica de venta</dd></div>
            <div class="kv-line"><dt>Forma de pago</dt><dd>${escapeHtml(paymentMethod)}</dd></div>
          </dl>
        </div>
      </section>
      <section class="factura-block factura-table-wrap">
        <table class="factura-table">
          <thead>
            <tr>
              <th class="is-num">Cantidad</th>
              <th class="is-num">Valor Unitario</th>
              <th>Descripción</th>
              <th class="is-num">Total</th>
              <th>Código</th>
              <th>Unidad</th>
              <th class="is-num">IVA</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td class="is-num">1</td>
              <td class="is-num">${fmtMoney(valorTotal)}</td>
              <td>${escapeHtml(normalizeInlineText(descripcion))}</td>
              <td class="is-num">${fmtMoney(valorTotal)}</td>
              <td>AX-SUSC</td>
              <td>MES</td>
              <td class="is-num">0%</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="factura-block factura-tax-line">
        <strong>Líneas:</strong> 1
        <strong>Base gravable:</strong> ${fmtMoney(valorTotal)}
        <strong>IVA:</strong> ${fmtMoney(0)}
      </section>

      <section class="factura-bottom factura-bottom-only-totals">
        <div class="factura-totals">
          <div class="row"><strong>IVA</strong><strong>${fmtMoney(0)}</strong></div>
          <div class="row"><strong>SUBTOTAL</strong><strong>${fmtMoney(valorTotal)}</strong></div>
          <div class="row"><strong>TOTAL RETENCIONES</strong><strong>${fmtMoney(0)}</strong></div>
          <div class="row"><strong>TOTAL A PAGAR</strong><strong>${fmtMoney(valorTotal)}</strong></div>
        </div>
      </section>

      <section class="factura-block"><strong>VALOR ESCRITO:</strong> ${escapeHtml(amountInWordsEs())}</section>

      <section class="factura-block factura-legal">
        <div>Al usar nuestro servicio el cliente acepta las condiciones del servicio y el reconocimiento de su obligación de pago.</div>
      </section>

      <section class="factura-payment">
        <a class="btn-pago" href="${BILLING_PAYMENT_URL}" target="_blank" rel="noopener noreferrer">Ingresar al link para pagar</a>
        <p>${BILLING_PAYMENT_URL}</p>
        <p>Si ya pagaste, sube aquí tu comprobante para revisión.</p>
      </section>
    </article>
  `;
}

function renderUploadForm() {
  return `
    <section class="billing-panel">
      <h3>Adjuntar comprobante de pago</h3>
      <form id="formComprobante" class="billing-form billing-form--simple">
        <label>Comprobante (PDF o imagen)
          <input type="file" name="comprobante" accept="application/pdf,image/*" required>
        </label>
        <button id="btnEnviarComprobante" type="submit">Adjuntar y enviar</button>
      </form>
      <p id="estadoComprobante" class="helper-text">Nosotros validaremos el valor, el medio de pago y la referencia con el soporte que adjuntes.</p>
    </section>
  `;
}

function renderHistory(attempts, cycles) {
  const attemptsHtml = attempts.length
    ? attempts.map((item) => {
      const badge = attemptStatusBadge(item.estado);
      return `
        <tr>
          <td>${fmtDateTime(item.fecha_reportada || item.created_at)}</td>
          <td>${fmtMoney(item.monto_reportado)}</td>
          <td>${escapeHtml(item.canal || "-")}</td>
          <td><span class="${badge.klass}">${badge.label}</span></td>
          <td>${item.comprobante_signed_url ? `<a href="${item.comprobante_signed_url}" target="_blank" rel="noopener noreferrer">Ver</a>` : "-"}</td>
        </tr>
      `;
    }).join("")
    : "<tr><td colspan='5'>No hay pagos reportados.</td></tr>";

  const cyclesHtml = cycles.length
    ? cycles.map((cycle) => `
      <tr>
        <td>${escapeHtml(cycle.periodo)}</td>
        <td>${fmtMoney(cycle.monto)}</td>
        <td>${fmtDate(cycle.fecha_vencimiento)}</td>
        <td>${escapeHtml(cycleStatusLabel(cycle.estado))}</td>
        <td>${cycle.banner_activo ? "Sí" : "No"}</td>
      </tr>
    `).join("")
    : "<tr><td colspan='5'>No hay ciclos de facturación.</td></tr>";

  return `
    <section class="billing-panel">
      <h3>Historial de pagos</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Fecha</th><th>Monto</th><th>Canal</th><th>Estado</th><th>Comprobante</th></tr></thead>
          <tbody>${attemptsHtml}</tbody>
        </table>
      </div>
    </section>

    <section class="billing-panel">
      <h3>Historial de ciclos</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Periodo</th><th>Monto</th><th>Vence</th><th>Estado</th><th>Banner</th></tr></thead>
          <tbody>${cyclesHtml}</tbody>
        </table>
      </div>
    </section>
  `;
}

async function attachUploadHandler({ empresaId, cycleId }) {
  const form = document.getElementById("formComprobante");
  const statusEl = document.getElementById("estadoComprobante");
  const btn = document.getElementById("btnEnviarComprobante");
  if (!form || !empresaId) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const file = fd.get("comprobante");

    if (!(file instanceof File) || !file.size) {
      if (statusEl) statusEl.textContent = "Selecciona un comprobante válido.";
      return;
    }

    btn.disabled = true;
    if (statusEl) statusEl.textContent = "Enviando comprobante...";

    try {
      const safeName = String(file.name || "comprobante").replace(/\s+/g, "_");
      const storagePath = `${empresaId}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("comprobantes_pago")
        .upload(storagePath, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (uploadError) throw uploadError;

      const payload = {
        empresa_id: empresaId,
        canal: "transferencia",
        referencia_externa: null,
        monto_reportado: 0,
        comprobante_url: storagePath,
        estado: "pendiente"
      };

      if (cycleId) payload.billing_cycle_id = cycleId;

      const { data: insertData, error: insertError } = await supabase
        .from("payment_attempts")
        .insert(payload)
        .select("id")
        .maybeSingle();
      if (insertError) throw insertError;

      const webhook = WEBHOOKS?.COMPROBANTE_PAGO;
      const webhookUrl = webhook?.url || "";
      if (webhookUrl && !webhookUrl.includes("tu-n8n-instancia.com")) {
        fetch(webhookUrl, {
          method: webhook.metodo || "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attempt_id: insertData?.id || null,
            empresa_id: empresaId,
            billing_cycle_id: cycleId || null,
            monto_reportado: payload.monto_reportado,
            canal: payload.canal,
            referencia_externa: payload.referencia_externa,
            comprobante_path: storagePath,
            comprobante_bucket: "comprobantes_pago",
            comprobante_nombre: safeName,
            comprobante_mime: file.type || "application/octet-stream",
            comprobante_size: file.size,
            fecha_envio: new Date().toISOString()
          })
        }).catch(() => {});
        const _fd = new FormData(); _fd.append("comprobante", file, safeName); _fd.append("attempt_id", insertData?.id || ""); _fd.append("empresa_id", empresaId || ""); _fd.append("billing_cycle_id", cycleId || ""); _fd.append("monto_reportado", String(payload.monto_reportado || "")); _fd.append("canal", payload.canal || ""); _fd.append("referencia_externa", payload.referencia_externa || ""); _fd.append("comprobante_path", storagePath); _fd.append("comprobante_bucket", "comprobantes_pago"); _fd.append("comprobante_nombre", safeName); _fd.append("comprobante_mime", file.type || "application/octet-stream"); _fd.append("comprobante_size", String(file.size || 0)); _fd.append("fecha_envio", new Date().toISOString()); fetch(webhookUrl, { method: webhook.metodo || "POST", body: _fd }).catch(() => {});
      }

      if (statusEl) statusEl.textContent = "Comprobante enviado. Lo revisaremos pronto.";
      form.reset();
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      if (statusEl) statusEl.textContent = `No se pudo enviar el comprobante: ${error?.message || "error"}`;
    } finally {
      btn.disabled = false;
    }
  });
}

const renderStaticShell = (rootEl) => {
  const valorTotal = 59900;
  rootEl.innerHTML = [
    renderFactura({ descripcion: "Servicio plataforma AXIOMA", valorTotal, paymentMethod: "Transferencia" }),
    renderUploadForm(),
    `<section class="billing-panel"><p class="helper-text">Cargando historial de pagos...</p></section>`
  ].join("\n");
};

export async function cargarFactura() {
  const rootEl = getFacturaRoot();
  if (!rootEl) return;

  renderStaticShell(rootEl);

  try {
    const session = await getSessionConEmpresa().catch(() => null);
    const empresa = session?.empresa || {};
    const empresaId = empresa?.id || null;
    const periodo = getCurrentPeriod();

    const [billingCycle, legacyFactura, attempts, cycles] = empresaId
      ? await Promise.all([
        loadBillingCycle(empresaId, periodo).catch(() => null),
        loadLegacyFactura(empresaId).catch(() => null),
        loadPaymentAttempts(empresaId).catch(() => []),
        loadBillingHistory(empresaId).catch(() => [])
      ])
      : [null, null, [], []];

    const facturaSource = billingCycle || legacyFactura || (empresaId ? await loadFacturaByWebhook(empresaId).catch(() => null) : null) || {};
    const descripcion = facturaSource?.descripcion_producto || "Servicio plataforma AXIOMA";
    const valorTotal = Number(facturaSource?.monto || facturaSource?.valor_total || 59900);
    const paymentMethod = facturaSource?.forma_pago || "Transferencia";

    const attemptsWithUrls = await Promise.all((attempts || []).map(async (item) => ({
      ...item,
      comprobante_signed_url: item?.estado === "aprobado" ? await resolveComprobanteUrl(item.comprobante_url).catch(() => "") : ""
    })));

    rootEl.innerHTML = [
      renderFactura({ descripcion, valorTotal, paymentMethod }),
      renderUploadForm(),
      renderHistory(attemptsWithUrls, cycles)
    ].join("\n");

    attachUploadHandler({ empresaId, cycleId: billingCycle?.id || null });
  } catch (error) {
    const valorTotal = 59900;
    rootEl.innerHTML = [
      renderFactura({ descripcion: "Servicio plataforma AXIOMA", valorTotal, paymentMethod: "Transferencia" }),
      renderUploadForm(),
      `<section class="billing-panel"><p class="helper-text">No pudimos cargar tu historial en este momento. Puedes intentar nuevamente en unos minutos.</p></section>`
    ].join("\n");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});

window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});

















import { supabase } from "./supabase.js";
import { buildRequestHeaders, getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const rootEl = document.getElementById("factura-contenido");

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

const getCurrentPeriod = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

async function loadFacturaByWebhook(empresaId) {
  const webhook = WEBHOOKS?.FACTURACION_RESUMEN;
  const url = webhook?.url || "";
  if (!url || url.includes("tu-n8n-instancia.com")) return null;

  const headers = await buildRequestHeaders({ includeTenant: true });
  headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: webhook.metodo || "POST",
    headers,
    body: JSON.stringify({ empresa_id: empresaId })
  });

  if (!res.ok) throw new Error(`Webhook facturacion fallo: ${res.status}`);
  const data = await res.json().catch(() => null);
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
    .select("id, periodo, fecha_vencimiento, monto, estado, banner_activo, dias_restantes_cache")
    .eq("empresa_id", empresaId)
    .order("periodo", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

function getFacturaCode(factura) {
  if (factura?.numero_factura) return String(factura.numero_factura);
  const prefijo = factura?.prefijo_factura || "AX";
  const consecutivo = Number(factura?.consecutivo_actual || 1);
  return `${prefijo}-${consecutivo}`;
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

function renderFactura({ facturaCode, descripcion, valorTotal }) {
  return `
  <article class="factura-sheet">
    <section class="factura-top-row">
      <div class="bloque bloque-empresa">
        <h2>AXIOMA</h2>
        <p>by Global Nexo Shop</p>
        <p>Barranquilla, Atlántico, Colombia</p>
      </div>

      <div class="bloque bloque-cabecera-factura">
        <h3>FACTURA ELECTRÓNICA DE VENTA</h3>
        <div class="linea-factura"></div>
        <div class="factura-codigo-row">
          <span>Factura:</span>
          <strong>${escapeHtml(facturaCode)}</strong>
        </div>
      </div>
    </section>

    <section class="bloque bloque-tabla-producto">
      <div class="tabla-grid header">
        <div>Cantidad</div><div>Medida</div><div>Descripción</div><div>IVA</div><div>Valor Unitario</div><div>Valor Total</div>
      </div>
      <div class="tabla-grid body">
        <div>1</div><div>mes</div><div>${escapeHtml(descripcion)}</div><div>0</div><div>${fmtMoney(valorTotal)}</div><div>${fmtMoney(valorTotal)}</div>
      </div>
    </section>

    <section class="factura-payment">
      <a class="btn-pago" href="https://mpago.li/15d6BkC" target="_blank" rel="noopener noreferrer">Pagar ahora</a>
      <p>Si ya pagaste, sube aquí tu comprobante para revisión.</p>
    </section>
  </article>`;
}

function renderUploadForm(defaultAmount) {
  return `
    <section class="billing-panel">
      <h3>Subir comprobante de pago</h3>
      <form id="formComprobante" class="billing-form">
        <label>Monto pagado <input type="number" name="monto" min="1" step="1" value="${Number(defaultAmount || 59900)}" required></label>
        <label>Referencia externa <input type="text" name="referencia" placeholder="Ej: comprobante banco"></label>
        <label>Canal
          <select name="canal" required>
            <option value="transferencia">Transferencia</option>
            <option value="mercadopago_link">Mercado Pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="otros">Otros</option>
          </select>
        </label>
        <label>Comprobante (PDF/Imagen)
          <input type="file" name="comprobante" accept="application/pdf,image/*" required>
        </label>
        <button id="btnEnviarComprobante" type="submit">Enviar comprobante</button>
      </form>
      <p id="estadoComprobante" class="helper-text"></p>
    </section>
  `;
}

function renderHistory(attempts, cycles) {
  const attemptsHtml = attempts.length
    ? attempts.map((a) => {
      const badge = attemptStatusBadge(a.estado);
      return `
      <tr>
        <td>${fmtDateTime(a.fecha_reportada || a.created_at)}</td>
        <td>${fmtMoney(a.monto_reportado)}</td>
        <td>${escapeHtml(a.canal || "-")}</td>
        <td><span class="${badge.klass}">${badge.label}</span></td>
        <td>${a.comprobante_signed_url ? `<a href="${a.comprobante_signed_url}" target="_blank" rel="noopener noreferrer">Ver</a>` : "-"}</td>
      </tr>
    `;
    }).join("")
    : "<tr><td colspan='5'>No hay pagos reportados.</td></tr>";

  const cyclesHtml = cycles.length
    ? cycles.map((c) => `
      <tr>
        <td>${escapeHtml(c.periodo)}</td>
        <td>${fmtMoney(c.monto)}</td>
        <td>${fmtDate(c.fecha_vencimiento)}</td>
        <td>${escapeHtml(cycleStatusLabel(c.estado))}</td>
        <td>${c.banner_activo ? "Sí" : "No"}</td>
      </tr>
    `).join("")
    : "<tr><td colspan='5'>No hay ciclos de facturación.</td></tr>";

  return `
    <section class="billing-panel">
      <h3>Historial de pagos</h3>
      <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Monto</th><th>Canal</th><th>Estado</th><th>Comprobante</th></tr></thead><tbody>${attemptsHtml}</tbody></table></div>
    </section>
    <section class="billing-panel">
      <h3>Historial de ciclos</h3>
      <div class="table-wrap"><table><thead><tr><th>Periodo</th><th>Monto</th><th>Vence</th><th>Estado</th><th>Banner</th></tr></thead><tbody>${cyclesHtml}</tbody></table></div>
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
    const monto = Number(fd.get("monto") || 0);

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
        billing_cycle_id: cycleId,
        empresa_id: empresaId,
        canal: fd.get("canal") || "otros",
        referencia_externa: String(fd.get("referencia") || "").trim() || null,
        monto_reportado: monto,
        comprobante_url: storagePath,
        estado: "pendiente"
      };

      const { error: insertError } = await supabase.from("payment_attempts").insert(payload);
      if (insertError) throw insertError;

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

export async function cargarFactura() {
  if (!rootEl) return;

  const session = await getSessionConEmpresa().catch(() => null);
  const empresa = session?.empresa || {};
  if (!empresa?.id) {
    rootEl.innerHTML = "<p>No se pudo identificar la empresa actual.</p>";
    return;
  }

  const periodo = getCurrentPeriod();
  const [billingCycle, legacyFactura, attempts, cycles] = await Promise.all([
    loadBillingCycle(empresa.id, periodo).catch(() => null),
    loadLegacyFactura(empresa.id).catch(() => null),
    loadPaymentAttempts(empresa.id).catch(() => []),
    loadBillingHistory(empresa.id).catch(() => [])
  ]);

  const facturaSource = billingCycle || legacyFactura || await loadFacturaByWebhook(empresa.id).catch(() => null) || {};
  const facturaCode = getFacturaCode(facturaSource);
  const descripcion = facturaSource?.descripcion_producto || "Servicio plataforma AXIOMA";
  const valorTotal = Number(facturaSource?.monto || facturaSource?.valor_total || 59900);

  const attemptsWithUrls = await Promise.all((attempts || []).map(async (item) => ({
    ...item,
    comprobante_signed_url: item?.estado === "aprobado" ? await resolveComprobanteUrl(item.comprobante_url).catch(() => "") : ""
  })));

  rootEl.innerHTML = [
    renderFactura({ facturaCode, descripcion, valorTotal }),
    renderUploadForm(valorTotal),
    renderHistory(attemptsWithUrls, cycles)
  ].join("\n");

  attachUploadHandler({ empresaId: empresa.id, cycleId: billingCycle?.id || null });
}

document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});

window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});

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

function normalizeInlineText(value) {
  return String(value || "")
    .replace(/\r\n/g, " ")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/\\r\\n/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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



function amountInWordsEs(value) {
  const n = Math.round(Number(value || 0));
  if (!Number.isFinite(n) || n <= 0) return "CERO PESOS M/CTE";
  if (n === 59900) return "CINCUENTA Y NUEVE MIL NOVECIENTOS PESOS M/CTE";
  return `${n.toLocaleString("es-CO")} PESOS M/CTE`;
}

async function resolveComprobanteUrl(path) {
  if (!path) return "";
  const { data } = await supabase.storage.from("comprobantes_pago").createSignedUrl(path, 60 * 20);
  return data?.signedUrl || "";
}

function renderFactura({ empresa, facturaCode, descripcion, valorTotal }) {
  const fecha = new Date();
  const issueDate = fecha.toLocaleDateString("es-CO");
  const issueTime = fecha.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
  const companyName = "AXIOMA by Global Nexo Shop";
  const customerName = normalizeInlineText(empresa?.nombre_comercial || empresa?.razon_social || "Cliente");
  const customerId = normalizeInlineText(empresa?.nit || "-");

  return `
  <article class="factura-sheet">
    <section class="factura-header">
      <div class="factura-block">
        <h3 class="factura-title">Información del Emisor</h3>
        <dl class="kv-list">
          <div class="kv-line"><dt>Empresa</dt><dd>${escapeHtml(companyName)}</dd></div>
          <div class="kv-line"><dt>NIT</dt><dd>901234567-8</dd></div>
          <div class="kv-line"><dt>Dirección</dt><dd>Barranquilla, Atlántico, Colombia</dd></div>
          <div class="kv-line"><dt>Teléfono</dt><dd>304 439 4874</dd></div>
          <div class="kv-line"><dt>Correo</dt><dd>facturacion@globalnexoshop.com</dd></div>
          <div class="kv-line"><dt>Régimen</dt><dd>Responsable de IVA</dd></div>
          <div class="kv-line"><dt>Actividad</dt><dd>Servicios de software</dd></div>
          <div class="kv-line"><dt>ICA</dt><dd>Régimen común</dd></div>
        </dl>
      </div>

      <div class="factura-block">
        <h3 class="factura-title">Factura Electrónica de Venta</h3>
        <dl class="kv-list">
          <div class="kv-line"><dt>Prefijo</dt><dd>AX</dd></div>
          <div class="kv-line"><dt>Número</dt><dd>${escapeHtml(facturaCode)}</dd></div>
          <div class="kv-line"><dt>Fecha expedición</dt><dd>${issueDate}</dd></div>
          <div class="kv-line"><dt>Hora generación</dt><dd>${issueTime}</dd></div>
          <div class="kv-line"><dt>Autorización DIAN</dt><dd>18764012345678</dd></div>
          <div class="kv-line"><dt>Rango autorizado</dt><dd>AX-1 a AX-999999</dd></div>
          <div class="kv-line"><dt>Forma de pago</dt><dd>Transferencia / Link</dd></div>
        </dl>
      </div>
    </section>

    <section class="factura-block">
      <h3 class="factura-title">Información del Cliente</h3>
      <dl class="kv-list">
        <div class="kv-line"><dt>Nombre</dt><dd>${escapeHtml(customerName)}</dd></div>
        <div class="kv-line"><dt>NIT / C.C.</dt><dd>${escapeHtml(customerId)}</dd></div>
        <div class="kv-line"><dt>Ciudad</dt><dd>Barranquilla</dd></div>
        <div class="kv-line"><dt>Teléfono</dt><dd>-</dd></div>
        <div class="kv-line"><dt>Código</dt><dd>${escapeHtml(empresa?.id || "-")}</dd></div>
        <div class="kv-line"><dt>Vendedor</dt><dd>AXIOMA</dd></div>
        <div class="kv-line"><dt>Elaborada por</dt><dd>Sistema</dd></div>
        <div class="kv-line"><dt>Pág.</dt><dd>1/1</dd></div>
      </dl>
    </section>

    <section class="factura-block factura-table-wrap">
      <h3 class="factura-title">Detalle de Productos</h3>
      <table class="factura-table">
        <thead>
          <tr>
            <th class="is-num">Cantidad</th>
            <th class="is-num">Valor Unitario</th>
            <th>Descripción del Producto</th>
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

    <section class="factura-bottom">
      <div class="factura-block factura-signature">
        <h3 class="factura-title">Firma y sello del cliente</h3>
        <dl class="kv-list">
          <div class="kv-line"><dt>Nombre</dt><dd></dd></div>
          <div class="kv-line"><dt>C.C.</dt><dd></dd></div>
          <div class="kv-line"><dt>Fecha recibe</dt><dd></dd></div>
          <div class="kv-line"><dt>No. cajas empaque</dt><dd></dd></div>
        </dl>
      </div>

      <div class="factura-totals">
        <div class="row"><strong>IVA</strong><strong>${fmtMoney(0)}</strong></div>
        <div class="row"><strong>SUBTOTAL</strong><strong>${fmtMoney(valorTotal)}</strong></div>
        <div class="row"><strong>RETENCIONES</strong><strong>${fmtMoney(0)}</strong></div>
        <div class="row"><strong>TOTAL A PAGAR</strong><strong>${fmtMoney(valorTotal)}</strong></div>
      </div>
    </section>

    <section class="factura-block">
      <strong>SON:</strong> ${escapeHtml(amountInWordsEs(valorTotal))}
    </section>

    <section class="factura-block factura-legal">
      <div><strong>CUFE:</strong> 7f8d9a10-billing-cufe-demo</div>
      <div><strong>Proveedor software:</strong> Global Nexo Shop S.A.S. NIT 901234567-8</div>
      <div>La firma del cliente implica aceptación del servicio y reconocimiento de la obligación de pago.</div>
    </section>

    <section class="factura-payment">
      <a class="btn-pago" href="https://mpago.li/15d6BkC" target="_blank" rel="noopener noreferrer">Ingresa al link para pagar</a>
      <p>https://mpago.li/15d6BkC</p>
      <p>Si ya pagaste, sube aquí tu comprobante para revisión.</p>
    </section>
  </article>`;
}

function renderUploadForm(defaultAmount, hasCycle) {
  const blockedMessage = hasCycle ? "" : '<p class="helper-text">No hay ciclo de facturación activo para este periodo. Contacta al administrador antes de subir comprobante.</p>';
  const disabledAttr = hasCycle ? "" : "disabled";
  return `
    <section class="billing-panel">
      <h3>Subir comprobante de pago</h3>
      ${blockedMessage}
      <form id="formComprobante" class="billing-form">
        <label>Monto pagado <input type="number" name="monto" min="1" step="1" value="${Number(defaultAmount || 59900)}" required ${disabledAttr}></label>
        <label>Referencia externa <input type="text" name="referencia" placeholder="Ej: comprobante banco" ${disabledAttr}></label>
        <label>Canal
          <select name="canal" required ${disabledAttr}>
            <option value="transferencia">Transferencia</option>
            <option value="mercadopago_link">Mercado Pago</option>
            <option value="efectivo">Efectivo</option>
            <option value="otros">Otros</option>
          </select>
        </label>
        <label>Comprobante (PDF/Imagen)
          <input type="file" name="comprobante" accept="application/pdf,image/*" required ${disabledAttr}>
        </label>
        <button id="btnEnviarComprobante" type="submit" ${disabledAttr}>Enviar comprobante</button>
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
  if (!form || !empresaId || !cycleId) return;

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
  const facturaCode = getFacturaCode(facturaSource);
  const descripcion = facturaSource?.descripcion_producto || "Servicio plataforma AXIOMA";
  const valorTotal = Number(facturaSource?.monto || facturaSource?.valor_total || 59900);

  const attemptsWithUrls = await Promise.all((attempts || []).map(async (item) => ({
    ...item,
    comprobante_signed_url: item?.estado === "aprobado" ? await resolveComprobanteUrl(item.comprobante_url).catch(() => "") : ""
  })));

  rootEl.innerHTML = [
    renderFactura({ empresa, facturaCode, descripcion, valorTotal }),
    !empresaId ? `<section class="billing-panel"><p class="helper-text">Vista estática disponible. Inicia sesión de empresa para habilitar carga e historial dinámico.</p></section>` : "",
    renderUploadForm(valorTotal, Boolean(billingCycle?.id) && Boolean(empresaId)),
    renderHistory(attemptsWithUrls, cycles)
  ].join("\n");

  attachUploadHandler({ empresaId, cycleId: billingCycle?.id || null });
}

document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});

window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});

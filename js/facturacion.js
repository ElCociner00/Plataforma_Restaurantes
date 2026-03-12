
import { supabase } from "./supabase.js";
import { buildRequestHeaders, getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const rootEl = document.getElementById("factura-contenido");
const pagoEl = document.getElementById("pago-comprobante");
const historialEl = document.getElementById("historial-pagos");

let currentFactura = null;
let isUploading = false;
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

const getCurrentPeriodo = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return year + "-" + month;
};

const sanitizeFilename = (name) => String(name || "archivo")
  .replace(/[^a-zA-Z0-9._-]+/g, "_")
  .replace(/^_+|_+$/g, "");

const setPagoMessage = (message, type) => {
  if (!pagoEl) return;
  const msgEl = pagoEl.querySelector("[data-pago-msg]");
  if (!msgEl) return;
  msgEl.textContent = message || "";
  msgEl.classList.remove("success", "error");
  if (type) msgEl.classList.add(type);
};

async function loadFacturaSupabase(empresaId) {
  const { data, error } = await supabase
    .from("facturacion")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

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

  if (!res.ok) throw new Error("Webhook facturacion fallo: " + res.status);
  const data = await res.json().catch(() => null);
  return data?.factura || data || null;
}

async function loadFactura(empresaId) {
  try {
    const fromSupabase = await loadFacturaSupabase(empresaId);
    if (fromSupabase) return fromSupabase;
  } catch {
    // fallback webhook
  }
  return loadFacturaByWebhook(empresaId).catch(() => null);
}

function getFacturaCode(factura) {
  if (factura?.numero_factura) return String(factura.numero_factura);
  const prefijo = factura?.prefijo_factura || "AX";
  const consecutivo = Number(factura?.consecutivo_actual || 1);
  return prefijo + "-" + consecutivo;
}

async function getCurrentBillingCycle(empresaId) {
  const periodo = getCurrentPeriodo();
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("id, estado, periodo")
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function loadPaymentAttempts(empresaId) {
  const { data, error } = await supabase
    .from("payment_attempts")
    .select("id, monto_reportado, estado, canal, referencia_externa, comprobante_url, created_at")
    .eq("empresa_id", empresaId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function loadBillingCycles(empresaId) {
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("id, periodo, estado, monto, fecha_emision, fecha_vencimiento")
    .eq("empresa_id", empresaId)
    .order("periodo", { ascending: false });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function createStatusBadge(status) {
  const safeStatus = String(status || "").toLowerCase() || "pendiente";
  return `<span class="status-badge ${escapeHtml(safeStatus)}">${escapeHtml(safeStatus)}</span>`;
}

async function getSignedComprobanteUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase
    .storage
    .from("comprobantes_pago")
    .createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl || null;
}

function render(empresa, factura) {
  const facturaCode = getFacturaCode(factura);

  const cantidad = Number(factura?.cantidad || 1);
  const descripcion = factura?.descripcion_producto || "Servicio plataforma AXIOMA";
  const ivaValor = 0;
  const valorUnitario = 59900;
  const valorTotal = 59900;

  rootEl.innerHTML = `
    <article class="factura-sheet">
      <section class="factura-top-row">
        <div class="bloque bloque-empresa">
          <h2>AXIOMA</h2>
          <p>by Global Nexo Shop</p>
          <p>DIR: Barranquilla, Atlantico, Colombia</p>
          <p>Tlf: 3044394874</p>
        </div>

        <div class="bloque bloque-cabecera-factura">
          <h3>FACTURA ELECTRONICA DE VENTA</h3>
          <div class="linea-factura"></div>
          <div class="factura-codigo-row">
            <span>Factura:</span>
            <strong>${escapeHtml(facturaCode)}</strong>
          </div>
        </div>
      </section>

      <section class="bloque bloque-tabla-producto">
        <div class="tabla-grid header">
          <div>Cantidad</div>
          <div>Medida</div>
          <div>Descripcion del Producto</div>
          <div>IVA</div>
          <div>Valor Unitario</div>
          <div>Valor Total</div>
        </div>
        <div class="tabla-grid body">
          <div>${escapeHtml(cantidad)}</div>
          <div>mes</div>
          <div>${escapeHtml(descripcion)}</div>
          <div>0</div>
          <div>${fmtMoney(valorUnitario)}</div>
          <div>${fmtMoney(valorTotal)}</div>
        </div>
      </section>

      <section class="factura-payment">
        <a class="btn-pago" href="https://mpago.li/15d6BkC" target="_blank" rel="noopener noreferrer">Paga aqui</a>
        <p>Link de Mercado Pago</p>
      </section>
    </article>
  `;
}

function renderPagoSection(empresa) {
  if (!pagoEl) return;
  if (!empresa?.id) {
    pagoEl.innerHTML = "";
    return;
  }

  pagoEl.innerHTML = `
    <div class="pago-card">
      <h2>Subir comprobante de pago</h2>
      <form class="pago-form" id="pago-form">
        <div class="pago-grid">
          <div class="pago-field">
            <label for="pago-monto">Monto</label>
            <input id="pago-monto" name="monto" type="number" min="0" step="0.01" required>
          </div>
          <div class="pago-field">
            <label for="pago-referencia">Referencia (opcional)</label>
            <input id="pago-referencia" name="referencia" type="text" maxlength="120" placeholder="Ej: TRANSF-1234">
          </div>
          <div class="pago-field">
            <label for="pago-canal">Canal</label>
            <select id="pago-canal" name="canal" required>
              <option value="transferencia">Transferencia</option>
              <option value="efectivo">Efectivo</option>
              <option value="otros">Otro</option>
            </select>
          </div>
          <div class="pago-field">
            <label for="pago-comprobante-input">Comprobante (imagen o PDF)</label>
            <input id="pago-comprobante-input" name="comprobante" type="file" accept="image/*,application/pdf" required>
          </div>
        </div>
        <div class="pago-actions">
          <button class="pago-btn" type="submit" data-pago-submit>Enviar comprobante</button>
          <span class="pago-msg" data-pago-msg></span>
        </div>
      </form>
    </div>
  `;

  const form = pagoEl.querySelector("#pago-form");
  if (form) form.addEventListener("submit", handlePagoSubmit);
}

async function renderHistorialSection(empresa) {
  if (!historialEl) return;
  if (!empresa?.id) {
    historialEl.innerHTML = "";
    return;
  }

  historialEl.innerHTML = `
    <div class="historial-card">
      <h2>Historial de pagos</h2>
      <div class="historial-section" data-historial-attempts>
        <h3>Comprobantes enviados</h3>
        <div class="historial-list">
          <p class="historial-empty">Cargando comprobantes...</p>
        </div>
      </div>
      <div class="historial-section" data-historial-cycles>
        <h3>Ciclos de facturacion</h3>
        <div class="historial-list">
          <p class="historial-empty">Cargando ciclos...</p>
        </div>
      </div>
    </div>
  `;

  try {
    const [attempts, cycles] = await Promise.all([
      loadPaymentAttempts(empresa.id),
      loadBillingCycles(empresa.id)
    ]);

    const attemptsContainer = historialEl.querySelector("[data-historial-attempts] .historial-list");
    if (attemptsContainer) {
      if (!attempts.length) {
        attemptsContainer.innerHTML = '<p class="historial-empty">No hay comprobantes enviados.</p>';
      } else {
        const attemptItems = await Promise.all(attempts.map(async (item) => {
          const estado = String(item.estado || "pendiente").toLowerCase();
          let linkHtml = "<span>-</span>";
          if (estado === "aprobado" && item.comprobante_url) {
            const signed = await getSignedComprobanteUrl(item.comprobante_url);
            if (signed) {
              linkHtml = `<a class="historial-link" href="${escapeHtml(signed)}" target="_blank" rel="noopener noreferrer">Ver comprobante</a>`;
            }
          }
          return `
            <div class="historial-item">
              <span><span class="historial-label">Fecha:</span> ${escapeHtml(fmtDateTime(item.created_at))}</span>
              <span><span class="historial-label">Monto:</span> ${escapeHtml(fmtMoney(item.monto_reportado))}</span>
              <span><span class="historial-label">Canal:</span> ${escapeHtml(item.canal || "-")}</span>
              <span><span class="historial-label">Estado:</span> ${createStatusBadge(estado)}</span>
              <span><span class="historial-label">Referencia:</span> ${escapeHtml(item.referencia_externa || "-")}</span>
              <span><span class="historial-label">Comprobante:</span> ${linkHtml}</span>
            </div>
          `;
        }));
        attemptsContainer.innerHTML = attemptItems.join("");
      }
    }

    const cyclesContainer = historialEl.querySelector("[data-historial-cycles] .historial-list");
    if (cyclesContainer) {
      if (!cycles.length) {
        cyclesContainer.innerHTML = '<p class="historial-empty">No hay ciclos registrados.</p>';
      } else {
        cyclesContainer.innerHTML = cycles.map((item) => `
          <div class="historial-item">
            <span><span class="historial-label">Periodo:</span> ${escapeHtml(item.periodo || "-")}</span>
            <span><span class="historial-label">Monto:</span> ${escapeHtml(fmtMoney(item.monto))}</span>
            <span><span class="historial-label">Emision:</span> ${escapeHtml(fmtDate(item.fecha_emision))}</span>
            <span><span class="historial-label">Vencimiento:</span> ${escapeHtml(fmtDate(item.fecha_vencimiento))}</span>
            <span><span class="historial-label">Estado:</span> ${createStatusBadge(item.estado || "pendiente")}</span>
          </div>
        `).join("");
      }
    }
  } catch (_error) {
    historialEl.innerHTML = `
      <div class="historial-card">
        <h2>Historial de pagos</h2>
        <p class="historial-empty">No se pudo cargar el historial.</p>
      </div>
    `;
  }
}

async function handlePagoSubmit(event) {
  event.preventDefault();
  if (isUploading) return;
  const form = event.currentTarget;
  const submitBtn = form.querySelector("[data-pago-submit]");
  const montoValue = Number(form.monto.value);
  const canal = form.canal.value;
  const referencia = form.referencia.value.trim();
  const file = form.comprobante.files?.[0];
  if (!montoValue || montoValue <= 0) {
    setPagoMessage("Ingresa un monto valido.", "error");
    return;
  }
  if (!file) {
    setPagoMessage("Selecciona un comprobante.", "error");
    return;
  }
  isUploading = true;
  if (submitBtn) submitBtn.disabled = true;
  setPagoMessage("Enviando comprobante...", "");
  try {
    const session = await getSessionConEmpresa().catch(() => null);
    const empresa = session?.empresa;
    if (!empresa?.id) {
      throw new Error("No se encontro empresa activa.");
    }
    const billingCycle = await getCurrentBillingCycle(empresa.id);
    if (!billingCycle?.id) {
      throw new Error("No hay ciclo de facturacion activo para este mes.");
    }
    const safeName = sanitizeFilename(file.name) || "comprobante";
    const filePath = empresa.id + "/" + Date.now() + "_" + safeName;
    const { error: uploadError } = await supabase.storage
      .from("comprobantes_pago")
      .upload(filePath, file, { upsert: false });
    if (uploadError) throw uploadError;
    const { error: insertError } = await supabase
      .from("payment_attempts")
      .insert({
        billing_cycle_id: billingCycle.id,
        empresa_id: empresa.id,
        canal,
        referencia_externa: referencia || null,
        monto_reportado: montoValue,
        comprobante_url: filePath,
        estado: "pendiente"
      });
    if (insertError) throw insertError;
    form.reset();
    setPagoMessage("Comprobante enviado. Te avisaremos cuando sea revisado.", "success");
    await renderHistorialSection(empresa);
  } catch (err) {
    const message = err?.message || "No fue posible enviar el comprobante.";
    setPagoMessage(message, "error");
  } finally {
    isUploading = false;
    if (submitBtn) submitBtn.disabled = false;
  }
}

export async function cargarFactura() {
  if (!rootEl) return;
  const session = await getSessionConEmpresa().catch(() => null);
  const empresa = session?.empresa || {};
  currentFactura = empresa?.id
    ? await loadFactura(empresa.id).catch(() => null)
    : null;
  render(empresa, currentFactura || {});
  renderPagoSection(empresa);
  await renderHistorialSection(empresa);
}
document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});
window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});


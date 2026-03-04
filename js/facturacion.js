import { supabase } from "./supabase.js";
import { buildRequestHeaders, getSessionConEmpresa, getUserContext } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const rootEl = document.getElementById("factura-contenido");

let currentFactura = null;
let currentMetodoPago = null;
let currentEmpresa = null;

const fmtMoney = (v) => Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("es-CO") : "-");

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

function buildQrUrl(payload) {
  return `${WEBHOOKS?.QR_GENERATOR?.url || "https://api.qrserver.com/v1/create-qr-code/"}?size=220x220&data=${encodeURIComponent(payload)}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",")[1] : raw);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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

  if (!res.ok) {
    throw new Error(`Webhook facturacion fallo: ${res.status}`);
  }

  const data = await res.json().catch(() => null);
  return data?.factura || data || null;
}

async function loadFactura(empresaId) {
  try {
    const fromSupabase = await loadFacturaSupabase(empresaId);
    if (fromSupabase) return fromSupabase;
  } catch {
    // fallback a webhook
  }

  const fromWebhook = await loadFacturaByWebhook(empresaId).catch(() => null);
  return fromWebhook;
}

async function loadMetodoPago(empresaId) {
  const { data } = await supabase
    .from("metodos_pago")
    .select("empresa_id,nombre,qr_data,qr_image_url,instrucciones,activo,orden")
    .eq("activo", true)
    .order("orden", { ascending: true });

  return (data || []).find((item) => String(item.empresa_id || "") === String(empresaId))
    || (data || []).find((item) => !item.empresa_id)
    || null;
}

function render(empresa, factura) {
  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || "Empresa";
  const prefijo = factura?.prefijo_factura || "AX";
  const consecutivo = Number(factura?.consecutivo_actual || 1);
  const plan = String(factura?.plan || empresa?.plan_actual || empresa?.plan || "free").toUpperCase();

  const valorServicio = Number(factura?.valor_plan || 0);
  const porcentajeIva = Number(factura?.iva_porcentaje || 0);
  const iva = Math.round(valorServicio * (porcentajeIva / 100));
  const deuda = Number(factura?.deuda || empresa?.deuda_actual || 0);
  const totalFactura = valorServicio + iva;
  const totalConDeuda = totalFactura + deuda;

  const qrPayload = currentMetodoPago?.qr_data || `EMPRESA:${nombreEmpresa}|FACTURA:${prefijo}-${consecutivo}|TOTAL:${totalConDeuda}`;
  const qrImage = currentMetodoPago?.qr_image_url || buildQrUrl(qrPayload);

  rootEl.innerHTML = `
    <article class="factura-oficio">
      <header class="factura-encabezado">
        <h2>AXIOMA by Global Nexo Shop</h2>
        <p class="factura-subtitulo">Factura electrónica de servicio</p>
      </header>

      <section class="factura-meta">
        <div>
          <h3>${escapeHtml(nombreEmpresa)}</h3>
          <p>Empresa deudora / cliente</p>
          <p>NIT: ${escapeHtml(empresa?.nit || "-")}</p>
          <p>Fecha de expedición: ${fmtDate(new Date())}</p>
          <p>Factura: ${escapeHtml(prefijo)}-${consecutivo}</p>
        </div>
        <div class="emisor">
          <p><strong>Axioma by Global Nexo Shop SAS</strong></p>
          <p>Barranquilla, Atlántico, Colombia</p>
          <p>Plataforma de gestión y automatización</p>
          <p>Plan activo: <strong>${escapeHtml(plan)}</strong></p>
          <p>Fecha corte: ${fmtDate(factura?.fecha_corte)}</p>
        </div>
      </section>

      <section class="factura-detalle">
        <div class="linea"><span>Valor servicio</span><strong>${fmtMoney(valorServicio)}</strong></div>
        <div class="linea"><span>IVA (${porcentajeIva}%)</span><strong>${fmtMoney(iva)}</strong></div>
        <div class="linea"><span>Deuda acumulada</span><strong>${fmtMoney(deuda)}</strong></div>
        <div class="linea total"><span>Total a pagar</span><strong>${fmtMoney(totalConDeuda)}</strong></div>
      </section>

      <section class="factura-pago">
        <img class="factura-qr" src="${qrImage}" alt="QR de pago">
        <div class="factura-actions">
          <p><strong>Método:</strong> ${escapeHtml(currentMetodoPago?.nombre || "Nequi")}</p>
          <p>${escapeHtml(currentMetodoPago?.instrucciones || "Escanea el QR, paga el monto exacto y adjunta el comprobante para revisión.")}</p>
          <label class="file-label" for="comprobantePago">Adjuntar comprobante</label>
          <input id="comprobantePago" type="file" accept="image/png,image/jpeg,application/pdf">
          <button id="btnEnviarPago" type="button" disabled>Enviar comprobante</button>
          <p id="facturaStatus" class="factura-status"></p>
        </div>
      </section>
    </article>
  `;
}

async function enviarPagoRevision(file) {
  const session = await getSessionConEmpresa();
  const context = await getUserContext();
  const empresa = session?.empresa;

  if (!empresa) throw new Error("No se encontró empresa activa");

  const base64 = await fileToBase64(file);
  const prefijo = currentFactura?.prefijo_factura || "AX";
  const consecutivo = Number(currentFactura?.consecutivo_actual || 1);
  const monto = Number(currentFactura?.valor_plan || 0);

  const payload = {
    empresa_id: empresa.id,
    facturacion_id: currentFactura?.id || null,
    prefijo,
    consecutivo,
    monto,
    fecha_pago: new Date().toISOString(),
    comprobante_nombre: file.name,
    comprobante_mime: file.type || "application/octet-stream",
    comprobante_base64: base64,
    estado: "pendiente",
    revisado_por: null
  };

  const { error } = await supabase.from("pagos_en_revision").insert(payload);
  if (error) throw error;

  if (currentFactura?.id) {
    await supabase
      .from("facturacion")
      .update({ consecutivo_actual: consecutivo + 1 })
      .eq("id", currentFactura.id);
  }

  return context;
}

function bindFacturaEvents() {
  const fileInput = document.getElementById("comprobantePago");
  const btnEnviar = document.getElementById("btnEnviarPago");
  const status = document.getElementById("facturaStatus");

  fileInput?.addEventListener("change", () => {
    btnEnviar.disabled = !(fileInput.files && fileInput.files[0]);
  });

  btnEnviar?.addEventListener("click", async () => {
    if (btnEnviar.disabled) return;
    const file = fileInput?.files?.[0];
    if (!file) return;

    btnEnviar.disabled = true;
    status.textContent = "Enviando comprobante...";
    try {
      await enviarPagoRevision(file);
      status.textContent = "Comprobante enviado. Queda en revisión.";
      fileInput.value = "";
    } catch {
      status.textContent = "No se pudo enviar el comprobante.";
      btnEnviar.disabled = false;
    }
  });
}

export async function cargarFactura() {
  if (!rootEl) return;
  rootEl.innerHTML = "<p>Cargando facturación...</p>";

  const session = await getSessionConEmpresa();
  const empresa = session?.empresa;
  currentEmpresa = empresa || null;

  if (!empresa) {
    rootEl.innerHTML = "<p>No se pudo cargar la empresa actual.</p>";
    return;
  }

  try {
    currentFactura = await loadFactura(empresa.id);
    currentMetodoPago = await loadMetodoPago(empresa.id);

    render(empresa, currentFactura || {});
    bindFacturaEvents();
  } catch {
    rootEl.innerHTML = "<p>Error cargando facturación. Si persiste, configura WEBHOOKS.FACTURACION_RESUMEN en js/webhooks.js.</p>";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});

window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});

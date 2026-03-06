import { supabase } from "./supabase.js";
import { buildRequestHeaders, getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const rootEl = document.getElementById("factura-contenido");

let currentFactura = null;

const fmtMoney = (v) => Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = (v) => {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-CO");
};

const escapeHtml = (value) => String(value || "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

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

  if (!res.ok) throw new Error(`Webhook facturacion fallo: ${res.status}`);
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
  return `${prefijo}-${consecutivo}`;
}

function render(empresa, factura) {
  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || "-";
  const nit = empresa?.nit || factura?.nit || "-";
  const correo = empresa?.correo_empresa || factura?.correo || "-";

  const facturaCode = getFacturaCode(factura);
  const fechaExpedicion = factura?.fecha_expedicion || new Date().toISOString();
  const fechaVencimiento = factura?.fecha_corte || factura?.fecha_vencimiento || "-";
  const expedidoPor = factura?.expedido_por || "Axioma by Global Nexo Shop SAS";

  const cantidad = Number(factura?.cantidad || 1);
  const descripcion = factura?.descripcion_producto || "Servicio plataforma AXIOMA";
  const ivaValor = Number(factura?.iva || 0);
  const valorUnitario = Number(factura?.valor_unitario || factura?.valor_plan || 0);
  const deuda = Number(factura?.deuda || empresa?.deuda_actual || 0);
  const valorTotal = Number(factura?.valor_total || valorUnitario + ivaValor + deuda);

  rootEl.innerHTML = `
    <article class="factura-sheet">
      <section class="factura-top-row">
        <div class="bloque bloque-empresa">
          <h2>AXIOMA</h2>
          <p>by Global Nexo Shop</p>
          <p>DIR: Barranquilla, Atlántico, Colombia</p>
          <p>Tlf: 3044394874</p>
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

      <section class="factura-datos-row">
        <div class="bloque bloque-datos-cliente">
          <p><strong>Nombre:</strong> ${escapeHtml(nombreEmpresa)}</p>
          <p><strong>NIT/CC:</strong> ${escapeHtml(nit)}</p>
          <p><strong>correo:</strong> ${escapeHtml(correo)}</p>
        </div>

        <div class="bloque bloque-datos-fecha">
          <p><strong>Fecha de expedicion:</strong> ${fmtDate(fechaExpedicion)}</p>
          <p><strong>Vencimiento:</strong> ${fmtDate(fechaVencimiento)}</p>
          <p><strong>Expedido por:</strong> ${escapeHtml(expedidoPor)}</p>
        </div>
      </section>

      <section class="bloque bloque-tabla-producto">
        <div class="tabla-grid header">
          <div>Cantidad</div>
          <div>Medida</div>
          <div>Descripción del Producto</div>
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

export async function cargarFactura() {
  if (!rootEl) return;

  const session = await getSessionConEmpresa().catch(() => null);
  const empresa = session?.empresa || {};

  currentFactura = empresa?.id
    ? await loadFactura(empresa.id).catch(() => null)
    : null;
  render(empresa, currentFactura || {});
}

document.addEventListener("DOMContentLoaded", () => {
  cargarFactura();
});

window.addEventListener("empresaCambiada", () => {
  cargarFactura();
});

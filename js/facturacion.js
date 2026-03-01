
import { supabase } from "./supabase.js";
import { getSessionConEmpresa, getUserContext } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";

const rootEl = document.getElementById("factura-contenido");
let currentFactura = null;
let currentMetodoPago = null;

const fmtMoney = (v) => Number(v || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });
const fmtDate = (v) => (v ? new Date(v).toLocaleDateString("es-CO") : "-");

function buildQrUrl(payload) {
  return `${WEBHOOKS?.QR_GENERATOR?.url || "https://api.qrserver.com/v1/create-qr-code/"}?size=180x180&data=${encodeURIComponent(payload)}`;
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

async function loadFactura(empresaId) {
  const { data, error } = await supabase
    .from("facturacion")
    .select("*")
    .eq("empresa_id", empresaId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function render(empresa, factura) {
  const nombreEmpresa = empresa?.nombre_comercial || empresa?.razon_social || "Empresa";
  const prefijo = factura?.prefijo_factura || "AX";
  const consecutivo = Number(factura?.consecutivo_actual || 1);
  const plan = String(factura?.plan || "free").toUpperCase();
  const servicio = Number(factura?.valor_plan || 0);
  const deuda = Number(factura?.deuda || 0);
  const iva = 0;
  const total = servicio + iva;

  const qrPayload = (currentMetodoPago?.qr_data || `EMPRESA:${nombreEmpresa}|PLAN:${plan}|TOTAL:${total}|FACTURA:${prefijo}-${consecutivo}`); const qrImage = currentMetodoPago?.qr_image_url || buildQrUrl(qrPayload);

  rootEl.innerHTML = `
    <article class="factura-oficio">
      <header class="factura-top">
        <h2>Axioma _by Global Nexo Shop_</h2>
        <p>Factura de servicio</p>
      </header>

      <section class="factura-grid">
        <div>
          <p><strong>Hola, ${nombreEmpresa}</strong></p>
          <p>Barranquilla, Atlantico, Colombia</p>
          <p>Fecha expedicion: ${fmtDate(new Date())}</p>
          <p>Factura: ${prefijo}-${consecutivo}</p>
        </div>
        <div>
          <p><strong>Plan:</strong> ${plan}</p>
          <p><strong>Valor plan:</strong> ${fmtMoney(servicio)}</p>
          <p><strong>Deuda actual:</strong> ${fmtMoney(deuda)}</p>
          <p><strong>Fecha corte:</strong> ${fmtDate(factura?.fecha_corte)}</p>
          <p><strong>Fecha suspension:</strong> ${fmtDate(factura?.fecha_suspension)}</p>
        </div>
      </section>

      <section class="factura-lineas">
        <div class="linea"><span>Servicio</span><strong>${fmtMoney(servicio)}</strong></div>
        <div class="linea"><span>IVA 0%</span><strong>${fmtMoney(iva)}</strong></div>
        <div class="linea total"><span>Total</span><strong>${fmtMoney(total)}</strong></div>
      </section>

      <section class="factura-pago">
        <img class="factura-qr" src="${qrImage}" alt="QR de pago">
        <div class="factura-actions">
          <p><strong>Metodo:</strong> ${currentMetodoPago?.nombre || "Nequi"}</p><p>${currentMetodoPago?.instrucciones || "Escanea el QR, paga el monto exacto y adjunta el comprobante."}</p><p>Tu pago sera verificado en un plazo de 1 a 12 horas. Si el valor no es exacto, el pago sera rechazado.</p><label class="file-label" for="comprobantePago">Adjuntar comprobante aqui</label>
          <input id="comprobantePago" type="file" accept="image/png,image/jpeg,application/pdf">
          <button id="btnEnviarPago" type="button" disabled>Enviar</button>
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
  if (!empresa) throw new Error("No se encontro empresa activa");
  if (!currentFactura) throw new Error("No hay factura configurada");

  const base64 = await fileToBase64(file);
  const prefijo = currentFactura.prefijo_factura || "AX";
  const consecutivo = Number(currentFactura.consecutivo_actual || 1);
  const monto = Number(currentFactura.valor_plan || 0);

  const payload = {
    empresa_id: empresa.id,
    facturacion_id: currentFactura.id,
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

  await supabase
    .from("facturacion")
    .update({ consecutivo_actual: consecutivo + 1 })
    .eq("id", currentFactura.id);

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
    const file = fileInput?.files?.[0];
    if (!file) return;

    status.textContent = "Enviando comprobante...";
    try {
      await enviarPagoRevision(file);
      status.textContent = "Comprobante enviado. Queda en revision.";
      btnEnviar.disabled = true;
      fileInput.value = "";
    } catch (_e) {
      status.textContent = "No se pudo enviar el comprobante.";
    }
  });
}

export async function cargarFactura() {
  if (!rootEl) return;
  const session = await getSessionConEmpresa();
  const empresa = session?.empresa;

  if (!empresa) {
    rootEl.innerHTML = "<p>No se pudo cargar la empresa actual.</p>";
    return;
  }

  try {
    currentFactura = await loadFactura(empresa.id);
    const { data: metodosRows } = await supabase.from("metodos_pago").select("empresa_id,nombre,qr_data,qr_image_url,instrucciones,activo,orden").eq("activo", true).order("orden", { ascending: true });
    currentMetodoPago = (metodosRows || []).find((item) => String(item.empresa_id || "") === String(empresa.id)) || (metodosRows || []).find((item) => !item.empresa_id) || null;
    render(empresa, currentFactura || {});
    bindFacturaEvents();
  } catch (_e) {
    rootEl.innerHTML = "<p>Error cargando facturacion.</p>";
  }
}

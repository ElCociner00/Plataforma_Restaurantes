import { getSessionConEmpresa } from "./session.js";
import { WEBHOOKS } from "./webhooks.js";
import { resolveEmpresaPlan } from "./plan.js";

const rootEl = document.getElementById("factura-contenido");

export async function cargarFactura() {
  const session = await getSessionConEmpresa();
  const empresa = session?.empresa;
  if (!rootEl) return;
  if (!empresa) {
    rootEl.innerHTML = "<p>No se pudo cargar la empresa actual.</p>";
    return;
  }

  const planActual = resolveEmpresaPlan(empresa);
  const planInfo = {
    free: { precio: 0, descripcion: "Plan Free" },
    pro: { precio: 150000, descripcion: "Plan Profesional" }
  }[planActual] || { precio: 0, descripcion: "Plan Free" };

  const subtotal = Number(planInfo.precio || 0);
  const iva = 0;
  const total = subtotal + iva;
  const periodo = new Date().toLocaleDateString("es-CO", { month: "long", year: "numeric" });

  rootEl.innerHTML = `
    <div class="factura-container">
      <div class="factura-header">
        <h2>FACTURA ELECTRONICA</h2>
        <div class="factura-meta">Formato aproximado UBL 2.1 (IVA 0%)</div>
        <p>NIT: ${empresa?.nit || "N/A"}</p>
      </div>
      <div class="factura-cuerpo">
        <table class="factura-items">
          <tr>
            <th>Concepto</th>
            <th>Valor</th>
          </tr>
          <tr>
            <td>${planInfo.descripcion} - ${periodo}</td>
            <td>$${subtotal.toLocaleString("es-CO")}</td>
          </tr>
          <tr>
            <td>IVA (0%)</td>
            <td>$${iva.toLocaleString("es-CO")}</td>
          </tr>
          <tr class="factura-total">
            <td>Total a pagar:</td>
            <td>$${total.toLocaleString("es-CO")}</td>
          </tr>
        </table>
        <div class="factura-info-pago">
          <p>Para pagar tu factura, transfiere el dinero a:</p>
          <p class="nequi"><strong>Nequi: 3044394874</strong></p>
          <div class="adjuntar-comprobante">
            <h4>Adjuntar comprobante de pago</h4>
            <input type="file" id="comprobante-pago" accept="image/*,.pdf">
            <button id="btnEnviarComprobante" type="button">Enviar comprobante</button>
          </div>
          <p class="factura-nota">Tu pago sera revisado y procesado. Se notificara por correo cuando se confirme.</p>
        </div>
      </div>
    </div>
  `;

  const btn = document.getElementById("btnEnviarComprobante");
  if (btn) {
    btn.addEventListener("click", () => subirComprobante(empresa?.id));
  }
}

async function subirComprobante(empresaId) {
  const fileInput = document.getElementById("comprobante-pago");
  const file = fileInput?.files?.[0];
  if (!file) {
    alert("Por favor selecciona un archivo");
    return;
  }

  const formData = new FormData();
  formData.append("comprobante", file);
  formData.append("empresa_id", empresaId || "");
  formData.append("fecha", new Date().toISOString());

  try {
    const response = await fetch(WEBHOOKS.COMPROBANTE_PAGO.url, {
      method: WEBHOOKS.COMPROBANTE_PAGO.metodo || "POST",
      body: formData
    });

    if (!response.ok) throw new Error("Webhook error");
    alert("Comprobante enviado correctamente. Sera revisado a la brevedad.");
    fileInput.value = "";
  } catch (_error) {
    alert("Error al enviar comprobante. Intenta nuevamente.");
  }
}

document.addEventListener("DOMContentLoaded", cargarFactura);


import { supabase } from "./supabase.js";
import { esSuperAdmin } from "./permisos.core.js";
import { getUserContext } from "./session.js";

const bodyEl = document.getElementById("revisionBody");
const statusEl = document.getElementById("statusRevision");
const btnReload = document.getElementById("btnRecargarRevision");

const setStatus = (m) => { if (statusEl) statusEl.textContent = m || ""; };

function render(rows) {
  if (!bodyEl) return;
  if (!rows.length) {
    bodyEl.innerHTML = '<tr><td colspan="6">No hay pagos pendientes.</td></tr>';
    return;
  }
  bodyEl.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.empresas?.nombre_comercial || r.empresas?.razon_social || r.empresa_id}</td>
      <td>${r.prefijo}-${r.consecutivo}</td>
      <td>${Number(r.monto || 0).toLocaleString("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 })}</td>
      <td>${new Date(r.fecha_pago).toLocaleDateString("es-CO")}</td>
      <td><a href="data:${r.comprobante_mime};base64,${r.comprobante_base64}" download="${r.comprobante_nombre || "comprobante"}">Ver adjunto</a></td>
      <td><div class="actions"><button data-action="aprobar" data-id="${r.id}">Aprobar</button><button data-action="rechazar" data-id="${r.id}">Rechazar</button></div></td>
    </tr>
  `).join("");
}

async function loadRows() {
  setStatus("Cargando pagos en revision...");
  const { data, error } = await supabase
    .from("pagos_en_revision")
    .select("id, empresa_id, prefijo, consecutivo, monto, fecha_pago, comprobante_nombre, comprobante_mime, comprobante_base64, estado, empresas ( nombre_comercial, razon_social )")
    .eq("estado", "pendiente")
    .order("fecha_pago", { ascending: true });

  if (error) {
    setStatus("No se pudieron cargar pagos.");
    render([]);
    return;
  }

  render(data || []);
  setStatus(`${(data || []).length} pago(s) pendiente(s).`);
}

async function resolver(id, aprobar) {
  const ctx = await getUserContext();
  const { error } = await supabase.rpc("resolver_pago_revision", {
    p_revision_id: id,
    p_aprobar: aprobar,
    p_revisado_por: ctx?.user?.id || null,
    p_observaciones: null
  });
  if (error) throw error;
}

document.addEventListener("DOMContentLoaded", async () => {
  const ok = await esSuperAdmin().catch(() => false);
  if (!ok) {
    window.location.replace("/Plataforma_Restaurantes/dashboard/");
    return;
  }

  await loadRows();
  btnReload?.addEventListener("click", loadRows);

  bodyEl?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;

    try {
      await resolver(btn.dataset.id, btn.dataset.action === "aprobar");
      await loadRows();
    } catch {
      setStatus("No se pudo procesar el pago.");
    }
  });
});

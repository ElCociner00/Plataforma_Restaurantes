import { bootRappiShell, escapeHtml, invokeRappi, isAdminContext, setBusy, toast } from "./core.js?v=20260914rappi6";
import { APP_URLS } from "../urls.js";

// Regreso desde Rappi Partners: ?code=…&state=… (o ?error=… si el dueño canceló).
const params = new URLSearchParams(window.location.search);
const statusBox = document.querySelector("#link-status");
let linkId = null;

try {
  await bootRappiShell();
  if (!isAdminContext()) {
    window.location.replace(APP_URLS.rappiOperacion);
  } else {
    // El código es de un solo uso: se quita de la barra para que recargar no lo reenvíe.
    window.history.replaceState(null, "", window.location.pathname);
    await finish();
  }
} catch (error) {
  console.error("[rappi-conectar]", error);
  showStatus(error.message || "No fue posible completar la vinculación.", "warning");
}

async function finish() {
  if (params.get("error")) {
    showStatus("El inicio de sesión en Rappi se canceló. Puedes intentarlo de nuevo desde Integración Rappi.", "warning");
    return;
  }
  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    showStatus("Este enlace no trae la autorización de Rappi. Inicia la vinculación desde Integración Rappi.", "warning");
    return;
  }
  const result = await invokeRappi("rappi-vincular", { action: "finish", code, state });
  linkId = result.link_id;
  statusBox.hidden = true;
  document.querySelector("#link-account").textContent = result.merchant_email
    ? `Cuenta de Rappi: ${result.merchant_email}`
    : "Cuenta de Rappi confirmada.";
  const rows = result.stores.map((store) => `<tr>
    <td><input type="checkbox" data-store-id="${escapeHtml(store.store_id)}" data-store-name="${escapeHtml(store.name)}" ${store.integrated ? "disabled" : ""}></td>
    <td><strong>${escapeHtml(store.name || store.store_id)}</strong></td>
    <td>${escapeHtml(store.brand || "—")}</td>
    <td>${store.integrated ? "Ya conectada" : "Sin conectar"}</td></tr>`).join("");
  document.querySelector("#link-store-rows").innerHTML = rows ||
    `<tr><td class="empty-cell" colspan="4">Esta cuenta no tiene tiendas en Rappi.</td></tr>`;
  document.querySelector("#link-stores").hidden = false;
  document.querySelector("#link-provision").addEventListener("click", provision);
}

async function provision(event) {
  const boton = event.currentTarget;
  const stores = [...document.querySelectorAll("[data-store-id]:checked")]
    .map((input) => ({ store_id: input.dataset.storeId, name: input.dataset.storeName }));
  if (!stores.length) return toast("Elige al menos una tienda.", "error");
  setBusy(boton, true, "Conectando…");
  try {
    const result = await invokeRappi("rappi-vincular", { action: "provision", link_id: linkId, stores });
    const rejected = Array.isArray(result.rejected) ? result.rejected.length : 0;
    toast(`Rappi recibió ${result.accepted.length} tienda(s)${rejected ? `; rechazó ${rejected}` : ""}. La activación tarda unos minutos.`, "success");
    boton.textContent = "Solicitud enviada";
  } catch (error) {
    toast(error.message, "error");
    setBusy(boton, false);
  }
}

function showStatus(message, type) {
  statusBox.hidden = false;
  statusBox.className = `notice ${type}`;
  statusBox.textContent = message;
}

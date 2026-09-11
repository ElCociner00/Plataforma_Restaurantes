import {
  bootRappiShell, emptyRow, escapeHtml, formatDate, invokeRappi, isAdminContext,
  setBusy, statusBadge, toast,
} from "./core.js?v=20260911rappi4";
import { APP_URLS } from "../urls.js";

try {
  await bootRappiShell();
  if (!isAdminContext()) {
    window.location.replace(APP_URLS.rappiOperacion);
  } else {
    wireActions();
    await loadStatus();
  }
} catch (error) {
  console.error("[rappi-integration]", error);
  toast(error.message || "No fue posible abrir la integración.", "error");
}

function wireActions() {
  document.querySelector("#refresh-status").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Actualizando…");
    try { await loadStatus(); }
    catch (error) { toast(error.message, "error"); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector("#credentials-form").addEventListener("submit", onboard);
  document.querySelector("#menu-form").addEventListener("submit", uploadMenu);
}

async function loadStatus() {
  const result = await invokeRappi("rappi-admin", { action: "status", environment: "DEV" });
  renderStatus(result);
}

function renderStatus(result) {
  const stores = result.stores || [];
  const activeHooks = (result.webhooks || []).filter((hook) => hook.state === "ENABLE").length;
  const hasCredentials = result.credentials?.operational === true;
  const tokenValid = (result.tokens || []).some((token) => token.scope === "OPERATIONAL" && token.valid);
  const receivedDates = [
    ...stores.map((store) => store.last_ping_at || store.menu_updated_at),
    ...(result.webhooks || []).map((hook) => hook.last_received_at),
  ].filter(Boolean).sort();
  const lastReceived = receivedDates.at(-1) || null;
  const connected = result.configured && result.connection?.status === "CONNECTED" && tokenValid;

  document.querySelector("#connection-status").innerHTML = statusBadge(connected ? "CONNECTED" : result.configured ? result.connection?.status : "NOT_CONFIGURED");
  document.querySelector("#connected-stores").textContent = String(stores.length);
  document.querySelector("#last-update").textContent = formatDate(lastReceived);
  document.querySelector("#configuration-status").textContent = activeHooks === 8 ? "Lista" : result.configured ? "En proceso" : "Pendiente";

  setStep("step-credentials", hasCredentials && tokenValid, hasCredentials ? "Validada" : "Pendiente");
  setStep("step-stores", stores.length > 0, stores.length ? `${stores.length} encontradas` : "Pendiente");
  setStep("step-webhooks", activeHooks === 8, activeHooks === 8 ? "Lista" : `${activeHooks} de 8`);
  setStep("step-data", Boolean(lastReceived), lastReceived ? "Recibida" : "Esperando prueba");

  const storesBody = document.querySelector("#integration-stores");
  storesBody.innerHTML = stores.length
    ? stores.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.connectivity_status || (connected ? "CONNECTED" : "UNKNOWN"))}</td><td>${formatDate(store.last_ping_at || store.menu_updated_at)}</td><td>${statusBadge(store.menu_approval_status || "PENDING")}</td><td><label class="switch"><input type="checkbox" data-auto-accept="${escapeHtml(store.id)}" ${store.auto_accept !== false ? "checked" : ""}><span>${store.auto_accept !== false ? "Encendida" : "Apagada"}</span></label></td></tr>`).join("")
    : emptyRow(5, "Conecta Rappi para identificar las tiendas.");
  storesBody.querySelectorAll("[data-auto-accept]").forEach((input) => input.addEventListener("change", toggleAutoAccept));
  const menuStore = document.querySelector("#menu-store");
  const selectedStore = menuStore.value;
  menuStore.innerHTML = stores.length
    ? `<option value="">Selecciona una tienda</option>${stores.map((store) => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.store_name || "Tienda Rappi")}</option>`).join("")}`
    : `<option value="">Conecta Rappi primero</option>`;
  if (stores.some((store) => store.id === selectedStore)) menuStore.value = selectedStore;

  const openErrors = result.errors || [];
  const incidentCard = document.querySelector("#incident-card");
  incidentCard.hidden = openErrors.length === 0;
  if (openErrors.length) {
    const latest = openErrors[0];
    document.querySelector("#incident-message").textContent = `${latest.public_message || "Se detectó un problema con la conexión."} Última detección: ${formatDate(latest.last_occurred_at)}.`;
  }

  const message = document.querySelector("#connection-message");
  message.hidden = false;
  message.classList.toggle("warning", !(connected && activeHooks === 8));
  message.textContent = connected && activeHooks === 8
    ? (lastReceived ? "Conexión activa. Enkrato está recibiendo información de Rappi." : "Conexión configurada. Falta recibir una prueba desde Rappi.")
    : result.configured ? "La conexión aún requiere completar su configuración." : "Ingresa tus credenciales de pruebas para comenzar.";
}

async function toggleAutoAccept(event) {
  const input = event.currentTarget;
  const enabled = input.checked;
  if (!enabled && !window.confirm("Si apagas la aceptación automática, alguien debe aceptar cada pedido en menos de 6 minutos (con «Aceptar ahora» en Pedidos Rappi o desde la tablet de Rappi) o Rappi lo cancela. ¿Apagarla?")) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    await invokeRappi("rappi-admin", { action: "store_settings", environment: "DEV", store_id: input.dataset.autoAccept, auto_accept: enabled });
    input.nextElementSibling.textContent = enabled ? "Encendida" : "Apagada";
    toast(enabled ? "Enkrato aceptará los pedidos de esta tienda." : "Los pedidos de esta tienda deberán aceptarse a mano: «Aceptar ahora» en Pedidos Rappi o la tablet de Rappi.");
  } catch (error) {
    input.checked = !enabled;
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

function setStep(id, complete, label) {
  const item = document.querySelector(`#${id}`);
  item.classList.toggle("complete", complete);
  item.querySelector("strong").textContent = label;
}

async function onboard(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  setBusy(button, true, "Conectando…");
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = await invokeRappi("rappi-admin", { action: "onboard", environment: "DEV", ...values });
    event.currentTarget.reset();
    const failures = result.subscription?.results?.filter((row) => !row.ok).length || 0;
    toast(failures ? `La conexión quedó parcial: ${failures} configuración(es) requieren revisión.` : "Rappi quedó conectado y configurado automáticamente.", failures ? "error" : "success");
    await loadStatus();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

async function uploadMenu(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const file = document.querySelector("#menu-file").files?.[0];
  if (!file) { toast("Selecciona un archivo de menú.", "error"); return; }
  if (file.size > 2_000_000) { toast("El archivo no puede superar 2 MB.", "error"); return; }
  setBusy(button, true, "Validando…");
  try {
    const parsed = JSON.parse(await file.text());
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items) || !items.length) throw new Error("El archivo debe contener una lista de productos en items.");
    const result = await invokeRappi("rappi-admin", {
      action: "upload_menu",
      environment: "DEV",
      store_id: document.querySelector("#menu-store").value,
      items,
    });
    event.currentTarget.reset();
    toast(`Menú enviado: ${result.items} producto(s). Rappi iniciará su validación.`);
    await loadStatus();
  } catch (error) {
    toast(error instanceof SyntaxError ? "El archivo no contiene JSON válido." : error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

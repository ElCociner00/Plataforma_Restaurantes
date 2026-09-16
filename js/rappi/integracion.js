import {
  bootRappiShell, closeDialogOnBackdrop, emptyRow, escapeHtml, formatDate, formatMoney, invokeRappi,
  isAdminContext, setBusy, statusBadge, toast,
} from "./core.js?v=20260914rappi6";
import { APP_URLS } from "../urls.js";

try {
  await bootRappiShell();
  if (!isAdminContext()) {
    window.location.replace(APP_URLS.rappiOperacion);
  } else {
    wireActions();
    await loadStatus();
    await loadPartnerLink();
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
  document.querySelector("#partner-link-start").addEventListener("click", startPartnerLink);
}

/** La vinculación solo aparece cuando Rappi entregó el client_id de Partners. */
async function loadPartnerLink() {
  try {
    const config = await invokeRappi("rappi-vincular", { action: "config", environment: "DEV" });
    document.querySelector("#partner-link-card").hidden = !config.available;
  } catch (error) {
    console.warn("[rappi-integration] vinculación no disponible", error);
  }
}

async function startPartnerLink(event) {
  const boton = event.currentTarget;
  setBusy(boton, true, "Abriendo Rappi…");
  try {
    const result = await invokeRappi("rappi-vincular", { action: "start", environment: "DEV" });
    window.location.assign(result.authorize_url);
  } catch (error) {
    toast(error.message, "error");
    setBusy(boton, false);
  }
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
    ? stores.map((store) => `<tr>
        <td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td>
        <td><label class="switch"><input type="checkbox" data-store-open="${escapeHtml(store.id)}" disabled><span>Consultando…</span></label></td>
        <td>${statusBadge(store.connectivity_status || (connected ? "CONNECTED" : "UNKNOWN"))}</td>
        <td>${formatDate(store.last_ping_at || store.menu_updated_at)}</td>
        <td><button class="link-button" type="button" data-store-menu="${escapeHtml(store.id)}" data-store-name="${escapeHtml(store.store_name || "Tienda Rappi")}" title="Ver el menú vigente en Rappi">${statusBadge(store.menu_approval_status || "PENDING")} <span class="helper">Ver menú</span></button></td>
        <td><label class="switch"><input type="checkbox" data-auto-accept="${escapeHtml(store.id)}" ${store.auto_accept !== false ? "checked" : ""}><span>${store.auto_accept !== false ? "Encendida" : "Apagada"}</span></label></td>
        <td><button class="button secondary compact" type="button" data-checkin="${escapeHtml(store.id)}">Ver código</button></td>
      </tr>`).join("")
    : emptyRow(7, "Conecta Rappi para identificar las tiendas.");
  storesBody.querySelectorAll("[data-auto-accept]").forEach((input) => input.addEventListener("change", toggleAutoAccept));
  storesBody.querySelectorAll("[data-store-open]").forEach((input) => {
    input.addEventListener("change", toggleStoreOpen);
    loadStoreOpen(input);
  });
  storesBody.querySelectorAll("[data-store-menu]").forEach((button) => button.addEventListener("click", showStoreMenu));
  storesBody.querySelectorAll("[data-checkin]").forEach((button) => button.addEventListener("click", showCheckinCode));
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
  if (!enabled && !window.confirm("Si apagas la aceptación automática, alguien debe aceptar cada pedido en menos de 6 minutos (con la tablet de Rappi) o Rappi lo cancela. ¿Apagarla?")) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    await invokeRappi("rappi-admin", { action: "store_settings", environment: "DEV", store_id: input.dataset.autoAccept, auto_accept: enabled });
    input.nextElementSibling.textContent = enabled ? "Encendida" : "Apagada";
    toast(enabled ? "Enkrato aceptará los pedidos de esta tienda." : "Los pedidos de esta tienda deberán aceptarse desde la tablet de Rappi.");
  } catch (error) {
    input.checked = !enabled;
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

/** Abierta o cerrada en la app de Rappi: se consulta a Rappi, no se guarda en Enkrato. */
async function loadStoreOpen(input) {
  const label = input.nextElementSibling;
  try {
    const result = await invokeRappi("rappi-operaciones", { action: "store_availability", environment: "DEV", store_id: input.dataset.storeOpen });
    input.checked = result.enabled === true;
    label.textContent = result.enabled === null ? "Sin dato" : result.enabled ? "Abierta" : "Cerrada";
    input.disabled = false;
  } catch (error) {
    label.textContent = "No disponible";
    console.warn("[rappi-integration] disponibilidad de tienda", error);
  }
}

async function toggleStoreOpen(event) {
  const input = event.currentTarget;
  const enabled = input.checked;
  if (!enabled && !window.confirm("La tienda dejará de aparecer abierta en Rappi y no recibirá pedidos hasta que la vuelvas a abrir. ¿Cerrarla?")) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    const result = await invokeRappi("rappi-operaciones", { action: "store_availability", environment: "DEV", store_id: input.dataset.storeOpen, enabled });
    input.checked = result.enabled === true;
    input.nextElementSibling.textContent = result.enabled ? "Abierta" : "Cerrada";
    if (result.ok === false) toast(`Rappi no permitió el cambio${result.reason ? `: ${result.reason}` : "."}`, "error");
    else toast(result.enabled ? "La tienda quedó abierta en Rappi." : "La tienda quedó cerrada en Rappi.");
  } catch (error) {
    input.checked = !enabled;
    toast(error.message, "error");
  } finally {
    input.disabled = false;
  }
}

const menuDialog = document.querySelector("#menu-dialog");
closeDialogOnBackdrop(menuDialog);
menuDialog.querySelector("[data-close-dialog]").addEventListener("click", () => menuDialog.close());

async function showStoreMenu(event) {
  const button = event.currentTarget;
  const body = document.querySelector("#menu-dialog-body");
  document.querySelector("#menu-dialog-title").textContent = button.dataset.storeName;
  body.innerHTML = `<p class="helper">Consultando el menú en Rappi…</p>`;
  menuDialog.showModal();
  try {
    const { products } = await invokeRappi("rappi-operaciones", { action: "store_menu", environment: "DEV", store_id: button.dataset.storeMenu });
    body.innerHTML = products.length
      ? `<p class="helper">${products.length} productos publicados.</p>${products.map((product) => `
        <article class="menu-product">
          <header><strong>${escapeHtml(product.name)}</strong><span>${formatMoney(product.price)}</span></header>
          ${product.sku ? `<span class="helper">SKU ${escapeHtml(product.sku)}</span>` : ""}
          ${product.toppings.length ? `<ul class="menu-toppings">${product.toppings.map((topping) => `<li>${escapeHtml(topping.name)}${topping.category ? ` · ${escapeHtml(topping.category)}` : ""}${topping.price ? ` · +${formatMoney(topping.price)}` : ""}</li>`).join("")}</ul>` : ""}
        </article>`).join("")}`
      : `<p class="helper">Rappi no tiene productos publicados para esta tienda.</p>`;
  } catch (error) {
    body.innerHTML = `<p class="notice warning">${escapeHtml(error.message)}</p>`;
  }
}

async function showCheckinCode(event) {
  const button = event.currentTarget;
  setBusy(button, true, "Consultando…");
  try {
    const result = await invokeRappi("rappi-operaciones", { action: "store_checkin_code", environment: "DEV", store_id: button.dataset.checkin });
    button.outerHTML = result.code
      ? `<strong>${escapeHtml(result.code)}</strong>${result.expired_at ? `<br><span class="helper">Vence ${escapeHtml(result.expired_at)}</span>` : ""}`
      : `<span class="helper">Rappi no asignó código</span>`;
  } catch (error) {
    toast("Rappi no entregó el código de check-in en este momento.", "error");
    setBusy(button, false);
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

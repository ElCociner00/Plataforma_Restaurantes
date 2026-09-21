import {
  bootRappiShell, closeDialogOnBackdrop, emptyRow, escapeHtml, formatDate, formatMoney, invokeRappi,
  isAdminContext, setBusy, statusBadge, toast,
} from "./core.js?v=20260914rappi6";
import { APP_URLS } from "../urls.js";

const ENV = "DEV";
const state = { status: null, menu: null };

try {
  await bootRappiShell();
  if (!isAdminContext()) {
    window.location.replace(APP_URLS.rappiOperacion);
  } else {
    wireActions();
    await revisar();
  }
} catch (error) {
  console.error("[rappi-integration]", error);
  toast(error.message || "No fue posible abrir la integración.", "error");
}

function wireActions() {
  document.querySelector("#refresh-status").addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Revisando…");
    try { await revisar(); toast("Revisión terminada."); }
    catch (error) { toast(error.message, "error"); }
    finally { setBusy(event.currentTarget, false); }
  });
  document.querySelector("#credentials-form").addEventListener("submit", onboard);
}

async function revisar() {
  state.status = await invokeRappi("rappi-admin", { action: "status", environment: ENV });
  state.menu = await invokeRappi("rappi-operaciones", { action: "menu_status" }).catch(() => null);
  render();
}

/**
 * El checklist habla en resultados, no en jerga: cada punto dice qué significa
 * para el negocio y ofrece una prueba que se ejecuta contra Rappi en vivo.
 */
function comprobaciones() {
  const s = state.status ?? {};
  const stores = s.stores ?? [];
  const webhooks = s.webhooks ?? [];
  const activos = webhooks.filter((hook) => hook.state === "ENABLE");
  const firmados = webhooks.filter((hook) => hook.last_valid_signature_at);
  const pedidos = webhooks.find((hook) => hook.event_type === "NEW_ORDER");
  const tokenOperativo = (s.tokens ?? []).some((token) => token.scope === "OPERATIONAL" && token.valid);
  const menuAprobado = (state.menu ?? []).filter((fila) => fila.status === "APPROVED");
  const productos = (state.menu ?? []).reduce((total, fila) => total + (fila.product_count ?? 0), 0);

  return [
    {
      id: "credenciales",
      titulo: "Rappi reconoce tus claves",
      detalle: s.credentials?.operational
        ? (tokenOperativo ? "Enkrato entra a Rappi con tus claves." : "Las claves están guardadas, falta confirmar el acceso.")
        : "Todavía no has guardado las claves que te dio Rappi.",
      ok: Boolean(s.credentials?.operational && tokenOperativo),
      prueba: async () => {
        const r = await invokeRappi("rappi-admin", { action: "test_operational", environment: ENV });
        return r.auth_ok ? "Rappi aceptó tus claves." : "Rappi no aceptó las claves.";
      },
    },
    {
      id: "tiendas",
      titulo: "Tus tiendas están identificadas",
      detalle: stores.length ? `${stores.length} tienda(s): ${stores.map((t) => t.store_name || t.rappi_store_id).join(", ")}` : "Aún no vemos tiendas en tu cuenta de Rappi.",
      ok: stores.length > 0,
      prueba: async () => {
        const r = await invokeRappi("rappi-admin", { action: "test_operational", environment: ENV });
        return `Rappi reporta ${r.stores_found ?? stores.length} tienda(s).`;
      },
    },
    {
      id: "avisos",
      titulo: "Rappi nos avisa de cada pedido",
      detalle: `${activos.length} de 8 avisos configurados${activos.length === 8 ? "." : ": falta terminar la configuración."}`,
      ok: activos.length === 8,
      prueba: async () => {
        const r = await invokeRappi("rappi-admin", { action: "remote_webhooks", environment: ENV });
        const eventos = Array.isArray(r) ? r.length : (r?.data?.length ?? 0);
        return `Rappi tiene ${eventos} aviso(s) registrados para tu cuenta.`;
      },
    },
    {
      id: "firma",
      titulo: "Cada aviso llega firmado",
      detalle: firmados.length
        ? `Último aviso verificado: ${formatDate(firmados.map((h) => h.last_valid_signature_at).sort().at(-1))}`
        : "Todavía no hemos recibido un aviso firmado de Rappi.",
      ok: firmados.length > 0,
      prueba: async () => {
        await revisar();
        const verificados = (state.status.webhooks ?? []).filter((h) => h.last_valid_signature_at).length;
        return verificados ? `${verificados} aviso(s) con firma verificada.` : "Sin avisos firmados todavía.";
      },
    },
    {
      id: "pedidos",
      titulo: "Los pedidos entran a Enkrato",
      detalle: pedidos?.last_received_at
        ? `Último pedido recibido: ${formatDate(pedidos.last_received_at)}`
        : "Todavía no ha entrado ningún pedido de Rappi.",
      ok: Boolean(pedidos?.last_received_at),
      prueba: async () => {
        const r = await invokeRappi("rappi-data", { action: "operation_summary" });
        return `${r.total_orders ?? 0} pedido(s) registrados en Enkrato.`;
      },
    },
    {
      id: "menu",
      titulo: "Tu menú está publicado en Rappi",
      detalle: state.menu
        ? (menuAprobado.length ? `Aprobado en ${menuAprobado.length} tienda(s) · ${productos} productos publicados` : "Rappi todavía no aprueba tu menú.")
        : "No pudimos consultar el menú en Rappi.",
      ok: menuAprobado.length > 0,
      accion: { etiqueta: "Ir a Menú", url: APP_URLS.rappiMenu },
      prueba: async () => {
        state.menu = await invokeRappi("rappi-operaciones", { action: "menu_status" });
        const aprobadas = state.menu.filter((fila) => fila.status === "APPROVED").length;
        return aprobadas ? `Menú aprobado en ${aprobadas} tienda(s).` : "Rappi aún no aprueba el menú.";
      },
    },
  ];
}

function render() {
  const s = state.status ?? {};
  const stores = s.stores ?? [];
  const lista = comprobaciones();
  const listos = lista.filter((fila) => fila.ok).length;

  document.querySelector("#checklist-summary").textContent = listos === lista.length
    ? "Todo listo: la integración con Rappi está funcionando."
    : `${listos} de ${lista.length} puntos listos. Lo que falta está marcado abajo.`;

  document.querySelector("#checklist").innerHTML = lista.map((fila) => `
    <li class="check-row ${fila.ok ? "ok" : "pending"}" data-check="${escapeHtml(fila.id)}">
      <span class="check-light" aria-hidden="true"></span>
      <div class="check-text">
        <strong>${escapeHtml(fila.titulo)}</strong>
        <span class="helper">${escapeHtml(fila.detalle)}</span>
        <span class="helper check-result" hidden></span>
      </div>
      <div class="check-actions">
        ${fila.accion ? `<a class="button secondary compact" href="${escapeHtml(fila.accion.url)}">${escapeHtml(fila.accion.etiqueta)}</a>` : ""}
        <button class="button secondary compact" type="button" data-test="${escapeHtml(fila.id)}">Probar</button>
      </div>
    </li>`).join("");

  document.querySelectorAll("[data-test]").forEach((boton) => {
    boton.addEventListener("click", () => probar(boton, lista.find((fila) => fila.id === boton.dataset.test)));
  });

  const storesBody = document.querySelector("#integration-stores");
  storesBody.innerHTML = stores.length
    ? stores.map((store) => `<tr>
        <td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td>
        <td><label class="switch"><input type="checkbox" data-store-open="${escapeHtml(store.id)}" disabled><span>Consultando…</span></label></td>
        <td>${statusBadge(store.connectivity_status || "UNKNOWN")}</td>
        <td>${formatDate(store.last_ping_at || store.menu_updated_at)}</td>
        <td><button class="link-button" type="button" data-store-menu="${escapeHtml(store.id)}" data-store-name="${escapeHtml(store.store_name || "Tienda Rappi")}">${statusBadge(store.menu_approval_status || "PENDING")} <span class="helper">Ver menú</span></button></td>
        <td><label class="switch"><input type="checkbox" data-auto-accept="${escapeHtml(store.id)}" ${store.auto_accept !== false ? "checked" : ""}><span>${store.auto_accept !== false ? "Encendida" : "Apagada"}</span></label></td>
        <td><button class="button secondary compact" type="button" data-checkin="${escapeHtml(store.id)}">Ver código</button></td>
      </tr>`).join("")
    : emptyRow(7, "Conecta Rappi para identificar las tiendas.");

  storesBody.querySelectorAll("[data-auto-accept]").forEach((input) => input.addEventListener("change", toggleAutoAccept));
  storesBody.querySelectorAll("[data-store-open]").forEach((input) => {
    input.addEventListener("change", toggleStoreOpen);
    loadStoreOpen(input);
  });
  storesBody.querySelectorAll("[data-store-menu]").forEach((b) => b.addEventListener("click", showStoreMenu));
  storesBody.querySelectorAll("[data-checkin]").forEach((b) => b.addEventListener("click", showCheckinCode));

  const abiertos = s.errors ?? [];
  const incidentCard = document.querySelector("#incident-card");
  incidentCard.hidden = abiertos.length === 0;
  if (abiertos.length) {
    const ultimo = abiertos[0];
    document.querySelector("#incident-message").textContent =
      `${ultimo.public_message || "Se detectó un problema con la conexión."} Última vez: ${formatDate(ultimo.last_occurred_at)}.`;
  }

  const mensaje = document.querySelector("#connection-message");
  mensaje.hidden = Boolean(s.configured);
  mensaje.classList.add("warning");
  mensaje.textContent = "Ingresa las claves que te entregó Rappi para comenzar.";
}

async function probar(boton, fila) {
  if (!fila) return;
  const contenedor = boton.closest(".check-row");
  const resultado = contenedor.querySelector(".check-result");
  setBusy(boton, true, "Probando…");
  try {
    const mensaje = await fila.prueba();
    resultado.hidden = false;
    resultado.textContent = mensaje;
    await revisar();
  } catch (error) {
    resultado.hidden = false;
    resultado.textContent = error.message;
    contenedor.classList.add("pending");
    toast(error.message, "error");
  } finally {
    setBusy(boton, false);
  }
}

async function toggleAutoAccept(event) {
  const input = event.currentTarget;
  const enabled = input.checked;
  if (!enabled && !window.confirm("Si apagas la aceptación automática, cada pedido debe aceptarse a mano en menos de 6 minutos o Rappi lo cancela. ¿Apagarla?")) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    await invokeRappi("rappi-admin", { action: "store_settings", environment: ENV, store_id: input.dataset.autoAccept, auto_accept: enabled });
    input.nextElementSibling.textContent = enabled ? "Encendida" : "Apagada";
    toast(enabled ? "Enkrato aceptará los pedidos de esta tienda." : "Los pedidos deberán aceptarse a mano.");
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
    const result = await invokeRappi("rappi-operaciones", { action: "store_availability", environment: ENV, store_id: input.dataset.storeOpen });
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
    const result = await invokeRappi("rappi-operaciones", { action: "store_availability", environment: ENV, store_id: input.dataset.storeOpen, enabled });
    if (result.ok === false) {
      input.checked = !enabled;
      toast(`Rappi no permitió el cambio${result.reason ? `: ${result.reason}` : "."}`, "error");
      return;
    }
    input.checked = enabled;
    if (!enabled) {
      input.nextElementSibling.textContent = "Cerrada";
      toast("La tienda quedó cerrada en Rappi.");
      return;
    }
    // Encender no basta si Rappi aún no publica la tienda («Not ready to sell»).
    const check = await invokeRappi("rappi-operaciones", { action: "store_availability", environment: ENV, store_id: input.dataset.storeOpen });
    input.nextElementSibling.textContent = check.enabled ? "Abierta" : "Encendida, sin publicar";
    toast(check.enabled
      ? "La tienda quedó abierta en Rappi."
      : "La tienda quedó encendida, pero Rappi todavía no la publica para vender. Eso lo habilita Rappi.");
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
    const { products } = await invokeRappi("rappi-operaciones", { action: "store_menu", environment: ENV, store_id: button.dataset.storeMenu });
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
    const result = await invokeRappi("rappi-operaciones", { action: "store_checkin_code", environment: ENV, store_id: button.dataset.checkin });
    button.outerHTML = result.code
      ? `<strong>${escapeHtml(result.code)}</strong>${result.expired_at ? `<br><span class="helper">Vence ${escapeHtml(result.expired_at)}</span>` : ""}`
      : `<span class="helper">Rappi no asignó código</span>`;
  } catch (error) {
    toast("Rappi no entregó el código de check-in en este momento.", "error");
    setBusy(button, false);
  }
}

async function onboard(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  setBusy(button, true, "Conectando…");
  try {
    const values = Object.fromEntries(new FormData(event.currentTarget));
    const result = await invokeRappi("rappi-admin", { action: "onboard", environment: ENV, ...values });
    event.currentTarget.reset();
    const fallos = result.subscription?.results?.filter((row) => !row.ok).length || 0;
    toast(fallos ? `La conexión quedó a medias: ${fallos} aviso(s) requieren revisión.` : "Rappi quedó conectado y configurado.", fallos ? "error" : "success");
    await revisar();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    setBusy(button, false);
  }
}

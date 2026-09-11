import {
  bootRappiShell, closeDialogOnBackdrop, emptyRow, escapeHtml, formatDate, formatMoney,
  formatTime, invokeRappi, setBusy, statusBadge, toast, todayRange,
} from "./core.js?v=20260911rappi3";
import {
  DELIVERY_STEPS, deliveryProgress, deliveryVerdict, eventLabel, notFoundVerdict,
  paymentMethodLabel, paymentVerdict,
} from "./veredictos.js?v=20260911rappi3";

// Mientras haya pedidos en curso, la lista se refresca sola: quien atiende
// no debería tener que acordarse de pulsar "Actualizar".
const REFRESH_MS = 30_000;
const TERMINAL = new Set(["COMPLETED", "CANCELLED", "REJECTED", "NOT_ACCEPTED"]);

const state = { page: 1, totalPages: 1, openOrderId: null, timer: null, historyLoaded: false };
const dialog = document.querySelector("#order-dialog");
const boardDate = document.querySelector("#board-date");

closeDialogOnBackdrop(dialog);
dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", () => { state.openOrderId = null; });

boardDate.value = bogotaToday();
boardDate.max = bogotaToday();
boardDate.addEventListener("change", () => loadBoard().catch(showError));

const range = todayRange(30);
document.querySelector("#order-from").value = range.from;
document.querySelector("#order-to").value = range.to;
document.querySelector("#order-filters").addEventListener("submit", async (event) => {
  event.preventDefault(); state.page = 1; await loadOrders().catch(showError);
});
document.querySelector(".history-block").addEventListener("toggle", (event) => {
  if (event.currentTarget.open && !state.historyLoaded) loadOrders().catch(showError);
});
document.querySelector("#orders-prev").addEventListener("click", async () => {
  if (state.page > 1) { state.page -= 1; await loadOrders().catch(showError); }
});
document.querySelector("#orders-next").addEventListener("click", async () => {
  if (state.page < state.totalPages) { state.page += 1; await loadOrders().catch(showError); }
});
document.querySelector("#refresh-operation").addEventListener("click", async (event) => {
  setBusy(event.currentTarget, true, "Actualizando…");
  try { await Promise.all([loadBoard(), loadStores()]); toast("Información actualizada."); }
  catch (error) { showError(error); }
  finally { setBusy(event.currentTarget, false); }
});
document.querySelector("#verify-form").addEventListener("submit", verifyOrder);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadBoard().catch(() => {}); });

try {
  await bootRappiShell();
  await Promise.all([loadBoard(), loadStores()]);
} catch (error) {
  console.error("[rappi-pedidos]", error);
  showError(error);
}

function showError(error) {
  toast(error?.message || "No fue posible cargar Rappi.", "error");
}

function bogotaToday() {
  return new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
}

async function loadBoard() {
  const board = await invokeRappi("rappi-data", { action: "board", date: boardDate.value });
  const k = board.kpis;
  document.querySelector("#kpi-pedidos").textContent = k.pedidos;
  document.querySelector("#kpi-por-aceptar").textContent = k.por_aceptar;
  document.querySelector("#kpi-en-curso").textContent = k.en_curso;
  document.querySelector("#kpi-entregados").textContent = k.entregados;
  document.querySelector("#kpi-perdidos").textContent = k.cancelados + k.vencidos;
  document.querySelector("#kpi-total").textContent = formatMoney(k.total_entregado);
  document.querySelector("#board-title").textContent = board.is_today ? "Pedidos de hoy" : `Pedidos del ${formatDate(`${board.date}T12:00:00-05:00`, false)}`;
  document.querySelector("#board-updated").textContent = `Actualizado a las ${formatTime(board.generated_at)}${board.is_today ? " · se actualiza cada 30 segundos" : ""}`;

  const list = document.querySelector("#board-list");
  list.innerHTML = board.orders.length
    ? board.orders.map(orderRow).join("")
    : `<p class="empty-cell">${board.is_today ? "Todavía no han entrado pedidos de Rappi hoy." : "No hubo pedidos de Rappi ese día."}</p>`;
  list.querySelectorAll("[data-order-id]").forEach((button) => button.addEventListener("click", () => openOrder(button.dataset.orderId)));

  scheduleRefresh(board.is_today);
  if (state.openOrderId && dialog.open) await refreshOpenOrder();
}

function scheduleRefresh(isToday) {
  window.clearTimeout(state.timer);
  if (!isToday) return;
  state.timer = window.setTimeout(() => {
    if (document.hidden) return scheduleRefresh(true);
    loadBoard().catch((error) => { console.warn("[rappi-pedidos] refresco", error); scheduleRefresh(true); });
  }, REFRESH_MS);
}

function orderRow(order) {
  const delivery = deliveryVerdict(order, formatTime);
  const payment = paymentVerdict(order, formatMoney);
  const products = order.product_count ? `${order.product_count} producto${order.product_count === 1 ? "" : "s"}` : "";
  const meta = [formatTime(order.provider_created_at || order.first_received_at), products, order.rappi_stores?.store_name]
    .filter(Boolean).map(escapeHtml).join(" · ");
  return `
    <article class="order-row tone-${delivery.tone}">
      <div class="order-row-id"><strong>${escapeHtml(order.rappi_order_id)}</strong><span class="helper">${meta}</span></div>
      <div class="order-row-state">${statusBadge(order.operational_status)}<span class="helper">${escapeHtml(delivery.title)}</span></div>
      <div class="order-row-pay"><span class="chip tone-${payment.tone}">${escapeHtml(shortPayment(order, payment))}</span></div>
      <div class="order-row-total">${formatMoney(order.total_order)}</div>
      <button class="button secondary compact" type="button" data-order-id="${escapeHtml(order.id)}">Ver</button>
      ${stepper(order, true)}
    </article>`;
}

function shortPayment(order, payment) {
  if (payment.tone === "neutral") return "Nada que cobrar";
  if (payment.tone === "ok") return "Pagado en Rappi";
  return order.payment_method ? `Efectivo · lo cobra el repartidor` : "Pago sin dato";
}

function stepper(order, compact = false) {
  const { reached, stopped } = deliveryProgress(order);
  const steps = DELIVERY_STEPS.map((step, index) => {
    const css = index < reached || (index === reached && !stopped) ? "done" : "";
    const current = index === reached && !stopped && !TERMINAL.has(order.operational_status) ? " current" : "";
    return `<li class="${css}${current}"><span>${escapeHtml(step.label)}</span></li>`;
  }).join("");
  return `<ol class="steps${compact ? " compact" : ""}${stopped ? " stopped" : ""}" aria-label="Avance del pedido">${steps}</ol>`;
}

function verdictBox(label, verdict) {
  return `<div class="verdict tone-${verdict.tone}"><span class="verdict-label">${escapeHtml(label)}</span><strong>${escapeHtml(verdict.title)}</strong><p>${escapeHtml(verdict.detail)}</p></div>`;
}

async function verifyOrder(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const target = document.querySelector("#verify-result");
  const number = document.querySelector("#verify-number").value.trim();
  setBusy(button, true, "Verificando…");
  try {
    const result = await invokeRappi("rappi-data", { action: "verify_order", rappi_order_id: number });
    target.hidden = false;
    if (!result.found) {
      target.innerHTML = verdictBox("Resultado", notFoundVerdict(result.rappi_order_id));
      return;
    }
    const order = result.order;
    target.innerHTML = `
      <div class="verify-grid">
        ${verdictBox("¿Está pago?", paymentVerdict(order, formatMoney))}
        ${verdictBox("¿Dónde va?", deliveryVerdict(order, formatTime))}
      </div>
      <p class="helper">Pedido ${escapeHtml(order.rappi_order_id)} · ${escapeHtml(order.rappi_stores?.store_name || "Tienda Rappi")} · ${formatDate(order.provider_created_at || order.first_received_at)} · Total ${formatMoney(order.total_order)} · Consultado a las ${formatTime(result.checked_at)}
      <button class="link-button" type="button" data-order-id="${escapeHtml(order.id)}">Ver detalle</button></p>`;
    target.querySelector("[data-order-id]")?.addEventListener("click", () => openOrder(order.id));
  } catch (error) {
    target.hidden = false;
    target.innerHTML = `<p class="notice warning">${escapeHtml(error.message)}</p>`;
  } finally {
    setBusy(button, false);
  }
}

async function openOrder(orderId) {
  state.openOrderId = orderId;
  const target = document.querySelector("#order-detail");
  target.innerHTML = `<p class="muted">Cargando pedido…</p>`;
  if (!dialog.open) dialog.showModal();
  await renderOrder(orderId);
}

async function refreshOpenOrder() {
  if (!state.openOrderId) return;
  await renderOrder(state.openOrderId).catch(() => {});
}

async function renderOrder(orderId) {
  const target = document.querySelector("#order-detail");
  try {
    const detail = await invokeRappi("rappi-data", { action: "order_detail", order_id: orderId });
    if (state.openOrderId !== orderId) return;
    renderDetail(detail);
  } catch (error) {
    target.innerHTML = `<p class="notice warning">${escapeHtml(error.message)}</p>`;
  }
}

function renderDetail(detail) {
  const order = detail.order;
  const items = Array.isArray(order.items) ? order.items : [];
  const canAccept = order.operational_status === "RECEIVED" && order.acceptance_status !== "ACCEPTED";
  const latestTrack = detail.tracking?.[0];
  const eta = latestTrack?.eta && Number(latestTrack.eta) > 0 ? Math.max(1, Math.round(Number(latestTrack.eta) / 60000)) : null;
  document.querySelector("#order-dialog-title").textContent = `Pedido ${order.rappi_order_id}`;
  const history = [...detail.events]
    .sort((a, b) => Date.parse(a.provider_event_at || a.created_at || 0) - Date.parse(b.provider_event_at || b.created_at || 0))
    .map((event) => `<li><time>${formatTime(event.provider_event_at || event.created_at)}</time><div><strong>${escapeHtml(eventLabel(event))}</strong>${historyNote(event)}</div></li>`)
    .join("");

  document.querySelector("#order-detail").innerHTML = `
    <div class="verify-grid">
      ${verdictBox("¿Está pago?", paymentVerdict(order, formatMoney))}
      ${verdictBox("¿Dónde va?", deliveryVerdict(order, formatTime))}
    </div>
    ${stepper(order)}
    ${canAccept ? `<div class="notice warning accept-box"><span>Rappi cancela el pedido si nadie lo acepta en 6 minutos desde que entró (${formatTime(order.provider_created_at || order.first_received_at)}).</span><button class="button" type="button" id="accept-order">Aceptar ahora</button></div>` : ""}
    <div class="detail-grid">
      ${detailItem("Entró", formatDate(order.provider_created_at || order.first_received_at))}
      ${detailItem("Total del pedido", formatMoney(order.total_order))}
      ${detailItem("Forma de pago", paymentMethodLabel(order.payment_method))}
      ${detailItem("Descuentos", formatMoney(order.total_discounts))}
      ${detailItem("Repartidor", order.courier_name || "Sin asignar todavía")}
      ${detailItem(eta ? "Llegada estimada" : "Tienda", eta ? `≈ ${eta} min ${latestTrack.eta_type === "DELIVERY" ? "al cliente" : "al local"}` : order.rappi_stores?.store_name || "Tienda Rappi")}
    </div>
    <h3>Productos</h3>
    <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th></tr></thead><tbody>${items.length ? items.map(itemRow).join("") : emptyRow(3, "Sin productos disponibles.")}</tbody></table></div>
    <h3 style="margin-top:20px">Historial</h3>
    <ol class="order-timeline">${history || `<li><div><span>Sin cambios registrados.</span></div></li>`}</ol>`;

  document.querySelector("#accept-order")?.addEventListener("click", async (event) => {
    setBusy(event.currentTarget, true, "Aceptando…");
    try {
      const result = await invokeRappi("rappi-data", { action: "accept_order", order_id: order.id });
      toast(result.outcome === "ACCEPTED" ? "Pedido aceptado en Rappi." : "Rappi no permitió aceptarlo. Revisa el estado del pedido.", result.outcome === "ACCEPTED" ? "success" : "error");
      renderDetail(result);
      await loadBoard();
    } catch (error) {
      showError(error);
      setBusy(event.currentTarget, false);
    }
  });
}

function historyNote(event) {
  const info = event.additional_information || {};
  const notes = [];
  if (info.courier?.name) notes.push(`Repartidor: ${info.courier.name}`);
  else if (info.storekeeper_name) notes.push(`Repartidor: ${info.storekeeper_name}`);
  if (Number(info.eta_to_store) > 0) notes.push(`llega al local en ≈ ${Math.max(1, Math.round(Number(info.eta_to_store) / 60))} min`);
  if (info.reason) notes.push(info.reason);
  return notes.length ? `<span>${escapeHtml(notes.join(" · "))}</span>` : "";
}

function itemRow(item) {
  const extras = Array.isArray(item.subitems) && item.subitems.length
    ? `<span class="helper">${item.subitems.map((sub) => escapeHtml(`${sub.quantity > 1 ? `${sub.quantity}× ` : ""}${sub.name}`)).join(", ")}</span>`
    : "";
  return `<tr><td>${escapeHtml(item.name || item.sku || "Producto")}${extras ? `<br>${extras}` : ""}</td><td>${escapeHtml(item.quantity ?? "—")}</td><td>${formatMoney(item.price)}</td></tr>`;
}

function detailItem(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

async function loadStores() {
  const summary = await invokeRappi("rappi-data", { action: "operation_summary" });
  document.querySelector("#stores-body").innerHTML = summary.stores.length
    ? summary.stores.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.connectivity_status || "UNKNOWN")}</td><td>${formatDate(store.last_ping_at)}</td></tr>`).join("")
    : emptyRow(3, "No hay tiendas sincronizadas.");
  document.querySelector("#menus-body").innerHTML = summary.stores.length
    ? summary.stores.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.menu_approval_status || "PENDING")}</td><td>—</td></tr>`).join("")
    : emptyRow(3, "No hay información de menú disponible.");
  const select = document.querySelector("#order-store");
  const selected = select.value;
  select.innerHTML = `<option value="">Todas</option>${summary.stores.map((store) => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.store_name || "Tienda Rappi")}</option>`).join("")}`;
  select.value = selected;
  loadMenus().catch(() => {});
}

async function loadMenus() {
  const rows = await invokeRappi("rappi-data", { action: "menu_support" });
  if (!rows.length) return;
  document.querySelector("#menus-body").innerHTML = rows.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.menu?.approval_status || store.menu_approval_status || "PENDING")}</td><td>${escapeHtml(store.menu?.item_count ?? "—")}</td></tr>`).join("");
}

async function loadOrders() {
  const filters = Object.fromEntries(new FormData(document.querySelector("#order-filters")));
  const body = document.querySelector("#orders-body");
  body.innerHTML = emptyRow(7, "Buscando pedidos…");
  const result = await invokeRappi("rappi-data", { action: "orders", page: state.page, page_size: 25, ...filters });
  state.historyLoaded = true;
  state.totalPages = Math.max(1, result.total_pages || 1);
  state.page = Math.min(state.page, state.totalPages);
  document.querySelector("#orders-page").textContent = `Página ${state.page} de ${state.totalPages} · ${result.total_entries} pedidos`;
  document.querySelector("#orders-prev").disabled = state.page <= 1;
  document.querySelector("#orders-next").disabled = state.page >= state.totalPages;
  body.innerHTML = result.entries.length ? result.entries.map((order) => {
    const payment = paymentVerdict(order, formatMoney);
    return `<tr><td><strong>${escapeHtml(order.rappi_order_id)}</strong></td><td>${escapeHtml(order.rappi_stores?.store_name || "Tienda Rappi")}</td><td>${formatDate(order.provider_created_at || order.first_received_at)}</td><td>${statusBadge(order.operational_status)}</td><td><span class="chip tone-${payment.tone}">${escapeHtml(shortPayment(order, payment))}</span></td><td>${formatMoney(order.total_order)}</td><td><button class="button secondary compact" type="button" data-order-id="${escapeHtml(order.id)}">Ver</button></td></tr>`;
  }).join("") : emptyRow(7, "No hay pedidos para los filtros seleccionados.");
  body.querySelectorAll("[data-order-id]").forEach((button) => button.addEventListener("click", () => openOrder(button.dataset.orderId)));
}

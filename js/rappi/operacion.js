import {
  bootRappiShell, closeDialogOnBackdrop, emptyRow, escapeHtml, formatDate, formatMoney,
  formatTime, humanStatus, invokeRappi, setBusy, statusBadge, toast, todayRange,
} from "./core.js";

const state = { page: 1, totalPages: 1 };
const dialog = document.querySelector("#order-dialog");
closeDialogOnBackdrop(dialog);
dialog.querySelector("[data-close-dialog]").addEventListener("click", () => dialog.close());

const range = todayRange(30);
document.querySelector("#order-from").value = range.from;
document.querySelector("#order-to").value = range.to;
document.querySelector("#order-filters").addEventListener("submit", async (event) => {
  event.preventDefault(); state.page = 1; await loadOrders();
});
document.querySelector("#orders-prev").addEventListener("click", async () => {
  if (state.page > 1) { state.page -= 1; await loadOrders(); }
});
document.querySelector("#orders-next").addEventListener("click", async () => {
  if (state.page < state.totalPages) { state.page += 1; await loadOrders(); }
});
document.querySelector("#refresh-operation").addEventListener("click", async (event) => {
  setBusy(event.currentTarget, true, "Actualizando…");
  try { await loadAll(); toast("Información actualizada."); }
  catch (error) { toast(error.message, "error"); }
  finally { setBusy(event.currentTarget, false); }
});

try { await bootRappiShell(); await loadAll(); }
catch (error) { console.error("[rappi-operation]", error); toast(error.message || "No fue posible cargar Rappi.", "error"); }

async function loadAll() { await Promise.all([loadSummary(), loadOrders(), loadMenus()]); }

async function loadSummary() {
  const summary = await invokeRappi("rappi-data", { action: "operation_summary" });
  document.querySelector("#metric-orders").textContent = summary.total_orders;
  document.querySelector("#metric-incidents").textContent = summary.incidents;
  document.querySelector("#metric-stores").textContent = summary.stores.length;
  document.querySelector("#stores-body").innerHTML = summary.stores.length
    ? summary.stores.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.connectivity_status || "UNKNOWN")}</td><td>${formatDate(store.last_ping_at)}</td><td>${statusBadge(store.menu_approval_status || "PENDING")}</td></tr>`).join("")
    : emptyRow(4, "No hay tiendas sincronizadas.");
  const select = document.querySelector("#order-store");
  const selected = select.value;
  select.innerHTML = `<option value="">Todas</option>${summary.stores.map((store) => `<option value="${escapeHtml(store.id)}">${escapeHtml(store.store_name || "Tienda Rappi")}</option>`).join("")}`;
  select.value = selected;
}

async function loadOrders() {
  const filters = Object.fromEntries(new FormData(document.querySelector("#order-filters")));
  const body = document.querySelector("#orders-body");
  body.innerHTML = emptyRow(8, "Cargando pedidos…");
  const result = await invokeRappi("rappi-data", { action: "orders", page: state.page, page_size: 25, ...filters });
  state.totalPages = Math.max(1, result.total_pages || 1);
  state.page = Math.min(state.page, state.totalPages);
  document.querySelector("#orders-page").textContent = `Página ${state.page} de ${state.totalPages} · ${result.total_entries} registros`;
  document.querySelector("#orders-prev").disabled = state.page <= 1;
  document.querySelector("#orders-next").disabled = state.page >= state.totalPages;
  body.innerHTML = result.entries.length ? result.entries.map((order) => {
    const store = order.rappi_stores;
    return `<tr><td><strong>${escapeHtml(order.rappi_order_id)}</strong>${order.is_scheduled ? `<br><span class="helper">Programado</span>` : ""}</td><td>${escapeHtml(store?.store_name || "Tienda Rappi")}</td><td>${formatTime(order.provider_created_at)}</td><td>${statusBadge(order.operational_status)}</td><td>${formatMoney(order.total_order)}</td><td>${escapeHtml(order.payment_method || "—")}</td><td>${formatDate(order.last_event_at || order.provider_created_at)}</td><td><button class="button secondary compact" type="button" data-order-id="${escapeHtml(order.id)}">Ver</button></td></tr>`;
  }).join("") : emptyRow(8, "No hay pedidos para los filtros seleccionados.");
  body.querySelectorAll("[data-order-id]").forEach((button) => button.addEventListener("click", () => openOrder(button.dataset.orderId)));
}

async function loadMenus() {
  const rows = await invokeRappi("rappi-data", { action: "menu_support" });
  document.querySelector("#menus-body").innerHTML = rows.length
    ? rows.map((store) => `<tr><td><strong>${escapeHtml(store.store_name || "Tienda Rappi")}</strong></td><td>${statusBadge(store.menu?.approval_status || store.menu_approval_status || "PENDING")}</td><td>${escapeHtml(store.menu?.item_count ?? "—")}</td><td>${formatDate(store.menu?.received_at || store.menu_updated_at)}</td></tr>`).join("")
    : emptyRow(4, "No hay información de menú disponible.");
}

async function openOrder(orderId) {
  const target = document.querySelector("#order-detail");
  target.innerHTML = `<p class="muted">Cargando historial…</p>`;
  dialog.showModal();
  try {
    const detail = await invokeRappi("rappi-data", { action: "order_detail", order_id: orderId });
    const order = detail.order;
    const items = Array.isArray(order.items) ? order.items : [];
    const timeline = [
      ...detail.events.map((event) => ({ at: event.provider_event_at || event.created_at, status: event.normalized_status || event.rappi_status || event.event_type, info: event.additional_information })),
      ...detail.tracking.map((track) => ({ at: track.tracked_at, status: track.tracking_status, info: track.eta ? `Hora estimada ${track.eta}` : "Seguimiento actualizado" })),
    ].sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
    target.innerHTML = `
      <div class="detail-grid">${detailItem("Pedido", order.rappi_order_id)}${detailItem("Estado", humanStatus(order.operational_status))}${detailItem("Total", formatMoney(order.total_order))}${detailItem("Pago", order.payment_method || "—")}${detailItem("Entrega", order.delivery_method || "—")}${detailItem("Creado", formatDate(order.provider_created_at))}</div>
      <h3>Productos</h3>
      <div class="table-wrap"><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Total</th></tr></thead><tbody>${items.length ? items.map((item) => `<tr><td>${escapeHtml(item.name || item.sku || "Producto")}</td><td>${escapeHtml(item.quantity ?? "—")}</td><td>${formatMoney(item.total ?? item.price)}</td></tr>`).join("") : emptyRow(3, "Sin productos disponibles.")}</tbody></table></div>
      <h3 style="margin-top:20px">Historial</h3>
      <ol class="order-timeline">${timeline.length ? timeline.map((entry) => `<li><time>${formatTime(entry.at)}</time><div><strong>${escapeHtml(humanStatus(entry.status))}</strong>${entry.info ? `<span>${escapeHtml(entry.info)}</span>` : ""}</div></li>`).join("") : `<li><div><span>Sin cambios registrados.</span></div></li>`}</ol>`;
  } catch (error) { target.innerHTML = `<p class="notice warning">${escapeHtml(error.message)}</p>`; }
}

function detailItem(label, value) {
  return `<div class="detail-item"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

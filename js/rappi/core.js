import { supabase } from "../supabase.js";
import { getUserContext } from "../session.js";

let currentContext = null;

export async function bootRappiShell() {
  currentContext = await getUserContext();
  if (!currentContext?.empresa_id) throw new Error("No se pudo resolver una empresa activa para Rappi.");

  document.querySelectorAll("[data-company-name]").forEach((node) => {
    node.textContent = currentContext.nombre_comercial || currentContext.razon_social || "Empresa";
  });
  document.querySelectorAll("[data-user-name]").forEach((node) => {
    node.textContent = currentContext.nombre || currentContext.user?.email || "Usuario";
  });
  document.querySelectorAll("[data-admin-only], [data-admin-link]").forEach((node) => {
    node.hidden = !isAdminContext(currentContext);
  });
  const page = document.body.dataset.rappiPage;
  document.querySelector(`[data-rappi-nav="${page}"]`)?.setAttribute("aria-current", "page");
  return currentContext;
}

export function getRappiContext() { return currentContext; }

export function isAdminContext(context = currentContext) {
  const role = String(context?.rol || "").toLowerCase();
  return context?.super_admin === true || ["admin", "admin_root"].includes(role);
}

export async function invokeRappi(functionName, body = {}) {
  if (!currentContext) await bootRappiShell();
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { ...body, empresa_id: currentContext.empresa_id },
  });
  if (error) {
    let message = error.message || "La solicitud no pudo completarse.";
    const response = error.context;
    if (response && typeof response.clone === "function") {
      try {
        const payload = await response.clone().json();
        message = payload?.message || payload?.error || message;
      } catch (_ignored) { /* La respuesta puede no contener JSON. */ }
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.message || data?.error || "Rappi respondió sin confirmar la operación.");
  return data.data ?? data;
}

export function setBusy(element, busy, label = "Procesando…") {
  if (!element) return;
  if (busy) {
    element.dataset.originalLabel = element.textContent;
    element.textContent = label;
    element.disabled = true;
  } else {
    element.textContent = element.dataset.originalLabel || element.textContent;
    element.disabled = false;
    delete element.dataset.originalLabel;
  }
}

export function toast(message, type = "success") {
  let region = document.querySelector(".toast-region");
  if (!region) {
    region = document.createElement("div");
    region.className = "toast-region";
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  const item = document.createElement("div");
  item.className = `toast ${type === "error" ? "error" : ""}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4800);
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function formatMoney(value, currency = "COP") {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("es-CO", { style: "currency", currency, maximumFractionDigits: 0 })
    .format(Number.isFinite(amount) ? amount : 0);
}

export function formatDate(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("es-CO", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

export function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit" }).format(date);
}

const STATUS_LABELS = Object.freeze({
  NEW: "Recibido", RECEIVED: "Por aceptar", IN_PROGRESS: "En preparación", TAKEN: "Pedido tomado",
  READY: "Listo para recoger", COURIER_AT_STORE: "Repartidor en el local", IN_DELIVERY: "En camino",
  ARRIVED: "Llegó donde el cliente", NOT_ACCEPTED: "Vencido sin aceptar",
  COURIER_ASSIGNED: "Repartidor asignado", ON_THE_WAY: "En entrega", COMPLETED: "Entregado",
  DELIVERED: "Entregado", CANCELLED: "Cancelado", INCIDENT: "Requiere atención",
  CONNECTED: "Conectada", ONLINE: "Conectada", ENABLE: "Activa", ENABLED: "Activa", ACTIVE: "Activa",
  OK: "Correcto", APPROVED: "Aprobado", PENDING: "Pendiente", UNKNOWN: "Sin información",
  OFFLINE: "Sin señal", DISCONNECTED: "Sin señal", DEGRADED: "Con problemas", REJECTED: "Rechazado",
  FAILED: "Con problemas", ERROR: "Con problemas", CONFIGURED: "Configurada", NOT_CONFIGURED: "Pendiente",
  MISSING: "Pendiente", EXPIRED: "Requiere reconexión", SAVED: "Guardada", PROCESSING: "Procesando",
});

export function humanStatus(value) {
  const normalized = String(value || "UNKNOWN").trim().toUpperCase();
  return STATUS_LABELS[normalized] || normalized.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function badge(value) {
  const label = String(value || "SIN DATO").toUpperCase();
  const css = label.toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-");
  return `<span class="badge ${css}">${escapeHtml(label)}</span>`;
}

export function statusBadge(value) {
  const css = String(value || "UNKNOWN").toLowerCase().replaceAll(/[^a-z0-9_-]/g, "-");
  return `<span class="badge ${css}">${escapeHtml(humanStatus(value))}</span>`;
}

export function emptyRow(columns, message) {
  return `<tr><td class="empty-cell" colspan="${Number(columns)}">${escapeHtml(message)}</td></tr>`;
}

export function todayRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const isoDate = (date) => date.toISOString().slice(0, 10);
  return { from: isoDate(from), to: isoDate(to) };
}

export function closeDialogOnBackdrop(dialog) {
  dialog?.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
}

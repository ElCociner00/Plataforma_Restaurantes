import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";
import { BILLING_PAYMENT_URL } from "./billing_config.js";

const BANNER_HTML_PATH = "/Plataforma_Restaurantes/components/banner_impago.html";
const BANNER_CSS_PATH = "/Plataforma_Restaurantes/css/banner_impago.css";
const STORAGE_KEY = "axioma_billing_banner_daily_v5";
const COLOMBIA_TIME_ZONE = "America/Bogota";
const DAYS_BEFORE_DUE_TO_SHOW = 10;
const MAX_GRACE_DAYS = 5;
const UNPAID_STATES = ["pending_payment", "proof_submitted", "past_due", "suspended", "grace_manual", "draft"];

let anuncioInyectado = false;

function ensureBannerStyles() {
  if (document.getElementById("impagoBannerCss")) return;
  const link = document.createElement("link");
  link.id = "impagoBannerCss";
  link.rel = "stylesheet";
  link.href = BANNER_CSS_PATH;
  document.head.appendChild(link);
}

function getBogotaTodayYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value || 0),
    month: Number(parts.find((part) => part.type === "month")?.value || 0),
    day: Number(parts.find((part) => part.type === "day")?.value || 0)
  };
}

function getBogotaDayKey(date = new Date()) {
  const today = getBogotaTodayYmd(date);
  return `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`;
}

function getDisplayKey({ empresaId, cycleId, fechaVencimiento, estado }) {
  return [
    STORAGE_KEY,
    empresaId || "sin_empresa",
    cycleId || "sin_ciclo",
    fechaVencimiento || "sin_fecha",
    estado || "sin_estado",
    getBogotaDayKey()
  ].join(":");
}

function markAsShown(key) {
  if (!key) return;
  localStorage.setItem(key, "1");
}

function wasAlreadyShown(key) {
  if (!key) return false;
  return localStorage.getItem(key) === "1";
}

export function clearBannerDisplayCache() {
  Object.keys(localStorage)
    .filter((key) => key.startsWith(`${STORAGE_KEY}:`))
    .forEach((key) => localStorage.removeItem(key));
}

async function getModalTemplateHtml() {
  try {
    const res = await fetch(BANNER_HTML_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error("template not found");
    return await res.text();
  } catch {
    return '<div id="anuncio-impago" class="impago-modal" role="dialog" aria-modal="true"><div class="impago-modal-card"><h3 id="impagoModalTitle">Aviso importante</h3><p id="impagoModalMessage"></p><div class="impago-modal-actions"><button id="impagoModalAceptar" type="button">Aceptar</button><a id="impagoModalPagar" href="https://mpago.li/15d6BkC" target="_blank" rel="noopener noreferrer">Pagar ahora</a></div></div></div>';
  }
}

function extractYmd(value) {
  if (!value) return null;
  const match = String(value).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

function ymdToUtcMidday(ymd) {
  if (!ymd?.year || !ymd?.month || !ymd?.day) return null;
  return Date.UTC(ymd.year, ymd.month - 1, ymd.day, 12, 0, 0, 0);
}

function fmtDate(value) {
  const ymd = extractYmd(value);
  if (!ymd) return "-";
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIME_ZONE,
    day: "numeric",
    month: "numeric",
    year: "numeric"
  }).format(new Date(ymdToUtcMidday(ymd)));
}

function diffInDaysFromToday(value) {
  const target = extractYmd(value);
  if (!target) return null;
  const today = getBogotaTodayYmd();
  return Math.round((ymdToUtcMidday(target) - ymdToUtcMidday(today)) / (1000 * 60 * 60 * 24));
}

function addDays(value, days) {
  const ymd = extractYmd(value);
  if (!ymd) return null;
  const base = new Date(ymdToUtcMidday(ymd));
  base.setUTCDate(base.getUTCDate() + days);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

function getSuspensionDate(fechaVencimiento) {
  return addDays(fechaVencimiento, MAX_GRACE_DAYS);
}

function isTruthy(value) {
  return value === true;
}

function isCycleUnpaid(cycle) {
  const estado = String(cycle?.estado || "").toLowerCase();
  return UNPAID_STATES.includes(estado) || isTruthy(cycle?.banner_activo);
}

function shouldShowForDays(diasRestantes) {
  if (typeof diasRestantes !== "number") return false;
  return diasRestantes <= DAYS_BEFORE_DUE_TO_SHOW;
}

function pickRelevantCycle(cycles, periodoActual) {
  if (!Array.isArray(cycles) || !cycles.length) return null;

  const currentPeriodUnpaid = cycles.find((cycle) => cycle.periodo === periodoActual && isCycleUnpaid(cycle));
  if (currentPeriodUnpaid) return currentPeriodUnpaid;

  const bannerUnpaid = cycles.find((cycle) => isTruthy(cycle.banner_activo) && isCycleUnpaid(cycle));
  if (bannerUnpaid) return bannerUnpaid;

  return cycles.find((cycle) => isCycleUnpaid(cycle)) || null;
}

function pickRelevantCycle(cycles, periodoActual) {
  if (!Array.isArray(cycles) || !cycles.length) return null;

  const currentPeriodUnpaid = cycles.find((cycle) => cycle.periodo === periodoActual && isCycleUnpaid(cycle));
  if (currentPeriodUnpaid) return currentPeriodUnpaid;

  const bannerUnpaid = cycles.find((cycle) => isTruthy(cycle.banner_activo) && isCycleUnpaid(cycle));
  if (bannerUnpaid) return bannerUnpaid;

  return cycles.find((cycle) => isCycleUnpaid(cycle)) || null;
}

function getMensajeHtml({ diasRestantes, fechaVencimiento, fechaSuspension }) {
  const dias = typeof diasRestantes === "number" ? diasRestantes : null;

  if (dias == null) {
    return `
      <div class="impago-msg impago-msg--warning">
        <div class="impago-msg-title">Aviso importante de facturación</div>
        <div class="impago-msg-days">Pago pendiente</div>
        <div class="impago-msg-body">Tienes una factura pendiente. Revisa tu módulo de facturación para evitar suspensión del servicio.</div>
      </div>
    `;
  }

  if (dias > 0) {
    return `
      <div class="impago-msg impago-msg--warning">
        <div class="impago-msg-title">Aviso importante de facturación</div>
        <div class="impago-msg-days">Faltan <span class="impago-number">${dias}</span> día${dias === 1 ? "" : "s"}</div>
        <div class="impago-msg-body">Tu factura vence el ${fmtDate(fechaVencimiento)}. Esta cuenta regresiva llegará a 0 el día 15 si aún no has pagado.</div>
      </div>
    `;
  }

  if (dias === 0) {
    return `
      <div class="impago-msg impago-msg--warning">
        <div class="impago-msg-title">Aviso importante de facturación</div>
        <div class="impago-msg-days">Hoy vence tu factura</div>
        <div class="impago-msg-body">Tu factura vence hoy, ${fmtDate(fechaVencimiento)}. Si no pagas hoy, mañana comenzará a contarse la mora.</div>
      </div>
    `;
  }

  const diasMora = Math.abs(dias);
  const suspension = getSuspensionDate(fechaVencimiento);
  const suspensionDiff = suspension ? diffInDaysFromToday(suspension) : null;
  const suspensionMessage = suspensionDiff != null && suspensionDiff >= 0
    ? `Tu servicio será suspendido el ${fmtDate(suspension)} si no pagas.`
    : `Tu servicio debía suspenderse el ${fmtDate(suspension)}. Regulariza el pago cuanto antes.`;

  return `
    <div class="impago-msg impago-msg--danger">
      <div class="impago-msg-title">Tu cuenta está en mora</div>
      <div class="impago-msg-days">Llevas <span class="impago-number">${diasMora}</span> día${diasMora === 1 ? "" : "s"} de mora</div>
      <div class="impago-msg-body">Tu factura venció el ${fmtDate(fechaVencimiento)}. ${suspensionMessage}</div>
    </div>
  `;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

function getCurrentPeriod(date = new Date()) {
  const current = getBogotaTodayYmd(date);
  return `${current.year}-${String(current.month).padStart(2, "0")}`;
}

async function getBannerState() {
  const context = await getUserContext().catch(() => null);
  const empresaId = context?.empresa_id;
  if (!empresaId) return { empresaId: null, shouldShow: false };

  const periodoActual = getCurrentPeriod();
  const [{ data: empresa }, { data: cycles }] = await Promise.all([
    supabase
      .from("empresas")
      .select("id, mostrar_anuncio_impago")
      .eq("id", empresaId)
      .maybeSingle(),
    supabase
      .from("billing_cycles")
      .select("id, periodo, estado, banner_activo, fecha_vencimiento")
      .eq("empresa_id", empresaId)
      .order("periodo", { ascending: false })
      .order("fecha_vencimiento", { ascending: false })
      .limit(6)
  ]);

  const cycle = pickRelevantCycle(cycles || [], periodoActual);
  const estado = String(cycle?.estado || "").toLowerCase();
  const fechaVencimiento = cycle?.fecha_vencimiento || null;
  const diasRestantes = diffInDaysFromToday(fechaVencimiento);
  const showByFlags = isTruthy(empresa?.mostrar_anuncio_impago) || isTruthy(cycle?.banner_activo);
  const showByWindow = shouldShowForDays(diasRestantes) && isCycleUnpaid(cycle);
  const shouldShow = ["paid_verified"].includes(estado) ? false : Boolean(cycle && (showByFlags || showByWindow));

  return {
    empresaId,
    cycleId: cycle?.id || null,
    estado,
    shouldShow,
    diasRestantes,
    fechaVencimiento
  };
}

async function mostrarAnuncio({ storageKey, diasRestantes, fechaVencimiento, fechaSuspension }) {
  ocultarAnuncio();
  const container = document.createElement("div");
  container.innerHTML = await getModalTemplateHtml();
  const modal = container.querySelector("#anuncio-impago");
  if (!modal) return;

  const title = modal.querySelector("#impagoModalTitle");
  if (title) title.textContent = diasRestantes < 0 ? "Aviso de mora" : "Aviso importante";

  const message = modal.querySelector("#impagoModalMessage");
  if (message) {
    message.innerHTML = getMensajeHtml({ diasRestantes, fechaVencimiento });
  }

  const btnAceptar = modal.querySelector("#impagoModalAceptar");
  btnAceptar?.addEventListener("click", () => {
    markAsShown(storageKey);
    ocultarAnuncio();
  });

  const btnPagar = modal.querySelector("#impagoModalPagar");
  btnPagar?.addEventListener("click", () => {
    markAsShown(storageKey);
    ocultarAnuncio();
  });

  if (btnPagar) {
    btnPagar.setAttribute("href", BILLING_PAYMENT_URL);
    btnPagar.setAttribute("target", "_blank");
    btnPagar.setAttribute("rel", "noopener noreferrer");
  }

  document.body.appendChild(modal);
  document.body.classList.add("has-impago-banner");
  anuncioInyectado = true;
}

export async function verificarYMostrarAnuncio() {
  ensureBannerStyles();

  const bannerState = await getBannerState();
  const { empresaId, cycleId, estado, shouldShow, diasRestantes, fechaVencimiento } = bannerState;

  if (!empresaId || shouldShow !== true) {
    ocultarAnuncio();
    return;
  }

  const storageKey = getDisplayKey({ empresaId, cycleId, fechaVencimiento, estado });
  if (wasAlreadyShown(storageKey)) {
    ocultarAnuncio();
    return;
  }

  await mostrarAnuncio({ storageKey, diasRestantes, fechaVencimiento, fechaSuspension });
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    verificarYMostrarAnuncio().catch(() => {
      if (!anuncioInyectado) ocultarAnuncio();
    });
  }, 50);
});

window.addEventListener("empresaCambiada", () => {
  verificarYMostrarAnuncio().catch(() => {
    if (!anuncioInyectado) ocultarAnuncio();
  });
});

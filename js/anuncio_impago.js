
import { getUserContext } from "./session.js";
import { supabase } from "./supabase.js";

const BANNER_HTML_PATH = "/Plataforma_Restaurantes/components/banner_impago.html";
const BANNER_CSS_PATH = "/Plataforma_Restaurantes/css/banner_impago.css";
const FACTURACION_URL = "/Plataforma_Restaurantes/facturacion/";
const STORAGE_KEY = "axioma_aviso_bienvenida_v2";

let anuncioInyectado = false;

function ensureBannerStyles() {
  if (document.getElementById("impagoBannerCss")) return;
  const link = document.createElement("link");
  link.id = "impagoBannerCss";
  link.rel = "stylesheet";
  link.href = BANNER_CSS_PATH;
  document.head.appendChild(link);
}

function getCurrentDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getSessionOnceKey({ empresaId }) {
  return `${STORAGE_KEY}:${empresaId || "sin_empresa"}:${getCurrentDayKey()}`;
}

function markAsShown(key) {
  if (!key) return;
  sessionStorage.setItem(key, "1");
}

function wasAlreadyShown(key) {
  if (!key) return false;
  return sessionStorage.getItem(key) === "1";
}

async function getModalTemplateHtml() {
  try {
    const res = await fetch(BANNER_HTML_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error("template not found");
    return await res.text();
  } catch {
    return "<div id=\"anuncio-impago\" class=\"impago-modal\" role=\"dialog\" aria-modal=\"true\"><div class=\"impago-modal-card\"><h3 id=\"impagoModalTitle\">Aviso importante</h3><p id=\"impagoModalMessage\"></p><div class=\"impago-modal-actions\"><button id=\"impagoModalAceptar\" type=\"button\">Aceptar</button><a id=\"impagoModalPagar\" href=\"/Plataforma_Restaurantes/facturacion/\">Pagar inmediatamente</a></div></div></div>";
  }
}

function fmtDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString("es-CO");
}

function addDays(baseDate, days) {
  if (!baseDate) return null;
  const d = new Date(baseDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + days);
  return d;
}

function getMensajeHtml({ diasRestantes, fechaVencimiento }) {
  const dias = typeof diasRestantes === "number" ? diasRestantes : null;

  if (dias == null) {
    return `
      <div class="impago-msg">
        <div class="impago-msg-title">¡Información importante!</div>
        <div class="impago-msg-days">Pago pendiente</div>
        <div class="impago-msg-body">Recuerda pagar tu servicio para seguir disfrutándolo. Gracias por elegirnos.</div>
      </div>
    `;
  }

  if (dias > 0) {
    return `
      <div class="impago-msg">
        <div class="impago-msg-title">¡Información importante!</div>
        <div class="impago-msg-days">Faltan <span class="impago-number">${dias}</span> día${dias === 1 ? "" : "s"}</div>
        <div class="impago-msg-body">Tu servicio vence el ${fmtDate(fechaVencimiento)}. Paga antes del 15 para evitar suspensión.</div>
      </div>
    `;
  }

  if (dias === 0) {
    return `
      <div class="impago-msg">
        <div class="impago-msg-title">¡Información importante!</div>
        <div class="impago-msg-days">Vence hoy</div>
        <div class="impago-msg-body">Paga hoy para evitar mora y suspensión.</div>
      </div>
    `;
  }

  const diasMora = Math.abs(dias);
  const suspensionDate = addDays(fechaVencimiento, 5);
  return `
    <div class="impago-msg">
  const { data: cycleCurrent } = await supabase
    .select("id, banner_activo, dias_restantes_cache, fecha_vencimiento, periodo")
  const { data: cycleActive } = await supabase
    .from("billing_cycles")
    .select("id, banner_activo, dias_restantes_cache, fecha_vencimiento, periodo")
    .eq("empresa_id", empresaId)
    .eq("banner_activo", true)
    .order("fecha_vencimiento", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cycle = cycleCurrent || cycleActive;

      <div class="impago-msg-body">Tu servicio será suspendido el ${fmtDate(suspensionDate)}. Paga lo antes posible.</div>
    </div>
  `;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

const getCurrentPeriod = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

async function getBannerState() {
  const context = await getUserContext().catch(() => null);
  const empresaId = context?.empresa_id;
  if (!empresaId) return { empresaId: null, bannerActivo: false, diasRestantes: null };

  const periodo = getCurrentPeriod();
  const { data: cycle } = await supabase
    .from("billing_cycles")
    .select("id, banner_activo, dias_restantes_cache, fecha_vencimiento")
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo)
    .maybeSingle();

  if (cycle) {
    const vencDate = cycle?.fecha_vencimiento || null;
    const diasCache = Number.isInteger(cycle.dias_restantes_cache) ? cycle.dias_restantes_cache : null;
    const diasComputed = vencDate ? Math.ceil((new Date(vencDate) - new Date()) / (1000 * 60 * 60 * 24)) : null;
    return {
      empresaId,
      bannerActivo: cycle.banner_activo === true,
      diasRestantes: diasCache ?? diasComputed,
      fechaVencimiento: vencDate
    };
  }

  const { data: empresa } = await supabase
    .from("empresas")
    .select("id, mostrar_anuncio_impago")
    .eq("id", empresaId)
    .maybeSingle();

  const fallbackDias = 15 - new Date().getDate();
  return {
    empresaId,
    bannerActivo: empresa?.mostrar_anuncio_impago === true,
    diasRestantes: fallbackDias,
    fechaVencimiento: null
  };
}

async function mostrarAnuncio({ storageKey, diasRestantes, fechaVencimiento }) {
  ocultarAnuncio();
  const container = document.createElement("div");
  container.innerHTML = await getModalTemplateHtml();
  const modal = container.querySelector("#anuncio-impago");
  if (!modal) return;
  const title = modal.querySelector("#impagoModalTitle");
  if (title) title.textContent = "Aviso importante";
  const message = modal.querySelector("#impagoModalMessage");
  if (message) message.innerHTML = getMensajeHtml({ diasRestantes, fechaVencimiento });

  const btnAceptar = modal.querySelector("#impagoModalAceptar");
  btnAceptar?.addEventListener("click", () => {
    markAsShown(storageKey);
    ocultarAnuncio();
  });
  const btnPagar = modal.querySelector("#impagoModalPagar");
  btnPagar?.addEventListener("click", (event) => {
    event.preventDefault();
    markAsShown(storageKey);
    ocultarAnuncio();
    setTimeout(() => {
      window.location.href = FACTURACION_URL;
    }, 0);
  });
  if (btnPagar) btnPagar.setAttribute("href", FACTURACION_URL);
  document.body.appendChild(modal);
  document.body.classList.add("has-impago-banner");
  anuncioInyectado = true;
  markAsShown(storageKey);
}
export async function verificarYMostrarAnuncio() {
  ensureBannerStyles();

  const { empresaId, bannerActivo, diasRestantes, fechaVencimiento } = await getBannerState();
  if (!empresaId || bannerActivo !== true) {
    ocultarAnuncio();
    return;
  }

  const storageKey = getSessionOnceKey({ empresaId });
  if (wasAlreadyShown(storageKey)) {
    ocultarAnuncio();
    return;
  }

  await mostrarAnuncio({ storageKey, diasRestantes, fechaVencimiento });
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





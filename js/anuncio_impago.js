
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

function getSessionOnceKey({ empresaId }) {
  return `${STORAGE_KEY}:${empresaId || "sin_empresa"}`;
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

function getCurrentPeriodo() {
  const ahora = new Date();
  const year = ahora.getFullYear();
  const month = String(ahora.getMonth() + 1).padStart(2, "0");
  return year + "-" + month;
}

function getMensajeHtml(diasRestantes) {
  if (typeof diasRestantes !== "number") {
    return `
      <div class="impago-msg">
        <div class="impago-msg-title">Â¡InformaciÃ³n importante!</div>
        <div class="impago-msg-days">Estado en actualizaciÃ³n</div>
        <div class="impago-msg-body">Estamos actualizando tu estado de facturaciÃ³n. Intenta de nuevo en unos minutos.</div>
      </div>
    `;
  }
  const textoDias = diasRestantes > 0
    ? `Faltan ${diasRestantes} dÃ­a${diasRestantes === 1 ? "" : "s"}`
    : diasRestantes === 0
      ? "Vence hoy"
      : "Atrasado";
  return `
    <div class="impago-msg">
      <div class="impago-msg-title">Â¡InformaciÃ³n importante!</div>
      <div class="impago-msg-days">${textoDias}</div>
      <div class="impago-msg-body">Recuerda pagar tu servicio para seguir disfrutÃ¡ndolo. Gracias por elegirnos.</div>
    </div>
  `;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

async function getBillingCycleActual(empresaId) {
  const periodo = getCurrentPeriodo();
  const { data, error } = await supabase
    .from("billing_cycles")
    .select("id, empresa_id, periodo, banner_activo, dias_restantes_cache")
    .eq("empresa_id", empresaId)
    .eq("periodo", periodo)
    .maybeSingle();
  if (error) return null;
  return data || null;
}
async function mostrarAnuncio({ storageKey, diasRestantes }) {
  ocultarAnuncio();
  const container = document.createElement("div");
  container.innerHTML = await getModalTemplateHtml();
  const modal = container.querySelector("#anuncio-impago");
  if (!modal) return;
  const title = modal.querySelector("#impagoModalTitle");
  if (title) title.textContent = "Aviso importante";
  const message = modal.querySelector("#impagoModalMessage");
  if (message) message.innerHTML = getMensajeHtml(diasRestantes);
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
  const context = await getUserContext().catch(() => null);
  const empresaId = context?.empresa_id;
  if (!empresaId) {
    ocultarAnuncio();
    return;
  }
  const ciclo = await getBillingCycleActual(empresaId);
  if (!ciclo || ciclo.banner_activo !== true) {
    ocultarAnuncio();
    return;
  }
  const storageKey = getSessionOnceKey({ empresaId });
  if (wasAlreadyShown(storageKey)) {
    ocultarAnuncio();
    return;
  }
  await mostrarAnuncio({ storageKey, diasRestantes: ciclo.dias_restantes_cache });
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

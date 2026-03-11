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
    return "<div id='anuncio-impago' class='impago-modal' role='dialog' aria-modal='true'><div class='impago-modal-card'><h3 id='impagoModalTitle'>Aviso importante</h3><p id='impagoModalMessage'></p><div class='impago-modal-actions'><button id='impagoModalAceptar' type='button'>Aceptar</button><a id='impagoModalPagar' href='/Plataforma_Restaurantes/facturacion/'>Pagar inmediatamente</a></div></div></div>";
  }
}

function getDiasParaVencimiento() {
  const hoy = new Date();
  const dia = hoy.getDate();
  return 15 - dia;
}

function getMensajeHtml() {
  const dias = getDiasParaVencimiento();
  const textoDias = dias > 0
    ? `${dias} día${dias === 1 ? "" : "s"}`
    : dias === 0
      ? "Hoy vence"
      : `${Math.abs(dias)} día${Math.abs(dias) === 1 ? "" : "s"} de atraso`;

  return `
    <div class="impago-msg">
      <div class="impago-msg-title">¡Información importante!</div>
      <div class="impago-msg-days">${textoDias}</div>
      <div class="impago-msg-body">Recuerda pagar tu servicio para seguir disfrutándolo. Gracias por elegirnos.</div>
    </div>
  `;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

async function getEmpresaActual() {
  const context = await getUserContext().catch(() => null);
  const empresaId = context?.empresa_id;
  const userId = context?.user?.id || null;

  if (!empresaId) return { empresa: null, userId };

  const { data, error } = await supabase
    .from("empresas")
    .select("id, mostrar_anuncio_impago")
    .eq("id", empresaId)
    .maybeSingle();

  if (error) return { empresa: null, userId };
  return { empresa: data || null, userId };
}

async function mostrarAnuncio({ storageKey }) {
  ocultarAnuncio();

  const container = document.createElement("div");
  container.innerHTML = await getModalTemplateHtml();
  const modal = container.querySelector("#anuncio-impago");
  if (!modal) return;

  const title = modal.querySelector("#impagoModalTitle");
  if (title) title.textContent = "Aviso importante";

  const message = modal.querySelector("#impagoModalMessage");
  if (message) message.innerHTML = getMensajeHtml();

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

  const { empresa, userId } = await getEmpresaActual();
  if (!empresa || empresa.mostrar_anuncio_impago !== true) {
    ocultarAnuncio();
    return;
  }

  const storageKey = getSessionOnceKey({ empresaId: empresa.id });
  if (wasAlreadyShown(storageKey)) {
    ocultarAnuncio();
    return;
  }

  await mostrarAnuncio({ storageKey });
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

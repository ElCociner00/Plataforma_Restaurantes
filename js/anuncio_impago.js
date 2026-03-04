import { getSessionConEmpresa } from "./session.js";

const BANNER_HTML_PATH = "/Plataforma_Restaurantes/components/banner_impago.html";
const BANNER_CSS_PATH = "/Plataforma_Restaurantes/css/banner_impago.css";
const FACTURACION_URL = "/Plataforma_Restaurantes/facturacion/";

const STORAGE_KEY = "axioma_aviso_bienvenida_v1";

let anuncioInyectado = false;

function ensureBannerStyles() {
  if (document.getElementById("impagoBannerCss")) return;
  const link = document.createElement("link");
  link.id = "impagoBannerCss";
  link.rel = "stylesheet";
  link.href = BANNER_CSS_PATH;
  document.head.appendChild(link);
}

function getSessionOnceKey({ userId, empresaId }) {
  return `${STORAGE_KEY}:${userId || "anon"}:${empresaId || "sin_empresa"}`;
}

function markAsShown(key) {
  if (!key) return;
  sessionStorage.setItem(key, "1");
}

function wasAlreadyShown(key) {
  if (!key) return false;
  return sessionStorage.getItem(key) === "1";
}

function getMensajeHtml() {
  return `Muchas gracias por utilizar nuestra plataforma, esperamos la estés disfrutando, la seguiremos mejorando poco a poco para que el control de tu negocio esté en tus manos. Recuerda que el 15 de cada mes es la fecha de expedición de tu factura electrónica, podrás encontrarla en el módulo de facturación o si quieres pagarla inmediatamente haz click <a href="${FACTURACION_URL}">aquí</a>.`;
}

async function getModalTemplateHtml() {
  try {
    const res = await fetch(BANNER_HTML_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error("template not found");
    return await res.text();
  } catch {
    return "<div id='anuncio-impago' class='impago-modal' role='dialog' aria-modal='true'><div class='impago-modal-card'><h3 id='impagoModalTitle'>Aviso importante</h3><p id='impagoModalMessage'></p><button id='impagoModalAceptar' type='button'>Aceptar</button></div></div>";
  }
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

async function mostrarAnuncio({ storageKey }) {
  ocultarAnuncio();

  const container = document.createElement("div");
  container.innerHTML = await getModalTemplateHtml();
  const modal = container.querySelector("#anuncio-impago");
  if (!modal) return;

  const title = modal.querySelector("#impagoModalTitle");
  if (title) title.textContent = "Aviso importante de facturación";

  const message = modal.querySelector("#impagoModalMessage");
  if (message) message.innerHTML = getMensajeHtml();

  const btnAceptar = modal.querySelector("#impagoModalAceptar");
  btnAceptar?.addEventListener("click", () => {
    markAsShown(storageKey);
    ocultarAnuncio();
  });

  document.body.appendChild(modal);
  document.body.classList.add("has-impago-banner");
  anuncioInyectado = true;
}

export async function verificarYMostrarAnuncio() {
  const session = await getSessionConEmpresa().catch(() => null);
  const empresa = session?.empresa;
  const userId = session?.user?.id;

  if (!empresa || !empresa.mostrar_anuncio_impago) {
    ocultarAnuncio();
    return;
  }

  const storageKey = getSessionOnceKey({ userId, empresaId: empresa.id });
  if (wasAlreadyShown(storageKey)) {
    ocultarAnuncio();
    return;
  }

  ensureBannerStyles();
  await mostrarAnuncio({ storageKey });
}

document.addEventListener("DOMContentLoaded", () => {
  verificarYMostrarAnuncio().catch(() => {
    if (!anuncioInyectado) ocultarAnuncio();
  });
});

window.addEventListener("empresaCambiada", () => {
  verificarYMostrarAnuncio().catch(() => {
    if (!anuncioInyectado) ocultarAnuncio();
  });
});

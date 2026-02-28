
import { supabase } from "./supabase.js";
import { getSessionConEmpresa } from "./session.js";

const BANNER_HTML_PATH = "../components/banner_impago.html";
const BANNER_CSS_PATH = "/Plataforma_Restaurantes/css/banner_impago.css";

let anuncioInyectado = false;

function ensureBannerStyles() {
  if (document.getElementById("impagoBannerCss")) return;
  const link = document.createElement("link");
  link.id = "impagoBannerCss";
  link.rel = "stylesheet";
  link.href = BANNER_CSS_PATH;
  document.head.appendChild(link);
}

async function getDeudaEmpresa(empresaId) {
  if (!empresaId) return 0;
  const { data, error } = await supabase
    .from("facturacion")
    .select("deuda")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) return 0;
  return Number(data?.deuda || 0);
}

function getMessageByDeuda(deuda) {
  if (Number(deuda || 0) > 0) {
    return "Para seguir disfrutando de todas nuestras funciones debes pagar tu plan. Mientras tanto podras seguir viendo tu informacion.";
  }
  return "Mejora tu negocio y evita perder dinero. Adquiere con nosotros un plan para desbloquear funciones avanzadas.";
}

async function buildBannerNode(message) {
  const url = new URL(BANNER_HTML_PATH, import.meta.url);
  const res = await fetch(url);
  const html = await res.text();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = html.trim();
  const node = wrapper.firstElementChild;
  const msgEl = node?.querySelector("#impagoBannerMessage");
  if (msgEl) msgEl.textContent = message;
  return node;
}

export async function verificarYMostrarAnuncio() {
  const session = await getSessionConEmpresa();
  const empresa = session?.empresa;

  if (!empresa?.mostrar_anuncio_impago) {
    ocultarAnuncio();
    return;
  }

  ensureBannerStyles();
  const deuda = await getDeudaEmpresa(empresa.id).catch(() => 0);
  await mostrarAnuncio(getMessageByDeuda(deuda));
}
async function mostrarAnuncio(message) {
  const existente = document.getElementById("anuncio-impago");
  if (existente) {
    const msg = existente.querySelector("#impagoBannerMessage");
    if (msg) msg.textContent = message;
    document.body.classList.add("has-impago-banner");
    anuncioInyectado = true;
    return;
  }

  if (anuncioInyectado) return;
  const anuncio = await buildBannerNode(message);
  if (!anuncio) return;

  document.body.appendChild(anuncio);
  document.body.classList.add("has-impago-banner");
  anuncioInyectado = true;
}

function ocultarAnuncio() {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();
  document.body.classList.remove("has-impago-banner");
  anuncioInyectado = false;
}

document.addEventListener("DOMContentLoaded", verificarYMostrarAnuncio);
window.addEventListener("empresaCambiada", verificarYMostrarAnuncio);

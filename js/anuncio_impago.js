import { supabase } from "./supabase.js";
import { resolveEmpresaPlan } from "./plan.js";
import { getSessionConEmpresa } from "./session.js";

const BANNER_HTML_PATH = "/Plataforma_Restaurantes/components/banner_impago.html";
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

async function getFacturacionEmpresa(empresaId) {
  if (!empresaId) return { deuda: 0, fecha_suspension: null };

  const { data, error } = await supabase
    .from("facturacion")
    .select("deuda,fecha_suspension")
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (error) return { deuda: 0, fecha_suspension: null };
  return {
    deuda: Number(data?.deuda || 0),
    fecha_suspension: data?.fecha_suspension || null
  };
}

function isImpagoByFecha(fechaSuspension) {
  if (!fechaSuspension) return false;
  const target = new Date(fechaSuspension);
  if (Number.isNaN(target.getTime())) return false;
  return Date.now() >= target.getTime();
}

function resolveBannerState(empresa, facturacion) {
  const plan = resolveEmpresaPlan(empresa);
  const deuda = Number(facturacion?.deuda || empresa?.deuda_actual || 0);

  if (deuda > 0) {
    if (isImpagoByFecha(facturacion?.fecha_suspension)) {
      return {
        state: "impago",
        badge: "Impago",
        title: "Cuenta suspendida por pago",
        message: "Tienes pagos pendientes. Regulariza tu deuda para reactivar todos los modulos."
      };
    }

    return {
      state: "morosa",
      badge: "Morosa",
      title: "Tienes una deuda pendiente",
      message: "Realiza el pago antes de la fecha de corte para evitar suspension del servicio."
    };
  }

  if (plan === "free") {
    return {
      state: "free",
      badge: "Plan Free",
      title: "Funciones limitadas en plan free",
      message: "Actualiza a plan pro para activar operaciones completas y automatizaciones."
    };
  }

  return null;
}

async function getBannerTemplateHtml() {
  try {
    const res = await fetch(BANNER_HTML_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error("template not found");
    return await res.text();
  } catch {
    return "<aside id='anuncio-impago' class='impago-banner' role='note' aria-live='polite' data-banner-state='info'><div class='impago-banner-card'><span class='impago-badge' id='impagoBannerBadge'>Aviso</span><h3 id='impagoBannerTitle'>Estado de facturacion</h3><p id='impagoBannerMessage'></p></div></aside>";
  }
}

async function buildBannerNode(config) {
  const container = document.createElement("div");
  container.innerHTML = await getBannerTemplateHtml();
  const node = container.querySelector("#anuncio-impago");
  if (!node) return null;

  node.setAttribute("data-banner-state", config.state || "info");

  const badge = node.querySelector("#impagoBannerBadge");
  if (badge) badge.textContent = config.badge || "Aviso";

  const title = node.querySelector("#impagoBannerTitle");
  if (title) title.textContent = config.title || "Estado de facturacion";

  const msgEl = node.querySelector("#impagoBannerMessage");
  if (msgEl) msgEl.textContent = config.message || "";

  return node;
}

async function mostrarAnuncio(config) {
  const existente = document.getElementById("anuncio-impago");
  if (existente) existente.remove();

  const anuncio = await buildBannerNode(config);
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

export async function verificarYMostrarAnuncio() {
  const session = await getSessionConEmpresa().catch(() => null);
  const empresa = session?.empresa;

  if (!empresa || !empresa.mostrar_anuncio_impago) {
    ocultarAnuncio();
    return;
  }

  ensureBannerStyles();
  const facturacion = await getFacturacionEmpresa(empresa.id).catch(() => ({ deuda: 0, fecha_suspension: null }));
  const config = resolveBannerState(empresa, facturacion);

  if (!config) {
    ocultarAnuncio();
    return;
  }

  await mostrarAnuncio(config);
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

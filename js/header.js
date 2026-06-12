/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/header.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `ensureViewportMeta` (línea aprox. 33): Bloque funcional del módulo.
 * - `getLogoSrc` (línea aprox. 41): Obtiene un valor o recurso.
 * - `resolveRouteForEnv` (línea aprox. 43): Bloque funcional del módulo.
 * - `obtenerNombreEmpresa` (línea aprox. 50): Trabaja con contexto o datos de empresa.
 * - `getOrCreateHeader` (línea aprox. 66): Obtiene un valor o recurso.
 * - `buildMenu` (línea aprox. 82): Construye estructuras de datos.
 * - `wireHeaderEvents` (línea aprox. 144): Bloque funcional del módulo.
 * - `renderFallbackHeader` (línea aprox. 180): Renderiza/actualiza UI.
 * - `inferEnvironmentFromPath` (línea aprox. 207): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import "./mobile_shell.js";
import { supabase } from "./supabase.js";
import { clearActiveLocalContext, clearUserContextCache, getUserContext } from "./session.js";
// IMPORTANTE: Eliminada la dependencia directa de local_context_switcher.js
// Las funciones de locales se cargarán de forma dinámica y opcional
import { ENV_LOGGRO, ENV_SIIGO, getActiveEnvironment, setActiveEnvironment } from "./environment.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";
import { getPermisosEfectivos } from "./permisos.core.js";
import { APP_URLS } from "./urls.js";
import { BRAND, applyBrandingToDocumentTitle } from "./branding.js";

const HEADER_ID = "globalAppHeader";

let anuncioModulePromise = null;

// ==============================================
// MÓDULO DE LOCALES OPCIONAL (NO BLOQUEANTE)
// ==============================================
let localContextModulePromise = null;
let localContextModuleError = false;

async function getLocalContextModule() {
  // Si ya sabemos que el módulo falló, no reintentar
  if (localContextModuleError) return null;
  
  if (localContextModulePromise === undefined) {
    localContextModulePromise = import("./local_context_switcher.js")
      .then(module => {
        console.log("[header] ✅ Módulo de locales cargado correctamente");
        return module;
      })
      .catch(error => {
        console.warn("[header] ⚠️ Módulo de locales no disponible, funciones de cambio de local desactivadas:", error.message);
        localContextModuleError = true;
        return null;
      });
  }
  return localContextModulePromise;
}

async function safeListLocalContexts() {
  try {
    const module = await getLocalContextModule();
    if (module?.listLocalContextsForSwitcher) {
      return await module.listLocalContextsForSwitcher();
    }
  } catch (error) {
    console.warn("[header] No se pudo obtener lista de locales:", error);
  }
  return [];
}

async function safePrepareLocalContextSwitch(empresaId) {
  try {
    const module = await getLocalContextModule();
    if (module?.prepareLocalContextSwitch) {
      return await module.prepareLocalContextSwitch(empresaId);
    }
    throw new Error("Módulo de locales no disponible");
  } catch (error) {
    console.warn("[header] No se pudo cambiar de local:", error);
    throw error;
  }
}

async function loadAnuncioModuleSafe() {
  if (!anuncioModulePromise) {
    anuncioModulePromise = import("./anuncio_impago.js").catch((error) => {
      console.warn("[header] anuncio_impago no disponible, se omite sin romper header:", error);
      return null;
    });
  }
  return anuncioModulePromise;
}

async function safeClearBannerDisplayCache() {
  const mod = await loadAnuncioModuleSafe();
  mod?.clearBannerDisplayCache?.();
}

async function safeVerificarYMostrarAnuncio() {
  const mod = await loadAnuncioModuleSafe();
  await mod?.verificarYMostrarAnuncio?.();
}

const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");


function showLocalContextLoading(message = "Cambiando local...") {
  const overlay = document.createElement("div");
  overlay.className = "local-context-loading-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.innerHTML = `
    <div class="local-context-loading-card">
      <div class="local-context-loading-spinner" aria-hidden="true"></div>
      <strong>${escapeHtml(message)}</strong>
      <span>Preparando tenant y usuario del local. No cierres esta ventana.</span>
    </div>
  `;
  document.body.appendChild(overlay);
}

const buildLocalSwitcherItems = ({ context, localContexts = [] } = {}) => {
  const canManageLocals = ["admin_root", "admin"].includes(String(context?.rol || "").toLowerCase());
  const hasSwitchableLocals = Array.isArray(localContexts) && localContexts.length > 1;

  if (!canManageLocals && !hasSwitchableLocals) return "";

  const safeLocalContexts = Array.isArray(localContexts) ? localContexts : [];
  const items = safeLocalContexts.map((local) => {
    const label = escapeHtml(local.nombre || (local.tipo === "principal" ? "Empresa principal" : "Local"));
    const badge = local.tipo === "principal" ? "Principal" : "Local";
    const activeClass = local.activo ? " active" : "";
    const activeSuffix = local.activo ? `<span class="local-switch-active-label">Actual</span>` : "";
    return `<a href="#" class="local-switch-option${activeClass}" data-switch-local="${escapeHtml(local.empresa_id)}"><span><strong>${label}</strong><small>${badge}</small></span>${activeSuffix}</a>`;
  }).join("");

  const emptyHint = hasSwitchableLocals
    ? ""
    : `<div class="local-switch-empty" role="note">No hay locales disponibles para este usuario. Si acabas de crear uno, verifica que exista en grupos_empresariales y recarga.</div>`;

  return `
        <div class="menu-group-title">Cambiar de local</div>
        ${items}
        ${emptyHint}`;
};

const ensureViewportMeta = () => {
  if (document.querySelector('meta[name="viewport"]')) return;
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1.0";
  document.head.appendChild(meta);
};

const getLogoSrc = () => APP_URLS.logoImage;

const resolveRouteForEnv = async (env, context) => {
  const userId = context?.user?.id || context?.user?.user_id;
  const empresaId = context?.empresa_id || null;
  const permisos = userId ? await getPermisosEfectivos(userId, empresaId).catch(() => []) : [];
  return resolveFirstAllowedRoute(context?.rol, env, permisos);
};

const obtenerNombreEmpresa = async (empresaId) => {
  if (!empresaId) return "";
  try {
    const { data, error } = await supabase
      .from("empresas")
      .select("nombre_comercial")
      .eq("id", empresaId)
      .maybeSingle();

    if (error) return "";
    return String(data?.nombre_comercial || "").trim();
  } catch (_error) {
    return "";
  }
};

function getOrCreateHeader() {
  let header = document.getElementById(HEADER_ID);
  if (header) return header;

  header = document.createElement("header");
  header.id = HEADER_ID;
  header.className = "app-header";
  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="${BRAND.logoAlt}" class="logo-mark" onerror="this.style.display='none'"/></span><span>${BRAND.platformName}</span></div>
    <div class="empresa-header-nombre">Cargando plataforma...</div>
    <nav><a class="nav-link-btn" href="${APP_URLS.facturacion}">Facturacion</a></nav>
  `;
  document.body.prepend(header);
  return header;
}

function buildMenu({ context, environmentForMenu, localContexts = [] }) {
  const userName = context?.user?.email?.split("@")[0] || "Usuario";
  const avatarLabel = userName.charAt(0).toUpperCase() || "U";
  let menu = "";

  if (environmentForMenu === ENV_LOGGRO) {
    if (context?.rol !== "operativo") {
      menu += `<a class="nav-link-btn" href="${APP_URLS.dashboard}">Dashboard</a>`;
    }

    menu += `
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre de turno</button>
        <div class="nav-dropdown-menu">
          <a href="${APP_URLS.cierreTurno}">Cierre de Turno</a>
          <a href="${APP_URLS.historicoCierreTurno}">Historico cierre turno</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre inventarios</button>
        <div class="nav-dropdown-menu">
          <a href="${APP_URLS.cierreInventarios}">Cierre inventarios</a>
          <a href="${APP_URLS.historicoCierreInventarios}">Historico cierre inventario</a>
        </div>
      </div>
    `;
    menu += `<a class="nav-link-btn" href="${APP_URLS.compras}">Compras</a>`;
    menu += `<a class="nav-link-btn" href="${APP_URLS.nomina}">Nomina</a>`;
  }

  if (environmentForMenu === ENV_SIIGO) {
    menu += `<a class="nav-link-btn" href="${APP_URLS.dashboardSiigo}">Dashboard</a>`;
    menu += `<a class="nav-link-btn" href="${APP_URLS.subirFacturasSiigo}">Ver o subir facturas correo</a>`;
    menu += `<a class="nav-link-btn" href="${APP_URLS.nomina}">Nomina</a>`;
  }

  menu += `<a class="nav-link-btn" href="${APP_URLS.facturacion}">Facturacion</a>`;

  const configLink = environmentForMenu === ENV_SIIGO
    ? APP_URLS.configuracionSiigo
    : APP_URLS.configuracion;

  const environmentOptions = environmentForMenu === ENV_LOGGRO
    ? `<a href="#" data-switch-env="siigo">Siigo</a>`
    : `<a href="#" data-switch-env="loggro">Loggro</a>`;

  menu += `
    <div class="nav-dropdown user-dropdown">
      <button type="button" class="nav-dropdown-toggle user-menu-toggle" aria-label="Menu de usuario">
        <span class="user-avatar">${avatarLabel}</span>
        <span class="user-name">${userName}</span>
      </button>
      <div class="nav-dropdown-menu user-dropdown-menu">
        ${context?.rol === "admin_root" || context?.rol === "admin" ? `<a href="${APP_URLS.gestionUsuarios}">Gestión usuarios</a><a href="${APP_URLS.anadirLocal}">Añadir local</a><a href="${configLink}">Configuracion</a>` : ""}
        ${buildLocalSwitcherItems({ context, localContexts })}
        <div class="menu-group-title">Cambiar de entorno</div>
        ${environmentOptions}
        <a href="#" id="logoutBtnMenu">Salir</a>
      </div>
    </div>
  `;

  return menu;
}

function wireHeaderEvents(header, context) {
  header.querySelectorAll(".nav-dropdown-toggle").forEach((toggle) => {
    const parent = toggle.closest(".nav-dropdown");
    toggle.onclick = (event) => {
      event.stopPropagation();
      parent?.classList.toggle("open");
    };
  });

  header.querySelectorAll("[data-switch-env]").forEach((link) => {
    link.onclick = async (event) => {
      event.preventDefault();
      const nextEnv = link.getAttribute("data-switch-env");
      setActiveEnvironment(nextEnv);
      const targetRoute = await resolveRouteForEnv(nextEnv, context);
      window.location.href = targetRoute;
    };
  });

  header.querySelectorAll("[data-switch-local]").forEach((link) => {
    link.onclick = async (event) => {
      event.preventDefault();
      const targetEmpresaId = link.getAttribute("data-switch-local");
      if (!targetEmpresaId || link.classList.contains("active")) return;

      link.setAttribute("aria-busy", "true");
      link.textContent = "Cambiando local...";

      try {
        showLocalContextLoading("Cambiando local...");
        await safePrepareLocalContextSwitch(targetEmpresaId);
        await safeClearBannerDisplayCache();
        clearUserContextCache();
        window.location.reload();
      } catch (error) {
        console.error("[header] No se pudo cambiar de local:", error);
        window.alert(error?.message || "No se pudo cambiar de local. Intenta nuevamente.");
        window.location.reload();
      }
    };
  });

  document.addEventListener("click", () => {
    header.querySelectorAll(".nav-dropdown.open").forEach((dropdown) => dropdown.classList.remove("open"));
  });

  const logoutBtn = header.querySelector("#logoutBtnMenu");
  if (logoutBtn) {
    logoutBtn.onclick = async (event) => {
      event.preventDefault();
      setActiveEnvironment("");
      await safeClearBannerDisplayCache();
      clearActiveLocalContext();
      clearUserContextCache();
      await supabase.auth.signOut();
      window.location.href = APP_URLS.login;
    };
  }
}

function renderFallbackHeader(message = BRAND.platformName) {
  const header = getOrCreateHeader();
  const title = message || BRAND.platformName;
  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="${BRAND.logoAlt}" class="logo-mark" onerror="this.style.display='none'"/></span><span>${BRAND.platformName}</span></div>
    <div class="empresa-header-nombre">${title}</div>
    <nav>
      <a class="nav-link-btn" href="${APP_URLS.dashboard}">Dashboard</a>
      <a class="nav-link-btn" href="${APP_URLS.facturacion}">Facturacion</a>
      <a class="nav-link-btn" href="${APP_URLS.login}">Inicio</a>
    </nav>
  `;
  return header;
}

async function renderAuthenticatedHeader() {
  const header = getOrCreateHeader();
  const context = await getUserContext();
  if (!context) {
    renderFallbackHeader("Sesion no disponible");
    return;
  }

  const activeEnvironment = getActiveEnvironment();
  const currentPath = String(window.location.pathname || "");
  const isGlobalNoTenantPage = currentPath.includes("/gestion_empresas/") || currentPath.includes("/facturacion/");

  const inferEnvironmentFromPath = () => {
    if (currentPath.includes("/siigo/")) return ENV_SIIGO;
    return ENV_LOGGRO;
  };

  if (!activeEnvironment && !isGlobalNoTenantPage) {
    setActiveEnvironment(inferEnvironmentFromPath());
  }

  const environmentForMenu = getActiveEnvironment() || (isGlobalNoTenantPage ? ENV_LOGGRO : inferEnvironmentFromPath());
  const nombreEmpresa = await obtenerNombreEmpresa(context.empresa_id);
  
  // Carga de locales de forma NO BLOQUEANTE (si falla, sigue funcionando)
  let localContexts = [];
  try {
    localContexts = await safeListLocalContexts();
  } catch (error) {
    console.warn("[header] No se pudo cargar el selector de locales:", error);
    // localContexts ya es [], el header sigue funcionando
  }
  
  const menu = buildMenu({ context, environmentForMenu, localContexts });

  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="${BRAND.logoAlt}" class="logo-mark" onerror="this.style.display='none'"/></span><span>${BRAND.platformName}</span></div>
    <div class="empresa-header-nombre">${nombreEmpresa || ""}</div>
    <nav>${menu}</nav>
  `;

  wireHeaderEvents(header, context);
}

document.addEventListener("DOMContentLoaded", async () => {
  applyBrandingToDocumentTitle();
  ensureViewportMeta();
  getOrCreateHeader();
  safeVerificarYMostrarAnuncio().catch(() => {});

  try {
    await renderAuthenticatedHeader();
  } catch (error) {
    console.error("[header] No se pudo renderizar el header autenticado:", error);
    renderFallbackHeader("Menu temporal disponible");
  }
});

// Inicialización silenciosa del módulo de locales (no bloqueante, no dependiente)
setTimeout(() => import('/js/local_context_switcher.js').then(m => m.initializeLocalContext?.()).catch(() => {}), 2000);

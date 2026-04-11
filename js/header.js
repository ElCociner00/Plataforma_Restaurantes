import "./mobile_shell.js";
import { supabase } from "./supabase.js";
import { clearUserContextCache, getUserContext } from "./session.js";
import { clearBannerDisplayCache, verificarYMostrarAnuncio } from "./anuncio_impago.js";
import { ENV_LOGGRO, ENV_SIIGO, getActiveEnvironment, setActiveEnvironment } from "./environment.js";
import { resolveFirstAllowedRoute } from "./access_control.local.js";
import { getPermisosEfectivos } from "./permisos.core.js";

const HEADER_ID = "globalAppHeader";

const ensureViewportMeta = () => {
  if (document.querySelector('meta[name="viewport"]')) return;
  const meta = document.createElement("meta");
  meta.name = "viewport";
  meta.content = "width=device-width, initial-scale=1.0";
  document.head.appendChild(meta);
};

const getLogoSrc = () => {
  const path = window.location.pathname || "";
  return path.startsWith("/Plataforma_Restaurantes/")
    ? "/Plataforma_Restaurantes/images/Logo.webp"
    : "/images/Logo.webp";
};

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
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="Logo AXIOMA-tech" class="logo-mark" onerror="this.style.display='none'"/></span><span>AXIOMA-tech</span></div>
    <div class="empresa-header-nombre">Cargando plataforma...</div>
    <nav><a class="nav-link-btn" href="/Plataforma_Restaurantes/facturacion/">Facturacion</a></nav>
  `;
  document.body.prepend(header);
  return header;
}

function buildMenu({ context, environmentForMenu }) {
  const userName = context?.user?.email?.split("@")[0] || "Usuario";
  const avatarLabel = userName.charAt(0).toUpperCase() || "U";
  let menu = "";

  if (environmentForMenu === ENV_LOGGRO) {
    if (context?.rol !== "operativo") {
      menu += `<a class="nav-link-btn" href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>`;
    }

    menu += `
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre de turno</button>
        <div class="nav-dropdown-menu">
          <a href="/Plataforma_Restaurantes/cierre_turno/">Cierre de Turno</a>
          <a href="/Plataforma_Restaurantes/cierre_turno/historico_cierre_turno.html">Historico cierre turno</a>
        </div>
      </div>
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre inventarios</button>
        <div class="nav-dropdown-menu">
          <a href="/Plataforma_Restaurantes/cierre_inventarios/">Cierre inventarios</a>
          <a href="/Plataforma_Restaurantes/cierre_inventarios/historico_cierre_inventarios.html">Historico cierre inventario</a>
        </div>
      </div>
    `;
  }

  if (environmentForMenu === ENV_SIIGO) {
    menu += `<a class="nav-link-btn" href="/Plataforma_Restaurantes/siigo/dashboard_siigo/">Dashboard</a>`;
    menu += `<a class="nav-link-btn" href="/Plataforma_Restaurantes/siigo/subir_facturas_siigo/">Ver o subir facturas correo</a>`;
    menu += `<a class="nav-link-btn" href="/Plataforma_Restaurantes/nomina/">Nomina (borrador)</a>`;
  }

  menu += `<a class="nav-link-btn" href="/Plataforma_Restaurantes/facturacion/">Facturacion</a>`;

  const configLink = environmentForMenu === ENV_SIIGO
    ? "/Plataforma_Restaurantes/siigo/configuracion_siigo/"
    : "/Plataforma_Restaurantes/configuracion/";

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
        ${context?.rol === "admin_root" || context?.rol === "admin" ? `<a href="${configLink}">Configuracion</a>` : ""}
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

  document.addEventListener("click", () => {
    header.querySelectorAll(".nav-dropdown.open").forEach((dropdown) => dropdown.classList.remove("open"));
  });

  const logoutBtn = header.querySelector("#logoutBtnMenu");
  if (logoutBtn) {
    logoutBtn.onclick = async (event) => {
      event.preventDefault();
      setActiveEnvironment("");
      clearBannerDisplayCache();
      clearUserContextCache();
      await supabase.auth.signOut();
      window.location.href = "/Plataforma_Restaurantes/index.html";
    };
  }
}

function renderFallbackHeader(message = "AXIOMA-tech") {
  const header = getOrCreateHeader();
  const title = message || "AXIOMA-tech";
  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="Logo AXIOMA-tech" class="logo-mark" onerror="this.style.display='none'"/></span><span>AXIOMA-tech</span></div>
    <div class="empresa-header-nombre">${title}</div>
    <nav>
      <a class="nav-link-btn" href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>
      <a class="nav-link-btn" href="/Plataforma_Restaurantes/facturacion/">Facturacion</a>
      <a class="nav-link-btn" href="/Plataforma_Restaurantes/index.html">Inicio</a>
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
    if (currentPath.includes("/siigo/") || currentPath.includes("/nomina/")) return ENV_SIIGO;
    return ENV_LOGGRO;
  };

  if (!activeEnvironment && !isGlobalNoTenantPage) {
    setActiveEnvironment(inferEnvironmentFromPath());
  }

  const environmentForMenu = getActiveEnvironment() || (isGlobalNoTenantPage ? ENV_LOGGRO : inferEnvironmentFromPath());
  const nombreEmpresa = await obtenerNombreEmpresa(context.empresa_id);
  const menu = buildMenu({ context, environmentForMenu });

  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="Logo AXIOMA-tech" class="logo-mark" onerror="this.style.display='none'"/></span><span>AXIOMA-tech</span></div>
    <div class="empresa-header-nombre">${nombreEmpresa || ""}</div>
    <nav>${menu}</nav>
  `;

  wireHeaderEvents(header, context);
}

document.addEventListener("DOMContentLoaded", async () => {
  ensureViewportMeta();
  getOrCreateHeader();
  verificarYMostrarAnuncio().catch(() => {});

  try {
    await renderAuthenticatedHeader();
  } catch (error) {
    console.error("[header] No se pudo renderizar el header autenticado:", error);
    renderFallbackHeader("Menu temporal disponible");
  }
});

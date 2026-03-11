import { supabase } from "./supabase.js";
import { getUserContext } from "./session.js";
import { verificarYMostrarAnuncio } from "./anuncio_impago.js";
import { ENV_LOGGRO, ENV_SIIGO, getActiveEnvironment, setActiveEnvironment } from "./environment.js";


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



const resolveRouteForEnv = (env, context) => {
  const rol = String(context?.rol || "").toLowerCase();
  if (env === ENV_SIIGO) {
    if (rol === "operativo") return "/Plataforma_Restaurantes/cierre_turno/";
    return "/Plataforma_Restaurantes/siigo/subir_facturas_siigo/";
  }
  if (rol === "operativo") return "/Plataforma_Restaurantes/cierre_turno/";
  return "/Plataforma_Restaurantes/dashboard/";
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

document.addEventListener("DOMContentLoaded", async () => {
  ensureViewportMeta();
  verificarYMostrarAnuncio().catch(() => {});
  const context = await getUserContext();
  if (!context) return;

  const activeEnvironment = getActiveEnvironment();
  const currentPath = String(window.location.pathname || "");
  const isGlobalNoTenantPage = currentPath.includes("/gestion_empresas/") || currentPath.includes("/facturacion/");
  if (!activeEnvironment && !isGlobalNoTenantPage) {
    window.location.href = "/Plataforma_Restaurantes/entorno/";
    return;
  }
  const environmentForMenu = activeEnvironment || (isGlobalNoTenantPage ? ENV_LOGGRO : "");
  const header = document.createElement("header");
  header.className = "app-header";
  const nombreEmpresa = await obtenerNombreEmpresa(context.empresa_id);

  const userName = context.user?.email?.split("@")[0] || "Usuario";
  const avatarLabel = userName.charAt(0).toUpperCase() || "U";

  let menu = "";

  if (environmentForMenu === ENV_LOGGRO) {
    if (context.rol !== "operativo") {
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
    `;

    menu += `
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
        ${context.rol === "admin_root" || context.rol === "admin" ? `<a href="${configLink}">Configuracion</a>` : ""}
        <div class="menu-group-title">Cambiar de entorno</div>
        ${environmentOptions}
        <a href="#" id="logoutBtnMenu">Salir</a>
      </div>
    </div>
  `;

  header.innerHTML = `
    <div class="logo"><span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="Logo AXIOMA-tech" class="logo-mark" onerror="this.style.display='none'"/></span><span>AXIOMA-tech</span></div>
    <div class="empresa-header-nombre">${nombreEmpresa || ""}</div>
    <nav>${menu}</nav>
  `;

  document.body.prepend(header);

  header.querySelectorAll(".nav-dropdown-toggle").forEach((toggle) => {
    const parent = toggle.closest(".nav-dropdown");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      parent?.classList.toggle("open");
    });
  });

  header.querySelectorAll("[data-switch-env]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const nextEnv = link.getAttribute("data-switch-env");
      setActiveEnvironment(nextEnv);
      window.location.href = resolveRouteForEnv(nextEnv, context);
    });
  });

  document.addEventListener("click", () => {
    header.querySelectorAll(".nav-dropdown.open").forEach((dropdown) => dropdown.classList.remove("open"));
  });

  const logoutBtn = document.getElementById("logoutBtnMenu");
  logoutBtn.onclick = async (event) => {
    event.preventDefault();
    setActiveEnvironment("");
    await supabase.auth.signOut();
    window.location.href = "/Plataforma_Restaurantes/index.html";
  };
});



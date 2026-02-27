import { supabase } from "./supabase.js";
import { getSessionConEmpresa, getUserContext } from "./session.js";
import { verificarYMostrarAnuncio } from "./anuncio_impago.js";
import { ENV_LOGGRO, ENV_SIIGO, getActiveEnvironment, setActiveEnvironment } from "./environment.js";

document.addEventListener("DOMContentLoaded", async () => {
  const context = await getUserContext();
  if (!context) return;
  const sessionEmpresa = await getSessionConEmpresa().catch(() => null);
  mostrarBannerPlan(sessionEmpresa?.empresa || null);
  verificarYMostrarAnuncio().catch(() => {});

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

  const userName = context.user?.email?.split("@")[0] || "Usuario";
  const avatarLabel = userName.charAt(0).toUpperCase() || "U";

  let menu = "";

  if (environmentForMenu === ENV_LOGGRO) {
    if (context.rol !== "operativo") {
      menu += `<a href="/Plataforma_Restaurantes/dashboard/">Dashboard</a>`;
    }

    menu += `
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre de Turno ▾</button>
        <div class="nav-dropdown-menu">
          <a href="/Plataforma_Restaurantes/cierre_turno/">Cierre de Turno</a>
          <a href="/Plataforma_Restaurantes/cierre_turno/historico_cierre_turno.html">Histórico cierres de turno</a>
        </div>
      </div>
    `;

    menu += `
      <div class="nav-dropdown">
        <button type="button" class="nav-dropdown-toggle">Cierre Inventarios ▾</button>
        <div class="nav-dropdown-menu">
          <a href="/Plataforma_Restaurantes/cierre_inventarios/">Cierre inventarios</a>
          <a href="/Plataforma_Restaurantes/cierre_inventarios/historico_cierre_inventarios.html">Histórico cierre inventarios</a>
        </div>
      </div>
    `;
  }

  if (environmentForMenu === ENV_SIIGO) {
    menu += `<a href="/Plataforma_Restaurantes/siigo/dashboard_siigo/">Dashboard</a>`;
    menu += `<a href="/Plataforma_Restaurantes/siigo/subir_facturas_siigo/">Ver o subir facturas correo</a>`;
  }

  menu += `<a href="/Plataforma_Restaurantes/facturacion/">Facturacion</a>`;

  const configLink = environmentForMenu === ENV_SIIGO
    ? "/Plataforma_Restaurantes/siigo/configuracion_siigo/"
    : "/Plataforma_Restaurantes/configuracion/";

  const environmentOptions = environmentForMenu === ENV_LOGGRO
    ? `<a href="#" data-switch-env="siigo">Siigo</a>`
    : `<a href="#" data-switch-env="loggro">Loggro</a>`;

  menu += `
    <div class="nav-dropdown user-dropdown">
      <button type="button" class="nav-dropdown-toggle user-menu-toggle" aria-label="Menú de usuario">
        <span class="user-avatar">${avatarLabel}</span>
        <span class="user-name">${userName}</span>
      </button>
      <div class="nav-dropdown-menu user-dropdown-menu">
        ${context.rol === "admin_root" || context.rol === "admin" ? `<a href="${configLink}">Configuración</a>` : ""}
        <div class="menu-group-title">Cambiar de entorno</div>
        ${environmentOptions}
        <a href="#" id="logoutBtnMenu">Salir</a>
      </div>
    </div>
  `;

  header.innerHTML = `
    <div class="logo">AXIOMA</div>
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
      window.location.href = "/Plataforma_Restaurantes/entorno/";
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

function mostrarBannerPlan(empresa) {
  const plan = String(empresa?.plan_actual || empresa?.plan || "").toLowerCase();
  if (!empresa || plan !== "free") return;
  if (document.getElementById("banner-plan-free")) return;

  const banner = document.createElement("div");
  banner.id = "banner-plan-free";
  banner.innerHTML = `
    <div style="background:#fbbf24;color:black;padding:4px;text-align:center;">
      MODO GRATUITO - Solo visualizacion. Actualiza a PRO para operar.
    </div>
  `;
  document.body.prepend(banner);
}

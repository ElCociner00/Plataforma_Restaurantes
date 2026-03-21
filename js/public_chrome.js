import "./mobile_shell.js";

const getLogoSrc = () => {
  const path = window.location.pathname || "";
  return path.startsWith("/Plataforma_Restaurantes/")
    ? "/Plataforma_Restaurantes/images/Logo.webp"
    : "/images/Logo.webp";
};

function renderPublicHeader() {
  if (document.querySelector("header.app-header.public-header")) return;
  const header = document.createElement("header");
  header.className = "app-header public-header";
  header.innerHTML = `
    <div class="logo public-logo">
      <span class="logo-mark-wrap"><img src="${getLogoSrc()}" alt="Logo AXIOMA-tech" class="logo-mark" onerror="this.style.display='none'"/></span>
      <span>AXIOMA-tech</span>
    </div>
  `;
  document.body.prepend(header);
}

document.addEventListener("DOMContentLoaded", () => {
  try {
    if (!document.querySelector('meta[name="viewport"]')) {
      const meta = document.createElement("meta");
      meta.name = "viewport";
      meta.content = "width=device-width, initial-scale=1.0";
      document.head.appendChild(meta);
    }
    renderPublicHeader();
  } catch (error) {
    console.error("[public_chrome] No se pudo renderizar el header publico:", error);
  }
});

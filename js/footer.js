import "./mobile_shell.js";

const FOOTER_LINKS = [
  { label: "Términos y Condiciones", href: "/Plataforma_Restaurantes/legal/terminos.html" },
  { label: "Política de Privacidad", href: "/Plataforma_Restaurantes/legal/privacidad.html" },
  { label: "Política de Cookies", href: "/Plataforma_Restaurantes/legal/cookies.html" },
  { label: "Tratamiento de Datos", href: "/Plataforma_Restaurantes/legal/datos.html" },
  { label: "Responsabilidad Legal", href: "/Plataforma_Restaurantes/legal/responsabilidad.html" },
  { label: "Política de Seguridad", href: "/Plataforma_Restaurantes/legal/seguridad.html" },
  { label: "Consentimientos", href: "/Plataforma_Restaurantes/legal/consentimientos.html" }
];

const FOOTER_OFFSET_VAR = "--legal-footer-offset";
const FALLBACK_HEADER_ID = "globalHeaderFallbackFromFooter";

const getLogoSrc = () => {
  const path = window.location.pathname || "";
  return path.startsWith("/Plataforma_Restaurantes/")
    ? "/Plataforma_Restaurantes/images/Logo.webp"
    : "/images/Logo.webp";
};

const syncFooterOffset = (footer) => {
  const footerHeight = Math.ceil(footer.getBoundingClientRect().height);
  const offset = `${footerHeight}px`;
  document.body.style.setProperty(FOOTER_OFFSET_VAR, offset);
  document.documentElement.style.setProperty(FOOTER_OFFSET_VAR, offset);
};

function ensureFallbackHeader() {
  if (document.querySelector("header.app-header")) return;
  if (document.getElementById(FALLBACK_HEADER_ID)) return;

  const header = document.createElement("header");
  header.id = FALLBACK_HEADER_ID;
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
  if (document.querySelector("footer.legal-footer")) return;

  const footer = document.createElement("footer");
  footer.className = "legal-footer";

  const linksHtml = FOOTER_LINKS
    .map((item) => `<a href="${item.href}" target="_blank" rel="noopener noreferrer">${item.label}</a>`)
    .join('<span class="sep">·</span>');

  footer.innerHTML = `
    <div class="legal-footer-inner">
      <p class="legal-copy">© 2026 AXIOMA-tech by Global Nexo SAS</p>
      <nav class="legal-links" aria-label="Legal">
        ${linksHtml}
      </nav>
    </div>
  `;

  document.body.appendChild(footer);
  document.body.classList.add("has-legal-footer");

  const applyOffset = () => syncFooterOffset(footer);
  applyOffset();

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(applyOffset);
    observer.observe(footer);
  }

  window.addEventListener("resize", applyOffset);

  ensureFallbackHeader();
  window.setTimeout(ensureFallbackHeader, 300);
  window.setTimeout(ensureFallbackHeader, 1200);
});

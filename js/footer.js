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

const syncFooterOffset = (footer) => {
  const footerHeight = Math.ceil(footer.getBoundingClientRect().height);
  const offset = `${footerHeight}px`;
  document.body.style.setProperty(FOOTER_OFFSET_VAR, offset);
  document.documentElement.style.setProperty(FOOTER_OFFSET_VAR, offset);
};

document.addEventListener("DOMContentLoaded", () => {
  if (document.querySelector("footer.legal-footer")) return;

  const footer = document.createElement("footer");
  footer.className = "legal-footer";

  const linksHtml = FOOTER_LINKS
    .map((item) => `<a href="${item.href}" target="_blank" rel="noopener noreferrer">${item.label}</a>`)
    .join('<span class="sep">·</span>');

  footer.innerHTML = `
    <div class="legal-footer-inner">
      <p class="legal-copy">© 2026 AXIOMA by Global Nexo SAS</p>
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
});

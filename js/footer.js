import "./mobile_shell.js";
import { APP_URLS } from "./urls.js";
const FOOTER_LINKS = [
  { label: "Términos y Condiciones", href: APP_URLS.legalTerminos },
  { label: "Política de Privacidad", href: APP_URLS.legalPrivacidad },
  { label: "Política de Cookies", href: APP_URLS.legalCookies },
  { label: "Tratamiento de Datos", href: APP_URLS.legalDatos },
  { label: "Responsabilidad Legal", href: APP_URLS.legalResponsabilidad },
  { label: "Política de Seguridad", href: APP_URLS.legalSeguridad },
  { label: "Consentimientos", href: APP_URLS.legalConsentimientos }
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
});

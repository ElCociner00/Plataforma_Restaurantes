/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/public_chrome.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `getLogoSrc` (línea aprox. 4): Obtiene un valor o recurso.
 * - `renderPublicHeader` (línea aprox. 6): Renderiza/actualiza UI.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
import "./mobile_shell.js";
import { APP_URLS } from "./urls.js";

const getLogoSrc = () => APP_URLS.logoImage;

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

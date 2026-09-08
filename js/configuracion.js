/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/configuracion.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - Este archivo está orientado a configuración/arranque sin funciones explícitas extensas.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
// Módulo reservado para futuras mejoras de configuración.
// Se mantiene intencionalmente ligero para conservar limpia la vista principal
// de acordeones y redirecciones.

import { getUserContext } from "./session.js";

document.addEventListener("DOMContentLoaded", async () => {
  const context = await getUserContext();
  const rol = String(context?.rol || "").toLowerCase();
  const isAdmin = ["admin_root", "admin", "administrador", "master"].includes(rol);

  if (!isAdmin) {
    // Ocultar opciones de admin
    const accordions = document.querySelectorAll(".accordion-toggle");
    accordions.forEach(button => {
      const text = button.textContent.trim().toLowerCase();
      if (text === "usuarios" || text === "apis e integraciones") {
        button.style.display = "none";
        const content = button.nextElementSibling;
        if (content) {
          content.style.display = "none";
        }
      }
    });
  }
});

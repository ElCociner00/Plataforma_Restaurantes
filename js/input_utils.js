/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/input_utils.js
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
export function enforceNumericInput(elements) {
  elements.forEach(element => {
    if (!element) return;
    element.addEventListener("input", () => {
      const digitsOnly = element.value.replace(/\D+/g, "");
      if (element.value !== digitsOnly) {
        element.value = digitsOnly;
      }
    });
  });
}

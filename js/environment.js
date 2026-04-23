/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/environment.js
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
export const ENV_LOGGRO = "loggro";
export const ENV_SIIGO = "siigo";
export const ENV_STORAGE_KEY = "app_entorno_activo";

export const getActiveEnvironment = () => localStorage.getItem(ENV_STORAGE_KEY) || "";

export const setActiveEnvironment = (env) => {
  if (!env) {
    localStorage.removeItem(ENV_STORAGE_KEY);
    return;
  }
  localStorage.setItem(ENV_STORAGE_KEY, env);
};

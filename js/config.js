/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/config.js
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
import { APP_URLS } from "./urls.js";

export const SUPABASE_CONFIG = {
  url: "https://tgkvcvnwwnrlyhbqmhaf.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRna3Zjdm53d25ybHloYnFtaGFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczOTM0NzIsImV4cCI6MjEwMjk2OTQ3Mn0.JBFZDKXnCdO4kW17UOeshW6kJrEqT1lo_gPob349zA0",
  // Clave publicable del proyecto "Enkrato Google" (tgkvcvnwwnrlyhbqmhaf).
  // La anterior pertenecía a otro proyecto y devolvía "Invalid API key";
  // no rompía nada porque js/supabase.js usa anonKey, pero era una trampa
  // para cualquiera que la tomara de aquí. Ningún archivo la consume hoy.
  publishableKey: "sb_publishable_pjP9JOVNeQnGseLvshx2Xw_E3jKI85R"
};

export const APP_ROUTES = {
  login: APP_URLS.login,
  dashboard: APP_URLS.dashboard
};

export const WEBHOOKS = {
  getUserContext: ""
};

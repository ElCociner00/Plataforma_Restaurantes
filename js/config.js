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
  url: "https://ivgzwgyjyqfunheaesxx.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml2Z3p3Z3lqeXFmdW5oZWFlc3h4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4NjAxMDUsImV4cCI6MjA4NTQzNjEwNX0.5Q-MQ7fKfCG9Qo09G_vub3-Rn6FHLJ18sf8eKGndhbI",
  publishableKey: "sb_publishable_6GQt0KEvMHiMuhi6ZPu8dQ_tQOhsF7D"
};

export const APP_ROUTES = {
  login: APP_URLS.login,
  dashboard: APP_URLS.dashboard
};

export const WEBHOOKS = {
  getUserContext: ""
};

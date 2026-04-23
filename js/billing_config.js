/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/billing_config.js
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

export const BILLING_FACTURACION_URL = APP_URLS.facturacion;

export const BILLING_PAYMENT_CODES = {
  puntual: "mercado_pago_puntual",
  suscripcion: "mercado_pago_suscripcion"
};

export const BILLING_PAYMENT_URLS_FALLBACK = {
  puntual: "https://mpago.li/15d6BkC",
  suscripcion: "https://www.mercadopago.com.co/subscriptions/checkout?preapproval_plan_id=418f65131d8f43c18f38b7e23615f55e"
};

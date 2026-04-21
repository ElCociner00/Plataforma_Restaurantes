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

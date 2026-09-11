/**
 * Veredictos de un pedido Rappi en lenguaje de quien atiende.
 *
 * Por qué existe: un empleado sin acceso a Rappi no puede saber si un
 * domicilio está pago, si llegó o si siquiera existe. Así se coló el fraude de
 * las transferencias falsas: el repartidor, los empleados y el dueño veían un
 * "comprobante" y nadie tenía cómo contrastarlo. Estas funciones convierten
 * los estados de Rappi en respuestas directas a esas dos preguntas.
 *
 * Son puras (sin DOM ni red) para poder probarlas: tools/test_rappi_veredictos.mjs.
 */

/** Ciclo feliz, en el orden en que Rappi lo recorre. */
export const DELIVERY_STEPS = Object.freeze([
  { status: "RECEIVED", label: "Recibido" },
  { status: "IN_PROGRESS", label: "Aceptado" },
  { status: "READY", label: "Listo" },
  { status: "COURIER_AT_STORE", label: "Repartidor en el local" },
  { status: "IN_DELIVERY", label: "En camino" },
  { status: "ARRIVED", label: "Llegó donde el cliente" },
  { status: "COMPLETED", label: "Entregado" },
]);

const STOPPED = new Set(["CANCELLED", "REJECTED", "NOT_ACCEPTED"]);

const CANCEL_REASONS = Object.freeze({
  cancel_by_user: "El cliente lo canceló.",
  canceled_with_charge: "El cliente lo canceló y Rappi le cobró la cancelación.",
  cancel_without_charges: "El cliente lo canceló sin cargo.",
  cancel_by_support: "Soporte de Rappi lo canceló.",
  cancel_by_support_with_charge: "Soporte de Rappi lo canceló (con cargo al cliente).",
  cancel_by_application_user: "El local lo canceló desde la aplicación.",
  canceled_from_cms: "Soporte de Rappi lo canceló.",
  canceled_by_fraud_automation: "Rappi lo canceló por sospecha de fraude.",
  canceled_store_closed: "Rappi lo canceló porque la tienda figuraba cerrada.",
  cancel_by_sk_with_charge: "El repartidor lo canceló.",
});

const PAYMENT_LABELS = Object.freeze({
  cc: "tarjeta de crédito",
  credit_card: "tarjeta de crédito",
  dc: "tarjeta débito",
  debit_card: "tarjeta débito",
  rappi_pay: "RappiPay",
  rappipay: "RappiPay",
  pse: "PSE",
  nequi: "Nequi",
  daviplata: "Daviplata",
  cash: "efectivo",
});

export function paymentMethodLabel(method) {
  const key = String(method || "").trim().toLowerCase();
  return PAYMENT_LABELS[key] || key.replaceAll("_", " ") || "sin dato";
}

export function isCashPayment(method) {
  return ["cash", "efectivo"].includes(String(method || "").trim().toLowerCase());
}

/**
 * ¿Está pago y quién cobra? La regla que corta el fraude: un pedido de Rappi
 * nunca se le paga al local por transferencia. O lo pagó el cliente en la app,
 * o lo cobra el repartidor de Rappi en efectivo.
 */
export function paymentVerdict(order, formatMoney = defaultMoney) {
  const method = String(order?.payment_method || "").trim();
  const status = String(order?.operational_status || "").toUpperCase();
  if (STOPPED.has(status)) {
    return {
      tone: "neutral",
      title: "No hay nada que cobrar",
      detail: "El pedido no siguió adelante en Rappi. Si alguien muestra un comprobante de pago por este pedido, no es válido.",
    };
  }
  if (!method) {
    return {
      tone: "warn",
      title: "Rappi no informó la forma de pago",
      detail: "Consulta con el administrador antes de despachar.",
    };
  }
  if (isCashPayment(method)) {
    const amount = Number(order?.total_to_pay) > 0 ? order.total_to_pay : order?.total_order;
    return {
      tone: "warn",
      title: `Efectivo: el repartidor de Rappi le cobra ${formatMoney(amount)} al cliente`,
      detail: "Ese dinero lo recibe el repartidor, no el local. Nadie del local cobra ni acepta transferencias por este pedido.",
    };
  }
  return {
    tone: "ok",
    title: "Pagado en línea dentro de Rappi",
    detail: `El cliente pagó con ${paymentMethodLabel(method)} en la app. Rappi le liquida al local; nadie debe cobrarle al cliente ni aceptar comprobantes de transferencia.`,
  };
}

/** ¿Dónde va el pedido y se entregó? */
export function deliveryVerdict(order, formatTime = defaultTime) {
  const status = String(order?.operational_status || "UNKNOWN").toUpperCase();
  const acceptance = String(order?.acceptance_status || "").toUpperCase();
  const courier = order?.courier_name ? ` Repartidor asignado: ${order.courier_name}.` : "";
  switch (status) {
    case "COMPLETED":
      return { tone: "ok", title: `Entregado al cliente${order?.delivered_at ? ` a las ${formatTime(order.delivered_at)}` : ""}`, detail: `Rappi confirmó que el cliente recibió el pedido.${courier}` };
    case "ARRIVED":
      return { tone: "info", title: "El repartidor llegó donde el cliente", detail: `Falta que Rappi confirme la entrega.${courier}` };
    case "IN_DELIVERY":
      return { tone: "info", title: "En camino al cliente", detail: `El repartidor ya recogió el pedido.${courier}` };
    case "COURIER_AT_STORE":
      return { tone: "info", title: "El repartidor está en el local", detail: `Entrégale el pedido solo si es el repartidor asignado.${courier}` };
    case "READY":
      return { tone: "info", title: "Listo, esperando al repartidor", detail: courier.trim() || "Rappi está asignando un repartidor." };
    case "IN_PROGRESS":
      return { tone: "info", title: "Aceptado, en preparación", detail: courier.trim() || "Rappi asignará un repartidor." };
    case "RECEIVED":
      if (acceptance === "FAILED") {
        return { tone: "bad", title: "No se pudo aceptar automáticamente", detail: order?.acceptance_error || "Acéptalo ya: Rappi lo cancela si nadie lo acepta en 6 minutos." };
      }
      return { tone: "warn", title: "Esperando aceptación", detail: acceptance === "MANUAL" ? "Esta tienda acepta los pedidos desde la tablet de Rappi. Si nadie lo acepta en 6 minutos, Rappi lo cancela." : "Enkrato lo está aceptando en Rappi." };
    case "NOT_ACCEPTED":
      return { tone: "bad", title: "Vencido: nadie lo aceptó a tiempo", detail: "Rappi lo cancela a los 6 minutos sin aceptación. No lo prepares ni lo despaches." };
    case "CANCELLED":
      return { tone: "bad", title: "Cancelado", detail: `${cancelReason(order?.cancel_event)} No lo despaches; si ya salió, avisa a Rappi.` };
    case "REJECTED":
      return { tone: "bad", title: "Rechazado", detail: "El pedido fue rechazado y no se entrega." };
    default:
      return { tone: "neutral", title: "Sin información de Rappi todavía", detail: "Actualiza en unos segundos." };
  }
}

const EVENT_LABELS = Object.freeze({
  taken_visible_order: "Rappi confirmó la aceptación",
  replace_storekeeper: "Rappi cambió de repartidor",
  ready_for_pick_up: "Listo para recoger",
  domiciliary_in_store: "El repartidor llegó al local",
  hand_to_domiciliary: "Se le entregó el pedido al repartidor",
  arrive: "El repartidor llegó donde el cliente",
  close_order: "El cliente recibió el pedido",
  timeout: "Vencido: nadie lo aceptó en 6 minutos",
});

/** Texto de una línea del historial de un pedido. */
export function eventLabel(event) {
  const type = String(event?.event_type || "").toUpperCase();
  const name = String(event?.rappi_status || "").trim().toLowerCase();
  if (type === "NEW_ORDER") return "Pedido recibido de Rappi";
  if (type === "ENKRATO_ACCEPT") {
    return event?.additional_information?.mode === "manual"
      ? "Aceptado en Rappi desde Enkrato por el equipo"
      : "Aceptado en Rappi automáticamente por Enkrato";
  }
  if (type === "ORDER_EVENT_CANCEL" || name.includes("cancel")) return `Cancelado: ${cancelReason(name)}`;
  return EVENT_LABELS[name] || (name ? name.replaceAll("_", " ") : "Actualización de Rappi");
}

export function cancelReason(event) {
  const key = String(event || "").trim().toLowerCase();
  return CANCEL_REASONS[key] || "Rappi canceló el pedido.";
}

/**
 * Posición del pedido en el ciclo: índice del paso alcanzado y si se detuvo
 * (cancelado, rechazado o vencido) antes de entregarse.
 */
export function deliveryProgress(order) {
  const status = String(order?.operational_status || "").toUpperCase();
  const index = DELIVERY_STEPS.findIndex((step) => step.status === status);
  if (STOPPED.has(status)) {
    const reached = order?.acceptance_status === "ACCEPTED" ? 1 : 0;
    return { reached, stopped: true };
  }
  return { reached: Math.max(0, index), stopped: false };
}

/**
 * Respuesta para "¿este domicilio es de Rappi?" cuando el número no aparece.
 * No existir es en sí la señal de alarma.
 */
export function notFoundVerdict(number) {
  return {
    tone: "bad",
    title: `No existe un pedido Rappi ${number} para este local`,
    detail: "No lo despaches como pedido de Rappi ni lo des por pagado. Revisa el número con el cliente o con el repartidor, y si insisten en que ya pagaron por transferencia, confírmalo con el administrador antes de entregar.",
  };
}

function defaultMoney(value) {
  const amount = Number(value ?? 0);
  return `$${Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString("es-CO")}`;
}

function defaultTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
}

// Los veredictos son lo que lee un empleado sin acceso a Rappi para decidir
// si despacha un domicilio o lo da por pagado. Si se equivocan, vuelve a abrirse
// la puerta al fraude de las transferencias falsas; por eso se prueban aquí.
import {
  cancelReason, deliveryProgress, deliveryVerdict, eventLabel, notFoundVerdict, paymentVerdict,
} from "../js/rappi/veredictos.js";

const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const money = (value) => `$${Number(value).toLocaleString("es-CO")}`;
const time = () => "20:44";

// Pago
const online = paymentVerdict({ payment_method: "cc", operational_status: "IN_PROGRESS", total_order: 6500 }, money);
assert(online.tone === "ok" && /Pagado en línea/.test(online.title), "Tarjeta debe decir pagado en línea");
assert(/transferencia/.test(online.detail), "El pago en línea debe advertir que no se aceptan transferencias");

const cash = paymentVerdict({ payment_method: "cash", operational_status: "READY", total_order: 30000, total_to_pay: 33000 }, money);
assert(cash.tone === "warn" && cash.title.includes("33.000"), "Efectivo debe mostrar lo que cobra el repartidor");
assert(/repartidor/.test(cash.title) && /Nadie del local cobra/.test(cash.detail), "Efectivo lo cobra el repartidor, no el local");

const cancelledPay = paymentVerdict({ payment_method: "cc", operational_status: "CANCELLED" }, money);
assert(/comprobante/.test(cancelledPay.detail), "Un pedido cancelado invalida cualquier comprobante");
assert(paymentVerdict({ operational_status: "IN_PROGRESS" }, money).tone === "warn", "Sin forma de pago debe advertir");

// Entrega
assert(deliveryVerdict({ operational_status: "COMPLETED", delivered_at: "2026-09-11T01:50:00Z" }, time).title.includes("20:44"), "Entregado muestra la hora");
assert(deliveryVerdict({ operational_status: "NOT_ACCEPTED" }, time).tone === "bad", "Vencido es alarma");
assert(/No lo prepares/.test(deliveryVerdict({ operational_status: "NOT_ACCEPTED" }, time).detail), "Vencido dice no prepararlo");
assert(deliveryVerdict({ operational_status: "RECEIVED", acceptance_status: "FAILED", acceptance_error: "x" }, time).tone === "bad", "Aceptación fallida es alarma");
assert(/tablet/.test(deliveryVerdict({ operational_status: "RECEIVED", acceptance_status: "MANUAL" }, time).detail), "Tienda manual indica usar la tablet");
assert(/asignado/.test(deliveryVerdict({ operational_status: "COURIER_AT_STORE", courier_name: "Ana" }, time).detail), "Repartidor en local pide verificar que sea el asignado");
assert(/fraude/.test(deliveryVerdict({ operational_status: "CANCELLED", cancel_event: "canceled_by_fraud_automation" }, time).detail), "Cancelación por fraude se explica");

// Avance
assert(deliveryProgress({ operational_status: "IN_DELIVERY" }).reached === 4, "En camino es el paso 5");
assert(deliveryProgress({ operational_status: "CANCELLED", acceptance_status: "ACCEPTED" }).stopped, "Cancelado detiene el avance");

// Historial y no encontrado
assert(eventLabel({ event_type: "ENKRATO_ACCEPT", additional_information: { mode: "auto" } }).includes("automáticamente"), "Aceptación automática etiquetada");
assert(eventLabel({ event_type: "ORDER_OTHER_EVENT", rappi_status: "close_order" }) === "El cliente recibió el pedido", "close_order legible");
assert(eventLabel({ event_type: "ORDER_EVENT_CANCEL", rappi_status: "cancel_by_user" }).startsWith("Cancelado"), "Cancelación legible");
assert(cancelReason("desconocido") === "Rappi canceló el pedido.", "Cancelación desconocida tiene texto por defecto");
const missing = notFoundVerdict("999");
assert(missing.tone === "bad" && /No lo despaches/.test(missing.detail), "Pedido inexistente es alarma y dice no despacharlo");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Veredictos Rappi OK: pago, entrega, avance, historial y pedido inexistente.");

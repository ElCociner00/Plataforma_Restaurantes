import { shouldApplyOrderState } from "./state.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Rappi ignores older order events", () => {
  assert(!shouldApplyOrderState("READY", "2026-08-29T12:00:00Z", "IN_PROGRESS", "2026-08-29T11:59:59Z"), "Older event must be ignored");
});

Deno.test("Rappi does not reopen terminal orders with non-terminal events", () => {
  assert(!shouldApplyOrderState("CANCELLED", "2026-08-29T12:00:00Z", "IN_DELIVERY", "2026-08-29T12:05:00Z"), "Cancelled order must remain terminal");
  assert(!shouldApplyOrderState("COMPLETED", "2026-08-29T12:00:00Z", "READY", "2026-08-29T12:05:00Z"), "Completed order must remain terminal");
});

Deno.test("Rappi accepts forward and later terminal transitions", () => {
  assert(shouldApplyOrderState("READY", "2026-08-29T12:00:00Z", "IN_DELIVERY", "2026-08-29T12:01:00Z"), "Forward transition should pass");
  assert(shouldApplyOrderState("COMPLETED", "2026-08-29T12:00:00Z", "CANCELLED", "2026-08-29T12:05:00Z"), "Later provider cancellation should be auditable as current state");
});

Deno.test("An order never moves backwards, even with a newer timestamp", () => {
  // Un webhook atrasado que llega con hora nueva no puede devolver a
  // "en preparación" un pedido que ya va en camino.
  assert(!shouldApplyOrderState("IN_DELIVERY", "2026-08-29T12:00:00Z", "IN_PROGRESS", "2026-08-29T12:10:00Z"), "No backwards move");
  assert(!shouldApplyOrderState("IN_PROGRESS", "2026-08-29T12:00:00Z", "RECEIVED", "2026-08-29T12:10:00Z"), "A repeated NEW_ORDER cannot un-accept");
});

Deno.test("A forward move wins even when Rappi's clock is behind Enkrato's", () => {
  // Enkrato marca la toma con su hora; el ready_for_pick_up de Rappi puede
  // traer unos segundos menos y aun así debe avanzar el pedido.
  assert(shouldApplyOrderState("IN_PROGRESS", "2026-08-29T12:00:05Z", "READY", "2026-08-29T12:00:01Z"), "Forward move ignores small clock skew");
});

Deno.test("Enkrato's not-accepted inference yields to any real Rappi data", () => {
  assert(shouldApplyOrderState("NOT_ACCEPTED", "2026-08-29T12:07:00Z", "IN_PROGRESS", "2026-08-29T12:02:00Z"), "A real taken event replaces the inference");
  assert(shouldApplyOrderState("NOT_ACCEPTED", "2026-08-29T12:07:00Z", "CANCELLED", "2026-08-29T12:08:00Z"), "A real cancellation replaces the inference");
  assert(!shouldApplyOrderState("COMPLETED", "2026-08-29T12:00:00Z", "NOT_ACCEPTED", "2026-08-29T12:30:00Z"), "A delivered order is never marked not accepted");
});

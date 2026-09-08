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

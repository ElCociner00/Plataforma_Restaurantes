import { ACCEPT_WINDOW_MS, acceptanceWindowOpen, classifyTakeStatus } from "./orders.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Take responses separate success, business refusal and transient failure", () => {
  assert(classifyTakeStatus(200) === "ACCEPTED", "200 is accepted");
  assert(classifyTakeStatus(400) === "NOT_WAITING", "400 means the order is no longer waiting");
  assert(classifyTakeStatus(429) === "RETRY", "Rate limit must be retried");
  assert(classifyTakeStatus(503) === "RETRY", "Server errors must be retried");
  assert(classifyTakeStatus(404) === "FAILED", "Unknown order is not retried");
  assert(classifyTakeStatus(401) === "FAILED", "Auth failure after token renewal is not retried");
});

Deno.test("Acceptance window follows Rappi's 6 minutes", () => {
  const created = "2026-09-10T19:51:32-05:00";
  const createdMs = Date.parse(created);
  assert(acceptanceWindowOpen(created, createdMs + 60_000), "One minute in is still open");
  assert(!acceptanceWindowOpen(created, createdMs + ACCEPT_WINDOW_MS), "At six minutes it is closed");
  assert(acceptanceWindowOpen(null, createdMs), "Without a creation time, try anyway");
});

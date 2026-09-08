import { remoteWebhookConfigured, remoteWebhookMatches, remoteWebhookStoreIds } from "./webhooks.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`);
}

const response = [{
  event: "NEW_ORDER",
  stores: [
    { store_id: "1000", url: "https://example.supabase.co/functions/v1/rappi-webhook/key/NEW_ORDER", state: "ENABLE" },
    { store_id: "1001", url: "https://example.supabase.co/functions/v1/rappi-webhook/key/NEW_ORDER", state: "ENABLE" },
  ],
}];
const url = "https://example.supabase.co/functions/v1/rappi-webhook/key/NEW_ORDER";

Deno.test("Rappi webhook response discovers configured stores", () => {
  assert(remoteWebhookConfigured(response, "NEW_ORDER"));
  assertEquals([...remoteWebhookStoreIds(response, "NEW_ORDER")].sort(), ["1000", "1001"]);
});

Deno.test("Rappi webhook verification requires the exact URL and every expected store", () => {
  assert(remoteWebhookMatches(response, "NEW_ORDER", url, ["1000", "1001"]));
  assert(!remoteWebhookMatches(response, "NEW_ORDER", `${url}-wrong`, ["1000", "1001"]));
  assert(!remoteWebhookMatches(response, "NEW_ORDER", url, ["1000", "1001", "1002"]));
  assert(!remoteWebhookMatches(response, "ORDER_EVENT_CANCEL", url, ["1000"]));
});

Deno.test("Rappi webhook verification rejects disabled configurations", () => {
  const disabled = [{ event: "NEW_ORDER", stores: [{ store_id: "1000", url, state: "DISABLE" }] }];
  assert(!remoteWebhookMatches(disabled, "NEW_ORDER", url, ["1000"]));
});

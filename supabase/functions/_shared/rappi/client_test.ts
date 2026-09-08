import { normalizeBaseUrl } from "./client.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Rappi base URL only accepts official HTTPS hosts", () => {
  assert(normalizeBaseUrl("https://api.dev.rappi.com/") === "https://api.dev.rappi.com", "Official DEV host should pass");
  assert(normalizeBaseUrl("https://microservices.dev.rappi.com") === "https://microservices.dev.rappi.com", "Official orders host should pass");
  assert(
    normalizeBaseUrl("https://api.dev.rappi.com/path?page=1") === "https://api.dev.rappi.com/path?page=1",
    "Official absolute pagination URLs should pass",
  );
  for (const invalid of [
    "http://api.dev.rappi.com",
    "https://example.com",
    "https://evilrappi.com",
    "https://user:pass@api.dev.rappi.com",
    "https://api.dev.rappi.com:8443",
  ]) {
    let rejected = false;
    try { normalizeBaseUrl(invalid); } catch { rejected = true; }
    assert(rejected, `Unsafe URL must be rejected: ${invalid}`);
  }
});

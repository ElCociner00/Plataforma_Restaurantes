import {
  constantTimeEqualHex,
  hmacSha256Hex,
  parseRappiSignature,
  validateRappiSignature,
} from "./crypto.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Rappi HMAC validates the exact timestamp.raw-body contract", async () => {
  const timestamp = "1787961600";
  const payload = '{"event":"NEW_ORDER","order_id":"123"}';
  const signature = await hmacSha256Hex("test-secret", `${timestamp}.${payload}`);
  const result = await validateRappiSignature(`t=${timestamp},sign=${signature}`, payload, "test-secret", {
    nowMs: Number(timestamp) * 1000,
  });
  assert(result.ok, `Expected valid signature, got ${result.reason}`);
});

Deno.test("Rappi HMAC rejects altered payload, stale timestamp and malformed header", async () => {
  const timestamp = "1787961600";
  const payload = '{"event":"PING"}';
  const signature = await hmacSha256Hex("test-secret", `${timestamp}.${payload}`);
  const altered = await validateRappiSignature(`t=${timestamp},sign=${signature}`, `${payload} `, "test-secret", {
    nowMs: Number(timestamp) * 1000,
  });
  assert(!altered.ok && altered.reason === "SIGNATURE_MISMATCH", "Altered raw body must fail");

  const stale = await validateRappiSignature(`t=${timestamp},sign=${signature}`, payload, "test-secret", {
    nowMs: Number(timestamp) * 1000 + 600_001,
    toleranceMs: 600_000,
  });
  assert(!stale.ok && stale.reason === "TIMESTAMP_OUTSIDE_WINDOW", "Stale timestamp must fail");
  assert(parseRappiSignature("t=bad,sign=123") === null, "Malformed header must fail parsing");
});

Deno.test("Rappi signature parser accepts seconds, milliseconds and rotated signatures", () => {
  const hexA = "a".repeat(64);
  const hexB = "b".repeat(64);
  const seconds = parseRappiSignature(`t=1787961600,sign=${hexA},sign=${hexB}`);
  const milliseconds = parseRappiSignature(`t=1787961600000,sign=${hexA}`);
  assert(seconds?.timestampMs === 1787961600000, "Seconds should be converted to milliseconds");
  assert(seconds?.signatures.length === 2, "Rotated signatures should be preserved");
  assert(milliseconds?.timestampMs === 1787961600000, "Milliseconds should be preserved");
  assert(constantTimeEqualHex(hexA.toUpperCase(), hexA), "Hex comparison should be case-insensitive");
  assert(!constantTimeEqualHex(hexA, `${hexA}0`), "Different lengths must fail");
});

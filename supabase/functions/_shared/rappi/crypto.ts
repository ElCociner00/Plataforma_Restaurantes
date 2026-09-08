export type ParsedRappiSignature = {
  timestampRaw: string;
  timestampMs: number;
  signatures: string[];
};

const encoder = new TextEncoder();

export function parseRappiSignature(header: string): ParsedRappiSignature | null {
  const values = new Map<string, string[]>();
  for (const piece of String(header || "").split(",")) {
    const separator = piece.indexOf("=");
    if (separator <= 0) continue;
    const key = piece.slice(0, separator).trim().toLowerCase();
    const value = piece.slice(separator + 1).trim();
    if (!value) continue;
    values.set(key, [...(values.get(key) ?? []), value]);
  }

  const timestampRaw = values.get("t")?.[0] ?? "";
  const signatures = (values.get("sign") ?? [])
    .map((value) => value.toLowerCase())
    .filter((value) => /^[a-f0-9]{64}$/.test(value));
  const numeric = Number(timestampRaw);
  if (!timestampRaw || !Number.isFinite(numeric) || numeric <= 0 || signatures.length === 0) return null;

  return {
    timestampRaw,
    timestampMs: numeric < 10_000_000_000 ? numeric * 1000 : numeric,
    signatures,
  };
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return bytesToHex(new Uint8Array(signature));
}

export async function sha256Hex(message: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return bytesToHex(new Uint8Array(digest));
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  const left = String(a || "").toLowerCase();
  const right = String(b || "").toLowerCase();
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return difference === 0;
}

export async function validateRappiSignature(
  header: string,
  rawPayload: string,
  secret: string,
  options: { nowMs?: number; toleranceMs?: number } = {},
): Promise<{ ok: boolean; reason?: string; parsed?: ParsedRappiSignature }> {
  const parsed = parseRappiSignature(header);
  if (!parsed) return { ok: false, reason: "MALFORMED_SIGNATURE" };

  const toleranceMs = options.toleranceMs ?? 5 * 60_000;
  const nowMs = options.nowMs ?? Date.now();
  if (toleranceMs > 0 && Math.abs(nowMs - parsed.timestampMs) > toleranceMs) {
    return { ok: false, reason: "TIMESTAMP_OUTSIDE_WINDOW", parsed };
  }

  const expected = await hmacSha256Hex(secret, `${parsed.timestampRaw}.${rawPayload}`);
  const ok = parsed.signatures.some((signature) => constantTimeEqualHex(signature, expected));
  return { ok, reason: ok ? undefined : "SIGNATURE_MISMATCH", parsed };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

import { clienteServicio } from "../_shared/tenant.ts";
import { decryptText } from "../_shared/crypto.ts";
import { buildIdempotencyKey, record } from "../_shared/rappi/payload.ts";
import { sha256Hex, validateRappiSignature } from "../_shared/rappi/crypto.ts";
import { isRappiEventV1 } from "../_shared/rappi/types.ts";

const LABEL = "rappi-webhook";
const MAX_PAYLOAD_BYTES = 2_000_000;

type WebhookConfig = {
  id: string;
  connection_id: string;
  empresa_id: string;
  event_type: string;
  state: string;
};

const responseJson = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const successResponse = (
  eventType: string,
  extra: Record<string, unknown> = {},
) =>
  responseJson(
    eventType === "PING" ? { status: "OK", ...extra } : { ok: true, ...extra },
  );

function masterKey(): string {
  const key = Deno.env.get("MASTER_ENCRYPTION_KEY") ??
    Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 16) {
    throw new Error("MASTER_ENCRYPTION_KEY no configurada");
  }
  return key;
}

function routeParts(
  req: Request,
): { endpointKey: string; eventType: string } | null {
  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const functionIndex = parts.lastIndexOf("rappi-webhook");
  if (functionIndex < 0) return null;
  const endpointKey = parts[functionIndex + 1] ?? "";
  const eventType = (parts[functionIndex + 2] ?? "").toUpperCase();
  if (
    !/^[0-9a-f-]{36}$/i.test(endpointKey) ||
    !/^[A-Z0-9_]{1,64}$/.test(eventType)
  ) return null;
  return { endpointKey, eventType };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") {
    return responseJson({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405);
  }

  const route = routeParts(req);
  if (!route) {
    return responseJson({ ok: false, code: "WEBHOOK_NOT_FOUND" }, 404);
  }

  const admin = clienteServicio();
  const { data: config, error: configError } = await admin
    .from("rappi_webhook_configs")
    .select("id, connection_id, empresa_id, event_type, state")
    .eq("endpoint_key", route.endpointKey)
    .maybeSingle<WebhookConfig>();
  if (configError || !config || config.state !== "ENABLE") {
    return responseJson({ ok: false, code: "WEBHOOK_NOT_ACTIVE" }, 404);
  }

  const rawPayload = await readRawBodyLimited(req, MAX_PAYLOAD_BYTES);
  if (!rawPayload) {
    return responseJson({ ok: false, code: "INVALID_PAYLOAD_SIZE" }, 413);
  }
  const payloadHash = await sha256Hex(rawPayload);

  const { data: secretRow } = await admin
    .from("rappi_webhook_secrets")
    .select("secret_ciphertext")
    .eq("webhook_config_id", config.id)
    .maybeSingle<{ secret_ciphertext: string }>();
  if (!secretRow?.secret_ciphertext) {
    await auditFailure(admin, config, "WEBHOOK_SECRET_MISSING", payloadHash);
    return responseJson({ ok: false, code: "WEBHOOK_NOT_CONFIGURED" }, 503);
  }

  const signatureHeader = req.headers.get("Rappi-Signature") ?? "";
  const toleranceSeconds = Math.max(
    60,
    Number(Deno.env.get("RAPPI_WEBHOOK_TOLERANCE_SECONDS") ?? "600"),
  );
  const validation = await validateRappiSignature(
    signatureHeader,
    rawPayload,
    await decryptText(secretRow.secret_ciphertext, masterKey()),
    { toleranceMs: toleranceSeconds * 1000 },
  );
  if (!validation.ok || !validation.parsed) {
    await auditFailure(
      admin,
      config,
      validation.reason ?? "INVALID_SIGNATURE",
      payloadHash,
    );
    return responseJson({ ok: false, code: "INVALID_SIGNATURE" }, 401);
  }

  if (
    !isRappiEventV1(route.eventType) || route.eventType !== config.event_type
  ) {
    await auditFailure(admin, config, "UNSUPPORTED_EVENT", payloadHash);
    return successResponse(route.eventType, {
      ignored: true,
      reason: "UNSUPPORTED_EVENT",
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawPayload);
  } catch {
    await auditFailure(admin, config, "INVALID_JSON", payloadHash);
    return responseJson({ ok: false, code: "INVALID_JSON" }, 400);
  }
  const identityPayload = Array.isArray(parsed)
    ? record(parsed[0])
    : record(parsed);
  const idempotencyKey = await buildIdempotencyKey(
    config.event_type,
    identityPayload,
    validation.parsed.timestampRaw,
    payloadHash,
  );

  const eventRow = {
    webhook_config_id: config.id,
    connection_id: config.connection_id,
    empresa_id: config.empresa_id,
    event_type: config.event_type,
    idempotency_key: idempotencyKey,
    payload_hash: payloadHash,
    signature_timestamp: Math.trunc(validation.parsed.timestampMs),
    signature_valid: true,
    selected_headers: {
      content_type: req.headers.get("content-type"),
      user_agent: req.headers.get("user-agent"),
      request_id: req.headers.get("x-request-id") ?? req.headers.get("cf-ray"),
    },
    raw_payload: parsed,
  };
  const { data: inserted, error: insertError } = await admin
    .from("rappi_webhook_events")
    .insert(eventRow)
    .select("id")
    .single<{ id: string }>();

  if (insertError?.code === "23505") {
    const { data: existing } = await admin
      .from("rappi_webhook_events")
      .select("id, duplicate_count")
      .eq("webhook_config_id", config.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle<{ id: string; duplicate_count: number }>();
    if (existing) {
      await admin.from("rappi_webhook_events")
        .update({ duplicate_count: (existing.duplicate_count ?? 0) + 1 })
        .eq("id", existing.id);
    }
    await touchConfig(admin, config, true);
    return successResponse(config.event_type, { duplicate: true });
  }
  if (insertError || !inserted) {
    console.error(`[${LABEL}] insert failed:`, insertError?.message);
    return responseJson({ ok: false, code: "PERSISTENCE_ERROR" }, 500);
  }

  const { error: jobError } = await admin.from("rappi_webhook_jobs").insert({
    raw_event_id: inserted.id,
    empresa_id: config.empresa_id,
  });
  if (jobError) {
    await admin.from("rappi_webhook_events")
      .update({
        processing_status: "FAILED",
        error_code: "QUEUE_ERROR",
        error_message: "No se pudo encolar.",
      })
      .eq("id", inserted.id);
    console.error(`[${LABEL}] queue failed:`, jobError.message);
    return responseJson({ ok: false, code: "QUEUE_ERROR" }, 500);
  }

  await touchConfig(admin, config, true);
  if (ORDER_EVENTS.has(config.event_type)) kickWorker();
  return successResponse(config.event_type, { accepted: true });
});

const ORDER_EVENTS = new Set(["NEW_ORDER", "ORDER_EVENT_CANCEL", "ORDER_OTHER_EVENT"]);

/**
 * Despierta al worker en segundo plano en vez de esperar al cron. Rappi da
 * 6 minutos para aceptar una orden; con el cron por minuto la aceptación
 * podía tardar hasta un minuto de más. La respuesta a Rappi no espera esto,
 * y si la llamada falla el cron procesa el evento igual.
 */
function kickWorker() {
  const secret = Deno.env.get("RAPPI_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (!secret || !base) return;
  const task = fetch(`${base}/functions/v1/rappi-worker`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-cron-secret": secret },
    body: JSON.stringify({ kick: true, limit: 10 }),
  }).then((response) => response.body?.cancel())
    .catch((error) => console.warn(`[${LABEL}] no se pudo despertar al worker:`, error?.message ?? error));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
}

async function touchConfig(
  admin: ReturnType<typeof clienteServicio>,
  config: WebhookConfig,
  valid: boolean,
) {
  const now = new Date().toISOString();
  await admin.from("rappi_webhook_configs").update({
    last_received_at: now,
    ...(valid
      ? {
        last_valid_signature_at: now,
        last_error_at: null,
        last_error_code: null,
      }
      : {}),
  }).eq("id", config.id);
  if (valid) {
    await admin.from("rappi_integration_errors").update({
      status: "RESOLVED",
      resolved_at: now,
    })
      .eq("connection_id", config.connection_id)
      .eq("source", "WEBHOOK")
      .in("status", ["OPEN", "RETRYING"])
      .in("error_code", [
        "MALFORMED_SIGNATURE",
        "TIMESTAMP_OUTSIDE_WINDOW",
        "SIGNATURE_MISMATCH",
      ])
      .contains("metadata", { webhook_config_id: config.id });
  }
}

async function auditFailure(
  admin: ReturnType<typeof clienteServicio>,
  config: WebhookConfig,
  code: string,
  payloadHash: string,
) {
  const now = new Date().toISOString();
  await admin.from("rappi_webhook_configs").update({
    last_received_at: now,
    last_error_at: now,
    last_error_code: code,
  }).eq("id", config.id);
  await admin.from("rappi_integration_errors").insert({
    connection_id: config.connection_id,
    empresa_id: config.empresa_id,
    source: "WEBHOOK",
    error_class: "SECURITY",
    error_code: code,
    public_message: "Rappi envió un webhook que no superó la validación.",
    technical_detail: null,
    retryable: false,
    metadata: { webhook_config_id: config.id, payload_hash: payloadHash },
  });
}

async function readRawBodyLimited(
  req: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!req.body) return "";

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("payload too large");
      return null;
    }
    result += decoder.decode(value, { stream: true });
  }
  result += decoder.decode();
  return result;
}

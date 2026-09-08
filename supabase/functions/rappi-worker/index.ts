import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, clienteServicio } from "../_shared/tenant.ts";
import {
  extractOrderId,
  extractProviderTime,
  extractStoreId,
  isRappiTesterSample,
  normalizeOperationalStatus,
  parseConnectivity,
  parseTracking,
  record,
  sanitizeOrder,
  text,
} from "../_shared/rappi/payload.ts";
import { shouldApplyOrderState } from "../_shared/rappi/state.ts";

type Job = { id: string; raw_event_id: string; empresa_id: string; attempts: number };
type RawEvent = {
  id: string;
  connection_id: string;
  empresa_id: string;
  event_type: string;
  raw_payload: unknown;
};
type StoreRow = { id: string; rappi_store_id: string; enkrato_empresa_id: string | null };
type OrderState = { id: string; operational_status: string; last_event_at: string | null };

const LABEL = "rappi-worker";

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const cronSecret = Deno.env.get("RAPPI_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
    const isCron = Boolean(cronSecret && req.headers.get("x-cron-secret") === cronSecret);
    let empresaId: string | null = null;
    if (!isCron) {
      const ctx = await resolverContexto(req);
      exigirAdmin(ctx, "procesar la cola de Rappi");
      empresaId = ctx.empresaId;
    }
    const body = await leerCuerpo(req);
    const limit = Math.min(100, Math.max(1, Number(body.limit ?? 20)));
    const admin = clienteServicio();
    const { data: jobs, error } = await admin.rpc("rappi_claim_webhook_jobs", {
      p_limit: limit,
      p_worker: `edge-${crypto.randomUUID().slice(0, 8)}`,
      p_empresa_id: empresaId,
    });
    if (error) throw new ErrorFuncion("QUEUE_CLAIM", "No se pudo tomar la cola de Rappi.", 500, error.message);

    const summary = { claimed: 0, processed: 0, retried: 0, dead: 0 };
    for (const job of (jobs ?? []) as Job[]) {
      summary.claimed += 1;
      try {
        await processJob(admin, job);
        summary.processed += 1;
      } catch (error) {
        const dead = job.attempts >= 5;
        if (dead) summary.dead += 1;
        else summary.retried += 1;
        await failJob(admin, job, error, dead);
      }
    }
    return json({ ok: true, ...summary }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

async function processJob(admin: SupabaseClient, job: Job): Promise<void> {
  const { data: raw, error } = await admin.from("rappi_webhook_events")
    .select("id, connection_id, empresa_id, event_type, raw_payload")
    .eq("id", job.raw_event_id)
    .single<RawEvent>();
  if (error || !raw) throw new Error(`Evento ${job.raw_event_id} no encontrado`);
  await admin.from("rappi_webhook_events").update({ processing_status: "PROCESSING" }).eq("id", raw.id);

  const payload = Array.isArray(raw.raw_payload) ? record(raw.raw_payload[0]) : record(raw.raw_payload);
  const store = await ensureStore(admin, raw, payload);
  const testerSample = isRappiTesterSample(payload);
  if (!testerSample && ["NEW_ORDER", "ORDER_EVENT_CANCEL", "ORDER_OTHER_EVENT", "ORDER_RT_TRACKING"].includes(raw.event_type)) {
    if (!store?.enkrato_empresa_id) throw new Error("STORE_NOT_MAPPED: mapea la tienda antes de procesar órdenes.");
  }
  const targetRaw = store?.enkrato_empresa_id
    ? { ...raw, empresa_id: store.enkrato_empresa_id }
    : raw;

  // Las muestras oficiales SAMPLE-* prueban el endpoint y la firma, pero no
  // deben crear pedidos ni cambiar el estado del menú real de la tienda.
  if (!testerSample) {
    switch (raw.event_type) {
      case "NEW_ORDER":
        await processNewOrder(admin, targetRaw, payload, store?.id ?? null);
        break;
      case "ORDER_EVENT_CANCEL":
      case "ORDER_OTHER_EVENT":
        await processOrderEvent(admin, targetRaw, payload, store?.id ?? null);
        break;
      case "ORDER_RT_TRACKING":
        await processTracking(admin, targetRaw, payload, store?.id ?? null);
        break;
      case "PING":
      case "STORE_CONNECTIVITY":
        await processConnectivity(admin, targetRaw, payload, store);
        break;
      case "MENU_APPROVED":
      case "MENU_REJECTED":
        await processMenuStatus(admin, targetRaw, store);
        break;
      default:
        throw new Error(`Evento no soportado: ${raw.event_type}`);
    }
  }

  const now = new Date().toISOString();
  await admin.from("rappi_webhook_events").update({
    processing_status: "PROCESSED", processed_at: now, error_code: null, error_message: null,
  }).eq("id", raw.id);
  await admin.from("rappi_webhook_jobs").update({
    status: "DONE", finished_at: now, last_error: null,
  }).eq("id", job.id);
  await admin.from("rappi_connections").update({ last_success_at: now, status: "CONNECTED" }).eq("id", raw.connection_id);
}

async function ensureStore(admin: SupabaseClient, raw: RawEvent, payload: Record<string, unknown>) {
  const storeId = extractStoreId(payload);
  if (!storeId) return null;
  const storeInfo = record(payload.store);
  const { data: existing } = await admin.from("rappi_stores").select("id, rappi_store_id, enkrato_empresa_id")
    .eq("connection_id", raw.connection_id).eq("rappi_store_id", storeId).maybeSingle();
  if (existing) {
    await admin.from("rappi_stores").update({
      integration_store_id: text(storeInfo.external_id ?? storeInfo.integrationId) || storeId,
      ...(text(storeInfo.name) ? { store_name: text(storeInfo.name) } : {}),
      active: true,
    }).eq("id", existing.id);
    return existing as StoreRow;
  }
  const { data, error } = await admin.from("rappi_stores").insert({
    connection_id: raw.connection_id,
    empresa_id: raw.empresa_id,
    enkrato_empresa_id: null,
    rappi_store_id: storeId,
    integration_store_id: text(storeInfo.external_id ?? storeInfo.integrationId) || storeId,
    store_name: text(storeInfo.name) || null,
    active: true,
  }).select("id, rappi_store_id, enkrato_empresa_id").single();
  if (error) throw error;
  return data as StoreRow;
}

async function ensureOrder(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  storeId: string | null,
) {
  const rappiOrderId = extractOrderId(payload);
  if (!rappiOrderId) throw new Error(`${raw.event_type} sin order_id`);
  const { data: existing, error: selectError } = await admin.from("rappi_orders")
    .select("id, operational_status, last_event_at")
    .eq("connection_id", raw.connection_id)
    .eq("rappi_order_id", rappiOrderId)
    .maybeSingle<OrderState>();
  if (selectError) throw selectError;
  if (existing) return existing;

  const nextStatus = normalizeOperationalStatus(raw.event_type, payload.status ?? payload.event);
  const nextAt = extractProviderTime(payload) ?? new Date().toISOString();
  const { data, error } = await admin.from("rappi_orders").insert({
    connection_id: raw.connection_id,
    empresa_id: raw.empresa_id,
    store_id: storeId,
    rappi_order_id: rappiOrderId,
    rappi_status: text(payload.status ?? payload.event) || raw.event_type,
    operational_status: nextStatus,
    last_event_at: nextAt,
  }).select("id, operational_status, last_event_at").single<OrderState>();
  if (error) throw error;
  return data;
}

async function processNewOrder(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  storeId: string | null,
) {
  const order = sanitizeOrder(payload);
  if (!order.rappi_order_id) throw new Error("NEW_ORDER sin order_id");
  const { rappi_store_id: _externalStoreId, ...orderColumns } = order;
  const { data: existing, error: selectError } = await admin.from("rappi_orders")
    .select("id, operational_status, last_event_at")
    .eq("connection_id", raw.connection_id)
    .eq("rappi_order_id", order.rappi_order_id)
    .maybeSingle<OrderState>();
  if (selectError) throw selectError;

  let orderId: string;
  let applied = true;
  if (existing) {
    applied = shouldApplyOrderState(
      existing.operational_status,
      existing.last_event_at,
      String(order.operational_status ?? "RECEIVED"),
      String(order.last_event_at ?? ""),
    );
    orderId = existing.id;
    if (applied) {
      const { error } = await admin.from("rappi_orders").update({
        ...orderColumns,
        empresa_id: raw.empresa_id,
        store_id: storeId,
      }).eq("id", existing.id);
      if (error) throw error;
    }
  } else {
    const { data, error } = await admin.from("rappi_orders").insert({
      ...orderColumns,
      connection_id: raw.connection_id,
      empresa_id: raw.empresa_id,
      store_id: storeId,
    }).select("id").single<{ id: string }>();
    if (error || !data) throw error ?? new Error("No se pudo persistir la orden");
    orderId = data.id;
  }
  await insertOrderEvent(admin, raw, orderId, payload, "RECEIVED", { applied_to_current_state: applied });
}

async function processOrderEvent(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  storeId: string | null,
) {
  const order = await ensureOrder(admin, raw, payload, storeId);
  const normalized = normalizeOperationalStatus(raw.event_type, payload.status ?? payload.event);
  const nextAt = extractProviderTime(payload) ?? new Date().toISOString();
  const applied = shouldApplyOrderState(order.operational_status, order.last_event_at, normalized, nextAt);
  if (applied) {
    await admin.from("rappi_orders").update({
      operational_status: normalized,
      rappi_status: text(payload.status ?? payload.event) || raw.event_type,
      last_event_at: nextAt,
      ...(normalized === "CANCELLED" ? { reconciliation_status: "PENDING" } : {}),
    }).eq("id", order.id);
  }
  await insertOrderEvent(admin, raw, order.id, payload, normalized, { applied_to_current_state: applied });
}

async function insertOrderEvent(
  admin: SupabaseClient,
  raw: RawEvent,
  orderId: string,
  payload: Record<string, unknown>,
  normalizedStatus: string,
  processingInformation: Record<string, unknown> = {},
) {
  const { error } = await admin.from("rappi_order_events").insert({
    order_id: orderId,
    empresa_id: raw.empresa_id,
    raw_event_id: raw.id,
    event_type: raw.event_type,
    rappi_status: text(payload.status ?? payload.event) || null,
    normalized_status: normalizedStatus,
    provider_event_at: extractProviderTime(payload),
    additional_information: { ...record(payload.additional_information), ...processingInformation },
  });
  if (error && error.code !== "23505") throw error;
}

async function processTracking(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  storeId: string | null,
) {
  const order = await ensureOrder(admin, raw, payload, storeId);
  const tracking = parseTracking(payload);
  const { error } = await admin.from("rappi_order_tracking").insert({
    order_id: order.id,
    empresa_id: raw.empresa_id,
    raw_event_id: raw.id,
    tracking_status: tracking.tracking_status,
    courier_id: tracking.courier_id,
    latitude: tracking.latitude,
    longitude: tracking.longitude,
    eta: tracking.eta,
    eta_type: tracking.eta_type,
    tracked_at: tracking.tracked_at,
  });
  if (error && error.code !== "23505") throw error;
  const nextStatus = normalizeOperationalStatus(raw.event_type, tracking.tracking_status);
  if (shouldApplyOrderState(order.operational_status, order.last_event_at, nextStatus, String(tracking.tracked_at ?? ""))) {
    await admin.from("rappi_orders").update({
      operational_status: nextStatus,
      last_event_at: tracking.tracked_at,
    }).eq("id", order.id);
  }
}

async function processConnectivity(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  store: StoreRow | null,
) {
  const connectivity = parseConnectivity(payload, raw.event_type);
  let stores = store ? [store] : [];
  if (!stores.length && raw.event_type === "PING") {
    const { data } = await admin.from("rappi_stores").select("id, rappi_store_id, enkrato_empresa_id")
      .eq("connection_id", raw.connection_id).eq("active", true);
    stores = (data ?? []) as typeof stores;
  }
  for (const target of stores) {
    await admin.from("rappi_stores").update({
      connectivity_status: connectivity.normalized_status,
      last_connectivity_at: connectivity.occurred_at,
      ...(raw.event_type === "PING" ? {
        last_ping_at: connectivity.occurred_at,
        last_ping_ok: connectivity.is_online !== false,
      } : {}),
    }).eq("id", target.id);
    const { error } = await admin.from("rappi_store_connectivity_events").insert({
      store_id: target.id,
      empresa_id: target.enkrato_empresa_id ?? raw.empresa_id,
      raw_event_id: stores.length === 1 ? raw.id : null,
      provider_status: connectivity.provider_status,
      normalized_status: connectivity.normalized_status,
      is_online: connectivity.is_online,
      occurred_at: connectivity.occurred_at,
      details: { event_type: raw.event_type },
    });
    if (error && error.code !== "23505") throw error;
  }
}

async function processMenuStatus(
  admin: SupabaseClient,
  raw: RawEvent,
  store: { id: string } | null,
) {
  if (!store) throw new Error(`${raw.event_type} sin store_id`);
  await admin.from("rappi_stores").update({
    menu_approval_status: raw.event_type === "MENU_APPROVED" ? "APPROVED" : "REJECTED",
    menu_updated_at: new Date().toISOString(),
  }).eq("id", store.id);
}

async function failJob(admin: SupabaseClient, job: Job, error: unknown, dead: boolean) {
  const message = error instanceof Error ? error.message.slice(0, 500) : "Error desconocido";
  const retryMinutes = Math.min(60, 2 ** Math.max(0, job.attempts));
  await admin.from("rappi_webhook_jobs").update({
    status: dead ? "DEAD" : "RETRY",
    available_at: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
    finished_at: dead ? new Date().toISOString() : null,
    last_error: message,
  }).eq("id", job.id);
  await admin.from("rappi_webhook_events").update({
    processing_status: "FAILED", error_code: dead ? "PROCESSING_DEAD" : "PROCESSING_RETRY", error_message: message,
  }).eq("id", job.raw_event_id);
  await admin.from("rappi_integration_errors").insert({
    empresa_id: job.empresa_id,
    source: "WEBHOOK_WORKER",
    error_class: dead ? "DATA" : "TRANSIENT",
    error_code: dead ? "PROCESSING_DEAD" : "PROCESSING_RETRY",
    public_message: dead ? "Un evento Rappi requiere revisión manual." : "Un evento Rappi se reintentará automáticamente.",
    technical_detail: message,
    retryable: !dead,
    metadata: { raw_event_id: job.raw_event_id, attempts: job.attempts },
  });
}

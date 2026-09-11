import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, clienteServicio } from "../_shared/tenant.ts";
import {
  extractOrderId,
  extractProviderTime,
  extractStoreId,
  isInformationalOrderEvent,
  isRappiTesterSample,
  normalizeOperationalStatus,
  parseConnectivity,
  parseTracking,
  record,
  sanitizeEventInformation,
  sanitizeOrder,
  text,
} from "../_shared/rappi/payload.ts";
import { shouldApplyOrderState, TERMINAL_ORDER_STATUSES } from "../_shared/rappi/state.ts";
import {
  acceptanceWindowOpen,
  acceptOrder,
  type AcceptableOrder,
  fetchOrderEvents,
  fetchSentOrders,
  NOT_ACCEPTED_AFTER_MS,
} from "../_shared/rappi/orders.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";

type Job = { id: string; raw_event_id: string; empresa_id: string; attempts: number };
type RawEvent = {
  id: string | null;
  connection_id: string;
  empresa_id: string;
  event_type: string;
  raw_payload: unknown;
};
type StoreRow = { id: string; rappi_store_id: string; enkrato_empresa_id: string | null; auto_accept: boolean };
type OrderState = AcceptableOrder & {
  acceptance_status: string;
  store_id: string | null;
  connection_id: string;
  delivered_at: string | null;
  cancelled_at: string | null;
};

const LABEL = "rappi-worker";
const CONNECTION_COLUMNS =
  "id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled";
const ORDER_STATE_COLUMNS =
  "id, connection_id, empresa_id, store_id, rappi_order_id, operational_status, last_event_at, provider_created_at, first_received_at, delivery_summary, acceptance_status, acceptance_attempts, delivered_at, cancelled_at";
const STORE_COLUMNS = "id, rappi_store_id, enkrato_empresa_id, auto_accept";
/** Cada cuánto se consulta en Rappi una orden activa sin novedades. */
const PROVIDER_CHECK_EVERY_MS = 2 * 60_000;
/** Órdenes más viejas que esto ya no se siguen consultando. */
const PROVIDER_CHECK_HORIZON_MS = 12 * 3_600_000;

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
    const connections = new ConnectionCache(admin);
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
        await processJob(admin, connections, job);
        summary.processed += 1;
      } catch (error) {
        const dead = job.attempts >= 5;
        if (dead) summary.dead += 1;
        else summary.retried += 1;
        await failJob(admin, job, error, dead);
      }
    }

    // El barrido va por cron (cada minuto). Cuando el webhook despierta al
    // worker solo interesa procesar la orden que acaba de llegar.
    const sweep = isCron && body.kick !== true ? await sweepOrders(admin, connections) : null;
    return json({ ok: true, ...summary, sweep }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

class ConnectionCache {
  private cache = new Map<string, RappiConnection | null>();
  constructor(private admin: SupabaseClient) {}
  async get(id: string): Promise<RappiConnection | null> {
    if (!this.cache.has(id)) {
      const { data } = await this.admin.from("rappi_connections").select(CONNECTION_COLUMNS)
        .eq("id", id).maybeSingle<RappiConnection>();
      this.cache.set(id, data ?? null);
    }
    return this.cache.get(id) ?? null;
  }
}

async function processJob(admin: SupabaseClient, connections: ConnectionCache, job: Job): Promise<void> {
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
      case "NEW_ORDER": {
        const order = await processNewOrder(admin, targetRaw, payload, store);
        // Se marca procesado antes de aceptar: la aceptación tiene su propio
        // reintento en el barrido y no debe duplicar la orden si falla.
        await markProcessed(admin, raw, job);
        if (order.acceptance_status === "PENDING") {
          const connection = await connections.get(raw.connection_id);
          if (connection) await acceptOrder(admin, connection, order, { mode: "auto" });
        }
        return;
      }
      case "ORDER_EVENT_CANCEL":
      case "ORDER_OTHER_EVENT": {
        const order = await ensureOrder(admin, targetRaw, payload, store?.id ?? null);
        await applyOrderEvent(admin, targetRaw, order, {
          name: text(payload.event ?? payload.status) || raw.event_type,
          at: extractProviderTime(payload),
          info: payload.additional_information,
        });
        break;
      }
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
  await markProcessed(admin, raw, job);
}

async function markProcessed(admin: SupabaseClient, raw: RawEvent, job: Job) {
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
  const { data: existing } = await admin.from("rappi_stores").select(STORE_COLUMNS)
    .eq("connection_id", raw.connection_id).eq("rappi_store_id", storeId).maybeSingle<StoreRow>();
  if (existing) {
    await admin.from("rappi_stores").update({
      integration_store_id: text(storeInfo.external_id ?? storeInfo.integrationId) || storeId,
      ...(text(storeInfo.name) ? { store_name: text(storeInfo.name) } : {}),
      active: true,
    }).eq("id", existing.id);
    return existing;
  }
  const { data, error } = await admin.from("rappi_stores").insert({
    connection_id: raw.connection_id,
    empresa_id: raw.empresa_id,
    enkrato_empresa_id: null,
    rappi_store_id: storeId,
    integration_store_id: text(storeInfo.external_id ?? storeInfo.integrationId) || storeId,
    store_name: text(storeInfo.name) || null,
    active: true,
  }).select(STORE_COLUMNS).single<StoreRow>();
  if (error) throw error;
  return data;
}

async function ensureOrder(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  storeId: string | null,
): Promise<OrderState> {
  const rappiOrderId = extractOrderId(payload);
  if (!rappiOrderId) throw new Error(`${raw.event_type} sin order_id`);
  const { data: existing, error: selectError } = await admin.from("rappi_orders")
    .select(ORDER_STATE_COLUMNS)
    .eq("connection_id", raw.connection_id)
    .eq("rappi_order_id", rappiOrderId)
    .maybeSingle<OrderState>();
  if (selectError) throw selectError;
  if (existing) return existing;

  // Llegó un evento antes que su NEW_ORDER: se crea el esqueleto con el
  // estado mínimo y el NEW_ORDER completará el detalle cuando llegue.
  const { data, error } = await admin.from("rappi_orders").insert({
    connection_id: raw.connection_id,
    empresa_id: raw.empresa_id,
    store_id: storeId,
    rappi_order_id: rappiOrderId,
    rappi_status: raw.event_type,
    operational_status: "RECEIVED",
    last_event_at: null,
  }).select(ORDER_STATE_COLUMNS).single<OrderState>();
  if (error) throw error;
  return data;
}

async function processNewOrder(
  admin: SupabaseClient,
  raw: RawEvent,
  payload: Record<string, unknown>,
  store: StoreRow | null,
): Promise<OrderState> {
  const sanitized = sanitizeOrder(payload);
  if (!sanitized.rappi_order_id) throw new Error("NEW_ORDER sin order_id");
  const {
    rappi_store_id: _externalStoreId,
    operational_status: nextStatus,
    rappi_status: nextRappiStatus,
    last_event_at: nextAt,
    ...details
  } = sanitized;
  const { data: existing, error: selectError } = await admin.from("rappi_orders")
    .select(ORDER_STATE_COLUMNS)
    .eq("connection_id", raw.connection_id)
    .eq("rappi_order_id", sanitized.rappi_order_id)
    .maybeSingle<OrderState>();
  if (selectError) throw selectError;

  let order: OrderState;
  let applied = true;
  if (existing) {
    // El detalle (productos, totales, pago) siempre se completa: un evento
    // pudo crear la orden antes. El estado solo si no la hace retroceder.
    applied = shouldApplyOrderState(existing.operational_status, existing.last_event_at, String(nextStatus), String(nextAt ?? ""));
    const { data, error } = await admin.from("rappi_orders").update({
      ...details,
      empresa_id: raw.empresa_id,
      store_id: store?.id ?? null,
      ...(applied ? { operational_status: nextStatus, rappi_status: nextRappiStatus || "SENT", last_event_at: nextAt } : {}),
      ...(existing.acceptance_status === "UNKNOWN" && existing.operational_status === "RECEIVED"
        ? { acceptance_status: initialAcceptance(store, String(sanitized.rappi_order_id)) }
        : {}),
    }).eq("id", existing.id).select(ORDER_STATE_COLUMNS).single<OrderState>();
    if (error || !data) throw error ?? new Error("No se pudo actualizar la orden");
    order = data;
  } else {
    const { data, error } = await admin.from("rappi_orders").insert({
      ...details,
      operational_status: nextStatus,
      rappi_status: nextRappiStatus || "SENT",
      last_event_at: nextAt,
      connection_id: raw.connection_id,
      empresa_id: raw.empresa_id,
      store_id: store?.id ?? null,
      acceptance_status: initialAcceptance(store, String(sanitized.rappi_order_id)),
    }).select(ORDER_STATE_COLUMNS).single<OrderState>();
    if (error || !data) throw error ?? new Error("No se pudo persistir la orden");
    order = data;
  }
  await insertOrderEvent(admin, raw, order.id, {
    rappi_status: nextRappiStatus || null,
    normalized_status: "RECEIVED",
    provider_event_at: nextAt ? String(nextAt) : null,
    additional_information: { applied_to_current_state: applied },
  });
  return order;
}

/**
 * Las órdenes ENKRATO-DEV-* son pruebas internas que no existen en Rappi:
 * intentar tomarlas solo produciría un 404.
 */
function initialAcceptance(store: StoreRow | null, rappiOrderId: string): "PENDING" | "MANUAL" {
  if (/^ENKRATO-DEV-/i.test(rappiOrderId)) return "MANUAL";
  return store?.auto_accept === false ? "MANUAL" : "PENDING";
}

/**
 * Aplica un evento de Rappi a la orden. Lo usan tanto los webhooks como el
 * barrido que consulta GET orders/{id}/events, para que ambos caminos dejen
 * exactamente el mismo resultado.
 */
async function applyOrderEvent(
  admin: SupabaseClient,
  raw: RawEvent,
  order: OrderState,
  event: { name: string; at: string | null; info: unknown },
): Promise<OrderState> {
  const normalized = normalizeOperationalStatus(raw.event_type, event.name);
  const informational = isInformationalOrderEvent(event.name);
  const at = event.at ?? new Date().toISOString();
  const applied = !informational && shouldApplyOrderState(order.operational_status, order.last_event_at, normalized, at);
  const info = sanitizeEventInformation(event.info);
  const courier = record(info.courier);
  const courierName = text(courier.name) || text(info.storekeeper_name);

  const patch: Record<string, unknown> = {};
  if (applied) Object.assign(patch, { operational_status: normalized, rappi_status: event.name, last_event_at: at });
  if (courierName) patch.courier_name = courierName;
  if (normalized === "COMPLETED" && !order.delivered_at) patch.delivered_at = at;
  if (normalized === "CANCELLED" && applied) {
    Object.assign(patch, { cancelled_at: at, cancel_event: event.name, reconciliation_status: "PENDING" });
  }
  // Si Rappi muestra la orden avanzando, alguien la aceptó (Enkrato o la
  // tablet de Rappi): la aceptación deja de estar pendiente o fallida.
  if (!["RECEIVED", "CANCELLED", "REJECTED", "NOT_ACCEPTED"].includes(normalized) &&
    ["PENDING", "FAILED", "UNKNOWN", "MANUAL"].includes(order.acceptance_status)) {
    Object.assign(patch, { acceptance_status: "ACCEPTED", accepted_at: at, acceptance_error: null });
  }
  let next = order;
  if (Object.keys(patch).length) {
    const { data, error } = await admin.from("rappi_orders").update(patch).eq("id", order.id)
      .select(ORDER_STATE_COLUMNS).single<OrderState>();
    if (error) throw error;
    next = data ?? order;
  }
  await insertOrderEvent(admin, raw, order.id, {
    rappi_status: event.name,
    normalized_status: normalized,
    provider_event_at: at,
    additional_information: { ...info, applied_to_current_state: applied },
  });
  return next;
}

async function insertOrderEvent(
  admin: SupabaseClient,
  raw: RawEvent,
  orderId: string,
  values: {
    rappi_status: string | null;
    normalized_status: string;
    provider_event_at: string | null;
    additional_information: Record<string, unknown>;
  },
) {
  const { error } = await admin.from("rappi_order_events").insert({
    order_id: orderId,
    empresa_id: raw.empresa_id,
    raw_event_id: raw.id,
    event_type: raw.event_type,
    ...values,
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
  // eta_type DELIVERY significa que el repartidor ya lleva el pedido hacia el
  // cliente; PICKUP (va hacia el local) no cambia el estado de la orden.
  const nextStatus = text(tracking.eta_type).toUpperCase() === "DELIVERY"
    ? "IN_DELIVERY"
    : tracking.tracking_status ? normalizeOperationalStatus(raw.event_type, tracking.tracking_status) : null;
  if (nextStatus && shouldApplyOrderState(order.operational_status, order.last_event_at, nextStatus, String(tracking.tracked_at ?? ""))) {
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
    const { data } = await admin.from("rappi_stores").select(STORE_COLUMNS)
      .eq("connection_id", raw.connection_id).eq("active", true);
    stores = (data ?? []) as StoreRow[];
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

/**
 * Barrido de órdenes, una vez por minuto y por conexión:
 *  1. recupera órdenes en espera cuyo NEW_ORDER no llegó;
 *  2. reintenta aceptaciones pendientes mientras la ventana siga abierta;
 *  3. consulta en Rappi las órdenes activas para no depender solo de que
 *     cada webhook llegue, y da por vencidas las que nadie aceptó.
 */
async function sweepOrders(admin: SupabaseClient, connections: ConnectionCache) {
  const result = { connections: 0, recovered: 0, accepted: 0, checked: 0, expired: 0, warnings: [] as string[] };
  const cutoff = new Date(Date.now() - 40_000).toISOString();
  const { data: owned, error } = await admin.from("rappi_connections")
    .update({ last_order_sweep_at: new Date().toISOString() })
    .eq("operational_enabled", true)
    .in("status", ["CONNECTED", "DEGRADED"])
    .or(`last_order_sweep_at.is.null,last_order_sweep_at.lt.${cutoff}`)
    .select("id");
  if (error) {
    result.warnings.push(`claim: ${error.message}`);
    return result;
  }
  for (const { id } of (owned ?? []) as { id: string }[]) {
    const connection = await connections.get(id);
    if (!connection) continue;
    result.connections += 1;
    try { result.recovered += await recoverSentOrders(admin, connection); }
    catch (err) { result.warnings.push(`status/sent: ${describe(err)}`); }
    try { result.accepted += await retryPendingAcceptances(admin, connection); }
    catch (err) { result.warnings.push(`aceptación: ${describe(err)}`); }
    try {
      const checked = await checkActiveOrders(admin, connection);
      result.checked += checked.checked;
      result.expired += checked.expired;
    } catch (err) { result.warnings.push(`eventos: ${describe(err)}`); }
  }
  if (result.warnings.length) console.warn(`[${LABEL}] barrido con avisos:`, result.warnings.join(" | "));
  return result;
}

async function recoverSentOrders(admin: SupabaseClient, connection: RappiConnection): Promise<number> {
  const sent = await fetchSentOrders(admin, connection);
  let recovered = 0;
  for (const payload of sent) {
    const rappiOrderId = extractOrderId(payload);
    if (!rappiOrderId) continue;
    const { data: known } = await admin.from("rappi_orders").select("id")
      .eq("connection_id", connection.id).eq("rappi_order_id", rappiOrderId).maybeSingle();
    if (known) continue;
    const raw: RawEvent = {
      id: null, connection_id: connection.id, empresa_id: connection.empresa_id,
      event_type: "NEW_ORDER", raw_payload: payload,
    };
    const store = await ensureStore(admin, raw, payload);
    if (!store?.enkrato_empresa_id) continue;
    const order = await processNewOrder(admin, { ...raw, empresa_id: store.enkrato_empresa_id }, payload, store);
    recovered += 1;
    if (order.acceptance_status === "PENDING") await acceptOrder(admin, connection, order, { maxAttempts: 2 });
  }
  return recovered;
}

async function retryPendingAcceptances(admin: SupabaseClient, connection: RappiConnection): Promise<number> {
  const { data, error } = await admin.from("rappi_orders").select(ORDER_STATE_COLUMNS)
    .eq("connection_id", connection.id).eq("acceptance_status", "PENDING")
    .order("first_received_at", { ascending: true }).limit(10);
  if (error) throw error;
  let accepted = 0;
  for (const order of (data ?? []) as OrderState[]) {
    if (!acceptanceWindowOpen(order.provider_created_at ?? order.first_received_at)) {
      await admin.from("rappi_orders").update({
        acceptance_status: "FAILED",
        acceptance_error: "Se acabaron los 6 minutos sin poder aceptarlo.",
      }).eq("id", order.id).eq("acceptance_status", "PENDING");
      continue;
    }
    if (await acceptOrder(admin, connection, order, { maxAttempts: 2 }) === "ACCEPTED") accepted += 1;
  }
  return accepted;
}

async function checkActiveOrders(
  admin: SupabaseClient,
  connection: RappiConnection,
): Promise<{ checked: number; expired: number }> {
  const now = Date.now();
  const { data, error } = await admin.from("rappi_orders").select(ORDER_STATE_COLUMNS)
    .eq("connection_id", connection.id)
    .not("operational_status", "in", `(${TERMINAL_ORDER_STATUSES.join(",")})`)
    .gte("first_received_at", new Date(now - PROVIDER_CHECK_HORIZON_MS).toISOString())
    .or(`last_provider_check_at.is.null,last_provider_check_at.lt.${new Date(now - PROVIDER_CHECK_EVERY_MS).toISOString()}`)
    .not("rappi_order_id", "like", "ENKRATO-DEV-%")
    .order("last_provider_check_at", { ascending: true, nullsFirst: true })
    .limit(8);
  if (error) throw error;

  let checked = 0;
  let expired = 0;
  for (let order of (data ?? []) as OrderState[]) {
    const events = await fetchOrderEvents(admin, connection, order.rappi_order_id);
    checked += 1;
    const { data: known } = await admin.from("rappi_order_events")
      .select("rappi_status, provider_event_at").eq("order_id", order.id);
    const seen = (known ?? []) as { rappi_status: string | null; provider_event_at: string | null }[];
    const raw: RawEvent = {
      id: null, connection_id: connection.id, empresa_id: order.empresa_id,
      event_type: "ORDER_OTHER_EVENT", raw_payload: null,
    };
    const ordered = events
      .map((entry) => ({ ...entry, at: parseProviderInstant(entry.event_time) }))
      .sort((a, b) => Date.parse(a.at ?? "") - Date.parse(b.at ?? ""));
    for (const entry of ordered) {
      if (alreadyRecorded(seen, entry.event, entry.at)) continue;
      const cancel = entry.event.toUpperCase().includes("CANCEL");
      order = await applyOrderEvent(admin, { ...raw, event_type: cancel ? "ORDER_EVENT_CANCEL" : "ORDER_OTHER_EVENT" }, order, {
        name: entry.event, at: entry.at, info: entry.additional_information,
      });
      seen.push({ rappi_status: entry.event, provider_event_at: entry.at });
    }

    const patch: Record<string, unknown> = { last_provider_check_at: new Date().toISOString() };
    const age = now - Date.parse(order.provider_created_at ?? order.first_received_at ?? "");
    // Rappi no avisa cuando vence una orden sin aceptar: si pasó la ventana,
    // nadie la aceptó y Rappi no tiene ningún evento, se da por vencida.
    if (order.operational_status === "RECEIVED" && order.acceptance_status !== "ACCEPTED" &&
      events.length === 0 && Number.isFinite(age) && age > NOT_ACCEPTED_AFTER_MS) {
      Object.assign(patch, {
        operational_status: "NOT_ACCEPTED",
        rappi_status: "TIMEOUT",
        last_event_at: new Date().toISOString(),
        ...(order.acceptance_status === "PENDING" || order.acceptance_status === "UNKNOWN"
          ? { acceptance_status: "FAILED", acceptance_error: "Nadie lo aceptó en los 6 minutos que da Rappi." }
          : {}),
      });
      expired += 1;
    }
    await admin.from("rappi_orders").update(patch).eq("id", order.id);
    if (patch.operational_status === "NOT_ACCEPTED") {
      await insertOrderEvent(admin, raw, order.id, {
        rappi_status: "TIMEOUT",
        normalized_status: "NOT_ACCEPTED",
        provider_event_at: String(patch.last_event_at),
        additional_information: { source: "enkrato", reason: "Sin aceptación ni eventos en Rappi pasada la ventana de 6 minutos." },
      });
    }
  }
  return { checked, expired };
}

/** GET events entrega ISO UTC; los webhooks, hora local de Colombia. */
function parseProviderInstant(value: unknown): string | null {
  return extractProviderTime({ event_time: value });
}

/** Un mismo evento llega por webhook y por consulta con horas que difieren en segundos. */
function alreadyRecorded(
  seen: { rappi_status: string | null; provider_event_at: string | null }[],
  event: string,
  at: string | null,
): boolean {
  const target = Date.parse(at ?? "");
  return seen.some((row) => {
    if (text(row.rappi_status).toLowerCase() !== event.toLowerCase()) return false;
    const known = Date.parse(row.provider_event_at ?? "");
    return !Number.isFinite(target) || !Number.isFinite(known) || Math.abs(known - target) <= 90_000;
  });
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  const message = record(error).message;
  return text(message).slice(0, 200) || "error desconocido";
}

async function failJob(admin: SupabaseClient, job: Job, error: unknown, dead: boolean) {
  const message = describe(error);
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

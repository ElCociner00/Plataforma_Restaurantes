import { sha256Hex } from "./crypto.ts";

export type JsonRecord = Record<string, unknown>;

export const record = (value: unknown): JsonRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

export const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

export const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const dayFirst = raw.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);
  const normalized = dayFirst
    ? `${dayFirst[3]}-${dayFirst[2]}-${dayFirst[1]}T${dayFirst[4]}-05:00`
    : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}-05:00`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function extractOrderId(payload: JsonRecord): string {
  const detail = record(payload.order_detail);
  return text(detail.order_id ?? payload.order_id ?? payload.orderId);
}

export function extractStoreId(payload: JsonRecord): string {
  const detail = record(payload.order_detail);
  const store = record(payload.store);
  return text(
    payload.store_id ?? payload.storeId ?? detail.store_id ??
      store.internal_id ??
      payload.external_store_id ?? store.integrationId ?? store.id ??
      store.external_id,
  );
}

export function extractProviderTime(payload: JsonRecord): string | null {
  const detail = record(payload.order_detail);
  return parseDate(
    payload.event_time ?? payload.timestamp ?? payload.updated_at ??
      payload.created_at ??
      detail.updated_at ?? detail.created_at ?? detail.place_at,
  );
}

/**
 * El probador de Integrations Manager usa identificadores SAMPLE-* contra la
 * tienda real. Esos webhooks certifican transporte y HMAC, pero no representan
 * pedidos ni menús de negocio y no deben contaminar la operación.
 */
export function isRappiTesterSample(payload: JsonRecord): boolean {
  const identifiers = [
    extractOrderId(payload),
    text(payload.menu_id ?? payload.menuId),
    text(payload.event_id ?? payload.eventId),
  ];
  return identifiers.some((value) => /^SAMPLE(?:-|$)/i.test(value));
}

export function effectiveMenuApprovalStatus(
  rappiStoreId: unknown,
  fallback: unknown,
  events: JsonRecord[],
): string | null {
  let testerSampleSeen = false;
  for (const event of events) {
    const payload = record(event.raw_payload);
    if (extractStoreId(payload) !== text(rappiStoreId)) continue;
    if (isRappiTesterSample(payload)) {
      testerSampleSeen = true;
      continue;
    }
    const eventType = text(event.event_type).toUpperCase();
    if (eventType === "MENU_APPROVED") return "APPROVED";
    if (eventType === "MENU_REJECTED") return "REJECTED";
  }
  return testerSampleSeen ? null : text(fallback).toUpperCase() || null;
}

export async function buildIdempotencyKey(
  eventType: string,
  payload: JsonRecord,
  signatureTimestamp: string,
  payloadHash?: string,
): Promise<string> {
  const explicit = text(
    payload.event_id ?? payload.eventId ?? payload.idempotency_key,
  );
  if (explicit) return `${eventType}:EVENT:${explicit}`;

  const orderId = extractOrderId(payload);
  const storeId = extractStoreId(payload);
  const providerTime = extractProviderTime(payload);
  const identity = [
    eventType,
    orderId,
    storeId,
    providerTime ?? signatureTimestamp,
  ].join("|");
  const hash = payloadHash ?? await sha256Hex(JSON.stringify(payload));
  return `${identity}|${hash}`;
}

export function normalizeOperationalStatus(
  eventType: string,
  providerStatus: unknown,
): string {
  const status = text(providerStatus).toUpperCase();
  if (eventType === "ORDER_EVENT_CANCEL" || status.includes("CANCEL")) {
    return "CANCELLED";
  }
  if (/DELIVER|COMPLET|FINISH/.test(status)) return "COMPLETED";
  if (/ON_THE_WAY|COURIER|PICKED|HANDOFF/.test(status)) return "IN_DELIVERY";
  if (/READY/.test(status)) return "READY";
  if (/TAKEN|ACCEPT|COOK|PREPAR/.test(status)) return "IN_PROGRESS";
  if (eventType === "NEW_ORDER") return "RECEIVED";
  return status || "RECEIVED";
}

export function sanitizeOrder(payload: JsonRecord): JsonRecord {
  const detail = record(payload.order_detail);
  const totals = record(detail.totals);
  const otherTotals = record(totals.other_totals);
  const items = Array.isArray(detail.items)
    ? detail.items.map(sanitizeItem)
    : [];
  const scheduledFor = parseDate(detail.place_at);

  return {
    rappi_order_id: extractOrderId(payload),
    rappi_store_id: extractStoreId(payload),
    order_kind: text(detail.delivery_operation_type).toUpperCase() || "REGULAR",
    is_scheduled: text(payload.action).toLowerCase() === "scheduled" ||
      Boolean(scheduledFor),
    scheduled_for: scheduledFor,
    rappi_status: text(detail.status ?? payload.status ?? payload.event),
    operational_status: normalizeOperationalStatus(
      "NEW_ORDER",
      detail.status ?? payload.status,
    ),
    delivery_operation_type: text(detail.delivery_operation_type) || null,
    delivery_method: text(detail.delivery_method) || null,
    payment_method: text(detail.payment_method) || null,
    total_products: numberOrNull(totals.total_products),
    total_discounts: numberOrNull(totals.total_discounts),
    total_order: numberOrNull(totals.total_order),
    total_to_pay: numberOrNull(totals.total_to_pay),
    tip_amount: numberOrNull(otherTotals.tip),
    items,
    totals: sanitizeMoneyObject(totals),
    delivery_summary: {
      method: text(detail.delivery_method) || null,
      operation_type: text(detail.delivery_operation_type) || null,
      cooking_time: numberOrNull(detail.cooking_time),
      min_cooking_time: numberOrNull(detail.min_cooking_time),
      max_cooking_time: numberOrNull(detail.max_cooking_time),
    },
    provider_created_at: parseDate(detail.created_at),
    last_event_at: extractProviderTime(payload) ?? new Date().toISOString(),
  };
}

export function sanitizeItem(value: unknown): JsonRecord {
  const item = record(value);
  return {
    sku: text(item.sku) || null,
    id: text(item.id) || null,
    name: text(item.name),
    type: text(item.type) || null,
    comments: text(item.comments) || null,
    price: numberOrNull(item.price),
    unit_price_with_discount: numberOrNull(item.unit_price_with_discount),
    unit_price_without_discount: numberOrNull(item.unit_price_without_discount),
    quantity: numberOrNull(item.quantity),
    subitems: Array.isArray(item.subitems)
      ? item.subitems.map(sanitizeItem)
      : [],
  };
}

export function sanitizeMoneyObject(value: unknown): JsonRecord {
  const input = record(value);
  const output: JsonRecord = {};
  for (const [key, candidate] of Object.entries(input)) {
    if (
      candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ) {
      output[key] = sanitizeMoneyObject(candidate);
      continue;
    }
    if (
      typeof candidate === "number" || typeof candidate === "string" ||
      typeof candidate === "boolean" || candidate === null
    ) {
      output[key] = candidate;
    }
  }
  return output;
}

export function sanitizeFinancialRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeFinancialRecord);
  if (!value || typeof value !== "object") return value;
  const output: JsonRecord = {};
  for (const [key, child] of Object.entries(value as JsonRecord)) {
    const normalized = key.toLowerCase();
    const sensitive =
      /customer|consumer|holder|phone|email|address|document|identification|account_number|account_holder|tax_id/
        .test(normalized) ||
      normalized === "bank_account";
    if (sensitive) continue;
    output[key] = sanitizeFinancialRecord(child);
  }
  return output;
}

export function parseTracking(payload: JsonRecord): JsonRecord {
  return {
    rappi_order_id: extractOrderId(payload),
    rappi_store_id: extractStoreId(payload),
    tracking_status: text(payload.status ?? payload.tracking_status) || null,
    courier_id: text(payload.courier_id ?? payload.courierId) || null,
    latitude: numberOrNull(payload.latitude ?? payload.lat),
    longitude: numberOrNull(payload.longitude ?? payload.lng),
    eta: text(payload.eta ?? payload.eta_in_millis) || null,
    eta_type: text(payload.eta_type ?? payload.etaType) || null,
    tracked_at: extractProviderTime(payload) ?? new Date().toISOString(),
  };
}

export function parseConnectivity(
  payload: JsonRecord,
  eventType: string,
): JsonRecord {
  const providerStatus = text(
    payload.status ?? payload.state ?? payload.connectivity,
  ).toUpperCase();
  const explicit = payload.online ?? payload.is_online ?? payload.connected ??
    payload.success ?? payload.enabled;
  const isOnline = typeof explicit === "boolean"
    ? explicit
    : /ONLINE|CONNECTED|ENABLE|ENABLED|OK|SUCCESS|TRUE/.test(providerStatus)
    ? true
    : /OFFLINE|DISCONNECTED|DISABLE|DISABLED|ERROR|FALSE/.test(providerStatus)
    ? false
    : eventType === "PING"
    ? true
    : null;
  return {
    rappi_store_id: extractStoreId(payload),
    provider_status: providerStatus || eventType,
    normalized_status: isOnline === true
      ? "ONLINE"
      : isOnline === false
      ? "OFFLINE"
      : "UNKNOWN",
    is_online: isOnline,
    occurred_at: extractProviderTime(payload) ?? new Date().toISOString(),
  };
}

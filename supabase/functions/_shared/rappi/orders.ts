/**
 * Acciones sobre el ciclo de vida de una orden en Rappi.
 *
 * Por qué existe: con webhooks, Rappi entrega la orden en estado SENT y
 * espera que la integración la tome. Si nadie la toma en 6 minutos la vence
 * (TIMEOUT) y no manda ningún webhook avisándolo. Enkrato recibía NEW_ORDER
 * pero nunca la tomaba, así que el pedido se perdía en Rappi y en Enkrato
 * quedaba "Recibido" para siempre.
 */
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ErrorFuncion } from "../errores.ts";
import { normalizeBaseUrl, rappiRequestWithStatus } from "./client.ts";
import { numberOrNull, record, text } from "./payload.ts";
import { shouldApplyOrderState } from "./state.ts";
import type { RappiConnection } from "./types.ts";

const ORDERS_PATH = "/api/v2/restaurants-integrations-public-api/orders";

/** Ventana oficial para tomar o rechazar una orden. */
export const ACCEPT_WINDOW_MS = 6 * 60_000;
/** Pasado este tiempo sin rastro de aceptación, la orden se da por vencida. */
export const NOT_ACCEPTED_AFTER_MS = 7 * 60_000;

export type TakeOutcome = "ACCEPTED" | "NOT_WAITING" | "RETRY" | "FAILED";

export type AcceptableOrder = {
  id: string;
  empresa_id: string;
  rappi_order_id: string;
  operational_status: string;
  last_event_at: string | null;
  provider_created_at: string | null;
  first_received_at: string | null;
  delivery_summary: unknown;
  acceptance_attempts: number | null;
};

export type ProviderOrderEvent = {
  event: string;
  event_time: unknown;
  additional_information: unknown;
};

/**
 * 400 es "estado de transición inválido": la orden ya no espera aceptación
 * (la tomó otro medio, venció o la cancelaron). No es un fallo del conector.
 */
export function classifyTakeStatus(status: number): TakeOutcome {
  if (status >= 200 && status < 300) return "ACCEPTED";
  if (status === 400 || status === 409) return "NOT_WAITING";
  if (status === 429 || status >= 500) return "RETRY";
  return "FAILED";
}

export function acceptanceWindowOpen(createdAt: string | null | undefined, nowMs = Date.now()): boolean {
  const created = Date.parse(String(createdAt || ""));
  return !Number.isFinite(created) || nowMs - created < ACCEPT_WINDOW_MS;
}

function ordersUrl(connection: RappiConnection, suffix: string): string {
  return `${normalizeBaseUrl(connection.orders_base_url)}${ORDERS_PATH}${suffix}`;
}

function listFrom(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.map(record);
  const object = record(body);
  for (const key of ["data", "orders", "events", "items"]) {
    if (Array.isArray(object[key])) return (object[key] as unknown[]).map(record);
  }
  return [];
}

async function takeOrderOnce(
  admin: SupabaseClient,
  connection: RappiConnection,
  rappiOrderId: string,
  cookingTime: number | null,
): Promise<{ outcome: TakeOutcome; httpStatus: number | null }> {
  // Se envía el tiempo que Rappi ya propuso en la orden para no alterarlo.
  const minutes = cookingTime && cookingTime > 0 ? Math.min(120, Math.round(cookingTime)) : "";
  try {
    const response = await rappiRequestWithStatus(
      admin,
      connection,
      "OPERATIONAL",
      ordersUrl(connection, `/${encodeURIComponent(rappiOrderId)}/take/${minutes}`),
      { method: "PUT" },
    );
    return { outcome: classifyTakeStatus(response.status), httpStatus: response.status };
  } catch (error) {
    // Red o timeout: reintentar es seguro, una segunda toma responde 400.
    if (error instanceof ErrorFuncion && ["RAPPI_TIMEOUT", "RAPPI_UNREACHABLE"].includes(error.codigo)) {
      return { outcome: "RETRY", httpStatus: null };
    }
    throw error;
  }
}

/**
 * Toma la orden en Rappi y deja constancia en rappi_orders.
 *
 * Solo escribe si la aceptación sigue en uno de `fromStatuses`: el worker que
 * despierta el webhook y el del cron pueden llegar a la vez, y el segundo no
 * debe pisar lo que resolvió el primero.
 */
export async function acceptOrder(
  admin: SupabaseClient,
  connection: RappiConnection,
  order: AcceptableOrder,
  options: { maxAttempts?: number; fromStatuses?: string[]; mode?: "auto" | "manual" } = {},
): Promise<TakeOutcome> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const fromStatuses = options.fromStatuses ?? ["PENDING"];
  const cookingTime = numberOrNull(record(order.delivery_summary).cooking_time);
  let outcome: TakeOutcome = "RETRY";
  let httpStatus: number | null = null;
  let detail: string | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      ({ outcome, httpStatus } = await takeOrderOnce(admin, connection, order.rappi_order_id, cookingTime));
      detail = null;
    } catch (error) {
      outcome = "RETRY";
      detail = error instanceof Error ? error.message : "Error al contactar a Rappi.";
    }
    if (outcome !== "RETRY") break;
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }

  const now = new Date().toISOString();
  const windowOpen = acceptanceWindowOpen(order.provider_created_at ?? order.first_received_at);
  const attempts = (order.acceptance_attempts ?? 0) + 1;
  const patch: Record<string, unknown> = { acceptance_attempts: attempts };
  if (outcome === "ACCEPTED") {
    Object.assign(patch, { acceptance_status: "ACCEPTED", accepted_at: now, acceptance_error: null });
  } else if (outcome === "RETRY" && windowOpen) {
    Object.assign(patch, {
      acceptance_status: "PENDING",
      acceptance_error: detail ?? `Rappi no respondió (${httpStatus ?? "sin respuesta"}); se reintentará.`,
    });
  } else {
    Object.assign(patch, {
      acceptance_status: "FAILED",
      acceptance_error: outcome === "NOT_WAITING"
        ? "Rappi no permitió aceptarlo: ya no estaba esperando aceptación (aceptado por otro medio, vencido o cancelado)."
        : outcome === "RETRY"
        ? "Se acabaron los 6 minutos sin que Rappi respondiera."
        : `Rappi rechazó la aceptación (HTTP ${httpStatus ?? "?"}).`,
    });
  }

  const { data: updated, error } = await admin.from("rappi_orders").update(patch)
    .eq("id", order.id).in("acceptance_status", fromStatuses).select("id");
  if (error) throw error;
  if (outcome !== "ACCEPTED" || !updated?.length) return outcome;

  // Tomarla es un hecho: la orden pasa a preparación sin esperar el
  // taken_visible_order de Rappi, que puede tardar o no llegar en sandbox.
  if (shouldApplyOrderState(order.operational_status, order.last_event_at, "IN_PROGRESS", now)) {
    await admin.from("rappi_orders").update({
      operational_status: "IN_PROGRESS",
      rappi_status: "TAKEN",
      last_event_at: now,
    }).eq("id", order.id);
  }
  await admin.from("rappi_order_events").insert({
    order_id: order.id,
    empresa_id: order.empresa_id,
    event_type: "ENKRATO_ACCEPT",
    rappi_status: "TAKEN",
    normalized_status: "IN_PROGRESS",
    provider_event_at: now,
    additional_information: { source: "enkrato", mode: options.mode ?? "auto", cooking_time: cookingTime },
  });
  return outcome;
}

/** Historial de eventos que Rappi tiene de la orden (red de seguridad de webhooks). */
export async function fetchOrderEvents(
  admin: SupabaseClient,
  connection: RappiConnection,
  rappiOrderId: string,
): Promise<ProviderOrderEvent[]> {
  const response = await rappiRequestWithStatus(
    admin,
    connection,
    "OPERATIONAL",
    ordersUrl(connection, `/${encodeURIComponent(rappiOrderId)}/events`),
  );
  if (response.status === 404 || response.status === 204) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new ErrorFuncion("RAPPI_HTTP", `Rappi devolvió un error (${response.status}).`, 502);
  }
  return listFrom(response.body)
    .filter((entry) => text(entry.event))
    .map((entry) => ({
      event: text(entry.event),
      event_time: entry.event_time,
      additional_information: entry.additional_information,
    }));
}

/**
 * Órdenes que pasaron a SENT en los últimos 10 minutos. Si un NEW_ORDER se
 * perdió en el camino, aparece aquí mientras todavía se puede aceptar.
 */
export async function fetchSentOrders(
  admin: SupabaseClient,
  connection: RappiConnection,
): Promise<Record<string, unknown>[]> {
  const response = await rappiRequestWithStatus(
    admin,
    connection,
    "OPERATIONAL",
    ordersUrl(connection, "/status/sent"),
  );
  if (response.status === 404 || response.status === 204) return [];
  if (response.status < 200 || response.status >= 300) {
    throw new ErrorFuncion("RAPPI_HTTP", `Rappi devolvió un error (${response.status}).`, 502);
  }
  return listFrom(response.body);
}

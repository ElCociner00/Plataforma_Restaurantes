import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAccesoEscritura, exigirAdmin, resolverContexto, type Contexto } from "../_shared/tenant.ts";
import {
  effectiveMenuApprovalStatus,
  record,
  text,
} from "../_shared/rappi/payload.ts";
import { TERMINAL_ORDER_STATUSES } from "../_shared/rappi/state.ts";
import { acceptOrder, type AcceptableOrder } from "../_shared/rappi/orders.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";

const LABEL = "rappi-data";
const FINANCIAL_ACTIONS = new Set([
  "finance_summary", "payments", "payment_detail", "reconciliations", "reconciliation_evidence",
]);
// Colombia no tiene horario de verano: el día operativo es fijo en UTC-5.
const BOGOTA_OFFSET = "-05:00";
const BOARD_COLUMNS =
  "id, rappi_order_id, store_id, order_kind, is_scheduled, scheduled_for, operational_status, rappi_status, acceptance_status, acceptance_error, accepted_at, delivery_method, payment_method, total_products, total_discounts, total_order, total_to_pay, courier_name, delivered_at, cancelled_at, cancel_event, provider_created_at, first_received_at, last_event_at, items, rappi_stores(store_name, rappi_store_id)";

function financialFeatureEnabled(): boolean {
  return (Deno.env.get("RAPPI_FINANCIAL_FEATURE_ENABLED") ?? "").toLowerCase() === "true";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);

  try {
    const body = await leerCuerpo(req);
    const ctx = await resolverContexto(req, text(body.empresa_id) || null);
    const action = text(body.action).toLowerCase();
    if (FINANCIAL_ACTIONS.has(action) && !financialFeatureEnabled()) {
      throw new ErrorFuncion("RAPPI_FINANCIAL_STANDBY", "Rappi Financial permanece en standby.", 409);
    }
    let result: unknown;
    switch (action) {
      case "operation_summary": result = await operationSummary(ctx); break;
      case "board": result = await board(ctx, body); break;
      case "verify_order": result = await verifyOrder(ctx, body); break;
      case "accept_order": result = await acceptOrderManually(ctx, body); break;
      case "cuadre": result = await cuadre(ctx, body); break;
      case "orders": result = await orders(ctx, body); break;
      case "order_detail": result = await orderDetail(ctx, body); break;
      case "menu_support": result = await menuSupport(ctx, body); break;
      case "finance_summary": result = await financeSummary(ctx, body); break;
      case "payments": result = await payments(ctx, body); break;
      case "payment_detail": result = await paymentDetail(ctx, body); break;
      case "reconciliations": result = await reconciliations(ctx, body); break;
      case "reconciliation_evidence": result = await reconciliationEvidence(ctx, body); break;
      default: throw new ErrorFuncion("UNKNOWN_ACTION", "La consulta solicitada no existe.", 400);
    }
    return json({ ok: true, data: result }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

async function operationSummary(ctx: Contexto) {
  const db = ctx.clienteAdmin();
  const [all, incidents, stores, recent, menuEvents] = await Promise.all([
    db.from("rappi_orders").select("id", { count: "exact", head: true }).eq("empresa_id", ctx.empresaId)
      .not("rappi_order_id", "like", "ENKRATO-DEV-%").not("rappi_order_id", "like", "SAMPLE-%"),
    db.from("rappi_orders").select("id", { count: "exact", head: true }).eq("empresa_id", ctx.empresaId)
      .not("rappi_order_id", "like", "ENKRATO-DEV-%").not("rappi_order_id", "like", "SAMPLE-%")
      .not("incident_severity", "is", null),
    db.from("rappi_stores").select("id, rappi_store_id, store_name, connectivity_status, last_ping_at, last_ping_ok, menu_approval_status")
      .or(`empresa_id.eq.${ctx.empresaId},enkrato_empresa_id.eq.${ctx.empresaId}`).eq("active", true).order("store_name"),
    db.from("rappi_orders").select("id, rappi_order_id, store_id, operational_status, total_order, payment_method, provider_created_at, last_event_at, incident_severity")
      .eq("empresa_id", ctx.empresaId).not("rappi_order_id", "like", "ENKRATO-DEV-%")
      .not("rappi_order_id", "like", "SAMPLE-%").order("last_event_at", { ascending: false }).limit(8),
    db.from("rappi_webhook_events").select("event_type, raw_payload, received_at")
      .eq("empresa_id", ctx.empresaId).eq("signature_valid", true)
      .in("event_type", ["MENU_APPROVED", "MENU_REJECTED"])
      .order("received_at", { ascending: false }).limit(100),
  ]);
  return {
    total_orders: all.count ?? 0,
    incidents: incidents.count ?? 0,
    stores: (stores.data ?? []).map((store) => ({
      ...store,
      menu_approval_status: effectiveMenuApprovalStatus(
        store.rappi_store_id,
        store.menu_approval_status,
        menuEvents.data ?? [],
      ),
    })),
    recent_orders: recent.data ?? [],
  };
}

/** Día operativo en Colombia: [00:00, 24:00) hora local. */
function bogotaDay(value: unknown): { day: string; start: string; end: string } {
  const requested = text(value);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(requested)
    ? requested
    : new Date(Date.now() - 5 * 3_600_000).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00${BOGOTA_OFFSET}`);
  const end = new Date(start.getTime() + 86_400_000);
  return { day, start: start.toISOString(), end: end.toISOString() };
}

// deno-lint-ignore no-explicit-any
function withoutTestOrders(query: any): any {
  return query.not("rappi_order_id", "like", "ENKRATO-DEV-%").not("rappi_order_id", "like", "SAMPLE-%");
}

/** Cantidad de productos (sin toppings) para mostrar sin mandar el detalle. */
function toBoardRow(order: Record<string, unknown>) {
  const { items, ...rest } = order;
  const productCount = Array.isArray(items)
    ? items.reduce((sum: number, item) => sum + (Number(record(item).quantity) || 0), 0)
    : 0;
  return { ...rest, product_count: productCount };
}

/**
 * Tablero del día para quien atiende: todos los pedidos del día y, si es
 * hoy, también los que siguen en curso desde anoche.
 */
async function board(ctx: Contexto, body: Record<string, unknown>) {
  const { day, start, end } = bogotaDay(body.date);
  const db = ctx.clienteAdmin();
  const created = await withoutTestOrders(db.from("rappi_orders").select(BOARD_COLUMNS)
    .eq("empresa_id", ctx.empresaId)
    .gte("first_received_at", start).lt("first_received_at", end))
    .order("first_received_at", { ascending: false }).limit(300);
  if (created.error) throw created.error;
  let rows = (created.data ?? []) as Record<string, unknown>[];
  const today = bogotaDay(null).day === day;
  if (today) {
    const carried = await withoutTestOrders(db.from("rappi_orders").select(BOARD_COLUMNS)
      .eq("empresa_id", ctx.empresaId)
      .lt("first_received_at", start)
      .gte("first_received_at", new Date(Date.parse(start) - 12 * 3_600_000).toISOString())
      .not("operational_status", "in", `(${TERMINAL_ORDER_STATUSES.join(",")})`))
      .order("first_received_at", { ascending: false }).limit(50);
    if (carried.error) throw carried.error;
    rows = [...rows, ...((carried.data ?? []) as Record<string, unknown>[])];
  }
  const count = (predicate: (row: Record<string, unknown>) => boolean) => rows.filter(predicate).length;
  const status = (row: Record<string, unknown>) => text(row.operational_status);
  const delivered = rows.filter((row) => status(row) === "COMPLETED");
  return {
    date: day,
    is_today: today,
    generated_at: new Date().toISOString(),
    kpis: {
      pedidos: rows.length,
      por_aceptar: count((row) => status(row) === "RECEIVED"),
      en_curso: count((row) => !TERMINAL_ORDER_STATUSES.includes(status(row)) && status(row) !== "RECEIVED"),
      entregados: delivered.length,
      cancelados: count((row) => ["CANCELLED", "REJECTED"].includes(status(row))),
      vencidos: count((row) => status(row) === "NOT_ACCEPTED"),
      total_entregado: delivered.reduce((sum, row) => sum + (Number(row.total_order) || 0), 0),
    },
    orders: rows.map(toBoardRow),
  };
}

/**
 * Verificación por número de pedido: lo que un empleado usa cuando alguien
 * dice "ese domicilio es de Rappi" o "ya está pago". Si no existe para esta
 * empresa, eso mismo es la respuesta.
 */
async function verifyOrder(ctx: Contexto, body: Record<string, unknown>) {
  const number = text(body.rappi_order_id).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9-]{3,40}$/.test(number)) {
    throw new ErrorFuncion("ORDER_NUMBER", "Escribe el número de pedido de Rappi (solo números).", 400);
  }
  const { data, error } = await withoutTestOrders(ctx.clienteAdmin().from("rappi_orders").select("id")
    .eq("empresa_id", ctx.empresaId).eq("rappi_order_id", number)).maybeSingle();
  if (error) throw error;
  if (!data) return { found: false, rappi_order_id: number, checked_at: new Date().toISOString() };
  return { found: true, checked_at: new Date().toISOString(), ...(await orderDetail(ctx, { order_id: data.id })) };
}

/**
 * Aceptación manual cuando la automática no pudo (o la tienda la tiene
 * apagada). Cualquier persona de la empresa puede aceptar: es lo mismo que
 * tocar "Aceptar" en la tablet de Rappi.
 */
async function acceptOrderManually(ctx: Contexto, body: Record<string, unknown>) {
  await exigirAccesoEscritura(ctx);
  const orderId = text(body.order_id);
  if (!orderId) throw new ErrorFuncion("ORDER_REQUIRED", "Selecciona una orden.", 400);
  const db = ctx.clienteAdmin();
  const { data: order, error } = await db.from("rappi_orders").select(
    "id, empresa_id, connection_id, rappi_order_id, operational_status, last_event_at, provider_created_at, first_received_at, delivery_summary, acceptance_status, acceptance_attempts",
  ).eq("id", orderId).eq("empresa_id", ctx.empresaId).maybeSingle<AcceptableOrder & { connection_id: string; acceptance_status: string }>();
  if (error) throw error;
  if (!order) throw new ErrorFuncion("ORDER_NOT_FOUND", "La orden no existe o no pertenece a tu empresa.", 404);
  if (order.operational_status !== "RECEIVED" || order.acceptance_status === "ACCEPTED") {
    throw new ErrorFuncion("ORDER_NOT_WAITING", "Esta orden ya no está esperando aceptación.", 409);
  }
  const { data: connection } = await db.from("rappi_connections").select(
    "id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled",
  ).eq("id", order.connection_id).maybeSingle<RappiConnection>();
  if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "La conexión Rappi no está configurada.", 412);
  const outcome = await acceptOrder(db, connection, order, {
    maxAttempts: 2,
    fromStatuses: ["PENDING", "FAILED", "MANUAL", "UNKNOWN"],
    mode: "manual",
  });
  return { outcome, ...(await orderDetail(ctx, { order_id: order.id })) };
}

async function cuadre(ctx: Contexto, body: Record<string, unknown>) {
  // Cruza ventas con cierres de turno: mismo nivel de acceso que el dashboard.
  exigirAdmin(ctx, "ver el cuadre de Rappi");
  const from = text(body.from);
  const to = text(body.to);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new ErrorFuncion("INVALID_RANGE", "Elige fecha inicial y final.", 400);
  }
  if (from > to) throw new ErrorFuncion("INVALID_RANGE", "La fecha inicial no puede superar la final.", 400);
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 92) {
    throw new ErrorFuncion("RANGE_TOO_LARGE", "El cuadre admite como máximo 93 días.", 400);
  }
  const db = ctx.clienteAdmin();
  const [cuadreResult, stores, firstOrder] = await Promise.all([
    db.rpc("rappi_cuadre_diario", { p_empresa_id: ctx.empresaId, p_from: from, p_to: to }),
    db.from("rappi_stores").select("id", { count: "exact", head: true })
      .eq("enkrato_empresa_id", ctx.empresaId).eq("active", true),
    withoutTestOrders(db.from("rappi_orders").select("first_received_at").eq("empresa_id", ctx.empresaId))
      .order("first_received_at", { ascending: true }).limit(1).maybeSingle(),
  ]);
  if (cuadreResult.error) throw cuadreResult.error;
  // Antes del primer pedido recibido por la integración, que un cierre tenga
  // Rappi no dice nada: esos pedidos entraban por la tablet y Enkrato no los
  // veía. Sin esta fecha el cuadre marcaría meses enteros como sospechosos.
  const firstAt = text(firstOrder.data?.first_received_at);
  return {
    from,
    to,
    conectada: (stores.count ?? 0) > 0,
    integracion_desde: firstAt ? new Date(Date.parse(firstAt) - 5 * 3_600_000).toISOString().slice(0, 10) : null,
    ...(record(cuadreResult.data)),
  };
}

async function orders(ctx: Contexto, body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size ?? 25)));
  let query = ctx.clienteAdmin().from("rappi_orders").select(
    "id, rappi_order_id, store_id, order_kind, is_scheduled, scheduled_for, rappi_status, operational_status, acceptance_status, delivery_method, payment_method, total_order, total_to_pay, courier_name, delivered_at, cancel_event, incident_severity, incident_code, provider_created_at, first_received_at, last_event_at, rappi_stores(store_name, rappi_store_id)",
    { count: "exact" },
  ).eq("empresa_id", ctx.empresaId)
    .not("rappi_order_id", "like", "ENKRATO-DEV-%")
    .not("rappi_order_id", "like", "SAMPLE-%");
  const status = text(body.status).toUpperCase();
  const storeId = text(body.store_id);
  const search = text(body.search).replace(/[,%()]/g, "");
  // Grupos que entiende quien atiende, no los estados internos uno a uno.
  if (status === "ACTIVE") {
    query = query.neq("operational_status", "RECEIVED")
      .not("operational_status", "in", `(${TERMINAL_ORDER_STATUSES.join(",")})`);
  } else if (status === "CANCELLED") query = query.in("operational_status", ["CANCELLED", "REJECTED"]);
  else if (status === "INCIDENT") query = query.not("incident_severity", "is", null);
  else if (status) query = query.eq("operational_status", status);
  if (storeId) query = query.eq("store_id", storeId);
  if (search) query = query.ilike("rappi_order_id", `%${search}%`);
  query = applyDateRange(query, body, "provider_created_at");
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.order("last_event_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { entries: data ?? [], page, page_size: pageSize, total_entries: count ?? 0, total_pages: Math.ceil((count ?? 0) / pageSize) };
}

async function orderDetail(ctx: Contexto, body: Record<string, unknown>) {
  const orderId = text(body.order_id);
  if (!orderId) throw new ErrorFuncion("ORDER_REQUIRED", "Selecciona una orden.", 400);
  const db = ctx.clienteAdmin();
  const { data: order, error } = await db.from("rappi_orders").select(
    "*, rappi_stores(store_name, rappi_store_id, integration_store_id, connectivity_status)",
  ).eq("id", orderId).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (error) throw error;
  if (!order || /^(?:ENKRATO-DEV-|SAMPLE-)/i.test(text(order.rappi_order_id))) {
    throw new ErrorFuncion("ORDER_NOT_FOUND", "La orden no existe o no pertenece a tu empresa.", 404);
  }
  const [events, tracking] = await Promise.all([
    db.from("rappi_order_events").select("id, event_type, rappi_status, normalized_status, provider_event_at, additional_information, created_at")
      .eq("order_id", orderId).eq("empresa_id", ctx.empresaId).order("created_at"),
    db.from("rappi_order_tracking").select("id, tracking_status, courier_id, latitude, longitude, eta, eta_type, tracked_at")
      .eq("order_id", orderId).eq("empresa_id", ctx.empresaId).order("tracked_at", { ascending: false }).limit(100),
  ]);
  return {
    order,
    events: events.data ?? [],
    tracking: tracking.data ?? [],
  };
}

async function menuSupport(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = text(body.store_id);
  const db = ctx.clienteAdmin();
  let storesQuery = db.from("rappi_stores").select("id, rappi_store_id, store_name, menu_approval_status, menu_updated_at")
    .or(`empresa_id.eq.${ctx.empresaId},enkrato_empresa_id.eq.${ctx.empresaId}`).eq("active", true);
  if (storeId) storesQuery = storesQuery.eq("id", storeId);
  const { data: stores, error } = await storesQuery.order("store_name");
  if (error) throw error;
  const { data: menuEvents, error: menuEventsError } = await db.from("rappi_webhook_events")
    .select("event_type, raw_payload, received_at")
    .eq("empresa_id", ctx.empresaId).eq("signature_valid", true)
    .in("event_type", ["MENU_APPROVED", "MENU_REJECTED"])
    .order("received_at", { ascending: false }).limit(100);
  if (menuEventsError) throw menuEventsError;
  const result = [];
  for (const store of stores ?? []) {
    const { data: menu } = await db.from("rappi_menu_versions")
      .select("id, approval_status, item_count, menu_data, source, received_at")
      .eq("store_id", store.id).eq("empresa_id", ctx.empresaId)
      .order("received_at", { ascending: false }).limit(1).maybeSingle();
    result.push({
      ...store,
      menu_approval_status: effectiveMenuApprovalStatus(
        store.rappi_store_id,
        store.menu_approval_status,
        menuEvents ?? [],
      ),
      menu: menu ?? null,
    });
  }
  return result;
}

async function financeSummary(ctx: Contexto, body: Record<string, unknown>) {
  const db = ctx.clienteAdmin();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(text(body.from)) ? text(body.from) : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(text(body.to)) ? text(body.to) : null;
  const { data, error } = await db.rpc("rappi_finance_summary", {
    p_empresa_id: ctx.empresaId,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data ?? {
    payments_count: 0,
    payments_total: 0,
    reconciliation: { matched: 0, warnings: 0, critical: 0, pending: 0 },
  };
}

async function payments(ctx: Contexto, body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size ?? 25)));
  let query = ctx.clienteAdmin().from("rappi_financial_payments").select(
    "id, rappi_payment_id, store_id, status, period_start_date, period_end_date, expected_execution_date, confirmed_payment_date, total_amount, payment_reference, frequency_type, stores_consolidated, rappi_stores(store_name, rappi_store_id)",
    { count: "exact" },
  ).eq("empresa_id", ctx.empresaId);
  const status = text(body.status);
  if (status) query = query.eq("status", status);
  query = applyDateRange(query, body, "confirmed_payment_date");
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.order("confirmed_payment_date", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return { entries: data ?? [], page, page_size: pageSize, total_entries: count ?? 0, total_pages: Math.ceil((count ?? 0) / pageSize) };
}

async function paymentDetail(ctx: Contexto, body: Record<string, unknown>) {
  const paymentId = text(body.payment_id);
  if (!paymentId) throw new ErrorFuncion("PAYMENT_REQUIRED", "Selecciona un pago.", 400);
  const db = ctx.clienteAdmin();
  const { data: payment, error } = await db.from("rappi_financial_payments").select(
    "id, rappi_payment_id, status, period_start_date, period_end_date, expected_execution_date, confirmed_payment_date, total_amount, payment_reference, frequency_type, stores_consolidated, raw_data, rappi_stores(store_name, rappi_store_id)",
  ).eq("id", paymentId).eq("empresa_id", ctx.empresaId).maybeSingle();
  if (error) throw error;
  if (!payment) throw new ErrorFuncion("PAYMENT_NOT_FOUND", "El pago no existe o no pertenece a tu empresa.", 404);
  const { data: entries } = await db.from("rappi_financial_entries")
    .select("id, entry_kind, rappi_order_id, amount, occurred_at, billing, raw_data")
    .eq("payment_id", paymentId).eq("empresa_id", ctx.empresaId).order("occurred_at");
  return { payment, entries: entries ?? [] };
}

async function reconciliations(ctx: Contexto, body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size ?? 25)));
  let query = ctx.clienteAdmin().from("rappi_reconciliation_records").select(
    "id, order_id, payment_id, operational_amount, financial_amount, accounting_amount, difference_amount, severity, status, rule_codes, evaluated_at, rappi_orders(rappi_order_id, operational_status, financial_status, accounting_status, provider_created_at), rappi_financial_payments(rappi_payment_id, confirmed_payment_date)",
    { count: "exact" },
  ).eq("empresa_id", ctx.empresaId);
  const status = text(body.status).toUpperCase();
  if (status) query = query.eq("status", status);
  query = applyDateRange(query, body, "evaluated_at");
  const from = (page - 1) * pageSize;
  const { data, count, error } = await query.order("evaluated_at", { ascending: false }).range(from, from + pageSize - 1);
  if (error) throw error;
  return {
    entries: data ?? [],
    page,
    page_size: pageSize,
    total_entries: count ?? 0,
    total_pages: Math.ceil((count ?? 0) / pageSize),
  };
}

async function reconciliationEvidence(ctx: Contexto, body: Record<string, unknown>) {
  const detail = await orderDetail(ctx, body) as Record<string, unknown>;
  return {
    report_type: "Reporte de conciliación generado por Enkrato",
    generated_at: new Date().toISOString(),
    empresa_id: ctx.empresaId,
    ...detail,
  };
}

// deno-lint-ignore no-explicit-any
function applyDateRange(query: any, body: Record<string, unknown>, column: string): any {
  const from = text(body.from);
  const to = text(body.to);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte(column, bogotaDay(from).start);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lt(column, bogotaDay(to).end);
  return query;
}

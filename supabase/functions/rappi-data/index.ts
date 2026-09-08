import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto, type Contexto } from "../_shared/tenant.ts";
import {
  effectiveMenuApprovalStatus,
  text,
} from "../_shared/rappi/payload.ts";

const LABEL = "rappi-data";
const FINANCIAL_ACTIONS = new Set([
  "finance_summary", "payments", "payment_detail", "reconciliations", "reconciliation_evidence",
]);

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

async function orders(ctx: Contexto, body: Record<string, unknown>) {
  const page = Math.max(1, Number(body.page ?? 1));
  const pageSize = Math.min(100, Math.max(10, Number(body.page_size ?? 25)));
  let query = ctx.clienteAdmin().from("rappi_orders").select(
    "id, rappi_order_id, store_id, order_kind, is_scheduled, scheduled_for, rappi_status, operational_status, delivery_method, payment_method, total_order, incident_severity, incident_code, provider_created_at, last_event_at, rappi_stores(store_name, rappi_store_id)",
    { count: "exact" },
  ).eq("empresa_id", ctx.empresaId)
    .not("rappi_order_id", "like", "ENKRATO-DEV-%")
    .not("rappi_order_id", "like", "SAMPLE-%");
  const status = text(body.status).toUpperCase();
  const storeId = text(body.store_id);
  const search = text(body.search).replace(/[,%()]/g, "");
  if (status) query = query.eq("operational_status", status);
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte(column, `${from}T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte(column, `${to}T23:59:59.999Z`);
  return query;
}

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { clienteServicio, exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { normalizeBaseUrl, rappiRequest } from "../_shared/rappi/client.ts";
import { sha256Hex } from "../_shared/rappi/crypto.ts";
import { evaluateReconciliation } from "../_shared/rappi/reconciliation.ts";
import { normalizeOperationalStatus, numberOrNull, parseDate, record, sanitizeFinancialRecord, sanitizeItem, sanitizeMoneyObject, text } from "../_shared/rappi/payload.ts";
import { shouldApplyOrderState } from "../_shared/rappi/state.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";

const LABEL = "rappi-sync";
const FINANCIAL_KINDS = [
  "orders", "order_adjustments", "charged_cancellations", "cancellations",
  "store_adjustments", "extras", "taxes", "loans", "debts", "compensations", "agreements",
] as const;

function financialFeatureEnabled(): boolean {
  return (Deno.env.get("RAPPI_FINANCIAL_FEATURE_ENABLED") ?? "").toLowerCase() === "true";
}

type Counters = { read: number; written: number; pages: number; warnings: string[] };

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);

  let syncRunId: string | null = null;
  let admin: SupabaseClient | null = null;
  let connectionId: string | null = null;
  let effectiveEmpresaId: string | null = null;
  try {
    const body = await leerCuerpo(req);
    const cronSecret = Deno.env.get("RAPPI_CRON_SECRET") ?? Deno.env.get("CRON_SECRET") ?? "";
    const isCron = Boolean(cronSecret && req.headers.get("x-cron-secret") === cronSecret);
    let empresaId = text(body.empresa_id);
    if (!isCron) {
      const ctx = await resolverContexto(req, empresaId || null);
      exigirAdmin(ctx, "sincronizar Rappi");
      empresaId = ctx.empresaId;
    }
    if (!empresaId) throw new ErrorFuncion("SIN_EMPRESA", "La sincronización requiere una empresa.", 400);
    effectiveEmpresaId = empresaId;
    admin = clienteServicio();
    const env = text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
    const { data: connection, error: connectionError } = await admin.from("rappi_connections")
      .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
      .eq("empresa_id", empresaId).eq("environment", env).maybeSingle<RappiConnection>();
    if (connectionError) throw connectionError;
    if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "La conexión Rappi no está configurada.", 412);
    connectionId = connection.id;

    const syncType = text(body.sync_type).toLowerCase() || "full";
    const allowed = ["full", "operational", "stores", "orders", "menus", "financial"];
    if (!allowed.includes(syncType)) throw new ErrorFuncion("SYNC_TYPE", "Tipo de sincronización inválido.", 400);
    if (syncType === "financial" && !financialFeatureEnabled()) {
      throw new ErrorFuncion("RAPPI_FINANCIAL_STANDBY", "Rappi Financial permanece en standby.", 409);
    }
    const range = dateRange(body);
    // Una ejecución que el runtime cortó queda en RUNNING para siempre y
    // ensucia el diagnóstico: pasados 10 minutos se da por interrumpida.
    await admin.from("rappi_sync_runs").update({
      status: "FAILED",
      finished_at: new Date().toISOString(),
      error_code: "SYNC_INTERRUPTED",
      error_message: "La ejecución se interrumpió antes de terminar.",
    }).eq("connection_id", connection.id).eq("status", "RUNNING")
      .lt("started_at", new Date(Date.now() - 10 * 60_000).toISOString());
    const { data: syncRun, error: runError } = await admin.from("rappi_sync_runs").insert({
      connection_id: connection.id,
      empresa_id: empresaId,
      sync_type: syncType.toUpperCase(),
      metadata: { environment: env, from: range.from, to: range.to },
    }).select("id").single<{ id: string }>();
    if (runError || !syncRun) throw runError ?? new Error("No se creó sync run");
    syncRunId = syncRun.id;

    const counters: Counters = { read: 0, written: 0, pages: 0, warnings: [] };
    if (["full", "operational", "stores"].includes(syncType)) await syncStores(admin, connection, counters);
    if (["full", "operational", "orders"].includes(syncType)) await syncOrders(admin, connection, counters);
    if (["full", "operational", "menus"].includes(syncType)) await syncMenus(admin, connection, counters);
    if (["full", "financial"].includes(syncType) && financialFeatureEnabled() && connection.financial_enabled) {
      await syncFinancial(admin, connection, range, counters);
    }

    const status = counters.warnings.length ? "PARTIAL" : "SUCCEEDED";
    await admin.from("rappi_sync_runs").update({
      status,
      finished_at: new Date().toISOString(),
      records_read: counters.read,
      records_written: counters.written,
      pages_read: counters.pages,
      metadata: { environment: env, from: range.from, to: range.to, warnings: counters.warnings },
    }).eq("id", syncRunId);
    await admin.from("rappi_connections").update({
      status: status === "SUCCEEDED" ? "CONNECTED" : "DEGRADED",
      last_success_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
    }).eq("id", connection.id);
    return json({ ok: true, data: { sync_run_id: syncRunId, status, ...counters } }, 200, origin);
  } catch (error) {
    // supabase-js entrega sus errores como objetos planos, no como Error: sin
    // leer su `message` el diagnóstico decía "Error desconocido" cuando la
    // causa real era, por ejemplo, un Gateway Timeout transitorio.
    const detail = error instanceof Error ? error.message : text(record(error).message);
    const message = (detail || "Error desconocido").slice(0, 500);
    const errorCode = error instanceof ErrorFuncion
      ? error.codigo
      : /timeout/i.test(message) ? "RAPPI_TIMEOUT" : "SYNC_FAILED";
    if (admin && syncRunId) {
      await admin.from("rappi_sync_runs").update({
        status: "FAILED", finished_at: new Date().toISOString(), error_code: errorCode, error_message: message,
      }).eq("id", syncRunId);
    }
    if (admin && connectionId && effectiveEmpresaId) {
      const now = new Date().toISOString();
      const retryable = ["RAPPI_TIMEOUT", "RAPPI_UNREACHABLE", "RAPPI_RATE_LIMIT"].includes(errorCode);
      await Promise.all([
        admin.from("rappi_connections").update({
          status: "DEGRADED",
          last_error_at: now,
          last_error_code: errorCode,
          last_error_message: message,
        }).eq("id", connectionId),
        admin.from("rappi_integration_errors").insert({
          connection_id: connectionId,
          empresa_id: effectiveEmpresaId,
          source: "SYNC",
          error_class: retryable ? "TRANSIENT" : "INTEGRATION",
          error_code: errorCode,
          public_message: "Una sincronización Rappi no pudo completarse.",
          technical_detail: message,
          retryable,
          metadata: { sync_run_id: syncRunId },
        }),
      ]);
    }
    return responderError(error, origin, LABEL);
  }
});

function dateRange(body: Record<string, unknown>): { from: string; to: string } {
  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 35 * 86_400_000);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(text(body.from)) ? text(body.from) : defaultFrom.toISOString().slice(0, 10);
  const to = /^\d{4}-\d{2}-\d{2}$/.test(text(body.to)) ? text(body.to) : today.toISOString().slice(0, 10);
  if (from > to) throw new ErrorFuncion("INVALID_RANGE", "La fecha inicial no puede superar la final.", 400);
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 370) {
    throw new ErrorFuncion("RANGE_TOO_LARGE", "Sincroniza como máximo 370 días por ejecución.", 400);
  }
  return { from, to };
}

async function syncStores(admin: SupabaseClient, connection: RappiConnection, counters: Counters) {
  const response = await rappiRequest(admin, connection, "OPERATIONAL", "/api/v2/restaurants-integrations-public-api/stores-pa");
  const stores = list(response);
  counters.read += stores.length;
  for (const store of stores) {
    const rappiStoreId = text(store.integrationId ?? store.store_id ?? store.id);
    if (!rappiStoreId) continue;
    await findOrCreateStore(admin, connection, rappiStoreId, store);
    counters.written += 1;
  }
}

async function syncOrders(admin: SupabaseClient, connection: RappiConnection, counters: Counters) {
  const legacyUrl = `${normalizeBaseUrl(connection.orders_base_url)}/api/v2/restaurants-integrations-public-api/orders`;
  const response = await rappiRequest(admin, connection, "OPERATIONAL", legacyUrl);
  const orders = list(response);
  counters.read += orders.length;
  for (const rawOrder of orders) {
    const detail = record(rawOrder.order_detail);
    const store = record(rawOrder.store);
    const rappiOrderId = text(detail.order_id);
    const rappiStoreId = text(store.internal_id ?? store.external_id ?? detail.store_id);
    if (!rappiOrderId) continue;
    const storeRow = await findOrCreateStore(admin, connection, rappiStoreId, store);
    if (!storeRow?.enkrato_empresa_id) {
      counters.warnings.push(`Orden ${rappiOrderId}: tienda ${rappiStoreId || "desconocida"} sin mapeo Enkrato.`);
      continue;
    }
    const totals = record(detail.totals);
    const otherTotals = record(totals.other_totals);
    const nextStatus = normalizeOperationalStatus("NEW_ORDER", detail.status);
    const nextAt = parseDate(detail.updated_at ?? detail.created_at) ?? new Date().toISOString();
    const { data: existing, error: existingError } = await admin.from("rappi_orders")
      .select("operational_status, rappi_status, last_event_at, acceptance_status")
      .eq("connection_id", connection.id)
      .eq("rappi_order_id", rappiOrderId)
      .maybeSingle<{ operational_status: string; rappi_status: string | null; last_event_at: string | null; acceptance_status: string }>();
    if (existingError) throw existingError;
    const applyState = !existing || shouldApplyOrderState(existing.operational_status, existing.last_event_at, nextStatus, nextAt);
    const { error } = await admin.from("rappi_orders").upsert({
      connection_id: connection.id,
      empresa_id: storeRow.enkrato_empresa_id,
      store_id: storeRow.id,
      rappi_order_id: rappiOrderId,
      order_kind: text(detail.delivery_operation_type).toUpperCase() || "REGULAR",
      is_scheduled: Boolean(detail.place_at),
      scheduled_for: parseDate(detail.place_at),
      rappi_status: applyState ? (text(detail.status) || "SENT") : existing?.rappi_status,
      operational_status: applyState ? nextStatus : existing?.operational_status,
      delivery_operation_type: text(detail.delivery_operation_type) || null,
      delivery_method: text(detail.delivery_method) || null,
      payment_method: text(detail.payment_method) || null,
      total_products: numberOrNull(totals.total_products),
      total_discounts: numberOrNull(totals.total_discounts),
      total_order: numberOrNull(totals.total_order),
      total_to_pay: numberOrNull(totals.total_to_pay),
      tip_amount: numberOrNull(otherTotals.tip),
      items: Array.isArray(detail.items) ? detail.items.map(sanitizeItem) : [],
      totals: sanitizeMoneyObject(totals),
      delivery_summary: {
        method: text(detail.delivery_method) || null,
        operation_type: text(detail.delivery_operation_type) || null,
        cooking_time: numberOrNull(detail.cooking_time),
      },
      provider_created_at: parseDate(detail.created_at),
      last_event_at: applyState ? nextAt : existing?.last_event_at,
      // Una orden que entra por aquí también espera aceptación; el barrido
      // del worker la toma mientras la ventana de 6 minutos siga abierta.
      acceptance_status: existing?.acceptance_status ?? (storeRow.auto_accept === false ? "MANUAL" : "PENDING"),
    }, { onConflict: "connection_id,rappi_order_id" });
    if (error) throw error;
    counters.written += 1;
  }
}

async function syncMenus(admin: SupabaseClient, connection: RappiConnection, counters: Counters) {
  const { data: stores, error } = await admin.from("rappi_stores")
    .select("id, rappi_store_id, enkrato_empresa_id")
    .eq("connection_id", connection.id).eq("active", true);
  if (error) throw error;
  for (const store of stores ?? []) {
    try {
      const response = await rappiRequest(
        admin,
        connection,
        "OPERATIONAL",
        `${normalizeBaseUrl(connection.orders_base_url)}/api/v2/restaurants-integrations-public-api/menu/rappi/${encodeURIComponent(store.rappi_store_id)}`,
      );
      const menuRecord = Array.isArray(response) && response.length === 1 ? response[0] : response;
      const serialized = JSON.stringify(menuRecord ?? {});
      const products = Array.isArray(record(menuRecord).items) ? record(menuRecord).items as unknown[] : [];
      const { error: saveError } = await admin.from("rappi_menu_versions").upsert({
        store_id: store.id,
        empresa_id: store.enkrato_empresa_id ?? connection.empresa_id,
        content_hash: await sha256Hex(serialized),
        item_count: products.length,
        menu_data: menuRecord ?? {},
        source: "SYNC",
      }, { onConflict: "store_id,content_hash" });
      if (saveError) throw saveError;
      await admin.from("rappi_stores").update({ menu_updated_at: new Date().toISOString() }).eq("id", store.id);
      counters.read += products.length;
      counters.written += 1;
    } catch (error) {
      counters.warnings.push(`Menú ${store.rappi_store_id}: ${error instanceof Error ? error.message : "error"}`);
    }
  }
}

async function syncFinancial(
  admin: SupabaseClient,
  connection: RappiConnection,
  range: { from: string; to: string },
  counters: Counters,
) {
  const discovered = record(await rappiRequest(admin, connection, "FINANCIAL", "/restaurants/finance/v2/stores"));
  const storeIds = Array.isArray(discovered.stores) ? discovered.stores.map(financialStoreId).filter(Boolean) : [];
  for (const rappiStoreId of storeIds) {
    const storeRow = await findOrCreateStore(admin, connection, rappiStoreId, {});
    if (!storeRow) continue;
    const payments = await paginatedFinancial(admin, connection, rappiStoreId, "payments", range, counters);
    for (const payment of payments) await savePayment(admin, connection, storeRow, payment, counters);
    for (const kind of FINANCIAL_KINDS) {
      const entries = await paginatedFinancial(admin, connection, rappiStoreId, kind, range, counters);
      for (const entry of entries) await saveFinancialEntry(admin, connection, storeRow, kind, entry, counters);
    }
  }
}

function financialStoreId(value: unknown): string {
  const row = record(value);
  const fallback = typeof value === "string" || typeof value === "number" ? value : "";
  return text(row.store_id ?? row.storeId ?? row.id ?? fallback);
}

async function paginatedFinancial(
  admin: SupabaseClient,
  connection: RappiConnection,
  storeId: string,
  kind: string,
  range: { from: string; to: string },
  counters: Counters,
): Promise<Record<string, unknown>[]> {
  const dateField = kind === "payments" ? "confirmed_payment_date"
    : ["orders", "order_adjustments", "charged_cancellations"].includes(kind) ? "order_date"
    : kind === "cancellations" ? "cancellation_date"
    : "created_at";
  const all: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const query = new URLSearchParams({
      [`${dateField}:gte`]: range.from,
      [`${dateField}:lte`]: range.to,
      page_number: String(page),
      page_size: "100",
    });
    const response = record(await rappiRequest(
      admin,
      connection,
      "FINANCIAL",
      `/restaurants/finance/v2/stores/${encodeURIComponent(storeId)}/${kind}?${query.toString()}`,
    ));
    const entries = Array.isArray(response.entries) ? (response.entries as unknown[]).map(record) : [];
    all.push(...entries);
    counters.pages += 1;
    counters.read += entries.length;
    const totalPages = Math.max(0, Number(response.total_pages ?? 0));
    if (page >= totalPages || entries.length === 0) break;
  }
  return all;
}

async function savePayment(
  admin: SupabaseClient,
  connection: RappiConnection,
  store: { id: string; enkrato_empresa_id: string | null },
  payment: Record<string, unknown>,
  counters: Counters,
) {
  const paymentId = text(payment.payment_id);
  if (!paymentId) return;
  const { error } = await admin.from("rappi_financial_payments").upsert({
    connection_id: connection.id,
    empresa_id: store.enkrato_empresa_id ?? connection.empresa_id,
    store_id: store.id,
    rappi_payment_id: paymentId,
    status: text(payment.status) || null,
    period_start_date: parseDate(payment.period_start_date),
    period_end_date: parseDate(payment.period_end_date),
    expected_execution_date: parseDate(payment.expected_execution_date),
    confirmed_payment_date: parseDate(payment.confirmed_payment_date),
    total_amount: numberOrNull(payment.total_amount),
    payment_reference: text(payment.payment_reference) || null,
    frequency_type: text(payment.frequency_type) || null,
    stores_consolidated: Array.isArray(payment.stores_consolidated) ? payment.stores_consolidated : [],
    raw_data: redactPayment(payment),
    synced_at: new Date().toISOString(),
  }, { onConflict: "connection_id,rappi_payment_id,store_id" });
  if (error) throw error;
  counters.written += 1;
}

async function saveFinancialEntry(
  admin: SupabaseClient,
  connection: RappiConnection,
  store: { id: string; enkrato_empresa_id: string | null },
  kind: string,
  entry: Record<string, unknown>,
  counters: Counters,
) {
  const rappiOrderId = text(entry.order_id);
  const rappiPaymentId = text(entry.payment_id);
  const order = rappiOrderId
    ? (await admin.from("rappi_orders").select("id, total_order, operational_status, payment_method, provider_created_at")
      .eq("connection_id", connection.id).eq("rappi_order_id", rappiOrderId).maybeSingle()).data
    : null;
  const payment = rappiPaymentId
    ? (await admin.from("rappi_financial_payments").select("id")
      .eq("connection_id", connection.id).eq("rappi_payment_id", rappiPaymentId).eq("store_id", store.id).maybeSingle()).data
    : null;
  const billing = sanitizeMoneyObject(entry.billing);
  const amount = numberOrNull(entry.amount ?? billing.total_order ?? entry.total_amount);
  const recordKey = await financialRecordKey(kind, entry);
  const { error } = await admin.from("rappi_financial_entries").upsert({
    connection_id: connection.id,
    empresa_id: store.enkrato_empresa_id ?? connection.empresa_id,
    store_id: store.id,
    payment_id: payment?.id ?? null,
    order_id: order?.id ?? null,
    entry_kind: kind.toUpperCase(),
    record_key: recordKey,
    rappi_order_id: rappiOrderId || null,
    rappi_payment_id: rappiPaymentId || null,
    amount,
    occurred_at: parseDate(entry.order_date ?? entry.cancellation_date ?? entry.created_at),
    billing,
    raw_data: sanitizeFinancialRecord(entry),
    synced_at: new Date().toISOString(),
  }, { onConflict: "connection_id,store_id,entry_kind,record_key" });
  if (error) throw error;
  counters.written += 1;

  if (kind === "orders" && order?.id) {
    await admin.from("rappi_orders").update({
      financial_status: rappiPaymentId ? "SETTLED" : "PENDING",
      reconciliation_status: "PENDING",
    }).eq("id", order.id);
    const ageHours = order.provider_created_at
      ? Math.max(0, (Date.now() - Date.parse(order.provider_created_at)) / 3_600_000)
      : 0;
    const reconciliation = evaluateReconciliation({
      operationalStatus: order.operational_status,
      operationalAmount: numberOrNull(order.total_order),
      financialAmount: numberOrNull(billing.total_order ?? amount),
      accountingAmount: null,
      paymentId: rappiPaymentId || null,
      operationalPaymentMethod: order.payment_method,
      ageHours,
      tolerance: 1,
    });
    await admin.from("rappi_reconciliation_records").upsert({
      empresa_id: store.enkrato_empresa_id ?? connection.empresa_id,
      order_id: order.id,
      payment_id: payment?.id ?? null,
      operational_amount: numberOrNull(order.total_order),
      financial_amount: numberOrNull(billing.total_order ?? amount),
      difference_amount: reconciliation.differenceAmount,
      severity: reconciliation.severity,
      status: reconciliation.status,
      rule_codes: reconciliation.ruleCodes,
      evidence: { financial_entry_kind: "ORDERS", record_key: recordKey },
      evaluated_at: new Date().toISOString(),
    }, { onConflict: "order_id" });
    await admin.from("rappi_orders").update({
      reconciliation_status: reconciliation.status,
      incident_severity: reconciliation.severity === "INFO" ? null : reconciliation.severity,
      incident_code: reconciliation.ruleCodes[0] ?? null,
    }).eq("id", order.id);
  }
}

async function financialRecordKey(kind: string, entry: Record<string, unknown>): Promise<string> {
  const explicit = text(entry.id ?? entry.adjustment_id ?? entry.extra_id ?? entry.debt_id ?? entry.loan_id);
  if (explicit) return `${kind}:${explicit}`;
  const identity = [entry.order_id, entry.payment_id, entry.store_id, entry.created_at, entry.order_date, entry.amount]
    .map(text).join("|");
  return `${kind}:${identity}:${await sha256Hex(JSON.stringify(entry))}`;
}

async function findOrCreateStore(
  admin: SupabaseClient,
  connection: RappiConnection,
  rappiStoreId: string,
  source: Record<string, unknown>,
): Promise<{ id: string; enkrato_empresa_id: string | null; auto_accept: boolean } | null> {
  if (!rappiStoreId) return null;
  const { data: existing, error: findError } = await admin.from("rappi_stores")
    .select("id, enkrato_empresa_id, auto_accept")
    .eq("connection_id", connection.id).eq("rappi_store_id", rappiStoreId).maybeSingle();
  if (findError) throw findError;
  if (existing) {
    const { error: updateError } = await admin.from("rappi_stores").update({
      integration_store_id: text(source.external_id ?? source.integrationId) || rappiStoreId,
      ...(text(source.name) ? { store_name: text(source.name) } : {}),
      active: true,
    }).eq("id", existing.id);
    if (updateError) throw updateError;
    return existing;
  }
  const { data, error } = await admin.from("rappi_stores").insert({
    connection_id: connection.id,
    empresa_id: connection.empresa_id,
    enkrato_empresa_id: null,
    rappi_store_id: rappiStoreId,
    integration_store_id: text(source.external_id ?? source.integrationId) || rappiStoreId,
    store_name: text(source.name) || null,
    active: true,
  }).select("id, enkrato_empresa_id, auto_accept").single();
  if (error) throw error;
  return data;
}

function redactPayment(payment: Record<string, unknown>): Record<string, unknown> {
  return sanitizeFinancialRecord(payment) as Record<string, unknown>;
}

function list(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record);
  const object = record(value);
  for (const key of ["data", "results", "items", "entries"]) {
    if (Array.isArray(object[key])) return (object[key] as unknown[]).map(record);
  }
  return Object.keys(object).length ? [object] : [];
}

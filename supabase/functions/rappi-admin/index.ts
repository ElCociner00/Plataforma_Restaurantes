import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders, json } from "../_shared/cors.ts";
import { decryptText, encryptText } from "../_shared/crypto.ts";
import {
  errores,
  ErrorFuncion,
  leerCuerpo,
  responderError,
} from "../_shared/errores.ts";
import {
  type Contexto,
  exigirAdmin,
  resolverContexto,
} from "../_shared/tenant.ts";
import {
  clearRappiTokenCache,
  getRappiToken,
  normalizeBaseUrl,
  rappiRequest,
} from "../_shared/rappi/client.ts";
import {
  effectiveMenuApprovalStatus,
  isRappiTesterSample,
  record,
  text,
} from "../_shared/rappi/payload.ts";
import { validateRappiMenuItems } from "../_shared/rappi/menu.ts";
import {
  isRappiEventV1,
  RAPPI_EVENTS_V1,
  type RappiConnection,
  type RappiScope,
} from "../_shared/rappi/types.ts";
import {
  remoteWebhookConfigured,
  remoteWebhookMatches,
  remoteWebhookStoreIds,
} from "../_shared/rappi/webhooks.ts";
import {
  hmacSha256Hex,
  validateRappiSignature,
} from "../_shared/rappi/crypto.ts";

const LABEL = "rappi-admin";
const WEBHOOK_PATH = "/api/v2/restaurants-integrations-public-api/webhook";

function financialFeatureEnabled(): boolean {
  return (Deno.env.get("RAPPI_FINANCIAL_FEATURE_ENABLED") ?? "")
    .toLowerCase() === "true";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
  }

  try {
    const body = await leerCuerpo(req);
    const ctx = await resolverContexto(req, text(body.empresa_id) || null);
    exigirAdmin(ctx, "administrar la integración Rappi");
    const action = text(body.action).toLowerCase();
    let result: unknown;

    switch (action) {
      case "status":
        result = await status(ctx, body);
        break;
      case "save_credentials":
        result = await saveCredentials(ctx, body);
        break;
      case "onboard":
        result = await onboard(ctx, body);
        break;
      case "upload_menu":
        result = await uploadMenu(ctx, body);
        break;
      case "test_operational":
        result = await testOperational(ctx, body);
        break;
      case "test_financial":
        result = await testFinancial(ctx, body);
        break;
      case "map_store":
        result = await mapStore(ctx, body);
        break;
      case "store_settings":
        result = await storeSettings(ctx, body);
        break;
      case "remote_webhooks":
        result = await remoteWebhooks(ctx, body);
        break;
      case "subscribe_webhooks":
        result = await subscribeWebhooks(ctx, body);
        break;
      case "diagnose_signature":
        result = await diagnoseSignature(ctx, body);
        break;
      case "test_webhooks":
        result = await testWebhooks(ctx, body);
        break;
      case "cleanup_dev_test_data":
        result = await cleanupDevTestData(ctx, body);
        break;
      default:
        throw new ErrorFuncion(
          "UNKNOWN_ACTION",
          "La acción solicitada no existe.",
          400,
        );
    }
    return json({ ok: true, data: result }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

function masterKey(): string {
  const key = Deno.env.get("MASTER_ENCRYPTION_KEY") ??
    Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 16) {
    throw errores.configuracion("MASTER_ENCRYPTION_KEY");
  }
  return key;
}

/**
 * Elimina exclusivamente artefactos reconocibles de los probadores DEV.
 * No acepta IDs arbitrarios y no está disponible para conexiones PROD.
 */
async function cleanupDevTestData(
  ctx: Contexto,
  body: Record<string, unknown>,
) {
  if (environment(body) !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_CLEANUP_DEV_ONLY",
      "La limpieza de muestras solo está disponible en DEV.",
      409,
    );
  }
  if (body.confirm !== true) {
    throw new ErrorFuncion(
      "CONFIRM_REQUIRED",
      "Confirma la limpieza controlada de muestras Rappi DEV.",
      400,
    );
  }

  const connection = await getConnection(ctx, body) as RappiConnection;
  const admin = ctx.clienteAdmin();
  const { data: orders, error: ordersError } = await admin.from("rappi_orders")
    .select("id, rappi_order_id")
    .eq("connection_id", connection.id)
    .or("rappi_order_id.like.ENKRATO-DEV-%,rappi_order_id.like.SAMPLE-%");
  if (ordersError) throw errores.baseDeDatos(ordersError.message);
  const orderIds = (orders ?? []).map((order) => text(order.id)).filter(
    Boolean,
  );

  const removed: Record<string, number> = {};
  const removeByOrder = async (table: string) => {
    if (!orderIds.length) {
      removed[table] = 0;
      return;
    }
    const result = await admin.from(table).delete().in("order_id", orderIds)
      .select("id");
    if (result.error) throw errores.baseDeDatos(result.error.message);
    removed[table] = (result.data ?? []).length;
  };

  await removeByOrder("rappi_reconciliation_records");
  await removeByOrder("rappi_accounting_attempts");
  await removeByOrder("rappi_financial_entries");
  await removeByOrder("rappi_order_tracking");
  await removeByOrder("rappi_order_events");
  if (orderIds.length) {
    const deletedOrders = await admin.from("rappi_orders").delete()
      .eq("connection_id", connection.id).in("id", orderIds).select("id");
    if (deletedOrders.error) {
      throw errores.baseDeDatos(deletedOrders.error.message);
    }
    removed.rappi_orders = (deletedOrders.data ?? []).length;
  } else {
    removed.rappi_orders = 0;
  }

  const { data: rawEvents, error: rawEventsError } = await admin.from(
    "rappi_webhook_events",
  ).select("id, raw_payload").eq("connection_id", connection.id).limit(2000);
  if (rawEventsError) throw errores.baseDeDatos(rawEventsError.message);
  const rawEventIds = (rawEvents ?? []).filter((event) => {
    const payload = record(event.raw_payload);
    const orderId = text(
      payload.order_id ?? record(payload.order_detail).order_id,
    );
    return isRappiTesterSample(payload) || /^ENKRATO-DEV-/i.test(orderId) ||
      text(payload.message).startsWith("Enkrato DEV signed connectivity test");
  }).map((event) => text(event.id)).filter(Boolean);

  const removeByRawEvent = async (table: string) => {
    if (!rawEventIds.length) {
      removed[table] = 0;
      return;
    }
    const result = await admin.from(table).delete().in(
      "raw_event_id",
      rawEventIds,
    ).select("id");
    if (result.error) throw errores.baseDeDatos(result.error.message);
    removed[table] = (result.data ?? []).length;
  };
  await removeByRawEvent("rappi_order_tracking");
  await removeByRawEvent("rappi_order_events");
  await removeByRawEvent("rappi_store_connectivity_events");
  await removeByRawEvent("rappi_webhook_jobs");
  if (rawEventIds.length) {
    const deletedEvents = await admin.from("rappi_webhook_events").delete()
      .eq("connection_id", connection.id).in("id", rawEventIds).select("id");
    if (deletedEvents.error) {
      throw errores.baseDeDatos(deletedEvents.error.message);
    }
    removed.rappi_webhook_events = (deletedEvents.data ?? []).length;
  } else {
    removed.rappi_webhook_events = 0;
  }

  const [
    { data: stores, error: storesError },
    { data: menuEvents, error: menuError },
  ] = await Promise.all([
    admin.from("rappi_stores").select("id, rappi_store_id")
      .eq("connection_id", connection.id),
    admin.from("rappi_webhook_events").select(
      "event_type, raw_payload, received_at",
    ).eq("connection_id", connection.id).eq("signature_valid", true)
      .in("event_type", ["MENU_APPROVED", "MENU_REJECTED"])
      .order("received_at", { ascending: false }).limit(100),
  ]);
  if (storesError || menuError) {
    throw errores.baseDeDatos(storesError?.message ?? menuError?.message);
  }
  let storesReset = 0;
  for (const store of stores ?? []) {
    const status = effectiveMenuApprovalStatus(
      store.rappi_store_id,
      null,
      menuEvents ?? [],
    );
    const relevantEvent = (menuEvents ?? []).find((event) => {
      const payload = record(event.raw_payload);
      return text(payload.store_id ?? payload.external_store_id) ===
          text(store.rappi_store_id) && !isRappiTesterSample(payload);
    });
    const updated = await admin.from("rappi_stores").update({
      menu_approval_status: status,
      menu_updated_at: relevantEvent?.received_at ?? null,
    }).eq("id", store.id).eq("connection_id", connection.id);
    if (updated.error) throw errores.baseDeDatos(updated.error.message);
    storesReset += 1;
  }

  return {
    removed,
    removed_rows: Object.values(removed).reduce((sum, count) => sum + count, 0),
    test_orders_found: orderIds.length,
    test_raw_events_found: rawEventIds.length,
    stores_reset: storesReset,
  };
}

function environment(body: Record<string, unknown>): "DEV" | "PROD" {
  return text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
}

async function getConnection(
  ctx: Contexto,
  body: Record<string, unknown>,
  required = true,
): Promise<RappiConnection | null> {
  const { data, error } = await ctx.clienteAdmin().from("rappi_connections")
    .select(
      "id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled",
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("environment", environment(body))
    .maybeSingle<RappiConnection>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data && required) {
    throw new ErrorFuncion(
      "RAPPI_NOT_CONFIGURED",
      "Configura primero las credenciales de Rappi.",
      412,
    );
  }
  return data;
}

async function status(ctx: Contexto, body: Record<string, unknown>) {
  const admin = ctx.clienteAdmin();
  const connection = await getConnection(ctx, body, false);
  if (!connection) {
    return {
      configured: false,
      environment: environment(body),
      allowed_events: RAPPI_EVENTS_V1,
    };
  }

  const [secrets, tokens, stores, webhooks, syncRuns, errors, menuEvents] = await Promise
    .all([
      admin.from("rappi_connection_secrets").select("scope").eq(
        "connection_id",
        connection.id,
      ),
      admin.from("rappi_tokens").select("scope, expires_at").eq(
        "connection_id",
        connection.id,
      ),
      admin.from("rappi_stores").select(
        "id, rappi_store_id, integration_store_id, store_name, store_type, enkrato_empresa_id, connectivity_status, last_ping_at, last_ping_ok, menu_approval_status, menu_updated_at, active, auto_accept",
      )
        .eq("connection_id", connection.id).order("store_name"),
      admin.from("rappi_webhook_configs").select(
        "id, endpoint_key, event_type, state, remote_url, subscribed_store_ids, last_received_at, last_valid_signature_at, last_error_at, last_error_code",
      )
        .eq("connection_id", connection.id).order("event_type"),
      admin.from("rappi_sync_runs").select(
        "id, sync_type, status, started_at, finished_at, records_read, records_written, pages_read, error_code, error_message, metadata",
      )
        .eq("connection_id", connection.id).order("started_at", {
          ascending: false,
        }).limit(20),
      admin.from("rappi_integration_errors").select(
        "id, source, error_class, error_code, public_message, retryable, status, occurrence_count, last_occurred_at",
      )
        .eq("connection_id", connection.id).neq("status", "RESOLVED").order(
          "last_occurred_at",
          { ascending: false },
        ).limit(20),
      admin.from("rappi_webhook_events").select(
        "event_type, raw_payload, received_at",
      )
        .eq("connection_id", connection.id)
        .eq("signature_valid", true)
        .in("event_type", ["MENU_APPROVED", "MENU_REJECTED"])
        .order("received_at", { ascending: false })
        .limit(100),
    ]);
  const scopes = new Set(
    (secrets.data ?? []).map((row: { scope: string }) => row.scope),
  );
  return {
    configured: true,
    connection,
    credentials: {
      operational: scopes.has("OPERATIONAL"),
      financial: scopes.has("FINANCIAL"),
    },
    tokens: (tokens.data ?? []).map((
      token: { scope: string; expires_at: string },
    ) => ({
      scope: token.scope,
      expires_at: token.expires_at,
      valid: Date.parse(token.expires_at) > Date.now(),
    })),
    stores: (stores.data ?? []).map((store) => ({
      ...store,
      menu_approval_status: effectiveMenuApprovalStatus(
        store.rappi_store_id,
        store.menu_approval_status,
        menuEvents.data ?? [],
      ),
    })),
    webhooks: webhooks.data ?? [],
    sync_runs: syncRuns.data ?? [],
    errors: errors.data ?? [],
    allowed_events: RAPPI_EVENTS_V1,
    financial_feature_enabled: financialFeatureEnabled(),
  };
}

async function saveCredentials(ctx: Contexto, body: Record<string, unknown>) {
  const admin = ctx.clienteAdmin();
  const env = environment(body);
  if (env !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_PROD_BLOCKED",
      "Rappi Producción aún no está disponible para esta integración.",
      409,
    );
  }
  // Los endpoints son configuración del conector, nunca datos elegidos por el cliente.
  const operationalBase = normalizeBaseUrl("https://api.dev.rappi.com");
  const ordersBase = normalizeBaseUrl("https://microservices.dev.rappi.com");
  const financialBase = financialFeatureEnabled()
    ? normalizeBaseUrl(text(body.financial_base_url) || operationalBase)
    : operationalBase;
  const hasFinancialInput = Boolean(
    text(body.financial_client_id) || text(body.financial_client_secret),
  );
  if (hasFinancialInput && !financialFeatureEnabled()) {
    throw new ErrorFuncion(
      "RAPPI_FINANCIAL_STANDBY",
      "Rappi Financial permanece en standby.",
      409,
    );
  }
  const hasFinancialCredentials = Boolean(
    text(body.financial_client_id) && text(body.financial_client_secret),
  );
  const { data: connection, error } = await admin.from("rappi_connections")
    .upsert({
      empresa_id: ctx.empresaId,
      environment: env,
      operational_base_url: operationalBase,
      orders_base_url: ordersBase,
      financial_base_url: financialBase,
      operational_enabled: true,
      ...(hasFinancialCredentials ? { financial_enabled: true } : {}),
      ...(!financialFeatureEnabled() ? { financial_enabled: false } : {}),
      status: "CONFIGURED",
      created_by: ctx.authUserId,
    }, { onConflict: "empresa_id,environment" }).select(
      "id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled",
    )
    .single<RappiConnection>();
  if (error || !connection) throw errores.baseDeDatos(error?.message);

  await saveScope(
    admin,
    connection.id,
    "OPERATIONAL",
    body.client_id,
    body.client_secret,
    ctx.authUserId,
  );
  const financialId = text(body.financial_client_id);
  const financialSecret = text(body.financial_client_secret);
  if (financialId || financialSecret) {
    await saveScope(
      admin,
      connection.id,
      "FINANCIAL",
      financialId,
      financialSecret,
      ctx.authUserId,
    );
  }
  clearRappiTokenCache(connection.id);
  return {
    saved: true,
    connection_id: connection.id,
    environment: connection.environment,
  };
}

async function onboard(ctx: Contexto, body: Record<string, unknown>) {
  if (environment(body) !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_PROD_BLOCKED",
      "Rappi Producción aún no está disponible para esta integración.",
      409,
    );
  }
  const onboardingBody = { ...body, environment: "DEV" };
  const saved = await saveCredentials(ctx, onboardingBody);
  const validation = await testOperational(ctx, onboardingBody);
  const subscription = await subscribeWebhooks(ctx, {
    ...onboardingBody,
    events: [...RAPPI_EVENTS_V1],
    confirm: true,
  });
  const automation = await configureAutomation(ctx, "DEV");
  const initialSync = await runInitialSync(ctx, "DEV");
  const current = await status(ctx, onboardingBody);
  return {
    saved,
    validation,
    subscription,
    automation,
    initial_sync: initialSync,
    status: current,
  };
}

async function configureAutomation(
  ctx: Contexto,
  env: "DEV",
): Promise<unknown> {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  if (cronSecret.length < 24 || !supabaseUrl) {
    throw errores.configuracion("automatización Rappi");
  }
  const { data, error } = await ctx.clienteAdmin().rpc(
    "programar_tareas_rappi_v1",
    {
      p_empresa_id: ctx.empresaId,
      p_secret: cronSecret,
      p_environment: env,
      p_base_url: `${supabaseUrl}/functions/v1`,
    },
  );
  if (error) throw errores.baseDeDatos(error.message);
  return data;
}

async function runInitialSync(
  ctx: Contexto,
  env: "DEV",
): Promise<Record<string, unknown>> {
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/rappi-sync`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({
        empresa_id: ctx.empresaId,
        environment: env,
        sync_type: "operational",
      }),
      signal: AbortSignal.timeout(55_000),
    });
    const payload = record(await response.json().catch(() => ({})));
    return { ok: response.ok && payload.ok === true, status: response.status };
  } catch (error) {
    console.warn(
      `[${LABEL}] sincronización inicial pendiente:`,
      error instanceof Error ? error.message : error,
    );
    return { ok: false, status: 0 };
  }
}

async function uploadMenu(ctx: Contexto, body: Record<string, unknown>) {
  if (environment(body) !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_PROD_BLOCKED",
      "La carga de menú solo está disponible en el entorno de pruebas.",
      409,
    );
  }
  const connection = await getConnection(ctx, body) as RappiConnection;
  const storeId = text(body.store_id);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!storeId || !items.length) {
    throw errores.datosIncompletos("tienda y productos del menú");
  }
  const serialized = JSON.stringify(items);
  if (serialized.length > 2_000_000) {
    throw new ErrorFuncion(
      "RAPPI_MENU_TOO_LARGE",
      "El menú no puede superar 2 MB.",
      413,
    );
  }
  validateRappiMenuItems(items);
  const admin = ctx.clienteAdmin();
  const { data: store, error } = await admin.from("rappi_stores")
    .select("id, rappi_store_id, enkrato_empresa_id")
    .eq("id", storeId)
    .eq("connection_id", connection.id)
    .eq("active", true)
    .maybeSingle<
      { id: string; rappi_store_id: string; enkrato_empresa_id: string | null }
    >();
  if (error) throw errores.baseDeDatos(error.message);
  if (!store) {
    throw new ErrorFuncion(
      "RAPPI_STORE_NOT_FOUND",
      "La tienda seleccionada no pertenece a esta conexión.",
      404,
    );
  }
  const menuUrl = `${
    normalizeBaseUrl(connection.orders_base_url)
  }/api/v2/restaurants-integrations-public-api/menu`;
  await rappiRequest(admin, connection, "OPERATIONAL", menuUrl, {
    method: "POST",
    body: JSON.stringify({ storeId: store.rappi_store_id, items }),
  });
  const now = new Date().toISOString();
  const hash = await sha256Hex(
    JSON.stringify({ storeId: store.rappi_store_id, items }),
  );
  const { error: saveError } = await admin.from("rappi_menu_versions").upsert({
    store_id: store.id,
    empresa_id: store.enkrato_empresa_id ?? ctx.empresaId,
    content_hash: hash,
    approval_status: "PENDING",
    item_count: items.length,
    menu_data: { storeId: store.rappi_store_id, items },
    source: "UPLOAD_DEV",
    received_at: now,
  }, { onConflict: "store_id,content_hash" });
  if (saveError) throw errores.baseDeDatos(saveError.message);
  await admin.from("rappi_stores").update({
    menu_approval_status: "PENDING",
    menu_updated_at: now,
  }).eq("id", store.id);
  return {
    sent: true,
    store_id: store.id,
    items: items.length,
    approval_status: "PENDING",
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function saveScope(
  admin: SupabaseClient,
  connectionId: string,
  scope: RappiScope,
  clientIdValue: unknown,
  clientSecretValue: unknown,
  userId: string,
) {
  const clientId = text(clientIdValue);
  const clientSecret = text(clientSecretValue);
  if (!clientId && !clientSecret) return;
  if (!clientId || !clientSecret) {
    throw errores.datosIncompletos(`${scope}: client_id y client_secret`);
  }
  const { error } = await admin.from("rappi_connection_secrets").upsert({
    connection_id: connectionId,
    scope,
    client_id_ciphertext: await encryptText(clientId, masterKey()),
    client_secret_ciphertext: await encryptText(clientSecret, masterKey()),
    updated_by: userId,
  }, { onConflict: "connection_id,scope" });
  if (error) throw errores.baseDeDatos(error.message);
}

async function testOperational(ctx: Contexto, body: Record<string, unknown>) {
  const admin = ctx.clienteAdmin();
  const connection = await getConnection(ctx, body) as RappiConnection;
  const token = await getRappiToken(admin, connection, "OPERATIONAL", true);
  const rawStores = await rappiRequest(
    admin,
    connection,
    "OPERATIONAL",
    "/api/v2/restaurants-integrations-public-api/stores-pa",
  );
  const stores = asList(rawStores);
  for (const row of stores) {
    const rappiStoreId = text(row.integrationId ?? row.store_id ?? row.id);
    if (!rappiStoreId) continue;
    const { data: existing } = await admin.from("rappi_stores").select(
      "id, enkrato_empresa_id",
    )
      .eq("connection_id", connection.id).eq("rappi_store_id", rappiStoreId)
      .maybeSingle();
    const payload = {
      integration_store_id: text(row.integrationId) || rappiStoreId,
      store_name: text(row.name) || null,
      active: true,
      // La conexión ya está aislada por empresa. Una tienda nueva pertenece por
      // defecto a ese tenant; una asignación manual posterior nunca se pisa.
      ...(!existing?.enkrato_empresa_id
        ? { enkrato_empresa_id: ctx.empresaId }
        : {}),
    };
    const { error } = existing
      ? await admin.from("rappi_stores").update(payload).eq("id", existing.id)
      : await admin.from("rappi_stores").insert({
        ...payload,
        connection_id: connection.id,
        empresa_id: ctx.empresaId,
        rappi_store_id: rappiStoreId,
      });
    if (error) throw errores.baseDeDatos(error.message);
  }
  const now = new Date().toISOString();
  await admin.from("rappi_connections").update({
    status: "CONNECTED",
    last_auth_ok_at: now,
    last_success_at: now,
    last_error_code: null,
    last_error_message: null,
  }).eq("id", connection.id);
  return {
    auth_ok: true,
    token_expires_at: new Date(token.expiresAt).toISOString(),
    stores_discovered: stores.length,
  };
}

async function testFinancial(ctx: Contexto, body: Record<string, unknown>) {
  if (!financialFeatureEnabled()) {
    throw new ErrorFuncion(
      "RAPPI_FINANCIAL_STANDBY",
      "Rappi Financial permanece en standby.",
      409,
    );
  }
  const admin = ctx.clienteAdmin();
  const connection = await getConnection(ctx, body) as RappiConnection;
  const token = await getRappiToken(admin, connection, "FINANCIAL", true);
  const response = record(
    await rappiRequest(
      admin,
      connection,
      "FINANCIAL",
      "/restaurants/finance/v2/stores",
    ),
  );
  const stores = Array.isArray(response.stores)
    ? response.stores.map(financialStoreId).filter(Boolean)
    : [];
  const now = new Date().toISOString();
  await admin.from("rappi_connections").update({
    financial_enabled: true,
    last_financial_auth_ok_at: now,
    last_success_at: now,
  }).eq("id", connection.id);
  return {
    auth_ok: true,
    token_expires_at: new Date(token.expiresAt).toISOString(),
    financial_store_ids: stores,
  };
}

function financialStoreId(value: unknown): string {
  const row = record(value);
  const fallback = typeof value === "string" || typeof value === "number"
    ? value
    : "";
  return text(row.store_id ?? row.storeId ?? row.id ?? fallback);
}

async function mapStore(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = text(body.store_id);
  const target = text(body.enkrato_empresa_id);
  if (!storeId || !target) {
    throw errores.datosIncompletos("store_id, enkrato_empresa_id");
  }
  if (!ctx.esSuperadmin && !ctx.empresasVisibles.includes(target)) {
    throw errores.fueraDeAlcance();
  }
  const connection = await getConnection(ctx, body) as RappiConnection;
  const { data, error } = await ctx.clienteAdmin().from("rappi_stores").update({
    enkrato_empresa_id: target,
  })
    .eq("id", storeId).eq("connection_id", connection.id).select("id")
    .maybeSingle();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data) {
    throw new ErrorFuncion(
      "STORE_NOT_FOUND",
      "La tienda no pertenece a esta conexión.",
      404,
    );
  }
  const { data: failedEvents } = await ctx.clienteAdmin().from(
    "rappi_webhook_events",
  )
    .select("id")
    .eq("connection_id", connection.id)
    .eq("processing_status", "FAILED")
    .ilike("error_message", "STORE_NOT_MAPPED:%")
    .limit(500);
  const eventIds = (failedEvents ?? []).map((row: { id: string }) => row.id);
  if (eventIds.length) {
    await Promise.all([
      ctx.clienteAdmin().from("rappi_webhook_events").update({
        processing_status: "RECEIVED",
        error_code: null,
        error_message: null,
      }).in("id", eventIds),
      ctx.clienteAdmin().from("rappi_webhook_jobs").update({
        status: "RETRY",
        attempts: 0,
        available_at: new Date().toISOString(),
        claimed_at: null,
        claimed_by: null,
        finished_at: null,
        last_error: null,
      }).in("raw_event_id", eventIds),
    ]);
  }
  return { mapped: true, requeued_events: eventIds.length };
}

/**
 * Aceptación automática por tienda. Encendida, Enkrato toma cada pedido
 * apenas llega; apagada, la tienda debe aceptarlo por otro medio (tablet de
 * Rappi) dentro de los 6 minutos o Rappi lo vence.
 */
async function storeSettings(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = text(body.store_id);
  if (!storeId || typeof body.auto_accept !== "boolean") {
    throw errores.datosIncompletos("store_id, auto_accept");
  }
  const connection = await getConnection(ctx, body) as RappiConnection;
  const { data, error } = await ctx.clienteAdmin().from("rappi_stores")
    .update({ auto_accept: body.auto_accept })
    .eq("id", storeId).eq("connection_id", connection.id)
    .select("id, auto_accept").maybeSingle();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data) {
    throw new ErrorFuncion("STORE_NOT_FOUND", "La tienda no pertenece a esta conexión.", 404);
  }
  return data;
}

async function remoteWebhooks(ctx: Contexto, body: Record<string, unknown>) {
  const connection = await getConnection(ctx, body) as RappiConnection;
  const response = await rappiRequest(
    ctx.clienteAdmin(),
    connection,
    "OPERATIONAL",
    WEBHOOK_PATH,
  );
  return redactSensitive(response);
}

async function subscribeWebhooks(ctx: Contexto, body: Record<string, unknown>) {
  if (body.confirm !== true) {
    throw new ErrorFuncion(
      "CONFIRM_REQUIRED",
      "Confirma explícitamente el reemplazo de webhooks DEV.",
      400,
    );
  }
  const connection = await getConnection(ctx, body) as RappiConnection;
  if (connection.environment === "PROD") {
    throw new ErrorFuncion(
      "PROD_BLOCKED",
      "La suscripción automática solo está habilitada para DEV.",
      409,
    );
  }
  const admin = ctx.clienteAdmin();
  const requestedEvents = Array.isArray(body.events)
    ? body.events.map((value) => text(value).toUpperCase()).filter(
      isRappiEventV1,
    )
    : [...RAPPI_EVENTS_V1];
  const storeIds = Array.isArray(body.store_ids)
    ? body.store_ids.map(text).filter(Boolean)
    : (await admin.from("rappi_stores").select("rappi_store_id").eq(
      "connection_id",
      connection.id,
    ).eq("active", true)).data
      ?.map((row: { rappi_store_id: string }) => row.rappi_store_id) ?? [];
  if (!requestedEvents.length || !storeIds.length) {
    throw errores.datosIncompletos("events/store_ids");
  }

  const baseFunctionUrl = `${
    Deno.env.get("SUPABASE_URL")
  }/functions/v1/rappi-webhook`;
  const results: Array<Record<string, unknown>> = [];
  for (const eventType of [...new Set(requestedEvents)]) {
    const { data: config, error: configError } = await admin.from(
      "rappi_webhook_configs",
    ).upsert({
      connection_id: connection.id,
      empresa_id: ctx.empresaId,
      event_type: eventType,
      state: "PENDING",
      subscribed_store_ids: storeIds,
    }, { onConflict: "connection_id,event_type" }).select("id, endpoint_key")
      .single<{ id: string; endpoint_key: string }>();
    if (configError || !config) throw errores.baseDeDatos(configError?.message);
    const url = `${baseFunctionUrl}/${config.endpoint_key}/${eventType}`;
    try {
      const existing = await rappiRequest(
        admin,
        connection,
        "OPERATIONAL",
        `${WEBHOOK_PATH}/${eventType}`,
      );
      let response: Record<string, unknown>;
      if (remoteWebhookConfigured(existing, eventType)) {
        const configuredStores = remoteWebhookStoreIds(existing, eventType);
        const missingStores = storeIds.filter((storeId) =>
          !configuredStores.has(storeId)
        );
        if (missingStores.length) {
          await rappiRequest(
            admin,
            connection,
            "OPERATIONAL",
            `${WEBHOOK_PATH}/${eventType}/add-stores`,
            {
              method: "PUT",
              body: JSON.stringify([{ url, stores: missingStores }]),
            },
          );
        }
        await rappiRequest(
          admin,
          connection,
          "OPERATIONAL",
          `${WEBHOOK_PATH}/${eventType}/change-url`,
          {
            method: "PUT",
            body: JSON.stringify({ url, stores: storeIds }),
          },
        );
        response = record(
          await rappiRequest(
            admin,
            connection,
            "OPERATIONAL",
            `${WEBHOOK_PATH}/${eventType}/reset-secret`,
            {
              method: "PUT",
            },
          ),
        );
      } else {
        response = record(
          await rappiRequest(admin, connection, "OPERATIONAL", WEBHOOK_PATH, {
            method: "POST",
            body: JSON.stringify({
              event: eventType,
              data: [{ url, stores: storeIds }],
            }),
          }),
        );
      }
      const secret = webhookSecret(response);
      if (!secret) throw new Error("Rappi no devolvió el secret del webhook");
      const verified = await rappiRequest(
        admin,
        connection,
        "OPERATIONAL",
        `${WEBHOOK_PATH}/${eventType}`,
      );
      if (!remoteWebhookMatches(verified, eventType, url, storeIds)) {
        throw new Error("Rappi no confirmó la URL y las tiendas esperadas");
      }
      await admin.from("rappi_webhook_secrets").upsert({
        webhook_config_id: config.id,
        secret_ciphertext: await encryptText(secret, masterKey()),
        rotated_at: new Date().toISOString(),
        updated_by: ctx.authUserId,
      }, { onConflict: "webhook_config_id" });
      await admin.from("rappi_webhook_configs").update({
        state: "ENABLE",
        remote_url: url,
        subscribed_store_ids: storeIds,
        last_error_at: null,
        last_error_code: null,
      }).eq("id", config.id);
      results.push({
        event: eventType,
        ok: true,
        url,
        stores: storeIds.length,
      });
    } catch (error) {
      const message = error instanceof Error
        ? error.message.slice(0, 300)
        : "Error desconocido";
      await admin.from("rappi_webhook_configs").update({
        state: "ERROR",
        last_error_at: new Date().toISOString(),
        last_error_code: "REMOTE_SUBSCRIPTION_FAILED",
      }).eq("id", config.id);
      results.push({ event: eventType, ok: false, error: message });
    }
  }
  return { results, all_ok: results.every((result) => result.ok === true) };
}

/**
 * Compara una muestra del panel Rappi con los secretos cifrados vigentes.
 * Nunca expone el secreto ni una firma calculada y solo está habilitado en DEV.
 */
async function diagnoseSignature(ctx: Contexto, body: Record<string, unknown>) {
  if (environment(body) !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_DIAGNOSTIC_DEV_ONLY",
      "El diagnóstico de firmas solo está disponible en DEV.",
      409,
    );
  }
  const eventType = text(body.event).toUpperCase();
  const signatureHeader = text(body.signature_header);
  const rawPayload = typeof body.raw_payload === "string"
    ? body.raw_payload
    : "";
  if (!isRappiEventV1(eventType) || !signatureHeader || !rawPayload) {
    throw errores.datosIncompletos("event, signature_header, raw_payload");
  }
  if (signatureHeader.length > 512 || rawPayload.length > 2_000_000) {
    throw new ErrorFuncion(
      "RAPPI_DIAGNOSTIC_TOO_LARGE",
      "La muestra de firma supera el tamaño permitido.",
      413,
    );
  }

  const connection = await getConnection(ctx, body) as RappiConnection;
  const admin = ctx.clienteAdmin();
  const [
    { data: webhookRow, error: webhookError },
    { data: operationalRow, error: operationalError },
  ] = await Promise.all([
    admin.from("rappi_webhook_configs")
      .select("rappi_webhook_secrets!inner(secret_ciphertext)")
      .eq("connection_id", connection.id)
      .eq("event_type", eventType)
      .maybeSingle<
        {
          rappi_webhook_secrets: { secret_ciphertext: string } | {
            secret_ciphertext: string;
          }[];
        }
      >(),
    admin.from("rappi_connection_secrets")
      .select("client_secret_ciphertext")
      .eq("connection_id", connection.id)
      .eq("scope", "OPERATIONAL")
      .maybeSingle<{ client_secret_ciphertext: string }>(),
  ]);
  if (webhookError || operationalError) {
    throw errores.baseDeDatos(
      webhookError?.message ?? operationalError?.message,
    );
  }
  const joinedSecret = Array.isArray(webhookRow?.rappi_webhook_secrets)
    ? webhookRow?.rappi_webhook_secrets[0]?.secret_ciphertext
    : webhookRow?.rappi_webhook_secrets?.secret_ciphertext;
  if (!joinedSecret) throw errores.configuracion(`secret webhook ${eventType}`);

  const webhookSecretValue = await decryptText(joinedSecret, masterKey());
  const operationalSecretValue = operationalRow?.client_secret_ciphertext
    ? await decryptText(operationalRow.client_secret_ciphertext, masterKey())
    : "";
  const webhookValidation = await validateRappiSignature(
    signatureHeader,
    rawPayload,
    webhookSecretValue,
    {
      toleranceMs: 0,
    },
  );
  const operationalValidation = operationalSecretValue
    ? await validateRappiSignature(
      signatureHeader,
      rawPayload,
      operationalSecretValue,
      { toleranceMs: 0 },
    )
    : null;

  return {
    event: eventType,
    signature_parsed: Boolean(webhookValidation.parsed),
    matches_current_webhook_secret: webhookValidation.ok,
    matches_operational_client_secret: operationalValidation?.ok === true,
    webhook_reason: webhookValidation.reason ?? null,
  };
}

/** Prueba end-to-end DEV con los mismos secretos que protegen cada endpoint. */
async function testWebhooks(ctx: Contexto, body: Record<string, unknown>) {
  if (environment(body) !== "DEV") {
    throw new ErrorFuncion(
      "RAPPI_TEST_DEV_ONLY",
      "Las pruebas firmadas solo están disponibles en DEV.",
      409,
    );
  }
  if (body.confirm !== true) {
    throw new ErrorFuncion(
      "CONFIRM_REQUIRED",
      "Confirma la prueba controlada de webhooks Rappi.",
      400,
    );
  }
  const connection = await getConnection(ctx, body) as RappiConnection;
  const admin = ctx.clienteAdmin();
  const requestedStoreId = text(body.store_id);
  let storeQuery = admin.from("rappi_stores")
    .select("rappi_store_id")
    .eq("connection_id", connection.id)
    .eq("active", true);
  if (requestedStoreId) {
    storeQuery = storeQuery.eq("rappi_store_id", requestedStoreId);
  }
  const { data: store, error: storeError } = await storeQuery.limit(1)
    .maybeSingle<{ rappi_store_id: string }>();
  if (storeError) throw errores.baseDeDatos(storeError.message);
  if (!store?.rappi_store_id) {
    throw new ErrorFuncion(
      "RAPPI_STORE_NOT_FOUND",
      "No existe una tienda Rappi activa para la prueba.",
      404,
    );
  }

  const now = new Date();
  const orderId = `ENKRATO-DEV-${now.getTime()}`;
  const samples: Record<string, Record<string, unknown>> = {
    NEW_ORDER: {
      order_detail: {
        order_id: orderId,
        store_id: store.rappi_store_id,
        created_at: now.toISOString(),
        status: "OPEN",
        payment_method: "online",
        delivery_method: "delivery",
        totals: {
          total_order: 1500,
          total_to_pay: 1500,
          total_products: 1500,
          total_discounts: 0,
        },
        items: [{
          id: "ENKRATO-DEV-ITEM",
          sku: "DEV-001",
          name: "Producto de prueba Rappi",
          quantity: 1,
          price: 1500,
        }],
      },
    },
    STORE_CONNECTIVITY: {
      external_store_id: store.rappi_store_id,
      enabled: true,
      message: "Enkrato DEV signed connectivity test",
      checked_at: now.toISOString(),
    },
    ORDER_RT_TRACKING: {
      lat: 4.6097,
      lng: -74.0817,
      eta_in_millis: 330000,
      eta_type: "PICKUP",
      order_id: orderId,
      store_id: store.rappi_store_id,
      courier_id: "ENKRATO-DEV-COURIER",
      created_at: now.toISOString(),
      status: "ON_THE_WAY",
    },
  };
  const events = Object.keys(samples);
  const { data: configs, error: configError } = await admin.from(
    "rappi_webhook_configs",
  )
    .select(
      "id, endpoint_key, event_type, rappi_webhook_secrets!inner(secret_ciphertext)",
    )
    .eq("connection_id", connection.id)
    .eq("state", "ENABLE")
    .in("event_type", events);
  if (configError) throw errores.baseDeDatos(configError.message);

  const baseUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/rappi-webhook`;
  const results: Array<Record<string, unknown>> = [];
  for (const eventType of events) {
    const config = (configs ?? []).find((row: Record<string, unknown>) =>
      row.event_type === eventType
    ) as
      | {
        endpoint_key: string;
        rappi_webhook_secrets: { secret_ciphertext: string } | {
          secret_ciphertext: string;
        }[];
      }
      | undefined;
    const secretCiphertext = Array.isArray(config?.rappi_webhook_secrets)
      ? config?.rappi_webhook_secrets[0]?.secret_ciphertext
      : config?.rappi_webhook_secrets?.secret_ciphertext;
    if (!config?.endpoint_key || !secretCiphertext) {
      results.push({
        event: eventType,
        ok: false,
        status: 0,
        code: "WEBHOOK_NOT_CONFIGURED",
      });
      continue;
    }
    const rawPayload = JSON.stringify(samples[eventType]);
    const timestamp = String(Date.now());
    const secretValue = await decryptText(secretCiphertext, masterKey());
    const signature = await hmacSha256Hex(
      secretValue,
      `${timestamp}.${rawPayload}`,
    );
    const response = await fetch(
      `${baseUrl}/${config.endpoint_key}/${eventType}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Rappi-Signature": `t=${timestamp},sign=${signature}`,
        },
        body: rawPayload,
        signal: AbortSignal.timeout(15_000),
      },
    );
    const responseBody = record(await response.json().catch(() => ({})));
    results.push({
      event: eventType,
      ok: response.ok && responseBody.ok === true,
      status: response.status,
      code: text(responseBody.code) || null,
    });
  }

  const cronSecret = Deno.env.get("RAPPI_CRON_SECRET") ??
    Deno.env.get("CRON_SECRET") ?? "";
  const workerResponse = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/rappi-worker`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: JSON.stringify({ empresa_id: ctx.empresaId, limit: 20 }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const worker = record(await workerResponse.json().catch(() => ({})));
  const persisted = await verifyControlledTestOrder(
    admin,
    connection.id,
    orderId,
  );
  const cleaned = await cleanupControlledTestOrder(
    admin,
    connection.id,
    orderId,
  );
  const workerOk = workerResponse.ok && worker.ok === true;
  const lifecycleOk = persisted.order_found === true &&
    persisted.new_order_event_found === true &&
    Number(persisted.tracking_records ?? 0) > 0 &&
    cleaned.order_removed === true;
  return {
    order_id: orderId,
    store_id: store.rappi_store_id,
    results,
    all_ok: results.every((item) => item.ok === true) && workerOk &&
      lifecycleOk,
    persisted,
    cleaned,
    worker: {
      ok: workerOk,
      claimed: Number(worker.claimed ?? 0),
      processed: Number(worker.processed ?? 0),
      retried: Number(worker.retried ?? 0),
      dead: Number(worker.dead ?? 0),
    },
  };
}

async function verifyControlledTestOrder(
  admin: SupabaseClient,
  connectionId: string,
  orderId: string,
) {
  const { data: order, error: orderError } = await admin.from("rappi_orders")
    .select("id, operational_status, total_order")
    .eq("connection_id", connectionId)
    .eq("rappi_order_id", orderId)
    .maybeSingle<{
      id: string;
      operational_status: string;
      total_order: number | null;
    }>();
  if (orderError) throw errores.baseDeDatos(orderError.message);
  if (!order) {
    return {
      order_found: false,
      new_order_event_found: false,
      tracking_records: 0,
    };
  }

  const [events, tracking] = await Promise.all([
    admin.from("rappi_order_events").select("event_type").eq(
      "order_id",
      order.id,
    ),
    admin.from("rappi_order_tracking").select("id", {
      count: "exact",
      head: true,
    }).eq("order_id", order.id),
  ]);
  if (events.error || tracking.error) {
    throw errores.baseDeDatos(
      events.error?.message ?? tracking.error?.message,
    );
  }
  return {
    order_found: true,
    operational_status: order.operational_status,
    total_order: order.total_order,
    new_order_event_found: (events.data ?? []).some((row) =>
      row.event_type === "NEW_ORDER"
    ),
    tracking_records: tracking.count ?? 0,
  };
}

async function cleanupControlledTestOrder(
  admin: SupabaseClient,
  connectionId: string,
  orderId: string,
) {
  const { data: order, error: orderError } = await admin.from("rappi_orders")
    .select("id")
    .eq("connection_id", connectionId)
    .eq("rappi_order_id", orderId)
    .maybeSingle<{ id: string }>();
  if (orderError) throw errores.baseDeDatos(orderError.message);
  if (!order) return { order_removed: true, removed_rows: 0 };

  const tracking = await admin.from("rappi_order_tracking").delete().eq(
    "order_id",
    order.id,
  ).select("id");
  const events = await admin.from("rappi_order_events").delete().eq(
    "order_id",
    order.id,
  ).select("id");
  if (tracking.error || events.error) {
    throw errores.baseDeDatos(
      tracking.error?.message ?? events.error?.message,
    );
  }
  const removed = await admin.from("rappi_orders").delete()
    .eq("id", order.id)
    .eq("connection_id", connectionId)
    .eq("rappi_order_id", orderId)
    .select("id");
  if (removed.error) throw errores.baseDeDatos(removed.error.message);
  return {
    order_removed: (removed.data ?? []).length === 1,
    removed_rows: (tracking.data ?? []).length +
      (events.data ?? []).length + (removed.data ?? []).length,
  };
}

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(record);
  const object = record(value);
  for (const key of ["data", "results", "items", "entries", "stores"]) {
    if (Array.isArray(object[key])) {
      return (object[key] as unknown[]).map(record);
    }
  }
  return Object.keys(object).length ? [object] : [];
}

function webhookSecret(value: unknown): string {
  const root = record(value);
  const data = record(root.data);
  const first = Array.isArray(root.data) ? record(root.data[0]) : {};
  return text(root.secret ?? data.secret ?? first.secret);
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (
      ["secret", "token", "authorization", "client_secret"].includes(
        key.toLowerCase(),
      )
    ) continue;
    output[key] = redactSensitive(child);
  }
  return output;
}

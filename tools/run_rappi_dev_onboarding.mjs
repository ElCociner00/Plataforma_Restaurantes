import { readFile } from "node:fs/promises";

const mode = process.argv[2] || "status";
if (
  !new Set([
    "status",
    "onboard",
    "verify",
    "diagnose",
    "repair-signatures",
    "check-signatures",
    "test-webhooks",
    "cleanup-dev-data",
  ])
    .has(mode)
) {
  throw new Error(
    "Uso: node tools/run_rappi_dev_onboarding.mjs [status|onboard|verify|diagnose|repair-signatures|check-signatures|test-webhooks|cleanup-dev-data]",
  );
}

const env = parseEnv(
  await readFile(new URL("../.env", import.meta.url), "utf8"),
);
const config = await readFile(
  new URL("../js/config.js", import.meta.url),
  "utf8",
);
const supabaseUrl = requiredMatch(config, /url:\s*"([^"]+)"/, "Supabase URL")
  .replace(/\/+$/, "");
const anonKey = requiredMatch(
  config,
  /anonKey:\s*"([^"]+)"/,
  "Supabase anon key",
);
const host = new URL(supabaseUrl).hostname;
if (!host.endsWith(".supabase.co")) {
  throw new Error("El destino no es un proyecto oficial de Supabase");
}

const required = ["ENKRATO_ADMIN_EMAIL", "ENKRATO_ADMIN_PASSWORD"];
if (mode === "onboard") {
  required.push("RAPPI_DEV_CLIENT_ID", "RAPPI_DEV_CLIENT_SECRET");
}
if (["repair-signatures", "test-webhooks", "cleanup-dev-data"].includes(mode)) {
  required.push("RAPPI_DEV_STORE_ID");
}
for (const key of required) {
  if (!env[key]) throw new Error(`Falta ${key} en .env`);
}

const auth = await request(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: anonKey, "content-type": "application/json" },
  body: JSON.stringify({
    email: env.ENKRATO_ADMIN_EMAIL,
    password: env.ENKRATO_ADMIN_PASSWORD,
  }),
});
const accessToken = typeof auth.body?.access_token === "string"
  ? auth.body.access_token
  : "";
if (auth.status < 200 || auth.status >= 300 || !accessToken) {
  const code = String(
    auth.body?.error_code ?? auth.body?.error ?? "AUTH_FAILED",
  ).slice(0, 80);
  const message = String(
    auth.body?.msg ?? auth.body?.error_description ?? "Credenciales rechazadas",
  ).slice(0, 180);
  throw new Error(
    `Inicio de sesión administrativo falló con HTTP ${auth.status} (${code}): ${message}`,
  );
}

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${accessToken}`,
  "content-type": "application/json",
};
const contextResponse = await request(
  `${supabaseUrl}/rest/v1/rpc/get_my_context`,
  {
    method: "POST",
    headers,
    body: "{}",
  },
);
if (contextResponse.status < 200 || contextResponse.status >= 300) {
  throw new Error(
    `No fue posible resolver el contexto Enkrato (HTTP ${contextResponse.status})`,
  );
}
const context = Array.isArray(contextResponse.body)
  ? contextResponse.body[0]
  : contextResponse.body;
const empresaId = String(
  context?.empresa_id ?? context?.empresa_principal_id ?? "",
);
if (!empresaId) {
  throw new Error(
    "La cuenta no tiene una empresa activa para configurar Rappi",
  );
}

const body = {
  action: ["verify", "diagnose", "check-signatures"].includes(mode)
    ? "status"
    : mode === "repair-signatures"
    ? "subscribe_webhooks"
    : mode === "test-webhooks"
    ? "test_webhooks"
    : mode === "cleanup-dev-data"
    ? "cleanup_dev_test_data"
    : mode,
  environment: "DEV",
  empresa_id: empresaId,
};
if (mode === "onboard") {
  body.client_id = env.RAPPI_DEV_CLIENT_ID;
  body.client_secret = env.RAPPI_DEV_CLIENT_SECRET;
}
if (mode === "repair-signatures") {
  body.confirm = true;
  body.events = ["NEW_ORDER", "STORE_CONNECTIVITY", "ORDER_RT_TRACKING"];
  body.store_ids = [env.RAPPI_DEV_STORE_ID];
}
if (mode === "test-webhooks") {
  body.confirm = true;
  body.store_id = env.RAPPI_DEV_STORE_ID;
}
if (mode === "cleanup-dev-data") body.confirm = true;
const invocation = await request(`${supabaseUrl}/functions/v1/rappi-admin`, {
  method: "POST",
  headers,
  body: JSON.stringify(body),
  timeout: ["onboard", "repair-signatures", "test-webhooks", "cleanup-dev-data"].includes(mode)
    ? 115_000
    : 30_000,
});
if (
  invocation.status < 200 || invocation.status >= 300 ||
  invocation.body?.ok !== true
) {
  const publicMessage = invocation.body?.message || invocation.body?.error ||
    "respuesta no confirmada";
  throw new Error(
    `rappi-admin ${mode} falló con HTTP ${invocation.status}: ${
      String(publicMessage).slice(0, 240)
    }`,
  );
}

const result = invocation.body.data ?? invocation.body;
const data = mode === "verify" ? await verifyOperationalData() : null;
const diagnostic = mode === "diagnose" ? await diagnoseOperationalData() : null;
const signatureChecks = mode === "check-signatures"
  ? await checkDocumentedSignatures()
  : null;
const webhookTestVerification = mode === "test-webhooks" && result?.order_id
  ? await verifyWebhookTestData(result.order_id, result)
  : null;
console.log(JSON.stringify(
  {
    ok: true,
    mode,
    auth_http_status: auth.status,
    function_http_status: invocation.status,
    company_context_resolved: true,
    ...(mode === "onboard"
      ? onboardingSummary(result)
      : mode === "repair-signatures"
      ? { repair: subscriptionSummary(result) }
      : mode === "diagnose"
      ? { diagnostic: diagnosticSummary(result), operational_data: diagnostic }
      : mode === "check-signatures"
      ? { signature_checks: signatureChecks }
      : mode === "test-webhooks"
      ? { webhook_test: result, persisted_data: webhookTestVerification }
      : mode === "cleanup-dev-data"
      ? { cleanup: result }
      : {
        status: statusSummary(result),
        ...(data ? { operational_data: data } : {}),
      }),
  },
  null,
  2,
));

async function verifyWebhookTestData(rappiOrderId, testResult) {
  const orders = await invokeData({
    action: "orders",
    page: 1,
    page_size: 10,
    search: rappiOrderId,
  });
  const order = Array.isArray(orders?.entries)
    ? orders.entries.find((item) => item?.rappi_order_id === rappiOrderId)
    : null;
  if (!order?.id) {
    return {
      ...testResult?.persisted,
      cleanup_confirmed: testResult?.cleaned?.order_removed === true,
      order_absent_after_cleanup: true,
    };
  }
  const detail = await invokeData({
    action: "order_detail",
    order_id: order.id,
  });
  return {
    order_found: detail?.order?.rappi_order_id === rappiOrderId,
    operational_status: detail?.order?.operational_status ?? null,
    total_order: detail?.order?.total_order ?? null,
    new_order_event_found: Array.isArray(detail?.events) &&
      detail.events.some((event) => event?.event_type === "NEW_ORDER"),
    tracking_records: Array.isArray(detail?.tracking)
      ? detail.tracking.length
      : 0,
    tracking_statuses: Array.isArray(detail?.tracking)
      ? [
        ...new Set(
          detail.tracking.map((item) => item?.tracking_status ?? null),
        ),
      ]
      : [],
    cleanup_confirmed: false,
    order_absent_after_cleanup: false,
  };
}

async function checkDocumentedSignatures() {
  // Muestras públicas copiadas del panel Testing de Rappi el 2026-08-30.
  const samples = [
    {
      event: "NEW_ORDER",
      raw_payload:
        '{"order_id":"SAMPLE-ORDER-0001","store_id":"900170987","created_at":"2024-01-01 12:00:00","total":1500,"status":"OPEN"}',
      signature_header:
        "t=1788121087374,sign=a4620a42f3b52528ae83e34d846f3cdd5b007df19ad73e4ba84c00c4a88434a7",
    },
    {
      event: "STORE_CONNECTIVITY",
      raw_payload:
        '{"online":true,"checked_at":"2026-08-30 20:19:56","store_id":"900170987"}',
      signature_header:
        "t=1788121196920,sign=313592342e5d3bd8f6d2c4abaeb1fe239d25864af4a79a2a560b3670e1ae7d1d",
    },
    {
      event: "ORDER_RT_TRACKING",
      raw_payload:
        '{"longitude":-74.0817,"status":"ON_THE_WAY","order_id":"SAMPLE-ORDER-0001","store_id":"900170987","latitude":4.6097}',
      signature_header:
        "t=1788121225451,sign=62ae6affa39895035e20a18be2a7b93b0b596295879b11ba3b32548082c01312",
    },
  ];
  const results = [];
  for (const sample of samples) {
    const response = await request(`${supabaseUrl}/functions/v1/rappi-admin`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        action: "diagnose_signature",
        environment: "DEV",
        empresa_id: empresaId,
        ...sample,
      }),
    });
    if (
      response.status < 200 || response.status >= 300 ||
      response.body?.ok !== true
    ) {
      throw new Error(
        `Diagnóstico ${sample.event} falló con HTTP ${response.status}`,
      );
    }
    results.push(response.body.data ?? response.body);
  }
  return results;
}

async function diagnoseOperationalData() {
  const summaryResponse = await invokeData({ action: "operation_summary" });
  const ordersResponse = await invokeData({
    action: "orders",
    page: 1,
    page_size: 10,
  });
  const entries = Array.isArray(ordersResponse?.entries)
    ? ordersResponse.entries
    : [];
  let detail = null;
  if (entries[0]?.id) {
    detail = await invokeData({
      action: "order_detail",
      order_id: entries[0].id,
    });
  }
  return {
    total_orders: Number(summaryResponse?.total_orders ?? 0),
    stores: (summaryResponse?.stores ?? []).map((store) => ({
      connectivity_status: store?.connectivity_status ?? null,
      last_ping_at: store?.last_ping_at ?? null,
      last_ping_ok: store?.last_ping_ok ?? null,
    })),
    latest_order: detail
      ? {
        operational_status: detail?.order?.operational_status ?? null,
        rappi_status: detail?.order?.rappi_status ?? null,
        event_types: Array.isArray(detail?.events)
          ? detail.events.map((event) => event?.event_type ?? null)
          : [],
        tracking_records: Array.isArray(detail?.tracking)
          ? detail.tracking.length
          : 0,
        tracking_statuses: Array.isArray(detail?.tracking)
          ? [
            ...new Set(
              detail.tracking.map((item) => item?.tracking_status ?? null),
            ),
          ]
          : [],
      }
      : null,
  };
}

async function invokeData(action) {
  const response = await request(`${supabaseUrl}/functions/v1/rappi-data`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...action, empresa_id: empresaId }),
  });
  if (
    response.status < 200 || response.status >= 300 ||
    response.body?.ok !== true
  ) {
    throw new Error(
      `rappi-data ${action.action} falló con HTTP ${response.status}`,
    );
  }
  return response.body.data ?? response.body;
}

async function verifyOperationalData() {
  const actions = [
    { action: "operation_summary" },
    { action: "orders", page: 1, page_size: 1 },
    { action: "menu_support" },
  ];
  const responses = [];
  for (const action of actions) {
    const response = await request(`${supabaseUrl}/functions/v1/rappi-data`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...action, empresa_id: empresaId }),
    });
    if (
      response.status < 200 || response.status >= 300 ||
      response.body?.ok !== true
    ) {
      throw new Error(
        `rappi-data ${action.action} falló con HTTP ${response.status}`,
      );
    }
    responses.push(response.body.data ?? response.body);
  }
  const [summary, orders, menus] = responses;
  return {
    summary_ok: true,
    stores_visible: Array.isArray(summary?.stores) ? summary.stores.length : 0,
    total_orders: Number(summary?.total_orders ?? 0),
    incidents: Number(summary?.incidents ?? 0),
    orders_query_ok: Array.isArray(orders?.entries),
    orders_returned: Array.isArray(orders?.entries) ? orders.entries.length : 0,
    menu_support_ok: Array.isArray(menus),
    menu_stores: Array.isArray(menus) ? menus.length : 0,
    menu_statuses: Array.isArray(menus)
      ? menus.map((store) =>
        store?.menu?.approval_status ?? store?.menu_approval_status ??
          "PENDING"
      )
      : [],
  };
}

function statusSummary(value) {
  const webhooks = Array.isArray(value?.webhooks) ? value.webhooks : [];
  const tokens = Array.isArray(value?.tokens) ? value.tokens : [];
  const stores = Array.isArray(value?.stores) ? value.stores : [];
  return {
    configured: value?.configured === true,
    connection_status: value?.connection?.status ?? null,
    stores: stores.length,
    mapped_stores:
      stores.filter((item) => Boolean(item?.enkrato_empresa_id)).length,
    stores_with_ping:
      stores.filter((item) => Boolean(item?.last_ping_at)).length,
    active_webhooks: webhooks.filter((item) => item?.state === "ENABLE").length,
    webhooks_with_received_events:
      webhooks.filter((item) => Boolean(item?.last_received_at)).length,
    webhooks_with_valid_signatures:
      webhooks.filter((item) => Boolean(item?.last_valid_signature_at)).length,
    operational_token_valid: tokens.some((item) =>
      item?.scope === "OPERATIONAL" && item?.valid === true
    ),
    open_errors: Array.isArray(value?.errors) ? value.errors.length : 0,
  };
}

function diagnosticSummary(value) {
  return {
    status: statusSummary(value),
    stores: (Array.isArray(value?.stores) ? value.stores : []).map((store) => ({
      store_name: store?.store_name ?? null,
      connectivity_status: store?.connectivity_status ?? null,
      last_ping_at: store?.last_ping_at ?? null,
      last_ping_ok: store?.last_ping_ok ?? null,
    })),
    webhooks: (Array.isArray(value?.webhooks) ? value.webhooks : []).map((
      webhook,
    ) => ({
      event: webhook?.event_type ?? null,
      state: webhook?.state ?? null,
      url_host: safeHost(webhook?.remote_url),
      last_received_at: webhook?.last_received_at ?? null,
      last_valid_signature_at: webhook?.last_valid_signature_at ?? null,
      last_error_at: webhook?.last_error_at ?? null,
      last_error_code: webhook?.last_error_code ?? null,
    })),
    errors: (Array.isArray(value?.errors) ? value.errors : []).map((error) => ({
      source: error?.source ?? null,
      error_class: error?.error_class ?? null,
      error_code: error?.error_code ?? null,
      public_message: error?.public_message ?? null,
      retryable: error?.retryable === true,
      status: error?.status ?? null,
      occurrence_count: Number(error?.occurrence_count ?? 0),
      last_occurred_at: error?.last_occurred_at ?? null,
    })),
    sync_runs: (Array.isArray(value?.sync_runs) ? value.sync_runs : []).slice(
      0,
      5,
    ).map((run) => ({
      sync_type: run?.sync_type ?? null,
      status: run?.status ?? null,
      records_read: Number(run?.records_read ?? 0),
      records_written: Number(run?.records_written ?? 0),
      error_code: run?.error_code ?? null,
    })),
  };
}

function onboardingSummary(value) {
  const results = Array.isArray(value?.subscription?.results)
    ? value.subscription.results
    : [];
  return {
    credentials_saved: value?.saved?.saved === true,
    validation_ok: value?.validation?.auth_ok === true &&
      Number(value?.validation?.stores_discovered ?? 0) > 0,
    subscription_all_ok: value?.subscription?.all_ok === true,
    subscriptions: results.map((item) => ({
      event: item?.event ?? null,
      ok: item?.ok === true,
      stores: Number(item?.stores ?? 0),
      url_host: safeHost(item?.url),
      ...(item?.ok === true
        ? {}
        : { error: String(item?.error ?? "").slice(0, 180) }),
    })),
    automation_configured: Boolean(value?.automation),
    initial_sync: value?.initial_sync ?? null,
    status: statusSummary(value?.status ?? {}),
  };
}

function subscriptionSummary(value) {
  const results = Array.isArray(value?.results) ? value.results : [];
  return {
    all_ok: value?.all_ok === true,
    events: results.map((item) => ({
      event: item?.event ?? null,
      ok: item?.ok === true,
      stores: Number(item?.stores ?? 0),
      url_host: safeHost(item?.url),
      ...(item?.ok === true
        ? {}
        : { error: String(item?.error ?? "").slice(0, 180) }),
    })),
  };
}

function safeHost(value) {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return null;
  }
}

function requiredMatch(source, pattern, label) {
  const value = source.match(pattern)?.[1];
  if (!value) throw new Error(`No fue posible leer ${label}`);
  return value;
}

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll(
        "\\\\",
        "\\",
      );
    }
    result[match[1]] = value;
  }
  return result;
}

async function request(url, init = {}) {
  const timeout = init.timeout ?? 30_000;
  const response = await fetch(url, {
    ...init,
    timeout: undefined,
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await response.text();
  let body = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
  }
  return { status: response.status, body };
}

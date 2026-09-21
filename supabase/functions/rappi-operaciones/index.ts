import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { type Contexto, exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { rappiRequestWithStatus, rappiUtilsRequest } from "../_shared/rappi/client.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";
import { decryptText } from "../_shared/crypto.ts";

/**
 * Operación de la tienda en Rappi: integrada o no, estado del menú,
 * disponibilidad de productos y horarios. Separada de rappi-admin (credenciales,
 * webhooks, onboarding) porque son acciones del día a día, no de configuración.
 */
const LABEL = "rappi-operaciones";

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
    const action = text(body.action).toLowerCase();
    // Consultas que necesita quien atiende (código de entrega, menú); el resto es de admin.
    if (!["order_handoff", "menu_status"].includes(action)) exigirAdmin(ctx, "operar la tienda en Rappi");
    let result: unknown;
    switch (action) {
      case "store_integrated": result = await storeIntegrated(ctx, body); break;
      case "menu_approval": result = await menuApproval(ctx, body); break;
      case "items_availability": result = await itemsAvailability(ctx, body); break;
      case "store_schedule": result = await storeSchedule(ctx, body); break;
      case "self_onboarding": result = await selfOnboarding(ctx, body); break;
      case "store_menu": result = await storeMenu(ctx, body); break;
      case "store_availability": result = await storeAvailability(ctx, body); break;
      case "store_checkin_code": result = await storeCheckinCode(ctx, body); break;
      case "order_handoff": result = await orderHandoff(ctx, body); break;
      case "menu_status": result = await menuStatus(ctx); break;
      case "integration_webhooks": result = await integrationWebhooks(ctx, body); break;
      default:
        throw new ErrorFuncion("UNKNOWN_ACTION", "La acción solicitada no existe.", 400);
    }
    return json({ ok: true, data: result }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

async function getConnection(ctx: Contexto, body: Record<string, unknown>): Promise<RappiConnection> {
  const environment = text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";
  const { data, error } = await ctx.clienteAdmin().from("rappi_connections")
    .select(
      "id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled",
    )
    .eq("empresa_id", ctx.empresaId)
    .eq("environment", environment)
    .maybeSingle<RappiConnection>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data) {
    throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "Configura primero las credenciales de Rappi.", 412);
  }
  return data;
}

/** Quita secretos antes de registrar la respuesta de Rappi. */
function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (["secret", "token", "authorization", "client_secret"].includes(key.toLowerCase())) continue;
    output[key] = redactSensitive(child);
  }
  return output;
}

const PUBLIC_API = "/api/v2/restaurants-integrations-public-api";

/** Tienda de la conexión, por el id interno de Enkrato. */
async function connectionStore(ctx: Contexto, body: Record<string, unknown>) {
  const storeId = text(body.store_id);
  if (!storeId) throw errores.datosIncompletos("store_id");
  const connection = await getConnection(ctx, body);
  const { data, error } = await ctx.clienteAdmin().from("rappi_stores")
    .select("id, rappi_store_id, integration_store_id")
    .eq("id", storeId).eq("connection_id", connection.id)
    .maybeSingle<{ id: string; rappi_store_id: string; integration_store_id: string | null }>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data) {
    throw new ErrorFuncion("STORE_NOT_FOUND", "La tienda no pertenece a esta conexión.", 404);
  }
  return { connection, store: data };
}

/** Rappi respondió algo distinto de 2xx: se muestra el código y su mensaje. */
function rappiResult(response: { status: number; body: unknown }) {
  if (response.status >= 200 && response.status < 300) return response.body;
  console.warn(`[${LABEL}] Rappi ${response.status}:`, JSON.stringify(redactSensitive(response.body)).slice(0, 1000));
  throw new ErrorFuncion(
    response.status === 429 ? "RAPPI_RATE_LIMIT" : "RAPPI_HTTP",
    `Rappi devolvió un error (${response.status}).`,
    response.status >= 500 ? 502 : response.status,
    { status: response.status, body: redactSensitive(response.body) },
  );
}

/**
 * Marca la tienda como integrada (Rappi entrega los pedidos al integrador) o
 * no integrada (vuelven a la tablet de Rappi). Es idempotente del lado de
 * Rappi: repetir el mismo estado responde 200.
 */
async function storeIntegrated(ctx: Contexto, body: Record<string, unknown>) {
  if (typeof body.integrated !== "boolean") throw errores.datosIncompletos("integrated");
  const { connection, store } = await connectionStore(ctx, body);
  const response = await rappiRequestWithStatus(
    ctx.clienteAdmin(),
    connection,
    "OPERATIONAL",
    `${PUBLIC_API}/stores-pa/${encodeURIComponent(store.rappi_store_id)}/status?integrated=${body.integrated}`,
    { method: "PUT" },
  );
  return { integrated: body.integrated, rappi: rappiResult(response) };
}

/** Estado de aprobación del último menú enviado a Rappi. */
async function menuApproval(ctx: Contexto, body: Record<string, unknown>) {
  const { connection, store } = await connectionStore(ctx, body);
  const response = await rappiRequestWithStatus(
    ctx.clienteAdmin(),
    connection,
    "OPERATIONAL",
    `${PUBLIC_API}/menu/approved/${encodeURIComponent(store.rappi_store_id)}`,
  );
  return { rappi: rappiResult(response) };
}

/**
 * Prende o apaga productos/toppings por SKU. Apagar en Rappi es indefinido:
 * el producto sigue apagado hasta que alguien lo prenda de nuevo.
 */
async function itemsAvailability(ctx: Contexto, body: Record<string, unknown>) {
  const skus = (value: unknown) =>
    Array.isArray(value) ? [...new Set(value.map((sku) => text(sku)).filter(Boolean))] : [];
  const turnOn = skus(body.turn_on);
  const turnOff = skus(body.turn_off);
  if (!turnOn.length && !turnOff.length) throw errores.datosIncompletos("turn_on o turn_off");
  if (turnOn.length + turnOff.length > 100) {
    throw new ErrorFuncion("RAPPI_TOO_MANY_ITEMS", "Rappi acepta máximo 100 productos por cambio.", 400);
  }
  if (turnOn.some((sku) => turnOff.includes(sku))) {
    throw new ErrorFuncion("RAPPI_ITEM_BOTH_STATES", "Un producto no puede prenderse y apagarse a la vez.", 400);
  }
  const { connection, store } = await connectionStore(ctx, body);
  const response = await rappiRequestWithStatus(
    ctx.clienteAdmin(),
    connection,
    "OPERATIONAL",
    `${PUBLIC_API}/availability/stores/items`,
    {
      method: "PUT",
      body: JSON.stringify([{
        store_integration_id: store.integration_store_id || store.rappi_store_id,
        items: { turn_on: turnOn, turn_off: turnOff },
      }]),
    },
  );
  return { turn_on: turnOn, turn_off: turnOff, rappi: rappiResult(response) };
}

const SCHEDULE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SCHEDULE_TIME = /^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;

/**
 * Horario regular de la tienda en Rappi (API de Utils).
 * op: "get" | "create" {day, starts_time, ends_time} |
 *     "update" {schedule_id, starts_time, ends_time} | "delete" {schedule_id}
 */
async function storeSchedule(ctx: Contexto, body: Record<string, unknown>) {
  const op = text(body.op).toLowerCase() || "get";
  const { connection, store } = await connectionStore(ctx, body);
  const base = `/api/rest-ops-utils/store/schedule/${encodeURIComponent(store.rappi_store_id)}`;
  const times = () => {
    const starts = text(body.starts_time);
    const ends = text(body.ends_time);
    if (!SCHEDULE_TIME.test(starts) || !SCHEDULE_TIME.test(ends)) {
      throw new ErrorFuncion("RAPPI_SCHEDULE_TIME", "Las horas van en formato HH:mm:ss.", 400);
    }
    return { starts, ends };
  };
  const scheduleId = () => {
    const id = text(body.schedule_id);
    if (!/^\d+$/.test(id)) throw errores.datosIncompletos("schedule_id");
    return id;
  };
  const admin = ctx.clienteAdmin();
  let response: { status: number; body: unknown };
  switch (op) {
    case "get":
      response = await rappiUtilsRequest(admin, connection, base);
      break;
    case "create": {
      const day = text(body.day).toLowerCase();
      if (!SCHEDULE_DAYS.includes(day)) throw errores.datosIncompletos("day (mon..sun)");
      const { starts, ends } = times();
      response = await rappiUtilsRequest(admin, connection, base, {
        method: "POST",
        body: JSON.stringify({ day, starts_time: starts, ends_time: ends }),
      });
      break;
    }
    case "update": {
      const { starts, ends } = times();
      response = await rappiUtilsRequest(admin, connection, `${base}/${scheduleId()}`, {
        method: "PUT",
        body: JSON.stringify({ startsTime: starts, endsTime: ends }),
      });
      break;
    }
    case "delete":
      response = await rappiUtilsRequest(admin, connection, `${base}/${scheduleId()}`, { method: "DELETE" });
      break;
    default:
      throw new ErrorFuncion("UNKNOWN_ACTION", "Operación de horario no válida.", 400);
  }
  return { op, rappi: rappiResult(response) };
}

/**
 * Auto-onboarding: webhook de integración (STORE_PROVISIONING_STATUS) y
 * aprovisionamiento de la tienda con PING y eventos de cancelación activos.
 * Devuelve el código de Rappi en vez de lanzar: el contrato de estos
 * endpoints aún se está confirmando con Rappi.
 */
async function selfOnboarding(ctx: Contexto, body: Record<string, unknown>) {
  const clientId = text(body.client_id);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) throw errores.datosIncompletos("client_id");
  const { connection, store } = await connectionStore(ctx, body);
  const admin = ctx.clienteAdmin();
  const results: Record<string, unknown> = {};
  if (body.webhook_url) {
    const url = text(body.webhook_url);
    if (!/^https:\/\//.test(url)) throw errores.datosIncompletos("webhook_url https");
    const response = await rappiRequestWithStatus(admin, connection, "OPERATIONAL",
      `${PUBLIC_API}/clients/${encodeURIComponent(clientId)}/webhooks`,
      { method: "POST", body: JSON.stringify({ event: "STORE_PROVISIONING_STATUS", url }) });
    results.webhook = { status: response.status, body: redactSensitive(response.body) };
  }
  const provisioning = {
    store_id: store.rappi_store_id,
    name: text(body.store_name) || store.rappi_store_id,
    status: "ACTIVE",
    store_integration_id: store.integration_store_id || store.rappi_store_id,
    ping_active: true,
    cancellation_events: true,
  };
  const perStore = await rappiRequestWithStatus(admin, connection, "OPERATIONAL",
    `${PUBLIC_API}/stores/${encodeURIComponent(store.rappi_store_id)}/provisioning`,
    { method: "POST", body: JSON.stringify(provisioning) });
  results.provisioning = { status: perStore.status, body: redactSensitive(perStore.body) };
  return results;
}

/**
 * Registra a nivel integración (`/clients/{clientId}/webhooks`) los eventos que
 * ya están suscritos por tienda, con la misma URL y el mismo secreto, para que
 * Rappi los encuentre y firme igual que por tienda.
 */
async function integrationWebhooks(ctx: Contexto, body: Record<string, unknown>) {
  const clientId = text(body.client_id);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(clientId)) throw errores.datosIncompletos("client_id");
  const events = Array.isArray(body.events) ? body.events.map((e) => text(e).toUpperCase()) : [];
  if (!events.length) throw errores.datosIncompletos("events");
  const connection = await getConnection(ctx, body);
  const admin = ctx.clienteAdmin();
  const key = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY") ?? "";
  const results: Record<string, unknown> = {};
  for (const event of events) {
    const { data: config } = await admin.from("rappi_webhook_configs")
      .select("id, remote_url").eq("connection_id", connection.id).eq("event_type", event)
      .maybeSingle<{ id: string; remote_url: string }>();
    const { data: secretRow } = config
      ? await admin.from("rappi_webhook_secrets").select("secret_ciphertext")
        .eq("webhook_config_id", config.id).maybeSingle<{ secret_ciphertext: string }>()
      : { data: null };
    if (!config?.remote_url || !secretRow) {
      results[event] = { status: 0, error: "sin configuración local" };
      continue;
    }
    const response = await rappiRequestWithStatus(admin, connection, "OPERATIONAL",
      `${PUBLIC_API}/clients/${encodeURIComponent(clientId)}/webhooks`,
      {
        method: "POST",
        body: JSON.stringify({
          event,
          url: config.remote_url,
          secret: await decryptText(secretRow.secret_ciphertext, key),
        }),
      });
    results[event] = { status: response.status, body: redactSensitive(response.body) };
  }
  return results;
}

/** Menú vigente que Rappi muestra hoy para la tienda (productos y toppings). */
async function storeMenu(ctx: Contexto, body: Record<string, unknown>) {
  const { connection, store } = await connectionStore(ctx, body);
  const response = await rappiRequestWithStatus(ctx.clienteAdmin(), connection, "OPERATIONAL",
    `${PUBLIC_API}/store/${encodeURIComponent(store.rappi_store_id)}/menu/current`);
  const raw = rappiResult(response);
  const root = Array.isArray(raw) ? (raw[0] ?? {}) : (raw ?? {});
  const record = (value: unknown) => (value && typeof value === "object" ? value as Record<string, unknown> : {});
  const item = (value: unknown) => {
    const row = record(value);
    return {
      id: text(row.id),
      name: text(row.name),
      price: Number(row.price) || 0,
      sku: text(row.partnerSku ?? row.sku) || null,
      active: row.active === null || row.active === undefined ? null : row.active === true,
      category: text(record(row.category).name) || null,
    };
  };
  const products = Array.isArray(record(root).products) ? record(root).products as unknown[] : [];
  return {
    products: products.map((product) => ({
      ...item(product),
      toppings: (Array.isArray(record(product).toppings) ? record(product).toppings as unknown[] : []).map(item),
    })),
  };
}

/**
 * Tienda abierta o cerrada en la app de Rappi (disponibilidad), no la
 * integración: cerrarla deja de recibir pedidos hasta que se vuelva a abrir.
 */
async function storeAvailability(ctx: Contexto, body: Record<string, unknown>) {
  const { connection, store } = await connectionStore(ctx, body);
  const admin = ctx.clienteAdmin();
  if (typeof body.enabled === "boolean") {
    const response = await rappiRequestWithStatus(admin, connection, "OPERATIONAL", `${PUBLIC_API}/availability/stores/enable`, {
      method: "PUT",
      body: JSON.stringify({ stores: [{ store_id: store.rappi_store_id, is_enabled: body.enabled }] }),
    });
    const result = rappiResult(response) as Record<string, unknown>;
    const row = (Array.isArray(result?.results) ? result.results as Record<string, unknown>[] : [])[0] ?? {};
    return {
      enabled: row.is_enabled === undefined ? body.enabled : row.is_enabled === true,
      ok: row.operation_result !== false,
      reason: text(row.suspended_reason) || text(row.operation_result_message) || null,
    };
  }
  const response = await rappiRequestWithStatus(admin, connection, "OPERATIONAL", `${PUBLIC_API}/availability/stores`, {
    method: "POST",
    body: JSON.stringify([Number(store.rappi_store_id)]),
  });
  const result = rappiResult(response) as Record<string, unknown>;
  const value = result?.[store.rappi_store_id];
  return { enabled: value === undefined ? null : value === true };
}

/** Código de registro (check-in) que Rappi asigna a la tienda. */
async function storeCheckinCode(ctx: Contexto, body: Record<string, unknown>) {
  const { connection, store } = await connectionStore(ctx, body);
  const response = await rappiRequestWithStatus(ctx.clienteAdmin(), connection, "OPERATIONAL",
    `${PUBLIC_API}/stores-pa/${encodeURIComponent(store.rappi_store_id)}/check-in-code`);
  const result = (rappiResult(response) ?? {}) as Record<string, unknown>;
  return { code: text(result.code) || null, expired_at: text(result.expired_at) || null };
}

/**
 * Código de entrega del pedido: el repartidor lo confirma en el local antes de
 * llevárselo. Rappi entrega el número y un QR (PNG en base64).
 */
async function orderHandoff(ctx: Contexto, body: Record<string, unknown>) {
  const orderId = text(body.order_id);
  if (!orderId) throw errores.datosIncompletos("order_id");
  const db = ctx.clienteAdmin();
  const { data: order, error } = await db.from("rappi_orders")
    .select("rappi_order_id, connection_id, rappi_stores(rappi_store_id)")
    .eq("id", orderId).eq("empresa_id", ctx.empresaId)
    .maybeSingle<{ rappi_order_id: string; connection_id: string; rappi_stores: { rappi_store_id: string } | null }>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!order?.rappi_stores?.rappi_store_id) {
    throw new ErrorFuncion("ORDER_NOT_FOUND", "La orden no existe o no pertenece a tu empresa.", 404);
  }
  const { data: connection } = await db.from("rappi_connections")
    .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
    .eq("id", order.connection_id).maybeSingle<RappiConnection>();
  if (!connection) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "La conexión Rappi no está configurada.", 412);
  const response = await rappiRequestWithStatus(db, connection, "OPERATIONAL",
    `/restaurants/orders/v1/stores/${encodeURIComponent(order.rappi_stores.rappi_store_id)}/orders/${encodeURIComponent(order.rappi_order_id)}/handoff`);
  if (response.status === 404 || response.status === 412 || response.status === 424) {
    console.warn(`[${LABEL}] handoff ${response.status}:`, JSON.stringify(redactSensitive(response.body)).slice(0, 500));
    throw new ErrorFuncion("HANDOFF_NOT_READY", "Rappi aún no tiene código de entrega para este pedido. Suele aparecer cuando el pedido ya fue aceptado.", 409);
  }
  const result = (rappiResult(response) ?? {}) as Record<string, unknown>;
  const qr = text(result.qr_code);
  return {
    code: text(result.product_confirmation_code) || null,
    qr_png_base64: /^[A-Za-z0-9+/=]+$/.test(qr) ? qr : null,
  };
}

/**
 * Estado del menú de cada tienda consultado a Rappi en vivo: aprobación
 * (`menu/approved`) y cuántos productos tiene publicados (`menu/current`).
 * Actualiza el estado guardado para que el resto de Enkrato no quede atrasado.
 */
async function menuStatus(ctx: Contexto) {
  const db = ctx.clienteAdmin();
  const { data: stores, error } = await db.from("rappi_stores")
    .select("id, rappi_store_id, store_name, connection_id, rappi_connections(id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled)")
    .or(`empresa_id.eq.${ctx.empresaId},enkrato_empresa_id.eq.${ctx.empresaId}`).eq("active", true)
    .order("store_name");
  if (error) throw errores.baseDeDatos(error.message);
  const rows = (stores ?? []) as unknown as {
    id: string; rappi_store_id: string; store_name: string | null; rappi_connections: RappiConnection | null;
  }[];
  return await Promise.all(rows.map(async (store) => {
    const connection = store.rappi_connections;
    if (!connection) return { store_id: store.id, store_name: store.store_name, status: "UNKNOWN", product_count: null };
    const storePath = encodeURIComponent(store.rappi_store_id);
    const [approval, current] = await Promise.all([
      rappiRequestWithStatus(db, connection, "OPERATIONAL", `${PUBLIC_API}/menu/approved/${storePath}`),
      rappiRequestWithStatus(db, connection, "OPERATIONAL", `${PUBLIC_API}/store/${storePath}/menu/current`),
    ]);
    const status = menuApprovalFrom(approval);
    if (status === "UNKNOWN") {
      console.warn(`[${LABEL}] menu/approved sin estado reconocible:`, approval.status, JSON.stringify(approval.body).slice(0, 300));
    }
    const currentBody = Array.isArray(current.body) ? current.body[0] : current.body;
    const products = (currentBody as Record<string, unknown> | undefined)?.products;
    const productCount = current.status >= 200 && current.status < 300 && Array.isArray(products) ? products.length : null;
    if (status !== "UNKNOWN") {
      await db.from("rappi_stores").update({ menu_approval_status: status }).eq("id", store.id);
    }
    return { store_id: store.id, store_name: store.store_name, status, product_count: productCount };
  }));
}

/**
 * `menu/approved` responde texto plano (AVAILABLE, PENDING, REJECTED…) o un
 * booleano suelto. `false` no es un estado desconocido: es el menú recién
 * enviado que Rappi todavía está revisando, y así lo ve el cliente.
 */
function menuApprovalFrom(response: { status: number; body: unknown }): string {
  if (response.status < 200 || response.status >= 300) return "UNKNOWN";
  const cuerpo = response.body;
  const record = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const raw = text(record.raw ?? record.status ?? record.state ?? cuerpo).toUpperCase();
  if (["AVAILABLE", "APPROVED", "TRUE"].includes(raw)) return "APPROVED";
  if (raw.includes("REJECT")) return "REJECTED";
  if (raw === "FALSE" || raw.includes("PENDING") || raw.includes("PROCESS")) return "PENDING";
  return "UNKNOWN";
}

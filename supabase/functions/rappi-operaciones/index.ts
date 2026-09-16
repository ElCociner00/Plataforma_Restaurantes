import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { type Contexto, exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { rappiRequestWithStatus, rappiUtilsRequest } from "../_shared/rappi/client.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";

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
    exigirAdmin(ctx, "operar la tienda en Rappi");
    let result: unknown;
    switch (text(body.action).toLowerCase()) {
      case "store_integrated": result = await storeIntegrated(ctx, body); break;
      case "menu_approval": result = await menuApproval(ctx, body); break;
      case "items_availability": result = await itemsAvailability(ctx, body); break;
      case "store_schedule": result = await storeSchedule(ctx, body); break;
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

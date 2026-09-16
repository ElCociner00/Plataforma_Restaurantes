import { corsHeaders, json } from "../_shared/cors.ts";
import { decryptText, encryptText } from "../_shared/crypto.ts";
import { errores, ErrorFuncion, leerCuerpo, responderError } from "../_shared/errores.ts";
import { type Contexto, exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { rappiRequestWithStatus } from "../_shared/rappi/client.ts";
import type { RappiConnection } from "../_shared/rappi/types.ts";

/**
 * Vincula la cuenta Rappi Partners del restaurante con su empresa de Enkrato
 * (auto-onboarding). El usuario ya tiene sesión en Enkrato: el inicio de sesión
 * de Rappi solo autoriza a Enkrato sobre sus tiendas, no crea cuentas.
 *
 *  config    → ¿está disponible? (sin client_id de Partners la UI se oculta)
 *  start     → URL de autorización con PKCE + state de un solo uso
 *  finish    → valida state, cambia el código por id_token y lista tiendas
 *  provision → aprovisiona las tiendas elegidas
 */
const LABEL = "rappi-vincular";
const PUBLIC_API = "/api/v2/restaurants-integrations-public-api";
const LINK_TTL_MS = 15 * 60_000;
const PARTNERS_HOST = { DEV: "https://login.partners.dev.rappi.com", PROD: "https://login.partners.rappi.com" };

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, code: "METHOD_NOT_ALLOWED" }, 405, origin);
  try {
    const body = await leerCuerpo(req);
    const ctx = await resolverContexto(req, text(body.empresa_id) || null);
    exigirAdmin(ctx, "vincular la cuenta de Rappi");
    let result: unknown;
    switch (text(body.action).toLowerCase()) {
      case "config": result = config(body); break;
      case "start": result = await start(ctx, body); break;
      case "finish": result = await finish(ctx, body); break;
      case "provision": result = await provision(ctx, body); break;
      default: throw new ErrorFuncion("UNKNOWN_ACTION", "La acción solicitada no existe.", 400);
    }
    return json({ ok: true, data: result }, 200, origin);
  } catch (error) {
    return responderError(error, origin, LABEL);
  }
});

const text = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

const environmentOf = (body: Record<string, unknown>): "DEV" | "PROD" =>
  text(body.environment).toUpperCase() === "PROD" ? "PROD" : "DEV";

function masterKey(): string {
  const key = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 16) throw errores.configuracion("MASTER_ENCRYPTION_KEY");
  return key;
}

/** client_id público de Partners (lo entrega Rappi) y URL de retorno registrada. */
function partnersSettings(environment: "DEV" | "PROD") {
  return {
    clientId: Deno.env.get(`RAPPI_PARTNERS_CLIENT_ID_${environment}`) ?? "",
    redirectUri: Deno.env.get("RAPPI_PARTNERS_REDIRECT_URI") ?? "https://restaurantes.enkrato.com/rappi/conectar",
    host: PARTNERS_HOST[environment],
  };
}

function config(body: Record<string, unknown>) {
  const settings = partnersSettings(environmentOf(body));
  return { available: Boolean(settings.clientId), redirect_uri: settings.redirectUri };
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function start(ctx: Contexto, body: Record<string, unknown>) {
  const environment = environmentOf(body);
  const settings = partnersSettings(environment);
  if (!settings.clientId) {
    throw new ErrorFuncion("RAPPI_PARTNERS_NOT_CONFIGURED", "Rappi aún no habilita la vinculación de cuentas.", 412);
  }
  await getConnection(ctx, environment);
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const { error } = await ctx.clienteAdmin().from("rappi_partner_links").insert({
    empresa_id: ctx.empresaId,
    user_id: ctx.authUserId,
    environment,
    state_hash: hex(await sha256(state)),
    code_verifier_ciphertext: await encryptText(verifier, masterKey()),
    expires_at: new Date(Date.now() + LINK_TTL_MS).toISOString(),
  });
  if (error) throw errores.baseDeDatos(error.message);

  const url = new URL(`${settings.host}/authorize`);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: "openid profile email",
    code_challenge: base64Url(await sha256(verifier)),
    code_challenge_method: "S256",
    state,
  }).toString();
  return { authorize_url: url.toString() };
}

type LinkRow = {
  id: string; empresa_id: string; user_id: string; environment: "DEV" | "PROD"; status: string;
  code_verifier_ciphertext: string; merchant_token_ciphertext: string | null;
  merchant_token_expires_at: string | null; expires_at: string;
};

async function finish(ctx: Contexto, body: Record<string, unknown>) {
  const state = text(body.state);
  const code = text(body.code);
  if (!state || !code) throw errores.datosIncompletos("state, code");
  const db = ctx.clienteAdmin();
  const { data: link } = await db.from("rappi_partner_links")
    .select("id, empresa_id, user_id, environment, status, code_verifier_ciphertext, merchant_token_ciphertext, merchant_token_expires_at, expires_at")
    .eq("state_hash", hex(await sha256(state))).maybeSingle<LinkRow>();
  // La marca debe ser de esta misma sesión: empresa y usuario que iniciaron.
  if (!link || link.empresa_id !== ctx.empresaId || link.user_id !== ctx.authUserId) {
    throw new ErrorFuncion("RAPPI_LINK_INVALID", "El enlace de vinculación no corresponde a tu sesión. Vuelve a iniciar desde Integración Rappi.", 403);
  }
  if (link.status !== "STARTED" || Date.parse(link.expires_at) < Date.now()) {
    throw new ErrorFuncion("RAPPI_LINK_EXPIRED", "El enlace de vinculación ya se usó o venció. Vuelve a iniciarlo.", 410);
  }

  const settings = partnersSettings(link.environment);
  const response = await fetch(`${settings.host}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: settings.clientId,
      code_verifier: await decryptText(link.code_verifier_ciphertext, masterKey()),
      redirect_uri: settings.redirectUri,
    }),
  });
  const tokens = await response.json().catch(() => ({})) as Record<string, unknown>;
  // Rappi exige el id_token (JWT firmado, 3 partes). El access_token es JWE y da 401.
  const idToken = text(tokens.id_token);
  if (!response.ok || idToken.split(".").length !== 3) {
    await db.from("rappi_partner_links").update({ status: "FAILED", last_error: `token ${response.status}` }).eq("id", link.id);
    throw new ErrorFuncion("RAPPI_LINK_TOKEN", "Rappi no confirmó el inicio de sesión. Vuelve a intentarlo.", 502);
  }
  const claims = decodeJwtPayload(idToken);
  const expMs = Number(claims.exp) * 1000;
  await db.from("rappi_partner_links").update({
    status: "AUTHORIZED",
    authorized_at: new Date().toISOString(),
    merchant_token_ciphertext: await encryptText(idToken, masterKey()),
    merchant_token_expires_at: Number.isFinite(expMs) ? new Date(expMs).toISOString() : null,
    merchant_email: text(claims.email) || null,
  }).eq("id", link.id);

  const connection = await getConnection(ctx, link.environment);
  const storesResponse = await rappiRequestWithStatus(db, connection, "OPERATIONAL",
    `${PUBLIC_API}/stores/integration-status`,
    { headers: { "Authorization-Partners": `Bearer ${idToken}` } });
  if (storesResponse.status < 200 || storesResponse.status >= 300) {
    throw new ErrorFuncion("RAPPI_HTTP", `Rappi no entregó las tiendas (${storesResponse.status}).`, 502);
  }
  return { link_id: link.id, merchant_email: text(claims.email) || null, stores: flattenStores(storesResponse.body) };
}

async function provision(ctx: Contexto, body: Record<string, unknown>) {
  const linkId = text(body.link_id);
  const wanted = Array.isArray(body.stores) ? body.stores as Record<string, unknown>[] : [];
  const stores = wanted
    .map((store) => ({ store_id: text(store.store_id), name: text(store.name) }))
    .filter((store) => /^\d+$/.test(store.store_id) && store.name);
  if (!linkId || !stores.length) throw errores.datosIncompletos("link_id, stores");
  if (stores.length > 20) throw new ErrorFuncion("RAPPI_TOO_MANY_STORES", "Rappi acepta máximo 20 tiendas por vez.", 400);

  const db = ctx.clienteAdmin();
  const { data: link } = await db.from("rappi_partner_links")
    .select("id, empresa_id, user_id, environment, status, code_verifier_ciphertext, merchant_token_ciphertext, merchant_token_expires_at, expires_at")
    .eq("id", linkId).maybeSingle<LinkRow>();
  if (!link || link.empresa_id !== ctx.empresaId || link.user_id !== ctx.authUserId || !link.merchant_token_ciphertext) {
    throw new ErrorFuncion("RAPPI_LINK_INVALID", "La vinculación no corresponde a tu sesión.", 403);
  }
  if (link.merchant_token_expires_at && Date.parse(link.merchant_token_expires_at) < Date.now()) {
    throw new ErrorFuncion("RAPPI_LINK_EXPIRED", "El inicio de sesión de Rappi venció. Vuelve a vincular.", 410);
  }

  const connection = await getConnection(ctx, link.environment);
  const response = await rappiRequestWithStatus(db, connection, "OPERATIONAL", `${PUBLIC_API}/stores/provisioning`, {
    method: "POST",
    headers: { "Authorization-Partners": `Bearer ${await decryptText(link.merchant_token_ciphertext, masterKey())}` },
    body: JSON.stringify({
      stores: stores.map((store) => ({
        ...store,
        status: "ACTIVE",
        store_integration_id: store.store_id,
        ping_active: true,
        cancellation_events: true,
      })),
    }),
  });
  const result = (response.body ?? {}) as Record<string, unknown>;
  const accepted = Array.isArray(result.accepted) ? (result.accepted as Record<string, unknown>[]).map((s) => text(s.store_id)) : [];
  await db.from("rappi_partner_links").update({
    status: response.status === 202 || accepted.length ? "PROVISIONED" : "FAILED",
    provisioned_store_ids: accepted,
    provisioned_at: new Date().toISOString(),
    last_error: response.status >= 300 ? `provisioning ${response.status}` : null,
  }).eq("id", link.id);
  if (response.status >= 300) {
    throw new ErrorFuncion("RAPPI_HTTP", `Rappi no aceptó las tiendas (${response.status}).`, response.status === 422 ? 422 : 502);
  }
  return { batch_id: text(result.batch_id) || null, accepted, rejected: result.rejected ?? [] };
}

async function getConnection(ctx: Contexto, environment: "DEV" | "PROD"): Promise<RappiConnection> {
  const { data, error } = await ctx.clienteAdmin().from("rappi_connections")
    .select("id, empresa_id, environment, status, operational_base_url, orders_base_url, financial_base_url, operational_enabled, financial_enabled")
    .eq("empresa_id", ctx.empresaId).eq("environment", environment).maybeSingle<RappiConnection>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!data) throw new ErrorFuncion("RAPPI_NOT_CONFIGURED", "Configura primero las credenciales de Rappi.", 412);
  return data;
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part.padEnd(part.length + (4 - part.length % 4) % 4, "=")));
  } catch {
    return {};
  }
}

/** integration-status trae tiendas padre con hijas; se aplanan para elegir. */
function flattenStores(value: unknown) {
  const root = (value ?? {}) as Record<string, unknown>;
  const list = Array.isArray(root.stores) ? root.stores as Record<string, unknown>[] : [];
  const out: { store_id: string; name: string; brand: string; integrated: boolean }[] = [];
  const push = (store: Record<string, unknown>) => out.push({
    store_id: text(store.store_id),
    name: text(store.name),
    brand: text(store.brand),
    integrated: store.integrated === true,
  });
  for (const store of list) {
    push(store);
    for (const child of Array.isArray(store.children) ? store.children as Record<string, unknown>[] : []) push(child);
  }
  return out.filter((store) => store.store_id);
}

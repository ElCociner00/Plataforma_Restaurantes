import { readFile } from "node:fs/promises";

const envPath = new URL("../.env", import.meta.url);
const env = parseEnv(await readFile(envPath, "utf8"));
const required = [
  "RAPPI_DEV_CLIENT_ID",
  "RAPPI_DEV_CLIENT_SECRET",
  "RAPPI_DEV_OPERATIONAL_BASE_URL",
  "RAPPI_DEV_STORE_ID",
];
for (const key of required) {
  if (!env[key]) throw new Error(`Falta ${key} en .env`);
}

const base = validateRappiUrl(env.RAPPI_DEV_OPERATIONAL_BASE_URL);
const auth = await request(`${base}/restaurants/auth/v1/token/login/integrations`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json" },
  body: JSON.stringify({
    client_id: env.RAPPI_DEV_CLIENT_ID,
    client_secret: env.RAPPI_DEV_CLIENT_SECRET,
  }),
});
const token = typeof auth.body?.access_token === "string" ? auth.body.access_token : "";
if (auth.status < 200 || auth.status >= 300 || !token) {
  throw new Error(`Autenticación Rappi DEV falló con HTTP ${auth.status}`);
}

const stores = await request(`${base}/api/v2/restaurants-integrations-public-api/stores-pa`, {
  headers: { accept: "application/json", "x-authorization": `Bearer ${token}` },
});
if (stores.status < 200 || stores.status >= 300) {
  throw new Error(`Consulta de tiendas Rappi DEV falló con HTTP ${stores.status}`);
}
const entries = asList(stores.body);
const ids = entries.map(storeId).filter(Boolean);
const events = [
  "NEW_ORDER",
  "ORDER_EVENT_CANCEL",
  "ORDER_OTHER_EVENT",
  "MENU_APPROVED",
  "MENU_REJECTED",
  "PING",
  "STORE_CONNECTIVITY",
  "ORDER_RT_TRACKING",
];
const webhookChecks = [];
const remoteWebhookUrls = [];
for (const event of events) {
  const webhook = await request(`${base}/api/v2/restaurants-integrations-public-api/webhook/${event}`, {
    headers: { accept: "application/json", "x-authorization": `Bearer ${token}` },
  });
  webhookChecks.push(webhookSummary(event, webhook));
  remoteWebhookUrls.push(...webhookUrls(webhook.body));
}
const webhookEndpoint = [...new Set(remoteWebhookUrls)][0] || "";
const endpointUrl = webhookEndpoint ? new URL(webhookEndpoint) : null;
if (endpointUrl && (endpointUrl.protocol !== "https:" || endpointUrl.hostname !== "tgkvcvnwwnrlyhbqmhaf.supabase.co")) {
  throw new Error("Rappi devolvió un destino webhook diferente al proyecto Supabase esperado");
}
const endpointProbe = endpointUrl ? await request(endpointUrl.toString(), { method: "GET" }) : null;

console.log(JSON.stringify({
  ok: true,
  environment: "DEV",
  auth_http_status: auth.status,
  expires_in_present: Number.isFinite(Number(auth.body?.expires_in)),
  stores_http_status: stores.status,
  stores_discovered: entries.length,
  configured_store_found: ids.includes(env.RAPPI_DEV_STORE_ID),
  webhooks: webhookChecks,
  webhook_endpoint_probe: endpointProbe ? {
    host: endpointUrl.hostname,
    http_status: endpointProbe.status,
    rejects_non_post_requests: endpointProbe.status === 405,
  } : null,
}, null, 2));

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\');
    }
    result[match[1]] = value;
  }
  return result;
}

function validateRappiUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(host === "rappi.com" || host.endsWith(".rappi.com"))) {
    throw new Error("RAPPI_DEV_OPERATIONAL_BASE_URL no es un host HTTPS oficial de Rappi");
  }
  return url.toString().replace(/\/+$/, "");
}

async function request(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const raw = await response.text();
  let body = {};
  if (raw.trim()) {
    try { body = JSON.parse(raw); } catch { body = {}; }
  }
  return { status: response.status, body };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "results", "items", "entries", "stores"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.keys(value).length ? [value] : [];
}

function storeId(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  return String(value.integrationId ?? value.store_id ?? value.id ?? "");
}

function webhookSummary(event, response) {
  const roots = asList(response.body);
  const configurations = roots.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if (Array.isArray(item.stores)) return item.stores;
    if (Array.isArray(item.data)) return item.data;
    return [item];
  });
  const storeIds = configurations.map(storeId).filter(Boolean);
  const enabled = configurations.filter((item) => {
    if (!item || typeof item !== "object") return false;
    return !item.state || String(item.state).toUpperCase() === "ENABLE";
  }).length;
  const urlHosts = configurations.flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.url !== "string") return [];
    try { return [new URL(item.url).hostname]; } catch { return []; }
  });
  return {
    event,
    http_status: response.status,
    configured: response.status >= 200 && response.status < 300 && storeIds.length > 0,
    configured_store_found: storeIds.includes(env.RAPPI_DEV_STORE_ID),
    stores: new Set(storeIds).size,
    enabled,
    url_hosts: [...new Set(urlHosts)],
  };
}

function webhookUrls(value) {
  return asList(value).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const configurations = Array.isArray(item.stores)
      ? item.stores
      : Array.isArray(item.data) ? item.data : [item];
    return configurations.flatMap((configuration) =>
      configuration && typeof configuration === "object" && typeof configuration.url === "string"
        ? [configuration.url]
        : []
    );
  });
}

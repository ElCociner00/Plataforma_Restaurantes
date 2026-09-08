import { readFile } from "node:fs/promises";

const env = parseEnv(await readFile(new URL("../.env", import.meta.url), "utf8"));
const base = String(env.LOGGRO_API_URL || "https://api.pirpos.com").replace(/\/+$/, "");
const baseUrl = new URL(base);
if (baseUrl.protocol !== "https:" || baseUrl.hostname !== "api.pirpos.com") {
  throw new Error("LOGGRO_API_URL debe apuntar al host HTTPS oficial api.pirpos.com");
}

const accounts = [
  ["factory", "LOGGRO_TEST_FACTORY_EMAIL", "LOGGRO_TEST_FACTORY_PASSWORD"],
  ["batut", "LOGGRO_TEST_BATUT_EMAIL", "LOGGRO_TEST_BATUT_PASSWORD"],
];
const results = [];
for (const [label, emailKey, passwordKey] of accounts) {
  if (!env[emailKey] || !env[passwordKey]) throw new Error(`Faltan ${emailKey}/${passwordKey} en .env`);
  results.push(await testAccount(label, env[emailKey], env[passwordKey]));
}

console.log(JSON.stringify({ ok: results.every((item) => item.ok), base_host: baseUrl.hostname, accounts: results }, null, 2));

async function testAccount(label, email, password) {
  const login = await request(`${base}/login`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const token = tokenFrom(login.body);
  if (login.status < 200 || login.status >= 300 || !token) {
    return { label, ok: false, login_http_status: login.status, error: "LOGIN_REJECTED" };
  }
  const jwt = decodeJwtPayload(token);
  const authHeaders = { accept: "application/json", authorization: `Bearer ${token}` };
  const today = new Date();
  const start = new Date(today.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const end = today.toISOString();
  const probes = [
    ["invoices_current", `/invoices?status=Pagada&dateInit=${encodeURIComponent(start)}&dateEnd=${encodeURIComponent(end)}`],
    ["expenses", `/expenses?dateInit=${encodeURIComponent(start)}&dateEnd=${encodeURIComponent(end)}`],
    ["ingredients_current", `/Ingredients?pagination=true&limit=1&page=0`],
    ["ingredients_documented", `/ingredients?pagination=true&limit=1&page=0`],
    ["inventories_current_get_probe", `/inventories?pagination=true&limit=1&page=0`],
    ["inventory_documented", `/inventory?pagination=true&limit=1&page=0`],
  ];
  const endpoints = [];
  for (const [name, path] of probes) {
    const response = await request(`${base}${path}`, { headers: authHeaders });
    endpoints.push({
      name,
      http_status: response.status,
      readable: response.status >= 200 && response.status < 300,
      response_shape: shapeOf(response.body),
      entries_observed: countEntries(response.body),
    });
  }
  return {
    label,
    ok: endpoints
      .filter((item) => ["invoices_current", "expenses", "ingredients_current", "ingredients_documented"].includes(item.name))
      .every((item) => item.readable),
    login_http_status: login.status,
    token_field: typeof login.body?.tokenCurrent === "string" ? "tokenCurrent" : "fallback",
    token_exp_claim_present: Number.isFinite(Number(jwt?.exp)),
    token_date_claim_present: Number.isFinite(Number(jwt?.date)),
    business_id_present: Boolean(login.body?.business?._id || login.body?.business?.id),
    endpoints,
  };
}

function tokenFrom(value) {
  if (!value || typeof value !== "object") return "";
  for (const candidate of [value.tokenCurrent, value.token, value.access_token, value.data?.tokenCurrent]) {
    if (typeof candidate === "string" && candidate.length > 20) return candidate;
  }
  return "";
}

function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    return JSON.parse(Buffer.from(part, "base64").toString("utf8"));
  } catch { return {}; }
}

function shapeOf(value) {
  if (Array.isArray(value)) return "array";
  if (!value || typeof value !== "object") return typeof value;
  const wrappers = ["data", "results", "items", "content", "docs"].filter((key) => Array.isArray(value[key]));
  return wrappers.length ? `object:${wrappers.join(",")}` : "object";
}

function countEntries(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  for (const key of ["data", "results", "items", "content", "docs"]) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  return Object.keys(value).length ? 1 : 0;
}

function parseEnv(source) {
  const result = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
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

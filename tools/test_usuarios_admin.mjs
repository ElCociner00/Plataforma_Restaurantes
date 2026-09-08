import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const env = parseEnv(await readFile(new URL(".env", root), "utf8"));
const config = await readFile(new URL("js/config.js", root), "utf8");
const supabaseUrl = config.match(/url:\s*"(https:\/\/[^"/]+\.supabase\.co)"/)?.[1];
const anonKey = config.match(/anonKey:\s*"([^"]+)"/)?.[1];

if (!supabaseUrl || !anonKey) throw new Error("No se pudo leer la configuracion publica de Supabase");
for (const key of ["ENKRATO_ADMIN_EMAIL", "ENKRATO_ADMIN_PASSWORD"]) {
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
const token = auth.body?.access_token;
if (auth.status !== 200 || !token) throw new Error(`Autenticacion rechazada (${auth.status})`);

const headers = {
  apikey: anonKey,
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const context = await request(`${supabaseUrl}/rest/v1/rpc/get_my_context`, {
  method: "POST",
  headers,
  body: "{}",
});
const ctx = Array.isArray(context.body) ? context.body[0] : context.body;
const empresaId = ctx?.empresa_id;
if (context.status !== 200 || !empresaId) throw new Error("No se pudo resolver la empresa autenticada");

const result = await request(`${supabaseUrl}/functions/v1/usuarios-admin`, {
  method: "POST",
  headers,
  body: JSON.stringify({ action: "listar_emails", empresa_id: empresaId }),
});
const usuarios = Array.isArray(result.body?.usuarios) ? result.body.usuarios : [];
const validRows = usuarios.every((item) =>
  typeof item?.id === "string" && item.id.length > 0 &&
  typeof item?.email === "string" && item.email.includes("@")
);
const uniqueIds = new Set(usuarios.map((item) => item.id)).size === usuarios.length;

console.log(JSON.stringify({
  ok: result.status === 200 && result.body?.ok === true && validRows && uniqueIds,
  auth_http_status: auth.status,
  context_http_status: context.status,
  function_http_status: result.status,
  company_context_resolved: Boolean(empresaId),
  users_returned: usuarios.length,
  rows_valid: validRows,
  ids_unique: uniqueIds,
  pii_omitted_from_output: true,
}, null, 2));

if (result.status !== 200 || result.body?.ok !== true || !validRows || !uniqueIds) {
  process.exitCode = 1;
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

async function request(url, init) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
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

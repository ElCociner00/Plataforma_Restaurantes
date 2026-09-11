import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptText, encryptText } from "../crypto.ts";
import { ErrorFuncion, errores } from "../errores.ts";
import type { RappiConnection, RappiScope } from "./types.ts";

type SecretRow = { client_id_ciphertext: string; client_secret_ciphertext: string };
type TokenRow = { access_token_ciphertext: string; token_type: string; expires_at: string };
type TokenSession = { token: string; tokenType: string; expiresAt: number };

const tokenCache = new Map<string, TokenSession>();
const tokenRequests = new Map<string, Promise<TokenSession>>();
const EXPIRY_MARGIN_MS = 10 * 60_000;

function masterKey(): string {
  const key = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY");
  if (!key || key.length < 16) throw errores.configuracion("MASTER_ENCRYPTION_KEY");
  return key;
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const isRappiHost = hostname === "rappi.com" || hostname.endsWith(".rappi.com");
  if (
    url.protocol !== "https:" || !isRappiHost || url.username || url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new ErrorFuncion("RAPPI_URL", "La URL debe ser un endpoint HTTPS oficial de Rappi.", 400);
  }
  return url.toString().replace(/\/+$/, "");
}

export async function getRappiToken(
  admin: SupabaseClient,
  connection: RappiConnection,
  scope: RappiScope,
  force = false,
): Promise<TokenSession> {
  const cacheKey = `${connection.id}:${scope}`;
  if (!force) {
    const cached = tokenCache.get(cacheKey);
    if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return cached;
    const inFlight = tokenRequests.get(cacheKey);
    if (inFlight) return await inFlight;
  }

  const request = resolveToken(admin, connection, scope, force)
    .finally(() => tokenRequests.delete(cacheKey));
  tokenRequests.set(cacheKey, request);
  const session = await request;
  tokenCache.set(cacheKey, session);
  return session;
}

async function resolveToken(
  admin: SupabaseClient,
  connection: RappiConnection,
  scope: RappiScope,
  force: boolean,
): Promise<TokenSession> {
  if (!force) {
    const { data: stored } = await admin
      .from("rappi_tokens")
      .select("access_token_ciphertext, token_type, expires_at")
      .eq("connection_id", connection.id)
      .eq("scope", scope)
      .maybeSingle<TokenRow>();
    const expiresAt = Date.parse(stored?.expires_at ?? "");
    if (stored?.access_token_ciphertext && Number.isFinite(expiresAt) && expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
      return {
        token: await decryptText(stored.access_token_ciphertext, masterKey()),
        tokenType: stored.token_type || "Bearer",
        expiresAt,
      };
    }
  }

  const { data: secret, error } = await admin
    .from("rappi_connection_secrets")
    .select("client_id_ciphertext, client_secret_ciphertext")
    .eq("connection_id", connection.id)
    .eq("scope", scope)
    .maybeSingle<SecretRow>();
  if (error) throw errores.baseDeDatos(error.message);
  if (!secret) {
    throw new ErrorFuncion(
      scope === "FINANCIAL" ? "RAPPI_FINANCIAL_NOT_CONFIGURED" : "RAPPI_NOT_CONFIGURED",
      scope === "FINANCIAL"
        ? "Las credenciales Financial de Rappi aún no están configuradas."
        : "Las credenciales operativas de Rappi aún no están configuradas.",
      412,
    );
  }

  const clientId = await decryptText(secret.client_id_ciphertext, masterKey());
  const clientSecret = await decryptText(secret.client_secret_ciphertext, masterKey());
  const base = scope === "FINANCIAL" ? connection.financial_base_url : connection.operational_base_url;
  const loginPath = scope === "FINANCIAL"
    ? "/restaurants/auth/v1/token/login/finance/"
    : "/restaurants/auth/v1/token/login/integrations";
  const response = await fetchJson(`${normalizeBaseUrl(base)}${loginPath}`, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });
  const body = response.body as Record<string, unknown>;
  const token = typeof body.access_token === "string" ? body.access_token : "";
  if (!token) throw new ErrorFuncion("RAPPI_NO_TOKEN", "Rappi respondió sin token de acceso.", 502);
  const expiresInRaw = Number(body.expires_in);
  if (!Number.isFinite(expiresInRaw) || expiresInRaw <= 0) {
    throw new ErrorFuncion(
      "RAPPI_TOKEN_EXPIRY_MISSING",
      "Rappi respondió sin una expiración de token válida.",
      502,
    );
  }
  const expiresIn = Math.max(60, expiresInRaw);
  const session = {
    token,
    tokenType: typeof body.token_type === "string" ? body.token_type : "Bearer",
    expiresAt: Date.now() + expiresIn * 1000,
  };
  const { error: saveError } = await admin.from("rappi_tokens").upsert({
    connection_id: connection.id,
    scope,
    access_token_ciphertext: await encryptText(token, masterKey()),
    token_type: session.tokenType,
    issued_at: new Date().toISOString(),
    expires_at: new Date(session.expiresAt).toISOString(),
  }, { onConflict: "connection_id,scope" });
  if (saveError) console.error("[rappi] no se pudo guardar token:", saveError.message);
  return session;
}

export async function rappiRequest(
  admin: SupabaseClient,
  connection: RappiConnection,
  scope: RappiScope,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await rappiRequestWithStatus(admin, connection, scope, pathOrUrl, init);
  if (response.status < 200 || response.status >= 300) {
    throwRappiHttp(response.status, pathOrUrl);
  }
  return response.body;
}

/**
 * Igual que rappiRequest, pero entrega el código HTTP en vez de lanzar. Lo
 * necesitan las acciones donde un 4xx es una respuesta de negocio: al tomar
 * una orden, 400 significa "ya no está esperando aceptación".
 */
export async function rappiRequestWithStatus(
  admin: SupabaseClient,
  connection: RappiConnection,
  scope: RappiScope,
  pathOrUrl: string,
  init: RequestInit = {},
): Promise<{ status: number; body: unknown }> {
  let session = await getRappiToken(admin, connection, scope);
  let response = await call(connection, scope, pathOrUrl, session.token, init);
  if (response.status === 401 || response.status === 403) {
    tokenCache.delete(`${connection.id}:${scope}`);
    session = await getRappiToken(admin, connection, scope, true);
    response = await call(connection, scope, pathOrUrl, session.token, init);
  }
  return response;
}

async function call(
  connection: RappiConnection,
  scope: RappiScope,
  pathOrUrl: string,
  token: string,
  init: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const base = scope === "FINANCIAL" ? connection.financial_base_url : connection.operational_base_url;
  const url = /^https:\/\//i.test(pathOrUrl)
    ? normalizeBaseUrl(pathOrUrl)
    : `${normalizeBaseUrl(base)}${pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`}`;
  return await fetchJson(url, {
    ...init,
    headers: {
      "accept": "application/json",
      "x-authorization": `Bearer ${token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  }, false);
}

async function fetchJson(
  url: string,
  init: RequestInit,
  throwOnHttpError = true,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const configuredTimeout = Number(Deno.env.get("RAPPI_TIMEOUT_MS") ?? "20000");
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(1000, configuredTimeout) : 20_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ErrorFuncion("RAPPI_TIMEOUT", "Rappi no respondió dentro del tiempo esperado.", 504);
    }
    throw new ErrorFuncion("RAPPI_UNREACHABLE", "No se pudo conectar con Rappi.", 502, error);
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body: unknown = {};
  if (text.trim()) {
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
  }
  if (!response.ok && throwOnHttpError) throwRappiHttp(response.status, url);
  return { status: response.status, body };
}

function throwRappiHttp(status: number, pathOrUrl: string): never {
  const code = status === 401 || status === 403
    ? "RAPPI_AUTH"
    : status === 429 ? "RAPPI_RATE_LIMIT" : "RAPPI_HTTP";
  let path = pathOrUrl;
  try { path = new URL(pathOrUrl).pathname; } catch { /* ya es una ruta */ }
  throw new ErrorFuncion(code, `Rappi devolvió un error (${status}).`, status >= 500 ? 502 : status, {
    status,
    path,
  });
}

export function clearRappiTokenCache(connectionId?: string): void {
  if (!connectionId) return tokenCache.clear();
  for (const key of tokenCache.keys()) if (key.startsWith(`${connectionId}:`)) tokenCache.delete(key);
}

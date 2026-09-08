/**
 * CORS compartido para las Edge Functions de Enkrato.
 *
 * El navegador llama a estas funciones desde restaurantes.enkrato.com y, en
 * desarrollo, desde Live Server. Sin cabeceras CORS el preflight falla y la
 * petición nunca llega a ejecutarse.
 *
 * No se usa "*" por defecto: estas funciones reciben un JWT en la cabecera
 * Authorization, y una lista explícita de orígenes evita que cualquier página
 * de terceros pueda invocarlas desde el navegador de un usuario con sesión
 * abierta. La lista se puede ampliar sin tocar código con la variable de
 * entorno ALLOWED_ORIGINS (separada por comas).
 */

const ORIGENES_POR_DEFECTO = [
  "https://restaurantes.enkrato.com",
  "https://plataforma-restaurantes-8f561.web.app",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const origenesPermitidos = (): string[] => {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...ORIGENES_POR_DEFECTO, ...extra];
};

export const corsHeaders = (origin: string | null): Record<string, string> => {
  const permitidos = origenesPermitidos();
  const elegido = origin && permitidos.includes(origin) ? origin : permitidos[0];

  return {
    "Access-Control-Allow-Origin": elegido,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-tenant-id, x-user-id, x-user-role",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
};

/** Respuesta JSON con CORS ya aplicado. */
export const json = (
  body: unknown,
  status: number,
  origin: string | null,
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });

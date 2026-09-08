/**
 * Cliente de Loggro / pirpos con credenciales POR EMPRESA.
 *
 * Es el módulo del que depende todo módulo que hable con la plataforma externa:
 * cierre de turno, gastos, inventarios, propinas y compras. Si esto falla,
 * falla la plataforma entera. Por eso vive aislado y sin ninguna dependencia
 * de las funciones que lo consumen.
 *
 * ── Cómo era en n8n ────────────────────────────────────────────────────────
 * El flujo `consultar_ventas` tenía DOS nodos HTTP con el correo y la
 * contraseña escritos a mano dentro del JSON, uno por cada empresa del grupo
 * Batut. Añadir un cliente significaba clonar el flujo y editar el literal.
 *
 * ── Cómo es aquí ───────────────────────────────────────────────────────────
 * Nada está escrito a mano. Para cada empresa:
 *   1. Caché en memoria del isolate (evita ir a la base en ráfagas).
 *   2. Caché en base: credenciales_plataforma.token + token_expira_en.
 *   3. Si no hay token vigente, se leen usuario y contraseña de
 *      integraciones_credenciales, se descifra la contraseña (AES-GCM) y se
 *      pide un token nuevo a POST /login.
 *   4. El token se guarda para la siguiente petición.
 *
 * La URL del API también es por empresa: integraciones_credenciales.url_api,
 * luego credenciales_plataforma.url_plataforma, y por último la variable de
 * entorno. Una empresa en un despliegue distinto de Loggro funciona sin tocar
 * código.
 */

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { decryptText } from "./crypto.ts";
import { ErrorFuncion, errores } from "./errores.ts";

export const PLATAFORMA = "loggro";

const URL_API_POR_DEFECTO = "https://api.pirpos.com";
const RUTA_LOGIN = Deno.env.get("LOGGRO_LOGIN_PATH") ?? "/login";
const TIMEOUT_MS = Number(Deno.env.get("LOGGRO_TIMEOUT_MS") ?? "15000");
const TTL_MINUTOS = Number(Deno.env.get("LOGGRO_TOKEN_TTL_MIN") ?? "720");
const DEBUG = (Deno.env.get("LOGGRO_DEBUG") ?? "").toLowerCase() === "true";

/** Margen antes de considerar caducado un token, para no usarlo justo al filo. */
const MARGEN_MS = 60_000;

export type SesionLoggro = {
  empresaId: string;
  token: string;
  tenantId: string | null;
  urlApi: string;
  expiraEn: number;
};

/** Caché por isolate. Se pierde en cada arranque en frío: es solo un atajo. */
const cacheMemoria = new Map<string, SesionLoggro>();

/** Peticiones de login en vuelo, para que N llamadas paralelas hagan 1 login. */
const loginsEnVuelo = new Map<string, Promise<SesionLoggro>>();

function ahora(): number {
  return Date.now();
}

function vigente(sesion: SesionLoggro | undefined): sesion is SesionLoggro {
  return Boolean(sesion && sesion.token && sesion.expiraEn - MARGEN_MS > ahora());
}

function llaveMaestra(): string {
  // Sin valor por defecto a propósito: una llave de relleno haría que las
  // contraseñas quedaran "cifradas" con un secreto público.
  const llave = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY");
  if (!llave || llave.length < 16) {
    throw errores.configuracion(
      "MASTER_ENCRYPTION_KEY ausente o demasiado corta (mínimo 16 caracteres)",
    );
  }
  return llave;
}

async function fetchConTimeout(url: string, init: RequestInit): Promise<Response> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      throw new ErrorFuncion(
        "LOGGRO_TIMEOUT",
        `Loggro no respondió en ${Math.round(TIMEOUT_MS / 1000)} segundos.`,
        504,
      );
    }
    throw new ErrorFuncion("LOGGRO_INALCANZABLE", "No se pudo conectar con Loggro.", 502, error);
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Busca el token en la respuesta de /login.
 *
 * Verificado contra api.pirpos.com el 2026-08-22: la respuesta es el objeto
 * del usuario y el token viaja en `tokenCurrent`, no en `token` ni en
 * `access_token`. El resto de candidatos quedan por si otro despliegue de
 * Loggro responde con la forma más habitual.
 */
function extraerToken(cuerpo: unknown): string | null {
  if (typeof cuerpo === "string" && cuerpo.length > 20) return cuerpo;
  if (!cuerpo || typeof cuerpo !== "object") return null;

  const o = cuerpo as Record<string, unknown>;
  const candidatos = [
    o.tokenCurrent, o.token_current,
    o.token, o.access_token, o.accessToken, o.jwt, o.id_token,
    (o.data as Record<string, unknown> | undefined)?.tokenCurrent,
    (o.data as Record<string, unknown> | undefined)?.token,
    (o.data as Record<string, unknown> | undefined)?.access_token,
    (o.result as Record<string, unknown> | undefined)?.token,
  ];
  for (const c of candidatos) {
    if (typeof c === "string" && c.length > 20) return c;
  }
  return null;
}

/**
 * Identificador del negocio al que pertenece la empresa.
 *
 * Verificado contra api.pirpos.com: está en `business._id`, y ese valor es
 * exactamente el que las filas de credenciales_plataforma ya guardaban en
 * plataforma_tenant_id. Es el que después se compara con el `businessId` de
 * cada factura para aislar una empresa de otra.
 *
 * OJO: la reclamación `sub` del token NO sirve para esto. Contiene el id del
 * USUARIO de Loggro (`_id` de primer nivel), no el del negocio; usarla haría
 * que el filtro por negocio no coincidiera nunca y devolviera cero ventas.
 */
function extraerTenant(cuerpo: unknown): string | null {
  if (!cuerpo || typeof cuerpo !== "object") return null;

  const o = cuerpo as Record<string, unknown>;
  const negocio = (o.business ?? {}) as Record<string, unknown>;
  const usuario = (o.user ?? o.usuario ?? {}) as Record<string, unknown>;

  const candidatos = [
    negocio._id, negocio.id,
    o.businessId, o.business_id,
    o.tenantId, o.tenant_id, o.tenant,
    o.companyId, o.company_id, o.company,
    usuario.company, usuario.companyId, usuario.tenantId,
  ];

  for (const c of candidatos) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

type FilaCredencial = {
  usuario: string;
  password: string;
  url_api: string | null;
};

type FilaToken = {
  token: string | null;
  url_plataforma: string | null;
  plataforma_tenant_id: string | null;
  token_expira_en: string | null;
};

/**
 * Devuelve una sesión válida de Loggro para la empresa indicada.
 *
 * @param admin      cliente con service_role: integraciones_credenciales tiene
 *                   SELECT denegado por RLS a propósito, nadie más puede leerla.
 * @param empresaId  tenant. Siempre viene del contexto, nunca del navegador.
 */
export async function obtenerSesionLoggro(
  admin: SupabaseClient,
  empresaId: string,
  opciones: { forzarRenovacion?: boolean } = {},
): Promise<SesionLoggro> {
  if (!empresaId) throw errores.sinContexto();

  if (!opciones.forzarRenovacion) {
    const enMemoria = cacheMemoria.get(empresaId);
    if (vigente(enMemoria)) return enMemoria;

    const enVuelo = loginsEnVuelo.get(empresaId);
    if (enVuelo) return await enVuelo;
  }

  const promesa = resolverSesion(admin, empresaId, opciones.forzarRenovacion === true)
    .finally(() => loginsEnVuelo.delete(empresaId));

  loginsEnVuelo.set(empresaId, promesa);
  return await promesa;
}

async function resolverSesion(
  admin: SupabaseClient,
  empresaId: string,
  forzar: boolean,
): Promise<SesionLoggro> {
  // ── Paso 1: token cacheado en base ──────────────────────────────────────
  const { data: filaToken } = await admin
    .from("credenciales_plataforma")
    .select("token, url_plataforma, plataforma_tenant_id, token_expira_en")
    .eq("empresa_id", empresaId)
    .eq("plataforma", PLATAFORMA)
    .eq("activo", true)
    .maybeSingle<FilaToken>();

  const urlDesdeToken = (filaToken?.url_plataforma ?? "").trim();

  if (!forzar && filaToken?.token && filaToken.token_expira_en) {
    const expira = Date.parse(filaToken.token_expira_en);
    if (Number.isFinite(expira) && expira - MARGEN_MS > ahora()) {
      const sesion: SesionLoggro = {
        empresaId,
        token: filaToken.token,
        tenantId: filaToken.plataforma_tenant_id ?? null,
        urlApi: normalizarUrl(urlDesdeToken || urlPorDefecto()),
        expiraEn: expira,
      };
      cacheMemoria.set(empresaId, sesion);
      return sesion;
    }
  }

  // ── Paso 2: credenciales de la empresa ─────────────────────────────────
  const { data: credencial, error: errorCredencial } = await admin
    .from("integraciones_credenciales")
    .select("usuario, password, url_api")
    .eq("empresa_id", empresaId)
    .eq("plataforma", PLATAFORMA)
    .eq("activo", true)
    .maybeSingle<FilaCredencial>();

  if (errorCredencial) throw errores.baseDeDatos(errorCredencial.message);

  if (!credencial?.usuario || !credencial?.password) {
    throw new ErrorFuncion(
      "SIN_CREDENCIALES",
      "Esta empresa no tiene credenciales de Loggro configuradas. Ve a Configuración → Loggro.",
      412,
    );
  }

  const urlApi = normalizarUrl(
    (credencial.url_api ?? "").trim() || urlDesdeToken || urlPorDefecto(),
  );

  let password: string;
  try {
    // decryptText devuelve el texto tal cual si no lleva el prefijo `enc:`,
    // así que las filas heredadas en claro siguen funcionando mientras se migran.
    password = await decryptText(credencial.password, llaveMaestra());
  } catch (error) {
    console.error(`[loggro] No se pudo descifrar la credencial de ${empresaId}`, error);
    throw new ErrorFuncion(
      "CREDENCIAL_ILEGIBLE",
      "Las credenciales guardadas no se pueden leer. Vuelve a guardarlas en Configuración → Loggro.",
      500,
    );
  }

  // ── Paso 3: login ───────────────────────────────────────────────────────
  const sesion = await iniciarSesion(empresaId, urlApi, credencial.usuario, password);

  // ── Paso 4: persistir el token para las siguientes peticiones ──────────
  await guardarToken(admin, sesion);

  cacheMemoria.set(empresaId, sesion);
  return sesion;
}

function urlPorDefecto(): string {
  return (Deno.env.get("LOGGRO_API_URL") ?? "").trim() || URL_API_POR_DEFECTO;
}

function normalizarUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** POST /login con el usuario y la contraseña de ESTA empresa. */
export async function iniciarSesion(
  empresaId: string,
  urlApi: string,
  usuario: string,
  password: string,
): Promise<SesionLoggro> {
  const respuesta = await fetchConTimeout(`${urlApi}${RUTA_LOGIN}`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email: usuario, password }),
  });

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    if (DEBUG) console.error(`[loggro] login ${respuesta.status}:`, texto.slice(0, 500));
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ErrorFuncion(
        "LOGGRO_CREDENCIALES",
        "Loggro rechazó las credenciales de esta empresa. Revísalas en Configuración → Loggro.",
        401,
      );
    }
    throw new ErrorFuncion(
      "LOGGRO_LOGIN_FALLIDO",
      "Loggro no permitió iniciar sesión en este momento.",
      502,
    );
  }

  let cuerpo: unknown = texto;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    // Algunos despliegues devuelven el token en texto plano.
  }

  const token = extraerToken(cuerpo);
  if (!token) {
    if (DEBUG) console.error("[loggro] respuesta de login sin token:", texto.slice(0, 500));
    throw new ErrorFuncion(
      "LOGGRO_SIN_TOKEN",
      "Loggro respondió sin token de acceso.",
      502,
    );
  }

  return {
    empresaId,
    token,
    tenantId: extraerTenant(cuerpo),
    urlApi,
    expiraEn: ahora() + TTL_MINUTOS * 60_000,
  };
}

async function guardarToken(admin: SupabaseClient, sesion: SesionLoggro): Promise<void> {
  const fila = {
    empresa_id: sesion.empresaId,
    plataforma: PLATAFORMA,
    token: sesion.token,
    url_plataforma: sesion.urlApi,
    activo: true,
    token_expira_en: new Date(sesion.expiraEn).toISOString(),
    token_actualizado_en: new Date().toISOString(),
    ultimo_error: null,
    ...(sesion.tenantId ? { plataforma_tenant_id: sesion.tenantId } : {}),
  };

  const { error } = await admin
    .from("credenciales_plataforma")
    .upsert(fila, { onConflict: "empresa_id,plataforma" });

  if (error) {
    // Un fallo aquí no debe tumbar la petición: la sesión en memoria sirve.
    console.error("[loggro] No se pudo cachear el token:", error.message);
  }
}

/**
 * Llama al API de Loggro con el token de la empresa.
 * Si el proveedor responde 401/403, renueva el token UNA vez y reintenta:
 * es lo que hacía a mano el cron `Reinicio_Credenciales_loggro`.
 */
export async function pedirLoggro(
  admin: SupabaseClient,
  empresaId: string,
  ruta: string,
  init: RequestInit = {},
): Promise<unknown> {
  let sesion = await obtenerSesionLoggro(admin, empresaId);
  let respuesta = await llamar(sesion, ruta, init);

  if (respuesta.status === 401 || respuesta.status === 403) {
    cacheMemoria.delete(empresaId);
    sesion = await obtenerSesionLoggro(admin, empresaId, { forzarRenovacion: true });
    respuesta = await llamar(sesion, ruta, init);
  }

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    if (DEBUG) console.error(`[loggro] ${ruta} → ${respuesta.status}:`, texto.slice(0, 800));
    await admin
      .from("credenciales_plataforma")
      .update({ ultimo_error: `${respuesta.status} en ${ruta}` })
      .eq("empresa_id", empresaId)
      .eq("plataforma", PLATAFORMA);

    throw new ErrorFuncion(
      "LOGGRO_ERROR",
      `Loggro devolvió un error (${respuesta.status}) al consultar los datos.`,
      502,
    );
  }

  if (!texto.trim()) return [];
  try {
    return JSON.parse(texto);
  } catch {
    throw new ErrorFuncion("LOGGRO_RESPUESTA", "Loggro devolvió una respuesta ilegible.", 502);
  }
}

function llamar(sesion: SesionLoggro, ruta: string, init: RequestInit): Promise<Response> {
  const url = ruta.startsWith("http") ? ruta : `${sesion.urlApi}${ruta}`;
  return fetchConTimeout(url, {
    ...init,
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${sesion.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/** Normaliza a arreglo lo que el proveedor puede devolver envuelto. */
export function comoLista(cuerpo: unknown): Record<string, unknown>[] {
  if (Array.isArray(cuerpo)) return cuerpo as Record<string, unknown>[];
  if (cuerpo && typeof cuerpo === "object") {
    const o = cuerpo as Record<string, unknown>;
    for (const clave of ["data", "results", "items", "content", "docs"]) {
      if (Array.isArray(o[clave])) return o[clave] as Record<string, unknown>[];
    }
  }
  return [];
}

/** Solo para pruebas y para el cron: vacía la caché del isolate. */
export function limpiarCache(empresaId?: string): void {
  if (empresaId) cacheMemoria.delete(empresaId);
  else cacheMemoria.clear();
}

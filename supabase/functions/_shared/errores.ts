/**
 * Errores y respuestas uniformes para todas las Edge Functions de Enkrato.
 *
 * Regla: el mensaje que sale al navegador nunca revela detalle interno
 * (nombres de tabla, SQL, respuesta cruda del proveedor). El detalle va a
 * console.error, que queda en los logs de Supabase.
 */

import { json } from "./cors.ts";

export class ErrorFuncion extends Error {
  constructor(
    public codigo: string,
    public mensajePublico: string,
    public status: number,
    public detalle?: unknown,
  ) {
    super(mensajePublico);
    this.name = "ErrorFuncion";
  }
}

/** Atajos para los errores que se repiten en todas las funciones. */
export const errores = {
  sinToken: () =>
    new ErrorFuncion("SIN_TOKEN", "Falta el token de sesión.", 401),
  noAutenticado: () =>
    new ErrorFuncion("NO_AUTENTICADO", "Tu sesión no es válida o expiró.", 401),
  sinContexto: () =>
    new ErrorFuncion("SIN_CONTEXTO", "Tu cuenta no está vinculada a ninguna empresa.", 403),
  sinPermisos: (que = "realizar esta acción") =>
    new ErrorFuncion("SIN_PERMISOS", `No tienes permisos para ${que}.`, 403),
  fueraDeAlcance: () =>
    new ErrorFuncion("FUERA_DE_ALCANCE", "La empresa solicitada no está en tu alcance.", 403),
  jsonInvalido: () =>
    new ErrorFuncion("JSON_INVALIDO", "El cuerpo de la petición no es JSON válido.", 400),
  datosIncompletos: (campos: string) =>
    new ErrorFuncion("DATOS_INCOMPLETOS", `Faltan datos obligatorios: ${campos}.`, 400),
  metodoNoPermitido: () =>
    new ErrorFuncion("METODO_NO_PERMITIDO", "Usa POST.", 405),
  configuracion: (que: string) =>
    new ErrorFuncion("CONFIG_FALTANTE", "La función no está configurada correctamente.", 500, que),
  baseDeDatos: (detalle?: unknown) =>
    new ErrorFuncion("DB_ERROR", "No se pudo completar la operación en base de datos.", 500, detalle),
};

/** Convierte cualquier excepción en una respuesta HTTP con CORS. */
export function responderError(
  error: unknown,
  origin: string | null,
  etiqueta: string,
): Response {
  if (error instanceof ErrorFuncion) {
    if (error.status >= 500) {
      console.error(`[${etiqueta}] ${error.codigo}:`, error.mensajePublico, error.detalle ?? "");
    } else {
      console.info(`[${etiqueta}] ${error.codigo}: ${error.mensajePublico}`);
    }
    return json(
      { ok: false, codigo: error.codigo, message: error.mensajePublico },
      error.status,
      origin,
    );
  }

  console.error(`[${etiqueta}] Error no controlado:`, error);
  return json(
    { ok: false, codigo: "ERROR_INTERNO", message: "Ocurrió un error inesperado." },
    500,
    origin,
  );
}

/** Lee y valida el cuerpo JSON de la petición. */
export async function leerCuerpo(req: Request): Promise<Record<string, unknown>> {
  const texto = await req.text();
  if (!texto.trim()) return {};
  try {
    const parseado = JSON.parse(texto);
    return (parseado && typeof parseado === "object") ? parseado as Record<string, unknown> : {};
  } catch {
    throw errores.jsonInvalido();
  }
}

/** Variable de entorno obligatoria: si falta, la función falla en arranque. */
export function envObligatorio(nombre: string): string {
  const valor = Deno.env.get(nombre);
  if (!valor) throw errores.configuracion(`Falta la variable de entorno ${nombre}`);
  return valor;
}

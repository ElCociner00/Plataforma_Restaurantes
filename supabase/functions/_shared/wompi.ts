/**
 * Wompi (Bancolombia) — utilidades compartidas.
 *
 * Wompi maneja CUATRO credenciales y cada una tiene un papel distinto. Es la
 * fuente de confusión más común, así que queda escrito aquí:
 *
 *   pub_prod_…        Llave pública.      Puede ir en el navegador.
 *   prv_prod_…        Llave privada.      Solo servidor. Consultar y crear
 *                                         transacciones, fuentes de pago.
 *   prod_events_…     Secreto de eventos. Solo servidor. Valida que un webhook
 *                                         viene de verdad de Wompi.
 *   prod_integrity_…  Secreto integridad. Solo servidor. Firma el monto y la
 *                                         referencia para que el cliente no
 *                                         pueda cambiarlos en el navegador.
 *
 * Las tres últimas viven en los secretos de Supabase y NUNCA en el repositorio
 * ni en el frontend.
 *
 * Documentación:
 *   https://docs.wompi.co/docs/colombia/ambientes-y-llaves/
 *   https://docs.wompi.co/docs/colombia/widget-checkout-web/
 *   https://docs.wompi.co/docs/colombia/eventos/
 */

export const WOMPI_CHECKOUT = "https://checkout.wompi.co/p/";

/** Ambiente deducido del prefijo de la llave: no se configura por separado. */
export function baseApi(llavePublica: string): string {
  return llavePublica.startsWith("pub_prod_")
    ? "https://production.wompi.co/v1"
    : "https://sandbox.wompi.co/v1";
}

/** SHA-256 en hexadecimal minúsculo. */
async function sha256Hex(texto: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Firma de integridad del Checkout Web.
 *
 * Concatenación EXACTA, sin separadores:
 *     <referencia><montoEnCentavos><moneda>[<expiracion>]<secretoIntegridad>
 *
 * Sin esto, cualquiera podría abrir las herramientas del navegador y cambiar
 * amount-in-cents de 5990000 a 100 antes de enviar el formulario.
 */
export function firmaIntegridad(
  referencia: string,
  montoEnCentavos: number,
  moneda: string,
  secretoIntegridad: string,
  expiracion?: string | null,
): Promise<string> {
  const cadena = expiracion
    ? `${referencia}${montoEnCentavos}${moneda}${expiracion}${secretoIntegridad}`
    : `${referencia}${montoEnCentavos}${moneda}${secretoIntegridad}`;
  return sha256Hex(cadena);
}

/** Lee una ruta con puntos ("transaction.id") dentro del objeto data del evento. */
function leerRuta(objeto: unknown, ruta: string): unknown {
  return ruta.split(".").reduce<unknown>(
    (acc, parte) => (acc && typeof acc === "object") ? (acc as Record<string, unknown>)[parte] : undefined,
    objeto,
  );
}

export type EventoWompi = {
  event: string;
  data: Record<string, unknown>;
  environment?: string;
  signature?: { properties?: string[]; checksum?: string };
  timestamp?: number;
  sent_at?: string;
};

/**
 * Valida el checksum de un evento.
 *
 * Receta oficial, en este orden:
 *   1. concatenar el VALOR de cada ruta listada en signature.properties
 *   2. concatenar el timestamp del evento
 *   3. concatenar el secreto de eventos
 *   4. SHA-256 y comparar con signature.checksum (o la cabecera X-Event-Checksum)
 *
 * Las propiedades NO se asumen fijas: se leen del propio evento, porque varían
 * según el tipo. La comparación es en tiempo constante.
 */
export async function checksumValido(
  evento: EventoWompi,
  secretoEventos: string,
  checksumCabecera?: string | null,
): Promise<boolean> {
  const propiedades = evento?.signature?.properties;
  const esperado = (evento?.signature?.checksum ?? checksumCabecera ?? "").trim();

  if (!Array.isArray(propiedades) || propiedades.length === 0) return false;
  if (!esperado) return false;

  let cadena = "";
  for (const ruta of propiedades) {
    const valor = leerRuta(evento.data, ruta);
    if (valor === undefined || valor === null) return false;
    cadena += String(valor);
  }
  cadena += String(evento.timestamp ?? "");
  cadena += secretoEventos;

  const calculado = await sha256Hex(cadena);
  return comparacionSegura(calculado.toLowerCase(), esperado.toLowerCase());
}

/** Comparación de tiempo constante: no filtra en qué carácter falla. */
export function comparacionSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferencia === 0;
}

/**
 * Consulta una transacción en la API de Wompi.
 *
 * ESTA es la fuente de verdad (§4.2 paso c del plan). El cuerpo del webhook se
 * usa para saber QUÉ mirar; el estado y el monto se toman siempre de aquí, con
 * la llave privada. Nunca al revés.
 */
export async function consultarTransaccion(
  id: string,
  llavePublica: string,
  llavePrivada: string,
): Promise<Record<string, unknown> | null> {
  const respuesta = await fetch(`${baseApi(llavePublica)}/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${llavePrivada}` },
  });

  if (!respuesta.ok) {
    console.error("[wompi] consultarTransaccion", id, respuesta.status, await respuesta.text());
    return null;
  }

  const cuerpo = await respuesta.json();
  return (cuerpo?.data ?? null) as Record<string, unknown> | null;
}

/** Traduce el método de pago de Wompi al canal que guarda la base. */
export function canalDesdeWompi(tipo: unknown): string {
  switch (String(tipo ?? "").toUpperCase()) {
    case "CARD":                  return "tarjeta";
    case "PSE":                   return "pse";
    case "NEQUI":                 return "nequi";
    case "BANCOLOMBIA_TRANSFER":
    case "BANCOLOMBIA_QR":
    case "BANCOLOMBIA_COLLECT":   return "bancolombia";
    case "DAVIPLATA":             return "daviplata";
    default:                      return "otro";
  }
}

/** Wompi trabaja en centavos; la base guarda pesos. Un solo sitio que convierte. */
export const aCentavos = (pesos: number): number => Math.round(Number(pesos) * 100);
export const aPesos    = (centavos: number): number => Number(centavos) / 100;

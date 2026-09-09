/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/edge_function_error.js
 *
 * Partes del archivo:
 * 1) Utilidad única: `mensajeDeError`.
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `mensajeDeError` (línea aprox. 30): saca el mensaje real de un error de invoke().
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */

// Por qué existe este archivo
// ============================
// `supabase.functions.invoke()` NO lanza con el cuerpo de la respuesta cuando
// la Edge Function responde con un status distinto de 2xx. Lanza un
// `FunctionsHttpError` cuyo `.message` es siempre el mismo texto genérico
// —"Edge Function returned a non-2xx status code"— y deja la Response entera
// en `.context`. El mensaje que la función escribió con cuidado
// ({ ok:false, codigo, message }, ver supabase/functions/_shared/errores.ts)
// se queda ahí dentro y nunca llega al usuario si no se lee a mano.
//
// Sin esto, un 401 por sesión vencida, un 500 de Loggro, o un 403 explicado
// se ven todos en pantalla como la misma cadena en inglés sin pistas —
// indistinguibles entre sí, y sin forma de saber qué falló de verdad.
//
// Se extrajo de `js/facturacion.js` (donde se detectó primero, en el flujo de
// pago) para reutilizarlo en cualquier `functions.invoke()` del proyecto.

/**
 * @param {unknown} error   El `error` que devuelve `supabase.functions.invoke()`.
 * @param {unknown} [data]  El `data` de la misma llamada, por si la función
 *                          respondió 2xx pero con `{ ok:false, message }`.
 * @param {string} porDefecto  Texto a mostrar si no se pudo extraer nada útil.
 */
export async function mensajeDeError(error, data, porDefecto) {
  if (data && typeof data === "object" && data.ok === false && data.message) {
    return String(data.message);
  }

  const respuesta = error?.context;

  if (respuesta && typeof respuesta.json === "function") {
    try {
      const cuerpo = await respuesta.json();
      if (cuerpo?.message) return String(cuerpo.message);
    } catch (_error) {
      // Cuerpo vacío, no-JSON, o ya consumido (una Response solo se puede leer
      // una vez). Se cae al genérico de abajo.
    }
  }

  // Un fallo de red o de sesión sí trae un mensaje propio que vale la pena
  // enseñar; el de la Edge Function no dice nada y se sustituye.
  const propio = String(error?.message || "");
  if (propio && !propio.includes("non-2xx")) return propio;

  return porDefecto;
}

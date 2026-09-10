/**
 * consultar-ventas — ventas del turno según Loggro/pirpos.
 *
 * Reemplaza el flujo n8n `Loggro/Cierre_Turno/consultar_ventas.txt` (17 nodos).
 *
 * Qué cambia respecto de n8n:
 *   · Aquel flujo tenía DOS nodos de login con correo y contraseña escritos a
 *     mano, uno por empresa del grupo Batut. Aquí las credenciales salen de
 *     integraciones_credenciales, cifradas y por empresa.
 *   · La empresa se deduce del JWT. El cuerpo puede traer empresa_id, pero solo
 *     lo respeta un superadmin.
 *   · Se conserva el filtro por businessId contra plataforma_tenant_id, que es
 *     lo que impide que un local vea las ventas de otro bajo la misma cuenta.
 *
 * Contrato de salida idéntico al que ya lee js/cierre_turno.js.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";
import { comoLista, obtenerSesionLoggro, pedirLoggro } from "../_shared/loggro.ts";
import { esFechaValida, finDelDia, instanteLocal, rangoTurno } from "../_shared/fechas.ts";
import { filtrarPorNegocio, resumirVentas } from "../_shared/ventas.ts";

const ETIQUETA = "consultar-ventas";
const DEBUG = (Deno.env.get("LOGGRO_DEBUG") ?? "").toLowerCase() === "true";

/**
 * Convierte `1:30` + `PM` a `13:30`. Réplica del nodo `Code in JavaScript`.
 * El formulario envía la hora en 24h y además el momento del día calculado en
 * el navegador; se respetan ambos para no cambiar ningún resultado.
 */
function aHora24(hora: string, momento?: string | null): string {
  if (!hora) return "00:00";
  const [h, m] = String(hora).split(":").map(Number);
  if (!Number.isFinite(h) || h < 0 || h > 23) {
    throw errores.datosIncompletos(`hora inválida "${hora}"`);
  }
  const minutos = Number.isFinite(m) ? m : 0;
  const marca = String(momento ?? "").toUpperCase();

  let horas = h;
  if (marca === "PM" && h < 12) horas = h + 12;
  else if (marca === "AM" && h === 12) horas = 0;

  return `${String(horas).padStart(2, "0")}:${String(minutos).padStart(2, "0")}`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);
    const ctx = await resolverContexto(req, String(cuerpo.empresa_id ?? "") || null);

    const fecha = String(cuerpo.fecha ?? "").trim();
    if (!esFechaValida(fecha)) throw errores.datosIncompletos("fecha (YYYY-MM-DD)");

    const turno = (cuerpo.turno ?? {}) as Record<string, unknown>;
    const horaInicio = aHora24(String(turno.inicio ?? ""), String(turno.inicio_momento ?? ""));
    const horaFinCruda = String(turno.fin ?? "").trim();
    const horaFin = horaFinCruda
      ? aHora24(horaFinCruda, String(turno.fin_momento ?? ""))
      : "";

    // El turno va de su hora de inicio a su hora de fin. Punto.
    //
    // Hasta ahora dateEnd era el fin del DÍA, no el del turno, heredado de n8n
    // (sumaba 29 horas a la medianoche UTC). El comentario que lo justificaba
    // decía que acotar por hora_fin "dejaría ventas fuera" en el turno de
    // noche; eso solo era cierto sin tratar el cruce de medianoche, que es
    // justo lo que rangoTurno() sí resuelve (si fin <= inicio, termina al día
    // siguiente) y lo que consultar-inventarios ya venía usando.
    //
    // El fallo estaba enmascarado porque Loggro solo puede devolver facturas
    // que YA EXISTEN al momento de consultar: quien cierra su turno al
    // terminarlo no ve las de después porque todavía no se han emitido, y "el
    // ahora" hacía de tope de facto. Comprobado con BATUT VIVA 2026-09-08
    // turno 1 (08:53-14:55): lo guardado ese día coincide al peso con la
    // ventana real del turno (627.320), pero esa MISMA consulta repetida hoy
    // devuelve el día entero (1.129.230) porque ya existen las facturas de la
    // tarde.
    //
    // Es decir: el dato histórico está bien, la consulta no. Y revienta en
    // cuanto se cierra tarde o se reconstruye un día pasado. Reproducido el
    // 2026-09-09 en VIVA con un turno de 01:00 a 12:00 cerrado por la noche:
    // arrastraba 43 facturas y 1.886.729 en ventas del día completo cuando en
    // su ventana solo hubo 10 facturas y 444.916. Eso es también lo que hacía
    // aparecer 68.413 de propina "sin nadie presente": eran de otros turnos.
    //
    // Sin hora_fin (llamadas viejas) se conserva el comportamiento anterior,
    // para no romper a quien todavía no la mande. El formulario sí la manda.
    const { desde, hasta } = horaFin
      ? rangoTurno(fecha, horaInicio, horaFin)
      : { desde: instanteLocal(fecha, horaInicio), hasta: finDelDia(fecha) };

    const admin = ctx.clienteAdmin();
    const sesion = await obtenerSesionLoggro(admin, ctx.empresaId);

    const consulta = new URLSearchParams({
      status: "Pagada",
      dateInit: desde.toISOString(),
      dateEnd: hasta.toISOString(),
    });

    const crudo = await pedirLoggro(admin, ctx.empresaId, `/invoices?${consulta.toString()}`);
    const todas = comoLista(crudo);
    const propias = filtrarPorNegocio(todas, sesion.tenantId);

    const resumen = resumirVentas(propias);

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} negocio=${sesion.tenantId ?? "n/d"} ` +
      `facturas=${todas.length} propias=${propias.length}`,
    );

    return json({
      ok: true,
      message: "Ventas consultadas correctamente.",
      empresa_id: ctx.empresaId,
      es_local: ctx.esLocal,
      consulta: {
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin || null,
        acotado_por_fin_de_turno: Boolean(horaFin),
        date_init: desde.toISOString(),
        date_end: hasta.toISOString(),
        negocio: sesion.tenantId,
        facturas_totales: todas.length,
        facturas_empresa: propias.length,
      },
      ...resumen,
      ...(DEBUG ? { _crudo: todas.slice(0, 3) } : {}),
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

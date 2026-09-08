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
import { esFechaValida, finDelDia, instanteLocal } from "../_shared/fechas.ts";
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

    // dateInit = inicio del turno en hora local.
    // dateEnd  = fin del día local, igual que hacía n8n sumando 29 horas a la
    //            medianoche UTC de la fecha. El turno de noche cruza medianoche,
    //            así que acotar por hora_fin dejaría ventas fuera.
    const desde = instanteLocal(fecha, horaInicio);
    const hasta = finDelDia(fecha);

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

/**
 * consultar-propina-apoyos — reparte la propina del turno entre el responsable
 * y los apoyos, según el tramo horario en que cada uno estuvo presente.
 *
 * Reemplaza `Loggro/Pedir_Datos/Consultar_Propina_Apoyos.txt`, el flujo más
 * grande del sistema: 34 nodos, de nuevo dos copias del mismo camino para
 * superadmin y usuario normal.
 *
 * Regla de reparto (idéntica al nodo `Code in JavaScript4` de n8n):
 *   · El responsable cubre la franja real de inicio/fin del turno.
 *   · Cada apoyo cubre su propio tramo.
 *   · Cada propina se divide a partes iguales entre quienes estaban presentes
 *     en el instante de la factura (`createdOn`).
 *   · Se redondea a 2 decimales por persona.
 *
 * Contrato de salida: { ok, detalles: [{ id, tipo, propina_correspondiente }],
 *                       eventos: [{ factura_id, ocurrido_en, monto,
 *                                   presentes, reparto }],
 *                       total_propina_dia, total_propina_distribuida }
 *
 * `eventos` es la traza propina por propina: misma regla de reparto, anotada
 * paso a paso para poder mostrarla. Se añadió sin tocar el resto del contrato.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";
import { comoLista, obtenerSesionLoggro, pedirLoggro } from "../_shared/loggro.ts";
import { esFechaValida, finDelDia, instanteLocal } from "../_shared/fechas.ts";
import { filtrarPorNegocio } from "../_shared/ventas.ts";

const ETIQUETA = "consultar-propina-apoyos";
const DEBUG = (Deno.env.get("LOGGRO_DEBUG") ?? "").toLowerCase() === "true";

/**
 * n8n leía `registro.hora_inicio` / `registro.hora_fin`, que en el payload del
 * frontend son las horas DEL TURNO, no las del apoyo: todos los apoyos acaban
 * con el mismo tramo. El rango real de cada apoyo viaja en
 * `rango_hora_inicio_simple` / `rango_hora_fin_simple`.
 *
 * Se ha forzado el uso del rango real de apoyo usando rango_hora_inicio_24.
 */
const USAR_RANGO_PROPIO = true;

type Persona = {
  id: string;
  tipo: "responsable" | "apoyo";
  inicio: number;
  fin: number;
  propinaAsignada: number;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : (valor == null ? "" : String(valor));
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
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

    const apoyo = (cuerpo.apoyo ?? cuerpo.responsable_y_apoyos ?? {}) as Record<string, unknown>;
    const registros = Array.isArray(apoyo.registros)
      ? apoyo.registros as Record<string, unknown>[]
      : [];

    const primero = registros[0] ?? {};
    const fecha = texto(apoyo.fecha) || texto(primero.fecha) || texto(cuerpo.fecha);
    if (!esFechaValida(fecha)) throw errores.datosIncompletos("fecha (YYYY-MM-DD)");

    const responsableId = texto(apoyo.responsable_turno_id) || texto(primero.responsable_turno_id);
    if (!responsableId) throw errores.datosIncompletos("responsable_turno_id");

    // ── Personas y sus tramos ─────────────────────────────────────────────
    const inicioResponsableTexto = texto(apoyo.hora_inicio) || texto(primero.hora_inicio);
    const finResponsableTexto = texto(apoyo.hora_fin) || texto(primero.hora_fin);
    if (!inicioResponsableTexto || !finResponsableTexto) {
      throw errores.datosIncompletos("hora_inicio y hora_fin del turno");
    }
    const inicioResponsable = instanteLocal(fecha, inicioResponsableTexto).getTime();
    let finResponsable = instanteLocal(fecha, finResponsableTexto).getTime();
    if (finResponsable <= inicioResponsable) finResponsable += 24 * 60 * 60 * 1000;

    // El responsable cubre, como mínimo, hasta el fin del día -exactamente el
    // mismo límite que usa consultar-ventas para el total que ya se le
    // mostró al usuario ("Consultar Loggro"). Sin esto, esta función
    // consultaba a Loggro solo hasta hora_fin del turno mientras que
    // consultar-ventas seguía hasta medianoche: dos ventanas de tiempo
    // distintas, así que los dos totales JAMÁS iban a coincidir, sin importar
    // quién estuviera presente. (Si el turno cruza medianoche, lo de arriba ya
    // corrió finResponsable al día siguiente; ese caso sigue mandando aquí.)
    finResponsable = Math.max(finResponsable, finDelDia(fecha).getTime());

    // El responsable y cada apoyo participan únicamente dentro de su franja.
    const personas: Persona[] = [{
      id: responsableId,
      tipo: "responsable",
      inicio: inicioResponsable,
      fin: finResponsable,
      propinaAsignada: 0,
    }];

    for (const registro of registros) {
      const apoyoId = texto(registro.apoyo_responsable_id);
      if (!apoyoId) continue;

      const desdeTexto = USAR_RANGO_PROPIO
        ? (texto(registro.rango_hora_inicio_24) || texto(registro.rango_hora_inicio_simple) || texto(registro.hora_inicio))
        : texto(registro.hora_inicio);
      const hastaTexto = USAR_RANGO_PROPIO
        ? (texto(registro.rango_hora_fin_24) || texto(registro.rango_hora_fin_simple) || texto(registro.hora_fin))
        : texto(registro.hora_fin);

      if (!desdeTexto || !hastaTexto) continue;

      const fechaRegistro = texto(registro.fecha) || fecha;
      const inicio = instanteLocal(fechaRegistro, desdeTexto).getTime();
      let fin = instanteLocal(fechaRegistro, hastaTexto).getTime();
      // Tramo que cruza medianoche: el turno de noche es el caso normal.
      if (fin <= inicio) fin += 24 * 60 * 60 * 1000;

      personas.push({ id: apoyoId, tipo: "apoyo", inicio, fin, propinaAsignada: 0 });
    }

    // ── Facturas del día ──────────────────────────────────────────────────
    const admin = ctx.clienteAdmin();
    const sesion = await obtenerSesionLoggro(admin, ctx.empresaId);

    const consulta = new URLSearchParams({
      status: "Pagada",
      dateInit: new Date(personas[0].inicio).toISOString(),
      dateEnd: new Date(personas[0].fin).toISOString(),
    });

    const crudo = await pedirLoggro(admin, ctx.empresaId, `/invoices?${consulta.toString()}`);
    const propias = filtrarPorNegocio(comoLista(crudo), sesion.tenantId);

    // ── Reparto ───────────────────────────────────────────────────────────
    // Dos totales, a propósito no son el mismo:
    //   totalRecibido   = TODA la propina que aparece en las facturas del
    //                     rango consultado, haya o no alguien registrado en
    //                     ese instante.
    //   totalRealPropinas (repartible) = la parte de arriba que sí cayó
    //                     dentro del tramo de alguien y por tanto se reparte.
    // Antes solo existía el segundo, con el nombre `total_propina_dia`: una
    // propina sin nadie presente se descartaba en silencio, sin aparecer ni
    // en el total ni en la traza. Eso es lo que hacía parecer, al confirmar
    // apoyos, que "la propina real" encogía de golpe: no encogía, una parte
    // dejaba de contarse porque los rangos de responsable/apoyos no la
    // cubrían, y no había forma de verlo.
    let totalRealPropinas = 0;
    let totalRecibido = 0;
    let totalHuerfano = 0;

    // Traza propina por propina. La regla de reparto NO cambia; lo único nuevo
    // es que se anota cada paso para poder enseñarlo. El cliente veía solo el
    // total por persona y no podía comprobar de dónde salía, de ahí la
    // sospecha de que no se repartía. Las huérfanas (sin nadie presente)
    // también quedan en la traza, marcadas, en vez de desaparecer.
    const eventos: Array<{
      factura_id: string;
      ocurrido_en: string;
      monto: number;
      presentes: Array<{ id: string; tipo: string }>;
      reparto: Array<{ id: string; tipo: string; parte: number }>;
      huerfana: boolean;
    }> = [];

    for (const factura of propias) {
      const pagado = (factura.paid ?? {}) as Record<string, unknown>;
      const pagos = Array.isArray(pagado.paymentMethodValue) ? pagado.paymentMethodValue : [];
      const lista = pagos.length > 0 ? pagos : [factura];

      for (const cruda of lista) {
        const pago = (cruda ?? {}) as Record<string, unknown>;
        const propina = numero(pago.tip ?? pago.propina);
        if (propina <= 0) continue;

        const marca = Date.parse(texto(pago.createdOn ?? pago.created_on ?? pago.date ?? factura.createdOn ?? factura.created_on ?? factura.date));
        if (!Number.isFinite(marca)) continue;

        totalRecibido += propina;
        const activas = personas.filter((p) => marca >= p.inicio && marca <= p.fin);

        if (activas.length === 0) {
          totalHuerfano += propina;
          eventos.push({
            factura_id: texto(factura.id ?? factura.number ?? factura.invoiceNumber ?? ""),
            ocurrido_en: new Date(marca).toISOString(),
            monto: Math.round(propina * 100) / 100,
            presentes: [],
            reparto: [],
            huerfana: true,
          });
          continue;
        }

        totalRealPropinas += propina;
        const porPersona = propina / activas.length;
        for (const persona of activas) persona.propinaAsignada += porPersona;

        eventos.push({
          factura_id: texto(factura.id ?? factura.number ?? factura.invoiceNumber ?? ""),
          ocurrido_en: new Date(marca).toISOString(),
          monto: Math.round(propina * 100) / 100,
          presentes: activas.map((p) => ({ id: p.id, tipo: p.tipo })),
          // Redondeo solo para mostrar: el acumulado por persona sigue siendo
          // el exacto, y es ese el que se concilia por centavos más abajo.
          reparto: activas.map((p) => ({
            id: p.id,
            tipo: p.tipo,
            parte: Math.round(porPersona * 100) / 100,
          })),
          huerfana: false,
        });
      }
    }

    eventos.sort((a, b) => a.ocurrido_en.localeCompare(b.ocurrido_en));

    // Conciliación por centavos: primero se asigna la parte entera y luego el
    // residuo a las fracciones mayores. Así la suma siempre coincide con el
    // total real, incluso cuando una propina no divide exacto entre personas.
    const totalCentavos = Math.round(totalRealPropinas * 100);
    const asignaciones = personas.map((persona, indice) => {
      const exactos = persona.propinaAsignada * 100;
      return { indice, base: Math.floor(exactos), fraccion: exactos - Math.floor(exactos) };
    });
    let residuo = totalCentavos - asignaciones.reduce((suma, item) => suma + item.base, 0);
    [...asignaciones]
      .sort((a, b) => b.fraccion - a.fraccion || a.indice - b.indice)
      .forEach((item) => {
        if (residuo <= 0) return;
        asignaciones[item.indice].base += 1;
        residuo -= 1;
      });

    let totalAsignado = 0;
    const detalles = personas.map((persona, indice) => {
      const redondeada = asignaciones[indice].base / 100;
      totalAsignado += redondeada;
      return {
        id: persona.id,
        tipo: persona.tipo,
        propina_correspondiente: redondeada,
        periodo: {
          inicio: new Date(persona.inicio).toISOString(),
          fin: new Date(persona.fin).toISOString(),
        },
      };
    });

    const totalDia = Math.round(totalRealPropinas * 100) / 100;
    const totalRecibidoRedondeado = Math.round(totalRecibido * 100) / 100;
    const totalHuerfanoRedondeado = Math.round(totalHuerfano * 100) / 100;

    if (totalHuerfanoRedondeado > 0.01) {
      // No es un error -es información que alguien debe poder ver antes de
      // confiarse del total-, pero sí vale la pena que quede en los logs:
      // esta es la firma exacta de "la propina cambió al confirmar apoyos".
      console.info(
        `[${ETIQUETA}] empresa=${ctx.empresaId} fecha=${fecha} ` +
        `${totalHuerfanoRedondeado} en propinas sin nadie presente (de ${totalRecibidoRedondeado} recibidas)`,
      );
    }

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} fecha=${fecha} personas=${personas.length} ` +
      `facturas=${propias.length} propinas=${eventos.length} total=${totalDia} repartido=${totalAsignado}`,
    );

    return json({
      ok: true,
      message: "Propina distribuida correctamente.",
      empresa_id: ctx.empresaId,
      fecha,
      detalles,
      // Añadido, no sustituye a nada: `detalles` y los totales conservan su
      // contrato. `eventos` es la traza que alimenta la vista de reparto.
      eventos,
      total_propina_dia: totalDia,
      total_propina_distribuida: Math.round(totalAsignado * 100) / 100,
      coinciden_totales: Math.abs(totalRealPropinas - totalAsignado) < 0.01,
      // Añadido también. `total_propina_dia` de arriba es SOLO lo repartible
      // (lo que cayó en el tramo de alguien) -por eso "coinciden_totales" da
      // bien incluso cuando falta cubrir propinas: compara el reparto contra
      // sí mismo, no contra lo recibido de verdad. Estos dos campos son la
      // comparación honesta:
      total_recibido: totalRecibidoRedondeado,
      total_huerfano: totalHuerfanoRedondeado,
      consulta: {
        negocio: sesion.tenantId,
        facturas_empresa: propias.length,
        usa_rango_propio_del_apoyo: USAR_RANGO_PROPIO,
      },
      ...(DEBUG ? { _crudo: propias.slice(0, 3) } : {}),
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

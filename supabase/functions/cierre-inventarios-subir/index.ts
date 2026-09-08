/**
 * cierre-inventarios-subir — guarda el cierre de inventario del día y envía a
 * Loggro los ajustes por faltantes.
 *
 * Reemplaza `Loggro/inventarios/subir_cierre.txt` (14 nodos).
 *
 * Qué mejora frente a n8n:
 *   · Aquel flujo insertaba fila a fila con `splitInBatches`: si fallaba a la
 *     mitad, el cierre quedaba incompleto en base y nadie se enteraba. Aquí la
 *     inserción es una sola operación por lote.
 *   · El ajuste de inventario en Loggro se hace por empresa con su propio
 *     token, no con una cuenta compartida escrita a mano.
 *
 * Contrato de entrada (igual que el webhook n8n `cierre_inventarios_subir`):
 *   { fecha, hora_inicio, hora_fin, registrado_por, responsable_id,
 *     momento_inventario, items: [...], inconsistencias?: [...] }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import { pedirLoggro } from "../_shared/loggro.ts";
import { esFechaValida } from "../_shared/fechas.ts";

const ETIQUETA = "cierre-inventarios-subir";

/** Tipo de movimiento de ajuste en Loggro. Configurable por si cambia. */
const TIPO_AJUSTE = Number(Deno.env.get("LOGGRO_TIPO_AJUSTE") ?? "7");

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : (valor == null ? "" : String(valor));
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function verdadero(valor: unknown): boolean {
  return valor === true || valor === "true" || valor === 1 || valor === "si";
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);
    const ctx = await resolverContexto(
      req,
      String(cuerpo.empresa_id ?? cuerpo.tenant_id ?? "") || null,
    );

    // Ciclo de vida: corta si la cuenta nunca activó su prueba o está dada
    // de baja. La mora NO bloquea (§2.4 del plan de ciclo de vida).
    await exigirAccesoEscritura(ctx);


    const fecha = texto(cuerpo.fecha).trim();
    if (!esFechaValida(fecha)) throw errores.datosIncompletos("fecha (YYYY-MM-DD)");

    const horaInicio = texto(cuerpo.hora_inicio);
    const horaFin = texto(cuerpo.hora_fin);
    const registradoPor = texto(cuerpo.registrado_por);
    const responsableId = texto(cuerpo.responsable_id);
    const momento = texto(cuerpo.momento_inventario);

    const items = Array.isArray(cuerpo.items) ? cuerpo.items as Record<string, unknown>[] : [];
    if (items.length === 0) throw errores.datosIncompletos("items (al menos un producto)");

    // ── 1. Guardar el cierre ──────────────────────────────────────────────
    // Con el cliente del usuario: el RLS de cierres_inventario vuelve a
    // comprobar el tenant. Es la segunda barrera detrás de resolverContexto.
    const filas = items.map((item) => ({
      empresa_id: ctx.empresaId,
      fecha,
      producto: texto(item.producto_nombre ?? item.producto),
      stock_actual: numero(item.stock ?? item.stock_actual),
      stock_restante: numero(item.restante ?? item.stock_restante),
      stock_gastado: numero(item.stock_gastado),
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      registrado_por: registradoPor,
      "Inconsistencia": verdadero(item.inconsistencia),
      "Responsable Inconsistencia": texto(item.responsable_inconsistencia_id) || "N/A",
      "Cantidad Faltante": numero(item.cantidad_faltante_inconsistencia),
      "responsable turno": responsableId,
    }));

    const { data: insertadas, error: errorInsert } = await ctx.clienteUsuario
      .from("cierres_inventario")
      .insert(filas)
      .select("id");

    if (errorInsert) {
      console.error(`[${ETIQUETA}] Error al insertar cierre:`, errorInsert.message);
      throw errores.baseDeDatos(errorInsert.message);
    }

    // ── 2. Ajustes en Loggro por los faltantes ────────────────────────────
    // Solo los productos con inconsistencia y cantidad faltante generan
    // movimiento. Un fallo aquí no revierte el cierre ya guardado: se informa
    // producto a producto para que el usuario sepa qué reintentar.
    const conFaltante = items.filter((item) =>
      verdadero(item.inconsistencia) &&
      numero(item.cantidad_faltante_inconsistencia) > 0 &&
      texto(item.producto_id) &&
      texto(item.locationStockId)
    );

    const admin = ctx.clienteAdmin();
    const ajustes: { producto: string; ok: boolean; error?: string }[] = [];

    for (const item of conFaltante) {
      const nombreProducto = texto(item.producto_nombre ?? item.producto);
      const nota = `Ajuste_Enkrato | ${momento} | ${fecha}, inicio ${horaInicio}, fin ${horaFin} | usuario ${registradoPor}`;

      const carga = {
        type: TIPO_AJUSTE,
        date: new Date().toISOString(),
        ingredients: [{
          ingredient: { _id: texto(item.producto_id), name: nombreProducto },
          quantity: numero(item.cantidad_faltante_inconsistencia),
          locationStock: texto(item.locationStockId),
          note: nota,
          price: null,
          invoice: null,
          provider: null,
        }],
      };

      try {
        await pedirLoggro(admin, ctx.empresaId, "/inventories", {
          method: "POST",
          body: JSON.stringify(carga),
        });
        ajustes.push({ producto: nombreProducto, ok: true });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : "error desconocido";
        console.error(`[${ETIQUETA}] Ajuste fallido para "${nombreProducto}":`, mensaje);
        ajustes.push({ producto: nombreProducto, ok: false, error: mensaje });
      }
    }

    const ajustesFallidos = ajustes.filter((a) => !a.ok);

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} fecha=${fecha} ` +
      `productos=${filas.length} ajustes=${ajustes.length} fallidos=${ajustesFallidos.length}`,
    );

    return json({
      ok: true,
      message: ajustesFallidos.length === 0
        ? "Cierre de inventario guardado correctamente."
        : `Cierre guardado. ${ajustesFallidos.length} ajuste(s) no llegaron a Loggro.`,
      empresa_id: ctx.empresaId,
      fecha,
      productos_guardados: insertadas?.length ?? filas.length,
      ajustes_enviados: ajustes.filter((a) => a.ok).length,
      ajustes_fallidos: ajustesFallidos,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

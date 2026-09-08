/**
 * compras-subir — envía a Loggro las facturas de compra ya validadas.
 *
 * Reemplaza `Loggro/compras/subir_compras.txt` (37 nodos), que leía y escribía
 * la hoja de cálculo «Automatización Facturas». Aquí la fuente es la tabla
 * compras_facturas creada en la Fase A.
 *
 * Movimiento en Loggro: POST /inventories con `type: 1` (entrada por compra),
 * frente al `type: 7` (ajuste) que usa el cierre de inventario.
 *
 * Contrato de entrada:
 *   { factura_id: uuid,
 *     items: [{ _id, name, quantity, price, locationStock }],
 *     note?, payments?, fecha? }
 *
 * `items` viene del frontend porque la correspondencia entre el nombre del
 * producto en la factura del proveedor y el ingrediente de Loggro la resuelve
 * el usuario al validar la compra: no hay forma de deducirla del texto.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import { pedirLoggro } from "../_shared/loggro.ts";

const ETIQUETA = "compras-subir";

/** Tipo de movimiento de entrada por compra en Loggro. */
const TIPO_COMPRA = Number(Deno.env.get("LOGGRO_TIPO_COMPRA") ?? "1");

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : (valor == null ? "" : String(valor).trim());
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
    const ctx = await resolverContexto(req, texto(cuerpo.empresa_id) || null);

    // Ciclo de vida: corta si la cuenta nunca activó su prueba o está dada
    // de baja. La mora NO bloquea (§2.4 del plan de ciclo de vida).
    await exigirAccesoEscritura(ctx);


    const facturaId = texto(cuerpo.factura_id);
    if (!facturaId) throw errores.datosIncompletos("factura_id");

    // La factura se lee con el cliente del usuario: el RLS de compras_facturas
    // vuelve a comprobar el tenant. Si es de otra empresa, no aparece.
    const { data: factura, error: errorFactura } = await ctx.clienteUsuario
      .from("compras_facturas")
      .select("id, empresa_id, prefijo_factura, consecutivo_factura, proveedor, nit_proveedor, fecha_factura, total, subida_loggro, local_asignado")
      .eq("id", facturaId)
      .maybeSingle();

    if (errorFactura) throw errores.baseDeDatos(errorFactura.message);
    if (!factura) {
      throw new ErrorFuncion("FACTURA_NO_ENCONTRADA", "La factura no existe o no pertenece a tu empresa.", 404);
    }
    if (factura.subida_loggro) {
      throw new ErrorFuncion("FACTURA_YA_SUBIDA", "Esta factura ya se envió a Loggro.", 409);
    }

    // Una factura reasignada se carga en el inventario del local que la recibe,
    // no en el de la empresa que la capturó.
    const empresaDestino = texto(factura.local_asignado) || String(factura.empresa_id);
    if (!ctx.empresasVisibles.includes(empresaDestino) && !ctx.esSuperadmin) {
      throw errores.fueraDeAlcance();
    }

    const items = Array.isArray(cuerpo.items) ? cuerpo.items as Record<string, unknown>[] : [];
    if (items.length === 0) throw errores.datosIncompletos("items (al menos un ingrediente)");

    const ingredientes = items.map((item) => {
      const id = texto(item._id ?? item.id ?? item.producto_id);
      const nombre = texto(item.name ?? item.nombre ?? item.producto);
      const locationStock = texto(item.locationStock ?? item.locationStockId);

      if (!id || !locationStock) {
        throw new ErrorFuncion(
          "ITEM_SIN_MAPEO",
          `El producto "${nombre || id}" no está asociado a un ingrediente de Loggro.`,
          400,
        );
      }

      return {
        ingredient: { _id: id, name: nombre },
        quantity: numero(item.quantity ?? item.cantidad),
        price: numero(item.price ?? item.valor_unitario),
        locationStock,
        note: texto(item.note),
        invoice: null,
        provider: null,
      };
    });

    const numeroFactura = `${texto(factura.prefijo_factura)}${texto(factura.consecutivo_factura)}`;
    const nota = texto(cuerpo.note) ||
      `Compra_Enkrato | ${texto(factura.proveedor)} | ${numeroFactura}`;

    const carga: Record<string, unknown> = {
      type: TIPO_COMPRA,
      date: texto(cuerpo.fecha) || (factura.fecha_factura
        ? new Date(`${factura.fecha_factura}T00:00:00Z`).toISOString()
        : new Date().toISOString()),
      ingredients: ingredientes,
      invoice: numeroFactura || null,
      note: nota,
      payments: cuerpo.payments ?? [],
    };

    const admin = ctx.clienteAdmin();
    await pedirLoggro(admin, empresaDestino, "/inventories", {
      method: "POST",
      body: JSON.stringify(carga),
    });

    // Marcar como subida solo después de que Loggro la aceptó. Si se marcara
    // antes, un fallo dejaría la factura sin subir y sin posibilidad de
    // reintento, que es lo que ocurría en el flujo n8n.
    const { error: errorMarca } = await ctx.clienteUsuario
      .from("compras_facturas")
      .update({
        subida_loggro: true,
        subida_loggro_en: new Date().toISOString(),
        subida_por: ctx.authUserId,
      })
      .eq("id", facturaId);

    if (errorMarca) {
      console.error(`[${ETIQUETA}] Subida a Loggro OK pero no se marcó la factura:`, errorMarca.message);
      return json({
        ok: true,
        message: "La compra se envió a Loggro, pero no se pudo marcar como subida. Revisa antes de reintentar.",
        factura_id: facturaId,
        marcada: false,
      }, 200, origin);
    }

    const totalCargado = ingredientes.reduce((s, i) => s + i.quantity * i.price, 0);

    console.info(
      `[${ETIQUETA}] factura=${facturaId} empresa=${empresaDestino} items=${ingredientes.length}`,
    );

    return json({
      ok: true,
      message: "Compra enviada a Loggro correctamente.",
      factura_id: facturaId,
      empresa_id: empresaDestino,
      items: ingredientes.length,
      total: totalCargado,
      marcada: true,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

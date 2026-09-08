/**
 * wompi-eventos — receptor de notificaciones de Wompi.
 *
 * ESTA es la pieza que faltaba: la "señal de retorno" del pago (§4 del plan).
 * Hasta hoy el enlace de cobro solo recibía dinero y nadie se enteraba.
 *
 *   URL de eventos a registrar en el panel de Wompi:
 *   https://tgkvcvnwwnrlyhbqmhaf.supabase.co/functions/v1/wompi-eventos
 *
 * No lleva JWT de usuario — no hay usuario detrás, la llama el servidor de
 * Wompi. Lo que la protege es el checksum firmado con el secreto de eventos.
 * Por eso en config.toml va con verify_jwt = false.
 *
 * Cuatro reglas, en este orden, y ninguna es opcional:
 *
 *   1. VALIDAR LA FIRMA. Sin esto, cualquiera que conozca la URL puede mandar
 *      un POST diciendo "la factura X está pagada" y regalarse un año.
 *   2. IDEMPOTENCIA POR CONSTRAINT. El UNIQUE de pasarela_eventos, no un
 *      "select … if exists" (que tiene carrera). Wompi reintenta hasta 3 veces.
 *   3. RECONSULTAR LA API. El evento dice qué mirar; el estado y el monto se
 *      toman de GET /transactions/{id} con la llave privada.
 *   4. RESPONDER 200. Cualquier otra cosa provoca reintentos durante 24 h.
 *      Incluso cuando algo sale mal por nuestro lado: se registra el error y
 *      se responde 200, porque el reintento no lo va a arreglar.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  canalDesdeWompi,
  checksumValido,
  consultarTransaccion,
  aPesos,
  type EventoWompi,
} from "../_shared/wompi.ts";

const ETIQUETA = "wompi-eventos";

const ok = (cuerpo: Record<string, unknown>) =>
  new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function admin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const secretoEventos = Deno.env.get("WOMPI_EVENTS_SECRET");
  const llavePublica   = Deno.env.get("WOMPI_PUBLIC_KEY");
  const llavePrivada   = Deno.env.get("WOMPI_PRIVATE_KEY");

  if (!secretoEventos || !llavePublica || !llavePrivada) {
    console.error(`[${ETIQUETA}] Faltan secretos de Wompi.`);
    // 500 a propósito: aquí SÍ conviene que Wompi reintente, porque es un
    // problema de configuración que se puede resolver en minutos.
    return new Response("no configurado", { status: 500 });
  }

  const crudo = await req.text();

  let evento: EventoWompi;
  try {
    evento = JSON.parse(crudo);
  } catch {
    console.warn(`[${ETIQUETA}] Cuerpo no es JSON.`);
    return new Response("json inválido", { status: 400 });
  }

  // ---- 1. Firma -----------------------------------------------------------
  const firmaOk = await checksumValido(
    evento,
    secretoEventos,
    req.headers.get("x-event-checksum"),
  );

  if (!firmaOk) {
    console.warn(`[${ETIQUETA}] Checksum inválido. event=${evento?.event}`);
    return new Response("checksum inválido", { status: 401 });
  }

  const db = admin();

  const transaccion = (evento.data?.transaction ?? {}) as Record<string, unknown>;
  const idTransaccion = String(transaccion.id ?? "");
  const idEvento = `${evento.event}:${idTransaccion || evento.timestamp || crypto.randomUUID()}`;

  // ---- 2. Idempotencia por constraint -------------------------------------
  const { error: errorInsert } = await db
    .from("pasarela_eventos")
    .insert({
      proveedor: "wompi",
      evento_id: idEvento,
      tipo: evento.event ?? "",
      payload: evento,
    });

  if (errorInsert) {
    if (errorInsert.code === "23505") {
      // Ya lo procesamos. Wompi reintenta; nosotros no repetimos nada.
      return ok({ ok: true, repetido: true });
    }
    console.error(`[${ETIQUETA}] No se pudo registrar el evento:`, errorInsert.message);
    return ok({ ok: false, motivo: "registro_fallido" });
  }

  const cerrar = (resultado: string, error?: string) =>
    db.from("pasarela_eventos")
      .update({ procesado_at: new Date().toISOString(), resultado, error: error ?? null })
      .eq("proveedor", "wompi").eq("evento_id", idEvento);

  try {
    // Hoy solo actuamos sobre transaction.updated. Los eventos de token
    // (nequi_token.updated, bancolombia_transfer_token.updated) se guardan
    // crudos: los necesitará la Fase 4, no la Fase 3.
    if (evento.event !== "transaction.updated" || !idTransaccion) {
      await cerrar("ignorado");
      return ok({ ok: true, ignorado: evento.event });
    }

    // ---- 3. La fuente de verdad: reconsultar la API -----------------------
    const real = await consultarTransaccion(idTransaccion, llavePublica, llavePrivada);

    if (!real) {
      await cerrar("error", "No se pudo consultar la transacción en Wompi");
      return ok({ ok: false, motivo: "consulta_fallida" });
    }

    const estado      = String(real.status ?? "");
    const referencia  = String(real.reference ?? "");
    const montoPesos  = aPesos(Number(real.amount_in_cents ?? 0));
    const moneda      = String(real.currency ?? "COP");
    const canal       = canalDesdeWompi(real.payment_method_type);

    // APPROVED es lo único que mueve dinero y vigencia.
    // DECLINED / ERROR: la factura sigue pendiente, sin castigo.
    // PENDING (típico de PSE): no se toca nada; llegará otro evento al cerrarse.
    // VOIDED: anulación, se revierte lo que se hubiera aplicado.
    if (estado === "APPROVED") {
      const { data, error } = await db.rpc("registrar_pago_confirmado", {
        p_proveedor: "wompi",
        p_proveedor_pago_id: idTransaccion,
        p_referencia: referencia,
        p_monto: montoPesos,
        p_moneda: moneda,
        p_canal: canal,
        p_payload: real,
      });

      if (error) {
        console.error(`[${ETIQUETA}] registrar_pago_confirmado falló:`, error.message);
        await cerrar("error", error.message);
        return ok({ ok: false, motivo: "rpc_fallida" });
      }

      await cerrar("aplicado", null);
      console.info(`[${ETIQUETA}] Pago aplicado. tx=${idTransaccion} ref=${referencia}`, data);
      return ok({ ok: true, resultado: data });
    }

    if (estado === "VOIDED") {
      const { error } = await db.rpc("revertir_pago", {
        p_proveedor: "wompi",
        p_proveedor_pago_id: idTransaccion,
        p_motivo: "anulada en Wompi",
      });
      if (error) console.error(`[${ETIQUETA}] revertir_pago falló:`, error.message);
      await cerrar("revertido");
      return ok({ ok: true, revertido: true });
    }

    await cerrar(`estado:${estado}`);
    return ok({ ok: true, estado });
  } catch (e) {
    console.error(`[${ETIQUETA}] Error no controlado:`, e);
    await cerrar("error", String(e));
    // 200 igualmente: el reintento de Wompi no arreglaría un fallo nuestro,
    // y el evento ya quedó guardado crudo para reprocesarlo a mano.
    return ok({ ok: false, motivo: "error_interno" });
  }
});

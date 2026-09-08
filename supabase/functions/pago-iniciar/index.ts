/**
 * pago-iniciar — prepara un cobro en Wompi para la factura del cliente.
 *
 * Sustituye al enlace estático de Mercado Pago (§3.1 del plan), que era el
 * MISMO para todos los clientes: aunque llegara una notificación, no había
 * forma de saber quién había pagado.
 *
 * Aquí cada cobro nace con:
 *   - su propia REFERENCIA, derivada del uuid de la factura, y
 *   - una FIRMA DE INTEGRIDAD que ata monto + moneda + referencia,
 * de modo que el navegador no puede alterar el importe y la notificación
 * posterior se aplica sola a la factura correcta.
 *
 * Devuelve una URL de Checkout Web. La alternativa (widget embebido) usa
 * exactamente los mismos parámetros; se puede cambiar sin tocar el backend.
 *
 * Cuerpo:
 *   { periodicidad?: "mensual" | "anual" | "prueba",
 *     empresa_id?: uuid (solo superadmin) }
 *
 * ---------------------------------------------------------------------------
 * MODO PRUEBA (periodicidad: "prueba")
 * ---------------------------------------------------------------------------
 * Va en `periodicidad` y NO en un campo aparte, y eso es deliberado.
 *
 * La primera versión usaba `modo: "prueba"`. Un campo nuevo que la versión
 * ANTERIOR de esta función no conocía: lo ignoraba en silencio, caía al
 * `periodicidad ?? "mensual"` por defecto y abría el checkout con la factura
 * real del cliente. El 2026-08-27 eso pidió $575.040 cuando se esperaban
 * $1.000.
 *
 * Con la bandera dentro de `periodicidad`, cualquier despliegue viejo la
 * rechaza con "periodicidad debe ser 'mensual' o 'anual'". El fallo pasa de
 * cobrar de más a no cobrar nada, que es el único lado seguro.
 *
 * Emite un cobro simbólico de $1.000 contra la cuenta BANCO DE PRUEBAS, para
 * verificar el circuito completo — checkout, pago, webhook, vigencia — sin
 * tocar el precio comercial ni a un cliente real.
 *
 * Está apagado salvo que se cumplan LAS DOS condiciones:
 *   1. PAGO_PRUEBA_ACTIVA = "1" en los secretos (ausente por defecto).
 *   2. Quien llama es superadmin de plataforma.
 *
 * Es deliberadamente un Y, no un O: el interruptor solo puede ponerlo quien
 * tiene acceso a los secretos, y aun así no basta si el llamante es un cliente.
 * En producción, con el interruptor sin poner, esta rama es inalcanzable.
 *
 * Si existen llaves de sandbox (WOMPI_TEST_PUBLIC_KEY + …_INTEGRITY_SECRET) se
 * usan esas y el dinero es ficticio. Si no existen, se cobra $1.000 de verdad
 * contra producción, que también sirve y es lo que hay configurado hoy.
 */

import { json, corsHeaders } from "../_shared/cors.ts";
import { responderError, errores, leerCuerpo, envObligatorio, ErrorFuncion } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";
import { WOMPI_CHECKOUT, firmaIntegridad, aCentavos } from "../_shared/wompi.ts";

const ETIQUETA = "pago-iniciar";

/** Importe fijo del cobro de prueba. No se toma del cuerpo a propósito: el
 *  navegador no decide cuánto se cobra, ni siquiera en pruebas. */
const MONTO_PRUEBA = 1000;

/** A dónde vuelve el navegador tras pagar. Es solo cortesía visual; quien
 *  marca la factura pagada es el webhook, nunca esta redirección (§4.1). */
const URL_RETORNO_POR_DEFECTO = "https://restaurantes.enkrato.com/facturacion/";

/**
 * Llaves a usar. En modo prueba se prefieren las de sandbox si están
 * configuradas; si no, se cae a las de producción con el importe simbólico.
 */
function llavesDeCobro(esPrueba: boolean): { publica: string; integridad: string; sandbox: boolean } {
  if (esPrueba) {
    const pruebaPublica = Deno.env.get("WOMPI_TEST_PUBLIC_KEY");
    const pruebaIntegridad = Deno.env.get("WOMPI_TEST_INTEGRITY_SECRET");
    if (pruebaPublica && pruebaIntegridad) {
      return { publica: pruebaPublica, integridad: pruebaIntegridad, sandbox: true };
    }
  }
  return {
    publica: envObligatorio("WOMPI_PUBLIC_KEY"),
    integridad: envObligatorio("WOMPI_INTEGRITY_SECRET"),
    sandbox: false,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);
    const ctx = await resolverContexto(req, (cuerpo.empresa_id as string) ?? null);

    const periodicidad = String(cuerpo.periodicidad ?? "mensual").toLowerCase();
    if (!["mensual", "anual", "prueba"].includes(periodicidad)) {
      throw errores.datosIncompletos("periodicidad debe ser 'mensual' o 'anual'");
    }

    const esPrueba = periodicidad === "prueba";

    // ---- Los dos candados del modo prueba --------------------------------
    // El ORDEN importa. Primero el de identidad, con un mensaje seco que no
    // confirma ni desmiente que esta rama exista. Solo a quien ya demostró ser
    // superadmin se le explica que lo que falta es el interruptor: para todos
    // los demás las dos negativas son indistinguibles.
    if (esPrueba) {
      if (!ctx.esSuperadmin) {
        console.warn(`[${ETIQUETA}] Cobro de prueba rechazado. usuario=${ctx.authUserId}`);
        throw errores.sinPermisos("iniciar un cobro de prueba");
      }
      if (Deno.env.get("PAGO_PRUEBA_ACTIVA") !== "1") {
        throw new ErrorFuncion(
          "PRUEBA_DESACTIVADA",
          "El cobro de prueba está apagado. Enciéndelo con " +
            "`npx supabase secrets set PAGO_PRUEBA_ACTIVA=1` y vuelve a intentarlo.",
          403,
        );
      }
    }

    const { publica: llavePublica, integridad: secretoIntegridad, sandbox } = llavesDeCobro(esPrueba);
    const urlRetorno = Deno.env.get("WOMPI_REDIRECT_URL") ?? URL_RETORNO_POR_DEFECTO;

    const db = ctx.clienteAdmin();

    // ---- La factura a cobrar ---------------------------------------------
    // Normal: la más antigua sin pagar, o una nueva si no hay. Emitirla es
    //         idempotente: pulsar el botón dos veces no crea dos facturas.
    // Prueba: una factura simbólica de la cuenta banco de pruebas, que es otra
    //         cuenta distinta de la del superadmin que está pulsando.
    const { data: filas, error } = esPrueba
      ? await db.rpc("factura_de_prueba", { p_monto: MONTO_PRUEBA })
      : await db.rpc("factura_a_pagar", {
        p_empresa_id: ctx.empresaId,
        p_periodicidad: periodicidad,
      });

    if (error) {
      console.error(`[${ETIQUETA}] ${esPrueba ? "factura_de_prueba" : "factura_a_pagar"}:`, error.message);
      throw errores.baseDeDatos(error.message);
    }

    // Según la versión de PostgREST, una función que devuelve un tipo fila
    // llega como objeto o como arreglo de un elemento. Se aceptan las dos.
    const factura = (Array.isArray(filas) ? filas[0] : filas) as Record<string, unknown> | null;
    if (!factura) throw errores.baseDeDatos("No se pudo determinar la factura a pagar");

    const total = Number(factura.total ?? 0);
    if (!(total > 0)) {
      return json(
        { ok: false, codigo: "SIN_SALDO", message: "No tienes ningún cobro pendiente." },
        200,
        origin,
      );
    }

    // Cinturón: en modo prueba el importe SIEMPRE es el simbólico. Si la RPC
    // devolviera otra cosa, se corta antes de firmar nada.
    if (esPrueba && total !== MONTO_PRUEBA) {
      console.error(`[${ETIQUETA}] Factura de prueba con importe inesperado: ${total}`);
      throw errores.baseDeDatos("La factura de prueba no tiene el importe esperado");
    }

    // Referencia única por intento: permite reintentar un pago fallido sin
    // chocar, y sigue apuntando a la misma factura.
    const { data: referencia, error: errRef } = await db.rpc("referencia_de_factura", {
      p_factura_id: factura.id,
    });
    if (errRef || !referencia) throw errores.baseDeDatos(errRef?.message);

    const centavos = aCentavos(total);
    const moneda = String(factura.moneda ?? "COP");

    const firma = await firmaIntegridad(
      String(referencia),
      centavos,
      moneda,
      secretoIntegridad,
    );

    // Correo de facturación de la cuenta, para que Wompi lo prerrellene. En
    // modo prueba se usa el del propio superadmin, que es quien va a pagar.
    let correo: string | null = ctx.correo;
    if (!esPrueba) {
      const { data: estado } = await db.rpc("estado_facturacion_empresa", {
        p_empresa_id: ctx.empresaId,
      });
      correo = (estado as Record<string, any>)?.cuenta?.correo_facturacion ?? ctx.correo;
    }

    const params = new URLSearchParams({
      "public-key": llavePublica,
      currency: moneda,
      "amount-in-cents": String(centavos),
      reference: String(referencia),
      "signature:integrity": firma,
      "redirect-url": urlRetorno,
    });
    if (correo) params.set("customer-data:email", String(correo));

    if (esPrueba) {
      console.info(
        `[${ETIQUETA}] Cobro de PRUEBA. factura=${factura.numero} total=${total} ` +
          `sandbox=${sandbox} superadmin=${ctx.authUserId}`,
      );
    }

    return json({
      ok: true,
      url_pago: `${WOMPI_CHECKOUT}?${params.toString()}`,
      factura: {
        id: factura.id,
        numero: factura.numero,
        total,
        moneda,
        periodo_desde: factura.periodo_desde,
        periodo_hasta: factura.periodo_hasta,
        fecha_limite_pago: factura.fecha_limite_pago,
        estado: factura.estado,
      },
      referencia,
      periodicidad: esPrueba ? "prueba" : periodicidad,
      prueba: esPrueba,
      sandbox,
    }, 200, origin);
  } catch (e) {
    return responderError(e, origin, ETIQUETA);
  }
});

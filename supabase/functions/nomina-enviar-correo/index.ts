/**
 * nomina-enviar-correo — envía al empleado el PDF de autorización de descuentos.
 *
 * Reemplaza `Nómina/Enviar_Correo.txt` (10 nodos).
 *
 * En n8n el correo del empleado se obtenía llamando al Admin API de Supabase
 * con la service_role key escrita en el flujo, y el envío iba por el nodo Gmail.
 * Aquí el correo se resuelve con el SDK y el envío pasa por el proveedor
 * configurado en _shared/correo.ts.
 *
 * Entrada: multipart/form-data, tal como lo manda js/nomina.js
 *   · campo `metadata` → JSON con empleado, deducciones, totales…
 *   · campo `pdf`      → el documento generado en el navegador
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, responderError } from "../_shared/errores.ts";
import { cabeceraAuth, resolverContexto } from "../_shared/tenant.ts";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "nomina-enviar-correo";

/** Bucket privado donde se archiva el PDF. Vacío = no archivar. */
const BUCKET = Deno.env.get("NOMINA_BUCKET") ?? "nomina-pdf";
const MAX_PDF_MB = Number(Deno.env.get("NOMINA_MAX_PDF_MB") ?? "10");

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : (valor == null ? "" : String(valor).trim());
}

function dinero(valor: unknown): string {
  const n = Number(valor);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(n);
}

function aBase64(bytes: Uint8Array): string {
  let binario = "";
  const trozo = 0x8000;
  for (let i = 0; i < bytes.length; i += trozo) {
    binario += String.fromCharCode(...bytes.subarray(i, i + trozo));
  }
  return btoa(binario);
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    // La sesión se comprueba ANTES de leer el cuerpo. Al revés, una petición
    // sin token pero con cuerpo mal formado recibía un 400 de validación en
    // lugar del 401 que corresponde.
    cabeceraAuth(req);

    const formulario = await req.formData().catch(() => {
      throw errores.datosIncompletos("el cuerpo debe ser multipart/form-data");
    });

    const metadataCruda = formulario.get("metadata");
    const archivoPdf = formulario.get("pdf");

    if (!(archivoPdf instanceof File)) throw errores.datosIncompletos("pdf");

    let metadata: Record<string, unknown> = {};
    if (metadataCruda instanceof File) {
      metadata = JSON.parse(await metadataCruda.text());
    } else if (typeof metadataCruda === "string") {
      metadata = JSON.parse(metadataCruda);
    } else {
      throw errores.datosIncompletos("metadata");
    }

    const ctx = await resolverContexto(
      req,
      texto(metadata.empresa_id) || texto(metadata.tenant_id) || null,
    );

    // El estado de configuración del correo se comprueba DESPUÉS de autenticar:
    // es información sobre la plataforma y no debe salir a un llamante anónimo.
    if (!proveedorConfigurado()) {
      throw new ErrorFuncion(
        "CORREO_NO_CONFIGURADO",
        "El envío de correo aún no está configurado en la plataforma.",
        412,
      );
    }

    if (archivoPdf.size > MAX_PDF_MB * 1024 * 1024) {
      throw new ErrorFuncion("PDF_DEMASIADO_GRANDE", `El PDF supera ${MAX_PDF_MB} MB.`, 413);
    }

    const empleadoId = texto(metadata.empleado_id) ||
      texto(metadata.empleado_usuario_id) ||
      texto(metadata.usuario_empleado_id);
    if (!empleadoId) throw errores.datosIncompletos("empleado_id");

    const admin = ctx.clienteAdmin();

    // ── El empleado debe pertenecer a la empresa del llamante ─────────────
    // Sin esta comprobación, un administrador podría enviar el documento de
    // un empleado de otra empresa con solo cambiar el id en la petición.
    const { data: empleado } = await admin
      .from("usuarios_sistema")
      .select("id, empresa_id, nombre_completo")
      .eq("id", empleadoId)
      .maybeSingle();

    if (!empleado || !ctx.empresasVisibles.includes(String(empleado.empresa_id))) {
      throw new ErrorFuncion(
        "EMPLEADO_FUERA_DE_ALCANCE",
        "El empleado no pertenece a tu empresa.",
        403,
      );
    }

    // ── Correo del empleado ───────────────────────────────────────────────
    const { data: cuenta, error: errorCuenta } = await admin.auth.admin.getUserById(empleadoId);
    const correoEmpleado = cuenta?.user?.email ?? "";

    if (errorCuenta || !correoEmpleado) {
      throw new ErrorFuncion(
        "EMPLEADO_SIN_CORREO",
        "El empleado no tiene un correo registrado en la plataforma.",
        412,
      );
    }

    const bytes = new Uint8Array(await archivoPdf.arrayBuffer());
    const nombreEmpleado = texto((metadata.empleado as Record<string, unknown>)?.nombre) ||
      String(empleado.nombre_completo ?? "Empleado");
    const fechaDocumento = texto(metadata.fecha_documento) || new Date().toISOString().slice(0, 10);

    // ── Archivar el PDF (no bloqueante) ───────────────────────────────────
    let rutaArchivo: string | null = null;
    if (BUCKET) {
      const ruta = `${empleado.empresa_id}/${empleadoId}/${Date.now()}-autorizacion-descuentos.pdf`;
      const { error: errorSubida } = await admin.storage
        .from(BUCKET)
        .upload(ruta, bytes, { contentType: "application/pdf", upsert: false });

      if (errorSubida) {
        console.error(`[${ETIQUETA}] No se pudo archivar el PDF:`, errorSubida.message);
      } else {
        rutaArchivo = ruta;
      }
    }

    // ── Envío ─────────────────────────────────────────────────────────────
    const deducciones = Array.isArray(metadata.deducciones)
      ? metadata.deducciones as Record<string, unknown>[]
      : [];

    const filas = deducciones.map((d) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb">${texto(d.concepto ?? d.nombre)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right">${dinero(d.valor_empleado ?? d.valor)}</td>
      </tr>`).join("");

    await enviarCorreo({
      para: correoEmpleado,
      asunto: "Autorización de Descuento",
      html: plantilla("Autorización de descuento", `
        <p style="margin:0 0 12px">Hola <strong>${nombreEmpleado}</strong>,</p>
        <p style="margin:0 0 16px">
          Adjuntamos el documento de autorización de descuentos correspondiente a
          <strong>${fechaDocumento}</strong>. Revísalo y consérvalo.
        </p>
        ${filas ? `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:14px;margin-bottom:16px">
          <thead><tr>
            <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #3b2a5e">Concepto</th>
            <th style="text-align:right;padding:6px 8px;border-bottom:2px solid #3b2a5e">Valor</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>` : ""}
        <p style="margin:0">
          <strong>Total a descontar: ${dinero(metadata.total_a_descontar)}</strong>
        </p>
      `),
      texto: `Hola ${nombreEmpleado}. Adjuntamos tu autorización de descuento del ${fechaDocumento}. Total: ${dinero(metadata.total_a_descontar)}.`,
      adjuntos: [{
        nombre: "Autorizacion Deducciones.pdf",
        contenidoBase64: aBase64(bytes),
        tipo: "application/pdf",
      }],
    });

    console.info(
      `[${ETIQUETA}] enviado a empleado=${empleadoId} empresa=${empleado.empresa_id} archivado=${Boolean(rutaArchivo)}`,
    );

    return json({
      ok: true,
      message: "Autorización de descuento enviada al empleado.",
      empleado_id: empleadoId,
      archivado_en: rutaArchivo,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

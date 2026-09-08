/**
 * Envío de correo para las Edge Functions.
 *
 * En n8n esto era el nodo Gmail, atado a una cuenta conectada por OAuth desde
 * la interfaz de n8n. Una Edge Function no puede reutilizar esa conexión, así
 * que el envío se abstrae en tres backends y se elige con una variable de
 * entorno. Añadir un proveedor no obliga a tocar las funciones que envían.
 *
 *   CORREO_PROVEEDOR = resend | smtp | relay      (por defecto: resend)
 *
 *   resend →  RESEND_API_KEY
 *   smtp   →  SMTP_HOST, SMTP_PORT, SMTP_USUARIO, SMTP_PASSWORD
 *             (para Gmail: contraseña de aplicación, no la del correo)
 *   relay  →  CORREO_RELAY_URL [, CORREO_RELAY_TOKEN]
 *             POST {para, asunto, html, texto} a una URL propia
 *
 *   En todos los casos: CORREO_REMITENTE (p. ej. "Enkrato <no-responder@enkrato.com>")
 *
 * Si no hay proveedor configurado la función falla con un mensaje claro en
 * lugar de fingir que envió el correo.
 */

import { ErrorFuncion } from "./errores.ts";

export type Mensaje = {
  para: string | string[];
  asunto: string;
  html?: string;
  texto?: string;
  responderA?: string;
  adjuntos?: { nombre: string; contenidoBase64: string; tipo?: string }[];
};

function destinatarios(para: string | string[]): string[] {
  const lista = Array.isArray(para) ? para : [para];
  return lista.map((d) => String(d).trim()).filter(Boolean);
}

function remitente(): string {
  const valor = (Deno.env.get("CORREO_REMITENTE") ?? "").trim();
  if (!valor) {
    throw new ErrorFuncion(
      "CORREO_SIN_REMITENTE",
      "El envío de correo no está configurado (falta CORREO_REMITENTE).",
      412,
    );
  }
  return valor;
}

export function proveedorConfigurado(): boolean {
  const proveedor = (Deno.env.get("CORREO_PROVEEDOR") ?? "resend").toLowerCase();
  if (!Deno.env.get("CORREO_REMITENTE")) return false;
  if (proveedor === "resend") return Boolean(Deno.env.get("RESEND_API_KEY"));
  if (proveedor === "smtp") {
    return Boolean(Deno.env.get("SMTP_HOST") && Deno.env.get("SMTP_USUARIO") && Deno.env.get("SMTP_PASSWORD"));
  }
  if (proveedor === "relay") return Boolean(Deno.env.get("CORREO_RELAY_URL"));
  return false;
}

export async function enviarCorreo(mensaje: Mensaje): Promise<void> {
  const proveedor = (Deno.env.get("CORREO_PROVEEDOR") ?? "resend").toLowerCase();
  const para = destinatarios(mensaje.para);

  if (para.length === 0) {
    throw new ErrorFuncion("CORREO_SIN_DESTINO", "No hay destinatarios para el correo.", 400);
  }

  switch (proveedor) {
    case "resend":
      return await porResend(mensaje, para);
    case "smtp":
      return await porSmtp(mensaje, para);
    case "relay":
      return await porRelay(mensaje, para);
    default:
      throw new ErrorFuncion(
        "CORREO_PROVEEDOR_DESCONOCIDO",
        `Proveedor de correo "${proveedor}" no soportado.`,
        500,
      );
  }
}

async function porResend(mensaje: Mensaje, para: string[]): Promise<void> {
  const clave = Deno.env.get("RESEND_API_KEY");
  if (!clave) {
    throw new ErrorFuncion(
      "CORREO_NO_CONFIGURADO",
      "El envío de correo no está configurado (falta RESEND_API_KEY).",
      412,
    );
  }

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${clave}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remitente(),
      to: para,
      subject: mensaje.asunto,
      html: mensaje.html,
      text: mensaje.texto,
      reply_to: mensaje.responderA,
      attachments: mensaje.adjuntos?.map((a) => ({
        filename: a.nombre,
        content: a.contenidoBase64,
      })),
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    console.error("[correo] Resend rechazó el envío:", respuesta.status, detalle.slice(0, 400));
    throw new ErrorFuncion("CORREO_FALLIDO", "No se pudo enviar el correo.", 502);
  }
}

async function porSmtp(mensaje: Mensaje, para: string[]): Promise<void> {
  const host = Deno.env.get("SMTP_HOST");
  const usuario = Deno.env.get("SMTP_USUARIO");
  const password = Deno.env.get("SMTP_PASSWORD");
  const puerto = Number(Deno.env.get("SMTP_PORT") ?? "465");

  if (!host || !usuario || !password) {
    throw new ErrorFuncion(
      "CORREO_NO_CONFIGURADO",
      "El envío de correo por SMTP no está configurado.",
      412,
    );
  }

  // Import dinámico: solo se descarga si esta empresa usa SMTP, y un fallo de
  // este módulo no puede romper el arranque de las funciones que usan Resend.
  const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");

  const cliente = new SMTPClient({
    connection: {
      hostname: host,
      port: puerto,
      tls: puerto === 465,
      auth: { username: usuario, password },
    },
  });

  try {
    await cliente.send({
      from: remitente(),
      to: para,
      subject: mensaje.asunto,
      html: mensaje.html,
      content: mensaje.texto ?? " ",
      replyTo: mensaje.responderA,
      attachments: mensaje.adjuntos?.map((a) => ({
        filename: a.nombre,
        encoding: "base64" as const,
        content: a.contenidoBase64,
        contentType: a.tipo ?? "application/octet-stream",
      })),
    });
  } catch (error) {
    console.error("[correo] SMTP rechazó el envío:", error);
    throw new ErrorFuncion("CORREO_FALLIDO", "No se pudo enviar el correo.", 502);
  } finally {
    // close() devuelve void o Promise<void> según el modo del cliente.
    try {
      await cliente.close();
    } catch { /* la conexión ya estaba cerrada */ }
  }
}

async function porRelay(mensaje: Mensaje, para: string[]): Promise<void> {
  const url = Deno.env.get("CORREO_RELAY_URL");
  if (!url) {
    throw new ErrorFuncion("CORREO_NO_CONFIGURADO", "Falta CORREO_RELAY_URL.", 412);
  }
  const token = Deno.env.get("CORREO_RELAY_TOKEN");

  const respuesta = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      remitente: remitente(),
      para,
      asunto: mensaje.asunto,
      html: mensaje.html,
      texto: mensaje.texto,
      adjuntos: mensaje.adjuntos,
    }),
  });

  if (!respuesta.ok) {
    console.error("[correo] El relay rechazó el envío:", respuesta.status);
    throw new ErrorFuncion("CORREO_FALLIDO", "No se pudo enviar el correo.", 502);
  }
}

/** Plantilla mínima y sobria, coherente en clientes de correo antiguos. */
export function plantilla(titulo: string, cuerpoHtml: string): string {
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:24px;background:#f4f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2430">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:28px">
    <tr><td>
      <h1 style="margin:0 0 16px;font-size:20px;color:#3b2a5e">${titulo}</h1>
      ${cuerpoHtml}
      <p style="margin:24px 0 0;font-size:12px;color:#6b7280">
        Este mensaje se generó automáticamente desde Enkrato. No respondas a este correo.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

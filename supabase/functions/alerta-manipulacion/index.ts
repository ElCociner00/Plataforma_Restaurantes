import { corsHeaders, ErrorFuncion, errores, json, responderError } from "../_shared/http.ts";
import { cabeceraAuth, resolverContexto } from "../_shared/tenant.ts";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "alerta-manipulacion";

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    // Podemos aceptar requests de navigator.sendBeacon (texto plano o blob)
    // El frontend a veces usa beacon para que no bloquee la navegacin
    let bodyText = "";
    try {
      bodyText = await req.text();
    } catch {
      throw errores.datosIncompletos("El cuerpo de la peticin debe ser de texto/JSON");
    }

    if (!bodyText) {
      throw errores.datosIncompletos("Falta el cuerpo de la peticin");
    }

    const payload = JSON.parse(bodyText);

    // Intentar leer token, pero para sendBeacon podra no existir
    // si no lo pasan por headers. Asumiremos que el frontend actual
    // no enva authorization en sendBeacon, as que tal vez no podamos
    // forzar cabeceraAuth aqu si es sendBeacon.
    // Revisando el cliente: no enva headers custom en sendBeacon.
    
    if (!proveedorConfigurado()) {
      console.warn(`[${ETIQUETA}] Correo no configurado. Alerta ignorada.`);
      return json({ ok: true, message: "Correo no configurado" }, 200, origin);
    }

    const modulo = payload.modulo || "cierre_turno";
    const motivo = payload.motivo || "Manipulacin detectada";
    const responsableNombre = payload.responsable_nombre || "Desconocido";
    const empresaNombre = payload.empresa_nombre || "Empresa Desconocida";
    const fechaTurno = payload.fecha_turno || new Date().toISOString().split("T")[0];
    const timestamp = payload.timestamp || new Date().toISOString();

    const correoAdmin = "alertas@enkrato.com"; // O usar un config/env

    await enviarCorreo({
      para: correoAdmin,
      asunto: `[ALERTA DE SEGURIDAD] Manipulacin en ${modulo === "cierre_turno" ? "Cierre de Turno" : "Cierre de Inventario"}`,
      html: plantilla(`Alerta de seguridad - ${empresaNombre}`, `
        <p style="margin:0 0 12px">Hola Equipo Administrador,</p>
        <p style="margin:0 0 16px">
          Se ha detectado una posible manipulacin de seguridad.
        </p>
        <ul style="margin:0 0 16px">
          <li><strong>Empresa:</strong> ${empresaNombre}</li>
          <li><strong>Responsable:</strong> ${responsableNombre}</li>
          <li><strong>Mdulo:</strong> ${modulo}</li>
          <li><strong>Motivo de Alerta:</strong> ${motivo}</li>
          <li><strong>Fecha del Evento/Turno:</strong> ${fechaTurno}</li>
          <li><strong>Hora del reporte:</strong> ${timestamp}</li>
        </ul>
        <p style="margin:0">
          Por favor, revisa el historial para auditar esta accin.
        </p>
      `),
      texto: `Alerta de seguridad.\nEmpresa: ${empresaNombre}\nResponsable: ${responsableNombre}\nMotivo: ${motivo}\nFecha: ${fechaTurno}`,
    });

    console.info(`[${ETIQUETA}] Alerta enviada para empresa=${empresaNombre}, responsable=${responsableNombre}`);

    return json({ ok: true, message: "Alerta procesada" }, 200, origin);
  } catch (error) {
    // navigator.sendBeacon ignora la respuesta, pero es buena prctica devolver json.
    return responderError(error, origin, ETIQUETA);
  }
});

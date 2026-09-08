/**
 * registro-empleados — alta de empleados operativos de una empresa.
 *
 * Reemplaza `Registro/Registro_Empleados.txt` (24 nodos, dos copias del mismo
 * camino para superadmin y usuario normal).
 *
 * Esta función ya existía, pero estaba declarada con `verify_jwt = false` en
 * config.toml: cualquiera con la URL podía crear cuentas. Ahora exige JWT y
 * comprueba que quien llama administra la empresa.
 *
 * Contrato de entrada (igual que js/registro_empleados.js):
 *   { nombre, cedula, fecha_ingreso, email, password, empresa_id, registrado_por }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import {
  crearCuentaAuth,
  deshacerCuentaAuth,
  exigirCedulaLibre,
  exigirEmpresaActiva,
} from "../_shared/usuarios.ts";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "registro-empleados";

/** Rol con el que n8n daba de alta a los empleados. Se conserva. */
const ROL_EMPLEADO = Deno.env.get("ROL_EMPLEADO") ?? "operativo";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : (valor == null ? "" : String(valor).trim());
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
      texto(cuerpo.empresa_id) || texto(cuerpo.tenant_id) || null,
    );

    // Ciclo de vida: corta si la cuenta nunca activó su prueba o está dada
    // de baja. La mora NO bloquea (§2.4 del plan de ciclo de vida).
    await exigirAccesoEscritura(ctx);

    exigirAdmin(ctx, "registrar empleados");

    const email = texto(cuerpo.email ?? cuerpo.correo).toLowerCase();
    const password = String(cuerpo.password ?? "");
    const nombre = texto(cuerpo.nombre ?? cuerpo.nombre_completo);
    const cedula = texto(cuerpo.cedula);
    const fechaIngreso = texto(cuerpo.fecha_ingreso);
    const registradoPor = texto(cuerpo.registrado_por) || ctx.authUserId;

    const faltantes: string[] = [];
    if (!email) faltantes.push("email");
    if (!password) faltantes.push("password");
    if (!nombre) faltantes.push("nombre");
    if (faltantes.length) throw errores.datosIncompletos(faltantes.join(", "));

    const admin = ctx.clienteAdmin();
    const empresa = await exigirEmpresaActiva(admin, ctx.empresaId);
    await exigirCedulaLibre(admin, "empleados", ctx.empresaId, cedula);

    const cuenta = await crearCuentaAuth(admin, { correo: email, password, nombre });

    try {
      const { error: errorSistema } = await admin.from("usuarios_sistema").insert({
        id: cuenta.id,
        empresa_id: ctx.empresaId,
        nombre_completo: nombre,
        rol: ROL_EMPLEADO,
        "añadido_por": registradoPor,
      });
      if (errorSistema) throw errores.baseDeDatos(errorSistema.message);

      const { error: errorEmpleado } = await admin.from("empleados").insert({
        id: cuenta.id,
        empresa_id: ctx.empresaId,
        nombre_completo: nombre,
        cedula,
        ...(fechaIngreso ? { fecha_inicio: fechaIngreso } : {}),
        "añadido_por": registradoPor,
      });
      if (errorEmpleado) throw errores.baseDeDatos(errorEmpleado.message);
    } catch (error) {
      // Sin esto quedaría una cuenta capaz de iniciar sesión sin empresa.
      await deshacerCuentaAuth(admin, cuenta.id);
      throw error;
    }

    let correoEnviado = false;
    if (proveedorConfigurado()) {
      try {
        await enviarCorreo({
          para: email,
          asunto: `Bienvenido a ${empresa.nombre_comercial || "Enkrato"}`,
          html: plantilla("Tu cuenta ya está lista", `
            <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
            <p style="margin:0 0 12px">
              Tu cuenta en <strong>${empresa.nombre_comercial || "Enkrato"}</strong> quedó creada
              y ya puedes empezar a registrar tus labores desde la plataforma.
            </p>
            <p style="margin:0 0 12px">Tu usuario es <strong>${email}</strong>.</p>
            <p style="margin:0">
              La contraseña te la entrega quien te registró. Cámbiala en tu primer inicio de sesión.
            </p>
          `),
          texto: `Hola ${nombre}. Tu cuenta en ${empresa.nombre_comercial} ya está creada. Usuario: ${email}.`,
        });
        correoEnviado = true;
      } catch (error) {
        console.error(`[${ETIQUETA}] Empleado creado pero el correo falló:`, error);
      }
    }

    console.info(`[${ETIQUETA}] alta empleado ${cuenta.id} en empresa ${ctx.empresaId}`);

    return json({
      ok: true,
      message: "Empleado registrado correctamente.",
      usuario_id: cuenta.id,
      empresa_id: ctx.empresaId,
      correo_enviado: correoEnviado,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

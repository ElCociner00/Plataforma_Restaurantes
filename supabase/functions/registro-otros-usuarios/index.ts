/**
 * registro-otros-usuarios — alta de administradores y revisores.
 *
 * Reemplaza `Registro/Registro_Admins_y_Revisores.txt` (20 nodos, dos copias
 * del mismo camino para superadmin y usuario normal).
 *
 * Cambios frente a n8n:
 *   · La service_role key ya no viaja escrita en el flujo.
 *   · La empresa sale del JWT; el cuerpo solo manda para un superadmin.
 *   · Si falla el alta en base, se revierte la cuenta de auth. n8n dejaba
 *     usuarios huérfanos capaces de iniciar sesión sin empresa.
 *
 * Contrato de entrada: { email, password, nombre, cedula, rol, registrado_por }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import {
  crearCuentaAuth,
  deshacerCuentaAuth,
  exigirCedulaLibre,
  exigirEmpresaActiva,
} from "../_shared/usuarios.ts";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "registro-otros-usuarios";
const ROLES_PERMITIDOS = new Set(["admin", "admin_root", "revisor"]);

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
    const ctx = await resolverContexto(req, texto(cuerpo.empresa_id) || null);

    // Ciclo de vida: corta si la cuenta nunca activó su prueba o está dada
    // de baja. La mora NO bloquea (§2.4 del plan de ciclo de vida).
    await exigirAccesoEscritura(ctx);

    exigirAdmin(ctx, "registrar administradores o revisores");

    const email = texto(cuerpo.email ?? cuerpo.correo).toLowerCase();
    const password = String(cuerpo.password ?? "");
    const nombre = texto(cuerpo.nombre ?? cuerpo.nombre_completo);
    const cedula = texto(cuerpo.cedula);
    const rol = texto(cuerpo.rol).toLowerCase();
    const registradoPor = texto(cuerpo.registrado_por) || ctx.correo;

    const faltantes: string[] = [];
    if (!email) faltantes.push("email");
    if (!password) faltantes.push("password");
    if (!nombre) faltantes.push("nombre");
    if (!rol) faltantes.push("rol");
    if (faltantes.length) throw errores.datosIncompletos(faltantes.join(", "));

    if (!ROLES_PERMITIDOS.has(rol)) {
      throw new ErrorFuncion(
        "ROL_NO_PERMITIDO",
        `El rol "${rol}" no es válido. Usa admin, admin_root o revisor.`,
        400,
      );
    }

    // Solo un superadmin puede fabricar otro admin_root: es la cuenta raíz de
    // la empresa y quien la tiene puede reasignar todo lo demás.
    if (rol === "admin_root" && !ctx.esSuperadmin) {
      throw errores.sinPermisos("crear una cuenta admin_root");
    }

    const admin = ctx.clienteAdmin();
    const empresa = await exigirEmpresaActiva(admin, ctx.empresaId);
    await exigirCedulaLibre(admin, "otros_usuarios", ctx.empresaId, cedula);

    // ── Alta de la cuenta ─────────────────────────────────────────────────
    const cuenta = await crearCuentaAuth(admin, { correo: email, password, nombre });

    try {
      const { error: errorSistema } = await admin.from("usuarios_sistema").insert({
        id: cuenta.id,
        empresa_id: ctx.empresaId,
        nombre_completo: nombre,
        rol,
        "añadido_por": registradoPor,
      });
      if (errorSistema) throw errores.baseDeDatos(errorSistema.message);

      const { error: errorOtros } = await admin.from("otros_usuarios").insert({
        id: cuenta.id,
        empresa_id: ctx.empresaId,
        nombre_completo: nombre,
        cedula,
        "añadido_por": registradoPor,
      });
      if (errorOtros) throw errores.baseDeDatos(errorOtros.message);
    } catch (error) {
      await deshacerCuentaAuth(admin, cuenta.id);
      throw error;
    }

    // ── Correo de bienvenida ──────────────────────────────────────────────
    // Nunca bloquea el alta: la cuenta ya existe y es utilizable.
    let correoEnviado = false;
    if (proveedorConfigurado()) {
      try {
        await enviarCorreo({
          para: email,
          asunto: `Tu acceso a ${empresa.nombre_comercial || "Enkrato"}`,
          html: plantilla("Tu cuenta ya está lista", `
            <p style="margin:0 0 12px">Hola <strong>${nombre}</strong>,</p>
            <p style="margin:0 0 12px">
              Se creó tu cuenta en <strong>${empresa.nombre_comercial || "Enkrato"}</strong>
              con el perfil <strong>${rol}</strong>.
            </p>
            <p style="margin:0 0 12px">Entra con tu correo <strong>${email}</strong> y la contraseña que te compartió quien te registró.</p>
            <p style="margin:0">Por seguridad, cámbiala la primera vez que inicies sesión.</p>
          `),
          texto: `Hola ${nombre}. Tu cuenta en ${empresa.nombre_comercial} ya está creada con el perfil ${rol}. Usuario: ${email}.`,
        });
        correoEnviado = true;
      } catch (error) {
        console.error(`[${ETIQUETA}] Cuenta creada pero el correo falló:`, error);
      }
    }

    console.info(`[${ETIQUETA}] alta ${rol} ${cuenta.id} en empresa ${ctx.empresaId}`);

    return json({
      ok: true,
      message: "Usuario registrado correctamente.",
      usuario_id: cuenta.id,
      empresa_id: ctx.empresaId,
      rol,
      correo_enviado: correoEnviado,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

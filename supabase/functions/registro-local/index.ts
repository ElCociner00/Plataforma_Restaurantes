/**
 * registro-local — da de alta un local dependiente de una empresa madre.
 *
 * Reemplaza `Registro/Registro_Nueva_Empresa_Local.txt` (6 nodos) y absorbe
 * `Registro/Registro_Primer_Usuario_Local_Dups.txt` (10 nodos), que en n8n era
 * un sub-workflow separado invocado a continuación.
 *
 * Recordatorio del modelo: en grupos_empresariales, `empresa_id` es el LOCAL
 * y `grupo_id` es la empresa MADRE.
 *
 * Contrato de entrada:
 *   { nombre_comercial, razon_social, nit, correo_empresa,
 *     empresa_matriz_id?,                       ← por defecto, la del llamante
 *     usuario?: { email, password, nombre } }   ← crea el admin del local
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import { crearCuentaAuth, deshacerCuentaAuth, exigirEmpresaActiva } from "../_shared/usuarios.ts";
import { enviarCorreo, plantilla, proveedorConfigurado } from "../_shared/correo.ts";

const ETIQUETA = "registro-local";

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

    exigirAdmin(ctx, "crear locales");

    // La madre es la empresa del llamante salvo que un superadmin indique otra.
    const matrizId = ctx.esSuperadmin && texto(cuerpo.empresa_matriz_id)
      ? texto(cuerpo.empresa_matriz_id)
      : ctx.empresaId;

    if (!ctx.esSuperadmin && !ctx.empresasVisibles.includes(matrizId)) {
      throw errores.fueraDeAlcance();
    }

    // Un local no puede tener locales: el modelo es de dos niveles.
    if (ctx.esLocal && !ctx.esSuperadmin) {
      throw new ErrorFuncion(
        "LOCAL_NO_PUEDE_ANIDAR",
        "Un local no puede crear otros locales. Hazlo desde la empresa principal.",
        400,
      );
    }

    const nombreComercial = texto(cuerpo.nombre_comercial);
    const razonSocial = texto(cuerpo.razon_social);
    const nit = texto(cuerpo.nit);
    const correoEmpresa = texto(cuerpo.correo_empresa).toLowerCase();

    const faltantes: string[] = [];
    if (!nombreComercial) faltantes.push("nombre_comercial");
    if (!correoEmpresa) faltantes.push("correo_empresa");
    if (faltantes.length) throw errores.datosIncompletos(faltantes.join(", "));

    const admin = ctx.clienteAdmin();
    const matriz = await exigirEmpresaActiva(admin, matrizId);

    // Datos de la madre que se copian al grupo, como hacía n8n.
    const { data: datosMatriz } = await admin
      .from("empresas")
      .select("nombre_comercial, razon_social, plan_actual, plan, activo")
      .eq("id", matrizId)
      .maybeSingle();

    // ── 1. Crear la empresa del local ─────────────────────────────────────
    const { data: local, error: errorEmpresa } = await admin
      .from("empresas")
      .insert({
        nombre_comercial: nombreComercial,
        razon_social: razonSocial || String(datosMatriz?.razon_social ?? ""),
        nit: nit || "",
        correo_empresa: correoEmpresa,
        activa: true,
        activo: true,
        plan_actual: String(datosMatriz?.plan_actual ?? "free"),
        plan: String(datosMatriz?.plan ?? "free"),
      })
      .select("id")
      .single();

    if (errorEmpresa || !local) {
      console.error(`[${ETIQUETA}] No se pudo crear la empresa del local:`, errorEmpresa?.message);
      throw errores.baseDeDatos(errorEmpresa?.message);
    }

    const localId = String(local.id);

    // ── 2. Colgar el local del grupo ──────────────────────────────────────
    const { error: errorGrupo } = await admin.from("grupos_empresariales").insert({
      empresa_id: localId,
      grupo_id: matrizId,
      nombre_grupo: String(datosMatriz?.nombre_comercial ?? matriz.nombre_comercial),
      razon_social_grupo: String(datosMatriz?.razon_social ?? ""),
      plan_grupo: String(datosMatriz?.plan_actual ?? "free"),
      activo: true,
    });

    if (errorGrupo) {
      // Sin la fila de grupo, el local queda suelto y sin jerarquía: se
      // deshace para no dejar una empresa huérfana en el sistema.
      await admin.from("empresas").delete().eq("id", localId);
      console.error(`[${ETIQUETA}] No se pudo vincular el local al grupo:`, errorGrupo.message);
      throw errores.baseDeDatos(errorGrupo.message);
    }

    // ── 3. Usuario administrador del local (opcional) ─────────────────────
    const usuario = (cuerpo.usuario ?? {}) as Record<string, unknown>;
    const emailUsuario = texto(usuario.email ?? usuario.correo).toLowerCase();
    let usuarioId: string | null = null;

    if (emailUsuario) {
      const cuenta = await crearCuentaAuth(admin, {
        correo: emailUsuario,
        password: String(usuario.password ?? ""),
        nombre: texto(usuario.nombre),
      });

      try {
        const { error: errorSistema } = await admin.from("usuarios_sistema").insert({
          id: cuenta.id,
          empresa_id: localId,
          nombre_completo: texto(usuario.nombre) || nombreComercial,
          rol: "admin_root",
          "añadido_por": ctx.correo,
        });
        if (errorSistema) throw errores.baseDeDatos(errorSistema.message);

        // usuarios_locales asocia al administrador con el local. El índice
        // único creado en la Fase A impide el duplicado que el cron
        // Verificación_Usuarios_Local_Dups barría cada N minutos.
        const { error: errorLocal } = await admin.from("usuarios_locales").insert({
          usuario_principal_id: cuenta.id,
          empresa_id: localId,
          nombre_completo: texto(usuario.nombre) || nombreComercial,
          rol: "admin_root",
          activo: true,
          "añadido_por": ctx.correo,
        });
        if (errorLocal) throw errores.baseDeDatos(errorLocal.message);

        usuarioId = cuenta.id;
      } catch (error) {
        await deshacerCuentaAuth(admin, cuenta.id);
        throw error;
      }
    }

    // ── 4. Correo de bienvenida ───────────────────────────────────────────
    let correoEnviado = false;
    if (proveedorConfigurado()) {
      try {
        await enviarCorreo({
          para: correoEmpresa,
          asunto: `${nombreComercial} ya está activo en Enkrato`,
          html: plantilla("Tu local ya está activo", `
            <p style="margin:0 0 12px">Hola, <strong>${nombreComercial}</strong>.</p>
            <p style="margin:0 0 12px">
              El local quedó registrado dentro del grupo
              <strong>${datosMatriz?.nombre_comercial ?? matriz.nombre_comercial}</strong>
              y ya puede operar en la plataforma.
            </p>
            ${emailUsuario ? `<p style="margin:0">El acceso de administración es <strong>${emailUsuario}</strong>.</p>` : ""}
          `),
          texto: `${nombreComercial} quedó registrado como local del grupo ${matriz.nombre_comercial}.`,
        });
        correoEnviado = true;
      } catch (error) {
        console.error(`[${ETIQUETA}] Local creado pero el correo falló:`, error);
      }
    }

    console.info(`[${ETIQUETA}] local ${localId} creado bajo la matriz ${matrizId}`);

    return json({
      ok: true,
      message: "Local registrado correctamente.",
      empresa_id: localId,
      empresa_matriz_id: matrizId,
      usuario_id: usuarioId,
      correo_enviado: correoEnviado,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

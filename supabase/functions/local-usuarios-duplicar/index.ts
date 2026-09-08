/**
 * local-usuarios-duplicar — segundo paso del alta de un local dependiente.
 *
 * Reemplaza el webhook n8n `locales/duplicar_usuarios`. Su lógica no está en
 * un archivo con ese nombre: vive en `Registro/Registro_Primer_Usuario_Local_Dups.txt`,
 * que arranca con executeWorkflowTrigger en vez de con un nodo Webhook, de ahí
 * que no aparezca al buscar por path.
 *
 * El alta de un local está partida en dos pantallas:
 *   1. configuracion/anadir_local.html      → crea la empresa del local
 *                                             (Edge Function `registro-local`)
 *   2. configuracion/anadir_local_usuario.html → esta función: crea el
 *      administrador del local y replica en `usuarios_locales` los usuarios de
 *      la empresa madre, para que cada local tenga su propia fila apuntando al
 *      mismo usuario principal.
 *
 * Contrato de entrada (el que ya mandaba el frontend, sin cambios):
 *   { nombre_visible, email, password,
 *     local_empresa_id?,      ← si falta, se resuelve por local_nit
 *     local_nit?, local_correo?,
 *     empresa_matriz_id? }    ← por defecto, la empresa del llamante
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { ErrorFuncion, errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";
import { crearCuentaAuth, deshacerCuentaAuth, exigirEmpresaActiva } from "../_shared/usuarios.ts";

const ETIQUETA = "local-usuarios-duplicar";

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

    exigirAdmin(ctx, "preparar usuarios de un local");

    // Un local no administra otros locales: el modelo es de dos niveles.
    if (ctx.esLocal && !ctx.esSuperadmin) {
      throw new ErrorFuncion(
        "LOCAL_NO_PUEDE_ANIDAR",
        "Un local no puede preparar usuarios de otros locales. Hazlo desde la empresa principal.",
        400,
      );
    }

    const matrizId = ctx.esSuperadmin && texto(cuerpo.empresa_matriz_id)
      ? texto(cuerpo.empresa_matriz_id)
      : ctx.empresaId;

    if (!ctx.esSuperadmin && !ctx.empresasVisibles.includes(matrizId)) {
      throw errores.fueraDeAlcance();
    }

    const admin = ctx.clienteAdmin();

    // ── 1. Resolver el local ──────────────────────────────────────────────
    // El frontend guarda el id en sessionStorage, pero la respuesta antigua de
    // n8n no siempre lo traía. El NIT es el plan B, y se busca SOLO entre los
    // locales de esta madre para que no sirva de sonda contra otras empresas.
    let localId = texto(cuerpo.local_empresa_id);
    const localNit = texto(cuerpo.local_nit ?? cuerpo.nit);

    if (!localId) {
      if (!localNit) throw errores.datosIncompletos("local_empresa_id o local_nit");

      const { data: hermanos, error: errorGrupo } = await admin
        .from("grupos_empresariales")
        .select("empresa_id")
        .eq("grupo_id", matrizId)
        .eq("activo", true);

      if (errorGrupo) throw errores.baseDeDatos(errorGrupo.message);

      const idsHermanos = (hermanos ?? []).map((fila) => String(fila.empresa_id));
      if (!idsHermanos.length) {
        throw new ErrorFuncion("LOCAL_NO_ENCONTRADO", "Esa empresa no tiene locales registrados.", 404);
      }

      // El flujo original resolvía el local por NIT y desempataba comparando
      // correo_empresa con local_correo (nodos "Get a row" + "Filter"). Se
      // conserva ese desempate: dos locales de la misma madre pueden compartir
      // NIT, y sin él la consulta devolvería dos filas y fallaría.
      let consulta = admin
        .from("empresas")
        .select("id")
        .eq("nit", localNit)
        .in("id", idsHermanos);

      const localCorreo = texto(cuerpo.local_correo).toLowerCase();
      if (localCorreo) consulta = consulta.eq("correo_empresa", localCorreo);

      const { data: porNit, error: errorNit } = await consulta.maybeSingle();

      if (errorNit) throw errores.baseDeDatos(errorNit.message);
      if (!porNit) {
        throw new ErrorFuncion(
          "LOCAL_NO_ENCONTRADO",
          "No se encontró el local recién registrado. Vuelve al paso Añadir local.",
          404,
        );
      }

      localId = String(porNit.id);
    }

    await exigirEmpresaActiva(admin, localId);

    // El vínculo con la madre se verifica aquí y otra vez dentro del RPC. Es
    // deliberado: la función SQL es SECURITY DEFINER y no puede confiar en que
    // su único llamante sea esta función.
    const { data: vinculo, error: errorVinculo } = await admin
      .from("grupos_empresariales")
      .select("empresa_id")
      .eq("empresa_id", localId)
      .eq("grupo_id", matrizId)
      .eq("activo", true)
      .maybeSingle();

    if (errorVinculo) throw errores.baseDeDatos(errorVinculo.message);
    if (!vinculo) throw errores.fueraDeAlcance();

    // ── 2. Administrador del local (opcional) ─────────────────────────────
    const correoUsuario = texto(cuerpo.email ?? cuerpo.correo).toLowerCase();
    const nombreUsuario = texto(cuerpo.nombre_visible ?? cuerpo.nombre);
    let usuarioId: string | null = null;

    if (correoUsuario) {
      const cuenta = await crearCuentaAuth(admin, {
        correo: correoUsuario,
        password: String(cuerpo.password ?? ""),
        nombre: nombreUsuario,
      });

      try {
        const { error: errorSistema } = await admin.from("usuarios_sistema").insert({
          id: cuenta.id,
          empresa_id: localId,
          nombre_completo: nombreUsuario || correoUsuario,
          rol: "admin_root",
          "añadido_por": ctx.correo,
        });
        if (errorSistema) throw errores.baseDeDatos(errorSistema.message);

        usuarioId = cuenta.id;
      } catch (error) {
        // Sin esto quedaría una cuenta en auth.users sin empresa, capaz de
        // iniciar sesión y aterrizar en una pantalla rota.
        await deshacerCuentaAuth(admin, cuenta.id);
        throw error;
      }
    }

    // ── 3. Duplicar los usuarios de la madre en el local ──────────────────
    // El RPC es idempotente (ON CONFLICT DO NOTHING sobre el índice único de
    // la Fase A), así que reintentar esta pantalla no crea filas de más. Como
    // el usuario del paso 2 ya está en usuarios_sistema del LOCAL y no de la
    // madre, esta llamada lo ignora y solo trae a los de la empresa principal;
    // su propia fila se inserta justo después.
    const { data: resultado, error: errorRpc } = await admin.rpc("duplicar_usuarios_local", {
      p_local_empresa_id: localId,
      p_matriz_empresa_id: matrizId,
    });

    if (errorRpc) {
      console.error(`[${ETIQUETA}] Falló la duplicación de usuarios:`, errorRpc.message);
      throw errores.baseDeDatos(errorRpc.message);
    }

    if (usuarioId) {
      const { error: errorLocal } = await admin.from("usuarios_locales").insert({
        usuario_principal_id: usuarioId,
        empresa_id: localId,
        nombre_completo: nombreUsuario || correoUsuario,
        rol: "admin_root",
        activo: true,
        "añadido_por": ctx.correo,
      });

      // No se revierte la cuenta por esto: el usuario ya existe y es válido en
      // usuarios_sistema. Solo le faltaría la fila de local, que el propio RPC
      // repone en la siguiente ejecución.
      if (errorLocal) {
        console.error(`[${ETIQUETA}] Usuario creado pero sin fila en usuarios_locales:`, errorLocal.message);
      }
    }

    const duplicados = Number((resultado as Record<string, unknown> | null)?.duplicados ?? 0);
    console.info(`[${ETIQUETA}] local ${localId}: ${duplicados} usuarios duplicados desde ${matrizId}`);

    return json({
      ok: true,
      message: "Usuarios del local preparados correctamente.",
      empresa_id: localId,
      empresa_matriz_id: matrizId,
      usuario_id: usuarioId,
      duplicados,
      detalle: resultado ?? null,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

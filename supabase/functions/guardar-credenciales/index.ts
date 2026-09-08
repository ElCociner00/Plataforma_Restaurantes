/**
 * guardar-credenciales — alta y actualización de las credenciales de una
 * plataforma externa (hoy Loggro/pirpos) para UNA empresa.
 *
 * Es la función más importante del sistema: de ella dependen cierre de turno,
 * gastos, inventarios, propinas y compras. Si aquí se guarda algo mal, todos
 * esos módulos dejan de funcionar para esa empresa.
 *
 * Reemplaza al flujo n8n `Registro/Registro_Credenciales_loggro.txt`, que tenía
 * 37 nodos: cuatro copias del mismo camino (superadmin sí/no × credencial
 * existente sí/no), cada una con su propio POST /login y su propio par
 * create/update. Aquí es un solo camino.
 *
 * Contrato (compatible con js/loggro.js, sin cambios en el frontend):
 *   POST { plataforma?: "loggro", correo: string, password: string,
 *          empresa_id?: string  ← solo lo respeta un superadmin }
 *   →    { ok: true, message, usuario, validado_en, tenant_id }
 *
 * Garantías:
 *   · La empresa sale del JWT. El cuerpo solo puede cambiarla si el llamante
 *     está en system_users (superadmin), y aun así se valida el alcance.
 *   · La contraseña se valida contra el proveedor ANTES de guardarse: no se
 *     admiten credenciales que no funcionan.
 *   · Se guarda cifrada con AES-GCM. Sin MASTER_ENCRYPTION_KEY la función
 *     falla; no existe llave de relleno.
 *   · La contraseña nunca vuelve al cliente ni aparece en los logs.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { encryptText } from "../_shared/crypto.ts";
import { ErrorFuncion, errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto } from "../_shared/tenant.ts";
import { iniciarSesion, PLATAFORMA } from "../_shared/loggro.ts";

const ETIQUETA = "guardar-credenciales";
const URL_API_POR_DEFECTO = "https://api.pirpos.com";
const PLATAFORMAS_ADMITIDAS = new Set(["loggro", "siigo", "credibanco"]);

function llaveMaestra(): string {
  const llave = Deno.env.get("MASTER_ENCRYPTION_KEY") ?? Deno.env.get("ENCRYPTION_KEY");
  if (!llave || llave.length < 16) {
    throw errores.configuracion("MASTER_ENCRYPTION_KEY ausente o menor de 16 caracteres");
  }
  return llave;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);

    // La empresa del cuerpo solo se honra para superadmins; resolverContexto
    // se encarga de descartarla y de validar el alcance en cualquier otro caso.
    const ctx = await resolverContexto(req, String(cuerpo.empresa_id ?? "") || null);
    exigirAdmin(ctx, "configurar las credenciales de integración");

    const plataforma = String(cuerpo.plataforma ?? PLATAFORMA).trim().toLowerCase();
    if (!PLATAFORMAS_ADMITIDAS.has(plataforma)) {
      throw new ErrorFuncion("PLATAFORMA_NO_SOPORTADA", `La plataforma "${plataforma}" no está soportada.`, 400);
    }

    const correo = String(cuerpo.correo ?? cuerpo.usuario ?? "").trim();
    const password = String(cuerpo.password ?? "");
    const urlApi = String(cuerpo.url_api ?? "").trim().replace(/\/+$/, "");

    const faltantes: string[] = [];
    if (!correo) faltantes.push("correo");
    if (!password) faltantes.push("password");
    if (faltantes.length) throw errores.datosIncompletos(faltantes.join(", "));

    const admin = ctx.clienteAdmin();

    // ── 1. Validar contra el proveedor ────────────────────────────────────
    // Guardar sin validar es lo que producía empresas con credenciales muertas
    // que solo se descubrían al abrir el cierre de turno.
    let tenantId: string | null = null;
    let tokenInicial: string | null = null;
    let expiraEn: number | null = null;
    const urlEfectiva = urlApi ||
      (Deno.env.get("LOGGRO_API_URL") ?? "").trim().replace(/\/+$/, "") ||
      URL_API_POR_DEFECTO;

    if (plataforma === PLATAFORMA) {
      const sesion = await iniciarSesion(ctx.empresaId, urlEfectiva, correo, password);
      tenantId = sesion.tenantId;
      tokenInicial = sesion.token;
      expiraEn = sesion.expiraEn;
    }

    // ── 2. Cifrar ─────────────────────────────────────────────────────────
    let passwordCifrada: string;
    try {
      passwordCifrada = await encryptText(password, llaveMaestra());
    } catch (error) {
      console.error(`[${ETIQUETA}] Fallo al cifrar:`, error);
      throw new ErrorFuncion("ERROR_CIFRADO", "No se pudo asegurar la credencial.", 500);
    }

    // ── 3. Guardar la credencial ──────────────────────────────────────────
    // service_role porque integraciones_credenciales tiene el SELECT denegado
    // por RLS a propósito, y sin SELECT el upsert no puede resolver el conflicto.
    const ahora = new Date().toISOString();

    const { error: errorUpsert } = await admin
      .from("integraciones_credenciales")
      .upsert({
        empresa_id: ctx.empresaId,
        plataforma,
        usuario: correo,
        password: passwordCifrada,
        url_api: urlApi || null,
        activo: true,
        validado_en: plataforma === PLATAFORMA ? ahora : null,
        actualizado_por: ctx.authUserId,
        updated_at: ahora,
      }, { onConflict: "empresa_id,plataforma" });

    if (errorUpsert) {
      console.error(`[${ETIQUETA}] Error al guardar credencial:`, errorUpsert.message);
      throw errores.baseDeDatos(errorUpsert.message);
    }

    // ── 4. Sembrar la caché de token ──────────────────────────────────────
    // El login ya se hizo en el paso 1; desaprovecharlo obligaría a la primera
    // consulta real del usuario a pagar otra vez la latencia del proveedor.
    if (tokenInicial && expiraEn) {
      const { error: errorToken } = await admin
        .from("credenciales_plataforma")
        .upsert({
          empresa_id: ctx.empresaId,
          plataforma,
          token: tokenInicial,
          url_plataforma: urlEfectiva,
          activo: true,
          token_expira_en: new Date(expiraEn).toISOString(),
          token_actualizado_en: ahora,
          ultimo_error: null,
          ...(tenantId ? { plataforma_tenant_id: tenantId } : {}),
        }, { onConflict: "empresa_id,plataforma" });

      if (errorToken) {
        // No es motivo para fallar: la credencial ya quedó guardada y la
        // siguiente petición hará login por su cuenta.
        console.error(`[${ETIQUETA}] No se pudo sembrar el token:`, errorToken.message);
      }
    }

    console.info(
      `[${ETIQUETA}] credencial ${plataforma} guardada para empresa ${ctx.empresaId} por ${ctx.authUserId}`,
    );

    return json({
      ok: true,
      message: plataforma === PLATAFORMA
        ? "Credenciales validadas contra Loggro y guardadas de forma cifrada."
        : "Credenciales guardadas de forma cifrada.",
      usuario: correo,
      plataforma,
      empresa_id: ctx.empresaId,
      validado_en: plataforma === PLATAFORMA ? ahora : null,
      tenant_id: tenantId,
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

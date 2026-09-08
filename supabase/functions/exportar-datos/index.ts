/**
 * exportar-datos — el cliente se lleva toda su información.
 *
 * Contexto: docs/2026-08-25_plan_ciclo_de_vida_cliente.md §3 Fase D.3
 *
 * Por qué existe: los términos dicen que la información puede eliminarse
 * pasados 90 días desde la baja. Una cláusula así solo es defendible si el
 * cliente tiene una forma real de llevarse sus datos ANTES, y sin pedírnoslo
 * por correo.
 *
 * Se exporta el ámbito completo de la CUENTA, es decir todas sus sedes, no solo
 * la empresa desde la que se pulsa el botón. Un cliente con dos locales espera
 * un solo archivo con todo.
 *
 * Formato: JSON. Es el formato en el que los datos son exactos y reimportables.
 * Empaquetar CSV por módulo y los PDF de las facturas queda como mejora; el
 * contenido, que es lo que importa legalmente, ya está completo aquí.
 *
 * Deliberadamente NO se exportan:
 *   - credenciales_plataforma / integraciones_credenciales  (secretos de Loggro)
 *   - pasarela_eventos                                      (datos de la pasarela)
 * Devolver credenciales cifradas en un archivo de descarga sería un agujero.
 */

import { json, corsHeaders } from "../_shared/cors.ts";
import { responderError, errores, leerCuerpo } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";

const ETIQUETA = "exportar-datos";

/** Tablas con empresa_id que forman la información operativa del cliente. */
const TABLAS_POR_EMPRESA = [
  "usuarios_sistema",
  "usuarios_locales",
  "otros_usuarios",
  "usuarios_permisos_modulo",
  "empleados",
  "cierres_turno_final",
  "cierres_turno_final_locales",
  "cierres_turno_historico",
  "cierres_inventario",
  "apoyos_turno",
  "apoyos_turno_locales",
  "apoyos_turno_historico",
  "dias_operacion_estado",
  "gastos_costos",
  "compras_facturas",
  "compras_facturas_lineas",
  "facturas_empresas",
  "facturas_empresas_inconvenientes",
  "historico_nomina",
  "parametros_nomina",
  "empresa_configuracion_nomina",
  "correos_empresas",
  "metodos_pago",
  "grupos_empresariales",
];

/** Tablas de facturación, que van por cuenta y no por empresa. */
const TABLAS_POR_CUENTA = [
  "facturas_suscripcion",
  "pagos_suscripcion",
  "suscripciones",
  "suscripcion_bitacora",
  "bajas_suscripcion",
  "aceptaciones_terminos",
];

/** Supabase pagina a 1000 filas por defecto; se recorre hasta agotar. */
async function leerTodo(
  db: ReturnType<typeof Object>,
  tabla: string,
  columna: string,
  valores: string[],
): Promise<Record<string, unknown>[]> {
  const filas: Record<string, unknown>[] = [];
  const tamano = 1000;
  let desde = 0;

  // Sin tope artificial, pero con un límite de seguridad para no agotar la
  // memoria de la función con una tabla desbocada.
  const MAXIMO = 100_000;

  while (desde < MAXIMO) {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (db as any)
      .from(tabla)
      .select("*")
      .in(columna, valores)
      .range(desde, desde + tamano - 1);

    if (error) {
      // Una tabla que no exista o cambie de nombre no puede tumbar la
      // exportación entera: se anota y se sigue.
      console.warn(`[${ETIQUETA}] ${tabla}: ${error.message}`);
      return filas;
    }
    if (!data || data.length === 0) break;

    filas.push(...data);
    if (data.length < tamano) break;
    desde += tamano;
  }

  return filas;
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
    const db = ctx.clienteAdmin();

    // ── Alcance: la cuenta completa, con todas sus sedes ───────────────────
    const { data: cuentaId } = await db.rpc("cuenta_de_empresa", {
      p_empresa_id: ctx.empresaId,
    });

    let empresas: string[] = [ctx.empresaId];
    let cuenta: Record<string, unknown> | null = null;

    if (cuentaId) {
      const { data: filaCuenta } = await db
        .from("cuentas").select("*").eq("id", cuentaId).maybeSingle();
      cuenta = filaCuenta ?? null;

      const { data: sedes } = await db
        .from("cuenta_empresas").select("empresa_id").eq("cuenta_id", cuentaId).eq("activo", true);

      if (sedes?.length) empresas = sedes.map((s: { empresa_id: string }) => String(s.empresa_id));
    }

    // Solo sedes dentro del alcance del usuario. Un superadmin las ve todas;
    // un admin de cuenta, las suyas. Nunca las de otro cliente.
    if (!ctx.esSuperadmin) {
      empresas = empresas.filter((id) => ctx.empresasVisibles.includes(id));
      if (empresas.length === 0) empresas = [ctx.empresaId];
    }

    const datos: Record<string, unknown> = {};
    let total = 0;

    const { data: fichasEmpresa } = await db.from("empresas").select("*").in("id", empresas);
    datos.empresas = fichasEmpresa ?? [];
    total += (fichasEmpresa ?? []).length;

    for (const tabla of TABLAS_POR_EMPRESA) {
      const filas = await leerTodo(db, tabla, "empresa_id", empresas);
      if (filas.length) {
        datos[tabla] = filas;
        total += filas.length;
      }
    }

    if (cuentaId) {
      for (const tabla of TABLAS_POR_CUENTA) {
        const filas = await leerTodo(db, tabla, "cuenta_id", [String(cuentaId)]);
        if (filas.length) {
          datos[tabla] = filas;
          total += filas.length;
        }
      }
    }

    console.info(`[${ETIQUETA}] cuenta=${cuentaId} sedes=${empresas.length} filas=${total}`);

    return json({
      ok: true,
      generado_en: new Date().toISOString(),
      generado_por: ctx.correo,
      cuenta,
      resumen: {
        sedes: empresas.length,
        tablas: Object.keys(datos).length,
        total_registros: total,
      },
      aviso: "Exportación completa de la información operativa y de facturación "
           + "de tu cuenta. No incluye credenciales de integraciones por seguridad.",
      datos,
    }, 200, origin);
  } catch (e) {
    return responderError(e, origin, ETIQUETA);
  }
});

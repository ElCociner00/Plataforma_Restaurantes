/**
 * consultar-inventarios — stock e ingredientes según Loggro/pirpos.
 *
 * Fusiona dos flujos n8n que consultaban el mismo endpoint /Ingredients:
 *   · Loggro/inventarios/Inventarios.txt              (10 nodos) → modo "stock"
 *   · Loggro/Pedir_Datos/Llamar_Inventarios.txt       (20 nodos) → modo "ingredientes"
 *
 * Los 20 nodos del segundo eran, otra vez, dos copias del mismo camino para
 * superadmin y usuario normal.
 * Contrato de salida: { ok, productos: [...], Productos: [...] }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";
import { comoLista, obtenerSesionLoggro, pedirLoggro } from "../_shared/loggro.ts";
import { esFechaValida, rangoTurno, hoyLocal } from "../_shared/fechas.ts";
import { filtrarPorNegocio } from "../_shared/ventas.ts";

const ETIQUETA = "consultar-inventarios";
const DEBUG = (Deno.env.get("LOGGRO_DEBUG") ?? "").toLowerCase() === "true";

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : (valor == null ? "" : String(valor));
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/** Réplica del nodo `Parseo1`. Los nombres de salida se conservan. */
function normalizar(p: Record<string, unknown>) {
  const stockUbicacion = (p.locationsStock ?? {}) as Record<string, unknown>;
  const categoria = (p.category ?? {}) as Record<string, unknown>;
  const unidad = (p.unit ?? {}) as Record<string, unknown>;
  const locationStock = (stockUbicacion.locationStock ?? {}) as Record<string, unknown>;

  return {
    id: texto(p._id),
    nombre: texto(p.name),
    categoria: texto(categoria.name),
    unidad: texto(unidad.name) || "Unidad",
    stock: numero(stockUbicacion.stock ?? p.stock),
    stockMinimo: numero(stockUbicacion.stockMinimum ?? p.stockMinimum),
    precioCompra: numero(stockUbicacion.pricePurchase ?? p.pricePurchase),
    precioVenta: numero(p.price ?? stockUbicacion.price),
    esIngrediente: Boolean(p.isIngredient),
    activo: Boolean(p.isActive),
    locationStockId: texto(locationStock._id) || null,
  };
}

/** Réplica del nodo `Filter`: solo productos con stock informado (>= 0). */
function tieneStockInformado(p: Record<string, unknown>): boolean {
  const stockUbicacion = (p.locationsStock ?? {}) as Record<string, unknown>;
  const valor = stockUbicacion.stock;
  return valor !== undefined && valor !== null && numero(valor) >= 0;
}

Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    if (req.method !== "POST") throw errores.metodoNoPermitido();

    const cuerpo = await leerCuerpo(req);
    const ctx = await resolverContexto(req, String(cuerpo.empresa_id ?? "") || null);

    const modo = String(cuerpo.modo ?? "stock").trim().toLowerCase();
    const soloIngredientes = modo === "ingredientes" || cuerpo.solo_ingredientes === true;

    // El rango es opcional en la API original, pero Pirpos puede requerirlo. 
    // Cuando no se envía fecha (ej: vista de configuración), se usa la fecha de hoy 
    // para cumplir con los parámetros (replicando el fallback de n8n).
    const consulta = new URLSearchParams();
    const fecha = String(cuerpo.fecha ?? "").trim() || hoyLocal();
    
    if (!esFechaValida(fecha)) throw errores.datosIncompletos("fecha (YYYY-MM-DD)");
    
    const { desde, hasta } = rangoTurno(fecha, texto(cuerpo.hora_inicio), texto(cuerpo.hora_fin));
    consulta.set("dateInit", desde.toISOString());
    consulta.set("dateEnd", hasta.toISOString());

    const admin = ctx.clienteAdmin();
    const sesion = await obtenerSesionLoggro(admin, ctx.empresaId);

    const ruta = consulta.toString() ? `/Ingredients?${consulta.toString()}` : "/Ingredients";
    const crudo = await pedirLoggro(admin, ctx.empresaId, ruta);
    const todos = comoLista(crudo);

    // A diferencia de ventas y gastos, aquí NO se filtra por negocio.
    // Comprobado contra api.pirpos.com el 2026-08-22: el catálogo de
    // ingredientes se hereda del negocio padre — en una cuenta de local, 163
    // de 164 productos llevan el business del padre y solo 1 el propio.
    // Filtrar por el business de la empresa dejaría el inventario casi vacío.
    // El aislamiento aquí lo da el token: cada empresa usa su propia cuenta.
    // FILTRAR_INVENTARIO_POR_NEGOCIO=true lo activa si algún día hiciera falta.
    const filtrarPorTenant =
      (Deno.env.get("FILTRAR_INVENTARIO_POR_NEGOCIO") ?? "").toLowerCase() === "true";
    const propios = filtrarPorTenant ? filtrarPorNegocio(todos, sesion.tenantId) : todos;

    const conStock = propios.filter(tieneStockInformado);
    let productos = conStock.map(normalizar);

    if (soloIngredientes) productos = productos.filter((p) => p.esIngrediente);
    if (cuerpo.solo_activos === true) productos = productos.filter((p) => p.activo);

    productos.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} modo=${modo} ` +
      `crudos=${todos.length} propios=${propios.length} salida=${productos.length}`,
    );

    return json({
      ok: true,
      message: "Inventarios consultados correctamente.",
      empresa_id: ctx.empresaId,
      modo,
      consulta: {
        negocio: sesion.tenantId,
        fecha: fecha || null,
        productos_totales: todos.length,
        productos_empresa: propios.length,
      },
      productos,
      Productos: productos,
      total_productos: productos.length,
      ...(DEBUG ? { _crudo: todos.slice(0, 3) } : {}),
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

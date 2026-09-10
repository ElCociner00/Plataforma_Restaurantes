/**
 * consultar-gastos — gastos registrados en Loggro/pirpos.
 *
 * Fusiona TRES flujos n8n que eran el mismo código con distinto rango de fechas:
 *   · Loggro/Cierre_Turno/consultar_gastos.txt        (11 nodos) → modo "turno"
 *   · Loggro/Pedir_Datos/Cargar_Gastos.txt            (24 nodos) → modo "visualizacion"
 *   · Loggro/Pedir_Datos/Cargar_Gastos_Catalogo.txt   (24 nodos) → modo "catalogo"
 *
 * Los 24 nodos de los dos últimos eran dos copias del mismo camino, una para
 * superadmin y otra para usuario normal. Ese eje ahora lo resuelve
 * resolverContexto, así que queda un solo camino.
 *
 * Contrato de salida: { ok, Gastos: [{ Id, name, valor }] }
 * `Gastos` con G mayúscula es lo que espera normalizeExtras() en
 * js/cierre_turno.js; se respeta tal cual.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { resolverContexto } from "../_shared/tenant.ts";
import { comoLista, obtenerSesionLoggro, pedirLoggro } from "../_shared/loggro.ts";
import { esFechaValida, finDelDia, instanteLocal, rangoRelativo, rangoTurno } from "../_shared/fechas.ts";
import { filtrarPorNegocio } from "../_shared/ventas.ts";

const ETIQUETA = "consultar-gastos";
const DEBUG = (Deno.env.get("LOGGRO_DEBUG") ?? "").toLowerCase() === "true";

/** Días hacia atrás y adelante en los modos de catálogo, como en n8n. */
const DIAS_ATRAS = Number(Deno.env.get("GASTOS_DIAS_ATRAS") ?? "20");
const DIAS_ADELANTE = Number(Deno.env.get("GASTOS_DIAS_ADELANTE") ?? "10");

type Modo = "turno" | "visualizacion" | "catalogo";

type GastoNormalizado = {
  Id: string;
  name: string;
  valor: number;
  descripcion: string;
  proveedor: string;
  pagadoA: string;
  metodoPago: string;
  fecha: string;
  numeroFactura: string;
  impuestos: number;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : (valor == null ? "" : String(valor));
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Réplica del nodo `Parseo`: aplana la estructura de Loggro a lo que consume
 * el frontend. Los nombres de campo de salida se conservan exactamente.
 */
function normalizar(gasto: Record<string, unknown>, indice: number): GastoNormalizado {
  const tipo = (gasto.typeExpense ?? {}) as Record<string, unknown>;
  const proveedor = (gasto.provider ?? {}) as Record<string, unknown>;
  const pagadoA = (gasto.paidTo ?? {}) as Record<string, unknown>;

  return {
    Id: texto(tipo._id) || `gasto-${texto(gasto._id) || indice}`,
    name: texto(tipo.name) || `Gasto ${indice + 1}`,
    valor: numero(gasto.subTotal),
    descripcion: texto(gasto.description),
    proveedor: texto(proveedor.name),
    pagadoA: texto(pagadoA.name),
    metodoPago: texto(gasto.paymentMethod),
    fecha: texto(gasto.date),
    numeroFactura: texto(gasto.invoiceNumber),
    impuestos: numero(gasto.taxes),
  };
}

/**
 * Réplica del nodo `Filter` del flujo de cierre de turno: solo cuentan los
 * gastos con caja registradora asignada. Sin esto entran movimientos que no
 * pertenecen al turno.
 */
function tieneCaja(gasto: Record<string, unknown>): boolean {
  const caja = (gasto.cashBox ?? {}) as Record<string, unknown>;
  const registro = (caja._idCashBoxRegister ?? {}) as Record<string, unknown>;
  return texto(registro.name).trim().length > 0;
}

/** Réplica del nodo `Code in JavaScript`: agrupa por Id y suma valores. */
function agrupar(gastos: GastoNormalizado[]): { Id: string; name: string; valor: number }[] {
  const grupos = new Map<string, { Id: string; name: string; valor: number }>();

  for (const gasto of gastos) {
    if (!gasto.Id) continue;
    const previo = grupos.get(gasto.Id);
    if (previo) previo.valor += gasto.valor;
    else grupos.set(gasto.Id, { Id: gasto.Id, name: gasto.name, valor: gasto.valor });
  }

  return [...grupos.values()];
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

    const modo = (String(cuerpo.modo ?? "turno").trim().toLowerCase() as Modo);
    if (!["turno", "visualizacion", "catalogo"].includes(modo)) {
      throw errores.datosIncompletos(`modo debe ser turno, visualizacion o catalogo`);
    }

    // ── Rango de fechas ───────────────────────────────────────────────────
    let desde: Date;
    let hasta: Date;

    if (modo === "turno") {
      const fecha = String(cuerpo.fecha ?? "").trim();
      if (!esFechaValida(fecha)) throw errores.datosIncompletos("fecha (YYYY-MM-DD)");

      const turno = (cuerpo.turno ?? {}) as Record<string, unknown>;
      const horaInicio = texto(turno.inicio) || "00:00";
      const horaFin = texto(turno.fin);

      // Mismo criterio que consultar-ventas: el turno acaba a su hora de fin,
      // no a medianoche. Con el fin del día, un turno cerrado tarde se traía
      // los gastos de los turnos posteriores de esa fecha y se los apuntaba
      // como suyos. rangoTurno() resuelve además el cruce de medianoche del
      // turno de noche. Sin hora_fin se conserva el comportamiento anterior.
      if (horaFin) {
        ({ desde, hasta } = rangoTurno(fecha, horaInicio, horaFin));
      } else {
        desde = instanteLocal(fecha, horaInicio);
        hasta = finDelDia(fecha);
      }
    } else {
      const rango = rangoRelativo(DIAS_ATRAS, DIAS_ADELANTE);
      desde = rango.desde;
      hasta = rango.hasta;
    }

    const admin = ctx.clienteAdmin();
    const sesion = await obtenerSesionLoggro(admin, ctx.empresaId);

    const consulta = new URLSearchParams({
      dateInit: desde.toISOString(),
      dateEnd: hasta.toISOString(),
    });

    const crudo = await pedirLoggro(admin, ctx.empresaId, `/expenses?${consulta.toString()}`);
    const todos = comoLista(crudo);

    // Aislamiento entre empresas: mismo criterio que en ventas.
    const propios = filtrarPorNegocio(todos, sesion.tenantId);

    // El filtro de caja solo aplica al cierre de turno; en los catálogos
    // interesa el histórico completo de tipos de gasto.
    const relevantes = modo === "turno" ? propios.filter(tieneCaja) : propios;

    const normalizados = relevantes.map(normalizar);
    const agrupados = agrupar(normalizados);

    const Gastos = modo === "catalogo"
      ? agrupados.map(({ Id, name }) => ({ Id, name, valor: 0 }))
      : agrupados;

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} modo=${modo} ` +
      `crudos=${todos.length} propios=${propios.length} agrupados=${Gastos.length}`,
    );

    return json({
      ok: true,
      message: "Gastos consultados correctamente.",
      empresa_id: ctx.empresaId,
      modo,
      consulta: {
        date_init: desde.toISOString(),
        date_end: hasta.toISOString(),
        negocio: sesion.tenantId,
        gastos_totales: todos.length,
        gastos_empresa: propios.length,
      },
      Gastos,
      gastos: Gastos,
      detalle: modo === "turno" ? normalizados : undefined,
      total: Gastos.reduce((s, g) => s + g.valor, 0),
      ...(DEBUG ? { _crudo: todos.slice(0, 3) } : {}),
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

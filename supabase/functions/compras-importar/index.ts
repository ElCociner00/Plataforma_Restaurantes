/**
 * compras-importar — carga en base las facturas que hoy viven en la hoja de
 * cálculo «Automatización Facturas».
 *
 * No sustituye a ningún flujo n8n: es la pieza que faltaba para poder retirar
 * Google Sheets del módulo de compras. Los cuatro flujos de compras leían la
 * hoja directamente; sin volcar esos datos, las tablas compras_facturas y
 * compras_facturas_lineas quedarían vacías.
 *
 * Acepta las filas tal como salen de la hoja, con sus encabezados en español:
 *
 *   Hoja 1 (una fila por renglón de factura)
 *     Prefijo Factura · Consecutivo Factura · Proveedor · NIT o CC · Dirección ·
 *     Télefono · Correo Empresa · Producto · Valor Unitario · Cantidad ·
 *     Subtotal · Valor INC o IVA · Código Contable · Valor Débito ·
 *     Valor Crédito · Tipo de Factura · Fecha Factura · Empresa · uuid
 *
 *   Hoja 3 (una fila por factura)
 *     Prefijo Factura · Consecutivo Factura · Proveedor · Fecha Factura ·
 *     Empresa · uuid · Revisada · Distribuida
 *
 * La columna `uuid` es un hash de 96 caracteres que identifica la factura de
 * forma estable: es la clave de deduplicación, así que reimportar la misma
 * hoja no duplica nada.
 *
 * Contrato de entrada:
 *   { lineas?: [...fila de hoja 1], facturas?: [...fila de hoja 3] }
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { errores, leerCuerpo, responderError } from "../_shared/errores.ts";
import { exigirAdmin, resolverContexto, exigirAccesoEscritura } from "../_shared/tenant.ts";

const ETIQUETA = "compras-importar";
const MAX_FILAS = Number(Deno.env.get("COMPRAS_MAX_FILAS") ?? "5000");

function texto(fila: Record<string, unknown>, ...claves: string[]): string {
  for (const clave of claves) {
    const valor = fila[clave];
    if (valor !== undefined && valor !== null && String(valor).trim() !== "") {
      return String(valor).trim();
    }
  }
  return "";
}

/**
 * La hoja escribe los números al estilo colombiano: `4,990` son cuatro mil
 * novecientos noventa, no cuatro con noventa y nueve. Interpretarlo como
 * decimal dividiría cada importe por mil.
 */
function numero(fila: Record<string, unknown>, ...claves: string[]): number {
  const bruto = texto(fila, ...claves);
  if (!bruto) return 0;

  const limpio = bruto.replace(/[^\d,.-]/g, "");
  // Si hay comas y puntos, el último separador que aparece es el decimal.
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");

  let normalizado: string;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    normalizado = ultimaComa > ultimoPunto
      ? limpio.replace(/\./g, "").replace(",", ".")
      : limpio.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    // Coma sola: separador de miles salvo que deje 1 o 2 dígitos detrás.
    const decimales = limpio.length - ultimaComa - 1;
    normalizado = decimales <= 2 && limpio.split(",").length === 2
      ? limpio.replace(",", ".")
      : limpio.replace(/,/g, "");
  } else {
    normalizado = limpio;
  }

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : 0;
}

/** `30/10/2025` → `2025-10-30`. Acepta también ISO por si la hoja cambia. */
function fecha(fila: Record<string, unknown>, ...claves: string[]): string | null {
  const bruto = texto(fila, ...claves);
  if (!bruto) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(bruto)) return bruto.slice(0, 10);

  const partes = bruto.split(/[/\-.]/);
  if (partes.length === 3) {
    const [d, m, a] = partes.map((p) => p.trim());
    if (a.length === 4) {
      return `${a}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }
  }
  return null;
}

function booleano(fila: Record<string, unknown>, ...claves: string[]): boolean {
  const valor = texto(fila, ...claves).toLowerCase();
  return valor === "1" || valor === "true" || valor === "si" || valor === "sí" || valor === "x";
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

    // Ciclo de vida: corta si la cuenta nunca activó su prueba o está dada
    // de baja. La mora NO bloquea (§2.4 del plan de ciclo de vida).
    await exigirAccesoEscritura(ctx);

    exigirAdmin(ctx, "importar facturas de compra");

    const filasFactura = Array.isArray(cuerpo.facturas) ? cuerpo.facturas as Record<string, unknown>[] : [];
    const filasLinea = Array.isArray(cuerpo.lineas) ? cuerpo.lineas as Record<string, unknown>[] : [];

    if (filasFactura.length === 0 && filasLinea.length === 0) {
      throw errores.datosIncompletos("facturas y/o lineas");
    }
    if (filasFactura.length + filasLinea.length > MAX_FILAS) {
      throw errores.datosIncompletos(`como máximo ${MAX_FILAS} filas por llamada`);
    }

    const admin = ctx.clienteAdmin();

    // ── Cabeceras ─────────────────────────────────────────────────────────
    // Se construyen a partir de la hoja 3 y, para las que solo aparezcan en la
    // hoja 1, se derivan de sus renglones. El total sale de sumar los renglones.
    type Cabecera = {
      empresa_id: string;
      hash_factura: string;
      prefijo_factura: string;
      consecutivo_factura: string;
      proveedor: string;
      nit_proveedor: string;
      direccion: string | null;
      telefono: string | null;
      correo_proveedor: string | null;
      tipo_factura: string;
      fecha_factura: string | null;
      subtotal: number;
      impuestos: number;
      total: number;
      revisada: boolean;
      distribuida: boolean;
      origen: string;
    };

    const cabeceras = new Map<string, Cabecera>();

    const empresaDe = (fila: Record<string, unknown>): string => {
      const desdeHoja = texto(fila, "Empresa", "empresa", "empresa_id");
      // La empresa de la hoja solo se acepta si está dentro del alcance del
      // llamante; en otro caso se importa a su propia empresa.
      if (desdeHoja && (ctx.esSuperadmin || ctx.empresasVisibles.includes(desdeHoja))) {
        return desdeHoja;
      }
      return ctx.empresaId;
    };

    for (const fila of filasFactura) {
      const hash = texto(fila, "uuid", "UUID", "hash_factura");
      if (!hash) continue;
      const empresaId = empresaDe(fila);
      cabeceras.set(`${empresaId}|${hash}`, {
        empresa_id: empresaId,
        hash_factura: hash,
        prefijo_factura: texto(fila, "Prefijo Factura", "prefijo_factura"),
        consecutivo_factura: texto(fila, "Consecutivo Factura", "consecutivo_factura"),
        proveedor: texto(fila, "Proveedor", "proveedor"),
        nit_proveedor: "",
        direccion: null,
        telefono: null,
        correo_proveedor: null,
        tipo_factura: "",
        fecha_factura: fecha(fila, "Fecha Factura", "fecha_factura"),
        subtotal: 0,
        impuestos: 0,
        total: 0,
        revisada: booleano(fila, "Revisada", "revisada"),
        distribuida: booleano(fila, "Distribuida", "distribuida"),
        origen: "sheet",
      });
    }

    // ── Renglones ─────────────────────────────────────────────────────────
    type Linea = {
      clave: string;
      empresa_id: string;
      linea: number;
      producto: string;
      valor_unitario: number;
      cantidad: number;
      subtotal: number;
      valor_inc_iva: number;
      codigo_contable: string;
      valor_debito: number;
      valor_credito: number;
    };

    const lineas: Linea[] = [];
    const contadorPorFactura = new Map<string, number>();

    for (const fila of filasLinea) {
      const hash = texto(fila, "uuid", "UUID", "hash_factura");
      if (!hash) continue;

      const empresaId = empresaDe(fila);
      const clave = `${empresaId}|${hash}`;

      let cabecera = cabeceras.get(clave);
      if (!cabecera) {
        cabecera = {
          empresa_id: empresaId,
          hash_factura: hash,
          prefijo_factura: texto(fila, "Prefijo Factura", "prefijo_factura"),
          consecutivo_factura: texto(fila, "Consecutivo Factura", "consecutivo_factura"),
          proveedor: texto(fila, "Proveedor", "proveedor"),
          nit_proveedor: "",
          direccion: null,
          telefono: null,
          correo_proveedor: null,
          tipo_factura: "",
          fecha_factura: fecha(fila, "Fecha Factura", "fecha_factura"),
          subtotal: 0,
          impuestos: 0,
          total: 0,
          revisada: false,
          distribuida: false,
          origen: "sheet",
        };
        cabeceras.set(clave, cabecera);
      }

      // Los datos del proveedor solo están en la hoja 1: se completan aquí.
      cabecera.nit_proveedor ||= texto(fila, "NIT o CC ", "NIT o CC", "nit_proveedor");
      cabecera.direccion ??= texto(fila, "Dirección", "direccion") || null;
      cabecera.telefono ??= texto(fila, "Télefono", "Teléfono", "telefono") || null;
      cabecera.correo_proveedor ??= texto(fila, "Correo Empresa", "correo_proveedor") || null;
      cabecera.tipo_factura ||= texto(fila, "Tipo de Factura", "tipo_factura");
      cabecera.fecha_factura ??= fecha(fila, "Fecha Factura", "fecha_factura");

      const subtotal = numero(fila, "Subtotal", "subtotal");
      const impuesto = numero(fila, "Valor INC o IVA", "valor_inc_iva");
      cabecera.subtotal += subtotal;
      cabecera.impuestos += impuesto;
      cabecera.total += subtotal + impuesto;

      const indice = (contadorPorFactura.get(clave) ?? 0) + 1;
      contadorPorFactura.set(clave, indice);

      lineas.push({
        clave,
        empresa_id: empresaId,
        linea: indice,
        producto: texto(fila, "Producto", "producto"),
        valor_unitario: numero(fila, "Valor Unitario", "valor_unitario"),
        cantidad: numero(fila, "Cantidad", "cantidad"),
        subtotal,
        valor_inc_iva: impuesto,
        codigo_contable: texto(fila, "Código Contable", "codigo_contable"),
        valor_debito: numero(fila, "Valor Débito", "valor_debito"),
        valor_credito: numero(fila, "Valor Crédito", "valor_credito"),
      });
    }

    if (cabeceras.size === 0) {
      throw errores.datosIncompletos("filas con columna uuid");
    }

    // ── Guardar ───────────────────────────────────────────────────────────
    const { data: guardadas, error: errorCabeceras } = await admin
      .from("compras_facturas")
      .upsert([...cabeceras.values()], { onConflict: "empresa_id,hash_factura" })
      .select("id, empresa_id, hash_factura");

    if (errorCabeceras) {
      console.error(`[${ETIQUETA}] Error al guardar cabeceras:`, errorCabeceras.message);
      throw errores.baseDeDatos(errorCabeceras.message);
    }

    const idPorClave = new Map<string, string>();
    for (const fila of guardadas ?? []) {
      idPorClave.set(`${fila.empresa_id}|${fila.hash_factura}`, String(fila.id));
    }

    let lineasGuardadas = 0;
    if (lineas.length > 0) {
      const facturasTocadas = [...new Set(lineas.map((l) => idPorClave.get(l.clave)).filter(Boolean))] as string[];

      // Reimportar una factura reemplaza sus renglones en vez de duplicarlos.
      if (facturasTocadas.length > 0) {
        await admin.from("compras_facturas_lineas").delete().in("factura_id", facturasTocadas);
      }

      const filasLineas = lineas
        .map(({ clave, ...resto }) => {
          const facturaId = idPorClave.get(clave);
          return facturaId ? { factura_id: facturaId, ...resto } : null;
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);

      const { error: errorLineas } = await admin
        .from("compras_facturas_lineas")
        .insert(filasLineas);

      if (errorLineas) {
        console.error(`[${ETIQUETA}] Error al guardar renglones:`, errorLineas.message);
        throw errores.baseDeDatos(errorLineas.message);
      }
      lineasGuardadas = filasLineas.length;
    }

    console.info(
      `[${ETIQUETA}] empresa=${ctx.empresaId} facturas=${cabeceras.size} lineas=${lineasGuardadas}`,
    );

    return json({
      ok: true,
      message: "Importación completada.",
      facturas_importadas: guardadas?.length ?? 0,
      lineas_importadas: lineasGuardadas,
      empresas_afectadas: [...new Set([...cabeceras.values()].map((c) => c.empresa_id))],
    }, 200, origin);
  } catch (error) {
    return responderError(error, origin, ETIQUETA);
  }
});

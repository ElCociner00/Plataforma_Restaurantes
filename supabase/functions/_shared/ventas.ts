/**
 * Normalización de las ventas que devuelve Loggro/pirpos.
 *
 * Réplica del tramo `Split Out` → `Aggregate` → `Code in JavaScript1` del flujo
 * n8n `consultar_ventas`, incluidas sus dos comisiones colombianas, que estaban
 * escritas a mano dentro del nodo. Se mantienen los mismos números para que el
 * cierre de turno no cambie de resultado al migrar.
 *
 * EL NODO QUE IMPORTA es el `Split Out` sobre `paid.paymentMethodValue`. Una
 * factura puede pagarse con VARIOS medios a la vez, y Loggro guarda ese
 * desglose en ese array interno. n8n lo abría y sumaba cada parte a su método;
 * la primera versión de este módulo leía `paymentMethod` y `total` al nivel de
 * la factura y le asignaba el importe completo a un solo medio.
 *
 * El total general salía bien —por eso la verificación inicial lo dio por
 * bueno— pero el desglose por canal no. Caso real del 2026-08-20: una factura
 * de 48 000 pagada 24 000 en transferencia y 24 000 en efectivo se contaba
 * entera como transferencia.
 */

/** Canales que el formulario de cierre de turno muestra. */
export const CANALES = [
  "efectivo",
  "datafono",
  "rappi",
  "nequi",
  "transferencias",
  "bono_regalo",
] as const;

export type Canal = typeof CANALES[number];

/**
 * Palabras que identifican cada canal dentro del `paymentMethod` del proveedor.
 * Ampliable sin desplegar: LOGGRO_MAPEO_METODOS admite un JSON
 * {"canal": ["palabra", ...]} que se fusiona con esta tabla. Necesario porque
 * cada empresa nombra sus medios de pago como quiere en su propio Loggro.
 */
const MAPEO_BASE: Record<Canal, string[]> = {
  efectivo: ["efectivo", "cash", "contado"],
  datafono: ["datafono", "datáfono", "tarjeta", "card", "credibanco", "debito", "débito", "credito", "crédito"],
  rappi: ["rappi"],
  nequi: ["nequi"],
  transferencias: ["transferencia", "bancolombia", "daviplata", "transfer", "pse"],
  bono_regalo: ["bono", "regalo", "gift", "cortesia", "cortesía"],
};

function mapeoMetodos(): Record<Canal, string[]> {
  const extra = Deno.env.get("LOGGRO_MAPEO_METODOS");
  if (!extra) return MAPEO_BASE;
  try {
    const parseado = JSON.parse(extra) as Partial<Record<Canal, string[]>>;
    const fusionado = { ...MAPEO_BASE };
    for (const canal of CANALES) {
      if (Array.isArray(parseado[canal])) {
        fusionado[canal] = [...MAPEO_BASE[canal], ...parseado[canal]!.map((p) => String(p).toLowerCase())];
      }
    }
    return fusionado;
  } catch {
    console.error("[ventas] LOGGRO_MAPEO_METODOS no es JSON válido; se ignora.");
    return MAPEO_BASE;
  }
}

/** `Transferencia Bancolombia` → `transferencia_bancolombia` (clave n8n). */
export function claveMetodo(metodo: string): string {
  return String(metodo || "SinMétodo").toLowerCase().replace(/\s+/g, "_");
}

function canalDe(metodo: string, mapeo: Record<Canal, string[]>): Canal | null {
  const texto = String(metodo || "").toLowerCase();
  for (const canal of CANALES) {
    if (mapeo[canal].some((palabra) => texto.includes(palabra))) return canal;
  }
  return null;
}

/**
 * Comisiones sobre la propina, tal cual las aplicaba n8n:
 *   · transferencia / bancolombia → 4 por mil (4 pesos por cada 1000 completos)
 *   · datáfono                    → 2,5 % (×0,975)
 *
 * Verificado contra api.pirpos.com el 2026-08-22: el medio de pago llega como
 * «Transferencia Bancolombia», en SINGULAR, cuya clave normalizada es
 * `transferencia_bancolombia` — que sí está en la lista que comparaba n8n. Es
 * decir, el 4 por mil se venía aplicando con normalidad, al contrario de lo
 * que afirmaba el comentario anterior de este bloque.
 *
 * La bandera PROPINA_4X1000_TRANSFERENCIAS se mantiene por si alguna empresa
 * nombra su medio de pago en plural en su propio Loggro; ahí sí quedaría fuera
 * de la lista y haría falta activarla.
 */
export function propinaConComision(clave: string, propina: number): number {
  const clavesTransferencia = ["transferencia_bancolombia", "transferencia", "bancolombia"];
  if ((Deno.env.get("PROPINA_4X1000_TRANSFERENCIAS") ?? "").toLowerCase() === "true") {
    clavesTransferencia.push("transferencias_bancolombia", "transferencias");
  }

  if (clavesTransferencia.includes(clave)) {
    const descuento = Math.floor(propina / 1000) * 4;
    return propina - descuento;
  }
  if (clave === "datafono" || clave === "datáfono") {
    return propina * 0.975;
  }
  return propina;
}

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export type ResumenVentas = Record<string, unknown> & {
  efectivo_sistema: number;
  datafono_sistema: number;
  rappi_sistema: number;
  nequi_sistema: number;
  transferencias_sistema: number;
  bono_regalo_sistema: number;
  propina: number;
};

type EntradaPago = {
  metodo: string;
  valor: number;
  propina: number;
  domicilio: number;
};

/**
 * Desglose de pagos de una factura, equivalente al `Split Out` de n8n sobre
 * `paid.paymentMethodValue`.
 *
 * Estructura verificada contra api.pirpos.com el 2026-08-22:
 *   factura.paid.paymentMethodValue = [
 *     { paymentMethod, value, tip, deliveryCost }, ...
 *   ]
 *
 * Si una factura llegara sin ese array, se la trata como un único pago con los
 * campos de nivel superior. Es el respaldo para que una factura mal formada
 * sume su importe en algún sitio en lugar de desaparecer del cierre.
 */
function entradasDePago(factura: Record<string, unknown>): EntradaPago[] {
  const pagado = (factura.paid ?? {}) as Record<string, unknown>;
  const lista = pagado.paymentMethodValue;

  if (Array.isArray(lista) && lista.length) {
    return lista.map((cruda) => {
      const pago = (cruda ?? {}) as Record<string, unknown>;
      return {
        metodo: String(pago.paymentMethod ?? "SinMétodo"),
        valor: numero(pago.value),
        propina: numero(pago.tip),
        domicilio: numero(pago.deliveryCost),
      };
    });
  }

  const entrega = (factura.delivery ?? {}) as Record<string, unknown>;
  return [{
    metodo: String(factura.paymentMethod ?? factura.payment_method ?? "SinMétodo"),
    valor: numero(factura.total ?? factura.totalPaid ?? factura.value ?? factura.amount),
    propina: numero(factura.tip ?? factura.propina),
    domicilio: numero(factura.deliveryCost ?? entrega.cost ?? entrega.value),
  }];
}

/**
 * Agrupa las facturas por medio de pago y produce a la vez:
 *   · los campos `*_sistema` que lee js/cierre_turno.js
 *   · los campos `{metodo}_valor|_propina|_domicilios|_total` de n8n, para que
 *     nada que ya dependiera de ellos se rompa
 */
export function resumirVentas(facturas: Record<string, unknown>[]): ResumenVentas {
  const mapeo = mapeoMetodos();

  const grupos: Record<string, { valor: number; propina: number; domicilios: number; count: number }> = {};
  const porCanal: Record<Canal, number> = {
    efectivo: 0, datafono: 0, rappi: 0, nequi: 0, transferencias: 0, bono_regalo: 0,
  };
  let propinaTotal = 0;

  for (const factura of facturas) {
    for (const pago of entradasDePago(factura)) {
      // n8n descartaba las entradas sin importe (`if (!trans?.value) return;`).
      if (!pago.valor) continue;

      const clave = claveMetodo(pago.metodo);

      grupos[clave] ??= { valor: 0, propina: 0, domicilios: 0, count: 0 };
      grupos[clave].valor += pago.valor;

      // La comisión se aplica sobre la propina de ESTE medio de pago, no sobre
      // la de la factura entera: es lo que hacía n8n después del Split Out.
      const propinaAjustada = propinaConComision(clave, pago.propina);
      grupos[clave].propina += propinaAjustada;
      grupos[clave].domicilios += pago.domicilio;
      grupos[clave].count++;

      propinaTotal += propinaAjustada;

      const canal = canalDe(pago.metodo, mapeo);
      if (canal) porCanal[canal] += pago.valor;
    }
  }

  const resultado: Record<string, unknown> = {};

  for (const [clave, grupo] of Object.entries(grupos)) {
    resultado[`${clave}_valor`] = grupo.valor;
    resultado[`${clave}_propina`] = Math.round(grupo.propina);
    resultado[`${clave}_domicilios`] = grupo.domicilios;
    resultado[`${clave}_total`] = grupo.valor + Math.round(grupo.propina) + grupo.domicilios;
    resultado[`${clave}_transacciones`] = grupo.count;
  }

  const totalValor = Object.values(grupos).reduce((s, g) => s + g.valor, 0);
  const totalPropina = Object.values(grupos).reduce((s, g) => s + g.propina, 0);
  const totalDomicilios = Object.values(grupos).reduce((s, g) => s + g.domicilios, 0);

  resultado.total_general_valor = totalValor;
  resultado.total_general_propina = Math.round(totalPropina);
  resultado.total_general_domicilios = totalDomicilios;
  resultado.total_general = totalValor + Math.round(totalPropina) + totalDomicilios;

  return {
    ...resultado,
    efectivo_sistema: Math.round(porCanal.efectivo),
    datafono_sistema: Math.round(porCanal.datafono),
    rappi_sistema: Math.round(porCanal.rappi),
    nequi_sistema: Math.round(porCanal.nequi),
    transferencias_sistema: Math.round(porCanal.transferencias),
    bono_regalo_sistema: Math.round(porCanal.bono_regalo),
    propina: Math.round(propinaTotal),
    transacciones: facturas.length,
  } as ResumenVentas;
}

/**
 * Aísla la empresa dentro de la respuesta del proveedor.
 *
 * Una misma cuenta de Loggro puede administrar varios negocios; el API
 * devuelve las facturas de todos. El flujo n8n filtraba comparando
 * `credenciales_plataforma.plataforma_tenant_id` con `businessId`. Sin este
 * filtro, un local vería las ventas de sus hermanos: es el punto exacto donde
 * se rompería el aislamiento entre empresas.
 */
export function negocioDe(registro: Record<string, unknown>): string {
  // Verificado contra api.pirpos.com el 2026-08-22:
  //   · /invoices → `businessId`, cadena plana
  //   · /expenses → `business`, objeto con `_id`
  const directo = registro.businessId ?? registro.business_id;
  if (typeof directo === "string" && directo) return directo;

  const negocio = registro.business;
  if (typeof negocio === "string" && negocio) return negocio;
  if (negocio && typeof negocio === "object") {
    const id = (negocio as Record<string, unknown>)._id ?? (negocio as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }
  return "";
}

export function filtrarPorNegocio(
  registros: Record<string, unknown>[],
  tenantId: string | null,
): Record<string, unknown>[] {
  if (!tenantId) return registros;

  const conNegocio = registros.filter((r) => negocioDe(r) !== "");

  // Si el proveedor no marca el negocio en ningún registro, no hay nada que
  // filtrar: devolverlos todos es el comportamiento heredado.
  if (conNegocio.length === 0) return registros;

  return registros.filter((r) => negocioDe(r) === tenantId);
}

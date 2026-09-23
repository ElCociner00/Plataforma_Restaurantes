export type DashboardOrder = {
  empresa_id: string;
  store_id: string | null;
  rappi_order_id: string;
  provider_created_at: string | null;
  accepted_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  operational_status: string | null;
  delivery_operation_type: string | null;
  total_to_pay: number | string | null;
  tip_amount: number | string | null;
  total_discounts: number | string | null;
  items: unknown;
};

export type DashboardStore = {
  id: string;
  enkrato_empresa_id: string | null;
  store_name: string | null;
};

const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;
const money = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const dateMs = (value: string | null) => value ? Date.parse(value) : NaN;
const localTime = (value: string) => new Date(Date.parse(value) - BOGOTA_OFFSET_MS);

export function summarizeRappiDashboard(orders: DashboardOrder[], stores: DashboardStore[]) {
  const storeNames = new Map(stores.map((store) => [store.id, store.store_name || "Tienda Rappi"]));
  const daily = new Map<string, { fecha: string; pedidos: number; cancelados: number; valor: number }>();
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hora: hour, pedidos: 0 }));
  const locations = new Map<string, { empresa_id: string; nombre: string; pedidos: number; valor: number }>();
  const products = new Map<string, { nombre: string; unidades: number }>();
  const totals = {
    pedidos: 0, cancelados: 0, entregados: 0, turbo: 0, regular: 0,
    valor_no_cancelado: 0, propinas: 0, descuentos: 0,
    aceptacion_minutos: null as number | null, entrega_minutos: null as number | null,
  };
  let acceptedMinutes = 0;
  let acceptedCount = 0;
  let deliveredMinutes = 0;
  let deliveredCount = 0;

  for (const order of orders) {
    // Defense in depth: a DEV connection is filtered by the caller, and these
    // synthetic prefixes are excluded even if accidentally attached to PROD.
    if (/^(?:SAMPLE-|ENKRATO-DEV-)/i.test(order.rappi_order_id)) continue;
    if (!order.provider_created_at || !Number.isFinite(Date.parse(order.provider_created_at))) continue;
    const local = localTime(order.provider_created_at);
    const fecha = local.toISOString().slice(0, 10);
    const hour = local.getUTCHours();
    const day = daily.get(fecha) ?? { fecha, pedidos: 0, cancelados: 0, valor: 0 };
    day.pedidos += 1;
    hourly[hour].pedidos += 1;
    totals.pedidos += 1;
    if (String(order.delivery_operation_type || "").toLowerCase() === "turbo") totals.turbo += 1;
    else totals.regular += 1;

    const cancelled = Boolean(order.cancelled_at) || /CANCEL|REJECT/i.test(order.operational_status || "");
    if (cancelled) { totals.cancelados += 1; day.cancelados += 1; }
    if (!cancelled && (order.delivered_at || /COMPLETED|DELIVERED/i.test(order.operational_status || ""))) totals.entregados += 1;
    if (!cancelled) {
      const value = money(order.total_to_pay);
      day.valor += value;
      totals.valor_no_cancelado += value;
      totals.propinas += money(order.tip_amount);
      totals.descuentos += money(order.total_discounts);
      const key = order.empresa_id;
      const location = locations.get(key) ?? {
        empresa_id: key, nombre: storeNames.get(order.store_id || "") || "Local Rappi", pedidos: 0, valor: 0,
      };
      location.pedidos += 1;
      location.valor += value;
      locations.set(key, location);
      for (const item of Array.isArray(order.items) ? order.items : []) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const name = String(record.name || "").trim();
        if (!name) continue;
        const quantity = Math.max(0, money(record.quantity) || 1);
        const product = products.get(name) ?? { nombre: name, unidades: 0 };
        product.unidades += quantity;
        products.set(name, product);
      }
    }
    daily.set(fecha, day);

    const created = dateMs(order.provider_created_at);
    const accepted = dateMs(order.accepted_at);
    const delivered = dateMs(order.delivered_at);
    if (!cancelled && Number.isFinite(accepted) && accepted >= created && accepted - created <= 2 * 86400000) {
      acceptedMinutes += (accepted - created) / 60000;
      acceptedCount += 1;
    }
    if (!cancelled && Number.isFinite(delivered) && Number.isFinite(accepted) && delivered >= accepted && delivered - accepted <= 2 * 86400000) {
      deliveredMinutes += (delivered - accepted) / 60000;
      deliveredCount += 1;
    }
  }
  totals.aceptacion_minutos = acceptedCount ? Math.round(acceptedMinutes / acceptedCount * 10) / 10 : null;
  totals.entrega_minutos = deliveredCount ? Math.round(deliveredMinutes / deliveredCount * 10) / 10 : null;
  return {
    totals,
    daily: [...daily.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)),
    hourly,
    locations: [...locations.values()].sort((a, b) => b.valor - a.valor),
    top_products: [...products.values()].sort((a, b) => b.unidades - a.unidades).slice(0, 10),
  };
}

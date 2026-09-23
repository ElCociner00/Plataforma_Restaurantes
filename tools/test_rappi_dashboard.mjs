import assert from "node:assert/strict";
import { summarizeRappiDashboard } from "../supabase/functions/rappi-data/dashboard-metrics.ts";

const order = (overrides = {}) => ({
  empresa_id: "local-1", store_id: "store-1", rappi_order_id: "1702645662",
  provider_created_at: "2026-09-22T02:30:00Z", accepted_at: "2026-09-22T02:32:00Z",
  delivered_at: "2026-09-22T03:02:00Z", cancelled_at: null, operational_status: "COMPLETED",
  delivery_operation_type: "turbo", total_to_pay: 28900, tip_amount: 2000,
  total_discounts: 1000, items: [{ name: "Shake", quantity: 2 }], ...overrides,
});

const result = summarizeRappiDashboard([
  order(),
  order({ rappi_order_id: "1702645663", cancelled_at: "2026-09-22T02:34:00Z", operational_status: "CANCELLED" }),
  order({ rappi_order_id: "SAMPLE-ORDER-1" }),
  order({ rappi_order_id: "ENKRATO-DEV-1" }),
], [{ id: "store-1", enkrato_empresa_id: "local-1", store_name: "Batut" }]);

assert.equal(result.totals.pedidos, 2);
assert.equal(result.totals.cancelados, 1);
assert.equal(result.totals.entregados, 1);
assert.equal(result.totals.valor_no_cancelado, 28900);
assert.equal(result.totals.aceptacion_minutos, 2);
assert.equal(result.totals.entrega_minutos, 30);
assert.equal(result.daily[0].fecha, "2026-09-21", "El día debe ser el operativo en Bogotá");
assert.equal(result.hourly[21].pedidos, 2);
assert.equal(result.top_products[0].unidades, 2);
assert.equal(result.locations[0].nombre, "Batut");
console.log("Rappi dashboard OK: producción, cancelaciones, hora de Bogotá, métricas y productos.");

import { filtrarPorNegocio, resumirVentas } from "./ventas.ts";

function assert(condition: unknown, message = "Assertion failed"): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("Loggro separa pagos mixtos y aplica las comisiones heredadas por medio", () => {
  const result = resumirVentas([{
    paid: {
      paymentMethodValue: [
        { paymentMethod: "Transferencia Bancolombia", value: 24_000, tip: 1_000, deliveryCost: 0 },
        { paymentMethod: "Efectivo", value: 24_000, tip: 500, deliveryCost: 0 },
      ],
    },
  }]);
  assertEquals(result.transferencias_sistema, 24_000);
  assertEquals(result.efectivo_sistema, 24_000);
  assertEquals(result.total_general_valor, 48_000);
  assertEquals(result.propina, 1_496);
  assertEquals(result.transacciones, 1);
});

Deno.test("Loggro aísla facturas con businessId y gastos con business._id", () => {
  const rows = [
    { businessId: "tenant-a", total: 1 },
    { business: { _id: "tenant-a" }, total: 2 },
    { businessId: "tenant-b", total: 3 },
  ];
  const filtered = filtrarPorNegocio(rows, "tenant-a");
  assertEquals(filtered.length, 2);
  assert(filtered.every((item) => item.total !== 3));
});

Deno.test("Loggro conserva respuestas sin marcador de negocio", () => {
  const rows = [{ total: 1 }, { total: 2 }];
  assertEquals(filtrarPorNegocio(rows, "tenant-a"), rows);
});

import { finDelDia, instanteLocal, rangoTurno } from "./fechas.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
  }
}

Deno.test("Loggro convierte la hora Colombia UTC-5 al instante UTC correcto", () => {
  assertEquals(instanteLocal("2026-08-30", "19:15").toISOString(), "2026-08-31T00:15:00.000Z");
  assertEquals(finDelDia("2026-08-30").toISOString(), "2026-08-31T04:59:59.999Z");
});

Deno.test("Loggro extiende al día siguiente un turno que cruza medianoche", () => {
  const range = rangoTurno("2026-08-30", "18:00", "02:00");
  assertEquals(range.desde.toISOString(), "2026-08-30T23:00:00.000Z");
  assertEquals(range.hasta.toISOString(), "2026-08-31T07:00:00.000Z");
});

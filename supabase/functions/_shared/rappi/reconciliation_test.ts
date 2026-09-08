import { evaluateReconciliation } from "./reconciliation.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("Matching values reconcile within tolerance", () => {
  const result = evaluateReconciliation({
    operationalStatus: "COMPLETED",
    operationalAmount: 50000,
    financialAmount: 49999.5,
    accountingAmount: null,
    paymentId: "payment-1",
    tolerance: 1,
  });
  assert(result.status === "MATCHED", "Amounts within tolerance should match");
  assert(result.ruleCodes.includes("VALUES_MATCH"), "Match evidence should identify the rule");
});

Deno.test("Old completed order without payment raises warning", () => {
  const result = evaluateReconciliation({
    operationalStatus: "COMPLETED",
    operationalAmount: 50000,
    financialAmount: null,
    accountingAmount: null,
    paymentId: null,
    ageHours: 73,
  });
  assert(result.status === "WARNING", "Missing payment after cutoff should warn");
  assert(result.ruleCodes.includes("ORDER_WITHOUT_PAYMENT_AFTER_CUTOFF"), "Cutoff rule should be recorded");
});

Deno.test("Cancelled order with accounting movement is critical", () => {
  const result = evaluateReconciliation({
    operationalStatus: "CANCELLED",
    operationalAmount: 0,
    financialAmount: 0,
    accountingAmount: 40000,
    paymentId: "payment-1",
  });
  assert(result.status === "CRITICAL" && result.severity === "CRITICAL", "Accounting movement on cancellation must be critical");
  assert(result.ruleCodes.includes("CANCELLED_WITH_ACCOUNTING_MOVEMENT"), "Critical rule should be recorded");
});

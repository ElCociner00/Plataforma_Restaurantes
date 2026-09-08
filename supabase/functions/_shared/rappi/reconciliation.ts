export type ReconciliationInput = {
  operationalStatus: string;
  operationalAmount: number | null;
  financialAmount: number | null;
  accountingAmount: number | null;
  paymentId?: string | null;
  accountingStatus?: string | null;
  operationalPaymentMethod?: string | null;
  accountingPaymentMethod?: string | null;
  ageHours?: number;
  tolerance?: number;
};

export type ReconciliationResult = {
  status: "PENDING" | "MATCHED" | "WARNING" | "CRITICAL";
  severity: "INFO" | "WARNING" | "CRITICAL";
  differenceAmount: number | null;
  ruleCodes: string[];
};

export function evaluateReconciliation(input: ReconciliationInput): ReconciliationResult {
  const rules: string[] = [];
  const tolerance = Math.max(0, input.tolerance ?? 1);
  const completed = /COMPLETED|DELIVERED|FINISHED/.test(input.operationalStatus.toUpperCase());
  const cancelled = input.operationalStatus.toUpperCase().includes("CANCEL");
  const difference = input.operationalAmount !== null && input.financialAmount !== null
    ? roundMoney(input.operationalAmount - input.financialAmount)
    : null;

  if (completed && !input.paymentId && (input.ageHours ?? 0) >= 72) rules.push("ORDER_WITHOUT_PAYMENT_AFTER_CUTOFF");
  if (difference !== null && Math.abs(difference) > tolerance) rules.push("AMOUNT_DIFFERENCE");
  if (cancelled && input.accountingAmount !== null && Math.abs(input.accountingAmount) > tolerance) {
    rules.push("CANCELLED_WITH_ACCOUNTING_MOVEMENT");
  }
  if (
    input.operationalPaymentMethod && input.accountingPaymentMethod &&
    input.operationalPaymentMethod.toUpperCase() !== input.accountingPaymentMethod.toUpperCase()
  ) rules.push("PAYMENT_METHOD_MISMATCH");
  if (input.accountingStatus?.toUpperCase() === "REJECTED") rules.push("ACCOUNTING_REJECTED");

  const critical = rules.some((rule) =>
    ["CANCELLED_WITH_ACCOUNTING_MOVEMENT", "ACCOUNTING_REJECTED"].includes(rule)
  );
  if (critical) return { status: "CRITICAL", severity: "CRITICAL", differenceAmount: difference, ruleCodes: rules };
  if (rules.length) return { status: "WARNING", severity: "WARNING", differenceAmount: difference, ruleCodes: rules };

  const matched = Boolean(input.paymentId) && difference !== null && Math.abs(difference) <= tolerance &&
    (!input.accountingStatus || input.accountingStatus.toUpperCase() === "ACCEPTED");
  return {
    status: matched ? "MATCHED" : "PENDING",
    severity: "INFO",
    differenceAmount: difference,
    ruleCodes: matched ? ["VALUES_MATCH"] : [],
  };
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

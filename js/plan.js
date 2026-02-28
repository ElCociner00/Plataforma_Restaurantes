const DEFAULT_PLAN = "free";
const READ_ONLY_PLANS = new Set(["free"]);

const normalizeText = (value) => String(value || "").trim().toLowerCase();

export function resolveEmpresaPlan(empresa, fallbackPlan = DEFAULT_PLAN) {
  const planActual = normalizeText(empresa?.plan_actual);
  const planBase = normalizeText(empresa?.plan);
  const fallback = normalizeText(fallbackPlan) || DEFAULT_PLAN;

  if (!planActual && !planBase) return fallback;
  if (!planActual) return planBase || fallback;
  if (!planBase) return planActual || fallback;

  if (planActual !== planBase && (planActual === DEFAULT_PLAN || planBase === DEFAULT_PLAN)) {
    return planActual === DEFAULT_PLAN ? planBase : planActual;
  }

  return planActual || planBase || fallback;
}

export function isEmpresaReadOnlyPlan(empresa) {
  return READ_ONLY_PLANS.has(resolveEmpresaPlan(empresa));
}

export function normalizeEmpresaActiva(empresa) {
  if (!empresa || typeof empresa !== "object") return true;
  if (typeof empresa.activo === "boolean") return empresa.activo;
  if (typeof empresa.activa === "boolean") return empresa.activa;
  return true;
}

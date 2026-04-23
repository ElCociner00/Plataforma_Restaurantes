/**
 * MAPA DE MANTENIMIENTO (guía rápida para cambios manuales)
 * Archivo: js/plan.js
 *
 * Partes del archivo:
 * 1) Imports/constantes de configuración (dependencias y estado base).
 * 2) Utilidades puras y normalizadores (cálculos/formato/validaciones).
 * 3) Lógica principal del módulo (flujo funcional).
 * 4) Eventos/integraciones externas (DOM, API, webhooks, storage).
 *
 * Índice de funciones/bloques para ubicarte rápido:
 * - `normalizeText` (línea aprox. 4): Bloque funcional del módulo.
 *
 * Nota: este mapa no altera la lógica; sirve para navegar y parchear sin riesgo funcional.
 */
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

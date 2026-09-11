// Terminales de verdad: solo otro terminal posterior puede reemplazarlos.
const TERMINAL = new Set(["COMPLETED", "CANCELLED", "REJECTED"]);

// Orden del ciclo de vida en Rappi. Un pedido no retrocede: si un webhook
// atrasado (o sin hora) dice "en preparación" cuando ya va en camino, se
// registra en el historial pero no cambia el estado actual.
const RANK: Record<string, number> = {
  UNKNOWN: 0,
  RECEIVED: 1,
  IN_PROGRESS: 2,
  READY: 3,
  COURIER_AT_STORE: 4,
  IN_DELIVERY: 5,
  ARRIVED: 6,
  COMPLETED: 7,
  CANCELLED: 7,
  REJECTED: 7,
  NOT_ACCEPTED: 7,
};

export const TERMINAL_ORDER_STATUSES = [...TERMINAL, "NOT_ACCEPTED"];

export function shouldApplyOrderState(
  currentStatus: string | null | undefined,
  currentAt: string | null | undefined,
  nextStatus: string | null | undefined,
  nextAt: string | null | undefined,
): boolean {
  const current = String(currentStatus || "UNKNOWN").toUpperCase();
  const next = String(nextStatus || "UNKNOWN").toUpperCase();
  const currentTime = Date.parse(String(currentAt || ""));
  const nextTime = Date.parse(String(nextAt || ""));
  const older = Number.isFinite(currentTime) && Number.isFinite(nextTime) && nextTime < currentTime;

  if (TERMINAL.has(current)) return TERMINAL.has(next) && !older && next !== current;
  // NOT_ACCEPTED es una inferencia de Enkrato (Rappi no avisa el vencimiento):
  // cualquier dato real de Rappi sobre la orden la reemplaza.
  if (current === "NOT_ACCEPTED") return next !== current;
  const currentRank = RANK[current] ?? 0;
  const nextRank = RANK[next] ?? 0;
  if (nextRank > currentRank) return true;
  if (nextRank < currentRank) return false;
  return !older;
}
